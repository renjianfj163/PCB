import { useEffect, useState } from "react";
import type { Phase, SessionState } from "../../../shared/protocol.ts";
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
	onSend: (text: string) => Promise<void>;
	/**
	 * Text to put in the box from outside (a rewound message). It is filled in,
	 * never sent, and it never replaces words the user typed themselves.
	 */
	draft?: { id: number; text: string } | null;
	/** Called with the draft when the box already had unset text and was left alone. */
	onDraftBlocked?: (text: string) => void;
	onAbort: () => Promise<void>;
	/** Changes only the phase the next message carries — never sends anything. */
	onPhase: (phase: Phase) => void;
	onResume: () => Promise<void>;
}) {
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
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

	const send = async () => {
		const body = text.trim();
		if (!body || busy) return;
		setBusy(true);
		try {
			await onSend(body);
			setText("");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="composer">
			<div className="composer-card">
				{disabled ? (
					<div className="composer-ended">
						<span>{resuming ? t("正在恢复这个对话…") : t("这个对话的后台进程已经退出，恢复后才能继续。")}</span>
						<button type="button" className="secondary" disabled={resuming} onClick={() => void onResume()}>
							{resuming ? t("恢复中…") : t("恢复会话")}
						</button>
					</div>
				) : null}
				<textarea
					ref={textAreaRef}
					value={text}
					disabled={disabled}
					placeholder={disabled ? t("会话已结束，先恢复") : t("说你想做什么…")}
					rows={2}
					onChange={event => setText(event.target.value)}
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
								disabled={disabled || busy || !text.trim()}
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
