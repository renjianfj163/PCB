import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentMessage } from "../shared/protocol.ts";
import { attachUserEntryIds, rewindFailureText } from "../server/session.ts";
import { rewindNotice, stripPhaseMarker, userEntryId } from "../web/src/adapters.ts";

const PLAN = "「阶段：规划」";
const BUILD = "「阶段：执行」";
const CHAT = "「阶段：聊天」";

function user(text: string, extra: Record<string, unknown> = {}): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], ...extra };
}

/** One `get_entries` row, shaped like omp writes it. */
function entry(id: string, message: AgentMessage) {
	return { type: "message", id, parentId: null, timestamp: 0, message };
}

test("a phase marker is stripped for all three phases", () => {
	assert.equal(stripPhaseMarker(`${PLAN}\n看一下这个项目`), "看一下这个项目");
	assert.equal(stripPhaseMarker(`${BUILD}\n开始改`), "开始改");
	assert.equal(stripPhaseMarker(`${CHAT}\n这是什么`), "这是什么");
});

test("text without a marker is handed back untouched", () => {
	assert.equal(stripPhaseMarker("普通一句话"), "普通一句话");
	// Only the leading marker is a marker: the same brackets mid-sentence stay.
	assert.equal(stripPhaseMarker(`先看看 ${PLAN} 是什么意思`), `先看看 ${PLAN} 是什么意思`);
	assert.equal(stripPhaseMarker(`${CHAT}回答一下`), "回答一下");
});

test("a user message without an entry id cannot be rewound", () => {
	assert.equal(userEntryId(user(`${PLAN}\n没有条目`)), null);
	assert.equal(userEntryId(user(`${PLAN}\n有条目`, { entryId: "e1" })), "e1");
	// Either an id is a real string, or there is nothing to point at.
	assert.equal(userEntryId(user(`${PLAN}\n空 id`, { entryId: "" })), null);
	// Only user rows get a button; replies and tool results never do.
	assert.equal(userEntryId({ role: "assistant", content: [], entryId: "e2" }), null);
});

test("entry ids are paired with the branch's user messages in order", () => {
	const messages = [user(`${PLAN}\n第一句`), { role: "assistant", content: [] }, user(`${BUILD}\n第二句`)];
	const entries = [
		entry("a1", user(`${PLAN}\n第一句`)),
		{ type: "message", id: "a2", parentId: "a1", message: { role: "assistant", content: [] } },
		entry("a3", user(`${BUILD}\n第二句`)),
	];
	const paired = attachUserEntryIds(messages, entries);
	assert.equal(userEntryId(paired[0]!), "a1");
	assert.equal(userEntryId(paired[2]!), "a3");
	// The reply keeps no id: the button is for the line the user typed.
	assert.equal(userEntryId(paired[1]!), null);
});

test("an entry id that the tree knows is kept instead of re-pairing", () => {
	const text = `${PLAN}\n同一句`;
	const paired = attachUserEntryIds(
		[user(text, { entryId: "a2" })],
		[entry("a1", user(text)), entry("a2", user(text))],
	);
	assert.equal(userEntryId(paired[0]!), "a2");
});

test("an id the tree does not know is replaced by the paired one", () => {
	const text = `${PLAN}\n同一句`;
	const paired = attachUserEntryIds([user(text, { entryId: "gone" })], [entry("a1", user(text))]);
	assert.equal(userEntryId(paired[0]!), "a1");
});

test("a message the tree does not contain gets no id", () => {
	const paired = attachUserEntryIds([user(`${PLAN}\n凭空出现`)], [entry("a1", user(`${PLAN}\n别的一句`))]);
	assert.equal(userEntryId(paired[0]!), null);
});

test("the same text on an abandoned branch is never paired again", () => {
	// Rewound away, then typed again: the old copy is still in the file.
	const text = `${PLAN}\n同一句话`;
	const entries = [
		{ type: "message", id: "old", parentId: null, message: user(text) },
		{ type: "message", id: "new", parentId: null, message: user(text) },
	];
	const paired = attachUserEntryIds([user(text)], entries, "new");
	assert.equal(userEntryId(paired[0]!), "new");
	// Without a leaf to follow, append order is all there is.
	assert.equal(userEntryId(attachUserEntryIds([user(text)], entries)[0]!), "old");
});

test("omp's refusal codes are translated, and an unknown failure keeps its text", () => {
	assert.equal(rewindFailureText("session_busy", undefined), "这一轮还在跑，等它结束再回到这句。");
	assert.equal(rewindFailureText("entry_not_found", "Entry x not found"), "找不到这句话，刷新后再试。");
	assert.equal(rewindFailureText(undefined, "something omp said"), "something omp said");
	assert.equal(rewindFailureText(undefined, "   "), "omp 没有回到这句，对话还在原地。");
});

test("a cancellation says nothing moved; success says nothing at all", () => {
	assert.equal(rewindNotice({ cancelled: true }), "没有移动。对话还在原地。");
	assert.equal(rewindNotice({ cancelled: false }), null);
});
