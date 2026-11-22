import { useSyncExternalStore } from "react";

/**
 * The shell speaks two languages. Chinese is the source language, so a string
 * that has no English entry falls back to itself — nothing can render blank.
 *
 * `t("…")` reads the locale from a module-level store rather than a context so
 * helpers outside components (tool labels, approval wording) can use it too.
 */
export type Locale = "zh" | "en";

const KEY = "pcb.locale";

/** Typed loosely on purpose: this module is also type-checked without the DOM lib. */
interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

interface DocumentLike {
	documentElement: { lang: string };
}

function storage(): StorageLike | undefined {
	return (globalThis as { localStorage?: StorageLike }).localStorage;
}

function applyLang(locale: Locale): void {
	const doc = (globalThis as { document?: DocumentLike }).document;
	if (doc) doc.documentElement.lang = locale === "en" ? "en" : "zh-CN";
}

function readLocale(): Locale {
	try {
		return storage()?.getItem(KEY) === "en" ? "en" : "zh";
	} catch {
		return "zh";
	}
}

let current: Locale = readLocale();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
	return current;
}

export function setLocale(next: Locale): void {
	if (next === current) return;
	current = next;
	try {
		storage()?.setItem(KEY, next);
	} catch {
		// private mode: the choice just lasts for this tab
	}
	applyLang(next);
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** App calls this once: any locale change re-renders the whole shell. */
export function useLocale(): Locale {
	return useSyncExternalStore(subscribe, getLocale, getLocale);
}

applyLang(current);

function fill(text: string, vars: Record<string, string | number>): string {
	return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

export function t(text: string, vars?: Record<string, string | number>): string {
	const done = current === "en" ? (EN[text] ?? text) : text;
	return vars ? fill(done, vars) : done;
}

/**
 * English wording, keyed by the Chinese source string. Dynamic parts use braces:
 * `t("{n} 条命令", { n: 4 })`.
 */
const EN: Record<string, string> = {
	// ---- tools and approvals (labels.ts, Transcript) ----
	"运行命令": "Run command",
	"运行代码": "Run code",
	"写入文件": "Write file",
	"修改文件": "Edit file",
	"批量修改文件": "Edit files in bulk",
	"读取文件": "Read file",
	"搜索内容": "Search contents",
	"查找文件": "Find files",
	"列出目录": "List folder",
	"分派子任务": "Delegate subtask",
	"操作浏览器": "Drive browser",
	"更新计划": "Update plan",
	"向你提问": "Ask you",
	"联网搜索": "Web search",
	"分析代码": "Analyse code",
	"调试程序": "Debug program",
	"外部工具": "External tool",
	"允许这次": "Allow once",
	"拒绝": "Deny",
	"以后都允许（{s}）": "Always allow ({s})",
	"本轮会话都允许（{s}）": "Allow for this session ({s})",

	// ---- shell chrome ----
	"收起侧栏": "Collapse sidebar",
	"展开侧栏": "Expand sidebar",
	"会话列表": "Conversations",
	"新对话": "New conversation",
	"收起右栏": "Collapse panel",
	"展开右栏": "Expand panel",
	"恢复会话": "Resume session",
	"导出 HTML": "Export HTML",
	"在 VS Code 中打开": "Open in VS Code",
	"已打开本机 VS Code": "Opened VS Code on this machine",
	"本机没有 VS Code 或 Cursor": "Neither VS Code nor Cursor is installed on this machine",
	"编辑器没能启动": "The editor would not start",
	"这个目录不存在": "That folder does not exist",
	"重新拉取会话内容": "Reload conversation",
	"删除这个会话记录（不删项目文件）": "Delete this conversation record (files stay)",
	"未选择": "None",
	"等待选择…": "Waiting…",
	"添加项目": "Add project",
	"从清单移除（不删磁盘文件）": "Remove from list (files stay on disk)",
	"还没有项目文件夹，点右上角的 + 添加。": "No project folders yet — use + to add one.",
	"这个项目还没有对话。": "No conversations here yet.",
	"配置": "Settings",
	"设置": "Settings",
	"版本": "Version",
	"更新": "Updates",
	"版本、更新、模型登录，以及这份 PCB 装在哪里。":
		"Version, updates, model login, and where this PCB lives.",
	"读不到 GitHub 上的版本：{s}": "Could not read the version on GitHub: {s}",
	"有新版本 {s}（当前 {c}）。": "Version {s} is available (you have {c}).",
	"已经是最新版本（{s}）。": "You are on the latest version ({s}).",
	"检查 GitHub 上的最新正式版；不会在后台自动下载或替换。":
		"Reads the latest release from GitHub. Nothing is downloaded or replaced in the background.",
	"正在检查…": "Checking…",
	"检查更新": "Check for updates",
	"正在下载…": "Downloading…",
	"下载并安装": "Download and install",
	"已打开安装包：选一个目录完成安装。": "The installer is open — pick a folder to finish.",
	"安装包已在后台启动，它会结束这个窗口并装回同一目录。":
		"The installer started; it will close this window and upgrade the same folder.",
	"登录状态": "Login status",
	"已登录：{s}": "Logged in: {s}",
	"还没有登录模型，现在发不出消息。": "No model is logged in yet, so nothing can be sent.",
	"已经打开一个登录窗口，在那边完成 omp login。": "A login window is open — finish omp login there.",
	"正在打开…": "Opening…",
	"登录模型": "Log in a model",
	"登录其它模型": "Log in another model",
	"安装位置": "Install location",
	"目录": "Folder",
	"未安装（从源码运行）": "Not installed (running from source)",
	"日志": "Log",
	"打开日志": "Open log",
	"先登录模型，才能发消息": "Log in a model before sending messages",
	"现在还没有登录任何模型，PCB 发不出消息，也执行不了计划。登录在 omp 自己的窗口里完成。":
		"No model is logged in, so PCB cannot send messages or run a plan. Login happens in omp's own window.",
	"点窗口的 × 只是把它藏到托盘，定时任务还在跑；真正的退出在托盘的「退出」。":
		"The window's × only hides it to the tray, where scheduled jobs keep running; quitting is the tray's Exit.",
	"稍后": "Later",
	"调试": "Debug",
	"模型": "Model",
	"语言": "Language",
	"显示 omp 原文": "Show omp raw output",
	"原文": "Raw output",
	"清空": "Clear",

	// ---- home ----
	"想做什么？": "What do you want to do?",
	"说说你想让电脑帮你做什么…": "Tell the computer what you want…",
	"先在左侧选一个项目，或点「添加项目」": "Pick a project on the left, or add one",
	"启动中…": "Starting…",
	"发送": "Send",
	"Enter 发送，Shift+Enter 换行。助手会先给计划，你同意后才动文件；跑命令仍会问你。":
		"Enter to send, Shift+Enter for a new line. The assistant plans first and only touches files once you agree; commands still ask you.",
	"Enter 发送，Shift+Enter 换行。执行阶段会直接改文件；跑命令仍会问你。":
		"Enter to send, Shift+Enter for a new line. Build edits files directly; commands still ask you.",
	"Enter 发送，Shift+Enter 换行。聊天阶段只回答问题，不改文件、不跑命令；需要动手时切到「执行」。":
		"Enter to send, Shift+Enter for a new line. Chat only answers questions — no files, no commands. Switch to Build to act.",
	"先选一个项目文件夹": "Pick a project folder first",
	"已导出：{s}": "Exported: {s}",
	"这一轮还在跑，已排队，等它结束再发送。": "Still running — queued, it will be sent when this turn ends.",
	"按上面的计划开始执行。": "Start following that plan.",

	// ---- composer ----
	"会话已结束，先恢复": "Session ended — resume first",
	"正在恢复这个对话…": "Waking this conversation up…",
	"这个对话的后台进程已经退出，恢复后才能继续。":
		"The process behind this conversation has exited. Resume it to carry on.",
	"恢复中…": "Resuming…",
	"说你想做什么…": "What should it do?",
	"上下文 {n}%": "Context {n}%",
	"压缩": "Compact",
	"压缩中…": "Compacting…",
	"正在压缩上下文…": "Compacting the conversation…",
	"正在压缩上下文": "Already compacting",
	"把目前的对话压成摘要，腾出上下文": "Summarize this conversation and free up context",
	"这一轮还在跑，停下来再压缩": "This turn is still running — stop it before compacting",
	"压缩不接收图片": "Compaction does not take images",
	"snapcompact 只归档历史，不接受额外说明": "snapcompact archives history and does not take extra notes",
	"这段对话还太短，压缩不了": "This conversation is still too short to compact",
	"已压缩上下文": "Context compacted",
	"已压缩上下文，从 {before} 收到 {after}": "Context compacted, from {before} down to {after}",
	"已花费 {s}": "Spent {s}",
	"下一条消息使用的阶段": "Phase for the next message",
	"规划": "Plan",
	"执行": "Build",
	"聊天": "Chat",
	"停止": "Stop",
	"先开始一次对话": "Start a conversation first",
	"思考等级": "Thinking",
	"这个模型没有档位": "This model offers no levels",
	"命令输出": "Command output",
	"图片": "Image",
	"移除这张图片": "Remove this image",
	"正在处理图片…": "Preparing the image…",
	"图片格式不支持（只支持 PNG、JPEG、WebP）": "Unsupported image — PNG, JPEG or WebP only",
	"一条消息最多 4 张图片": "Up to 4 images per message",
	"图片太大，发不出去": "Too large to send",
	"图片处理失败": "Could not read that image",

	// ---- palette ----
	"搜索项目、对话、自动化…": "Search projects, conversations, automations…",
	"没有匹配项": "No matches",
	"项目": "Projects",
	"会话": "Conversations",
	"自动化": "Automations",

	// ---- right rail: tabs ----
	"文件": "Files",
	"计划": "Plan",
	"终端": "Terminal",
	"浏览器": "Browser",
	"右栏视图": "Panel views",

	// ---- transcript ----
	"助手": "Assistant",
	"输入中": "Typing",
	"你": "You",
	"思考过程": "Thinking",
	"工具输出": "Tool output",
	"收起": "Hide",
	"输出": "Output",
	"正在载入这段对话…": "Loading this conversation…",
	"说一句话开始": "Say something to start",
	"这个会话已经结束": "This session has ended",
	"omp 正在回放历史，稍等一下。": "omp is replaying the history, one moment.",
	"计划列在右侧。批准之前，助手只会读，不会改。": "The plan is on the right. Until you approve it, the assistant only reads.",
	"先描述你想做的事，助手会先给出计划，你同意之后它才动手。":
		"Describe what you want. The assistant writes a plan first and only acts once you agree.",
	"点下面的「恢复会话」接着聊。": "Use Resume below to continue.",
	"回到这句之前": "Rewind to before this",
	"回到这句之前？这句和后面的对话会离开当前路径，文件不会改。":
		"Rewind to before this message? It and the replies after it leave the active path. Files are not touched.",

	// ---- rail: files ----
	"这次改过": "Changed",
	"{n} 处改动": "{n} changed",
	"刷新目录": "Refresh folder",
	"正在读取目录…": "Reading folder…",
	"这个文件夹太大，只列出了前 400 项。": "Large folder — showing the first 400 entries.",
	"这个文件夹是空的。": "This folder is empty.",
	"已复制": "Copied",
	"复制完整路径": "Copy full path",
	"关闭预览": "Close preview",
	"正在读取…": "Reading…",
	"二进制文件，{s}，不预览。": "Binary file, {s} — not previewed.",
	"文件太大（{s}），超过 256 KB，不预览。": "Too large ({s}) — over 256 KB, not previewed.",

	// ---- rail: plan ----
	"待办 {a}/{b}": "{a}/{b} todos",
	"还没有待办": "No todos yet",
	"还没有规划内容。在下方输入框把阶段切到「规划」再提问。":
		"Nothing planned yet. Switch the phase to Plan below and ask.",
	"切到执行阶段，按这份计划动手": "Switch to Build and follow this plan",
	"等助手写出计划后才能批准": "Approve once the assistant has written the plan",
	"按这个做": "Do this",
	"再改一改": "Revise it",
	"改成别的": "Change it",
	"已经在执行阶段。切回「规划」只影响下一条消息。":
		"Already in Build. Switching back to Plan only affects the next message.",
	"聊天阶段只回答问题，不改文件、不跑命令；需要动手时切到「执行」。":
		"Chat only answers questions — no files, no commands. Switch to Build to act.",
	"「按这个做」会切到执行阶段；写文件自动进行，跑命令仍会问你。":
		"“Do this” switches to Build: writes go ahead, commands still ask you.",
	"等助手写出计划后才能批准。": "Approve once the assistant has written the plan.",

	// ---- rail: terminal ----
	"自动放行": "Auto-allowed",
	"等待审批": "Awaiting approval",
	"已批准": "Approved",
	"已拒绝": "Rejected",
	"被拒绝": "Denied",
	"（退出码 {s}）": "(exit code {s})",
	"（60 秒没跑完，已中止）": "(stopped after 60 s)",
	"…（输出太长，只留了前 64 KB）": "… (output truncated to the first 64 KB)",
	"失败 {a}/{b}": "Failed {a}/{b}",
	"{n} 条命令": "{n} commands",
	"运行中 {n}": "Running {n}",
	"只看失败的命令": "Show failed commands only",
	"全部": "All",
	"失败 {n}": "Failed {n}",
	"全部成功": "All succeeded",
	"这次对话还没跑过命令。下面可以直接敲；助手要跑命令时会先问你。":
		"No commands yet. Type one below; the assistant asks before running anything.",
	"▾ 收起输出": "▾ Hide output",
	"▸ 输出": "▸ Output",
	"你运行的": "You ran",
	"运行中…": "Running…",
	"在此输入命令": "Type a command here",
	"在 {s} 里运行": "Runs in {s}",
	"在这里运行命令": "Run a command here",
	"运行": "Run",
	"没有命令": "No commands",

	// ---- rail: browser ----
	"站点不允许被内嵌": "The site does not allow embedding",
	"{n} 次截图": "{n} screenshots",
	"最新": "Latest",
	"回到最新": "Back to latest",
	"输入地址，例如 example.com": "Enter an address, e.g. example.com",
	"在右栏打开的地址": "Address to open in the panel",
	"检查…": "Checking…",
	"打开": "Open",
	"打不开：{s}": "Cannot open {s}",
	"{s}。这一栏没法把它放进来。": "{s}. This panel cannot host it.",
	"用系统浏览器打开": "Open in your browser",
	"还是试着内嵌": "Try embedding anyway",
	"新标签": "New tab",
	"浏览器预览": "Browser preview",
	"空白说明这个站点不允许被内嵌，用上面的「新标签」打开。":
		"Blank means the site refuses embedding — use “New tab” above.",
	"这里可以直接看网页：输入地址后按「打开」。助手用浏览器时，它看到的截图也会出现在下面。":
		"Browse here: enter an address and press Open. When the assistant uses a browser, its screenshot shows below.",
	"（没有记录地址）": "(no URL recorded)",
	"（无地址）": "(no URL)",
	"放大看": "Enlarge",
	"浏览器截图": "Browser screenshot",
	"这次浏览器操作没有截图。": "This browser action had no screenshot.",
	"更早": "Earlier",
	"点任意处或按 Esc 关闭": "Click anywhere or press Esc to close",
	"截图看看": "Take a snapshot",
	"正在截…": "Shooting…",
	"正在用本机的浏览器截图，最多半分钟…": "The local browser is rendering the page — up to half a minute…",
	"截图也失败了": "The snapshot failed too",
	"截图失败": "Snapshot failed",
	"再试一次": "Try again",
	"重新截一张": "Shoot again",
	"网页截图": "Page snapshot",
	"这是本机浏览器拍的一整页，能看不能点；要操作就用系统浏览器打开。":
		"A full page photographed by the local browser: readable, not clickable. Use your browser to interact.",
	"域名解析到 {s}": "The name resolves to {s}",
	"经系统代理 {p} 检查": "Checked through the system proxy {p}",
	"经系统代理和直连都没通，可以先截图看看。":
		"Neither the proxy nor a direct connection answered — a snapshot is the quickest look.",
	"本机没有检测到系统代理，直连到这个地址不通。":
		"No system proxy on this machine, and a direct connection does not answer.",
	"{s} 不允许内嵌，已在系统浏览器打开。":
		"{s} cannot be framed, so it was opened in your system browser.",
	"这个站不允许内嵌，系统浏览器也没能打开它。按下面的链接再试一次。":
		"The site refuses to be framed, and the system browser could not be launched — use the link below.",
	"助手 {a} 条 · 你 {b} 条": "assistant {a} · you {b}",
	"在 {s} 里用 {sh} 运行": "Runs in {s} with {sh}",
	"用哪个 shell 运行": "Which shell to run in",
	"cmd.exe": "cmd.exe",
	"站点声明 X-Frame-Options: DENY，任何网站都不能内嵌它":
		"The site sends X-Frame-Options: DENY — nothing may frame it",
	"站点声明 X-Frame-Options: SAMEORIGIN，只允许它自己的页面内嵌":
		"The site sends X-Frame-Options: SAMEORIGIN — only its own pages may frame it",
	"站点用 CSP 的 frame-ancestors 限制了谁能内嵌它": "The site's CSP frame-ancestors limits who may frame it",
	"6 秒内没有回应，可能是网络或站点慢": "No reply within 6 seconds — the network or the site is slow",
	"跳转到了非网页地址": "It redirected to something that is not a web page",
	"这台机器上没找到 Chrome 或 Edge，截不了图": "No Chrome or Edge on this machine, so there is nothing to take the picture with.",
	"浏览器也打不开它（域名或网络不通）": "The browser could not open it either (name or connection failed).",
	"浏览器没能打开这个地址": "The browser could not open this address",
	"PowerShell": "PowerShell",

	// ---- dialogs ----
	"助手需要你的选择": "The assistant needs your choice",
	"或者直接写你的答案": "Or type your answer",
	"提交": "Submit",
	"跳过": "Skip",
	"需要你确认：{s}": "Confirm: {s}",
	"确认": "Confirm",
	"同意": "Allow",
	"不同意": "Refuse",
	"请输入": "Input needed",
	"确定": "OK",
	"取消": "Cancel",
	"自己写一个答案": "Write your own answer",
	"还有 {n} 个待处理": "{n} more waiting",

	// ---- automations ----
	"还没跑过": "Never ran",
	"自动化和定时任务": "Automations and schedules",
	"点「现在运行」会立刻开一条新对话；每天定时只在 PCB 开着时生效，错过不补。":
		"“Run now” starts a conversation immediately. Daily timers only fire while PCB is open; missed runs are skipped.",
	"＋ 新建": "＋ New",
	"名称": "Name",
	"例如：每天整理下载文件夹": "e.g. tidy my downloads folder",
	"项目文件夹": "Project folder",
	"（先添加一个项目）": "(add a project first)",
	"阶段": "Phase",
	"规划（只读，先给计划）": "Plan (read-only, plans first)",
	"执行（直接动手）": "Build (acts right away)",
	"要它做什么": "What should it do",
	"例如：把下载文件夹里的图片按月份归档": "e.g. file images in Downloads by month",
	"每天几点（可空）": "Daily time (optional)",
	"启用": "Enabled",
	"保存中…": "Saving…",
	"保存": "Save",
	"启用或停用": "Enable or disable",
	"已启用": "Enabled",
	"已停用": "Disabled",
	"项目：{s}": "Project: {s}",
	"每天 {s}": "Daily at {s}",
	"仅手动运行": "Manual only",
	"上次运行：{s}": "Last run: {s}",
	"上次失败：{s}": "Last failure: {s}",
	"正在新开对话…": "Starting a conversation…",
	"现在运行": "Run now",
	"删除": "Delete",
	"还没有自动化。点右上「新建」，让它每天替你跑同一件事。":
		"No automations yet. Use New to run the same job on a schedule.",

	// ---- server messages the UI passes straight through ----
	"只能在自己的项目目录里运行": "Only your own project folders can run commands",
	"缺少请求标记": "Missing request marker",
	"缺少 entryId": "Missing entryId",
	"这一轮还在跑，等它结束再回到这句。": "This turn is still running — wait for it to finish before rewinding.",
	"找不到这句话，刷新后再试。": "That line is not in the conversation — refresh and try again.",
	"omp 没有回到这句，对话还在原地。": "omp did not move. The conversation stays where it was.",
	"没有移动。对话还在原地。": "Nothing moved. The conversation stays where it was.",
	"输入框里还有没发出去的文字，没有覆盖它。原文：{text}":
		"The composer already had unsent text, so it was left alone. The original line: {text}",
	"命令是空的": "The command is empty",
	"命令太长，分几次跑": "Command too long — split it up",
	"本机和内网地址不会被预览": "Local and LAN addresses are never previewed",
	"这个域名指向本机或内网，不预览": "This host points at your machine or LAN — not previewed",
	"只预览 http / https 地址": "Only http / https addresses can be previewed",
	"这个地址看不懂": "That address cannot be parsed",
	"没有地址": "No address given",
	"请求来源不被信任": "Untrusted request origin",
	"只接受本机访问": "Local requests only",
	"会话不存在": "Session not found",
	"会话不在内存中，请先恢复": "Session is not loaded — resume it first",
	"消息为空": "The message is empty",
	"这张图不在本机缓存里": "That image is not in the local cache",
};
