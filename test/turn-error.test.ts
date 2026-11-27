import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentMessage } from "../shared/protocol.ts";
import { turnErrorDetail } from "../shared/turn-error.ts";

const reply = (extra: Record<string, unknown>): AgentMessage => ({ role: "assistant", content: [], ...extra });

test("a provider failure keeps its reason, so the turn can be explained", () => {
	assert.equal(turnErrorDetail(reply({ stopReason: "error", errorMessage: "550 status code (no body)" })), "550 status code (no body)");
});

test("a failure without a reason is still a failure", () => {
	assert.equal(turnErrorDetail(reply({ stopReason: "error" })), "");
});

test("a normal reply, a tool result and a missing message are not failures", () => {
	assert.equal(turnErrorDetail(reply({ stopReason: "endTurn" })), null);
	assert.equal(turnErrorDetail({ role: "toolResult", content: [] }), null);
	assert.equal(turnErrorDetail(undefined), null);
});

test("an enormous reason is cut at a size a bubble can hold", () => {
	const detail = turnErrorDetail(reply({ stopReason: "error", errorMessage: "x".repeat(1000) })) ?? "";
	assert.equal(detail.length, 301);
	assert.ok(detail.endsWith("…"));
});
