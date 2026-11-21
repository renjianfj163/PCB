import { useEffect, useRef, useState } from "react";
import {
	PROMPT_IMAGE_MAX_COUNT,
	PROMPT_IMAGE_MAX_TOTAL_BASE64,
	type Phase,
	type PromptImage,
	type SessionState,
} from "../../../shared/protocol.ts";
import { promptImageSrc } from "../adapters.ts";
import { preparePromptImage } from "../attach.ts";
import { t } from "../i18n.ts";

/** Small amounts need the extra digits to move at all. */
function money(usd: number): string {
	if (usd >= 1) return `$${usd.toFixed(2)}`;
	if (usd >= 0.01) return `$${usd.toFixed(3)}`;
	return `$${usd.toFixed(4)}`;
}

export function Composer({
	phase,
	state,
	disabled,
	resuming,
	textAreaRef,
	draft,
	onDraftBlocked,
	onSend,
	onAbort,
	onPhase,
	onResume,
}: {
	phase: Phase;
	state: SessionState | undefined;
	disabled: boolean;
	/** A resume is in flight for this conversation. */
	resuming: boolean;
	textAreaRef?: React.RefObject<HTMLTextAreaElement | null>;
	/**
	 * Text to put in the box from outside (a rewound message). It is filled in,
	 * never sent, and it never replaces words the user typed themselves.
	 */
	draft?: { id: number; text: string } | null;
	/** Called with the draft when the box already had unset text and was left alone. */
	onDraftBlocked?: (text: string) => void;
	onSend: (text: string, images: PromptImage[]) => Promise<void>;
	onAbort: () => Promise<void>;
	/** Changes only the phase the next message carries — never sends anything. */
	onPhase: (phase: Phase) => void;
	onResume: () => Promise<void>;
}) {
	const [text, setText] = useState("");
	const [images, setImages] = useState<PromptImage[]>([]);
	const [preparing, setPreparing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const [busy, setBusy] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const streaming = state?.streaming === true;
	const draftId = draft?.id ?? 0;

	// A new draft arrives: fill an empty box, otherwise hand it back untouched.
	useEffect(() => {
		if (!draft?.text) return;
		if (text.trim().length > 0) {
			onDraftBlocked?.(draft.text);
			return;
		}
		setText(draft.text);
		textAreaRef?.current?.focus();
		// Only a new draft (its id) may write here; typing is not a trigger.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [draftId]);

	/** Paste, drop and the picker all end up here. */
	const addFiles = async (files: File[]) => {
		const room = PROMPT_IMAGE_MAX_COUNT - images.length;
		if (files.length > room) setError(t("一条消息最多 4 张图片"));
		if (room <= 0) return;
		setPreparing(true);
		const added: PromptImage[] = [];
		let used = images.reduce((total, image) => total + image.data.length, 0);
		try {
			for (const file of files.slice(0, room)) {
				try {
					const image = await preparePromptImage(file);
					if (used + image.data.length > PROMPT_IMAGE_MAX_TOTAL_BASE64) {
						setError(t("图片太大，发不出去"));
						break;
					}
					used += image.data.length;
					added.push(image);
				} catch (thrown) {
					setError(t((thrown as Error).message));
				}
			}
		} finally {
			if (added.length > 0) setImages(current => [...current, ...added]);
			setPreparing(false);
		}
	};

	const send = async () => {
		const body = text.trim();
		if ((!body && images.length === 0) || busy || preparing) return;
		setBusy(true);
		try {
			await onSend(body, images);
			setText("");
			setImages([]);
			setError(null);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="composer">
			<div
				className={`composer-card${dragging ? " dragging" : ""}`}
				onDragOver={event => {
					if (!event.dataTransfer.types.includes("Files")) return;
					event.preventDefault();
					setDragging(true);
				}}
				onDragLeave={event => {
					if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
					setDragging(false);
				}}
				onDrop={event => {
					event.preventDefault();
					setDragging(false);
					void addFiles(Array.from(event.dataTransfer.files));
				}}
			>
				{disabled ? (
					<div className="composer-ended">
						<span>{resuming ? t("正在恢复这个对话…") : t("这个对话的后台进程已经退出，恢复后才能继续。")}</span>
						<button type="button" className="secondary" disabled={resuming} onClick={() => void onResume()}>
							{resuming ? t("恢复中…") : t("恢复会话")}
						</button>
					</div>
				) : null}
				{images.length > 0 || preparing ? (
					<div className="composer-attachments">
						{images.map((image, index) => (
							<div className="attachment" key={index}>
								<img src={promptImageSrc(image)} alt={t("图片")} />
								<button
									type="button"
									className="attachment-remove"
									title={t("移除这张图片")}
									aria-label={t("移除这张图片")}
									onClick={() => setImages(current => current.filter((_, at) => at !== index))}
								>
									×
								</button>
							</div>
						))}
						{preparing ? <span className="composer-hint">{t("正在处理图片…")}</span> : null}
					</div>
				) : null}
				{error ? <div className="composer-error">{error}</div> : null}
				<textarea
					ref={textAreaRef}
					value={text}
					disabled={disabled}
					placeholder={disabled ? t("会话已结束，先恢复") : t("说你想做什么…")}
					rows={2}
					onChange={event => setText(event.target.value)}
					onPaste={event => {
						const files: File[] = [];
						for (const item of Array.from(event.clipboardData.items)) {
							if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
							const file = item.getAsFile();
							if (file) files.push(file);
						}
						// Plain text pastes keep the browser's own behaviour.
						if (files.length === 0) return;
						event.preventDefault();
						void addFiles(files);
					}}
					onKeyDown={event => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							void send();
						}
					}}
				/>
				<div className="composer-row">
					<span className="composer-meta">
						{state?.contextUsage ? t("上下文 {n}%", { n: state.contextUsage.percent.toFixed(0) }) : ""}
						{typeof state?.costUsd === "number" ? (
							<span title={`${state.totalTokens ?? 0} tokens`}>
								{state.contextUsage ? " · " : ""}{t("已花费 {s}", { s: money(state.costUsd) })}
							</span>
						) : null}
					</span>
					<div className="composer-tools">
						<input
							ref={fileInput}
							type="file"
							accept="image/png,image/jpeg,image/webp"
							multiple
							hidden
							onChange={event => {
								const picked = Array.from(event.target.files ?? []);
								// Same file twice in a row still fires a change event.
								event.target.value = "";
								void addFiles(picked);
							}}
						/>
						<button
							type="button"
							className="ghost composer-attach"
							disabled={disabled || preparing}
							title={t("图片")}
							onClick={() => fileInput.current?.click()}
						>
							{t("图片")}
						</button>
						<select
							className="phase-select"
							value={phase}
							disabled={disabled}
							title={t("下一条消息使用的阶段")}
							onChange={event => {
								const value = event.target.value;
								onPhase(value === "build" ? "build" : value === "chat" ? "chat" : "plan");
							}}
						>
							<option value="plan">{t("规划")}</option>
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
								disabled={disabled || busy || preparing || (!text.trim() && images.length === 0)}
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
