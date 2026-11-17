import { useState } from "react";
import type { DialogAnswer, DialogRequest } from "../../../shared/protocol.ts";
import { approvalChoiceLabel, isDenyOption, splitApprovalTitle, TOOL_LABELS } from "../labels.ts";

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
				<h2>助手需要你的选择</h2>
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
							placeholder="或者直接写你的答案"
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
					提交
				</button>
				<button type="button" className="ghost" onClick={() => onAnswer({ cancelled: true })}>
					跳过
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
				<h2>需要你确认：{TOOL_LABELS[tool] ?? tool}</h2>
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
					<h2>{request.title || "确认"}</h2>
				</header>
				<p className="dialog-body-text">{request.message}</p>
				<footer>
					<button type="button" className="primary" onClick={() => onAnswer({ confirmed: true })}>
						同意
					</button>
					<button type="button" className="ghost" onClick={() => onAnswer({ confirmed: false })}>
						不同意
					</button>
				</footer>
			</div>
		);
	}
	if (request.kind === "input" || request.kind === "editor") {
		return (
			<div className="dialog-card">
				<header>
					<h2>{request.title || "请输入"}</h2>
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
						确定
					</button>
					<button type="button" className="ghost" onClick={() => onAnswer({ cancelled: true })}>
						取消
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
	const [choice, setChoice] = useState<string>("");
	const [custom, setCustom] = useState("");
	// Single-question asks arrive as a select menu with an "Other" escape hatch.
	const options = request.options.filter(option => !/^Other\b/i.test(option));
	const otherLabel = request.options.find(option => /^Other\b/i.test(option));

	return (
		<div className="dialog-card">
			<header>
				<h2>{request.title.split("\n")[0]}</h2>
			</header>
			{request.title.includes("\n") ? (
				<pre className="dialog-body">{request.title.split("\n").slice(1).join("\n").trim()}</pre>
			) : null}
			<div className="ask-options">
				{options.map(option => (
					<label key={option} className={`ask-option${choice === option ? " chosen" : ""}`}>
						<input type="radio" name={`q-${request.id}`} checked={choice === option} onChange={() => setChoice(option)} />
						<span>
							<strong>{option}</strong>
						</span>
					</label>
				))}
				{otherLabel !== undefined || options.length === 0 ? (
					<input
						className="ask-custom"
						placeholder={otherLabel ?? "自己写一个答案"}
						value={custom}
						onChange={event => setCustom(event.target.value)}
					/>
				) : null}
			</div>
			<footer>
				<button
					type="button"
					className="primary"
					onClick={() => {
						const text = custom.trim();
						if (text) onAnswer({ value: text });
						else if (choice) onAnswer({ value: choice });
					}}
				>
					提交
				</button>
				<button type="button" className="ghost" onClick={() => onAnswer({ cancelled: true })}>
					跳过
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
			{requests.length > 1 ? <div className="dialog-queue">还有 {requests.length - 1} 个待处理</div> : null}
		</div>
	);
}
