/**
 * Client-side view model. Everything here is derived from server events; the
 * reducer never invents agent state.
 */

import type {
	AgentMessage,
	Automation,
	BootInfo,
	DialogRequest,
	NoticeLevel,
	PolicyDecision,
	PromptImage,
	SessionState,
	SessionSummary,
	UiEvent,
} from "../../shared/protocol.ts";
import { stripAnsi } from "./adapters.ts";

export interface ToolActivity {
	name: string;
	args: unknown;
	output: string;
	status: "running" | "done" | "error";
}

export interface PolicyEvent {
	tool: string;
	decision: PolicyDecision;
}

export interface Notice {
	key: string;
	sessionId: string;
	level: NoticeLevel;
	text: string;
}

/** What the user just sent: shown until the authoritative snapshot arrives. */
export interface PendingUser {
	text: string;
	/** Pictures that went with the message; the text stays after omp records them. */
	images?: PromptImage[];
	/** When it was sent, so the row can sit where it was written instead of at the end. */
	at: number;
}

export interface AppState {
	boot: BootInfo | null;
	sessions: SessionSummary[];
	automations: Automation[];
	activeId: string | null;
	states: Record<string, SessionState>;
	messages: Record<string, AgentMessage[]>;
	live: Record<string, AgentMessage | null>;
	/** Assistant and tool messages of the turn in flight, in arrival order. */
	turn: Record<string, AgentMessage[]>;
	pending: Record<string, PendingUser[]>;
	/** What a slash command printed (`/context`, `/usage`, …), newest last. */
	outputs: Record<string, string[]>;
	tools: Record<string, Record<string, ToolActivity>>;
	dialogs: Record<string, DialogRequest[]>;
	/** Allow/deny decisions in arrival order, per session. */
	policies: Record<string, PolicyEvent[]>;
	notices: Notice[];
}

export type Action =
	| { type: "boot"; boot: BootInfo }
	| { type: "select"; id: string | null }
	| { type: "set_projects"; projects: string[] }
	| { type: "set_policies"; sessionId: string; policies: PolicyEvent[] }
	| { type: "local_user"; sessionId: string; text: string; images?: PromptImage[]; at?: number }
	| { type: "ui"; event: UiEvent }
	| { type: "dismiss"; key: string }
	| { type: "clear_notices" };

export const initialState: AppState = {
	boot: null,
	sessions: [],
	activeId: null,
	automations: [],
	states: {},
	messages: {},
	live: {},
	turn: {},
	pending: {},
	outputs: {},
	tools: {},
	dialogs: {},
	policies: {},
	notices: [],
};

let noticeSeq = 0;

function upsertSession(sessions: SessionSummary[], session: SessionSummary): SessionSummary[] {
	const index = sessions.findIndex(item => item.id === session.id);
	const next = index >= 0 ? sessions.map(item => (item.id === session.id ? session : item)) : [...sessions, session];
	return next.sort((a, b) => b.updatedAt - a.updatedAt);
}

function blockText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map(block => {
			if (!block || typeof block !== "object") return "";
			const type = "type" in block ? block.type : undefined;
			const text = "text" in block ? block.text : undefined;
			return type === "text" && typeof text === "string" ? text : "";
		})
		.join("\n");
}

/** How many picture blocks a message content carries. */
function imageBlocks(content: unknown): number {
	if (!Array.isArray(content)) return 0;
	return content.filter(
		block => block && typeof block === "object" && "type" in block && block.type === "image",
	).length;
}

/** `{ content: ... }` from a tool result or partial result, narrowed once. */
function contentOf(value: unknown): unknown {
	if (value && typeof value === "object" && "content" in value) return value.content;
	return undefined;
}

function messageOf(value: unknown): AgentMessage | undefined {
	if (value && typeof value === "object" && "role" in value && typeof value.role === "string") {
		return value as AgentMessage;
	}
	return undefined;
}

function applyFrame(state: AppState, sessionId: string, frame: Record<string, unknown>): AppState {
	const type = String(frame.type ?? "");
	if (type === "command_output") {
		// Compaction already reaches the user as a notice from the server.
		const text = stripAnsi(typeof frame.text === "string" ? frame.text : "").trim();
		if (!text || /^Compaction (failed|complete)\b/.test(text)) return state;
		const outputs = state.outputs[sessionId] ?? [];
		return { ...state, outputs: { ...state.outputs, [sessionId]: [...outputs, text] } };
	}
	if (type === "agent_start") {
		return {
			...state,
			live: { ...state.live, [sessionId]: null },
			turn: { ...state.turn, [sessionId]: [] },
			tools: { ...state.tools, [sessionId]: {} },
		};
	}
	if (type === "message_update") {
		// Full-snapshot mode nests the streaming message inside assistantMessageEvent.
		const event = frame.assistantMessageEvent;
		const partial =
			event && typeof event === "object" && "partial" in event ? messageOf(event.partial) : undefined;
		if (!partial) return state;
		return { ...state, live: { ...state.live, [sessionId]: partial } };
	}
	if (type === "message_start") {
		const message = messageOf(frame.message);
		if (message?.role === "assistant") return { ...state, live: { ...state.live, [sessionId]: message } };
		if (message) return { ...state, live: { ...state.live, [sessionId]: null } };
		return state;
	}
	if (type === "message_end") {
		const message = messageOf(frame.message);
		if (!message || message.role === "user") return state;
		const turn = state.turn[sessionId] ?? [];
		return {
			...state,
			live: message.role === "assistant" ? { ...state.live, [sessionId]: null } : state.live,
			turn: { ...state.turn, [sessionId]: [...turn, message] },
		};
	}
	if (type === "tool_execution_start" || type === "tool_execution_update" || type === "tool_execution_end") {
		const callId = String(frame.toolCallId ?? "");
		if (!callId) return state;
		const perSession = { ...(state.tools[sessionId] ?? {}) };
		const previous = perSession[callId];
		if (type === "tool_execution_start") {
			perSession[callId] = {
				name: String(frame.toolName ?? previous?.name ?? "tool"),
				args: frame.args,
				output: "",
				status: "running",
			};
		} else if (type === "tool_execution_update") {
			const text = blockText(contentOf(frame.partialResult));
			perSession[callId] = {
				name: previous?.name ?? String(frame.toolName ?? "tool"),
				args: previous?.args,
				output: text || previous?.output || "",
				status: "running",
			};
		} else {
			const output = blockText(contentOf(frame.result));
			perSession[callId] = {
				name: previous?.name ?? String(frame.toolName ?? "tool"),
				args: previous?.args,
				output: output || (previous?.output ?? ""),
				status: frame.isError === true ? "error" : "done",
			};
		}
		return { ...state, tools: { ...state.tools, [sessionId]: perSession } };
	}
	return state;
}

