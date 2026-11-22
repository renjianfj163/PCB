/**
 * One conversation = one `omp --mode rpc-ui` child process.
 *
 * The supervisor owns the process, applies the plan/build policy to approval
 * requests, mirrors authoritative state (`get_state` / `get_messages`) to the
 * browser, and passes every other RPC frame through untouched. It never
 * fabricates conversation content.
 */

import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { Hub } from "./hub.ts";
import { approvalAnswer, approvalTool, decideApproval } from "./policy.ts";
import { ckptHost, launchArgs } from "./omp-args.ts";
import { appendPolicy, loadPolicies, type StoredPolicy } from "./policies.ts";
import { appendRaw } from "./raw.ts";
import { RpcClient, type RpcFrame } from "./rpc/client.ts";
import type { Store, SessionRecord } from "./store.ts";
import { compactFailureText, compactionOutputNotice, parseCompactInvocation } from "../shared/compact.ts";
import { leadingCommand } from "../shared/slash.ts";
import type {
	AgentMessage,
	AskQuestion,
	BootInfo,
	CompactResult,
	DialogAnswer,
	DialogRequest,
	ModelRef,
	Phase,
	PolicyDecision,
	PromptImage,
	RewindResult,
	SessionState,
	SessionStatus,
	SessionSummary,
	ThinkingLevel,
} from "../shared/protocol.ts";

export interface SessionDeps {
	bin: string;
	hub: Hub;
	store: Store;
	onLog?: (message: string) => void;
	onAuth?: (providers: BootInfo["auth"]) => void;
}

interface RpcGetState {
	model?: ModelRef | null;
	thinkingLevel?: string;
	isStreaming?: boolean;
	isCompacting?: boolean;
	contextUsage?: SessionState["contextUsage"];
	todoPhases?: SessionState["todos"];
	queuedMessages?: { steering?: string[]; followUp?: string[] };
	messageCount?: number;
	tokensPerSecond?: number | null;
	sessionFile?: string | null;
	sessionId?: string | null;
	sessionName?: string | null;
}

interface RpcModelInfo extends ModelRef {
	name?: string;
}

/** Subset of `get_session_stats` that the shell shows. */
interface RpcSessionStats {
	cost?: number;
	tokens?: { total?: number };
}

/** Told to the agent once, at spawn: how this shell expects it to behave. */
const PROTOCOL_PROMPT = `This session is driven by PCB, a local app for people who do not write code.

Every user message begins with a phase marker:

- 「阶段：规划」 (plan): read-only. Produce a concrete plan — steps, which files or folders are involved,
  what could go wrong, and anything you need from the user. Do not edit files, run commands, or start
  subagents that change anything. Use the ask tool when a decision is genuinely the user's to make.
  Keep the todo tool in step with the plan: one short line per step, so the panel beside the chat shows
  exactly what you propose and, later, what is done.
- 「阶段：执行」 (build): carry out the agreed plan. Mark the same todos off as you go.
- 「阶段：聊天」 (chat): answer the question and stop there. Read freely, but do not edit files or run
  commands, and do not turn the answer into a plan unless the user asks for one.

Conversation without a marker is ordinary chat.

If a tool call is refused because of the phase, do not retry it with a different command. Say what you
needed and use the ask tool instead; the user decides.

Write for a reader who cannot read the code: say what you are about to do and why in short, plain
sentences before doing it, and report results without jargon. Prefer showing a diff or a short
before/after over describing it in prose.`;

const EMPTY_STATE: SessionState = {
	streaming: false,
	compacting: false,
	model: null,
	todos: [],
	queued: { steering: [], followUp: [] },
	contextUsage: null,
	messageCount: 0,
};

/** Message frames are open records; `role` is the only contract we rely on. */
function asAgentMessage(value: unknown): AgentMessage | undefined {
	if (!value || typeof value !== "object") return undefined;
	if (!("role" in value) || typeof value.role !== "string") return undefined;
	return value as AgentMessage; // shape is open by design (omp persists new fields)
}

/** The prose of one message, joined the same way the browser joins it. */
function messageText(message: object): string {
	if (!("content" in message) || !Array.isArray(message.content)) return "";
	return message.content
		.map(block => {
			if (!block || typeof block !== "object") return "";
			if (!("type" in block) || block.type !== "text") return "";
			if (!("text" in block) || typeof block.text !== "string") return "";
			return block.text;
		})
		.filter(Boolean)
		.join("\n");
}

