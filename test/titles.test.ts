import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionTitle } from "../web/src/titles.ts";

test("a first sentence becomes the session name", () => {
	assert.equal(sessionTitle("把销售表里的空行去掉"), "把销售表里的空行去掉");
});

test("only the first non-empty line counts, and runs of spaces collapse", () => {
	assert.equal(sessionTitle("\n  看看  这个项目\n它在做什么"), "看看 这个项目");
});

test("a long title is cut at 28 characters and marked with an ellipsis", () => {
	const long = "把销售表里所有空行都去掉并导出一份干净的版本另外再统计每个门店的总金额";
	const title = sessionTitle(long);
	assert.equal([...title].length, 29);
	assert.ok(title.endsWith("…"));
	assert.equal(title, `${[...long].slice(0, 28).join("")}…`);
});

test("blank input leaves the name to the server", () => {
	assert.equal(sessionTitle("   \n\t\n"), "");
});
