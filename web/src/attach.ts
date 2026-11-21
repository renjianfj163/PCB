/**
 * Turning a pasted or dropped file into a prompt picture: base64 that omp will
 * accept, under the same ceilings the server enforces. DOM only — nothing here
 * talks to the network.
 */

import {
	PROMPT_IMAGE_MAX_BASE64,
	PROMPT_IMAGE_MAX_BYTES,
	PROMPT_IMAGE_TYPES,
	type PromptImage,
} from "../../shared/protocol.ts";

/** Longest edge a picture is shrunk to before it is sent. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;
const CHUNK = 0x8000;

function base64(bytes: Uint8Array): string {
	let binary = "";
	// Chunked: `String.fromCharCode(...bytes)` blows the stack on a real photo.
	for (let at = 0; at < bytes.length; at += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
	}
	return btoa(binary);
}

function draw(bitmap: ImageBitmap, scale: number, jpeg: boolean): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(bitmap.width * scale));
	canvas.height = Math.max(1, Math.round(bitmap.height * scale));
	const context = canvas.getContext("2d");
	if (!context) throw new Error("图片处理失败");
	// JPEG has no alpha: a transparent PNG would come out black.
	if (jpeg) {
		context.fillStyle = "#fff";
		context.fillRect(0, 0, canvas.width, canvas.height);
	}
	context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	return canvas;
}

function encode(canvas: HTMLCanvasElement, jpeg: boolean): Promise<Blob | null> {
	const deferred = Promise.withResolvers<Blob | null>();
	canvas.toBlob(blob => deferred.resolve(blob), jpeg ? "image/jpeg" : "image/png", jpeg ? JPEG_QUALITY : undefined);
	return deferred.promise;
}

/**
 * The picture as `{mimeType, data}`, ready for `/api/sessions/:id/prompt`.
 * Small files go through untouched; larger ones are downscaled and re-encoded.
 */
export async function preparePromptImage(file: File): Promise<PromptImage> {
	if (!(PROMPT_IMAGE_TYPES as readonly string[]).includes(file.type)) {
		throw new Error("图片格式不支持（只支持 PNG、JPEG、WebP）");
	}
	const mimeType = file.type as PromptImage["mimeType"];
	if (file.size <= PROMPT_IMAGE_MAX_BYTES) {
		const data = base64(new Uint8Array(await file.arrayBuffer()));
		if (data.length > PROMPT_IMAGE_MAX_BASE64) throw new Error("图片太大，发不出去");
		return { mimeType, data };
	}

	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		throw new Error("图片处理失败");
	}
	try {
		let jpeg = mimeType !== "image/png";
		let scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
		let blob: Blob | null = null;
		// One PNG-to-JPEG switch, then three shrinks: enough to fit 450 KB twice over.
		for (let round = 0; round < 4; round += 1) {
			blob = await encode(draw(bitmap, scale, jpeg), jpeg);
			if (!blob) throw new Error("图片处理失败");
			if (blob.size <= PROMPT_IMAGE_MAX_BYTES) break;
			if (jpeg) scale *= 0.75;
			else jpeg = true;
		}
		if (!blob || blob.size > PROMPT_IMAGE_MAX_BYTES) throw new Error("图片太大，发不出去");
		const data = base64(new Uint8Array(await blob.arrayBuffer()));
		if (data.length > PROMPT_IMAGE_MAX_BASE64) throw new Error("图片太大，发不出去");
		return { mimeType: jpeg ? "image/jpeg" : "image/png", data };
	} finally {
		bitmap.close();
	}
}
