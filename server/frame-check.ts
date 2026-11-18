import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { FrameCheck } from "../shared/protocol.ts";
import { systemProxy } from "./proxy.ts";

const MAX_HOPS = 3;
const TIMEOUT_MS = 6000;
const USER_AGENT = "Mozilla/5.0 (PCB local shell)";
const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

/** Ranges a browser preview must never reach: loopback, LAN, link-local, CGNAT. */
function isPrivateAddress(address: string): boolean {
	const version = isIP(address);
	if (version === 6) {
		const lower = address.toLowerCase();
		if (lower === "::1" || lower === "::") return true;
		if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
		const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
		return mapped ? isPrivateAddress(mapped[1]!) : false;
	}
	if (version !== 4) return true;
	const [a = 0, b = 0] = address.split(".").map(Number);
	if (a === 0 || a === 10 || a === 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	if (a === 198 && (b === 18 || b === 19)) return true;
	if (a >= 224) return true;
	return false;
}

export function parseTarget(raw: string): URL | string {
	const trimmed = raw.trim();
	if (!trimmed) return "没有地址";
	const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		return "这个地址看不懂";
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return "只预览 http / https 地址";
	if (!url.hostname.includes(".") && url.hostname !== "localhost") return "这个地址看不懂";
	return url;
}

/**
 * Resolve first: a hostname pointing at the router or 127.0.0.1 is refused.
 * The addresses come back either way — an unreachable host that resolves to
 * somebody else's IP is a DNS problem, not a slow site, and saying which IP it
 * answered with is the only way the user can tell the two apart.
 */
export async function resolveHost(
	url: URL,
): Promise<{ addresses: string[]; refusal: string | null }> {
	const host = url.hostname.replace(/^\[|\]$/g, "");
	if (isIP(host)) {
		return { addresses: [host], refusal: isPrivateAddress(host) ? "本机和内网地址不会被预览" : null };
	}
	const found = await lookup(host, { all: true }).catch(() => null);
	if (!found || found.length === 0) return { addresses: [], refusal: `解析不到 ${host}，检查地址或网络` };
	const addresses = found.map(entry => entry.address);
	if (addresses.some(address => isPrivateAddress(address))) {
		return { addresses, refusal: "这个域名指向本机或内网，不预览" };
	}
	return { addresses, refusal: null };
}

/** The two headers that decide it, said in one line. */
function framingRefusal(headers: { get(name: string): string | null }): string | null {
	const xfo = headers.get("x-frame-options")?.toLowerCase() ?? "";
	if (xfo.includes("deny")) return "站点声明 X-Frame-Options: DENY，任何网站都不能内嵌它";
	if (xfo.includes("sameorigin")) return "站点声明 X-Frame-Options: SAMEORIGIN，只允许它自己的页面内嵌";
	const csp = headers.get("content-security-policy") ?? "";
	const directive = csp
		.split(";")
		.map(part => part.trim().toLowerCase())
		.find(part => part.startsWith("frame-ancestors"));
	if (directive) {
		const sources = directive.split(/\s+/).slice(1).filter(Boolean);
		if (!sources.includes("*")) return "站点用 CSP 的 frame-ancestors 限制了谁能内嵌它";
	}
	return null;
}

/**
 * A reply's status and headers, from whichever client fetched them. Kept tiny so
 * curl's header block and fetch's Headers read the same to the framing rules.
 */
interface Probe {
	status: number;
	header(name: string): string | null;
}

/** One machine, one check: after curl turns out to be absent, stop spawning it. */
let curlMissing = false;

const CURL_TRANSPORT = ["-sS", "--max-redirs", "0", "--connect-timeout", "6", "--max-time", "6", "-o", NULL_DEVICE, "-D", "-", "-A", USER_AGENT];

/** Run curl and hand back its stdout, or reject with the last thing it complained about. */
function runCurl(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		// Killed a moment after curl's own --max-time, so curl gets to say why it gave up.
		execFile("curl", args, { timeout: TIMEOUT_MS + 2000, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
			if (!error) {
				resolve(String(stdout ?? ""));
				return;
			}
			// Either a number (a non-zero exit) or a string ("ENOENT"), or null when killed.
			const code = (error as NodeJS.ErrnoException).code as string | number | null | undefined;
			const complaint = String(stderr ?? "").trim().split(/\r?\n/).pop();
			const failure = new Error(complaint || `curl 退出码 ${String(code)}`);
			// 28 is curl's "operation timed out"; a kill has no code at all.
			reject(Object.assign(failure, { missing: code === "ENOENT", timedOut: code === null || code === 28 }));
		});
	});
}

