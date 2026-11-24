import assert from "node:assert/strict";
import { test } from "node:test";
import { asPhase } from "../shared/protocol.ts";

/** Everything that is not a phase word: the shell must not invent one. */
test("only the four phase words are phases", () => {
	for (const phase of ["plan", "deepplan", "build", "chat"]) {
		assert.equal(asPhase(phase), phase);
	}
	for (const value of [undefined, null, "", "PLAN", "plan ", " deep plan", "deepplan2", 42, {}, ["plan"]]) {
		assert.equal(asPhase(value), undefined, String(value));
	}
});
