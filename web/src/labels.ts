/** Plain-language names for tools and approval choices. */

export const TOOL_LABELS: Record<string, string> = {
	bash: "运行命令",
	shell: "运行命令",
	eval: "运行代码",
	write: "写入文件",
	edit: "修改文件",
	ast_edit: "批量修改文件",
	read: "读取文件",
	grep: "搜索内容",
	glob: "查找文件",
	find: "查找文件",
	ls: "列出目录",
	task: "分派子任务",
	browser: "操作浏览器",
	todo: "更新计划",
	ask: "向你提问",
	web_search: "联网搜索",
	lsp: "分析代码",
	debug: "调试程序",
	mcp: "外部工具",
};

export function approvalChoiceLabel(option: string): string {
	if (option === "Approve" || option === "Approve Once") return "允许这次";
	if (option === "Deny") return "拒绝";
	if (option.startsWith("Always Approve")) return `以后都允许（${option.replace("Always Approve", "").trim()}）`;
	const sessionMatch = /^Approve (.+) for this session$/.exec(option);
	if (sessionMatch) return `本轮会话都允许（${sessionMatch[1]})`.replace(")", "）");
	return option;
}

export function isDenyOption(option: string): boolean {
	return option === "Deny" || option.toLowerCase().startsWith("deny");
}

/** `Allow tool: bash\nCommand: x` -> `{ tool: "bash", detail: "Command: x" }`. */
export function splitApprovalTitle(title: string): { tool: string; detail: string } {
	const [first = "", ...rest] = title.split("\n");
	const tool = first.replace(/^Allow tool:\s*/, "").trim();
	return { tool, detail: rest.join("\n").trim() };
}
