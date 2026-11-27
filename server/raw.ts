/**
 * The omp child's own output, kept only while somebody is looking.
 *
 * Nothing here runs unless a window has the "show raw output" switch on: the
 * buffer only exists between the first SSE watcher connecting and the last one
 * leaving, so the closed state costs nothing and keeps no history.
 */

import type { RawEvent, RawStream } from "../shared/protocol.ts";

/** Lines kept per session; the oldest fall off the front. */
export const RAW_LIMIT = 1000;
/** A single line longer than this is cut, because a protocol frame can be megabytes. */
export const RAW_LINE_MAX = 2048;
export const RAW_TRUNCATED = "…（已截断）";

export interface RawEntry {
	stream: RawStream;
	line: string;
	at: number;
}

const BASE64_RUN = /"[A-Za-z0-9+/]{240,}={0,2}"/g;
const DATA_URI = /data:[\w/+.-]+;base64,[A-Za-z0-9+/=]{120,}/g;

/**
 * A payload blob is one fact, not a page of noise: say how big it was and move on.
 * Only JSON string values are treated as blobs — a long prose line stays readable.
 */
function collapse(line: string): string {
	return line
		.replace(DATA_URI, match => `data:…（base64 ${match.length} 字符已省略）`)
		.replace(BASE64_RUN, match => `"…（base64 ${match.length - 2} 字符已省略）"`);
}

/** One line, fit to read: blobs collapsed, then cut at RAW_LINE_MAX. */
export function fitLine(line: string): string {
	// A megabyte-sized frame is cut anyway; running both blob patterns over it
	// first only burns CPU on the stream's hottest path.
	const short = line.length > 1_000_000 ? line : collapse(line);
	return short.length > RAW_LINE_MAX ? `${short.slice(0, RAW_LINE_MAX)}${RAW_TRUNCATED}` : short;
}

/** Append one line, dropping the oldest once the buffer is full. */
export function pushRaw(buffer: readonly RawEntry[], entry: RawEntry): RawEntry[] {
	const next = [...buffer, { ...entry, line: fitLine(entry.line) }];
	return next.length > RAW_LIMIT ? next.slice(next.length - RAW_LIMIT) : next;
}

const buffers = new Map<string, RawEntry[]>();
const watchers = new Set<(event: RawEvent) => void>();

/** How many raw SSE connections are open; 0 means nothing is recorded. */
export function rawWatchers(): number {
	return watchers.size;
}

/**
 * Register a raw stream consumer. The returned function is the whole lifecycle:
 * when the last consumer leaves, every session's buffer is dropped.
 */
export function watchRaw(listener: (event: RawEvent) => void): () => void {
	watchers.add(listener);
	let closed = false;
	return () => {
		if (closed) return;
		closed = true;
		watchers.delete(listener);
		if (watchers.size === 0) buffers.clear();
	};
}

/** One line from a session's child process. A no-op while nobody is watching. */
export function appendRaw(sessionId: string, stream: RawStream, line: string, at = Date.now()): void {
	if (watchers.size === 0) return;
	const next = pushRaw(buffers.get(sessionId) ?? [], { stream, line, at });
	buffers.set(sessionId, next);
	const last = next[next.length - 1];
	if (!last) return;
	const event: RawEvent = { t: "raw", sessionId, stream: last.stream, line: last.line, at: last.at };
	for (const watcher of watchers) watcher(event);
}

/** What this session recorded while the switch was on — never anything from before it. */
export function rawLines(sessionId: string): RawEntry[] {
	return buffers.get(sessionId) ?? [];
}

/** Clear one session's buffer; other sessions keep theirs. */
export function clearRaw(sessionId: string): void {
	buffers.delete(sessionId);
}
