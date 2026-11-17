import { spawn } from "node:child_process";
import type { ExecResult, ShellKind } from "../shared/protocol.ts";

const LIMIT = 64 * 1024;
const TIMEOUT_MS = 60_000;

/** Commands whose whole point is to move the shell somewhere else. */
const MOVES = /^\s*(cd|chdir|pushd|popd|set-location|sl)\b/i;

/** A line that is a directory, not the answer to a command. */
const LOOKS_LIKE_PATH = /^\s*(?:[A-Za-z]:[\\/]|\\\\|\/)[^\n]*$/;

/**
 * Read the working directory back out of the trailing line of a `cd`.
 *
 * Each command is its own process, so nothing would otherwise remember where the
 * previous `cd` landed. Only directory changes pay the extra cost: they run once
 * more with the location printed at the end, and that last line becomes the new
 * prompt. Everything else keeps its real exit code untouched.
 */
function splitTrailer(raw: string): { output: string; cwd?: string } {
	const trimmed = raw.replace(/[\r\n]+$/, "");
	const cut = Math.max(trimmed.lastIndexOf("\n"), trimmed.lastIndexOf("\r"));
	const last = cut < 0 ? trimmed : trimmed.slice(cut + 1);
	if (!LOOKS_LIKE_PATH.test(last)) return { output: raw };
	return { output: cut < 0 ? "" : trimmed.slice(0, cut).replace(/[\r\n]+$/, ""), cwd: last.trim() };
}

/**
 * Command output arrives in whichever encoding the tool picked: UTF-8 from most
 * modern tools, the console code page (GBK here) from cmd built-ins. Read it as
 * UTF-8 when that is valid, otherwise fall back once.
 */
function decode(chunks: Buffer[]): string {
	const buffer = Buffer.concat(chunks);
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
	} catch {
		return new TextDecoder("gbk").decode(buffer).replace(/\uFFFD/g, "?");
	}
}

/**
 * PowerShell takes the script as an argument, not on stdin: stdin is decoded with
 * the console code page (GBK here), which would mangle any Chinese in the command,
 * while arguments are passed as UTF-16. Lines stay separate so an error quotes the
 * user's own line and not our encoding prelude.
 */
function powerShellScript(command: string, moves: boolean): string {
	const lines = [
		"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [Console]::OutputEncoding",
		command,
	];
	if (moves) lines.push("(Get-Location).Path");
	return lines.join("\n");
}

/**
 * One command, run where the user asked, captured as text.
 *
 * This is the user's own keystroke, not the agent's: the plan/build policy does
 * not apply here, which is why it is kept separate from the session's queue and
 * only reachable from the local UI (loopback + request marker).
 */
export function runCommand(cwd: string, command: string, shell: ShellKind = "cmd"): Promise<ExecResult> {
	const windows = process.platform === "win32";
	const moves = MOVES.test(command);

	return new Promise(resolve => {
		const started = Date.now();
		// cmd.exe speaks the console code page, which garbles Chinese output; ask
		// it for UTF-8 first, then decode every chunk as a stream so a character
		// split across two chunks still arrives whole. PowerShell needs the same
		// request made in its own dialect.
		const child = !windows
			? spawn(moves ? `${command}; pwd` : command, { cwd, shell: true, windowsHide: true })
			: shell === "powershell"
				? spawn("powershell.exe", ["-NoProfile", "-NoLogo", "-NonInteractive", "-Command", powerShellScript(command, moves)], {
						cwd,
						windowsHide: true,
					})
				: spawn(moves ? `chcp 65001 >nul && ${command} & cd` : command, {
						cwd,
						shell: true,
						windowsHide: true,
					});

		const chunks: Buffer[] = [];
		let bytes = 0;
		let truncated = false;
		let settled = false;

		const finish = (code: number | null, timedOut = false) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			const text = decode(chunks);
			// Truncation eats the tail, so a cut-off stream keeps the old directory.
			const { output, cwd: landed } = moves && !truncated ? splitTrailer(text) : { output: text, cwd: undefined };
			resolve({
				code,
				output,
				truncated,
				timedOut,
				ms: Date.now() - started,
				shell,
				...(landed ? { cwd: landed } : {}),
			});
		};

		const timer = setTimeout(() => {
			child.kill();
			finish(null, true);
		}, TIMEOUT_MS);

		const collect = (chunk: Buffer) => {
			if (truncated) return;
			chunks.push(chunk);
			bytes += chunk.byteLength;
			if (bytes > LIMIT) truncated = true;
		};

		child.stdout?.on("data", collect);
		child.stderr?.on("data", collect);
		child.on("error", error => {
			chunks.push(Buffer.from(`${chunks.length > 0 ? "\n" : ""}${error.message}`));
			finish(null);
		});
		child.on("close", code => finish(code));
	});
}
