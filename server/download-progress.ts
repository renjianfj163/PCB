import { execFile } from "node:child_process";

/**
 * How far the web-client download has got.
 *
 * `code-tunnel` buffers the whole archive in memory and only writes it to
 * `serve-web/<commit>/` when it is done, so that directory stays at zero bytes
 * until the very end — useless as a progress meter. Its I/O rate is observable,
 * and a download is a steady stream, so integrating that rate gives a percentage
 * good enough to watch (measured here: 244–261 KB/s, sampling every 3 s).
 */

/** The archive this machine's CLI fetches, once the commit is known. */
export function serverZipUrl(commit: string, platform: NodeJS.Platform = process.platform, arch = process.arch): string {
	const os = platform === "win32" ? "win32" : platform === "darwin" ? "darwin" : "linux";
	return `https://update.code.visualstudio.com/commit:${commit}/server-${os}-${arch}-web/stable`;
}

/** Total bytes of that archive (the redirect's final reply), or null. */
export function serverZipSize(url: string): Promise<number | null> {
	return new Promise(resolve => {
		execFile(
			"curl",
			["-sIL", "--max-time", "15", url],
			{ timeout: 20_000, windowsHide: true, maxBuffer: 1 << 20 },
			(error, stdout) => {
				if (error) return resolve(null);
				const sizes = [...String(stdout).matchAll(/^content-length:\s*(\d+)/gim)];
				const total = Number(sizes.at(-1)?.[1] ?? 0);
				resolve(total > 0 ? total : null);
			},
		);
	});
}

export interface ByteSampler {
	/** Bytes read by the downloader so far (integrated from its rate). */
	bytes(): number;
	stop(): void;
}

/** How often the rate is sampled; each sample is multiplied by this to add bytes. */
const SAMPLE_MS = 3000;

/** The process `code serve-web` downloads with. */
const COUNTER = "\\Process(code-tunnel*)\\IO Data Bytes/sec";

/**
 * Sample the downloader's rate on a loop and integrate it into a byte count. One
 * long-lived PowerShell means one extra process for the whole wait, not one per poll.
 */
export function startByteSampler(): ByteSampler {
	let bytes = 0;
	const script = [
		"while ($true) {",
		`  try { $s = (Get-Counter '${COUNTER}' -ErrorAction SilentlyContinue).CounterSamples; $sum = 0; if ($s) { $sum = ($s | Measure-Object -Property CookedValue -Sum).Sum }; Write-Output $sum } catch { Write-Output 0 }`,
		`  Start-Sleep -Milliseconds ${SAMPLE_MS}`,
		"}",
	].join("\n");
	const child = execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
		windowsHide: true,
		maxBuffer: 1 << 16,
	});
	let buffer = "";
	child.stdout?.setEncoding("utf8");
	child.stdout?.on("data", (chunk: string) => {
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			const rate = Number(line.trim().replace(",", "."));
			if (Number.isFinite(rate) && rate > 0) bytes += (rate * SAMPLE_MS) / 1000;
		}
	});
	child.on("error", () => undefined);
	return {
		bytes: () => Math.round(bytes),
		stop() {
			try {
				child.kill();
			} catch {
				// already gone
			}
		},
	};
}

/** 0–99: only the server answering 200 means finished. */
export function percentOf(bytes: number, total: number | null): number | null {
	if (!total || total <= 0 || bytes <= 0) return null;
	return Math.max(0, Math.min(99, Math.floor((bytes / total) * 100)));
}
