import type {
	AgentMessage,
	Automation,
	AutomationInput,
	BootInfo,
	CreateSessionBody,
	DialogAnswer,
	DirListing,
	FilePreview,
	ModelsInfo,
	Phase,
	PolicyDecision,
	SessionState,
	SessionSummary,
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
		throw new Error(message);
	}
	return body as T;
}

export const api = {
	boot: () => json<BootInfo>("/api/boot"),

	createSession: (body: CreateSessionBody) =>
		json<{ session: SessionSummary }>("/api/sessions", { method: "POST", body: JSON.stringify(body) }),

	resumeSession: (id: string) => json<{ session: SessionSummary }>(`/api/sessions/${id}/resume`, { method: "POST" }),

	deleteSession: (id: string) => json<{ ok: true }>(`/api/sessions/${id}`, { method: "DELETE" }),

	prompt: (id: string, text: string) =>
		json<{ agentInvoked: boolean; queued?: boolean }>(`/api/sessions/${id}/prompt`, {
			method: "POST",
			body: JSON.stringify({ text }),
		}),

	abort: (id: string) => json<{ ok: true }>(`/api/sessions/${id}/abort`, { method: "POST" }),

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

	messages: (id: string) => json<{ messages: AgentMessage[] }>(`/api/sessions/${id}/messages`),

	policies: (id: string) =>
		json<{ policies: Array<{ tool: string; decision: PolicyDecision }> }>(`/api/sessions/${id}/policies`),

	state: (id: string) => json<{ state: SessionState }>(`/api/sessions/${id}/state`),

	exportHtml: (id: string) => json<{ path: string }>(`/api/sessions/${id}/export`, { method: "POST" }),

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
