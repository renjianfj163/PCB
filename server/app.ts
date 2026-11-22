/** HTTP surface: REST for commands, SSE for frames, static files for the UI. */

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import type { Hub } from "./hub.ts";
import { readPromptImages } from "./attachments.ts";
import { readBlob } from "./blobs.ts";
import { runCommand } from "./exec-box.ts";
import { clearRaw, rawLines, watchRaw } from "./raw.ts";
import { openInSystemBrowser } from "./external.ts";
import { checkUpdate, downloadAndRun, installInfo, openLog, openLogin } from "./install.ts";
import { openIde } from "./vscode-desktop.ts";
import { frameCheck } from "./frame-check.ts";
import { pageShot } from "./screenshot.ts";
import { PathRefused, listDirectory, readPreview } from "./project-files.ts";
import { PcbSession, RewindRefused } from "./session.ts";
import type { Store, SessionRecord } from "./store.ts";
import { THINKING_LEVELS } from "../shared/protocol.ts";
import type {
	Automation,
	AutomationInput,
	BootInfo,
	CreateSessionBody,
	DialogAnswer,
	ModelsInfo,
	Phase,
	PromptImage,
	SessionSummary,
	ThinkingInfo,
	ThinkingLevel,
	UiEvent,
} from "../shared/protocol.ts";

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".map": "application/json; charset=utf-8",
};

const BODY_LIMIT = 4 * 1024 * 1024;
const PICK_TIMEOUT_MS = 15 * 60_000;

/**
 * Windows folder picker: PowerShell STA + System.Windows.Forms.FolderBrowserDialog.
 *
 * Passed as `-EncodedCommand` (UTF-16LE) rather than a temp `.ps1`: Windows
 * PowerShell 5.1 reads script files with the ANSI code page, so a UTF-8 file
 * without a BOM turns the Chinese description into a parse error.
 */
const PICK_SCRIPT = `$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.StartPosition = 'CenterScreen'
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Opacity = 0
$owner.Show()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择一个项目文件夹'
$dialog.UseDescriptionForTitle = $true
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog($owner)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
	[Console]::Out.Write($dialog.SelectedPath)
}
$owner.Close()
$owner.Dispose()
`;

/** Keep a chosen phase. A missing one stays unset; anything else starts on plan. */
function chosenPhase(value: unknown): Phase | undefined {
	if (value === undefined) return undefined;
	if (value === "plan" || value === "build" || value === "chat") return value;
	return "plan";
}

function isSameLocalDay(a: Date, b: Date): boolean {
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface PickerOutput {
	stdout: string;
	stderr: string;
}

/** Runs the picker script; kills it on timeout or when the tab goes away. */
function runPicker(argv: string[], options: { timeout: number; signal?: AbortSignal }): Promise<PickerOutput> {
	const [bin, ...args] = argv;
	const deferred = Promise.withResolvers<PickerOutput>();
	const child = spawn(bin ?? "powershell.exe", args, { windowsHide: true });
	let stdout = "";
	let stderr = "";
	let settled = false;

	const finish = (error: (Error & { stderr?: string }) | null) => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", onAbort);
		if (error) {
			error.stderr = stderr;
			deferred.reject(error);
		} else {
			deferred.resolve({ stdout, stderr });
		}
	};

	const timer = setTimeout(() => {
		child.kill();
		finish(new Error("文件夹对话框一直没有响应"));
	}, options.timeout);

	const onAbort = () => {
		child.kill();
		const error = new Error("aborted");
		error.name = "AbortError";
		finish(error);
	};
	options.signal?.addEventListener("abort", onAbort);

	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		stdout += chunk;
	});
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => {
		stderr = (stderr + chunk).slice(-4096);
	});
	child.on("error", error => finish(error));
	child.on("close", code => finish(code === 0 ? null : new Error(`powershell 退出码 ${code}`)));
	return deferred.promise;
}

