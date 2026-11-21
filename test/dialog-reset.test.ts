import assert from "node:assert/strict";
import { test } from "node:test";
import type { DialogRequest } from "../shared/protocol.ts";
import { initialState, reducer } from "../web/src/state.ts";

const stale: DialogRequest = { id: "d1", method: "select", kind: "question", title: "顺带确认", options: ["A"] };

test("a new stream drops dialogs left over from a previous server process", () => {
	const before = { ...initialState, dialogs: { s1: [stale] } };
	const after = reducer(before, { type: "ui", event: { t: "hello", sessions: [] } });
	assert.deepEqual(after.dialogs, {});
});

test("the replayed dialog is back once the server sends it", () => {
	const afterHello = reducer({ ...initialState, dialogs: { s1: [stale] } }, { type: "ui", event: { t: "hello", sessions: [] } });
	const afterReplay = reducer(afterHello, { type: "ui", event: { t: "dialog", sessionId: "s1", request: stale } });
	assert.deepEqual(
		(afterReplay.dialogs.s1 ?? []).map(request => request.id),
		["d1"],
	);
});
