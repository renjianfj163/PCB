import { spawn } from "node:child_process";
import { parseTarget } from "./frame-check.ts";

/**
 * Hand a page to the machine's own browser.
 *
 * That browser loads it as a top-level document, so X-Frame-Options and CSP
 * frame-ancestors simply do not apply — the cheapest way to show a site this
 * rail is not allowed to frame.
 */
export function openInSystemBrowser(raw: string): Promise<{ ok: boolean; reason?: string }> {
	const target = parseTarget(raw);
	if (typeof target === "string") return Promise.resolve({ ok: false, reason: target });
	const url = target.toString();
	const command =
		process.platform === "win32"
			? { file: "rundll32", args: ["url.dll,FileProtocolHandler", url] }
			: process.platform === "darwin"
				? { file: "open", args: [url] }
				: { file: "xdg-open", args: [url] };
	return new Promise(resolve => {
		const child = spawn(command.file, command.args, { detached: true, stdio: "ignore", windowsHide: true });
		child.once("error", error => resolve({ ok: false, reason: error.message }));
		child.once("spawn", () => {
			child.unref();
			resolve({ ok: true });
		});
	});
}