export function reducer(state: AppState, action: Action): AppState {
	switch (action.type) {
		case "boot":
			return {
				...state,
				boot: action.boot,
				sessions: action.boot.sessions,
				automations: action.boot.automations,
			};
		case "select":
			return { ...state, activeId: action.id };
		case "set_policies":
			return { ...state, policies: { ...state.policies, [action.sessionId]: action.policies } };
		case "set_projects":
			return {
				...state,
				boot: state.boot === null ? state.boot : { ...state.boot, projects: action.projects },
			};
		case "local_user":
			return {
				...state,
				pending: {
					...state.pending,
					[action.sessionId]: [
						...(state.pending[action.sessionId] ?? []),
						{ text: action.text, images: action.images, at: action.at ?? Date.now() },
					],
				},
			};
		case "dismiss":
			return { ...state, notices: state.notices.filter(notice => notice.key !== action.key) };
		case "clear_notices":
			return state.notices.length === 0 ? state : { ...state, notices: [] };
		case "ui": {
			const event = action.event;
			switch (event.t) {
				case "hello":
					// A new stream starts with the server's own truth: dialogs belong to the
					// process that opened them, so anything left over from a previous
					// connection is dead and can never be answered. The open ones are
					// replayed right after this frame.
					return { ...state, sessions: event.sessions, dialogs: {} };
				case "projects":
					return {
						...state,
						boot: state.boot === null ? state.boot : { ...state.boot, projects: event.projects },
					};
				case "auth":
					return {
						...state,
						boot: state.boot === null ? state.boot : { ...state.boot, auth: event.auth },
					};
				case "automations":
					return { ...state, automations: event.automations };
				case "session":
					return { ...state, sessions: upsertSession(state.sessions, event.session) };
				case "session_removed": {
					const sessions = state.sessions.filter(session => session.id !== event.id);
					return {
						...state,
						sessions,
						activeId: state.activeId === event.id ? (sessions[0]?.id ?? null) : state.activeId,
					};
				}
				case "state":
					return { ...state, states: { ...state.states, [event.sessionId]: event.state } };
				case "messages": {
					// A snapshot is authoritative for the conversation, but an echo whose
					// message omp has not recorded yet stays visible.
					const userMessages = event.messages.filter(message => message.role === "user");
					const userTexts = userMessages.map(message => blockText(message.content));
					const pending = (state.pending[event.sessionId] ?? []).filter(
						entry =>
							!userMessages.some(
								(message, index) =>
									(entry.text ? userTexts[index]!.includes(entry.text) : true) &&
									imageBlocks(message.content) >= (entry.images?.length ?? 0),
							),
					);
					return {
						...state,
						messages: { ...state.messages, [event.sessionId]: event.messages },
						live: { ...state.live, [event.sessionId]: null },
						turn: { ...state.turn, [event.sessionId]: [] },
						pending: { ...state.pending, [event.sessionId]: pending },
					};
				}
				case "dialog": {
					const list = state.dialogs[event.sessionId] ?? [];
					if (list.some(item => item.id === event.request.id)) return state;
					return { ...state, dialogs: { ...state.dialogs, [event.sessionId]: [...list, event.request] } };
				}
				case "dialog_closed": {
					const list = state.dialogs[event.sessionId] ?? [];
					return {
						...state,
						dialogs: { ...state.dialogs, [event.sessionId]: list.filter(item => item.id !== event.id) },
					};
				}
				case "tool_policy":
					return {
						...state,
						policies: {
							...state.policies,
							[event.sessionId]: [...(state.policies[event.sessionId] ?? []), { tool: event.tool, decision: event.decision }],
						},
					};
				case "notice":
					return {
						...state,
						notices: [
							...state.notices.slice(-4),
							{ key: `n${++noticeSeq}`, sessionId: event.sessionId, level: event.level, text: event.text },
						],
					};
				case "frame":
					return applyFrame(state, event.sessionId, event.frame);
				default:
					return state;
			}
		}
		default:
			return state;
	}
}