/** stdout of `-D -`: possibly a proxy CONNECT block, then the page's own header block. */
function parseReply(stdout: string): Probe | null {
	const lines = stdout.split(/\r?\n/);
	let at = -1;
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if (/^HTTP\/\d/.test(lines[index] ?? "")) {
			at = index;
			break;
		}
	}
	if (at < 0) return null;
	const status = Number((lines[at] ?? "").trim().split(/\s+/)[1]);
	if (!Number.isFinite(status)) return null;
	const fields = new Map<string, string>();
	for (const line of lines.slice(at + 1)) {
		const colon = line.indexOf(":");
		if (colon <= 0) continue;
		const name = line.slice(0, colon).trim().toLowerCase();
		if (name) fields.set(name, line.slice(colon + 1).trim());
	}
	return { status, header: name => fields.get(name.toLowerCase()) ?? null };
}

/** No curl on this machine: the old path, without a proxy. */
async function fetchProbe(url: string): Promise<Probe> {
	const response = await fetch(url, {
		redirect: "manual",
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: { accept: "text/html,application/xhtml+xml,*/*", "user-agent": USER_AGENT },
	});
	void response.body?.cancel();
	return { status: response.status, header: name => response.headers.get(name) };
}

/** One request through `proxy` (or direct when null); throws with a curl message on failure. */
async function probeOnce(url: string, proxy: string | null): Promise<Probe> {
	if (!curlMissing) {
		const head = [...CURL_TRANSPORT];
		if (proxy) head.push("-x", proxy);
		try {
			let reply = parseReply(await runCurl(["-I", ...head, url]));
			if (reply && (reply.status === 405 || reply.status === 501)) {
				// HEAD is refused: one byte of GET says the same about the headers.
				reply = parseReply(await runCurl(["-r", "0-0", ...head, url])) ?? reply;
			}
			if (!reply) throw new Error("curl 没有给出状态行");
			return reply;
		} catch (error) {
			if (!(error as { missing?: boolean }).missing) throw error;
			curlMissing = true;
		}
	}
	return fetchProbe(url);
}

/** Proxy first (when configured), then direct once more on a network failure. */
async function probe(url: string, proxy: string | null): Promise<{ reply: Probe; via: "proxy" | "direct" }> {
	if (proxy) {
		try {
			return { reply: await probeOnce(url, proxy), via: "proxy" };
		} catch {
			// A stopped proxy daemon leaves a stale registry entry: one direct try still answers.
		}
	}
	return { reply: await probeOnce(url, null), via: "direct" };
}

/**
 * Ask a page whether it can be framed. Headers only — no body is kept — and
 * every redirect hop is re-checked so a public URL cannot bounce us to the LAN.
 */
export async function frameCheck(raw: string): Promise<FrameCheck> {
	const target = parseTarget(raw);
	if (typeof target === "string") return { ok: false, frameable: false, reason: target };

	const proxy = systemProxy();
	let current = target;
	let addresses: string[] = [];
	let via: "proxy" | "direct" = "direct";
	for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
		const resolved = await resolveHost(current);
		addresses = resolved.addresses;
		if (resolved.refusal) {
			return { ok: false, frameable: false, url: current.toString(), reason: resolved.refusal, addresses };
		}

		let reply: Probe;
		try {
			({ reply, via } = await probe(current.toString(), proxy));
		} catch (error) {
			const message = (error as Error).message;
			const timedOut = (error as { timedOut?: boolean }).timedOut === true || /timed? ?out/i.test(message);
			const reason = proxy
				? `连不上：经系统代理 ${proxy} 和直连都没有回应`
				: timedOut
					? "6 秒内没有回应，可能是网络或站点慢"
					: `连不上这个地址：${message}`;
			return {
				ok: false,
				frameable: false,
				url: current.toString(),
				reason,
				addresses,
				proxy: proxy ?? undefined,
				unreachable: true,
			};
		}

		if (reply.status >= 300 && reply.status < 400) {
			const location = reply.header("location");
			if (!location) break;
			try {
				current = new URL(location, current);
			} catch {
				break;
			}
			if (current.protocol !== "http:" && current.protocol !== "https:") {
				return { ok: false, frameable: false, url: current.toString(), reason: "跳转到了非网页地址", addresses };
			}
			continue;
		}

		const blocked = framingRefusal({ get: name => reply.header(name) });
		return {
			ok: true,
			frameable: blocked === null,
			status: reply.status,
			url: current.toString(),
			reason: blocked ?? undefined,
			addresses,
			via,
			proxy: proxy ?? undefined,
		};
	}

	// Too many hops: let the frame try rather than refusing on its behalf.
	return { ok: true, frameable: true, url: current.toString(), addresses, via, proxy: proxy ?? undefined };
}
