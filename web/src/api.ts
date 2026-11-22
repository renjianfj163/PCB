import { t } from "./i18n.ts";
import type {
	AgentMessage,
	Automation,
	AutomationInput,
	BootInfo,
	CompactResult,
	CreateSessionBody,
	DialogAnswer,
	DirListing,
	ExecResult,
	FilePreview,
	FrameCheck,
	ModelsInfo,
	PageShot,
	Phase,
	PolicyDecision,
	PromptImage,
	RewindResult,
	ShellKind,
	SessionState,
	SessionSummary,
	ThinkingInfo,
} from "../../shared/protocol.ts";

/**
 * `x-pcb-request` is the CSRF marker the server requires on mutations: a web
 * page on another origin cannot set it without a preflight we never answer.
 */
async function json<T>(path: string, init?: RequestInit): Promise<T> {
	const method = init?.method ?? "GET";
	const response = await fetch(path, {
		...init,
		headers: {
			"content-type": "application/json",
			...(method === "GET" ? {} : { "x-pcb-request": "1" }),
			...(init?.headers ?? {}),
		},
	});
	const text = await response.text();
	const body = text ? (JSON.parse(text) as unknown) : {};
	if (!response.ok) {
		const message = (body as { error?: string }).error ?? `HTTP ${response.status}`;
		throw new Error(t(message));
	}
	return body as T;
}

export const api = {
	boot: () => json<BootInfo>("/api/boot"),

	createSession: (body: CreateSessionBody) =>
		json<{ session: SessionSummary }>("/api/sessions", { method: "POST", body: JSON.stringify(body) }),

	resumeSession: (id: string) => json<{ session: SessionSummary }>(`/api/sessions/${id}/resume`, { method: "POST" }),

	deleteSession: (id: string) => json<{ ok: true }>(`/api/sessions/${id}`, { method: "DELETE" }),

	prompt: (id: string, text: string, images?: PromptImage[]) =>
		json<{ agentInvoked: boolean; queued?: boolean }>(`/api/sessions/${id}/prompt`, {
			method: "POST",
			body: JSON.stringify({ text, ...(images && images.length > 0 ? { images } : {}) }),
		}),

	abort: (id: string) => json<{ ok: true }>(`/api/sessions/${id}/abort`, { method: "POST" }),

	/** Ask omp to summarize the conversation and free context. */
	compact: (id: string, customInstructions?: string) =>
		json<CompactResult>(`/api/sessions/${id}/compact`, {
			method: "POST",
			body: JSON.stringify(customInstructions ? { customInstructions } : {}),
		}),

	/** Move the conversation leaf back to just before one user message; files stay as they are. */
	rewind: (id: string, entryId: string) =>
		json<RewindResult>(`/api/sessions/${id}/rewind`, { method: "POST", body: JSON.stringify({ entryId }) }),

	setPhase: (id: string, phase: Phase) =>
		json<{ phase: Phase }>(`/api/sessions/${id}/phase`, { method: "POST", body: JSON.stringify({ phase }) }),

	answerDialog: (id: string, dialogId: string, answer: DialogAnswer) =>
		json<{ accepted: boolean }>(`/api/sessions/${id}/dialog`, {
			method: "POST",
			body: JSON.stringify({ id: dialogId, answer }),
		}),

	setModel: (id: string, provider: string, modelId: string) =>
		json<{ ok: true }>(`/api/sessions/${id}/model`, {
			method: "POST",
			body: JSON.stringify({ provider, modelId }),
		}),

	models: (id: string) => json<ModelsInfo>(`/api/sessions/${id}/models`),

	thinking: (id: string) => json<ThinkingInfo>(`/api/sessions/${id}/thinking`),

	setThinking: (id: string, level: string) =>
		json<{ level: string }>(`/api/sessions/${id}/thinking`, {
			method: "POST",
			body: JSON.stringify({ level }),
		}),

	messages: (id: string) => json<{ messages: AgentMessage[] }>(`/api/sessions/${id}/messages`),

	policies: (id: string) =>
		json<{ policies: Array<{ tool: string; decision: PolicyDecision }> }>(`/api/sessions/${id}/policies`),

	state: (id: string) => json<{ state: SessionState }>(`/api/sessions/${id}/state`),

	exportHtml: (id: string) => json<{ path: string }>(`/api/sessions/${id}/export`, { method: "POST" }),

	/** Open this folder in the machine's desktop VS Code. */
	openIde: (cwd: string) =>
		json<{ ok: boolean; reason?: string }>("/api/vscode/open", {
			method: "POST",
			body: JSON.stringify({ cwd }),
		}),

	/** Opens the Windows folder dialog on the server. */
	pickProject: () =>
		json<{ cwd?: string; cancelled?: boolean; projects: string[] }>("/api/projects/pick", { method: "POST" }),

	addProject: (cwd: string) =>
		json<{ projects: string[] }>("/api/projects", { method: "POST", body: JSON.stringify({ cwd }) }),

	removeProject: (cwd: string) =>
		json<{ projects: string[] }>("/api/projects", { method: "DELETE", body: JSON.stringify({ cwd }) }),

	/** One folder of the project tree; `path` is relative to `cwd`. */
	listing: (cwd: string, path: string) =>
		json<DirListing>(
			`/api/projects/listing?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`,
		),

	file: (cwd: string, path: string) =>
		json<FilePreview>(`/api/projects/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`),

	/** Can this page live in the rail's frame, or does the site forbid it? */
	frameCheck: (target: string) => json<FrameCheck>(`/api/frame/check?url=${encodeURIComponent(target)}`),

	/** A picture of a page, for the sites that refuse to be framed. Slow on purpose: a browser has to start. */
	pageShot: (target: string) => json<PageShot>(`/api/frame/shot?url=${encodeURIComponent(target)}`),

	/** A site this rail may not frame: let the machine's own browser load it as a top-level page. */
	openExternal: (target: string) =>
		json<{ ok: boolean; reason?: string }>("/api/frame/open", {
			method: "POST",
			body: JSON.stringify({ url: target }),
		}),

	/** Drop one session's raw-output buffer; the other sessions keep theirs. */
	clearRaw: (sessionId: string) =>
		json<{ ok: true }>("/api/raw/clear", { method: "POST", body: JSON.stringify({ sessionId }) }),

	/** The user's own command, run in their project folder. */
	exec: (cwd: string, command: string, shell: ShellKind) =>
		json<ExecResult>("/api/exec", { method: "POST", body: JSON.stringify({ cwd, command, shell }) }),

	automations: () => json<{ automations: Automation[] }>("/api/automations"),

	createAutomation: (input: AutomationInput) =>
		json<{ automation: Automation }>("/api/automations", { method: "POST", body: JSON.stringify(input) }),

	updateAutomation: (id: string, input: AutomationInput) =>
		json<{ automation: Automation }>(`/api/automations/${id}`, { method: "PATCH", body: JSON.stringify(input) }),

	deleteAutomation: (id: string) =>
		json<{ ok: true }>(`/api/automations/${id}`, { method: "DELETE" }),

	runAutomation: (id: string) =>
		json<{ session: SessionSummary; automation: Automation }>(`/api/automations/${id}/run`, { method: "POST" }),
};
