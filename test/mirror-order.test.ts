import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentMessage } from "../shared/protocol.ts";
import { insertByTimestamp } from "../server/session.ts";

function message(role: string, timestamp?: number): AgentMessage {
	const base: AgentMessage = { role, content: [{ type: "text", text: role }] };
	return timestamp === undefined ? base : { ...base, timestamp };
}

test("a steering message lands above the reply it caused", () => {
	// The reply is mirrored first; the user message it answers arrives late.
	const mirrored = [message("assistant", 1000), message("toolResult", 1010)];
	const ordered = insertByTimestamp(mirrored, message("user", 990));
	assert.deepEqual(
		ordered.map(item => item.role),
		["user", "assistant", "toolResult"],
	);
	assert.equal(ordered[0]?.timestamp, 990);
});

test("in-order arrivals append, ties keep arrival order, unknown timestamps append", () => {
	const appended = insertByTimestamp([message("assistant", 1000)], message("user", 1000));
	assert.deepEqual(
		appended.map(item => item.role),
		["assistant", "user"],
	);
	const unknown = insertByTimestamp([message("assistant", 1000)], message("user"));
	assert.deepEqual(
		unknown.map(item => item.role),
		["assistant", "user"],
	);
});
