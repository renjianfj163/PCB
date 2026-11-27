import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import { CLIENT_BUFFER_MAX, FLUSH_MS, Hub, snapshotKey } from "../server/hub.ts";

/** Enough of a ServerResponse for the fanout: writes are recorded, nothing drains. */
function stubResponse(buffered = 0) {
	const written: string[] = [];
	const response = {
		writableLength: buffered,
		write(payload: string) {
			written.push(payload);
			return true;
		},
		on() {
			return response;
		},
		destroy() {},
	};
	return { response: response as unknown as ServerResponse, written };
}

const snapshot = (text: string) => ({
	t: "frame" as const,
	sessionId: "s1",
	frame: {
		type: "message_update",
		assistantMessageEvent: { partial: { role: "assistant", content: [{ type: "thinking", thinking: text }] } },
	},
});

const toolSnapshot = (callId: string, text: string) => ({
	t: "frame" as const,
	sessionId: "s1",
	frame: { type: "tool_execution_update", toolCallId: callId, partialResult: [{ type: "text", text }] },
});

test("a burst of snapshots leaves as one frame, the newest", t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const hub = new Hub();
	const { response, written } = stubResponse();
	hub.add(response);

	hub.broadcast(snapshot("one"));
	hub.broadcast(snapshot("two"));
	hub.broadcast(snapshot("three"));
	assert.equal(written.length, 0, "nothing is written before the tick");

	t.mock.timers.tick(FLUSH_MS);
	assert.equal(written.length, 1);
	assert.match(written[0] ?? "", /three/);
	assert.equal(snapshotKey(snapshot("x")), "s1|message_update|");
});

test("different streaming keys are not collapsed into each other", t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const hub = new Hub();
	const { response, written } = stubResponse();
	hub.add(response);

	hub.broadcast(snapshot("thinking"));
	hub.broadcast(toolSnapshot("call_1", "stdout"));
	hub.broadcast(toolSnapshot("call_2", "other"));
	hub.broadcast(toolSnapshot("call_1", "stdout done"));

	t.mock.timers.tick(FLUSH_MS);
	assert.equal(written.length, 3);
	assert.match(written[0] ?? "", /thinking/);
	// Each key keeps its first slot, carrying the newest content: call_1 is not
	// allowed to push call_2 behind it, and call_2 keeps its own text.
	assert.match(written[1] ?? "", /stdout done/);
	assert.match(written[2] ?? "", /other/);
});

test("state and notices keep their order around a coalesced snapshot", t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const hub = new Hub();
	const { response, written } = stubResponse();
	hub.add(response);

	hub.broadcast(snapshot("one"));
	hub.broadcast({ t: "notice", sessionId: "s1", level: "info", text: "hi" });
	hub.broadcast(snapshot("two"));

	t.mock.timers.tick(FLUSH_MS);
	assert.equal(written.length, 2);
	assert.match(written[0] ?? "", /two/);
	assert.match(written[1] ?? "", /"t":"notice"/);
});

test("a client that stopped reading loses snapshots, never state", t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const hub = new Hub();
	const { response, written } = stubResponse(CLIENT_BUFFER_MAX * 2);
	hub.add(response);

	hub.broadcast(snapshot("big"));
	hub.broadcast({ t: "notice", sessionId: "s1", level: "info", text: "still here" });

	t.mock.timers.tick(FLUSH_MS);
	assert.equal(written.length, 1, "the snapshot is dropped, the notice is not");
	assert.match(written[0] ?? "", /still here/);
});

test("a client far past the limit is dropped instead of fed", t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const hub = new Hub();
	const { response, written } = stubResponse(64 * 1024 * 1024);
	hub.add(response);

	hub.broadcast(snapshot("x"));
	hub.broadcast(snapshot("y"));
	t.mock.timers.tick(FLUSH_MS);
	assert.deepEqual(written, [], "a socket that will never drain is not written to");

	// It is off the fanout: the next event is not even queued for it.
	hub.broadcast({ t: "notice", sessionId: "s1", level: "info", text: "after" });
	t.mock.timers.tick(FLUSH_MS);
	assert.deepEqual(written, []);
});
