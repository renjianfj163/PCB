import type { AgentMessage, Phase, TodoPhase } from "../../../shared/protocol.ts";
import { toolCallLine, toolCallsOf, userText } from "../adapters.ts";
import { Markdown } from "../markdown.tsx";

const STATUS_MARK: Record<string, string> = {
	completed: "✓",
	in_progress: "◐",
	blocked: "✕",
	pending: "○",
};

function TodoList({ todos }: { todos: TodoPhase[] }) {
	return (
		<div className="plan-todos">
			{todos.map(group => (
				<section key={group.name} className="plan-group">
					<h3>{group.name}</h3>
					<ul>
						{group.tasks.map((task, index) => (
							<li key={`${task.content}-${index}`} className={`task task-${task.status}`}>
								<span className="task-mark" aria-hidden>
									{STATUS_MARK[task.status] ?? "○"}
								</span>
								<span>{task.content}</span>
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}

/** One message of the planning stretch: the reply in prose, its tool calls as one-liners. */
function PlanMessage({ message }: { message: AgentMessage }) {
	if (message.role === "user") {
		return (
			<div className="plan-user">
				<span className="plan-user-label">你</span>
				<div className="plan-user-text">{userText(message)}</div>
			</div>
		);
	}
	const texts = Array.isArray(message.content)
		? message.content
				.map(block => {
					if (!block || typeof block !== "object") return "";
					const type = "type" in block ? block.type : undefined;
					const text = "text" in block ? block.text : undefined;
					return type === "text" && typeof text === "string" ? text : "";
				})
				.filter(Boolean)
		: [];
	const calls = toolCallsOf([message]);

	return (
		<div className="plan-assistant">
			{texts.map((text, index) => (
				<Markdown key={index} text={text} />
			))}
			{calls.length > 0 ? (
				<div className="plan-tools">
					{calls.map(call => (
						<span key={call.id} className="plan-tool" title={toolCallLine(call.name, call.args)}>
							{toolCallLine(call.name, call.args)}
						</span>
					))}
				</div>
			) : null}
		</div>
	);
}

/**
 * The planning stretch of this conversation, read as one piece: the request, the
 * reasoning and the tool calls (compressed), then the todos and the two ways on.
 */
export function PlanPage({
	phase,
	todos,
	segment,
	canApprove,
	onApprove,
	onRevise,
}: {
	phase: Phase;
	todos: TodoPhase[];
	segment: AgentMessage[];
	canApprove: boolean;
	onApprove: () => void;
	onRevise: () => void;
}) {
	const total = todos.reduce((sum, group) => sum + group.tasks.length, 0);
	const done = todos.reduce(
		(sum, group) => sum + group.tasks.filter(task => task.status === "completed").length,
		0,
	);

	return (
		<div className="rail-body">
			<div className="rail-section-head">
				<h2>计划</h2>
				{total > 0 ? (
					<span className="plan-count">
						{done}/{total}
					</span>
				) : null}
			</div>

			<div className="plan-body">
				{segment.length === 0 ? (
					<p className="plan-empty">还没有规划内容。在下方输入框把阶段切到「规划」再提问。</p>
				) : (
					segment
						.filter(message => message.role === "user" || message.role === "assistant")
						.map((message, index) => <PlanMessage key={index} message={message} />)
				)}
			</div>

			{total > 0 ? <TodoList todos={todos} /> : null}

			<div className="plan-actions">
				<button type="button" className="primary" disabled={!canApprove} onClick={onApprove}>
					按这个做
				</button>
				<button type="button" className="secondary" onClick={onRevise}>
					再改一改
				</button>
			</div>
			<p className="plan-hint">
				{phase === "build"
					? "已经在执行阶段。切回「规划」只影响下一条消息。"
					: phase === "chat"
						? "聊天阶段只回答问题，不改文件、不跑命令；需要动手时切到「执行」。"
						: canApprove
							? "「按这个做」会切到执行阶段；写文件自动进行，跑命令仍会问你。"
							: "等助手写出计划后才能批准。"}
			</p>
		</div>
	);
}
