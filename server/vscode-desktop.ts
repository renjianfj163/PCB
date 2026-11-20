/**
 * Opens the local desktop VS Code for a session folder.
 *
 * omp stays the process PCB already launched. The omp-ckpt extension inside
 * that window is a client: Chat talks to PCB, and review talks to the host's
 * loopback server. Nothing here starts a web server or downloads a package.
 */

import { spawn, spawnSync, type ChildProcess, type StdioOptions } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/** Shown when this machine has no desktop VS Code to open. */
export const NO_CODE = "本机没有 VS Code";

const DEFAULT_VSIX = "D:\\Developer\\zed_omp\\omp-ckpt-0.1.0.vsix";
const OPEN_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 120_000;

export interface IdeResult {
	ok: boolean;
	/** One line for the user; present when not ok. */
	reason?: string;
}

export interface IdeManager {
	/** Install omp-ckpt once, then open this folder in desktop VS Code. */
	open(cwd: string): Promise<IdeResult>;
}

/** `code.cmd` / `.bat` go through the shell; everything else spawns directly. */
function spawnProgram(
	file: string,
	args: string[],
	options: { stdio: "pipe" | "ignore"; env: NodeJS.ProcessEnv },
): ChildProcess {
	const stdio: StdioOptions = options.stdio === "pipe" ? ["ignore", "pipe", "pipe"] : "ignore";
	if (isShim(file)) {
		return spawn(shellLine(file, args), [], {
			stdio,
			env: options.env,
			windowsHide: true,
			shell: true,
		});
	}
	return spawn(file, args, { stdio, env: options.env, windowsHide: true });
}

function findOnPath(name: string, env: NodeJS.ProcessEnv): string[] {
	const roots = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
	const extensions =
		process.platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
	const found: string[] = [];
	for (const root of roots) {
		for (const extension of extensions) {
			for (const suffix of [extension.toLowerCase(), extension]) {
				const file = join(root, `${name}${suffix}`);
				if (existsSync(file) && !found.includes(file)) found.push(file);
			}
		}
	}
	return found;
}

function shellLine(file: string, args: string[]): string {
	const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
	return [quote(file), ...args.map(quote)].join(" ");
}

function isShim(file: string): boolean {
	return process.platform === "win32" && /\.(cmd|bat)$/i.test(file);
}

/** Cursor ships its own `code` and puts it on PATH ahead of VS Code. */
function isCursor(file: string): boolean {
	return /[\\/]cursor[\\/]/i.test(file);
}

function cliName(): string {
	return process.platform === "win32" ? "code.cmd" : "code";
}

/** Stable first, then Insiders; the per-user install before Program Files. */
function installedClis(env: NodeJS.ProcessEnv): string[] {
	const name = cliName();
	const roots = [env.LOCALAPPDATA, env.ProgramFiles, env["ProgramFiles(x86)"]].filter(
		(root): root is string => Boolean(root),
	);
	const products = ["Microsoft VS Code", "Microsoft VS Code Insiders"];
	const found: string[] = [];
	for (const root of roots) {
		for (const product of products) {
			for (const file of [join(root, "Programs", product, "bin", name), join(root, product, "bin", name)]) {
				if (existsSync(file)) found.push(file);
			}
		}
	}
	return found;
}

/** The desktop `code` this machine should launch, or null. */
export function findCode(env: NodeJS.ProcessEnv = process.env): string | null {
	const forced = env.PCB_VSCODE?.trim();
	if (forced) return existsSync(forced) ? forced : null;

	const installed = installedClis(env).find(file => !isCursor(file));
	if (installed) return installed;

	return findOnPath("code", env).find(file => !isCursor(file)) ?? null;
}

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

function run(
	file: string,
	args: string[],
	env: NodeJS.ProcessEnv,
	timeout: number,
): Promise<{ status: number | null; text: string }> {
	return new Promise(resolve => {
		const child = spawnProgram(file, args, { stdio: "pipe", env });
		const chunks: string[] = [];
		let settled = false;
		const finish = (status: number | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ status, text: chunks.join("").trim() });
		};
		const timer = setTimeout(() => {
			killTree(child);
			finish(null);
		}, timeout);
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => chunks.push(chunk));
		child.stderr?.on("data", (chunk: string) => chunks.push(chunk));
		child.once("error", () => finish(null));
		child.once("exit", code => finish(code));
	});
}

function lastLine(text: string): string {
	const line = text
		.split(/\r?\n/)
		.map(part => part.trim())
		.filter(Boolean)
		.pop();
	return (line ?? "").slice(0, 300);
}

export function createIdeManager(options: { env?: NodeJS.ProcessEnv } = {}): IdeManager {
	const env = options.env ?? process.env;
	const vsix = env.PCB_CKPT_VSIX?.trim() || DEFAULT_VSIX;
	let installed = false;
	let tail: Promise<unknown> = Promise.resolve();

	async function install(file: string) {
		if (installed || !existsSync(vsix)) {
			installed = true;
			return;
		}
		installed = true;
		// A failed install must not block the editor; the window still opens.
		await run(file, ["--install-extension", vsix], env, INSTALL_TIMEOUT_MS);
	}

	async function openOne(cwd: string): Promise<IdeResult> {
		if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
			return { ok: false, reason: "这个目录不存在" };
		}
		const file = findCode(env);
		if (!file) return { ok: false, reason: NO_CODE };

		await install(file);
		const opened = await run(file, [cwd], env, OPEN_TIMEOUT_MS);
		if (opened.status === 0) return { ok: true };
		return { ok: false, reason: lastLine(opened.text) || "VS Code 没能启动" };
	}

	return {
		open(cwd: string): Promise<IdeResult> {
			const result = tail.then(() => openOne(cwd));
			tail = result.then(
				() => undefined,
				() => undefined,
			);
			return result;
		},
	};
}

const shared = createIdeManager();

/** Open this folder in the machine's desktop VS Code. */
export function openIde(cwd: string): Promise<IdeResult> {
	return shared.open(cwd);
}
