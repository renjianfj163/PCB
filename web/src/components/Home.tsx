import { useEffect, useRef, useState } from "react";

function shortPath(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	return parts.at(-1) ?? path;
}

/** First screen: one question, one box. Sends only once a project folder is chosen. */
export function Home({
	project,
	projects,
	busy,
	onSend,
	onPickProject,
}: {
	project: string | null;
	projects: string[];
	busy: boolean;
	onSend: (text: string) => Promise<void>;
	onPickProject: () => Promise<void>;
}) {
	const [text, setText] = useState("");
	const input = useRef<HTMLTextAreaElement | null>(null);

	useEffect(() => {
		input.current?.focus();
	}, []);

	const ready = project !== null && text.trim().length > 0 && !busy;

	const send = async () => {
		if (!ready) return;
		const body = text.trim();
		await onSend(body);
		setText("");
	};

	return (
		<div className="home">
			<div className="home-inner">
				<h1>想做什么？</h1>

				<div className="home-card">
					<textarea
						ref={input}
						rows={4}
						value={text}
						placeholder="说说你想让电脑帮你做什么…"
						onChange={event => setText(event.target.value)}
						onKeyDown={event => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								void send();
							}
						}}
					/>
					<div className="home-card-foot">
						<div className="home-project">
							{project ? (
								<>
									<span className="project-dot" aria-hidden />
									<span title={project}>{shortPath(project)}</span>
								</>
							) : (
								<span className="project-missing">先在左侧选一个项目，或点「添加项目」</span>
							)}
						</div>
						<div className="home-actions">
							{!project && projects.length === 0 ? (
								<button type="button" className="secondary" onClick={() => void onPickProject()}>
									添加项目
								</button>
							) : null}
							<button type="button" className="primary" disabled={!ready} onClick={() => void send()}>
								{busy ? "启动中…" : "发送"}
							</button>
						</div>
					</div>
				</div>

				<p className="home-note">
					Enter 发送，Shift+Enter 换行。助手会先给计划，你同意后才动文件；跑命令仍会问你。
				</p>
			</div>
		</div>
	);
}
