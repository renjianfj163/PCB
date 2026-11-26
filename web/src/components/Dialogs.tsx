import { useEffect, useMemo, useRef, useState } from "react";
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

const FORM_VARS = [
	"--bg-panel",
	"--bg-col",
	"--bg-sunken",
	"--border",
	"--border-strong",
	"--fg",
	"--muted",
	"--dim",
	"--hover",
	"--accent",
	"--accent-fg",
];

/**
 * The form HTML comes from the model, so it never touches the app's DOM: a stray
 * `<style>` would repaint the shell and an `onerror` handler would run with the
 * app's origin. It lives in a sandboxed frame (opaque origin) that reports back
 * what the user filled in. The bridge comes first, so an unclosed tag in the
 * model's HTML cannot swallow it.
 */
function formDocument(html: string): string {
	const computed = getComputedStyle(document.documentElement);
	const vars = FORM_VARS.map(name => {
		const value = computed.getPropertyValue(name).trim();
		return value ? `${name}:${value};` : "";
	}).join("");
	return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
:root{${vars}}
html,body{background:transparent;margin:0;color:var(--fg);font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",system-ui,sans-serif}
form{margin:0;display:flex;flex-direction:column;gap:12px}
fieldset{margin:0;border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
legend{padding:0 4px;color:var(--muted);font-size:12px}
p{margin:0}
label{display:flex;gap:8px;align-items:flex-start;padding:3px 0}
input,textarea,select{font:inherit;color:var(--fg);background:var(--bg-panel);border:1px solid var(--border-strong);border-radius:8px;padding:6px 8px;max-width:100%}
input[type=radio],input[type=checkbox]{width:auto;margin:3px 0 0;accent-color:var(--accent)}
textarea{width:100%}
strong{font-weight:600}
</style></head><body><script>(function () {
	var skip = { submit: 1, button: 1, reset: 1, image: 1, file: 1 };
	function post(message) { message.type = "pcb-form"; parent.postMessage(message, "*"); }
	function one(element) {
		if (element.type === "number" || element.type === "range") return element.value === "" ? undefined : Number(element.value);
		if (element.type === "checkbox" || element.type === "radio") return element.checked ? element.value : undefined;
		if (element.tagName === "SELECT" && !element.multiple) return element.value === "" ? undefined : element.value;
		return element.value;
	}
	function collect() {
		var out = {};
		var groups = {};
		var names = [];
		var nodes = document.querySelectorAll("input,select,textarea");
		for (var index = 0; index < nodes.length; index += 1) {
			var element = nodes[index];
			if (!element.name || element.disabled || skip[element.type]) continue;
			if (!groups[element.name]) { groups[element.name] = []; names.push(element.name); }
			groups[element.name].push(element);
		}
		for (var cursor = 0; cursor < names.length; cursor += 1) {
			var name = names[cursor];
			var list = groups[name];
			var first = list[0];
			if (first.tagName === "SELECT" && first.multiple && first.options.length > 1) {
				var picked = [];
				for (var option = 0; option < first.options.length; option += 1) {
					if (first.options[option].selected) picked.push(first.options[option].value);
				}
				out[name] = picked;
			} else if (list.length > 1 && first.type === "radio") {
				for (var radio = 0; radio < list.length; radio += 1) {
					if (list[radio].checked) { out[name] = list[radio].value; break; }
				}
			} else if (list.length > 1 && first.type === "checkbox") {
				var checked = [];
				for (var box = 0; box < list.length; box += 1) {
					if (list[box].checked && checked.indexOf(list[box].value) < 0) checked.push(list[box].value);
				}
				out[name] = checked;
			} else if (list.length > 1) {
				var texts = [];
				for (var text = 0; text < list.length; text += 1) {
					var value = one(list[text]);
					texts.push(value === undefined ? "" : value);
				}
				out[name] = texts;
			} else {
				var single = one(first);
				if (single !== undefined) out[name] = single;
			}
		}
		return out;
	}
	function size() { post({ height: Math.ceil(document.documentElement.scrollHeight) }); }
	addEventListener("message", function (event) {
		if (event.data && event.data.type === "pcb-form-collect") post({ data: collect() });
	});
	addEventListener("submit", function (event) { event.preventDefault(); post({ data: collect() }); }, true);
	addEventListener("load", size);
	addEventListener("input", size);
	addEventListener("change", size);
	if (window.ResizeObserver) new ResizeObserver(size).observe(document.body);
})();</script>${html}</body></html>`;
}

function FormCard({ request, onAnswer }: { request: Extract<DialogRequest, { kind: "form" }>; onAnswer: (answer: DialogAnswer) => void }) {
	const frame = useRef<HTMLIFrameElement | null>(null);
	const [height, setHeight] = useState(200);
	const doc = useMemo(() => formDocument(request.html), [request.html]);

	useEffect(() => {
		const listener = (event: MessageEvent) => {
			if (event.source !== frame.current?.contentWindow) return;
			const payload = event.data as { type?: string; height?: number; data?: Record<string, string | number | string[]> };
			if (payload?.type !== "pcb-form") return;
			if (typeof payload.height === "number") {
				setHeight(Math.min(Math.max(payload.height, 80), 460));
				return;
			}
			if (payload.data) onAnswer({ data: payload.data });
		};
		window.addEventListener("message", listener);
		return () => window.removeEventListener("message", listener);
	}, [onAnswer]);

	return (
		<div className="dialog-card">
			<header>
				<h2>{t("请填写表单")}</h2>
			</header>
			<iframe
				ref={frame}
				className="dialog-form-frame"
				title={t("助手表单")}
				sandbox="allow-forms allow-scripts"
				srcDoc={doc}
				style={{ height }}
			/>
			<footer>
				<button
					type="button"
					className="primary"
					onClick={() => frame.current?.contentWindow?.postMessage({ type: "pcb-form-collect" }, "*")}
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
			) : request.kind === "form" ? (
				<FormCard request={request} onAnswer={answer} />
			) : request.kind === "question" ? (
				<QuestionCard request={request} onAnswer={answer} />
			) : (
				<SimpleCard request={request} onAnswer={answer} />
			)}
			{requests.length > 1 ? <div className="dialog-queue">{t("还有 {n} 个待处理", { n: requests.length - 1 })}</div> : null}
		</div>
	);
}