/**
 * `navigate_tree` addresses a session entry, not an index into `get_messages`.
 * The active branch is the chain from `leafId` back to the root, and only that
 * chain may be paired: a rewound-away branch keeps its own copy of the same
 * text and must not be picked up again. Walk the chain once, then match the
 * branch's user messages to it in order. An id omp already put on the message
 * wins; a message with no pair gets none, and its row offers no rewind button.
 */
export function attachUserEntryIds(
	messages: AgentMessage[],
	entries: unknown,
	leafId?: unknown,
): AgentMessage[] {
	const rows: Array<{ id: string; parentId?: string; message?: unknown }> = [];
	const byId = new Map<string, { id: string; parentId?: string; message?: unknown }>();
	for (const row of Array.isArray(entries) ? entries : []) {
		if (!row || typeof row !== "object") continue;
		if (!("id" in row) || typeof row.id !== "string") continue;
		const node = {
			id: row.id,
			parentId: "parentId" in row && typeof row.parentId === "string" ? row.parentId : undefined,
			message: "message" in row ? row.message : undefined,
		};
		rows.push(node);
		byId.set(node.id, node);
	}

	const chain: typeof rows = [];
	if (typeof leafId === "string" && byId.has(leafId)) {
		const seen = new Set<string>();
		let cursor: string | undefined = leafId;
		while (cursor && !seen.has(cursor)) {
			seen.add(cursor);
			const node = byId.get(cursor);
			if (!node) break;
			chain.push(node);
			cursor = node.parentId;
		}
	}
	// No leaf to follow (old omp, empty session): fall back to append order.
	const candidates = chain.length > 0 ? chain.reverse() : rows;

	const userRows: Array<{ id: string; text: string }> = [];
	for (const node of candidates) {
		const message = node.message;
		if (!message || typeof message !== "object") continue;
		if (!("role" in message) || message.role !== "user") continue;
		userRows.push({ id: node.id, text: messageText(message) });
	}
	const known = new Set(userRows.map(row => row.id));

	let cursor = 0;
	return messages.map(message => {
		if (message.role !== "user") return message;
		const existing = typeof message.entryId === "string" ? message.entryId : undefined;
		if (existing && known.has(existing)) return message;
		const text = messageText(message);
		while (cursor < userRows.length && userRows[cursor]?.text !== text) cursor++;
		const row = userRows[cursor];
		if (!row) return message;
		cursor += 1;
		return { ...message, entryId: row.id };
	});
}

/**
 * Mirror one streamed message where its own timestamp says, not where it arrives.
 * A steering message is committed after the reply it caused, so a plain append puts
 * its row below that reply until the next `get_messages` reorders the transcript.
 * Equal or missing timestamps keep arrival order.
 */
export function insertByTimestamp(messages: AgentMessage[], message: AgentMessage): AgentMessage[] {
	const at = typeof message.timestamp === "number" ? message.timestamp : undefined;
	if (at === undefined) return [...messages, message];
	let index = messages.length;
	while (index > 0) {
		const previous = messages[index - 1]?.timestamp;
		if (typeof previous !== "number" || previous <= at) break;
		index -= 1;
	}
	return [...messages.slice(0, index), message, ...messages.slice(index)];
}

/** omp refused to move: `code` says why, `message` is already the user's words. */
export class RewindRefused extends Error {
	readonly code?: string;
	constructor(message: string, code?: string) {
		super(message);
		this.code = code;
	}
}

/** omp's refusal codes, in the user's words. */
export function rewindFailureText(code: string | undefined, error: string | undefined): string {
	if (code === "session_busy") return "这一轮还在跑，等它结束再回到这句。";
	if (code === "entry_not_found") return "找不到这句话，刷新后再试。";
	return (error ?? "").trim() || "omp 没有回到这句，对话还在原地。";
}

export class PcbSession {
	readonly record: SessionRecord;
	#deps: SessionDeps;
	#client: RpcClient | undefined;
	#status: SessionStatus = "starting";
	#state: SessionState = { ...EMPTY_STATE };
	#messages: AgentMessage[] = [];
	#dialogs = new Map<string, DialogRequest>();
	#policies: StoredPolicy[] = [];
	#models: RpcModelInfo[] = [];
	#refreshTimer: NodeJS.Timeout | undefined;
	#closed = false;
	#queuedPrompt: { text: string; images: PromptImage[] } | undefined;
	/** Names omp admits as slash commands; empty until it answers. */
	#commands = new Set<string>();
	/** Set once the user allows the browser in this message; cleared by the next prompt or phase change. */
	#browserAllowed = false;
	#started = false;
	#failure: string | null = null;
	#ready = Promise.withResolvers<void>();

