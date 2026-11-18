/**
 * A VS Code web server for this machine, started at most once per PCB process.
 *
 * The browser window is just a window: omp stays the one PCB already launched,
 * and the omp-ckpt extension inside that server talks to the same PCB session
 * (its Chat is a PCB client). Nothing here opens an editor *inside* the shell.
 */

import { spawn, spawnSync, type ChildProcess, type StdioOptions } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { connect } from "node:net";
import { basename, delimiter, join } from "node:path";
import { systemProxy } from "./proxy.ts";

const LOOPBACK = "127.0.0.1";
/** Without this the first launch stops at an interactive license prompt. */
const LICENSE = "--accept-server-license-terms";
/** The extension's Chat connects to PCB; installed once, before the page is offered. */
const DEFAULT_VSIX = "D:\\Developer\\zed_omp\\omp-ckpt-0.1.0.vsix";
const START_TIMEOUT_MS = 45_000;
const URL_PATTERN = /https?:\/\/127\.0\.0\.1:[0-9]+[^\s"']*/;

export const NO_SERVER = "本机没有 VS Code 网页服务";

export interface IdeResult {
	ok: boolean;
	/** The local page to open; present when ok. */
	url?: string;
	/** One line for the user; present when not ok. */
	reason?: string;
}

type Flavor = "openvscode" | "code";

interface Candidate {
	file: string;
	flavor: Flavor;
}

interface Server {
	url: string;
	child: ChildProcess;
	/** The folder the server was started for; a later click keeps this one. */
	cwd: string;
}

/**
 * Which protocol answers on this port. 10808 here is a SOCKS5 port, not an HTTP
 * proxy: an HTTPS_PROXY pointing at it makes the editor's downloader hang with a
 * connected socket and no reply.
 */
type ProxyKind = "socks" | "http" | "unknown";

const PROBE_TIMEOUT_MS = 800;

function proxyAddress(proxy: string): { host: string; port: number; scheme: string } | null {
	try {
		const url = new URL(proxy.includes("://") ? proxy : `http://${proxy}`);
		const fallback = url.protocol === "https:" ? 443 : url.protocol === "socks5:" || url.protocol === "socks:" ? 1080 : 80;
		const port = Number(url.port || fallback);
		if (!url.hostname || !Number.isInteger(port) || port <= 0) return null;
		return { host: url.hostname, port, scheme: url.protocol.replace(":", "") };
	} catch {
		return null;
	}
}

/** Ask the port what it speaks: SOCKS5 answers 05 to `05 01 00`, an HTTP proxy a status line. */
function probeProxy(host: string, port: number): Promise<ProxyKind> {
	return new Promise(resolve => {
		let settled = false;
		const socket = connect({ host, port });
		const done = (kind: ProxyKind) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			resolve(kind);
		};
		const timer = setTimeout(() => done("unknown"), PROBE_TIMEOUT_MS);
		const isHttp = (data: Buffer) => /^HTTP\//i.test(data.toString("latin1", 0, Math.min(data.length, 5)));
		socket.once("error", () => done("unknown"));
		socket.once("connect", () => {
			socket.write(Buffer.from([0x05, 0x01, 0x00]));
			socket.once("data", (first: Buffer) => {
				if (first[0] === 0x05) return done("socks");
				if (isHttp(first)) return done("http");
				// Not a SOCKS answer and not a status line: one plain HTTP request settles it.
				socket.write("GET http://127.0.0.1:9/ HTTP/1.1\r\nHost: 127.0.0.1:9\r\nConnection: close\r\n\r\n");
				socket.once("data", (second: Buffer) => done(isHttp(second) ? "http" : "unknown"));
			});
		});
	});
}

/** Probe once, remember it, and never guess: unknown means no proxy for the child. */
async function detectKind(proxy: string, cache: { kind: ProxyKind | null }): Promise<ProxyKind> {
	if (cache.kind) return cache.kind;
	const target = proxyAddress(proxy);
	if (!target) return (cache.kind = "unknown");
	const scheme = target.scheme.toLowerCase();
	const kind: ProxyKind =
		scheme === "socks" || scheme === "socks5"
			? "socks"
			: await probeProxy(target.host, target.port);
	cache.kind = kind;
	return kind;
}

/**
 * The server fetches its web client from the internet, and this class of machine
 * only reaches the internet through its proxy — Node ignores the WinINET setting,
 * so the environment has to carry it, in the flavour the port actually speaks.
 */
