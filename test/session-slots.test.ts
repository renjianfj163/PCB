import assert from "node:assert/strict";
import { test } from "node:test";
import { createSessionSlots } from "../web/src/sessionSlots.ts";

const CLOCK =
	"把时钟电路改为100MHz输入, 加一个时钟输入检测的led灯, 即有时钟输入的时候led灯亮, 其他不变";

test("unsent composer text stays in the conversation it was typed in", () => {
	const box = createSessionSlots("");
	box.write("pll", CLOCK);
	assert.equal(box.read("kicad"), "");
	assert.equal(box.read("pdf"), "");
	assert.equal(box.read("pll"), CLOCK);

	box.write("kicad", "另一句还没发");
	assert.equal(box.read("pll"), CLOCK);
	assert.equal(box.read("kicad"), "另一句还没发");

	box.write("pll", "");
	assert.equal(box.read("pll"), "");
	assert.equal(box.read("kicad"), "另一句还没发");
});
