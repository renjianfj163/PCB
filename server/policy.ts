/**
 * Approval policy: the only place that decides what an agent action means for
 * a non-technical user.
 *
 * omp runs with `--approval-mode always-ask`, so every write/exec call arrives
 * here as an `extension_ui_request: select` whose title starts with
 * `Allow tool: <name>`. Read-tier calls never prompt (omp auto-approves them).
 *
 * PCB then:
 *  - plan phase: refuse anything that would mutate the workspace or run code
 *  - build phase: approve file writes silently (the user's chosen `write` mode)
 *  - always: show a card for code execution, because that is where damage happens
 *  - except the browser: one yes covers the rest of the same user message
 */

import type { Phase } from "../shared/protocol.ts";

export type ToolTier = "read" | "write" | "exec";

/** Mutates workspace/session files but executes no arbitrary code. */
const WRITE_TOOLS: Record<string, true> = {
	write: true,
	edit: true,
	ast_edit: true,
	apply_patch: true,
	notebook_edit: true,
};

/** Tier lookup. Unknown tools default to `exec`, matching omp's own safe default. */
export function toolTier(tool: string): ToolTier {
	if (WRITE_TOOLS[tool]) return "write";
	if (tool.startsWith("mcp__")) return "write";
	return "exec";
}

const APPROVAL_PREFIX = "Allow tool: ";

/** `Allow tool: bash\nCommand: x` -> `bash`. */
export function approvalTool(title: string): string | undefined {
	if (!title.startsWith(APPROVAL_PREFIX)) return undefined;
	const firstLine = title.slice(APPROVAL_PREFIX.length).split("\n")[0] ?? "";
	const tool = firstLine.trim();
	return tool || undefined;
}

export type ApprovalDecision =
	| { action: "approve" }
	| { action: "deny"; reason: string }
	| { action: "ask" };

export function decideApproval(tool: string, phase: Phase, browserAllowed = false): ApprovalDecision {
	const tier = toolTier(tool);
	if (tier === "read") return { action: "approve" };
	// Only the build phase may touch files or run code; plan and chat are read-only.
	if (phase !== "build") {
		const label = phase === "chat" ? "聊天阶段" : "规划阶段";
		return {
			action: "deny",
			reason: `${label}不允许${tier === "write" ? "修改文件" : "执行命令"}（${tool}）。`,
		};
	}
	if (tier === "write") return { action: "approve" };
	// The browser is told once per user message: after that yes, the rest of the same turn is covered.
	// Every other exec tool still asks every time.
	if (tool === "browser" && browserAllowed) return { action: "approve" };
	return { action: "ask" };
}

/** The approval labels omp emits (tools/approval.ts: approvalChoiceLabels). */
export function approvalAnswer(options: string[], decision: "approve" | "deny"): string {
	if (decision === "approve") {
		if (options.includes("Approve")) return "Approve";
		if (options.includes("Approve Once")) return "Approve Once";
		return options[0] ?? "Approve";
	}
	if (options.includes("Deny")) return "Deny";
	return options.at(-1) ?? "Deny";
}
