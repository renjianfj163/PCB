import { useState } from "react";
import type { AgentMessage, SessionState } from "../../../shared/protocol.ts";
import { imageSources, mergePending, phaseOf, promptImageSrc, userEntryId, userText } from "../adapters.ts";
import { t } from "../i18n.ts";
import { toolLabel } from "../labels.ts";
import { Markdown } from "../markdown.tsx";
import type { PendingUser, ToolActivity } from "../state.ts";

/** The chip in front of a user message: which phase it was sent in. */
const PHASE_LABEL = { plan: "规划", build: "执行", chat: "聊天" } as const;

function argsSummary(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const record = args as Record<string, unknown>;
	if (typeof record.command === "string") return record.command;
	if (typeof record.path === "string") return record.path;
	if (typeof record.i === "string") return record.i;
	if (typeof record.query === "string") return record.query;
	if (typeof record.task === "string") return record.task.slice(0, 120);
	return "";
}

function textBlocks(message: AgentMessage): string[] {
	if (!Array.isArray(message.content)) return [];
	return message.content
		.map(block => {
			if (!block || typeof block !== "object") return "";
			const type = "type" in block ? block.type : undefined;
			const text = "text" in block ? block.text : undefined;
			return type === "text" && typeof text === "string" ? text : "";
		})
		.filter(Boolean);
}

function toolCalls(message: AgentMessage): Array<{ id: string; name: string; args: unknown }> {
	if (!Array.isArray(message.content)) return [];
	const calls: Array<{ id: string; name: string; args: unknown }> = [];
	for (const block of message.content) {
		if (!block || typeof block !== "object") continue;
		if (!("type" in block) || block.type !== "toolCall") continue;
		const id = "id" in block && typeof block.id === "string" ? block.id : "";
		const name = "name" in block && typeof block.name === "string" ? block.name : "tool";
		const args = "arguments" in block ? block.arguments : undefined;
		if (id) calls.push({ id, name, args });
	}
	return calls;
}

export function ToolCard({ tool }: { tool: ToolActivity }) {
	const [open, setOpen] = useState(false);
	const summary = argsSummary(tool.args);
	const output = tool.output.trim();
	return (
		<div className={`tool-card tool-${tool.status}`}>
			<button type="button" className="tool-head" onClick={() => setOpen(value => !value)}>
				<span className="tool-state" aria-hidden>
					{tool.status === "running" ? "◌" : tool.status === "error" ? "✕" : "✓"}
				</span>
				<span className="tool-label">{toolLabel(tool.name)}</span>
				{summary ? <code className="tool-arg">{summary.length > 120 ? `${summary.slice(0, 120)}…` : summary}</code> : null}
				{output ? <span className="tool-more">{open ? t("收起") : t("输出")}</span> : null}
			</button>
			{open && output ? <pre className="tool-output">{output.length > 6000 ? `${output.slice(0, 6000)}\n…` : output}</pre> : null}
		</div>
	);
}

function AssistantMessage({
	message,
	tools,
	streaming,
}: {
	message: AgentMessage;
	tools: Record<string, ToolActivity>;
	streaming: boolean;
}) {
	const calls = toolCalls(message);
	const texts = textBlocks(message);
	const thinking = Array.isArray(message.content)
		? message.content
				.map(block => {
					if (!block || typeof block !== "object") return "";
					const type = "type" in block ? block.type : undefined;
					const text = "thinking" in block ? block.text : undefined;
					return type === "thinking" && typeof text === "string" ? text : "";
				})
				.filter(Boolean)
		: [];

	return (
		<div className={`message assistant${streaming ? " streaming" : ""}`}>
			<div className="message-role">
				{t("助手")}
				{streaming ? (
					<>
						<span className="typing-label">{` · ${t("输入中")}`}</span>
						<span className="typing-dots" aria-hidden="true">
							<i />
							<i />
							<i />
						</span>
					</>
				) : null}
			</div>
			{thinking.length > 0 ? (
				<details className="thinking">
					<summary>{t("思考过程")}</summary>
					<pre>{thinking.join("\n\n")}</pre>
				</details>
			) : null}
			{texts.length > 0 ? texts.map((text, index) => <Markdown key={index} text={text} />) : null}
			{calls.map(call => {
				const activity = tools[call.id] ?? { name: call.name, args: call.args, output: "", status: "running" as const };
				return <ToolCard key={call.id} tool={activity} />;
			})}
		</div>
	);
}