	constructor(record: SessionRecord, deps: SessionDeps) {
		this.record = record;
		this.#deps = deps;
		this.#policies = loadPolicies(record.id);
	}

	static create(
		cwd: string,
		options: { name?: string; extensions?: boolean; resumeSessionFile?: string; phase?: Phase },
	) {
		const now = Date.now();
		const record: SessionRecord = {
			id: randomUUID().slice(0, 8),
			cwd,
			name: options.name?.trim() || basename(cwd) || cwd,
			phase: options.phase ?? (options.resumeSessionFile ? "build" : "plan"),
			extensions: options.extensions === true,
			createdAt: now,
			updatedAt: now,
			sessionFile: options.resumeSessionFile,
		};
		return record;
	}

	get id(): string {
		return this.record.id;
	}

	get alive(): boolean {
		return this.#status === "starting" || this.#status === "idle" || this.#status === "running";
	}

	get state(): SessionState {
		return this.#state;
	}

	get messages(): AgentMessage[] {
		return this.#messages;
	}

	get models(): RpcModelInfo[] {
		return this.#models;
	}

	/** Allow/deny decisions recorded for this conversation, in call order. */
	get policies(): StoredPolicy[] {
		return this.#policies;
	}

	/** Dialogs still waiting for the user, so a reloaded tab can pick them up. */
	get openDialogs(): DialogRequest[] {
		return [...this.#dialogs.values()];
	}

	/** Resolves once the child answered `ready` (or failed to start). */
	get ready(): Promise<void> {
		return this.#ready.promise;
	}

	/** Why startup failed, in one plain sentence. */
	get failure(): string | null {
		return this.#failure;
	}

	/** First user message: sent as soon as omp is ready. */
	queuePrompt(text: string, images: PromptImage[] = []) {
		this.#queuedPrompt = { text, images };
	}

	summary(): SessionSummary {
		return {
			id: this.record.id,
			cwd: this.record.cwd,
			name: this.record.name,
			phase: this.record.phase,
			status: this.#status,
			model: this.#state.model ?? null,
			createdAt: this.record.createdAt,
			updatedAt: this.record.updatedAt,
			sessionFile: this.record.sessionFile ?? null,
			alive: this.alive,
			extensions: this.record.extensions,
		};
	}

	#broadcastSession() {
		this.record.updatedAt = Date.now();
		this.#deps.store.upsertSession(this.record);
		this.#deps.hub.broadcast({ t: "session", session: this.summary() });
	}

