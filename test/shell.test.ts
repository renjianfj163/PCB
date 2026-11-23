import assert from "node:assert/strict";
import { test } from "node:test";
import type { ShellSettings } from "../shared/protocol.ts";
import { overlayChoice } from "../server/shell.ts";

const settings: ShellSettings = {
	models: [{ provider: "deepseek", id: "deepseek-v4-flash" }],
	current: { provider: "deepseek", id: "deepseek-v4-flash" },
	levels: ["off", "high"],
	thinking: "high",
};

test("a saved choice replaces omp's default on the card", () => {
	const shown = overlayChoice(settings, {
		model: { provider: "deepseek", id: "deepseek-v4-pro" },
		thinking: "low",
	});
	assert.deepEqual(shown.current, { provider: "deepseek", id: "deepseek-v4-pro" });
	assert.equal(shown.thinking, "low");
	assert.equal(shown.models.length, 1);
});

test("without a saved choice the card shows omp's own default", () => {
	assert.deepEqual(overlayChoice(settings, undefined).current, settings.current);
	assert.equal(overlayChoice(settings, {}).thinking, "high");
});