export function Transcript({
	messages,
	turn,
	live,
	pending,
	tools,
	state,
	sessionAlive,
	hasHistory,
	canRewind = false,
	onRewind,
}: {
	messages: AgentMessage[];
	turn: AgentMessage[];
	live: AgentMessage | null;
	pending: PendingUser[];
	tools: Record<string, ToolActivity>;
	state: SessionState | undefined;
	sessionAlive: boolean;
	/** The session file exists, so omp will replay a transcript. */
	hasHistory?: boolean;
	/** The process is alive and no turn is running: a rewind may be attempted. */
	canRewind?: boolean;
	onRewind?: (entryId: string) => void;
}) {
	// One row asks for confirmation at a time; the id is the row's session entry.
	const [confirming, setConfirming] = useState<string | null>(null);
	const seenToolCalls = new Set<string>();
	// Tool results from history give finished cards their output; live frames win.
	const callsById = new Map<string, { id: string; name: string; args: unknown }>();
	const resolved: Record<string, ToolActivity> = {};
	const all = [...messages, ...turn];
	const rows = mergePending(all, pending);
	for (const message of all) {
		for (const call of toolCalls(message)) {
			seenToolCalls.add(call.id);
			callsById.set(call.id, call);
		}
	}
	for (const message of all) {
		if (message.role !== "toolResult") continue;
		const callId = "toolCallId" in message && typeof message.toolCallId === "string" ? message.toolCallId : "";
		if (!callId) continue;
		const name = "toolName" in message && typeof message.toolName === "string" ? message.toolName : "tool";
		resolved[callId] = {
			name,
			args: callsById.get(callId)?.args,
			output: textBlocks(message).join("\n"),
			status: message.isError === true ? "error" : "done",
		};
	}
	for (const [id, activity] of Object.entries(tools)) resolved[id] = activity;

	return (
		<div className="transcript">
			{rows.map((row, index) => {
				if (row.kind === "pending") {
					return (
						<div className="message user" key={`pending-${index}`}>
							<div className="message-role">{t("你")}</div>
							{row.entry.images && row.entry.images.length > 0 ? (
								<div className="user-images">
									{row.entry.images.map((image, at) => (
										<img key={at} src={promptImageSrc(image)} alt={t("图片")} />
									))}
								</div>
							) : null}
							{row.entry.text ? <div className="user-text">{row.entry.text}</div> : null}
						</div>
					);
				}
				const message = row.message;
				if (message.role === "user") {
					const body = userText(message);
					const phase = phaseOf(message);
					const entryId = userEntryId(message);
					const pictures = imageSources(message);
					return (
						<div className="message user" key={index}>
							<div className="message-role">
								{t("你")}
								{phase ? <span className="phase-chip">{t(PHASE_LABEL[phase])}</span> : null}
							</div>
							{pictures.length > 0 ? (
								<div className="user-images">
									{pictures.map((src, at) => (
										<img key={at} src={src} alt={t("图片")} />
									))}
								</div>
							) : null}
							{body.trim() || entryId ? (
								// The button rides the end of the last line: the text keeps the width,
								// the control sits on its right at the same baseline.
								<div className="user-body">
									{body.trim() ? <div className="user-text">{body}</div> : null}
									{entryId ? (
										<button
											type="button"
											className="rewind-btn"
											disabled={!canRewind}
											title={t("回到这句之前")}
											onClick={() => setConfirming(current => (current === entryId ? null : entryId))}
										>
											<span className="rewind-icon" aria-hidden="true">
												↩
											</span>
											{t("回到这句之前")}
										</button>
									) : null}
								</div>
							) : null}
							{entryId && confirming === entryId ? (
								<div className="rewind-confirm">
									<p>{t("回到这句之前？这句和后面的对话会离开当前路径，文件不会改。")}</p>
									<div className="rewind-actions">
										<button
											type="button"
											className="secondary"
											onClick={() => {
												setConfirming(null);
												onRewind?.(entryId);
											}}
										>
											{t("确认")}
										</button>
										<button type="button" className="ghost" onClick={() => setConfirming(null)}>
											{t("取消")}
										</button>
									</div>
								</div>
							) : null}
						</div>
					);
				}
				if (message.role === "assistant") {
					return <AssistantMessage key={index} message={message} tools={resolved} streaming={false} />;
				}
				if (message.role === "toolResult") {
					const callId = "toolCallId" in message && typeof message.toolCallId === "string" ? message.toolCallId : "";
					if (callId && seenToolCalls.has(callId)) return null;
					const text = textBlocks(message).join("\n");
					if (!text.trim()) return null;
					return (
						<div className="message tool-result" key={index}>
							<div className="message-role">{t("工具输出")}</div>
							<pre>{text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text}</pre>
						</div>
					);
				}
				return null;
			})}

			{live ? <AssistantMessage message={live} tools={resolved} streaming /> : null}

			{all.length === 0 && !live && pending.length === 0 ? (
				<div className="empty-state">
					<h2>
						{sessionAlive
							? hasHistory || (state && state.messageCount > 0)
								? t("正在载入这段对话…")
								: t("说一句话开始")
							: t("这个会话已经结束")}
					</h2>
					<p>
						{sessionAlive
							? hasHistory || (state && state.messageCount > 0)
								? t("omp 正在回放历史，稍等一下。")
								: state?.todos.length
									? t("计划列在右侧。批准之前，助手只会读，不会改。")
									: t("先描述你想做的事，助手会先给出计划，你同意之后它才动手。")
							: t("点下面的「恢复会话」接着聊。")}
					</p>
				</div>
			) : null}
		</div>
	);
}
