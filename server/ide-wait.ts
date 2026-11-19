/**
 * The waiting screen between "click IDE" and "the editor is up".
 *
 * `code serve-web` answers 202 with a static "downloading" page for minutes on
 * a slow link, and that page belongs to VS Code — nothing here can edit it. So
 * PCB opens its own page, shows a progress bar, and navigates to the editor the
 * moment the server answers 200.
 */

import { randomUUID } from "node:crypto";
import type { IdeResult } from "./vscode-web.ts";

export type IdePhase = "starting" | "downloading" | "ready" | "failed";

/** Old tabs keep polling; only the newest few are worth remembering. */
const KEEP = 16;

/**
 * How long a download may stall before the page says so. The package is ~90 MB and
 * a bridged download of it took minutes here, so this is generous on purpose.
 */
const DOWNLOAD_DEADLINE_MS = 12 * 60_000;

/** Said once the bar has been stuck past the deadline: what to do instead of waiting. */
const TAKEOVER = {
	zh:
		"VS Code 官网的包一直下不下来。把 Server 压缩包放到本机，" +
		"用 PCB_VSCODE_SERVER_URL 指向你能访问的地址、或 PCB_VSCODE_SERVER_FILE 指向已下好的文件，" +
		"点一次 IDE 让它接管（第一次会先探测到版本号）。",
	en:
		"The package from code.visualstudio.com never arrives. Put the Server zip on this machine and point " +
		"PCB_VSCODE_SERVER_URL at an address you can reach, or PCB_VSCODE_SERVER_FILE at the file you already have; " +
		"then click IDE once more and it is unpacked instead of downloaded.",
};

interface Job {
	startedAt: number;
	url: string | null;
	reason: string | null;
}

const jobs = new Map<string, Job>();

export interface IdeStatus {
	phase: IdePhase;
	/** The editor page, once the launcher has one. */
	target?: string;
	reason?: string;
	/** Seconds since the click, so the bar can say something honest about waiting. */
	elapsed: number;
}

/** Kick off a launch and hand back the id the waiting page polls. */
export function startIdeJob(
	launch: (cwd: string) => Promise<IdeResult>,
	cwd: string,
	options: { startedAt?: number } = {},
): string {
	const id = randomUUID().slice(0, 8);
	const job: Job = { startedAt: options.startedAt ?? Date.now(), url: null, reason: null };
	jobs.set(id, job);
	while (jobs.size > KEEP) {
		const oldest = jobs.keys().next().value;
		if (oldest === undefined) break;
		jobs.delete(oldest);
	}
	void launch(cwd).then(
		result => {
			if (result.ok && result.url) job.url = result.url;
			else job.reason = result.reason ?? "VS Code 网页服务没能启动";
		},
		error => {
			job.reason = (error as Error).message;
		},
	);
	return id;
}

/** A launched server answers 202 until its web client is in place; 200 means go. */
export async function ideReady(url: string): Promise<boolean> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
		void response.body?.cancel();
		// 202 means "still fetching my web client"; ok is true for every 2xx, so compare exactly.
		return response.status === 200;
	} catch {
		return false;
	}
}

export async function ideJobStatus(id: string, lang: "zh" | "en" = "zh"): Promise<IdeStatus> {
	const job = jobs.get(id);
	if (!job) return { phase: "failed", reason: "这个进度已经过期，回 PCB 再点一次「IDE」。", elapsed: 0 };
	const elapsed = Math.round((Date.now() - job.startedAt) / 1000);
	if (job.reason) return { phase: "failed", reason: job.reason, elapsed };
	if (!job.url) return { phase: "starting", elapsed };
	const ready = await ideReady(job.url);
	// A bar that never ends is worse than a sentence: past the deadline, say why it
	// may never finish and what the customer can do about it instead.
	if (!ready && Date.now() - job.startedAt > DOWNLOAD_DEADLINE_MS) {
		return { phase: "failed", reason: TAKEOVER[lang], elapsed };
	}
	return { phase: ready ? "ready" : "downloading", target: job.url, elapsed };
}

