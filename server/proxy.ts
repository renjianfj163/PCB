import { execFileSync } from "node:child_process";

/** Windows keeps the machine-wide proxy here; Chrome and WinINET both read it. */
const REGISTRY_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
/** A user can flip the proxy on and off while the server runs. */
const CACHE_MS = 60_000;
/** Values of PCB_PROXY that mean "no proxy, explicitly". */
const OFF = new Set(["", "off", "none"]);

let cached: { at: number; value: string | null } | null = null;

/** "127.0.0.1:10808" → "http://127.0.0.1:10808"; an off value → null. */
function normalize(value: string): string | null {
	const trimmed = value.trim();
	if (OFF.has(trimmed.toLowerCase())) return null;
	return trimmed.includes("://") ? trimmed : `http://${trimmed}`;
}

/** Per-protocol lists look like "http=a:1;https=b:2;socks=c:3". */
function fromServerList(value: string): string | null {
	const entries = new Map<string, string>();
	for (const part of value.split(";")) {
		const at = part.indexOf("=");
		if (at <= 0) continue;
		entries.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim());
	}
	const host = entries.get("https") ?? entries.get("http");
	return host ? normalize(host) : null;
}

/** One registry value, e.g. { type: "REG_SZ", data: "127.0.0.1:10808" }. */
function registryValue(name: string): { type: string; data: string } | null {
	let output: string;
	try {
		output = execFileSync("reg", ["query", REGISTRY_KEY, "/v", name], {
			encoding: "utf8",
			windowsHide: true,
			timeout: 4000,
		});
	} catch {
		return null;
	}
	for (const line of output.split(/\r?\n/)) {
		const match = new RegExp(`^\\s*${name}\\s+(REG_[A-Z_]+)(?:\\s+(.*))?$`).exec(line);
		if (match) return { type: match[1] ?? "", data: (match[2] ?? "").trim() };
	}
	return null;
}

function windowsProxy(): string | null {
	const enabled = registryValue("ProxyEnable");
	if (!enabled || enabled.data.toLowerCase() !== "0x1") return null;
	const server = registryValue("ProxyServer");
	if (!server || !server.data) return null;
	return server.data.includes("=") ? fromServerList(server.data) : normalize(server.data);
}

function detect(): string | null {
	const forced = process.env.PCB_PROXY;
	if (forced !== undefined) return normalize(forced);
	if (process.platform === "win32") return windowsProxy();
	const env = process.env.HTTPS_PROXY ?? process.env.https_proxy;
	return env ? normalize(env) : null;
}

/** e.g. "http://127.0.0.1:10808", or null when the machine has no proxy. */
export function systemProxy(): string | null {
	const now = Date.now();
	if (cached && now - cached.at <= CACHE_MS) return cached.value;
	const value = detect();
	cached = { at: now, value };
	return value;
}

/** Value for Chrome's --proxy-server, or null. */
export function chromeProxy(): string | null {
	return systemProxy();
}
