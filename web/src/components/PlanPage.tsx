import type { AgentMessage, Phase, TodoPhase } from "../../../shared/protocol.ts";
import { isPlanPhase, toolCallLine, toolCallsOf, userText } from "../adapters.ts";
import { t } from "../i18n.ts";
import { Markdown } from "../markdown.tsx";

const STATUS_MARK: Record<string, string> = {
	completed: "✓",
	in_progress: "◐",
	blocked: "✕",
	pending: "○",
};

/** Same words the composer's picker uses, so the chip and the picker never disagree. */
const PHASE_LABEL: Record<Phase, string> = { plan: "规划", deepplan: "深规划", build: "执行", chat: "聊天" };

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
				<span className="plan-user-label">{t("你")}</span>
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
 * The line under the buttons: what this phase asks of the user next. Both
 * planning phases get the approval hint, but only once the plan actually exists.
 */
function planHint(phase: Phase, canApprove: boolean): string {
	if (phase === "build") return t("已经在执行阶段。切回「规划」只影响下一条消息。");
	if (phase === "chat") return t("聊天阶段只回答问题，不改文件、不跑命令；需要动手时切到「执行」。");
	if (phase === "deepplan") {
		return canApprove
			? t("确认没有开放的问题后，点「按这个做」进执行阶段。")
			: t("回答这一轮的问题；问题问完，助手才会写计划。");
	}
	return canApprove
		? t("「按这个做」会切到执行阶段；写文件自动进行，跑命令仍会问你。")
		: t("等助手写出计划后才能批准。");
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
		<div className="rail-body rail-body-plan">
			<div className="rail-subhead">
				<span className={`sub-chip phase-${phase}`}>{t(PHASE_LABEL[phase])}</span>
				<span className="sub-meta">{total > 0 ? t("待办 {a}/{b}", { a: done, b: total }) : t("还没有待办")}</span>
				{total > 0 ? (
					<span className="rail-progress" aria-hidden>
						<i style={{ width: `${Math.round((done / total) * 100)}%` }} />
					</span>
				) : null}
			</div>
			<div className="rail-scroll">
				<div className="plan-body">
					{segment.length === 0 ? (
						<p className="rail-empty">{t("还没有规划内容。在下方输入框把阶段切到「规划」再提问。")}</p>
					) : (
						segment
							.filter(message => message.role === "user" || message.role === "assistant")
							.map((message, index) => <PlanMessage key={index} message={message} />)
					)}
				</div>

				{total > 0 ? <TodoList todos={todos} /> : null}
			</div>

			<div className="plan-foot">
				{isPlanPhase(phase) ? (
					<div className="plan-actions">
						<button
							type="button"
							className="primary"
							disabled={!canApprove}
							title={canApprove ? t("切到执行阶段，按这份计划动手") : t("等助手写出计划后才能批准")}
							onClick={onApprove}
						>
							{t("按这个做")}
						</button>
						<button type="button" className="secondary" onClick={onRevise}>
							{t("再改一改")}
						</button>
					</div>
				) : (
					<div className="plan-actions">
						<button type="button" className="secondary" onClick={onRevise}>
							{t("改成别的")}
						</button>
					</div>
				)}
				<p className="plan-hint">{planHint(phase, canApprove)}</p>
			</div>
		</div>
	);
}
