import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PageShot } from "../shared/protocol.ts";
import { parseTarget, resolveHost } from "./frame-check.ts";

const TIMEOUT_MS = 30_000;
/** Tall enough for a landing page, narrow enough to read at rail width. */
const WINDOW = "820,1500";
/** A page that is still animating paint when the clock runs out is a failed shot. */
const SETTLE_MS = "9000";

/** A local Chromium is the whole trick: it fetches the page as itself, so headers about framing do not matter. */
function findBrowser(): string | null {
	const override = process.env.PCB_CHROME;
	if (override && existsSync(override)) return override;
	const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(
		(root): root is string => typeof root === "string" && root.length > 0,
	);
	const candidates: string[] = [];
	if (process.platform === "win32") {
		for (const root of roots) {
			candidates.push(
				join(root, "Google", "Chrome", "Application", "chrome.exe"),
				join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
			);
		}
	} else if (process.platform === "darwin") {
		candidates.push(
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		);
	} else {
		candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge");
	}
	return candidates.find(candidate => existsSync(candidate)) ?? null;
}

function once(browser: string, url: string, dir: string, out: string): Promise<{ code: number | null; stderr: string }> {
	// A throwaway profile per shot: no bookmarks, no extensions, no shared cookies.
	const args = [
		"--headless=new",
		"--disable-gpu",
		"--hide-scrollbars",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-extensions",
		"--disable-background-networking",
		"--disable-sync",
		`--user-data-dir=${join(dir, "profile")}`,
		`--virtual-time-budget=${SETTLE_MS}`,
		`--window-size=${WINDOW}`,
		`--screenshot=${out}`,
		url,
	];
	return new Promise(resolve => {
		execFile(browser, args, { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1 << 20 }, (error, _stdout, stderr) => {
			const code = error && typeof (error as { code?: unknown }).code === "number" ? Number((error as { code?: number }).code) : error ? null : 0;
			resolve({ code, stderr: String(stderr ?? "") });
		});
	});
}

/**
 * Render a page into a PNG with the local browser.
 *
 * Some sites (and every site that sends X-Frame-Options) will never appear in an
 * iframe, and no amount of header juggling changes that. A browser that loads
 * the page itself is not framing anything, so the picture always works — as long
 * as the machine can reach it at all.
 */
export async function pageShot(raw: string): Promise<PageShot> {
	const started = Date.now();
	const target = parseTarget(raw);
	if (typeof target === "string") return { ok: false, reason: target };

	// Same refusal as the frame check: a picture of 127.0.0.1 is still an SSRF.
	const resolved = await resolveHost(target);
	if (resolved.refusal) return { ok: false, url: target.toString(), reason: resolved.refusal };

	const browser = findBrowser();
	if (!browser) return { ok: false, url: target.toString(), reason: "这台机器上没找到 Chrome 或 Edge，截不了图" };

	const dir = mkdtempSync(join(tmpdir(), "pcb-shot-"));
	const out = join(dir, "page.png");
	try {
		const { code, stderr } = await once(browser, target.toString(), dir, out);
		if (!existsSync(out)) {
			const hint = /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TUNNEL/.test(stderr)
				? "浏览器也打不开它（域名或网络不通）"
				: "浏览器没能打开这个地址";
			return { ok: false, url: target.toString(), reason: hint, addresses: resolved.addresses, ms: Date.now() - started };
		}
		const png = readFileSync(out);
		if (png.byteLength < 1024) {
			return { ok: false, url: target.toString(), reason: `截图是空的（退出码 ${code ?? "—"}）`, ms: Date.now() - started };
		}
		return {
			ok: true,
			url: target.toString(),
			image: `data:image/png;base64,${png.toString("base64")}`,
			ms: Date.now() - started,
		};
	} catch (error) {
		return { ok: false, url: target.toString(), reason: (error as Error).message, ms: Date.now() - started };
	} finally {
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	}
}
