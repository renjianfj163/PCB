/**
 * omp externalizes large images out of the session JSONL into a content-addressed
 * blob store (`~/.omp/agent/blobs/<sha256>`), leaving `blob:sha256:<hash>` in the
 * message. The browser page needs those bytes back, so this reads them — read-only,
 * by hash only, never by path.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BLOB_DIR = join(homedir(), ".omp", "agent", "blobs");
const HASH = /^[a-f0-9]{64}$/;
const PREFIX = "blob:sha256:";
const MAX_BYTES = 16 * 1024 * 1024;
const EXTENSIONS = ["", ".png", ".jpg", ".jpeg", ".webp", ".gif"];

function sniff(bytes: Buffer): string {
	if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
		return "image/png";
	}
	if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
	if (bytes.length > 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") {
		return "image/webp";
	}
	if (bytes.length > 4 && bytes.subarray(0, 3).toString() === "GIF") return "image/gif";
	return "application/octet-stream";
}

function blobFile(ref: string): string | null {
	const hash = ref.startsWith(PREFIX) ? ref.slice(PREFIX.length) : ref;
	if (!HASH.test(hash)) return null;
	for (const extension of EXTENSIONS) {
		const candidate = join(BLOB_DIR, hash + extension);
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return null;
}

/** Image bytes for a `blob:sha256:` reference, or null when it is not on this machine. */
export function readBlob(ref: string): { bytes: Buffer; type: string } | null {
	const file = blobFile(ref);
	if (!file) return null;
	if (statSync(file).size > MAX_BYTES) return null;
	const bytes = readFileSync(file);
	// Provider images can be externalized as a whole data URL instead of raw bytes.
	if (bytes.subarray(0, 5).toString() === "data:") {
		const text = bytes.toString("utf8");
		const comma = text.indexOf(",");
		if (comma > 0) {
			const type = text.slice(5, comma).split(";")[0] || "application/octet-stream";
			return { bytes: Buffer.from(text.slice(comma + 1), "base64"), type };
		}
	}
	return { bytes, type: sniff(bytes) };
}
