/**
 * The PC-side adapter layer: every place that turns omp session events into view
 * data lives here, so a change in tool/event shape is fixed once instead of in
 * each rail page.
 */

import type { AgentMessage, Phase, PolicyDecision, PromptImage } from "../../shared/protocol.ts";
import { TOOL_LABELS } from "./labels.ts";
import type { PolicyEvent, PendingUser, ToolActivity } from "./state.ts";

/** Tools that touch workspace files (mirrors server/policy.ts). */
export const WRITE_TOOLS: Record<string, true> = {
	write: true,
	edit: true,
	ast_edit: true,
	apply_patch: true,
	notebook_edit: true,
};

/** The phase marker `session.prompt` puts in front of every user message. */
export const PHASE_MARKERS: Record<string, Phase> = {
	"「阶段：规划」": "plan",
	"「阶段：深规划」": "deepplan",
	"「阶段：执行」": "build",
	"「阶段：聊天」": "chat",
};

/** Both read-only planning phases share the rail's plan page. */
export function isPlanPhase(phase: Phase | null): boolean {
	return phase === "plan" || phase === "deepplan";
}

export interface ToolCall {
	id: string;
	name: string;
	args: unknown;
}

export function toolCallsOf(messages: AgentMessage[]): ToolCall[] {
	const calls: ToolCall[] = [];
	for (const message of messages) {
		if (!Array.isArray(message.content)) continue;
		for (const block of message.content) {
			if (!block || typeof block !== "object") continue;
			if (!("type" in block) || block.type !== "toolCall") continue;
			const id = "id" in block && typeof block.id === "string" ? block.id : "";
			const name = "name" in block && typeof block.name === "string" ? block.name : "";
			const args = "arguments" in block ? block.arguments : undefined;
			if (id && name) calls.push({ id, name, args });
		}
	}
	return calls;
}

export function textBlocks(message: AgentMessage): string[] {
	if (!Array.isArray(message.content)) return [];
	return message.content
		.map(block => {
			if (!block || typeof block !== "object") return "";
			const type = "type" in block ? block.type : undefined;
			const text = "text" in block ? block.text : undefined;
			return type === "text" && typeof text === "string" ? text : "";
		})
		.filter(text => text.trim().length > 0);
}

export function phaseOf(message: AgentMessage): Phase | null {
	if (message.role !== "user") return null;
	const text = textBlocks(message).join("\n").trimStart();
	for (const [marker, phase] of Object.entries(PHASE_MARKERS)) {
		if (text.startsWith(marker)) return phase;
	}
	return null;
}

/**
 * A user message without the phase marker the shell put in front of it. All
 * three phases are markers; anything else is left exactly as it was typed.
 */
export function stripPhaseMarker(text: string): string {
	for (const marker of Object.keys(PHASE_MARKERS)) {
		if (text.startsWith(marker)) return text.slice(marker.length).replace(/^\n/, "");
	}
	return text;
}

/** A user message without its phase marker, as the transcript shows it. */
export function userText(message: AgentMessage): string {
	return stripPhaseMarker(textBlocks(message).join("\n"));
}

/**
 * The session entry a row can rewind to. The server pairs `get_messages` with
 * `get_entries` and sets `entryId`; a message it could not pair has no button.
 */
export function userEntryId(message: AgentMessage): string | null {
	if (message.role !== "user") return null;
	const id = message.entryId;
	return typeof id === "string" && id.length > 0 ? id : null;
}

/** What to say when omp declined the move without failing: nothing happened. */
export function rewindNotice(result: { cancelled: boolean }): string | null {
	return result.cancelled ? "没有移动。对话还在原地。" : null;
}

/** The most recent assistant prose: what the plan panel shows in the planning phase. */
export function latestAssistantText(messages: AgentMessage[]): string | null {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (!message || message.role !== "assistant") continue;
		const text = textBlocks(message).join("\n\n").trim();
		if (text) return text;
	}
	return null;
}

/**
 * The last run of planning turns, whole: the user's request and every reply in
 * that stretch. A plan reads as an argument, so showing only the final reply
 * would hide what it was answering.
 */
export function planSegment(messages: AgentMessage[]): AgentMessage[] {
	const turns: AgentMessage[][] = [];
	for (const message of messages) {
		if (message.role === "user" || turns.length === 0) turns.push([message]);
		else turns.at(-1)?.push(message);
	}
	// The last planning stretch, not the last turn: a build/chat turn may follow it.
	let last = -1;
	for (let index = turns.length - 1; index >= 0; index--) {
		const head = turns[index]?.[0];
		if (head && isPlanPhase(phaseOf(head))) {
			last = index;
			break;
		}
	}
	if (last < 0) return [];
	let first = last;
	while (first > 0) {
		const head = turns[first - 1]?.[0];
		if (!head || !isPlanPhase(phaseOf(head))) break;
		first--;
	}
	return turns.slice(first, last + 1).flat();
}

