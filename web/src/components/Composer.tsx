import { useState } from "react";
import type { Phase, SessionState } from "../../../shared/protocol.ts";

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
	textAreaRef,
	onSend,
	onAbort,
	onPhase,
}: {
	phase: Phase;
	state: SessionState | undefined;
	disabled: boolean;
	textAreaRef?: React.RefObject<HTMLTextAreaElement | null>;
	onSend: (text: string) => Promise<void>;
	onAbort: () => Promise<void>;
	/** Changes only the phase the next message carries — never sends anything. */
	onPhase: (phase: Phase) => void;
}) {
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const streaming = state?.streaming === true;

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
				<textarea
					ref={textAreaRef}
					value={text}
					disabled={disabled}
					placeholder={disabled ? "会话已结束，先恢复" : "说你想做什么…"}
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
						{state?.contextUsage ? `上下文 ${state.contextUsage.percent.toFixed(0)}%` : ""}
						{typeof state?.costUsd === "number" ? (
							<span title={`${state.totalTokens ?? 0} tokens`}>
								{state.contextUsage ? " · " : ""}已花费 {money(state.costUsd)}
							</span>
						) : null}
					</span>
					<div className="composer-tools">
						<select
							className="phase-select"
							value={phase}
							disabled={disabled}
							title="下一条消息使用的阶段"
							onChange={event => {
								const value = event.target.value;
								onPhase(value === "build" ? "build" : value === "chat" ? "chat" : "plan");
							}}
						>
							<option value="plan">规划</option>
							<option value="build">执行</option>
							<option value="chat">聊天</option>
						</select>
						{streaming ? (
							<button type="button" className="danger" onClick={() => void onAbort()}>
								停止
							</button>
						) : (
							<button
								type="button"
								className="primary"
								disabled={disabled || busy || !text.trim()}
								onClick={() => void send()}
							>
								发送
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
