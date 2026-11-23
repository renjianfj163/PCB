/**
 * The contract between the PCB server (omp RPC supervisor) and the browser UI.
 * Discriminated unions only: the browser builds its view model straight from
 * these frames, so nothing here may invent state the agent did not report.
 */

/** Plan answers only, build acts, chat just talks. */
export type Phase = "plan" | "build" | "chat";

/** Formats omp's image normalization accepts from the shell. */
export const PROMPT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type PromptImageType = (typeof PROMPT_IMAGE_TYPES)[number];

/** One picture pasted into the composer: base64 without the `data:` prefix. */
export interface PromptImage {
	mimeType: PromptImageType;
	data: string;
}

/** Ceilings applied on both sides, so one prompt line stays under omp's 1 MiB RPC frame. */
export const PROMPT_IMAGE_MAX_COUNT = 4;
/** Raw bytes for one picture after preparation. */
export const PROMPT_IMAGE_MAX_BYTES = 450_000;
/** Base64 characters for one picture (4/3 of the byte cap). */
export const PROMPT_IMAGE_MAX_BASE64 = 600_000;
/** Base64 characters across all pictures in one message. */
export const PROMPT_IMAGE_MAX_TOTAL_BASE64 = 900_000;

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
	/** True only while a resumed transcript is being replayed and has not arrived yet. */
	replaying?: boolean;
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

/**
 * Outcome of `POST /api/sessions/:id/rewind`. `editorText` is the user message
 * that left the active path, exactly as omp kept it (phase marker included).
 */
export interface RewindResult {
	cancelled: boolean;
	editorText?: string;
}

/** Outcome of `POST /api/sessions/:id/compact`. Counts are omp's, when it reported them. */
export interface CompactResult {
	tokensBefore?: number;
	tokensAfter?: number;
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
	| { t: "projects"; projects: string[]; sessions: SessionSummary[] }
	/** Login state re-read from omp, before or without a conversation. */
	| { t: "auth"; auth: BootInfo["auth"] }
	| { t: "tool_policy"; sessionId: string; tool: string; decision: PolicyDecision }
	| { t: "automations"; automations: Automation[] };

/** Which pipe of the omp child a raw line came from. */
export type RawStream = "stdout" | "stderr";

/**
 * One line of the child's own output, verbatim. These never travel on the main
 * event stream: they have their own SSE connection, which also owns their life.
 */
export interface RawEvent {
	t: "raw";
	sessionId: string;
	stream: RawStream;
	line: string;
	at: number;
}

export interface BootInfo {
	sessions: SessionSummary[];
	projects: string[];
	automations: Automation[];
	defaultCwd: string;
	ompVersion: string;
	/** The OS account this window is running as. There is no separate PCB login. */
	user: string;
	auth: { provider: string; name: string; authenticated: boolean }[];
	/** Gating for the terminal's shell choice: PowerShell only exists on Windows. */
	platform: string;
}

/** What this PCB is: the installed package, or a checkout run from source. */
export interface InstallInfo {
	installed: boolean;
	/** The install folder when the package put this PCB there; null for a checkout. */
	dir: string | null;
	/** `install-meta.txt` when installed, `package.json` otherwise. */
	version: string;
	/** Always the checkout's own version, for comparison from the settings page. */
	sourceVersion: string;
	/** `<LOCALAPPDATA>\PCB\window.log`; the window writes here. */
	logFile: string;
}

export interface UpdateCheck {
	current: string;
	latest: string | null;
	url: string | null;
	notes: string;
	hasUpdate: boolean;
	/** Set when GitHub could not be read; `latest` is null then. */
	error?: string;
}

export interface CreateSessionBody {
	cwd?: string;
	name?: string;
	extensions?: boolean;
	phase?: Phase;
	resumeSessionFile?: string;
	/** Sent as the first user message once omp is ready. */
	initialPrompt?: string;
	/** Pictures that go with that first message. */
	initialImages?: PromptImage[];
}

export interface ModelsInfo {
	models: Array<ModelRef & { name?: string }>;
	current?: ModelRef | null;
}

/** Levels omp accepts for a session's thinking effort. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** What the live model offers right now, and where the session sits. */
export interface ThinkingInfo {
	levels: string[];
	current?: string | null;
}

/**
 * The gear card's choices before any conversation exists: omp's own model list,
 * its default model, and the thinking levels it accepts. No session, no state.
 */
export interface ShellSettings {
	models: Array<ModelRef & { name?: string }>;
	current: ModelRef | null;
	levels: string[];
	thinking: string | null;
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

/**
 * Whether a page may be shown in the rail's frame. Sites that send
 * X-Frame-Options or a restrictive CSP frame-ancestors load as a blank box, so
 * the shell asks before it builds one.
 */
export interface FrameCheck {
	/** The request itself worked (DNS, connection, a reply). */
	ok: boolean;
	/** The page may appear in an iframe. */
	frameable: boolean;
	/** Final URL after redirects. */
	url?: string;
	status?: number;
	/** Why it cannot be framed, in the user's words. */
	reason?: string;
	/** What the name resolved to — the difference between "slow" and "hijacked DNS". */
	addresses?: string[];
	/** Which network path answered: the system proxy this machine uses, or a direct connection. */
	via?: "proxy" | "direct";
	/** The proxy that was used, e.g. "http://127.0.0.1:10808". */
	proxy?: string;
	/** A request was actually sent and nothing answered — unlike a resolver or policy refusal. */
	unreachable?: boolean;
}

/**
 * A picture of a page, taken by the local browser because the site refuses to
 * live inside a frame. Nothing interactive: read-only by nature.
 */
export interface PageShot {
	ok: boolean;
	/** data: URL of the PNG. */
	image?: string;
	url?: string;
	addresses?: string[];
	reason?: string;
	ms?: number;
}

/** One command the user typed into the rail's terminal. */
export interface ExecResult {
	/** Exit code, or null when the command timed out or never started. */
	code: number | null;
	output: string;
	truncated: boolean;
	timedOut: boolean;
	ms: number;
	/** Which interpreter ran it. */
	shell?: ShellKind;
	/** Where the process ended up: this makes `cd` stick between commands. */
	cwd?: string;
}

/** The two shells a Windows user can pick from in the rail's terminal. */
export type ShellKind = "cmd" | "powershell";
