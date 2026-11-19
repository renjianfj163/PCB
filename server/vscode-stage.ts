import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { systemProxy } from "./proxy.ts";

/**
 * `code serve-web` bootstraps itself by downloading a ~90 MB web-client zip from
 * update.code.visualstudio.com and unpacking it into
 * `<cli>/serve-web/<commit>/`. On a machine that cannot reach that host — or whose
 * downloader stalls behind a proxy — the page sits on "downloading" forever.
 *
 * So when the customer already has the zip, put it where the CLI expects it:
 *
 *   PCB_VSCODE_SERVER_FILE  a file already on this machine
 *   PCB_VSCODE_SERVER_URL   an address only this machine can reach (a mirror)
 *
 * Either way the bytes land in `<cli>/serve-web/<commit>/` before launch, and the
 * CLI finds a complete directory instead of downloading one.
 */
export interface StageOptions {
	env: NodeJS.ProcessEnv;
	/** The launcher that was chosen; its `.staging` neighbour names the commit. */
	cli: string;
	/** Overrides the `<home>/.vscode/cli` root (tests, or a relocated VS Code). */
	cliRoot?: string;
}

export interface StageResult {
	/** True when a directory for the commit is now in place. */
	staged: boolean;
	/** Why it could not be done; meant for the log, not the user. */
	note?: string;
}

/** Where the CLI keeps the web-client builds. */
export function serveWebRoot(options: StageOptions): string {
	const root = options.cliRoot ?? options.env.PCB_VSCODE_CLI_DIR?.trim() ?? join(homedir(), ".vscode", "cli");
	return join(root, "serve-web");
}

/** The commit the CLI would download, learned from the folder it left behind. */
export function targetCommit(options: StageOptions): string | null {
	// The build is "the latest server", not this client's commit: only a `.staging`
	// folder the CLI left behind names it, so `code --version` is no help here.
	return stagedCommits(options)[0] ?? null;
}

/** Same thing for the running process: what the CLI is fetching right now, if known. */
export function currentServerCommit(env: NodeJS.ProcessEnv = process.env): string | null {
	return targetCommit({ env, cli: "" });
}

/** `<commit>` directories and `<commit>.staging` leftovers, newest first. */
function stagedCommits(options: StageOptions): string[] {
	const root = serveWebRoot(options);
	if (!existsSync(root)) return [];
	try {
		return readdirSync(root)
			.map(name => ({ name, full: join(root, name) }))
			.filter(entry => {
				try {
					return statSync(entry.full).isDirectory();
				} catch {
					return false;
				}
			})
			.map(entry => entry.name.replace(/\.staging$/, ""))
			.filter(name => /^[0-9a-f]{40}$/i.test(name))
			.sort()
			.reverse();
	} catch {
		return [];
	}
}

/** Whether the customer pointed PCB at a package of their own. */
export function hasLocalPackage(env: NodeJS.ProcessEnv): boolean {
	return Boolean(env.PCB_VSCODE_SERVER_FILE?.trim() || env.PCB_VSCODE_SERVER_URL?.trim());
}

/**
 * Make sure the web client for this machine is unpacked, using the customer's own
 * copy when they published one. Never throws: a failure only means the CLI's own
 * download is still the only route.
 */
export async function stageServer(options: StageOptions): Promise<StageResult> {
	const file = options.env.PCB_VSCODE_SERVER_FILE?.trim();
	const url = options.env.PCB_VSCODE_SERVER_URL?.trim();
	if (!file && !url) return { staged: false, note: "no local package configured" };

	const commit = targetCommit(options);
	if (!commit) return { staged: false, note: "the server build's commit is unknown" };

	const root = serveWebRoot(options);
	const dest = join(root, commit);
	if (existsSync(dest)) return { staged: true, note: "already staged" };

	let archive = file && existsSync(file) ? file : "";
	try {
		mkdirSync(root, { recursive: true });
		if (!archive && url) archive = await download(url, root);
		if (!archive) return { staged: false, note: "the configured file does not exist" };
		// Unpack exactly as the CLI would, into the commit's own directory.
		mkdirSync(dest, { recursive: true });
		await untar(archive, dest);
		return { staged: true };
	} catch (error) {
		rmSync(dest, { recursive: true, force: true, maxRetries: 3 });
		return { staged: false, note: (error as Error).message };
	} finally {
		if (archive && archive !== file) rmSync(archive, { force: true });
	}
}

/** One archive, through the machine's proxy when there is one. */
function download(url: string, dir: string): Promise<string> {
	const target = join(dir, "pcb-server-download.zip");
	const proxy = systemProxy();
	const args = ["-sSL", "--fail", "--connect-timeout", "15", "--max-time", "900", "-o", target];
	if (proxy) args.push("-x", proxy);
	args.push(url);
	return new Promise((resolve, reject) => {
		execFile("curl", args, { timeout: 900_000, windowsHide: true, maxBuffer: 1 << 20 }, error => {
			if (error) {
				reject(new Error(`下载失败：${String((error as { stderr?: string }).stderr ?? error.message).trim().split("\n").pop() ?? ""}`));
				return;
			}
			resolve(target);
		});
	});
}

/** bsdtar reads zips everywhere Node ships; PowerShell is the older fallback. */
async function untar(archive: string, dest: string): Promise<void> {
	try {
		await run("tar", ["-xf", archive, "-C", dest]);
		return;
	} catch {
		// Windows without bsdtar: let PowerShell do it.
	}
	await run("powershell", [
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		`Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
	]);
}

function run(file: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile(file, args, { timeout: 600_000, windowsHide: true, maxBuffer: 1 << 20 }, error => {
			if (error) reject(error);
			else resolve();
		});
	});
}
