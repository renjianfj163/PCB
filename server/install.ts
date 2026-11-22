/**
 * Machine-facing half of the settings page: what this PCB is, whether GitHub has
 * a newer release, and the three things only the server may do — start the
 * installer, open an omp login console, reveal the window log.
 *
 * Nothing here writes user data: the installer owns the install tree, and the
 * updater only downloads into the temp folder.
 */

import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { InstallInfo, UpdateCheck } from "../shared/protocol.ts";
import { isNewer } from "../shared/version.ts";

const LATEST_RELEASE = "https://api.github.com/repos/renjianfj163/PCB/releases/latest";
const UNINSTALL_KEY = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PCB";
const USER_AGENT = "PCB-updater";

/** The folder the installer registered under HKCU, or null when nothing is installed. */
export function registeredDir(): string | null {
	if (process.platform !== "win32") return null;
	try {
		const output = execFileSync("reg", ["query", `HKCU\\${UNINSTALL_KEY}`, "/v", "InstallLocation"], {
			encoding: "utf8",
			windowsHide: true,
		});
		const match = /InstallLocation\s+REG_SZ\s+(.+)/i.exec(output);
		const dir = match?.[1]?.trim();
		return dir && existsSync(join(dir, "PCBWindow.exe")) ? dir : null;
	} catch {
		return null;
	}
}

function metaVersion(dir: string): string | null {
	const file = join(dir, "install-meta.txt");
	if (!existsSync(file)) return null;
	try {
		for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
			if (line.startsWith("Version=")) return line.slice("Version=".length).trim() || null;
		}
	} catch {
		// A half-written meta file is the same as no meta file.
	}
	return null;
}

function packageVersion(root: string): string {
	try {
		const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string };
		return typeof pkg.version === "string" ? pkg.version : "unknown";
	} catch {
		return "unknown";
	}
}

/** `<LOCALAPPDATA>\PCB\window.log`, the file the shell writes its errors to. */
export function logFile(): string {
	const base = process.env.LOCALAPPDATA;
	return base ? join(base, "PCB", "window.log") : "";
}

/** Installed package or checkout: both answer the same question the same way. */
export function installInfo(root: string): InstallInfo {
	const installed = metaVersion(root) !== null && existsSync(join(root, "PCBWindow.exe"));
	return {
		installed,
		dir: installed ? root : null,
		version: (installed ? metaVersion(root) : null) ?? packageVersion(root),
		sourceVersion: packageVersion(root),
		logFile: logFile(),
	};
}

interface Release {
	version: string;
	url: string;
	notes: string;
}

async function latestRelease(): Promise<Release> {
	const reply = await fetch(LATEST_RELEASE, {
		headers: { "user-agent": USER_AGENT, accept: "application/vnd.github+json" },
	});
	if (!reply.ok) throw new Error(`GitHub 返回 ${reply.status}`);
	const data = (await reply.json()) as {
		tag_name?: string;
		body?: string;
		assets?: Array<{ name?: string; browser_download_url?: string }>;
	};
	const asset = (data.assets ?? []).find(item => /^PCB-.*\.exe$/i.test(String(item.name ?? "")));
	if (!asset?.browser_download_url) throw new Error("这个发布里没有 Windows 安装包");
	return {
		version: String(data.tag_name ?? "").replace(/^v/, ""),
		url: asset.browser_download_url,
		notes: String(data.body ?? ""),
	};
}

/** Never throws: "could not read GitHub" is an answer the page can show. */
export async function checkUpdate(root: string): Promise<UpdateCheck> {
	const current = installInfo(root).version;
	try {
		const release = await latestRelease();
		return {
			current,
			latest: release.version,
			url: release.url,
			notes: release.notes,
			hasUpdate: isNewer(release.version, current),
		};
	} catch (error) {
		return { current, latest: null, url: null, notes: "", hasUpdate: false, error: (error as Error).message };
	}
}

/**
 * Download the release asset into the temp folder and start it. An installed PCB
 * is upgraded in place and reopened; a checkout without a registered folder gets
 * the installer's own first screen, so the user picks the folder themselves.
 */
export async function downloadAndRun(url: string, version: string): Promise<{ manual: boolean }> {
	const folder = join(tmpdir(), "pcb-update");
	mkdirSync(folder, { recursive: true });
	const file = join(folder, `PCB-${version}-windows-x64.exe`);

	const reply = await fetch(url, { headers: { "user-agent": USER_AGENT }, redirect: "follow" });
	if (!reply.ok || !reply.body) throw new Error(`下载失败：HTTP ${reply.status}`);
	await pipeline(Readable.fromWeb(reply.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(file));

	const dir = registeredDir();
	spawn(file, dir ? ["--silent", "--dir", dir, "--relaunch"] : [], { detached: true, stdio: "ignore" }).unref();
	return { manual: !dir };
}

/**
 * The argv that runs `exe <args>` in a console the user can see, through cmd's
 * `start`. Never one long string: Node would quote it whole and escape the inner
 * quotes as \" — cmd does not unescape them, and Windows ends up trying to start
 * a program called `\`.
 */
export function consoleArgs(exe: string, rest: string[]): string[] {
	return ["/d", "/c", "start", "", exe].concat(rest);
}

/**
 * Run `omp login` in a console the user can see. The server is a windowless node
 * process, so the console has to come from `cmd /c start`, not from spawn.
 */
export function openLogin(root: string, bin: string): { ok: boolean; error?: string } {
	const explicit = bin.includes("\\") || bin.includes("/");
	const bundled = join(root, "omp.exe");
	const omp = explicit ? bin : existsSync(bundled) ? bundled : bin || "omp";

	if ((omp.includes("\\") || omp.includes("/")) && !existsSync(omp)) {
		return { ok: false, error: "找不到 omp.exe" };
	}
	if (process.platform === "win32") {
		spawn("cmd.exe", consoleArgs(omp, ["login"]), {
			detached: true,
			stdio: "ignore",
			windowsHide: false,
		}).unref();
	} else {
		spawn(omp, ["login"], { detached: true, stdio: "ignore" }).unref();
	}
	return { ok: true };
}

/** Reveal the window log; the file only exists after the shell has written one. */
export function openLog(): { ok: boolean; path: string } {
	const file = logFile();
	if (!file) return { ok: false, path: "" };
	const target = existsSync(file) ? `/select,${file}` : file.slice(0, file.lastIndexOf("\\"));
	if (process.platform === "win32") {
		spawn("explorer.exe", [target], { detached: true, stdio: "ignore" }).unref();
	} else {
		return { ok: false, path: file };
	}
	return { ok: true, path: file };
}
