import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { FrameCheck } from "../shared/protocol.ts";

const MAX_HOPS = 3;
const TIMEOUT_MS = 6000;

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
function framingRefusal(headers: Headers): string | null {
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
 * Ask a page whether it can be framed. Headers only — no body is kept — and
 * every redirect hop is re-checked so a public URL cannot bounce us to the LAN.
 */
export async function frameCheck(raw: string): Promise<FrameCheck> {
	const target = parseTarget(raw);
	if (typeof target === "string") return { ok: false, frameable: false, reason: target };

	let current = target;
	let addresses: string[] = [];
	for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
		const resolved = await resolveHost(current);
		addresses = resolved.addresses;
		if (resolved.refusal) {
			return { ok: false, frameable: false, url: current.toString(), reason: resolved.refusal, addresses };
		}

		let response: Response;
		try {
			response = await fetch(current, {
				redirect: "manual",
				signal: AbortSignal.timeout(TIMEOUT_MS),
				headers: { accept: "text/html,application/xhtml+xml,*/*", "user-agent": "Mozilla/5.0 (PCB local shell)" },
			});
		} catch (error) {
			const message = (error as Error).message;
			return {
				ok: false,
				frameable: false,
				url: current.toString(),
				reason: message.includes("timeout") ? "6 秒内没有回应，可能是网络或站点慢" : `连不上这个地址：${message}`,
				addresses,
			};
		}
		void response.body?.cancel();

		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location");
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

		const blocked = framingRefusal(response.headers);
		return {
			ok: true,
			frameable: blocked === null,
			status: response.status,
			url: current.toString(),
			reason: blocked ?? undefined,
			addresses,
		};
	}

	// Too many hops: let the frame try rather than refusing on its behalf.
	return { ok: true, frameable: true, url: current.toString(), addresses };
}
