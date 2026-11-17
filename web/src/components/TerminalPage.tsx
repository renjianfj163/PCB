import { useEffect, useRef, useState } from "react";
import type { PolicyDecision, ShellKind } from "../../../shared/protocol.ts";
import type { TerminalEntry } from "../adapters.ts";
import { api } from "../api.ts";
import { t } from "../i18n.ts";

const POLICY_LABEL: Record<PolicyDecision, string> = {
	auto_allow: "自动放行",
	approval_required: "等待审批",
	approved: "已批准",
	rejected: "已拒绝",
	denied: "被拒绝",
};

const SHELL_KEY = "pcb.shell";
/** One command's output, before it stops being useful and starts being noise. */
const OUTPUT_CAP = 4000;

/** A command the user typed here; it lives only while this panel is open. */
interface LocalRun {
	id: string;
	command: string;
	output: string;
	status: "running" | "ok" | "error";
	at: number;
	/** Where it ran, so the echo of the line keeps its original prompt. */
	cwd: string;
	shell: ShellKind;
}

/** One prompt line in the scrollback, whoever typed it. */
interface Line {
	id: string;
	command: string;
	output: string;
	state: "running" | "ok" | "error";
	at: number;
	owner: "you" | "agent";
	cwd?: string;
	policy?: PolicyDecision | null;
}

