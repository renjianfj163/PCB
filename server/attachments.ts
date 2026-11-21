/**
 * Prompt pictures as the browser sends them: validated here, once, so the
 * session layer only forwards what omp's RPC accepts (`{type:"image", …}` with
 * base64 that has no `data:` prefix).
 */

import {
	PROMPT_IMAGE_MAX_BASE64,
	PROMPT_IMAGE_MAX_COUNT,
	PROMPT_IMAGE_MAX_TOTAL_BASE64,
	PROMPT_IMAGE_TYPES,
	type PromptImage,
	type PromptImageType,
} from "../shared/protocol.ts";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const FORMAT = "图片格式不支持（只支持 PNG、JPEG、WebP）";
const TOO_MANY = "一条消息最多 4 张图片";
const TOO_BIG = "图片太大，发不出去";

function isImageType(value: string): value is PromptImageType {
	return (PROMPT_IMAGE_TYPES as readonly string[]).includes(value);
}

/**
 * `images` as whatever the request body carried. Throws on anything omp would
 * reject, so the caller can answer 400 with the user-facing message.
 */
export function readPromptImages(value: unknown): PromptImage[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw new Error(FORMAT);
	if (value.length > PROMPT_IMAGE_MAX_COUNT) throw new Error(TOO_MANY);
	const images: PromptImage[] = [];
	let total = 0;
	for (const item of value) {
		if (!item || typeof item !== "object") throw new Error(FORMAT);
		const mimeType = "mimeType" in item ? item.mimeType : undefined;
		const data = "data" in item ? item.data : undefined;
		if (typeof mimeType !== "string" || !isImageType(mimeType)) throw new Error(FORMAT);
		if (typeof data !== "string" || !BASE64.test(data)) throw new Error(FORMAT);
		if (data.length > PROMPT_IMAGE_MAX_BASE64) throw new Error(TOO_BIG);
		total += data.length;
		if (total > PROMPT_IMAGE_MAX_TOTAL_BASE64) throw new Error(TOO_BIG);
		images.push({ mimeType, data });
	}
	return images;
}