function clockOf(date: Date): string {
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export interface AppDeps {
	hub: Hub;
	store: Store;
	bin: string;
	port: number;
	/** The folder holding server/main.ts: a checkout, or the installer's own tree. */
	root: string;
	webRoot: string;
	onLog?: (message: string) => void;
}

export class App {
	#deps: AppDeps;
	#sessions = new Map<string, PcbSession>();
	#auth: BootInfo["auth"] = [];
	#ompVersion = "unknown";
	#scheduler: NodeJS.Timeout | undefined;
	#picking = false;

	constructor(deps: AppDeps) {
		this.#deps = deps;
		try {
			this.#ompVersion =
				execFileSync(deps.bin, ["--version"], { encoding: "utf8" }).trim().split("\n")[0] ?? "unknown";
		} catch {
			this.#ompVersion = `${deps.bin} (not found)`;
		}
	}

	get sessions(): PcbSession[] {
		return [...this.#sessions.values()];
	}

	/**
	 * Daily automations only fire while this process is running; missed days are
	 * skipped. Ticks land just after each minute boundary so every `HH:mm` is
	 * observed exactly once instead of drifting with the process start time.
	 */
	startScheduler() {
		if (this.#scheduler) return;
		const arm = () => {
			const delay = 60_000 - (Date.now() % 60_000) + 50;
			this.#scheduler = setTimeout(() => {
				this.#tick();
				arm();
			}, delay);
			this.#scheduler.unref();
		};
		arm();
	}

	#tick() {
		const now = new Date();
		const clock = clockOf(now);
		for (const automation of this.#deps.store.automations) {
			if (!automation.enabled || !automation.dailyAt) continue;
			if (automation.dailyAt !== clock) continue;
			if (automation.lastRunAt && isSameLocalDay(new Date(automation.lastRunAt), now)) continue;
			void this.#runAutomation(automation).catch(error =>
				this.#recordAutomationFailure(automation, (error as Error).message),
			);
		}
	}

	/** Summaries for stored sessions, live or not. */
	#allSummaries(): SessionSummary[] {
		const live = new Map<string, SessionSummary>(
			Array.from(this.#sessions.values(), session => [session.id, session.summary()] as const),
		);
		const summaries: SessionSummary[] = [];
		for (const record of this.#deps.store.sessions) {
			summaries.push(live.get(record.id) ?? this.#dormantSummary(record));
			live.delete(record.id);
		}
		summaries.push(...live.values());
		return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	#dormantSummary(record: SessionRecord): SessionSummary {
		return {
			id: record.id,
			cwd: record.cwd,
			name: record.name,
			phase: record.phase,
			status: "exited",
			model: null,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
			sessionFile: record.sessionFile ?? null,
			alive: false,
			extensions: record.extensions,
		};
	}

	async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
		const segments = url.pathname.split("/").filter(Boolean);

		if (segments[0] !== "api") {
			this.#serveStatic(url.pathname, response);
			return;
		}

		const refusal = this.#guard(request);
		if (refusal) {
			this.#json(response, 403, { error: refusal });
			return;
		}

		try {
			await this.#handleApi(request, response, url, segments.slice(1));
		} catch (error) {
			this.#deps.onLog?.(`api error ${request.method} ${url.pathname}: ${(error as Error).stack}`);
			this.#json(response, 500, { error: (error as Error).message });
		}
	}

	/**
	 * Loopback-only JSON API. Reads need nothing beyond a local Host; mutations
	 * must come from our own origin and carry a header a foreign form cannot set,
	 * which is what keeps a random web page from driving the shell.
	 */
	#guard(request: IncomingMessage): string | null {
		const hostHeader = request.headers.host ?? "";
		const hostname = hostHeader.startsWith("[::1]") ? "[::1]" : hostHeader.split(":")[0];
		if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "[::1]") {
			return "只接受本机访问";
		}
		const method = request.method ?? "GET";
		if (method === "GET" || method === "HEAD") return null;

		const origin = request.headers.origin;
		if (typeof origin === "string" && origin.length > 0) {
			try {
				if (new URL(origin).host !== hostHeader) return "请求来源不被信任";
			} catch {
				return "请求来源不被信任";
			}
		}
		if (request.headers["x-pcb-request"] !== "1") return "缺少请求标记";
		return null;
	}

	async #handleApi(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
		segments: string[],
	): Promise<void> {
		const method = request.method ?? "GET";
		const [head, id, action] = segments;

		if (head === "boot" && method === "GET") {
			const boot: BootInfo = {
				sessions: this.#allSummaries(),
				projects: this.#deps.store.projects,
				automations: this.#deps.store.automations,
				defaultCwd: process.cwd(),
				ompVersion: this.#ompVersion,
				auth: this.#auth,
				platform: process.platform,
			};
			this.#json(response, 200, boot);
			return;
		}

		if (head === "install" && method === "GET") {
			this.#json(response, 200, installInfo(this.#deps.root));
			return;
		}

		if (head === "update" && id === "check" && method === "POST") {
			this.#json(response, 200, await checkUpdate(this.#deps.root));
			return;
		}

		// Downloading runs only after the page has shown the release and the user
		// pressed the button; there is no background check and no background install.
		if (head === "update" && id === "install" && method === "POST") {
			const check = await checkUpdate(this.#deps.root);
			if (!check.hasUpdate || !check.latest || !check.url) {
				this.#json(response, 400, { error: "没有可安装的更新" });
				return;
			}
			const result = await downloadAndRun(check.url, check.latest);
			this.#json(response, 200, { ok: true, manual: result.manual });
			return;
		}

		if (head === "login" && method === "POST") {
			const result = openLogin(this.#deps.root, this.#deps.bin);
			this.#json(response, result.ok ? 200 : 400, result.ok ? { ok: true } : { error: result.error });
			return;
		}

		if (head === "log" && method === "POST") {
			const result = openLog();
			this.#json(
				response,
				result.ok ? 200 : 400,
				result.ok ? { ok: true, path: result.path } : { error: "找不到窗口日志", path: result.path },
			);
			return;
		}

		if (head === "events" && method === "GET") {
			response.writeHead(200, {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-transform",
				connection: "keep-alive",
				"x-accel-buffering": "no",
			});
			this.#deps.hub.add(response);
			const hello: UiEvent = { t: "hello", sessions: this.#allSummaries() };
			response.write(`data: ${JSON.stringify(hello)}\n\n`);
			// Dialogs opened before this tab connected would otherwise wait forever.
			for (const session of this.#sessions.values()) {
				for (const request of session.openDialogs) {
					const event: UiEvent = { t: "dialog", sessionId: session.id, request };
					response.write(`data: ${JSON.stringify(event)}\n\n`);
				}
			}
			return;
		}

		if (head === "vscode" && id === "open" && method === "POST") {
			const body = (await this.#readJson(request)) as { cwd?: string };
			const cwd = typeof body.cwd === "string" ? resolve(body.cwd) : "";
			this.#json(response, 200, await openIde(cwd));
			return;
		}

		if (head === "raw" && method === "GET") {
			// The switch's own stream. Its first and last connection are the recording window.
			response.writeHead(200, {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-transform",
				connection: "keep-alive",
				"x-accel-buffering": "no",
			});
			const stop = watchRaw(event => response.write(`data: ${JSON.stringify(event)}\n\n`));
			// Lines recorded since this connection's predecessor opened — nothing from before the switch.
			const sessionId = url.searchParams.get("session") ?? "";
			for (const entry of rawLines(sessionId)) {
				response.write(`data: ${JSON.stringify({ t: "raw", sessionId, ...entry })}\n\n`);
			}
			response.on("close", stop);
			return;
		}

		if (head === "raw" && id === "clear" && method === "POST") {
			const body = (await this.#readJson(request)) as { sessionId?: string };
			if (typeof body.sessionId !== "string" || !body.sessionId) {
				this.#json(response, 400, { error: "缺少 sessionId" });
				return;
			}
			clearRaw(body.sessionId);
			this.#json(response, 200, { ok: true });
			return;
		}

		if (head === "blob" && method === "GET") {
			const blob = readBlob(url.searchParams.get("ref") ?? "");
			if (!blob) {
				this.#json(response, 404, { error: "这张图不在本机缓存里" });
				return;
			}
			response.writeHead(200, {
				"content-type": blob.type,
				"content-length": String(blob.bytes.length),
				"cache-control": "private, max-age=300",
			});
			response.end(blob.bytes);
			return;
		}

		if (head === "frame" && id === "check" && method === "GET") {
			const check = await frameCheck(url.searchParams.get("url") ?? "");
			this.#json(response, 200, check);
			return;
		}

		if (head === "frame" && id === "open" && method === "POST") {
			const body = (await this.#readJson(request)) as { url?: string };
			this.#json(response, 200, await openInSystemBrowser(typeof body.url === "string" ? body.url : ""));
			return;
		}

		if (head === "frame" && id === "shot" && method === "GET") {
			this.#json(response, 200, await pageShot(url.searchParams.get("url") ?? ""));
			return;
		}

		if (head === "exec" && method === "POST") {
			const body = (await this.#readJson(request)) as { cwd?: string; command?: string; shell?: string };
			const cwd = typeof body.cwd === "string" ? resolve(body.cwd) : "";
			const command = typeof body.command === "string" ? body.command.trim() : "";
			if (!command) {
				this.#json(response, 400, { error: "命令是空的" });
				return;
			}
			if (command.length > 2000) {
				this.#json(response, 400, { error: "命令太长，分几次跑" });
				return;
			}
			// A terminal has to let `cd` leave the folder, or it is not a terminal. The
			// session still starts in its project; the boundary is the loopback bind
			// plus the request marker, and the target must be a real directory.
			if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
				this.#json(response, 400, { error: "这个目录不存在" });
				return;
			}
			const shell = body.shell === "powershell" ? "powershell" : "cmd";
			this.#json(response, 200, await runCommand(cwd, command, shell));
			return;
		}

		if (head === "projects") {
			if (id === "listing" && method === "GET") {
				const cwd = url.searchParams.get("cwd") ?? "";
				const problem = this.#projectProblem(cwd);
				if (problem) {
					this.#json(response, 400, { error: problem });
					return;
				}
				try {
					this.#json(response, 200, listDirectory(cwd, url.searchParams.get("path") ?? ""));
				} catch (error) {
					this.#json(response, error instanceof PathRefused ? 403 : 500, {
						error: (error as Error).message,
					});
				}
				return;
			}

			if (id === "file" && method === "GET") {
				const cwd = url.searchParams.get("cwd") ?? "";
				const problem = this.#projectProblem(cwd);
				if (problem) {
					this.#json(response, 400, { error: problem });
					return;
				}
				const path = url.searchParams.get("path") ?? "";
				if (!path) {
					this.#json(response, 400, { error: "缺少文件路径" });
					return;
				}
				try {
					this.#json(response, 200, readPreview(cwd, path));
				} catch (error) {
					this.#json(response, error instanceof PathRefused ? 403 : 500, {
						error: (error as Error).message,
					});
				}
				return;
			}

			if (id === "pick" && method === "POST") {
				if (this.#picking) {
					this.#json(response, 409, { error: "已经有一个文件夹对话框开着，先去那里选" });
					return;
				}
				// Closing the tab must not leave a modal dialog nobody owns.
				const abort = new AbortController();
				response.once("close", () => {
					if (!response.writableEnded) abort.abort();
				});
				const cwd = await this.#pickFolder(abort.signal);
				if (!cwd) {
					this.#json(response, 200, { cancelled: true });
					return;
				}
				const problem = this.#projectProblem(cwd);
				if (problem) {
					this.#json(response, 400, { error: problem });
					return;
				}
				this.#deps.store.addProject(cwd);
				this.#broadcastProjects();
				this.#json(response, 200, { cwd, projects: this.#deps.store.projects });
				return;
			}

			if (id === undefined && method === "POST") {
				const body = (await this.#readJson(request)) as { cwd?: string };
				const cwd = resolve(body.cwd?.trim() ?? "");
				const problem = this.#projectProblem(cwd);
				if (problem) {
					this.#json(response, 400, { error: problem });
					return;
				}
				this.#deps.store.addProject(cwd);
				this.#broadcastProjects();
				this.#json(response, 200, { projects: this.#deps.store.projects });
				return;
			}

			if (id === undefined && method === "DELETE") {
				const body = (await this.#readJson(request)) as { cwd?: string };
				if (!body.cwd) {
					this.#json(response, 400, { error: "缺少 cwd" });
					return;
				}
				this.#deps.store.removeProject(body.cwd);
				this.#broadcastProjects();
				this.#json(response, 200, { projects: this.#deps.store.projects });
				return;
			}

			if (id === undefined && method === "GET") {
				this.#json(response, 200, { projects: this.#deps.store.projects });
				return;
			}
		}

		if (head === "automations") {
			if (id === undefined && method === "GET") {
				this.#json(response, 200, { automations: this.#deps.store.automations });
				return;
			}

			if (id === undefined && method === "POST") {
				const body = (await this.#readJson(request)) as AutomationInput;
				const automation = this.#createAutomation(body);
				this.#deps.store.upsertAutomation(automation);
				this.#broadcastAutomations();
				this.#json(response, 201, { automation });
				return;
			}

			if (id !== undefined && action === undefined && method === "DELETE") {
				this.#deps.store.removeAutomation(id);
				this.#broadcastAutomations();
				this.#json(response, 200, { ok: true });
				return;
			}

			if (id !== undefined && action === undefined && method === "PATCH") {
				const body = (await this.#readJson(request)) as AutomationInput;
				const existing = this.#deps.store.automations.find(item => item.id === id);
				if (!existing) {
					this.#json(response, 404, { error: "自动化不存在" });
					return;
				}
				const updated: Automation = {
					...existing,
					...(body.name === undefined ? {} : { name: body.name.trim() || existing.name }),
					...(body.enabled === undefined ? {} : { enabled: body.enabled === true }),
					...(body.dailyAt === undefined ? {} : { dailyAt: normalizeClock(body.dailyAt) }),
					updatedAt: Date.now(),
				};
				this.#deps.store.upsertAutomation(updated);
				this.#broadcastAutomations();
				this.#json(response, 200, { automation: updated });
				return;
			}

			if (id !== undefined && action === "run" && method === "POST") {
				const automation = this.#deps.store.automations.find(item => item.id === id);
				if (!automation) {
					this.#json(response, 404, { error: "自动化不存在" });
					return;
				}
				try {
					const session = await this.#runAutomation(automation);
					this.#json(response, 200, { session: session.summary(), automation: this.#findAutomation(id) });
				} catch (error) {
					const message = (error as Error).message;
					this.#recordAutomationFailure(automation, message);
					this.#json(response, 500, { error: message, automation: this.#findAutomation(id) });
				}
				return;
			}
		}

		if (head === "sessions" && id === undefined) {
			if (method === "POST") {
				const body = (await this.#readJson(request)) as CreateSessionBody;
				const cwd = resolve(body.cwd?.trim() || process.cwd());
				const problem = this.#projectProblem(cwd);
				if (problem) {
					this.#json(response, 400, { error: problem });
					return;
				}
				const record = PcbSession.create(cwd, {
					name: body.name,
					extensions: body.extensions,
					resumeSessionFile: body.resumeSessionFile,
					phase: chosenPhase(body.phase),
				});
				let initialImages: PromptImage[];
				try {
					initialImages = readPromptImages(body.initialImages);
				} catch (error) {
					this.#json(response, 400, { error: (error as Error).message });
					return;
				}
				this.#deps.store.addProject(cwd);
				const session = this.#spawn(record);
				const first = body.initialPrompt?.trim() ?? "";
				if (first || initialImages.length > 0) session.queuePrompt(first, initialImages);
				this.#deps.hub.broadcast({ t: "session", session: session.summary() });
				this.#json(response, 201, { session: session.summary() });
				return;
			}
			if (method === "GET") {
				this.#json(response, 200, { sessions: this.#allSummaries() });
				return;
			}
		}

		if (head === "sessions" && id !== undefined) {
			const session = this.#sessions.get(id);
			const record = this.#deps.store.sessions.find(item => item.id === id);

			if (action === undefined && method === "DELETE") {
				if (session) {
					session.kill();
					await session.close();
					this.#sessions.delete(id);
				}
				this.#deps.store.removeSession(id);
				this.#deps.hub.broadcast({ t: "session_removed", id });
				this.#json(response, 200, { ok: true });
				return;
			}

			if (action === "resume" && method === "POST") {
				if (session?.alive) {
					this.#json(response, 200, { session: session.summary() });
					return;
				}
				if (!record) {
					this.#json(response, 404, { error: "会话不存在" });
					return;
				}
				if (session) await session.close();
				const revived = this.#spawn({ ...record, updatedAt: Date.now() });
				this.#deps.hub.broadcast({ t: "session", session: revived.summary() });
				this.#json(response, 200, { session: revived.summary() });
				return;
			}

			if (!session) {
				this.#json(response, 404, { error: "会话不在内存中，请先恢复" });
				return;
			}

			switch (action) {
				case "prompt": {
					if (method !== "POST") break;
					const body = (await this.#readJson(request)) as { text?: unknown; images?: unknown };
					const text = typeof body.text === "string" ? body.text.trim() : "";
					let images: PromptImage[];
					try {
						images = readPromptImages(body.images);
					} catch (error) {
						this.#json(response, 400, { error: (error as Error).message });
						return;
					}
					if (!text && images.length === 0) {
						this.#json(response, 400, { error: "消息为空" });
						return;
					}
					const result = await session.prompt(text, images);
					this.#json(response, 200, result);
					return;
				}
				case "abort": {
					await session.abort();
					this.#json(response, 200, { ok: true });
					return;
				}
				case "compact": {
					if (method !== "POST") break;
					const body = (await this.#readJson(request)) as { customInstructions?: unknown };
					const instructions =
						typeof body.customInstructions === "string" ? body.customInstructions.trim() : "";
					const result = await session.compact(instructions || undefined);
					this.#json(response, 200, result);
					return;
				}
				case "phase": {
					const body = (await this.#readJson(request)) as { phase?: Phase };
					if (body.phase !== "plan" && body.phase !== "build" && body.phase !== "chat") {
						this.#json(response, 400, { error: "phase 必须是 plan、build 或 chat" });
						return;
					}
					await session.setPhase(body.phase);
					this.#json(response, 200, { phase: body.phase });
					return;
				}
				case "dialog": {
					const body = (await this.#readJson(request)) as { id?: string; answer?: DialogAnswer };
					if (!body.id || !body.answer) {
						this.#json(response, 400, { error: "缺少 id 或 answer" });
						return;
					}
					const accepted = session.respondDialog(body.id, body.answer);
					this.#json(response, accepted ? 200 : 409, { accepted });
					return;
				}
				case "model": {
					const body = (await this.#readJson(request)) as { provider?: string; modelId?: string };
					if (!body.provider || !body.modelId) {
						this.#json(response, 400, { error: "缺少 provider 或 modelId" });
						return;
					}
					await session.setModel(body.provider, body.modelId);
					this.#json(response, 200, { ok: true });
					return;
				}
				case "models": {
					const models: ModelsInfo = {
						models: session.models.map(model => ({ provider: model.provider, id: model.id, name: model.name })),
						current: session.state.model ?? null,
					};
					this.#json(response, 200, models);
					return;
				}
				case "thinking": {
					if (method === "GET") {
						let levels: string[] = [];
						try {
							levels = await session.thinkingLevels();
						} catch (error) {
							this.#json(response, 502, { error: (error as Error).message });
							return;
						}
						const info: ThinkingInfo = { levels, current: session.state.thinkingLevel ?? null };
						this.#json(response, 200, info);
						return;
					}
					if (method === "POST") {
						const body = (await this.#readJson(request)) as { level?: unknown };
						const level = typeof body.level === "string" ? body.level : "";
						if (!(THINKING_LEVELS as readonly string[]).includes(level)) {
							this.#json(response, 400, { error: "thinking level 不认识" });
							return;
						}
						try {
							await session.setThinkingLevel(level as ThinkingLevel);
						} catch (error) {
							this.#json(response, 502, { error: (error as Error).message });
							return;
						}
						this.#json(response, 200, { level });
						return;
					}
					break;
				}
				case "policies": {
					this.#json(response, 200, { policies: session.policies });
					return;
				}
				case "messages": {
					this.#json(response, 200, { messages: session.messages });
					return;
				}
				case "state": {
					this.#json(response, 200, { state: session.state });
					return;
				}
				case "export": {
					const path = await session.exportHtml();
					this.#json(response, 200, { path });
					return;
				}
				case "refresh": {
					await Promise.all([session.refreshState(), session.refreshMessages()]);
					this.#json(response, 200, { state: session.state, messages: session.messages });
					return;
				}
				case "rewind": {
					if (method !== "POST") break;
					const body = (await this.#readJson(request)) as { entryId?: unknown };
					const entryId = typeof body.entryId === "string" ? body.entryId.trim() : "";
					if (!entryId) {
						this.#json(response, 400, { error: "缺少 entryId" });
						return;
					}
					try {
						this.#json(response, 200, await session.rewind(entryId));
					} catch (error) {
						// A refusal changed nothing: same conversation, same files.
						if (!(error instanceof RewindRefused)) throw error;
						this.#json(response, 409, { error: error.message, code: error.code });
					}
					return;
				}
			}
		}

		this.#json(response, 404, { error: "not found" });
	}

	/** A folder must exist and be a directory before it can become a project. */
	#projectProblem(cwd: string): string | null {
		if (!cwd) return "请选择一个文件夹";
		if (!existsSync(cwd)) return `文件夹不存在：${cwd}`;
		try {
			if (!statSync(cwd).isDirectory()) return `这不是文件夹：${cwd}`;
		} catch {
			return `无法访问文件夹：${cwd}`;
		}
		return null;
	}

	async #pickFolder(signal?: AbortSignal): Promise<string | null> {
		if (process.platform !== "win32") {
			throw new Error("当前系统不支持系统文件夹对话框，请手动填写路径");
		}
		const encoded = Buffer.from(PICK_SCRIPT, "utf16le").toString("base64");
		this.#picking = true;
		try {
			const { stdout } = await runPicker(["powershell.exe", "-NoProfile", "-STA", "-EncodedCommand", encoded], {
				timeout: PICK_TIMEOUT_MS,
				signal,
			});
			// PowerShell can emit progress/CLIXML noise; the path is the last plain line.
			const picked =
				stdout
					.split(/\r?\n/)
					.map(line => line.trim())
					.filter(line => line.length > 1 && !line.startsWith("<") && !line.startsWith("#<"))
					.at(-1) ?? "";
			return picked || null;
		} catch (error) {
			if ((error as Error).name === "AbortError") return null;
			// PowerShell writes progress as CLIXML on stderr; never show that to users.
			const stderr = ((error as { stderr?: string }).stderr ?? "")
				.replace(/#< CLIXML[\s\S]*$/m, "")
				.trim();
			throw new Error(`打开文件夹对话框失败：${stderr || (error as Error).message}`);
		} finally {
			this.#picking = false;
		}
	}

	#createAutomation(input: AutomationInput): Automation {
		const cwd = resolve(input.cwd?.trim() ?? "");
		const problem = this.#projectProblem(cwd);
		if (problem) throw new Error(problem);
		const prompt = input.prompt?.trim();
		if (!prompt) throw new Error("请写下每天要做的事");
		const dailyAt = normalizeClock(input.dailyAt);
		const now = Date.now();
		this.#deps.store.addProject(cwd);
		return {
			id: randomUUID().slice(0, 8),
			name: input.name?.trim() || "未命名自动化",
			cwd,
			phase: input.phase === "build" ? "build" : "plan",
			prompt,
			enabled: input.enabled !== false,
			dailyAt,
			lastRunAt: null,
			lastError: null,
			createdAt: now,
			updatedAt: now,
		};
	}

	async #runAutomation(automation: Automation): Promise<PcbSession> {
		const problem = this.#projectProblem(automation.cwd);
		if (problem) throw new Error(problem);
		const record = PcbSession.create(automation.cwd, {
			name: automation.name,
			phase: automation.phase,
			extensions: false,
		});
		const session = this.#spawn(record);
		session.queuePrompt(automation.prompt);
		this.#deps.hub.broadcast({ t: "session", session: session.summary() });
		// Claim the run now so the daily tick cannot start it twice; report the
		// outcome on the card as soon as omp answers (or fails).
		this.#deps.store.upsertAutomation({ ...automation, lastRunAt: Date.now(), updatedAt: Date.now() });
		this.#broadcastAutomations();
		void session.ready.then(() => {
			const current = this.#findAutomation(automation.id);
			if (!current) return;
			if (session.failure) this.#recordAutomationFailure(current, session.failure);
			else if (current.lastError) {
				this.#deps.store.upsertAutomation({ ...current, lastError: null, updatedAt: Date.now() });
				this.#broadcastAutomations();
			}
		});
		return session;
	}

	#findAutomation(id: string): Automation | undefined {
		return this.#deps.store.automations.find(item => item.id === id);
	}

	#recordAutomationFailure(automation: Automation, message: string) {
		this.#deps.store.upsertAutomation({
			...automation,
			lastRunAt: Date.now(),
			lastError: message,
			updatedAt: Date.now(),
		});
		this.#broadcastAutomations();
		this.#deps.onLog?.(`automation ${automation.id} failed: ${message}`);
	}

	#broadcastProjects() {
		this.#deps.hub.broadcast({ t: "projects", projects: this.#deps.store.projects });
	}

	#broadcastAutomations() {
		this.#deps.hub.broadcast({ t: "automations", automations: this.#deps.store.automations });
	}

	#spawn(record: SessionRecord): PcbSession {
		const session = new PcbSession(record, {
			bin: this.#deps.bin,
			hub: this.#deps.hub,
			store: this.#deps.store,
			onLog: this.#deps.onLog,
			onAuth: providers => {
				this.#auth = providers;
			},
		});
		this.#sessions.set(record.id, session);
		void session.start().catch(error => {
			this.#deps.onLog?.(`session ${record.id} failed: ${(error as Error).message}`);
		});
		return session;
	}

	async #readJson(request: IncomingMessage): Promise<unknown> {
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of request) {
			const buffer = chunk as Buffer;
			size += buffer.byteLength;
			if (size > BODY_LIMIT) throw new Error("request body too large");
			chunks.push(buffer);
		}
		if (chunks.length === 0) return {};
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	}

	#json(response: ServerResponse, status: number, body: unknown) {
		const payload = JSON.stringify(body);
		response.writeHead(status, {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
		});
		response.end(payload);
	}

	#serveStatic(pathname: string, response: ServerResponse) {
		const root = this.#deps.webRoot;
		const relative = normalize(pathname).replace(/^([/\\])+/, "");
		const candidate = join(root, relative);
		const inside = candidate.startsWith(root);
		const file = inside && existsSync(candidate) && statSync(candidate).isFile() ? candidate : undefined;
		const index = join(root, "index.html");

		if (!file && !existsSync(index)) {
			response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
			response.end("PCB UI 还没构建。运行 `npm run build`（或开发模式 `npm run dev`）。");
			return;
		}

		const target = file ?? index;
		const type = CONTENT_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream";
		response.writeHead(200, {
			"content-type": type,
			"cache-control": file ? "public, max-age=60" : "no-store",
		});
		createReadStream(target).pipe(response);
	}

	async close() {
		clearInterval(this.#scheduler);
		await Promise.all([...this.#sessions.values()].map(session => session.close()));
		this.#sessions.clear();
		this.#deps.store.flush();
	}
}

/** Empty string, null, or "HH:mm"; anything else becomes null. */
function normalizeClock(value: string | null | undefined): string | null {
	if (!value) return null;
	const text = value.trim();
	if (!text) return null;
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
		throw new Error("时间格式应为 HH:mm，例如 09:30");
	}
	return text;
}
