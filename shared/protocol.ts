/**
 * The contract between the PCB server (omp RPC supervisor) and the browser UI.
 * Discriminated unions only: the browser builds its view model straight from
 * these frames, so nothing here may invent state the agent did not report.
 */

/** Plan answers only, build acts, chat just talks. */
export type Phase = "plan" | "build" | "chat";

export type SessionStatus = "starting" | "idle" | "running" | "exited" | "error";

export interface ModelRef {
	provider: string;
	id: string;
}

export interface SessionSummary {
	id: string;
	cwd: string;
	name: string;
	phase: Phase;
	status: SessionStatus;
	model?: ModelRef | null;
	createdAt: number;
	updatedAt: number;
	/** omp session file, when the run persists one. */
	sessionFile?: string | null;
	/** True while the process is alive. */
	alive: boolean;
	error?: string | null;
	extensions: boolean;
}

export interface TodoTask {
	content: string;
	status: string;
}

export interface TodoPhase {
	name: string;
	tasks: TodoTask[];
}

export interface ContextUsage {
	tokens: number;
	contextWindow: number;
	percent: number;
}

export interface SessionState {
	streaming: boolean;
	compacting: boolean;
	model?: ModelRef | null;
	thinkingLevel?: string;
	todos: TodoPhase[];
	queued: { steering: string[]; followUp: string[] };
	contextUsage?: ContextUsage | null;
	messageCount: number;
	tokensPerSecond?: number | null;
	/** What this conversation has spent so far, from omp's own session stats. */
	costUsd?: number | null;
	totalTokens?: number | null;
}

/** One agent message as omp persists it (role/content blocks). */
export interface AgentMessage {
	role: string;
	content: Array<Record<string, unknown>>;
	[extra: string]: unknown;
}

export interface AskOption {
	label: string;
	description?: string;
}

export interface AskQuestion {
	id: string;
	question: string;
	header?: string;
	options: AskOption[];
	multi?: boolean;
	recommended?: number;
}

export type DialogRequest =
	| {
			id: string;
			method: "select";
			/** Tool-approval prompts carry `Allow tool: <name>` as the first title line. */
			kind: "approval";
			tool: string;
			title: string;
			options: string[];
			optionDetails?: Array<{ description?: string }>;
	  }
	| {
			id: string;
			method: "select";
			kind: "question";
			title: string;
			options: string[];
			optionDetails?: Array<{ description?: string }>;
	  }
	| { id: string; method: "confirm"; kind: "confirm"; title: string; message: string }
	| { id: string; method: "input"; kind: "input"; title: string; placeholder?: string; secret?: boolean }
	| { id: string; method: "editor"; kind: "editor"; title: string }
	| { id: string; method: "ask"; kind: "ask"; questions: AskQuestion[] };

export type DialogAnswer =
	| { value: string }
	| { confirmed: boolean }
	| { cancelled: true }
	| { answers: Array<{ id: string; selectedOptions: string[]; customInput?: string }> };

export type NoticeLevel = "info" | "warning" | "error";

/** How one tool call was allowed to run. */
export type PolicyDecision = "auto_allow" | "approval_required" | "approved" | "rejected" | "denied";

/** A saved task the local shell can run on demand or once a day. */
export interface Automation {
	id: string;
	name: string;
	cwd: string;
	phase: Phase;
	prompt: string;
	enabled: boolean;
	/** Local time "HH:mm", or empty when it only runs on demand. */
	dailyAt?: string | null;
	lastRunAt?: number | null;
	/** Why the last run failed, in one plain sentence. */
	lastError?: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface AutomationInput {
	name?: string;
	cwd?: string;
	phase?: Phase;
	prompt?: string;
	enabled?: boolean;
	dailyAt?: string | null;
}

/** Server -> browser (SSE). */
export type UiEvent =
	| { t: "hello"; sessions: SessionSummary[] }
	| { t: "session"; session: SessionSummary }
	| { t: "session_removed"; id: string }
	/** Raw omp RPC frame, passed through untouched. */
	| { t: "frame"; sessionId: string; frame: Record<string, unknown> }
	/** Authoritative state snapshot (get_state projection). */
	| { t: "state"; sessionId: string; state: SessionState }
	| { t: "messages"; sessionId: string; messages: AgentMessage[] }
	| { t: "dialog"; sessionId: string; request: DialogRequest }
	| { t: "dialog_closed"; sessionId: string; id: string }
	| { t: "notice"; sessionId: string; level: NoticeLevel; text: string }
	| { t: "projects"; projects: string[] }
	| { t: "tool_policy"; sessionId: string; tool: string; decision: PolicyDecision }
	| { t: "automations"; automations: Automation[] };

export interface BootInfo {
	sessions: SessionSummary[];
	projects: string[];
	automations: Automation[];
	defaultCwd: string;
	ompVersion: string;
	auth: { provider: string; name: string; authenticated: boolean }[];
}

export interface CreateSessionBody {
	cwd?: string;
	name?: string;
	extensions?: boolean;
	phase?: Phase;
	resumeSessionFile?: string;
	/** Sent as the first user message once omp is ready. */
	initialPrompt?: string;
}

export interface ModelsInfo {
	models: Array<ModelRef & { name?: string }>;
	current?: ModelRef | null;
}

/** One row of the project file tree (paths are relative to the project root). */
export interface DirEntry {
	name: string;
	path: string;
	kind: "dir" | "file";
	size?: number;
}

export interface DirListing {
	path: string;
	entries: DirEntry[];
	/** The folder had more entries than the server lists at once. */
	truncated: boolean;
}

export interface FilePreview {
	path: string;
	size: number;
	kind: "text" | "binary" | "too_large";
	text?: string;
}