const TEXT = {
	zh: {
		title: "VS Code 网页服务",
		starting: "正在启动本机的 VS Code 网页服务…",
		downloading: "网页端正在下载 / 解包，第一次会慢一些。好了会自动跳过去。",
		ready: "好了，正在打开编辑器…",
		failed: "没能打开",
		hint: "这个标签页可以随手关掉；PCB 那边什么都没变。",
		waited: "已等待 {s} 秒",
	},
	en: {
		title: "VS Code web server",
		starting: "Starting the local VS Code web server…",
		downloading: "Downloading and unpacking the web client — the first run is the slow one. This page moves on by itself.",
		ready: "Ready — opening the editor…",
		failed: "Could not open it",
		hint: "You can close this tab; nothing in PCB is affected.",
		waited: "Waiting {s}s",
	},
} as const;

/** The waiting page: one file, no external assets, no framework. */
export function waitPage(jobId: string, lang: "zh" | "en"): string {
	const text = TEXT[lang];
	return `<!doctype html>
<html lang="${lang === "en" ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${text.title}</title>
<style>
  :root { color-scheme: light dark; --fg: #1f2328; --muted: #6a737d; --bar: #2f6fed; --track: #e6e8eb; --bg: #ffffff; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e6edf3; --muted: #8b949e; --bar: #4f8bf7; --track: #21262d; --bg: #0d1117; }
  }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: var(--bg); color: var(--fg); font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: min(520px, calc(100vw - 48px)); }
  h1 { font-size: 14px; font-weight: 600; margin: 0 0 14px; color: var(--muted); letter-spacing: .02em; }
  .track { position: relative; height: 6px; border-radius: 999px; background: var(--track); overflow: hidden; }
  .fill { position: absolute; inset: 0 auto 0 0; width: 8%; border-radius: 999px; background: var(--bar);
          transition: width .6s ease; }
  .fill.busy { width: 38%; animation: crawl 1.6s ease-in-out infinite; }
  @keyframes crawl { 0% { left: -40%; } 100% { left: 100%; } }
  p { margin: 12px 0 0; font-size: 13px; }
  .muted { color: var(--muted); font-size: 12px; }
  .failed { color: #d1242f; }
  @media (prefers-color-scheme: dark) { .failed { color: #f85149; } }
</style>
</head>
<body>
<main>
  <h1>${text.title}</h1>
  <div class="track"><div class="fill busy" id="fill"></div></div>
  <p id="line">${text.starting}</p>
  <p class="muted" id="waited">${text.waited.replace("{s}", "0")}</p>
</main>
<script>
  const NAME = ${JSON.stringify(jobId)};
  const LANG = ${JSON.stringify(`/api/vscode/status?lang=${lang}`)};
  const TEXT = ${JSON.stringify({ starting: text.starting, downloading: text.downloading, ready: text.ready, failed: text.failed, hint: text.hint, waited: text.waited })};
  const fill = document.getElementById("fill");
  const line = document.getElementById("line");
  const waited = document.getElementById("waited");
  const set = (pct, busy) => { fill.classList.toggle("busy", busy); fill.style.width = pct + "%"; };

  async function poll() {
    try {
      const response = await fetch(LANG + "&job=" + encodeURIComponent(NAME), { cache: "no-store" });
      const status = await response.json();
      waited.textContent = TEXT.waited.replace("{s}", String(status.elapsed ?? 0));
      if (status.phase === "ready" && status.target) {
        set(100, false);
        line.textContent = TEXT.ready;
        location.replace(status.target);
        return;
      }
      if (status.phase === "failed") {
        set(100, false);
        fill.style.background = "#d1242f";
        line.className = "failed";
        line.textContent = TEXT.failed + "：" + (status.reason || "");
        waited.textContent = TEXT.hint;
        return;
      }
      if (status.phase === "downloading") {
        set(38, true);
        line.textContent = TEXT.downloading;
      } else {
        set(8, true);
        line.textContent = TEXT.starting;
      }
    } catch {
      // PCB went away; try again shortly rather than freeze the bar.
    }
    setTimeout(poll, 700);
  }
  poll();
</script>
</body>
</html>`;
}
