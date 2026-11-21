import { useState } from "react";
import type { DialogAnswer, DialogRequest } from "../../../shared/protocol.ts";
import { approvalChoiceLabel, isDenyOption, splitApprovalTitle, toolLabel } from "../labels.ts";
import { t } from "../i18n.ts";

function AskCard({ request, onAnswer }: { request: Extract<DialogRequest, { kind: "ask" }>; onAnswer: (answer: DialogAnswer) => void }) {
	const [selected, setSelected] = useState<Record<string, string[]>>({});
	const [custom, setCustom] = useState<Record<string, string>>({});

	const toggle = (questionId: string, option: string, multi: boolean) => {
		setSelected(previous => {
			const current = previous[questionId] ?? [];
			if (!multi) return { ...previous, [questionId]: [option] };
			return {
				...previous,
				[questionId]: current.includes(option) ? current.filter(item => item !== option) : [...current, option],
			};
		});
	};

	return (
		<div className="dialog-card">
			<header>
				<h2>{t("助手需要你的选择")}</h2>
			</header>
			{request.questions.map(question => {
				const current = selected[question.id] ?? [];
				return (
					<section key={question.id} className="ask-question">
						{question.header ? <div className="ask-header">{question.header}</div> : null}
						<p className="ask-prompt">{question.question}</p>
						<div className="ask-options">
							{question.options.map(option => (
								<label key={option.label} className={`ask-option${current.includes(option.label) ? " chosen" : ""}`}>
									<input
										type={question.multi ? "checkbox" : "radio"}
										name={`q-${question.id}`}
										checked={current.includes(option.label)}
										onChange={() => toggle(question.id, option.label, question.multi === true)}
									/>
									<span>
										<strong>{option.label}</strong>
										{option.description ? <em>{option.description}</em> : null}
									</span>
								</label>
							))}
						</div>
						<input
							className="ask-custom"
							placeholder={t("或者直接写你的答案")}
							value={custom[question.id] ?? ""}
							onChange={event => setCustom({ ...custom, [question.id]: event.target.value })}
						/>
					</section>
				);
			})}
			<footer>
				<button
					type="button"
					className="primary"
					onClick={() =>
						onAnswer({
							answers: request.questions.map(question => ({
								id: question.id,
								selectedOptions: selected[question.id] ?? [],
								customInput: (custom[question.id] ?? "").trim() || undefined,
							})),
						})
					}
				>
					{t("提交")}
				</button>
				<button type="button" className="ghost" onClick={() => onAnswer({ cancelled: true })}>
					{t("跳过")}
				</button>
			</footer>
		</div>
	);
}

function ApprovalCard({
	request,
	onAnswer,
}: {
	request: Extract<DialogRequest, { kind: "approval" }>;
	onAnswer: (answer: DialogAnswer) => void;
}) {
	const { tool, detail } = splitApprovalTitle(request.title);
	return (
		<div className="dialog-card approval">
			<header>
				<h2>{t("需要你确认：{s}", { s: toolLabel(tool) })}</h2>
			</header>
			<pre className="dialog-body">{detail || request.title}</pre>
			<footer>
				{request.options.map(option => (
					<button
						key={option}
						type="button"
						className={isDenyOption(option) ? "ghost" : option === "Approve" ? "primary" : "secondary"}
						title={option}
						onClick={() => onAnswer({ value: option })}
					>
						{approvalChoiceLabel(option)}
					</button>
				))}
			</footer>
		</div>
	);
}

function SimpleCard({ request, onAnswer }: { request: DialogRequest; onAnswer: (answer: DialogAnswer) => void }) {
	const [text, setText] = useState("");
	if (request.kind === "confirm") {
		return (
			<div className="dialog-card">
				<header>
					<h2>{request.title || t("确认")}</h2>
				</header>
				<p className="dialog-body-text">{request.message}</p>
				<footer>
					<button type="button" className="primary" onClick={() => onAnswer({ confirmed: true })}>
						{t("同意")}
					</button>
					<button type="button" className="ghost" onClick={() => onAnswer({ confirmed: false })}>
						{t("不同意")}
					</button>
				</footer>
			</div>
		);
	}
	if (request.kind === "input" || request.kind === "editor") {
		return (
			<div className="dialog-card">
				<header>
					<h2>{request.title || t("请输入")}</h2>
				</header>
				<input
					className="dialog-input"
					type={request.kind === "input" && request.secret ? "password" : "text"}
					placeholder={request.kind === "input" ? (request.placeholder ?? "") : ""}
					value={text}
					onChange={event => setText(event.target.value)}
				/>
				<footer>
					<button type="button" className="primary" onClick={() => onAnswer({ value: text })}>
						{t("确定")}
					</button>
					<button type="button" className="ghost" onClick={() => onAnswer({ cancelled: true })}>
						{t("取消")}
					</button>
				</footer>
			</div>
		);
	}
	return null;
}

function QuestionCard({
	request,
	onAnswer,
}: {
	request: Extract<DialogRequest, { kind: "question" }>;
	onAnswer: (answer: DialogAnswer) => void;
}) {
	// omp walks an RPC host one select per answer, so every row here is a one-shot answer:
	// clicking it answers, omp then re-asks a checkbox group with its new "(N selected)" count.
	// The answer must be one of the option labels — omp drops anything else and re-asks, which
	// is why this card has no free-text field of its own ("Other (type your own)" is an option
	// row, and picking it makes omp ask for the text with a separate input prompt).
	return (
		<div className="dialog-card">
			<header>
				<h2>{request.title.split("\n")[0]}</h2>
			</header>
			{request.title.includes("\n") ? (
				<pre className="dialog-body">{request.title.split("\n").slice(1).join("\n").trim()}</pre>
			) : null}
			<div className="ask-options">
				{request.options.map(option => (
					<button key={option} type="button" className="ask-option" onClick={() => onAnswer({ value: option })}>
						{option}
					</button>
				))}
			</div>
			<footer>
				<button type="button" className="ghost" onClick={() => onAnswer({ cancelled: true })}>
					{t("跳过")}
				</button>
			</footer>
		</div>
	);
}

export function DialogLayer({
	requests,
	onAnswer,
}: {
	requests: DialogRequest[];
	onAnswer: (id: string, answer: DialogAnswer) => void;
}) {
	if (requests.length === 0) return null;
	const request = requests[0];
	if (!request) return null;
	const answer = (value: DialogAnswer) => onAnswer(request.id, value);

	return (
		<div className="dialog-overlay">
			{request.kind === "approval" ? (
				<ApprovalCard request={request} onAnswer={answer} />
			) : request.kind === "ask" ? (
				<AskCard request={request} onAnswer={answer} />
			) : request.kind === "question" ? (
				<QuestionCard request={request} onAnswer={answer} />
			) : (
				<SimpleCard request={request} onAnswer={answer} />
			)}
			{requests.length > 1 ? <div className="dialog-queue">{t("还有 {n} 个待处理", { n: requests.length - 1 })}</div> : null}
		</div>
	);
}
