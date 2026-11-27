import { useCallback, useEffect, useRef, useState } from "react";
import { asPhase } from "../../../shared/protocol.ts";
import type {
	ModelsInfo,
	Phase,
	PromptImage,
	SessionState,
	SessionSummary,
	ShellSettings,
	ThinkingInfo,
} from "../../../shared/protocol.ts";
import { AttachmentPicker, AttachmentTray, usePromptImages } from "./attachments.tsx";
import type { ProviderAuth } from "../../../shared/providers.ts";
import { ShellMenu } from "./ShellMenu.tsx";
import { api } from "../api.ts";
import { t } from "../i18n.ts";
import { createSessionSlots } from "../sessionSlots.ts";

/** Small amounts need the extra digits to move at all. */
function money(usd: number): string {
	if (usd >= 1) return `$${usd.toFixed(2)}`;
	if (usd >= 0.01) return `$${usd.toFixed(3)}`;
	return `$${usd.toFixed(4)}`;
}

export function Composer({
	phase,
	state,
	session,
	disabled,
	resuming,
	textAreaRef,
	draft,
	onDraftBlocked,
	onSend,
	onAbort,
	onCompact,
	onPhase,
	onResume,
	onModel,
	onThinking,
	auth,
}: {
	phase: Phase;
	state: SessionState | undefined;
	/** The open conversation: the pickers under the row read and write it. */
	session: SessionSummary;
	/** omp's login catalog; providers it reports as logged out are not listed. */
	auth: readonly ProviderAuth[];
	disabled: boolean;
	/** A resume is in flight for this conversation. */
	resuming: boolean;
	textAreaRef?: React.RefObject<HTMLTextAreaElement | null>;
	/**
	 * Text to put in one conversation's box from outside (a rewound message).
	 * It is filled in, never sent, and it never replaces words the user typed
	 * themselves. A draft for another conversation is ignored.
	 */
	draft?: { id: number; sessionId: string; text: string } | null;
	/** Called with the draft when the box already had unset text and was left alone. */
	onDraftBlocked?: (text: string) => void;
	onSend: (text: string, images: PromptImage[]) => Promise<void>;
	onAbort: () => Promise<void>;
	/** Summarize this conversation. Disabled while a turn or a compaction is already running. */
	onCompact: () => Promise<void>;
	/** Changes only the phase the next message carries — never sends anything. */
	onPhase: (phase: Phase) => void;
	onResume: () => Promise<void>;
	onModel: (provider: string, id: string) => Promise<void>;
	onThinking: (level: string) => Promise<void>;
}) {
	const picks = usePromptImages(session.id);
	const [busy, setBusy] = useState(false);
	// The box is one per conversation. Switching chats shows that chat's own
	// unsent line, and a line typed here never appears in another window.
	const slots = useRef(createSessionSlots(""));
	const sessionRef = useRef(session.id);
	sessionRef.current = session.id;
	const appliedDraft = useRef(0);
	const onDraftBlockedRef = useRef(onDraftBlocked);
	onDraftBlockedRef.current = onDraftBlocked;
	const [boundId, setBoundId] = useState(session.id);
	const [text, setTextState] = useState("");
	if (session.id !== boundId) {
		setBoundId(session.id);
		setTextState(slots.current.read(session.id));
	}
	const writeText = useCallback((sessionId: string, value: string) => {
		slots.current.write(sessionId, value);
		if (sessionRef.current === sessionId) setTextState(value);
	}, []);
	const streaming = state?.streaming === true;
	const compacting = state?.compacting === true;

	// The menu needs this conversation's own catalog: omp answers per run.
	const [models, setModels] = useState<ModelsInfo["models"]>([]);
	const [thinkingInfo, setThinkingInfo] = useState<ThinkingInfo | null>(null);
	useEffect(() => {
		let cancelled = false;
		let attempt = 0;
		let timer: number | undefined;
		const load = async () => {
			try {
				const data = await api.models(session.id);
				if (cancelled) return;
				setModels(data.models);
				// Provider catalog discovery runs in the background on the server.
				if (data.models.length === 0 && attempt < 8) {
					attempt++;
					timer = window.setTimeout(() => void load(), 1500);
				}
			} catch {
				// keep the previous list
			}
		};
		void load();
		return () => {
			cancelled = true;
			if (timer !== undefined) window.clearTimeout(timer);
		};
	}, [session.id, session.status, session.updatedAt]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const info = await api.thinking(session.id);
				if (!cancelled) setThinkingInfo(info);
			} catch {
				// keep what the session state already reports
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [session.id, session.status, state?.model?.id, state?.model?.provider]);

	/** What the menu shows: this conversation's model and effort, in omp's lists. */
	const shell: ShellSettings = {
		models,
		current: state?.model ?? session.model ?? null,
		levels: thinkingInfo?.levels ?? [],
		thinking: state?.thinkingLevel ?? thinkingInfo?.current ?? null,
	};

	// A rewind fills only the conversation it came from, and only once.
	// Typing, and opening some other chat, must not pull that line across.
	useEffect(() => {
		if (!draft?.text || draft.sessionId !== session.id) return;
		if (appliedDraft.current === draft.id) return;
		appliedDraft.current = draft.id;
		if (slots.current.read(session.id).trim().length > 0) {
			onDraftBlockedRef.current?.(draft.text);
			return;
		}
		writeText(session.id, draft.text);
		textAreaRef?.current?.focus();
	}, [draft, session.id, writeText, textAreaRef]);

	const send = async () => {
		const sessionId = session.id;
		const body = text.trim();
		const images = picks.images;
		if ((!body && images.length === 0) || busy || picks.preparing) return;
		setBusy(true);
		try {
			await onSend(body, images);
			writeText(sessionId, "");
			picks.clear(sessionId);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="composer">
			<div className={`composer-card${picks.dragging ? " dragging" : ""}`} {...picks.dragProps}>
				{disabled ? (
					<div className="composer-ended">
						<span>{resuming ? t("正在恢复这个对话…") : t("这个对话的后台进程已经退出，恢复后才能继续。")}</span>
						<button type="button" className="secondary" disabled={resuming} onClick={() => void onResume()}>
							{resuming ? t("恢复中…") : t("恢复会话")}
						</button>
					</div>
				) : null}
				<AttachmentTray
					images={picks.images}
					preparing={picks.preparing}
					error={picks.error}
					onRemove={picks.removeImage}
				/>
				<textarea
					ref={textAreaRef}
					value={text}
					disabled={disabled}
					placeholder={disabled ? t("会话已结束，先恢复") : t("说你想做什么…")}
					rows={2}
					onChange={event => writeText(session.id, event.target.value)}
					onPaste={picks.onPaste}
					onKeyDown={event => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							void send();
						}
					}}
				/>
				<div className="composer-row">
					<span className="composer-meta">
						{compacting
							? t("正在压缩上下文…")
							: state?.contextUsage
								? t("上下文 {n}%", { n: state.contextUsage.percent.toFixed(0) })
								: ""}
						{typeof state?.costUsd === "number" ? (
							<span title={`${state.totalTokens ?? 0} tokens`}>
								{state.contextUsage ? " · " : ""}{t("已花费 {s}", { s: money(state.costUsd) })}
							</span>
						) : null}
					</span>
					<ShellMenu
						settings={shell}
						auth={auth}
						disabled={!session.alive}
						onChange={patch =>
							patch.model
								? onModel(patch.model.provider, patch.model.id)
								: onThinking(patch.thinking ?? "")
						}
					/>
					<div className="composer-tools">
						<button
							type="button"
							className="composer-compact"
							disabled={disabled || streaming || compacting}
							title={
								streaming
									? t("这一轮还在跑，停下来再压缩")
									: t("把目前的对话压成摘要，腾出上下文")
							}
							onClick={() => void onCompact()}
						>
							{compacting ? t("压缩中…") : t("压缩")}
						</button>
						<AttachmentPicker disabled={disabled || picks.preparing} onFiles={picks.addFiles} />
						<select
							className="phase-select"
							value={phase}
							disabled={disabled}
							title={t("下一条消息使用的阶段")}
							onChange={event => {
								const next = asPhase(event.target.value);
								if (next) onPhase(next);
							}}
						>
							<option value="plan">{t("规划")}</option>
							<option value="deepplan">{t("深规划")}</option>
							<option value="build">{t("执行")}</option>
							<option value="chat">{t("聊天")}</option>
						</select>
						{streaming ? (
							<button type="button" className="danger" onClick={() => void onAbort()}>
								{t("停止")}
							</button>
						) : (
							<button
								type="button"
								className="primary"
								disabled={disabled || busy || picks.preparing || (!text.trim() && picks.images.length === 0)}
								onClick={() => void send()}
							>
								{t("发送")}
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
