import { useEffect, useRef, useState } from "react";
import type { Phase, PromptImage } from "../../../shared/protocol.ts";
import { AttachmentPicker, AttachmentTray, usePromptImages } from "./attachments.tsx";
import { t } from "../i18n.ts";

const HOME_NOTE: Record<Phase, string> = {
	plan: "Enter 发送，Shift+Enter 换行。助手会先给计划，你同意后才动文件；跑命令仍会问你。",
	build: "Enter 发送，Shift+Enter 换行。执行阶段会直接改文件；跑命令仍会问你。",
	chat: "Enter 发送，Shift+Enter 换行。聊天阶段只回答问题，不改文件、不跑命令；需要动手时切到「执行」。",
};

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
	onSend: (text: string, images: PromptImage[], phase: Phase) => Promise<void>;
	onPickProject: () => Promise<void>;
}) {
	const [text, setText] = useState("");
	const [phase, setPhase] = useState<Phase>("plan");
	const picks = usePromptImages();
	const input = useRef<HTMLTextAreaElement | null>(null);

	useEffect(() => {
		input.current?.focus();
	}, []);

	const ready = project !== null && (text.trim().length > 0 || picks.images.length > 0) && !busy && !picks.preparing;

	const send = async () => {
		if (!ready) return;
		const body = text.trim();
		await onSend(body, picks.images, phase);
		setText("");
		picks.clear();
	};

	return (
		<div className="home">
			<div className="home-inner">
				<h1>{t("想做什么？")}</h1>

				<div className={`home-card${picks.dragging ? " dragging" : ""}`} {...picks.dragProps}>
					<AttachmentTray
						images={picks.images}
						preparing={picks.preparing}
						error={picks.error}
						onRemove={picks.removeImage}
					/>
					<textarea
						ref={input}
						rows={4}
						value={text}
						placeholder={t("说说你想让电脑帮你做什么…")}
						onChange={event => setText(event.target.value)}
						onPaste={picks.onPaste}
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
								<span className="project-missing">{t("先在左侧选一个项目，或点「添加项目」")}</span>
							)}
						</div>
						<div className="home-actions">
							{!project && projects.length === 0 ? (
								<button type="button" className="secondary" onClick={() => void onPickProject()}>
									{t("添加项目")}
								</button>
							) : null}
							<AttachmentPicker disabled={busy || picks.preparing} onFiles={picks.addFiles} />
							<select
								className="phase-select"
								value={phase}
								title={t("下一条消息使用的阶段")}
								onChange={event => {
									const value = event.target.value;
									setPhase(value === "build" ? "build" : value === "chat" ? "chat" : "plan");
								}}
							>
								<option value="plan">{t("规划")}</option>
								<option value="build">{t("执行")}</option>
								<option value="chat">{t("聊天")}</option>
							</select>
							<button type="button" className="primary" disabled={!ready} onClick={() => void send()}>
								{busy ? t("启动中…") : t("发送")}
							</button>
						</div>
					</div>
				</div>

				<p className="home-note">{t(HOME_NOTE[phase])}</p>
			</div>
		</div>
	);
}