	#notice(level: "info" | "warning" | "error", text: string) {
		this.#deps.hub.broadcast({ t: "notice", sessionId: this.record.id, level, text });
	}

	async start(): Promise<void> {
		try {
			await this.#start();
		} finally {
			this.#ready.resolve();
		}
	}

	async #start(): Promise<void> {
		if (this.#closed) throw new Error("session closed");
		this.#status = "starting";
		this.#broadcastSession();

		const args = launchArgs(
			{
				cwd: this.record.cwd,
				extensions: this.record.extensions,
				sessionFile: this.record.sessionFile,
				phase: this.record.phase,
			},
			ckptHost(),
			PROTOCOL_PROMPT,
		);

		const client = new RpcClient({
			bin: this.#deps.bin,
			args,
			cwd: this.record.cwd,
			onFrame: frame => this.#onFrame(frame),
			onExit: info => this.#onExit(info),
			// Cheap enough to always tap: appendRaw returns immediately unless a window is watching.
			onRaw: (stream, line) => appendRaw(this.record.id, stream, line),
			onLog: message => this.#deps.onLog?.(`[${this.record.id}] ${message}`),
		});
		this.#client = client;

		try {
			await client.start();
		} catch (error) {
			this.#failure = `无法启动 omp：${(error as Error).message}`;
			this.#status = "error";
			this.#broadcastSession();
			this.#notice("error", this.#failure);
			return;
		}

		try {
			// Structured questions instead of a wall of text.
			await client.call({ type: "set_ask_dialog", enabled: true }, 10_000);
		} catch {
			this.#deps.onLog?.(`[${this.record.id}] set_ask_dialog failed`);
		}

		// Model/auth discovery waits on provider catalogs; never block the turn on it.
		void this.#loadModels();
		void this.#loadAuth();
		void this.#loadCommands();
		await Promise.allSettled([this.refreshState(), this.refreshMessages()]);
		this.#status = this.#state.streaming ? "running" : "idle";
		this.#broadcastSession();

		// A resumed session answers get_messages with an empty snapshot for a while
		// (omp replays the transcript in the background), so keep asking off the
		// startup path instead of blocking the first paint.
		if (this.#messages.length === 0 && this.record.sessionFile) void this.#probeHistory();

		this.#started = true;
		const queued = this.#queuedPrompt;
		if (queued) {
			this.#queuedPrompt = undefined;
			try {
				await this.#sendPrompt(queued.text, queued.images);
			} catch (error) {
				this.#failure = `发送失败：${(error as Error).message}`;
				this.#notice("error", this.#failure);
			}
		}
	}

	async #probeHistory(): Promise<void> {
		for (let attempt = 0; attempt < 40 && !this.#closed; attempt++) {
			await new Promise(resolve => setTimeout(resolve, 500));
			if (this.#messages.length > 0) return;
			await this.refreshMessages();
			if (this.#messages.length > 0) return;
		}
	}

	async #loadModels() {
		const client = this.#client;
		if (!client) return;
		try {
			const data = await client.call<{ models: RpcModelInfo[] }>({ type: "get_available_models" });
			this.#models = (data?.models ?? []).map(m => ({ provider: m.provider, id: m.id, name: m.name }));
			this.#deps.hub.broadcast({ t: "session", session: this.summary() });
		} catch (error) {
			this.#deps.onLog?.(`[${this.record.id}] models: ${(error as Error).message}`);
		}
	}

	async #loadAuth() {
		const client = this.#client;
		if (!client || !this.#deps.onAuth) return;
		try {
			const data = await client.call<{
				providers: Array<{ id: string; name: string; authenticated?: boolean }>;
			}>({ type: "get_login_providers" });
			this.#deps.onAuth(
				(data?.providers ?? []).map(provider => ({
					provider: provider.id,
					name: provider.name,
					authenticated: provider.authenticated === true,
				})),
			);
		} catch (error) {
			this.#deps.onLog?.(`[${this.record.id}] auth: ${(error as Error).message}`);
		}
	}

	#onExit(info: { code: number | null; signal: string | null; stderr: string }) {
		this.#status = "exited";
		if (info.code !== 0 && info.stderr.trim()) {
			this.#notice("error", `omp 退出（code ${info.code}）：${info.stderr.trim().split("\n").slice(-4).join(" ")}`);
		}
		for (const id of this.#dialogs.keys()) {
			this.#deps.hub.broadcast({ t: "dialog_closed", sessionId: this.record.id, id });
		}
		this.#dialogs.clear();
		this.#broadcastSession();
	}

	/** `/name` entries, from a frame or from `get_available_commands`. */
	#readCommands(list: unknown) {
		if (!Array.isArray(list)) return;
		for (const item of list) {
			const name =
				typeof item === "string"
					? item
					: item && typeof item === "object" && "name" in item && typeof item.name === "string"
						? item.name
						: "";
			if (name) this.#commands.add(name);
		}
	}

	/** Ask once at startup; the update frame omp sends by itself covers later changes. */
	async #loadCommands() {
		try {
			const data = await this.#requireClient().call<{ commands?: unknown }>({ type: "get_available_commands" });
			this.#readCommands(data?.commands);
		} catch {
			// An omp without the catalog keeps the shape check in leadingCommand().
		}
	}

	#onFrame(frame: RpcFrame) {
		switch (frame.type) {
			case "extension_ui_request":
				this.#onUiRequest(frame);
				return;
			case "agent_start":
				this.#status = "running";
				this.#broadcastSession();
				this.#deps.hub.broadcast({ t: "frame", sessionId: this.record.id, frame });
				return;
			case "agent_end":
				this.#deps.hub.broadcast({ t: "frame", sessionId: this.record.id, frame });
				this.#scheduleRefresh({ messages: true });
				return;
			case "session_settled":
				this.#status = "idle";
				this.#broadcastSession();
				this.#deps.hub.broadcast({ t: "frame", sessionId: this.record.id, frame });
				this.#scheduleRefresh({ messages: true });
				return;
			case "turn_end":
			case "model_changed":
			case "thinking_level_changed":
			case "todo_reminder":
			case "todo_auto_clear":
			case "queue_update":
				this.#deps.hub.broadcast({ t: "frame", sessionId: this.record.id, frame });
				this.#scheduleRefresh({});
				return;
			case "tool_execution_end":
				// Todos change mid-turn; a settle-only refresh would leave the plan
				// panel stale until the whole turn ends.
				this.#deps.hub.broadcast({ t: "frame", sessionId: this.record.id, frame });
				this.#scheduleRefresh({});
				return;
			case "message_end": {
				// Keep a usable transcript while a turn is in flight: get_messages
				// answers empty mid-turn, so mirror the message we just saw.
				const message = asAgentMessage(frame.message);
				if (message) this.#messages = insertByTimestamp(this.#messages, message);
				this.#deps.hub.broadcast({ t: "frame", sessionId: this.record.id, frame });
				return;
			}
			case "available_commands_update": {
				this.#readCommands(frame.commands);
				this.#deps.hub.broadcast({ t: "frame", sessionId: this.record.id, frame });
				return;
			}
			case "session_info_update": {
				const title = typeof frame.title === "string" ? frame.title.trim() : "";
				if (title && title !== this.record.name) {
					this.record.name = title;
					this.#broadcastSession();
				}
				return;
			}
			case "manual_compaction_start":
			case "auto_compaction_start":
				this.#state = { ...this.#state, compacting: true };
				this.#deps.hub.broadcast({ t: "state", sessionId: this.record.id, state: this.#state });
				this.#deps.hub.broadcast({ t: "frame", sessionId: this.record.id, frame });
				return;
			case "manual_compaction_end":
			case "auto_compaction_end":
				this.#deps.hub.broadcast({ t: "frame", sessionId: this.record.id, frame });
				this.#scheduleRefresh({ messages: true });
				return;
			case "command_output": {
				const text = typeof frame.text === "string" ? frame.text.trim() : "";
				const notice = text ? compactionOutputNotice(text) : null;
				if (notice) this.#notice(notice.level, notice.text);
				this.#deps.hub.broadcast({ t: "frame", sessionId: this.record.id, frame });
				return;
			}
			default:
				this.#deps.hub.broadcast({ t: "frame", sessionId: this.record.id, frame });
		}
	}

	#scheduleRefresh(options: { messages?: boolean }) {
		clearTimeout(this.#refreshTimer);
		this.#refreshTimer = setTimeout(() => {
			void (async () => {
				const state = await this.refreshState();
				// omp refuses a mid-turn message snapshot: wait for the settle that follows.
				if (options.messages && !state.streaming) await this.refreshMessages();
			})();
		}, 120);
	}

	async refreshState(): Promise<SessionState> {
		const client = this.#client;
		if (!client || client.exited) return this.#state;
		try {
			const [data, stats] = await Promise.all([
				client.call<RpcGetState>({ type: "get_state" }),
				client.call<RpcSessionStats>({ type: "get_session_stats" }).catch(() => null),
			]);
			this.#state = {
				streaming: data.isStreaming === true,
				compacting: data.isCompacting === true,
				model: data.model ?? null,
				thinkingLevel: data.thinkingLevel,
				todos: Array.isArray(data.todoPhases) ? data.todoPhases : [],
				queued: {
					steering: data.queuedMessages?.steering ?? [],
					followUp: data.queuedMessages?.followUp ?? [],
				},
				contextUsage: data.contextUsage ?? null,
				messageCount: data.messageCount ?? 0,
				tokensPerSecond: data.tokensPerSecond ?? null,
				costUsd: typeof stats?.cost === "number" ? stats.cost : null,
				totalTokens: typeof stats?.tokens?.total === "number" ? stats.tokens.total : null,
			};
			if (typeof data.sessionFile === "string") this.record.sessionFile = data.sessionFile;
			if (typeof data.sessionId === "string") this.record.ompSessionId = data.sessionId;
			if (data.sessionName && data.sessionName !== this.record.name) {
				// omp picked a better title: the sidebar has to hear about it, or the
				// list keeps showing the first sentence (or the folder name) for good.
				this.record.name = data.sessionName;
				this.#broadcastSession();
			}
			this.#deps.hub.broadcast({ t: "state", sessionId: this.record.id, state: this.#state });
		} catch (error) {
			this.#deps.onLog?.(`[${this.record.id}] get_state: ${(error as Error).message}`);
		}
		return this.#state;
	}

	async refreshMessages(): Promise<AgentMessage[]> {
		const client = this.#client;
		if (!client || client.exited) return this.#messages;
		// While a turn streams, get_messages answers with an empty snapshot; the
		// live frames already carry it, so keep what we have. At startup the cache
		// is empty, so a streaming resumed session still fetches once.
		if (this.#state.streaming && this.#messages.length > 0) return this.#messages;
		try {
			const data = await client.call<{ messages: AgentMessage[] }>({ type: "get_messages" });
			const messages = Array.isArray(data?.messages) ? data.messages : [];
			// The tree carries the entry ids a rewind needs; the message array does not.
			const tree = await this.#tree();
			this.#messages = attachUserEntryIds(messages, tree.entries, tree.leafId);
			this.#deps.hub.broadcast({ t: "messages", sessionId: this.record.id, messages: this.#messages });
		} catch (error) {
			this.#deps.onLog?.(`[${this.record.id}] get_messages: ${(error as Error).message}`);
		}
		return this.#messages;
	}

	/** The session tree in append order plus its leaf, for pairing user messages with entry ids. */
	async #tree(): Promise<{ entries: unknown[]; leafId: unknown }> {
		const client = this.#client;
		if (!client || client.exited) return { entries: [], leafId: null };
		try {
			const data = await client.call<{ entries?: unknown[]; leafId?: unknown }>({ type: "get_entries" });
			return {
				entries: Array.isArray(data?.entries) ? data.entries : [],
				leafId: data?.leafId ?? null,
			};
		} catch (error) {
			this.#deps.onLog?.(`[${this.record.id}] get_entries: ${(error as Error).message}`);
			return { entries: [], leafId: null };
		}
	}

	/**
	 * Move the leaf back to the parent of one user message: that line and every
	 * reply after it leave the active path. Only the conversation tree moves —
	 * no summarize, no files, no second session, nothing deleted from the file.
	 */
	async rewind(entryId: string): Promise<RewindResult> {
		const client = this.#requireClient();
		// omp rejects this mid-turn anyway; refusing here keeps it to one message.
		if (this.#state.streaming || this.#state.compacting) {
			throw new RewindRefused(rewindFailureText("session_busy", undefined), "session_busy");
		}
		const response = await client.request({ type: "navigate_tree", entryId });
		if (response.success === false) {
			const code = typeof response.code === "string" ? response.code : undefined;
			throw new RewindRefused(rewindFailureText(code, response.error), code);
		}
		const data = response.data;
		// omp said no (the summarize prompt was declined): nothing moved, nothing to reread.
		if (data && typeof data === "object" && "cancelled" in data && data.cancelled === true) {
			return { cancelled: true };
		}
		await this.refreshState();
		await this.refreshMessages();
		if (data && typeof data === "object" && "editorText" in data && typeof data.editorText === "string") {
			return { cancelled: false, editorText: data.editorText };
		}
		return { cancelled: false };
	}

	#onUiRequest(frame: RpcFrame) {
		const method = String(frame.method ?? "");
		const id = String(frame.id ?? "");
		if (!id) return;

		if (method === "cancel") {
			const target = String(frame.targetId ?? "");
			if (this.#dialogs.delete(target)) {
				this.#deps.hub.broadcast({ t: "dialog_closed", sessionId: this.record.id, id: target });
			}
			return;
		}

		const presentation: Record<string, true> = {
			notify: true,
			setStatus: true,
			setWidget: true,
			setTitle: true,
			set_editor_text: true,
			open_url: true,
		};
		if (presentation[method]) {
			this.#deps.hub.broadcast({ t: "frame", sessionId: this.record.id, frame });
			return;
		}

		if (method === "select") {
			const title = String(frame.title ?? "");
			const options = Array.isArray(frame.options) ? frame.options.map(String) : [];
			const tool = approvalTool(title);
			if (tool) {
				const decision = decideApproval(tool, this.record.phase, this.#browserAllowed);
				if (decision.action === "approve") {
					this.#client?.respondToDialog(id, { value: approvalAnswer(options, "approve") });
					this.#emitPolicy(tool, "auto_allow");
					return;
				}
				if (decision.action === "deny") {
					this.#client?.respondToDialog(id, { value: approvalAnswer(options, "deny") });
					this.#emitPolicy(tool, "denied");
					this.#notice("warning", decision.reason);
					return;
				}
				this.#emitPolicy(tool, "approval_required");
				const request: DialogRequest = {
					id,
					method: "select",
					kind: "approval",
					tool,
					title,
					options,
					optionDetails: Array.isArray(frame.optionDetails)
						? (frame.optionDetails as Array<{ description?: string }>)
						: undefined,
				};
				this.#openDialog(request);
				return;
			}
			this.#openDialog({
				id,
				method: "select",
				kind: "question",
				title,
				options,
				optionDetails: Array.isArray(frame.optionDetails)
					? (frame.optionDetails as Array<{ description?: string }>)
					: undefined,
			});
			return;
		}

		if (method === "ask") {
			this.#openDialog({
				id,
				method: "ask",
				kind: "ask",
				questions: Array.isArray(frame.questions) ? (frame.questions as AskQuestion[]) : [],
			});
			return;
		}

		if (method === "confirm") {
			this.#openDialog({
				id,
				method: "confirm",
				kind: "confirm",
				title: String(frame.title ?? ""),
				message: String(frame.message ?? ""),
			});
			return;
		}

		if (method === "input" || method === "editor") {
			this.#openDialog({
				id,
				method,
				kind: method,
				title: String(frame.title ?? ""),
				placeholder: typeof frame.placeholder === "string" ? frame.placeholder : undefined,
				secret: frame.secret === true,
			} as DialogRequest);
			return;
		}

		this.#deps.hub.broadcast({ t: "frame", sessionId: this.record.id, frame });
	}

	#openDialog(request: DialogRequest) {
		this.#dialogs.set(request.id, request);
		this.#deps.hub.broadcast({ t: "dialog", sessionId: this.record.id, request });
	}

	respondDialog(id: string, answer: DialogAnswer): boolean {
		const request = this.#dialogs.get(id);
		if (!this.#dialogs.delete(id)) return false;
		this.#client?.respondToDialog(id, answer as Record<string, unknown>);
		this.#deps.hub.broadcast({ t: "dialog_closed", sessionId: this.record.id, id });
		if (request?.kind === "approval") {
			// Anything that is not an approve label (deny, cancel, timeout) means the call did not run.
			const value = "value" in answer && typeof answer.value === "string" ? answer.value : "";
			const approved = /approve/i.test(value);
			// One yes for the browser covers the rest of this user message; bash and friends never benefit.
			if (approved && request.tool === "browser" && this.record.phase === "build") this.#browserAllowed = true;
			this.#emitPolicy(request.tool, approved ? "approved" : "rejected");
		}
		return true;
	}

	/** Terminal page: how this call was allowed, in call order. */
	#emitPolicy(tool: string, decision: PolicyDecision) {
		const policy = { tool, decision };
		this.#policies.push(policy);
		appendPolicy(this.record.id, policy);
		this.#deps.hub.broadcast({ t: "tool_policy", sessionId: this.record.id, tool, decision });
	}

	async prompt(text: string, images: PromptImage[] = []): Promise<{ agentInvoked: boolean; queued?: boolean }> {
		if (!this.#started) await this.ready;
		return this.#sendPrompt(text, images);
	}

	/**
	 * Summarize the conversation so far. OMP aborts a live turn before compacting,
	 * so this refuses while one is still streaming and asks the user to stop first.
	 */
	async compact(customInstructions?: string): Promise<CompactResult> {
		if (!this.#started) await this.ready;
		if (this.#state.streaming) throw new Error("这一轮还在跑，停下来再压缩");
		if (this.#state.compacting) throw new Error("正在压缩上下文");
		const client = this.#requireClient();
		const before = this.#state.contextUsage?.tokens;
		this.#state = { ...this.#state, compacting: true };
		this.#deps.hub.broadcast({ t: "state", sessionId: this.record.id, state: this.#state });
		const instructions = customInstructions?.trim();
		try {
			const data = await client.call<{ tokensBefore?: number }>({
				type: "compact",
				...(instructions ? { customInstructions: instructions } : {}),
			});
			await this.refreshState();
			await this.refreshMessages();
			const tokensBefore = typeof data?.tokensBefore === "number" ? data.tokensBefore : before;
			const tokensAfter = this.#state.contextUsage?.tokens;
			return {
				...(typeof tokensBefore === "number" ? { tokensBefore } : {}),
				...(typeof tokensAfter === "number" ? { tokensAfter } : {}),
			};
		} catch (error) {
			// The call came back as a failure, so the optimistic flag must not stick
			// if the follow-up state read itself fails.
			this.#state = { ...this.#state, compacting: false };
			this.#deps.hub.broadcast({ t: "state", sessionId: this.record.id, state: this.#state });
			await this.refreshState();
			throw new Error(compactFailureText((error as Error).message));
		}
	}

	async #sendPrompt(text: string, images: PromptImage[] = []): Promise<{ agentInvoked: boolean; queued?: boolean }> {
		// A new user message (or a queued follow-up) starts the browser over: the first call asks again.
		this.#browserAllowed = false;
		const invocation = parseCompactInvocation(text);
		if (invocation) {
			if ("error" in invocation) throw new Error(invocation.error);
			if (images.length > 0) throw new Error("压缩不接收图片");
			// Modes exist only on the slash command. The RPC `compact` call takes focus text.
			if (invocation.mode) return this.#dispatchPrompt(text.trim(), []);
			await this.compact(invocation.instructions);
			return { agentInvoked: false };
		}
		const marker =
			this.record.phase === "build" ? "「阶段：执行」" : this.record.phase === "chat" ? "「阶段：聊天」" : "「阶段：规划」";
		// omp reads a slash command only at the very start of the prompt, so a command
		// goes bare: the phase line would turn it back into ordinary text for the model.
		if (leadingCommand(text, this.#commands)) return this.#sendCommand(text);
		return this.#dispatchPrompt(`${marker}\n${text}`, images);
	}

	/**
	 * A slash command goes to omp exactly as typed: no phase line (it would turn the
	 * command back into prose), no pictures, and no queue rewrite — a command that
	 * cannot run while a turn is streaming should say so rather than be queued as text.
	 */
	async #sendCommand(text: string): Promise<{ agentInvoked: boolean; queued?: boolean }> {
		const client = this.#requireClient();
		const response = await client.request({ type: "prompt", message: text.trim() });
		if (response.success === false) throw new Error(response.error ?? "prompt failed");
		this.#scheduleRefresh({});
		const data = (response.data ?? {}) as { agentInvoked?: boolean };
		return { agentInvoked: data.agentInvoked !== false };
	}

	async #dispatchPrompt(message: string, images: PromptImage[]): Promise<{ agentInvoked: boolean; queued?: boolean }> {
		const client = this.#requireClient();
		const pictures = images.map(image => ({ type: "image", mimeType: image.mimeType, data: image.data }));
		const response = await client.request({
			type: "prompt",
			message,
			...(pictures.length > 0 ? { images: pictures } : {}),
		});
		if (response.success === false) {
			// Typing while the agent is mid-turn queues the message instead of failing.
			if (/already processing/i.test(response.error ?? "")) {
				const queued = await client.request({
					type: "follow_up",
					message,
					...(pictures.length > 0 ? { images: pictures } : {}),
				});
				if (queued.success !== false) {
					this.#scheduleRefresh({});
					return { agentInvoked: true, queued: true };
				}
			}
			throw new Error(response.error ?? "prompt failed");
		}
		const data = (response.data ?? {}) as { agentInvoked?: boolean };
		this.#scheduleRefresh({});
		return { agentInvoked: data.agentInvoked !== false };
	}

	async abort(): Promise<void> {
		await this.#requireClient().call({ type: "abort" });
	}

	async setPhase(phase: Phase): Promise<void> {
		this.record.phase = phase;
		// A marker from another phase never carries over.
		this.#browserAllowed = false;
		this.#broadcastSession();
		const text =
			phase === "plan"
				? "已切换到规划阶段：只读，不会改动文件。"
				: phase === "chat"
					? "已切换到聊天阶段：只回答问题，不改文件、不跑命令。"
					: "已切换到执行阶段。";
		this.#notice("info", text);
	}

	async setModel(provider: string, modelId: string): Promise<void> {
		await this.#requireClient().call({ type: "set_model", provider, modelId });
		await this.refreshState();
	}

	/** What the live model accepts; omp answers "off" plus the model's own efforts. */
	async thinkingLevels(): Promise<string[]> {
		const data = await this.#requireClient().call<{ levels?: unknown }>({ type: "get_available_thinking_levels" });
		return Array.isArray(data?.levels) ? data.levels.filter((level): level is string => typeof level === "string") : [];
	}

	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		await this.#requireClient().call({ type: "set_thinking_level", level });
		await this.refreshState();
	}

	async exportHtml(): Promise<string> {
		const data = await this.#requireClient().call<{ path: string }>({ type: "export_html" });
		return data?.path ?? "";
	}

	async close(): Promise<void> {
		this.#closed = true;
		await this.#client?.close();
	}

	kill() {
		this.#client?.kill();
	}

	#requireClient(): RpcClient {
		const client = this.#client;
		if (!client || client.exited) throw new Error("omp 进程未在运行");
		return client;
	}
}
