import { useEffect, useState } from "react";
import type { BootInfo, InstallInfo, UpdateCheck } from "../../../shared/protocol.ts";
import { loggedInProviders } from "../../../shared/providers.ts";
import { api } from "../api.ts";
import { setLocale, t, useLocale } from "../i18n.ts";
import { setOmpRaw, useOmpRaw } from "../raw.ts";

/**
 * Settings holds only what the package needs: which version runs, whether GitHub
 * has a newer one, whether a model is logged in, where this copy lives, and the
 * one log file the window writes. Nothing here changes project files.
 */
export function Settings({ boot }: { boot: BootInfo | null }) {
	const locale = useLocale();
	const ompRaw = useOmpRaw();
	const [install, setInstall] = useState<InstallInfo | null>(null);
	const [check, setCheck] = useState<UpdateCheck | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"check" | "install" | "login" | "log" | null>(null);

	useEffect(() => {
		let alive = true;
		void api
			.install()
			.then(info => {
				if (alive) setInstall(info);
			})
			.catch((cause: Error) => {
				if (alive) setError(cause.message);
			});
		return () => {
			alive = false;
		};
	}, []);

	const run = async (kind: "check" | "install" | "login" | "log", work: () => Promise<string | null>) => {
		setBusy(kind);
		setError(null);
		try {
			setNote(await work());
		} catch (cause) {
			setError((cause as Error).message);
		} finally {
			setBusy(null);
		}
	};

	const loggedIn = loggedInProviders(boot?.auth);

	return (
		<div className="settings">
			<div className="page-head">
				<div>
					<h1>{t("设置")}</h1>
					<p>{t("版本、更新、模型登录，以及这份 PCB 装在哪里。")}</p>
				</div>
			</div>

			<section>
				<h2>{t("版本")}</h2>
				<dl>
					<dt>PCB</dt>
					<dd className="mono">{install ? install.version : "—"}</dd>
					<dt>omp</dt>
					<dd className="mono">{boot?.ompVersion || "—"}</dd>
				</dl>
			</section>

			<section>
				<h2>{t("更新")}</h2>
				{check ? (
					<>
						<p className="note">
							{check.error
								? t("读不到 GitHub 上的版本：{s}", { s: check.error })
								: check.hasUpdate
									? t("有新版本 {s}（当前 {c}）。", { s: check.latest ?? "", c: check.current })
									: t("已经是最新版本（{s}）。", { s: check.current })}
						</p>
						{check.hasUpdate && check.notes ? <pre className="notes">{check.notes}</pre> : null}
					</>
				) : (
					<p className="note">{t("检查 GitHub 上的最新正式版；不会在后台自动下载或替换。")}</p>
				)}
				<div className="actions">
					<button
						type="button"
						disabled={busy !== null}
						onClick={() =>
							void run("check", async () => {
								const result = await api.checkUpdate();
								setCheck(result);
								return null;
							})
						}
					>
						{busy === "check" ? t("正在检查…") : t("检查更新")}
					</button>
					{check?.hasUpdate ? (
						<button
							type="button"
							className="primary"
							disabled={busy !== null}
							onClick={() =>
								void run("install", async () => {
									const result = await api.installUpdate();
									return result.manual
										? t("已打开安装包：选一个目录完成安装。")
										: t("安装包已在后台启动，它会结束这个窗口并装回同一目录。");
								})
							}
						>
							{busy === "install" ? t("正在下载…") : t("下载并安装")}
						</button>
					) : null}
				</div>
			</section>

			<section>
				<h2>{t("模型")}</h2>
				<dl>
					<dt>{t("登录状态")}</dt>
					<dd>
						{loggedIn.length > 0 ? (
							<ul className="auth-names">
								{loggedIn.map(item => (
									<li key={`${item.provider}\0${item.name}`}>{item.name || item.provider}</li>
								))}
							</ul>
						) : (
							t("还没有登录模型，现在发不出消息。")
						)}
					</dd>
				</dl>
				<div className="actions">
					<button
						type="button"
						disabled={busy !== null}
						onClick={() =>
							void run("login", async () => {
								await api.login();
								return t("已经打开一个登录窗口，在那边完成 omp login。");
							})
						}
					>
						{busy === "login" ? t("正在打开…") : loggedIn.length > 0 ? t("登录其它模型") : t("登录模型")}
					</button>
				</div>
			</section>

			<section>
				<h2>{t("语言")}</h2>
				<div className="config-langs" role="group" aria-label={t("语言")}>
					<button
						type="button"
						className={locale === "zh" ? "active" : undefined}
						aria-pressed={locale === "zh"}
						onClick={() => setLocale("zh")}
					>
						中文
					</button>
					<button
						type="button"
						className={locale === "en" ? "active" : undefined}
						aria-pressed={locale === "en"}
						onClick={() => setLocale("en")}
					>
						English
					</button>
				</div>
			</section>

			<section>
				<h2>{t("调试")}</h2>
				<button
					type="button"
					className={`config-switch${ompRaw ? " active" : ""}`}
					aria-pressed={ompRaw}
					onClick={() => setOmpRaw(!ompRaw)}
				>
					<span>{t("显示 omp 原文")}</span>
					<span className="config-switch-dot" aria-hidden />
				</button>
			</section>

			<section>
				<h2>{t("安装位置")}</h2>
				<dl>
					<dt>{t("目录")}</dt>
					<dd className="mono">{install ? install.dir ?? t("未安装（从源码运行）") : "—"}</dd>
					<dt>{t("日志")}</dt>
					<dd className="mono">{install?.logFile || "—"}</dd>
				</dl>
				<div className="actions">
					<button
						type="button"
						disabled={busy !== null}
						onClick={() =>
							void run("log", async () => {
								await api.openLog();
								return null;
							})
						}
					>
						{t("打开日志")}
					</button>
				</div>
			</section>

			{error ? <p className="note error-text">{error}</p> : null}
			{note ? <p className="note">{note}</p> : null}
		</div>
	);
}
