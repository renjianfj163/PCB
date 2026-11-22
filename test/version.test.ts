import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, isNewer, parseVersion } from "../shared/version.ts";

test("a leading v and surrounding spaces do not change the version", () => {
	assert.deepEqual(parseVersion("  v1.2.3 "), { major: 1, minor: 2, patch: 3, pre: null });
	assert.equal(compareVersions("v0.1.0", "0.1.0"), 0);
});

test("numbers are compared as numbers, not as text", () => {
	assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
	assert.ok(compareVersions("1.0.0", "1.0.1") < 0);
	assert.equal(compareVersions("2.3.4", "2.3.4"), 0);
});

test("a prerelease sorts before its own release", () => {
	assert.ok(compareVersions("0.2.0", "0.2.0-main.abc1234") > 0);
	assert.ok(compareVersions("0.2.0-main.abc1234", "0.2.0") < 0);
});

test("an unreadable version is not newer than anything", () => {
	assert.equal(parseVersion("latest"), null);
	assert.equal(compareVersions("latest", "0.1.0"), 0);
	assert.equal(isNewer("latest", "0.1.0"), false);
	assert.equal(isNewer("0.2.0", "dev"), false);
});

test("only a higher version is an update", () => {
	assert.equal(isNewer("0.2.0", "0.1.0"), true);
	assert.equal(isNewer("v0.1.0", "0.1.0"), false);
	assert.equal(isNewer("0.0.9", "0.1.0"), false);
});