function clock(at: number): string {
	const date = new Date(at);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `PS D:\Developer\PCB>` for PowerShell, `D:\Developer\PCB>` for cmd — as the shell itself prints. */
function promptOf(cwd: string, shell: ShellKind): string {
	return shell === "powershell" ? `PS ${cwd}>` : `${cwd}>`;
}

function initialShell(): ShellKind {
	const saved = globalThis.localStorage?.getItem(SHELL_KEY);
	return saved === "powershell" ? "powershell" : "cmd";
}

/**
 * The terminal reads like a terminal: one continuous scrollback, and the last
 * line of it is the prompt. There is no separate input box — the caret sits where
 * the shell would put it, and a command stays in the column once it is entered.
 */
export function TerminalPage({
	entries,
	cwd,
	platform,
}: {
	entries: TerminalEntry[];
	cwd: string;
	platform: string;
}) {
	const windows = platform === "win32";
	const [shell, setShell] = useState<ShellKind>(initialShell);
	const [at, setAt] = useState(cwd);
	const [failedOnly, setFailedOnly] = useState(false);
	const [local, setLocal] = useState<LocalRun[]>([]);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	/** Arrow-key history: everything the user typed this session, oldest first. */
	const [history, setHistory] = useState<string[]>([]);
	const [walked, setWalked] = useState<number | null>(null);
	const screenRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const failed = entries.filter(entry => entry.status === "error").length;
	const running = entries.filter(entry => entry.status === "running").length;

	const lines: Line[] = [
		...entries
			.filter(entry => !failedOnly || entry.status === "error")
			.map(
				(entry): Line => ({
					id: entry.id,
					command: entry.command,
					output: entry.output,
					state: entry.status,
					at: entry.at ?? 0,
					owner: "agent",
					policy: entry.policy,
				}),
			),
		...local.map(
			(item): Line => ({
				id: item.id,
				command: item.command,
				output: item.output,
				state: item.status,
				at: item.at,
				owner: "you",
				cwd: item.cwd,
			}),
		),
	].sort((a, b) => a.at - b.at);

	const prompt = promptOf(at, shell);

	// A new conversation starts in its own project folder again.
	useEffect(() => setAt(cwd), [cwd]);

	useEffect(() => {
		const screen = screenRef.current;
		if (!screen) return;
		screen.scrollTop = screen.scrollHeight;
	}, [lines.length, local, at]);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	// Coming back from a command re-arms the prompt, so the next keystroke needs no click.
	useEffect(() => {
		if (!busy) inputRef.current?.focus();
	}, [busy]);

	// The pane owns the keyboard, the way a terminal does: with this tab open, typing
	// anywhere outside another field lands on the prompt. Nothing to click first.
	useEffect(() => {
		const printable = (event: KeyboardEvent) => {
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			if (event.isComposing) return;
			const target = event.target as HTMLElement | null;
			const tag = target?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
			const typed = event.key.length === 1;
			if (!typed && event.key !== "Backspace" && event.key !== "Enter") return;
			inputRef.current?.focus();
			if (typed) {
				event.preventDefault();
				setDraft(previous => previous + event.key);
			} else if (event.key === "Enter" && draft.trim() && !busy) {
				event.preventDefault();
				inputRef.current?.form?.requestSubmit();
			}
		};
		window.addEventListener("keydown", printable);
		return () => window.removeEventListener("keydown", printable);
	}, [draft, busy]);

	const pick = (next: ShellKind) => {
		setShell(next);
		try {
			globalThis.localStorage?.setItem(SHELL_KEY, next);
		} catch {
			// a disabled storage just means the choice lasts this tab
		}
		inputRef.current?.focus();
	};

	const run = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const command = draft.trim();
		if (!command || busy) return;
		const id = `run-${Date.now()}`;
		const ranAt = Date.now();
		const here = at;
		setDraft("");
		setWalked(null);
		setHistory(previous => [...previous, command]);
		setBusy(true);
		setLocal(previous => [...previous, { id, command, output: "", status: "running", at: ranAt, cwd: here, shell }]);
		const patch = (change: Partial<LocalRun>) =>
			setLocal(previous => previous.map(item => (item.id === id ? { ...item, ...change } : item)));
		try {
			const result = await api.exec(here, command, shell);
			// Silence is an answer: a command that prints nothing shows nothing, and
			// only a failure says so.
			const empty = result.code === 0 ? "" : t("（退出码 {s}）", { s: result.code === null ? "—" : result.code });
			const text = result.timedOut ? `${t("（60 秒没跑完，已中止）")}\n${result.output}` : result.output || empty;
			patch({
				output: result.truncated ? `${text}\n${t("…（输出太长，只留了前 64 KB）")}` : text,
				status: result.code === 0 && !result.timedOut ? "ok" : "error",
			});
			if (result.cwd) setAt(result.cwd);
		} catch (error) {
			patch({ output: (error as Error).message, status: "error" });
		} finally {
			setBusy(false);
			inputRef.current?.focus();
		}
	};

	/** Up and down walk what was typed before, like any shell. */
	const step = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
		if (history.length === 0) return;
		event.preventDefault();
		const next =
			walked === null
				? event.key === "ArrowUp"
					? history.length - 1
					: null
				: Math.min(history.length - 1, Math.max(0, walked + (event.key === "ArrowUp" ? -1 : 1)));
		if (next === null) {
			setWalked(null);
			setDraft("");
			return;
		}
		setWalked(next);
		setDraft(history[next] ?? "");
	};

	return (
		<div className="rail-body term-page">
			<div className="rail-subhead">
				<span className="sub-meta">
					{failedOnly
						? t("失败 {a}/{b}", { a: lines.filter(line => line.state === "error").length, b: entries.length })
						: local.length > 0
							? t("助手 {a} 条 · 你 {b} 条", { a: entries.length, b: local.length })
							: t("{n} 条命令", { n: entries.length })}
				</span>
				<div className="sub-tools">
					{running > 0 ? <span className="sub-chip live">{t("运行中 {n}", { n: running })}</span> : null}
					{failed > 0 ? (
						<div className="segmented mini" role="group" aria-label={t("只看失败的命令")}>
							<button
								type="button"
								aria-pressed={!failedOnly}
								className={failedOnly ? undefined : "active"}
								onClick={() => setFailedOnly(false)}
							>
								{t("全部")}
							</button>
							<button
								type="button"
								aria-pressed={failedOnly}
								className={failedOnly ? "active" : undefined}
								onClick={() => setFailedOnly(true)}
							>
								{t("失败 {n}", { n: failed })}
							</button>
						</div>
					) : null}
					{windows ? (
						<select
							className="term-shell"
							value={shell}
							onChange={event => pick(event.target.value === "powershell" ? "powershell" : "cmd")}
							aria-label={t("用哪个 shell 运行")}
							title={t("用哪个 shell 运行")}
						>
							<option value="cmd">{t("cmd.exe")}</option>
							<option value="powershell">{t("PowerShell")}</option>
						</select>
					) : null}
				</div>
			</div>

			{/* One scroll region: history, then the live prompt as its last line. */}
			<div
				className="term-screen"
				ref={screenRef}
				role="log"
				aria-live="polite"
				onClick={() => inputRef.current?.focus()}
			>
				{lines.length === 0 ? (
					<p className="rail-empty">{t("这次对话还没跑过命令。下面可以直接敲；助手要跑命令时会先问你。")}</p>
				) : null}
				{lines.map(line => (
					<div key={line.id} className={`term-entry term-${line.state} term-${line.owner}`}>
						<div className="term-cmdline">
							{line.owner === "you" ? (
								<span className="term-prompt-text">{promptOf(line.cwd ?? at, shell)}</span>
							) : (
								<span className="term-sigil" aria-hidden>
									·
								</span>
							)}
							<span className="term-text">{line.command}</span>
							{line.policy && line.policy !== "auto_allow" ? (
								<span className={`term-policy p-${line.policy}`}>{t(POLICY_LABEL[line.policy])}</span>
							) : null}
							{line.owner === "agent" ? <span className="term-stamp">{clock(line.at)}</span> : null}
						</div>
						{line.state === "running" ? (
							<div className="term-out">{t("运行中…")}</div>
						) : line.output ? (
							<div className="term-out">
								{line.output.length > OUTPUT_CAP ? `${line.output.slice(0, OUTPUT_CAP)}\n…` : line.output}
							</div>
						) : null}
					</div>
				))}
				<form className="term-prompt-line" onSubmit={run}>
					<span className="term-prompt-text">{prompt}</span>
					<input
						ref={inputRef}
						className="term-input"
						value={draft}
						onChange={event => {
							setDraft(event.target.value);
							setWalked(null);
						}}
						onKeyDown={step}
						placeholder={busy ? t("运行中…") : t("在此输入命令")}
						readOnly={busy}
						spellCheck={false}
						autoComplete="off"
						aria-label={t("在这里运行命令")}
					/>
				</form>
			</div>
		</div>
	);
}
