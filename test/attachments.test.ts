import assert from "node:assert/strict";
import { test } from "node:test";
import { readPromptImages } from "../server/attachments.ts";
import { PROMPT_IMAGE_MAX_BASE64 } from "../shared/protocol.ts";

const PNG = "iVBORw0KGgo=";
const FORMAT = "图片格式不支持（只支持 PNG、JPEG、WebP）";

test("a message without pictures is fine", () => {
	assert.deepEqual(readPromptImages(undefined), []);
	assert.deepEqual(readPromptImages(null), []);
});

test("a valid picture passes through unchanged", () => {
	assert.deepEqual(readPromptImages([{ mimeType: "image/png", data: PNG }]), [{ mimeType: "image/png", data: PNG }]);
});

test("five pictures are one too many", () => {
	const one = { mimeType: "image/png", data: PNG };
	assert.throws(() => readPromptImages([one, one, one, one, one]), { message: "一条消息最多 4 张图片" });
});

test("anything that is not a supported picture is refused", () => {
	for (const value of [
		[{ mimeType: "image/gif", data: PNG }],
		[{ mimeType: "image/png", data: "data:image/png;base64,AAA" }],
		[{ mimeType: "image/png", data: "" }],
		[{ mimeType: "image/png" }],
		[42],
		"nope",
	]) {
		assert.throws(() => readPromptImages(value), { message: FORMAT });
	}
});

test("pictures over the ceiling are refused", () => {
	assert.throws(() => readPromptImages([{ mimeType: "image/jpeg", data: "A".repeat(PROMPT_IMAGE_MAX_BASE64 + 4) }]), {
		message: "图片太大，发不出去",
	});
	const full = "A".repeat(PROMPT_IMAGE_MAX_BASE64);
	assert.throws(
		() =>
			readPromptImages([
				{ mimeType: "image/jpeg", data: full },
				{ mimeType: "image/jpeg", data: full },
			]),
		{ message: "图片太大，发不出去" },
	);
});
