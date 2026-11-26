import { useEffect, useRef, useState } from "react";
import { asPhase, type Phase, type PromptImage, type ShellSettings } from "../../../shared/protocol.ts";
import type { ProviderAuth } from "../../../shared/providers.ts";
import { AttachmentPicker, AttachmentTray, usePromptImages } from "./attachments.tsx";
import { ShellMenu } from "./ShellMenu.tsx";
import { t } from "../i18n.ts";

const HOME_NOTE: Record<Phase, string> = {
	plan: "Enter 发送，Shift+Enter 换行。助手会先给计划，你同意后才动文件；跑命令仍会问你。",
	deepplan:
		"Enter 发送，Shift+Enter 换行。助手会先一轮轮问清（每题带推荐答案，回答「全部按推荐」即照单收下），问完才给计划；只读，不改文件。",
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
	shell,
	auth,
	busy,
	onShell,
	onSend,
}: {
	project: string | null;
	/** omp's model list and the saved choice; null until the first answer arrives. */
	shell: ShellSettings | null;
	/** omp's login catalog; providers it reports as logged out are not listed. */
	auth: readonly ProviderAuth[];
	busy: boolean;
	onShell: (patch: { model?: { provider: string; id: string }; thinking?: string }) => Promise<void>;
	onSend: (text: string, images: PromptImage[], phase: Phase) => Promise<void>;
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
								<span className="project-missing">{t("先在左侧选一个项目")}</span>
							)}
						</div>
						<ShellMenu settings={shell} auth={auth} onChange={onShell} />
						<div className="home-actions">
							<AttachmentPicker disabled={busy || picks.preparing} onFiles={picks.addFiles} />
							<select
								className="phase-select"
								value={phase}
								title={t("下一条消息使用的阶段")}
								onChange={event => {
									const next = asPhase(event.target.value);
									if (next) setPhase(next);
								}}
							>
								<option value="plan">{t("规划")}</option>
								<option value="deepplan">{t("深规划")}</option>
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
