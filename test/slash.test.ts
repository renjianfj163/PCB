import assert from "node:assert/strict";
import { test } from "node:test";
import { leadingCommand } from "../shared/slash.ts";

/** omp's catalog, as the session builds it from get_available_commands. */
const NAMES = ["compact", "context", "model", "session"];
const OMP = new Set(NAMES);
const NO_CATALOG = new Set<string>();

test("a bare command and one with arguments are both commands", () => {
	assert.equal(leadingCommand("/compact", OMP), "compact");
	assert.equal(leadingCommand("/compact 保留登录相关的决定", OMP), "compact");
	assert.equal(leadingCommand("/compact:保留接口", OMP), "compact");
	assert.equal(leadingCommand("  /context  ", OMP), "context");
});

test("ordinary text and a command that is not on the first line stay text", () => {
	assert.equal(leadingCommand("看看上下文", OMP), undefined);
	assert.equal(leadingCommand("先聊聊\n/compact", OMP), undefined);
	assert.equal(leadingCommand("", OMP), undefined);
	assert.equal(leadingCommand("/", OMP), undefined);
});

test("a path is not a command when omp's catalog is known", () => {
	assert.equal(leadingCommand("/home/me/x", OMP), undefined);
	assert.equal(leadingCommand("/home 看一下", OMP), undefined);
	// A name omp never listed cannot be a command, however command-shaped it looks.
	assert.equal(leadingCommand("/nope", OMP), undefined);
});

test("without a catalog only the shape counts, so a real path still fails it", () => {
	assert.equal(leadingCommand("/compact", NO_CATALOG), "compact");
	assert.equal(leadingCommand("/home/me/x", NO_CATALOG), undefined);
});