function pathOf(args: unknown): string | undefined {
	if (!args || typeof args !== "object") return undefined;
	const record = args as Record<string, unknown>;
	for (const key of ["path", "file_path", "filePath", "target", "i", "query", "command"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

/** One line describing a tool call, for the compressed plan view. */
export function toolCallLine(name: string, args: unknown): string {
	const label = TOOL_LABELS[name] ?? name;
	const detail = pathOf(args);
	if (!detail) return label;
	const short = detail.length > 60 ? `${detail.slice(0, 60)}…` : detail;
	return `${label} ${short}`;
}

/** Files this conversation tried to change, in the order the agent first touched them. */
export function changedFiles(messages: AgentMessage[], tools: Record<string, ToolActivity>): string[] {
	const seen = new Set<string>();
	const paths: string[] = [];
	const consider = (name: string, args: unknown) => {
		if (!WRITE_TOOLS[name]) return;
		if (!args || typeof args !== "object") return;
		const record = args as Record<string, unknown>;
		const value = record.path ?? record.file_path ?? record.filePath ?? record.target;
		if (typeof value !== "string" || !value.trim()) return;
		const path = value.trim();
		if (seen.has(path)) return;
		seen.add(path);
		paths.push(path);
	};

	for (const call of toolCallsOf(messages)) consider(call.name, call.args);
	for (const activity of Object.values(tools)) consider(activity.name, activity.args);
	return paths;
}

/**
 * Tool arguments carry either an absolute path or one relative to the session
 * cwd; both become a path relative to the project root (or null when outside).
 */
export function relativeTo(cwd: string, path: string): string | null {
	const normalize = (value: string) =>
		value
			.replace(/\\/g, "/")
			.replace(/^\.\//, "")
			.replace(/\/+$/, "");
	const target = normalize(path);
	if (!target) return null;
	const absolute = /^[a-zA-Z]:\//.test(target) || target.startsWith("/");
	if (!absolute) return target;
	const root = normalize(cwd);
	const lowerRoot = root.toLowerCase();
	const lowerTarget = target.toLowerCase();
	if (lowerTarget === lowerRoot) return null;
	if (!lowerTarget.startsWith(`${lowerRoot}/`)) return null;
	return target.slice(root.length + 1);
}

export interface TerminalEntry {
	id: string;
	tool: string;
	command: string;
	status: "running" | "ok" | "error";
	output: string;
	/** Wall clock of the tool result, when omp recorded one. */
	at?: number;
	policy?: PolicyDecision;
}

/**
 * Shell commands this conversation ran, oldest first, with the allow/deny
 * decision attached. Decisions arrive before their call, so they are matched to
 * the next command of the same tool.
 */
export function terminalEntries(
	messages: AgentMessage[],
	tools: Record<string, ToolActivity>,
	policies: PolicyEvent[],
): TerminalEntry[] {
	const results = new Map<string, { text: string; isError: boolean; at?: number }>();
	for (const message of messages) {
		if (message.role !== "toolResult") continue;
		const id = typeof message.toolCallId === "string" ? message.toolCallId : "";
		if (!id) continue;
		const at = typeof message.timestamp === "number" ? message.timestamp : undefined;
		results.set(id, { text: textBlocks(message).join("\n"), isError: message.isError === true, at });
	}

	const entries: TerminalEntry[] = [];
	for (const call of toolCallsOf(messages)) {
		if (call.name !== "bash") continue;
		const args = call.args as Record<string, unknown> | undefined;
		const command = typeof args?.command === "string" ? args.command : "";
		if (!command) continue;
		const live = tools[call.id];
		const result = results.get(call.id);
		const status: TerminalEntry["status"] = live
			? live.status === "running"
				? "running"
				: live.status === "error"
					? "error"
					: "ok"
			: result
				? result.isError
					? "error"
					: "ok"
				: "running";
		entries.push({
			id: call.id,
			tool: call.name,
			command,
			status,
			output: live?.output || result?.text || "",
			...(result?.at === undefined ? {} : { at: result.at }),
		});
	}

	const nextIndex = (tool: string) => entries.findIndex(entry => entry.tool === tool && !entry.policy);
	const awaiting = new Map<string, number>();
	for (const event of policies) {
		if (event.decision === "approval_required") {
			const index = nextIndex(event.tool);
			if (index === -1) continue;
			entries[index]!.policy = "approval_required";
			awaiting.set(event.tool, index);
		} else if (event.decision === "approved" || event.decision === "rejected") {
			const index = awaiting.get(event.tool);
			if (index !== undefined && entries[index]) {
				entries[index]!.policy = event.decision;
				awaiting.delete(event.tool);
			} else {
				const fresh = nextIndex(event.tool);
				if (fresh !== -1) entries[fresh]!.policy = event.decision;
			}
		} else {
			const index = nextIndex(event.tool);
			if (index !== -1) entries[index]!.policy = event.decision;
		}
	}
	return entries;
}

export interface BrowserShot {
	id: string;
	at?: number;
	/** Ready-to-use `<img src>`: data URL, or the shell's blob route. */
	src?: string;
	url?: string;
	text: string;
	/** Which tool produced it — omp drives the browser through `browser` or `eval`. */
	tool: string;
}

function imageSource(block: Record<string, unknown>): string | null {
	const data = typeof block.data === "string" ? block.data : "";
	if (!data) return null;
	if (data.startsWith("blob:sha256:")) return `/api/blob?ref=${encodeURIComponent(data)}`;
	if (data.startsWith("data:")) return data;
	const mime = typeof block.mimeType === "string" ? block.mimeType : "image/png";
	return `data:${mime};base64,${data}`;
}

/** A shell picture as a ready `<img src>`. */
export function promptImageSrc(image: PromptImage): string {
	return `data:${image.mimeType};base64,${image.data}`;
}

/** Terminal colours and cursor codes out of text omp printed for a command. */
export function stripAnsi(text: string): string {
	// eslint-disable-next-line no-control-regex
	return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}

/** One row of the conversation: a message omp reported, or the echo of one just sent. */
export type TranscriptRow = { kind: "message"; message: AgentMessage } | { kind: "pending"; entry: PendingUser };

/**
 * omp's messages in their own order, with every unsent echo spliced in at the moment it
 * was written. Rendered after the list instead, the echo sits below the reply it caused
 * for as long as the turn runs.
 */
export function mergePending(messages: AgentMessage[], pending: PendingUser[]): TranscriptRow[] {
	const rows: TranscriptRow[] = messages.map(message => ({ kind: "message", message }));
	for (const entry of pending) {
		let index = rows.length;
		while (index > 0) {
			const previous = rows[index - 1]!;
			const at = previous.kind === "message" ? previous.message.timestamp : previous.entry.at;
			if (typeof at !== "number" || at <= entry.at) break;
			index -= 1;
		}
		rows.splice(index, 0, { kind: "pending", entry });
	}
	return rows;
}

/** Every picture block in a message, resolved to `<img src>` (inline base64 or the blob route). */
export function imageSources(message: AgentMessage): string[] {
	if (!Array.isArray(message.content)) return [];
	const sources: string[] = [];
	for (const block of message.content) {
		if (!block || typeof block !== "object" || block.type !== "image") continue;
		const src = imageSource(block);
		if (src) sources.push(src);
	}
	return sources;
}

function firstUrl(text: string): string | undefined {
	const match = /https?:\/\/[^\s)"'\\]+/.exec(text);
	return match ? match[0] : undefined;
}

/**
 * Screenshots a tool call produced. omp drives the browser either through the
 * `browser` tool or from `eval` (the browser API), so any tool result carrying an
 * image block counts; `browser*` calls are listed even when they only moved the page.
 */
export function browserShots(messages: AgentMessage[]): BrowserShot[] {
	const byCall = new Map<string, { name: string; args: unknown }>();
	for (const call of toolCallsOf(messages)) byCall.set(call.id, { name: call.name, args: call.args });

	const shots: BrowserShot[] = [];
	// A screenshot call often carries no URL itself, so remember the last one seen.
	let recentUrl: string | undefined;

	for (const message of messages) {
		if (message.role === "user" || message.role === "assistant") {
			const text = textBlocks(message).join("\n");
			recentUrl = firstUrl(text) ?? recentUrl;
			continue;
		}
		if (message.role !== "toolResult") continue;

		const id = typeof message.toolCallId === "string" ? message.toolCallId : "";
		const call = id ? byCall.get(id) : undefined;
		const tool = call?.name ?? "tool";
		const args = call?.args && typeof call.args === "object" ? (call.args as Record<string, unknown>) : {};

		const images: string[] = [];
		if (Array.isArray(message.content)) {
			for (const block of message.content) {
				if (!block || typeof block !== "object") continue;
				if (!("type" in block) || block.type !== "image") continue;
				const src = imageSource(block as Record<string, unknown>);
				if (src) images.push(src);
			}
		}

		const callUrl =
			(typeof args.url === "string" ? args.url : undefined) ?? firstUrl(JSON.stringify(call?.args ?? {}));
		recentUrl = callUrl ?? recentUrl;
		if (images.length === 0 && !tool.startsWith("browser")) continue;

		const text = textBlocks(message).join("\n").trim();
		shots.push({
			id: id || `shot-${shots.length}`,
			...(typeof message.timestamp === "number" ? { at: message.timestamp } : {}),
			...(images.length > 0 ? { src: images.at(-1) } : {}),
			...(recentUrl ? { url: recentUrl } : {}),
			text,
			tool,
		});
	}
	return shots;
}
