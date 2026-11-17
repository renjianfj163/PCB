import type { BrowserShot } from "../adapters.ts";

function clock(at: number | undefined): string {
	if (!at) return "";
	const date = new Date(at);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * What the agent did in a browser: the page and the screenshot it saw. There is
 * no embedded window — omp returns a picture and a URL, so that is what shows.
 */
export function BrowserPage({ shots }: { shots: BrowserShot[] }) {
	if (shots.length === 0) {
		return (
			<div className="rail-body">
				<div className="rail-section-head">
					<h2>浏览器</h2>
				</div>
				<p className="plan-empty">
					还没有截图。助手用浏览器打开页面时，最近一次的截图和地址会出现在这里。
				</p>
			</div>
		);
	}

	const [latest, ...rest] = shots.slice().reverse();

	return (
		<div className="rail-body term-page">
			<div className="rail-section-head">
				<h2>浏览器</h2>
				<span className="plan-count">{shots.length}</span>
			</div>

			{latest ? (
				<article className="shot">
					{latest.url ? (
						<a className="shot-url" href={latest.url} target="_blank" rel="noreferrer" title={latest.url}>
							{latest.url}
						</a>
					) : (
						<span className="shot-url">（没有记录地址）</span>
					)}
					{latest.src ? (
						<img className="shot-image" src={latest.src} alt="最近一次截图" />
					) : (
						<p className="plan-empty">这次浏览器操作没有截图。</p>
					)}
					<div className="shot-meta">
						<span>{latest.tool}</span>
						<span>{clock(latest.at)}</span>
						{latest.text ? <span className="shot-text">{latest.text.slice(0, 160)}</span> : null}
					</div>
				</article>
			) : null}

			{rest.length > 0 ? (
				<section className="shot-history">
					<div className="rail-section-head">
						<h2>更早</h2>
					</div>
					<ul className="shot-list">
						{rest.map(shot => (
							<li key={shot.id}>
								<span className="shot-time">{clock(shot.at)}</span>
								<span className="shot-tool">{shot.tool}</span>
								<span className="shot-url-mini" title={shot.url ?? ""}>
									{shot.url ?? "（无地址）"}
								</span>
							</li>
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}
