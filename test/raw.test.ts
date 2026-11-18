import assert from "node:assert/strict";
import { test } from "node:test";
import {
	RAW_LIMIT,
	RAW_LINE_MAX,
	RAW_TRUNCATED,
	appendRaw,
	clearRaw,
	fitLine,
	pushRaw,
	rawLines,
	rawWatchers,
	watchRaw,
	type RawEntry,
} from "../server/raw.ts";

const entry = (line: string): RawEntry => ({ stream: "stdout", line, at: 1_700_000_000_000 });

test("a line under the limit is kept as it arrived", () => {
	assert.equal(fitLine('{"type":"ready"}'), '{"type":"ready"}');
	assert.equal(fitLine(""), "");
});

test("a line over 2048 characters is cut and marked", () => {
	const long = "x".repeat(RAW_LINE_MAX + 500);
	const fitted = fitLine(long);
	assert.equal(fitted.length, RAW_LINE_MAX + RAW_TRUNCATED.length);
	assert.ok(fitted.endsWith(RAW_TRUNCATED));
	assert.equal(fitted.slice(0, RAW_LINE_MAX), "x".repeat(RAW_LINE_MAX));
});

test("blobs become a placeholder instead of a wall of text", () => {
	const b64 = "A".repeat(600);
	const fitted = fitLine(`{"type":"image","data":"${b64}"}`);
	assert.ok(fitted.includes("base64 600 字符已省略"), fitted);
	assert.ok(fitted.length < 100);
	const dataUri = fitLine(`src="data:image/png;base64,${"B".repeat(400)}"`);
	assert.ok(dataUri.includes("base64"), dataUri);
	assert.ok(!dataUri.includes("B".repeat(120)));
});

test("the buffer appends in order", () => {
	const buffer = pushRaw([], entry("one"));
	const two = pushRaw(buffer, entry("two"));
	assert.deepEqual(two.map(e => e.line), ["one", "two"]);
	assert.equal(two[0]?.stream, "stdout");
	assert.equal(two[0]?.at, 1_700_000_000_000);
});

test("the buffer keeps the newest 1000 lines", () => {
	let buffer: RawEntry[] = [];
	for (let n = 0; n < RAW_LIMIT + 25; n += 1) buffer = pushRaw(buffer, entry(`line ${n}`));
	assert.equal(buffer.length, RAW_LIMIT);
	assert.equal(buffer[0]?.line, "line 25");
	assert.equal(buffer.at(-1)?.line, `line ${RAW_LIMIT + 24}`);
});

test("pushRaw leaves the old buffer untouched and stores the truncated line", () => {
	const before = [entry("keep")];
	const after = pushRaw(before, entry("y".repeat(RAW_LINE_MAX + 10)));
	assert.equal(before.length, 1);
	assert.ok(after[1]?.line.endsWith(RAW_TRUNCATED));
});

test("nothing is recorded until a watcher connects, and the last one leaving drops everything", () => {
	assert.equal(rawWatchers(), 0);
	appendRaw("s1", "stdout", "before the switch");
	assert.deepEqual(rawLines("s1"), []);

	const seen: string[] = [];
	const stop = watchRaw(event => seen.push(`${event.stream}:${event.line}`));
	assert.equal(rawWatchers(), 1);
	appendRaw("s1", "stdout", "a");
	appendRaw("s1", "stderr", "b");
	appendRaw("s2", "stdout", "other session");
	assert.deepEqual(seen, ["stdout:a", "stderr:b", "stdout:other session"]);
	assert.deepEqual(rawLines("s1").map(e => e.line), ["a", "b"]);
	assert.deepEqual(rawLines("s2").map(e => e.line), ["other session"]);

	clearRaw("s1");
	assert.deepEqual(rawLines("s1"), []);
	assert.deepEqual(rawLines("s2").map(e => e.line), ["other session"]);

	stop();
	assert.equal(rawWatchers(), 0);
	assert.deepEqual(rawLines("s2"), []);
	appendRaw("s2", "stdout", "after the last one left");
	assert.deepEqual(rawLines("s2"), []);
});