function proxyEnv(env: NodeJS.ProcessEnv, proxy: string | null, kind: ProxyKind): NodeJS.ProcessEnv {
	if (!proxy) return env;
	const target = proxyAddress(proxy);
	const address = target ? `${target.host}:${target.port}`.toLowerCase() : "";
	const next = { ...env };
	/** Proxy variables that already name this very address are ours to correct. */
	const pointsHere = (value: string | undefined) =>
		address.length > 0 && typeof value === "string" && value.toLowerCase().includes(address);

	next.NO_PROXY = env.NO_PROXY ?? "127.0.0.1,localhost";

	if (kind === "socks" && target) {
		const socks = `socks5://${address}`;
		next.ALL_PROXY = socks;
		next.all_proxy = socks;
		for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] as const) {
			if (pointsHere(next[key])) delete next[key];
		}
		return next;
	}

	if (kind === "http") {
		next.HTTP_PROXY = env.HTTP_PROXY ?? proxy;
		next.HTTPS_PROXY = env.HTTPS_PROXY ?? proxy;
		return next;
	}

	// Unknown protocol: straight out, with nothing of ours claiming otherwise.
	for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"] as const) {
		if (pointsHere(next[key])) delete next[key];
	}
	delete next.NO_PROXY;
	return next;
}

/** `code.cmd` / `.bat` go through the shell (as cmd itself would); everything else spawns directly. */
function spawnProgram(
	file: string,
	args: string[],
	options: { cwd?: string; stdio: "pipe" | "ignore"; env: NodeJS.ProcessEnv },
): ChildProcess {
	const stdio: StdioOptions = options.stdio === "pipe" ? ["ignore", "pipe", "pipe"] : "ignore";
	if (isShim(file)) {
		// Quoted here rather than by Node, so a path with spaces survives the shell.
		return spawn(shellLine(file, args), [], {
			cwd: options.cwd,
			stdio,
			env: options.env,
			windowsHide: true,
			shell: true,
		});
	}
	return spawn(file, args, { cwd: options.cwd, stdio, env: options.env, windowsHide: true });
}

/** Runs `name` from PATH the way the shell would. */
function findOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
	const roots = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
	const extensions =
		process.platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
	for (const root of roots) {
		for (const extension of extensions) {
			const file = join(root, `${name}${extension.toLowerCase()}`);
			if (existsSync(file)) return file;
			const upper = join(root, `${name}${extension}`);
			if (existsSync(upper)) return upper;
		}
	}
	return null;
}

/** `"C:\path with spaces\code.cmd" "serve-web" "--help"` — one shell line, quoted by hand. */
function shellLine(file: string, args: string[]): string {
	const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
	return [quote(file), ...args.map(quote)].join(" ");
}

function isShim(file: string): boolean {
	return process.platform === "win32" && /\.(cmd|bat)$/i.test(file);
}

