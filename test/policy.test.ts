import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalAnswer, approvalTool, decideApproval, toolTier } from "../server/policy.ts";

test("write-tier tools are exactly the ones the build phase may touch", () => {
	for (const tool of ["write", "edit", "ast_edit", "apply_patch", "notebook_edit"]) {
		assert.equal(toolTier(tool), "write");
		assert.equal(decideApproval(tool, "build").action, "approve");
	}
	assert.equal(toolTier("mcp__filesystem_read"), "write");
	assert.equal(decideApproval("mcp__filesystem_read", "build").action, "approve");
});

test("exec-tier tools other than the browser always come back to the user in the build phase", () => {
	for (const tool of ["bash", "eval", "task", "some_new_tool"]) {
		assert.equal(toolTier(tool), "exec");
		assert.equal(decideApproval(tool, "build").action, "ask");
		assert.equal(decideApproval(tool, "build", true).action, "ask", `${tool} with an allowed browser`);
	}
});

test("the browser asks once per message, then rides on the user's yes", () => {
	assert.equal(toolTier("browser"), "exec");
	assert.equal(decideApproval("browser", "build").action, "ask");
	assert.equal(decideApproval("browser", "build", false).action, "ask");
	assert.equal(decideApproval("browser", "build", true).action, "approve");
});

/** The word a refusal uses for each read-only phase. */
const PHASE_WORD = { plan: /规划阶段/, deepplan: /深规划阶段/, chat: /聊天阶段/ } as const;

test("an allowed browser never loosens plan, deep plan or chat", () => {
	for (const phase of ["plan", "deepplan", "chat"] as const) {
		const decision = decideApproval("browser", phase, true);
		assert.equal(decision.action, "deny", phase);
		if (decision.action === "deny") assert.match(decision.reason, PHASE_WORD[phase]);
	}
});

test("plan, deep plan and chat refuse anything that writes or runs", () => {
	for (const phase of ["plan", "deepplan", "chat"] as const) {
		for (const tool of ["write", "edit", "bash", "eval", "task", "unknown_tool"]) {
			const decision = decideApproval(tool, phase);
			assert.equal(decision.action, "deny", `${phase}/${tool}`);
			if (decision.action === "deny") {
				assert.match(decision.reason, PHASE_WORD[phase]);
			}
		}
	}
});

test("a chat-phase refusal says what was refused", () => {
	const decision = decideApproval("bash", "chat");
	assert.equal(decision.action, "deny");
	if (decision.action === "deny") assert.match(decision.reason, /执行命令（bash）/);
});

test("approval titles are parsed, other prompts are not approvals", () => {
	assert.equal(approvalTool("Allow tool: bash\nCommand: ls -la"), "bash");
	assert.equal(approvalTool("Allow tool: mcp__echo_it\nargs: {}"), "mcp__echo_it");
	assert.equal(approvalTool("Which database?"), undefined);
	assert.equal(approvalTool("Allow tool: "), undefined);
});

test("approval answers pick the label omp actually offers", () => {
	assert.equal(approvalAnswer(["Approve", "Deny"], "approve"), "Approve");
	assert.equal(approvalAnswer(["Approve Once", "Deny"], "approve"), "Approve Once");
	assert.equal(approvalAnswer(["拒绝", "Deny"], "deny"), "Deny");
	assert.equal(approvalAnswer(["Allow", "Later"], "deny"), "Later");
});
