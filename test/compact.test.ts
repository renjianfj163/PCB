import assert from "node:assert/strict";
import { test } from "node:test";
import { compactFailureText, compactionOutputNotice, parseCompactInvocation } from "../shared/compact.ts";

test("ordinary text and other slash commands are left alone", () => {
	assert.equal(parseCompactInvocation("帮我看看这个项目"), null);
	assert.equal(parseCompactInvocation("/model"), null);
	assert.equal(parseCompactInvocation("/new"), null);
	assert.equal(parseCompactInvocation("先聊聊\n/compact"), null);
});

test("/compact with no arguments asks for a plain compaction", () => {
	assert.deepEqual(parseCompactInvocation("/compact"), {});
	assert.deepEqual(parseCompactInvocation("  /compact   "), {});
});

test("focus text stays focus text when it is not a mode", () => {
	assert.deepEqual(parseCompactInvocation("/compact 保留登录相关的决定"), {
		instructions: "保留登录相关的决定",
	});
	assert.deepEqual(parseCompactInvocation("/compact:保留接口"), { instructions: "保留接口" });
});

test("a leading mode is split off, and snapcompact rejects focus text", () => {
	assert.deepEqual(parseCompactInvocation("/compact soft 保留接口"), {
		mode: "soft",
		instructions: "保留接口",
	});
	assert.deepEqual(parseCompactInvocation("/compact Soft"), { mode: "soft" });
	assert.deepEqual(parseCompactInvocation("/compact snapcompact 再说点什么"), {
		error: "snapcompact 只归档历史，不接受额外说明",
	});
});

test("a session that is too small is explained in one sentence", () => {
	assert.equal(compactFailureText("Nothing to compact (session too small)"), "这段对话还太短，压缩不了");
	assert.equal(compactFailureText("provider down"), "压缩没有完成：provider down");
});

test("omp's compaction output becomes a short notice", () => {
	assert.deepEqual(compactionOutputNotice("Compaction complete."), {
		level: "info",
		text: "已压缩上下文",
	});
	assert.deepEqual(compactionOutputNotice("Compaction complete. Tokens: 12000 -> 800 (saved 11200)."), {
		level: "info",
		text: "已压缩上下文，从 12000 收到 800",
	});
	assert.deepEqual(compactionOutputNotice("Compaction failed: nothing to compact"), {
		level: "warning",
		text: "压缩没有完成：nothing to compact",
	});
	assert.equal(compactionOutputNotice("Current model: demo"), null);
});