/** Run to completion and hand back the combined output; used for probes and installs. */
function syncRun(file: string, args: string[], timeout: number): { status: number | null; text: string } {
	const result = isShim(file)
		? spawnSync(shellLine(file, args), { shell: true, encoding: "utf8", timeout, windowsHide: true })
		: spawnSync(file, args, { encoding: "utf8", timeout, windowsHide: true });
	return { status: result.status, text: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** `code serve-web` only counts if this build actually has the subcommand. */
function respondsToServeWeb(file: string): boolean {
	const { text } = syncRun(file, ["serve-web", "--help"], 20_000);
	return /serve-web/i.test(text) && /--host/i.test(text);
}

function flavorOf(file: string): Flavor {
	return /openvscode/i.test(basename(file)) ? "openvscode" : "code";
}

/** Everything we might start, in the order the user asked for. */
function candidates(env: NodeJS.ProcessEnv): Candidate[] {
	const forced = env.PCB_VSCODE_WEB?.trim();
	if (forced) return existsSync(forced) ? [{ file: forced, flavor: flavorOf(forced) }] : [];

	const found: Candidate[] = [];
	const standalone = findOnPath("openvscode-server", env);
	if (standalone) found.push({ file: standalone, flavor: "openvscode" });

	const code = findOnPath("code", env);
	if (code && respondsToServeWeb(code)) found.push({ file: code, flavor: "code" });

	// A Cursor install shadows `code` on PATH; the real thing still counts.
	for (const root of [env.LOCALAPPDATA, env.ProgramFiles, env["ProgramFiles(x86)"]]) {
		if (!root) continue;
		for (const dir of ["Microsoft VS Code", "Microsoft VS Code Insiders"]) {
			const file = join(root, "Programs", dir, "bin", "code.cmd");
			if (existsSync(file) && respondsToServeWeb(file)) found.push({ file, flavor: "code" });
		}
	}
	return found;
}

/** The shim is a shell; the server it started is its child, so a plain kill would orphan it. */
function killTree(child: ChildProcess) {
	if (child.exitCode !== null || child.killed) return;
	if (process.platform === "win32" && child.pid) {
		spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
		return;
	}
	try {
		child.kill();
	} catch {
		// already gone
	}
}

export interface IdeManager {
	/** Start (once) and hand back the local page for this folder. */
	open(cwd: string): Promise<IdeResult>;
	/** The page of the running server, or null. */
	current(): string | null;
	/** Test/teardown hook: kill the server this manager started, if any. */
	stop(): void;
}

/** What this machine would start, in order. Exported so the choice is inspectable. */
export function ideCandidates(env: NodeJS.ProcessEnv = process.env): Array<{ file: string; flavor: Flavor }> {
	return candidates(env);
}

export function createIdeManager(options: { env?: NodeJS.ProcessEnv; proxy?: string | null } = {}): IdeManager {
	const env = options.env ?? process.env;
	/** undefined = ask the machine; null = deliberately none (tests). */
	const proxy = options.proxy === undefined ? systemProxy() : options.proxy;
	const detected: { kind: ProxyKind | null } = { kind: null };
	const vsix = env.PCB_CKPT_VSIX?.trim() || DEFAULT_VSIX;
	let server: Server | null = null;
	let starting: Promise<IdeResult> | null = null;
	let installed = false;

	const alive = () => server !== null && server.child.exitCode === null && !server.child.killed;

	/** `--install-extension` once per process, before the first page is served. */
	function installExtension(candidate: Candidate) {
		if (installed || !existsSync(vsix)) {
			installed = true;
			return;
		}
		installed = true;
		// The page is offered either way: a failed install must not block the editor.
		syncRun(candidate.file, ["--install-extension", vsix], 120_000);
	}

	/** One launch attempt; resolves with the page or a sentence for the user. */
	async function start(candidate: Candidate, cwd: string): Promise<IdeResult> {
		installExtension(candidate);
		const kind: ProxyKind = proxy ? await detectKind(proxy, detected) : "unknown";
		const withFolder = candidate.flavor === "openvscode";
		const base = candidate.flavor === "code" ? ["serve-web"] : [];
		const args = [
			...base,
			"--host",
			LOOPBACK,
			// 0 = let the server pick a free port; nothing is pinned on 0.0.0.0.
			"--port",
			"0",
			LICENSE,
			...(withFolder ? ["--default-folder", cwd] : []),
		];
		const child = spawnProgram(candidate.file, args, { cwd, stdio: "pipe", env: proxyEnv(env, proxy, kind) });
		const chunks: string[] = [];
		let url: string | null = null;

		return await new Promise<IdeResult>(resolve => {
			const finish = (result: IdeResult) => {
				clearTimeout(timer);
				if (!result.ok) killTree(child);
				resolve(result);
			};
			const scan = (text: string) => {
				const match = URL_PATTERN.exec(text);
				if (!match || url) return;
				url = match[0];
				// A build without --default-folder takes the folder as a query parameter.
				const page = new URL(url);
				if (!withFolder) page.searchParams.set("folder", cwd);
				server = { url: page.toString(), child, cwd };
				finish({ ok: true, url: server.url });
			};
			const timer = setTimeout(() => finish({ ok: false, reason: "VS Code 网页服务没有给出地址" }), START_TIMEOUT_MS);
			child.stdout?.setEncoding("utf8");
			child.stdout?.on("data", (chunk: string) => {
				chunks.push(chunk);
				scan(chunk);
			});
			child.stderr?.setEncoding("utf8");
			child.stderr?.on("data", (chunk: string) => {
				chunks.push(chunk);
				scan(chunk);
			});
			child.once("error", () => finish({ ok: false, reason: "VS Code 网页服务没能启动" }));
			child.once("exit", () => {
				if (url) return;
				const detail = chunks.join("").trim().split("\n").pop() ?? "";
				finish({ ok: false, reason: detail || "VS Code 网页服务退出了" });
			});
		});
	}

	async function open(cwd: string): Promise<IdeResult> {
		if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) return { ok: false, reason: "这个目录不存在" };
		// One server per PCB process: a second click only reopens the page.
		if (alive() && server) return { ok: true, url: server.url };
		if (starting) return starting;

		const list = candidates(env);
		if (list.length === 0) return { ok: false, reason: NO_SERVER };

		starting = (async () => {
			let last: IdeResult = { ok: false, reason: NO_SERVER };
			for (const candidate of list) {
				last = await start(candidate, cwd);
				if (last.ok) return last;
			}
			return last;
		})().finally(() => {
			starting = null;
		});
		return starting;
	}

	return {
		open,
		current: () => (alive() && server ? server.url : null),
		stop() {
			if (!server) return;
			killTree(server.child);
			server = null;
		},
	};
}

const shared = createIdeManager();

/** Start (once) the machine's VS Code web server for this folder. */
export function openIde(cwd: string): Promise<IdeResult> {
	return shared.open(cwd);
}

/** The page of a server that is already running, or null — used to skip the waiting screen. */
export function peekIde(): string | null {
	return shared.current();
}
