import { useEffect, useState } from "react";
import type { BrowserShot } from "../adapters.ts";
import { api } from "../api.ts";
import { t } from "../i18n.ts";

function clock(at: number | undefined): string {
	if (!at) return "";
	const date = new Date(at);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "example.com" is what people type; the frame needs a scheme. */
function asUrl(text: string): string | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	try {
		const url = new URL(withScheme);
		return url.hostname.includes(".") ? url.toString() : null;
	} catch {
		return null;
	}
}

/** A page the frame cannot hold, and why — including whether the machine can reach it at all. */
interface Blocked {
	url: string;
	reason: string;
	/** Set when the request never got a reply: no framing trick fixes that. */
	unreachable: boolean;
	addresses: string[];
}

/**
 * The browser tab has two halves. The top is a real frame you drive yourself —
 * type an address and read the page inside the rail. The bottom is what the
 * agent saw: the screenshot omp returned, plus the pages before it.
 *
 * Sites that forbid framing stay blank in the frame; the address row links out
 * so that is never a dead end.
 */
export function BrowserPage({ shots }: { shots: BrowserShot[] }) {
	const [picked, setPicked] = useState<string | null>(null);
	const [zoomSrc, setZoomSrc] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [live, setLive] = useState<string | null>(null);
	const [blocked, setBlocked] = useState<Blocked | null>(null);
	const [checking, setChecking] = useState(false);
	const [shot, setShot] = useState<{ url: string; image: string } | null>(null);
	const [shotError, setShotError] = useState<{ url: string; reason: string } | null>(null);
	const [shooting, setShooting] = useState(false);

	const ordered = shots.slice().reverse();
	const latest = ordered[0];
	const current = ordered.find(shot => shot.id === picked) ?? latest;
	const older = ordered.filter(shot => shot.id !== current?.id);

	// Offer the page the agent just opened as the next thing to load.
	useEffect(() => {
		if (!latest?.url) return;
		setDraft(previous => previous || latest.url || "");
	}, [latest?.url]);

	useEffect(() => {
		if (!zoomSrc) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setZoomSrc(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [zoomSrc]);

	const open = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const url = asUrl(draft);
		if (!url) return;
		setChecking(true);
		setBlocked(null);
		setShot(null);
		setShotError(null);
		try {
			const check = await api.frameCheck(url);
			if (check.frameable) {
				setLive(check.url ?? url);
			} else {
				setLive(null);
				setBlocked({
					url: check.url ?? url,
					reason: check.reason ?? t("站点不允许被内嵌"),
					unreachable: !check.ok,
					addresses: check.addresses ?? [],
				});
			}
		} catch {
			// 检查本身失败就更该试一次：内嵌可能仍然成功
			setLive(url);
		} finally {
			setChecking(false);
		}
	};

	const takeShot = async (target: string) => {
		setShooting(true);
		setShotError(null);
		try {
			const result = await api.pageShot(target);
			if (result.ok && result.image) {
				setShot({ url: result.url ?? target, image: result.image });
				setBlocked(null);
				setLive(null);
			} else {
				setShot(null);
				setShotError({ url: target, reason: result.reason ?? t("截图失败") });
			}
		} catch (error) {
			setShotError({ url: target, reason: (error as Error).message });
		} finally {
			setShooting(false);
		}
	};

	return (
		<div className="rail-body shot-page">
			<div className="rail-subhead">
				<span className="sub-meta">{shots.length > 0 ? t("{n} 次截图", { n: shots.length }) : t("浏览器")}</span>
				<div className="sub-tools">
					{current && current.id === latest?.id ? (
						<span className="sub-chip">{t("最新")}</span>
					) : current ? (
						<button type="button" className="sub-link" onClick={() => setPicked(null)}>
							{t("回到最新")}
						</button>
					) : null}
				</div>
			</div>

			<div className="shot-scroll">
				<form className="shot-urlbar" onSubmit={open}>
					<input
						type="text"
						inputMode="url"
						spellCheck={false}
						placeholder={t("输入地址，例如 example.com")}
						value={draft}
						onChange={event => setDraft(event.target.value)}
						aria-label={t("在右栏打开的地址")}
					/>
					<button type="submit" className="shot-go" disabled={checking || (!live && !blocked && !asUrl(draft))}>
						{checking ? t("检查…") : t("打开")}
					</button>
				</form>

				{blocked ? (
					<div className="shot-blocked">
						<p className="shot-blocked-title">{t("打不开：{s}", { s: blocked.url.replace(/^https?:\/\//, "").split("/")[0] ?? blocked.url })}</p>
						<p className="shot-blocked-reason">{t("{s}。这一栏没法把它放进来。", { s: t(blocked.reason) })}</p>
						{blocked.addresses.length > 0 ? (
							<p className="shot-blocked-addr">{t("域名解析到 {s}", { s: blocked.addresses.join(", ") })}</p>
						) : null}
						{blocked.unreachable ? (
							<p className="shot-blocked-addr">
								{t("本机的请求没拿到回应。浏览器有时能走另一条网络路径（比如加密 DNS），值得先截一张图看看。")}
							</p>
						) : null}
						<div className="shot-blocked-actions">
							<button
								type="button"
								className="shot-go primary"
								disabled={shooting}
								onClick={() => void takeShot(blocked.url)}
							>
								{shooting ? t("正在截…") : t("截图看看")}
							</button>
							<a className="shot-go" href={blocked.url} target="_blank" rel="noreferrer">
								{t("用系统浏览器打开")}
							</a>
							<button type="button" className="shot-go ghost" onClick={() => { setLive(blocked.url); setBlocked(null); }}>
								{t("还是试着内嵌")}
							</button>
						</div>
					</div>
				) : null}

				{shooting ? (
					<p className="shot-live-hint">{t("正在用本机的浏览器截图，最多半分钟…")}</p>
				) : null}

				{shotError ? (
					<div className="shot-blocked">
						<p className="shot-blocked-title">{t("截图也失败了")}</p>
						<p className="shot-blocked-reason">{t(shotError.reason)}</p>
						<div className="shot-blocked-actions">
							<button type="button" className="shot-go" disabled={shooting} onClick={() => void takeShot(shotError.url)}>
								{t("再试一次")}
							</button>
							<a className="shot-go" href={shotError.url} target="_blank" rel="noreferrer">
								{t("用系统浏览器打开")}
							</a>
						</div>
					</div>
				) : null}

				{shot ? (
					<div className="shot-live">
						<div className="shot-live-head">
							<span className="shot-live-url" title={shot.url}>
								{shot.url}
							</span>
							<a href={shot.url} target="_blank" rel="noreferrer" className="sub-link">
								{t("新标签")}
							</a>
						</div>
						<button type="button" className="shot-open" title={t("放大看")} onClick={() => setZoomSrc(shot.image)}>
							<img className="shot-image shot-static" src={shot.image} alt={t("网页截图")} />
						</button>
						<p className="shot-live-hint">{t("这是本机浏览器拍的一整页，能看不能点；要操作就用系统浏览器打开。")}</p>
						<div className="shot-blocked-actions">
							<button type="button" className="shot-go" disabled={shooting} onClick={() => void takeShot(shot.url)}>
								{shooting ? t("正在截…") : t("重新截一张")}
							</button>
							<a className="shot-go" href={shot.url} target="_blank" rel="noreferrer">
								{t("用系统浏览器打开")}
							</a>
						</div>
					</div>
				) : null}

				{live ? (
					<div className="shot-live">
						<div className="shot-live-head">
							<span className="shot-live-url" title={live}>
								{live}
							</span>
							<a href={live} target="_blank" rel="noreferrer" className="sub-link">
								{t("新标签")}
							</a>
						</div>
						<iframe
							className="shot-frame"
							src={live}
							title={t("浏览器预览")}
							sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
						/>
						<p className="shot-live-hint">{t("空白说明这个站点不允许被内嵌，用上面的「新标签」打开。")}</p>
					</div>
				) : shots.length === 0 && !blocked ? (
					<p className="rail-empty">
						{t("这里可以直接看网页：输入地址后按「打开」。助手用浏览器时，它看到的截图也会出现在下面。")}
					</p>
				) : null}

				{current ? (
					<article className="shot">
						{current.url ? (
							<a className="shot-url" href={current.url} target="_blank" rel="noreferrer" title={current.url}>
								{current.url}
							</a>
						) : (
							<span className="shot-url">{t("（没有记录地址）")}</span>
						)}
						{current.src ? (
							<button type="button" className="shot-open" title={t("放大看")} onClick={() => setZoomSrc(current.src ?? null)}>
								<img className="shot-image" src={current.src} alt={t("浏览器截图")} />
							</button>
						) : (
							<p className="rail-empty">{t("这次浏览器操作没有截图。")}</p>
						)}
						<div className="shot-meta">
							<span>{current.tool}</span>
							<span>{clock(current.at)}</span>
							{current.text ? <span className="shot-text">{current.text.slice(0, 160)}</span> : null}
						</div>
					</article>
				) : null}

				{older.length > 0 ? (
					<section className="shot-history">
						<div className="rail-subhead">
							<span className="sub-meta">{t("更早")}</span>
							<span className="plan-count">{older.length}</span>
						</div>
						<ul className="shot-list">
							{older.map(shot => (
								<li key={shot.id}>
									<button type="button" title={shot.url ?? t("（无地址）")} onClick={() => setPicked(shot.id)}>
										{shot.src ? (
											<img className="shot-thumb" src={shot.src} alt="" />
										) : (
											<span className="shot-thumb" />
										)}
										<span className="shot-line">
											<span className="shot-tool">
												{shot.tool} · {clock(shot.at)}
											</span>
											<span className="shot-url-mini">{shot.url ?? t("（无地址）")}</span>
										</span>
									</button>
								</li>
							))}
						</ul>
					</section>
				) : null}
			</div>

			{zoomSrc ? (
				<div className="shot-lightbox" role="dialog" aria-modal="true" aria-label={t("浏览器截图")} onClick={() => setZoomSrc(null)}>
					<img src={zoomSrc} alt={t("浏览器截图")} />
					<span className="shot-lightbox-hint">{t("点任意处或按 Esc 关闭")}</span>
				</div>
			) : null}
		</div>
	);
}
