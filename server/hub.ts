/** Server-sent events fanout to every open browser tab. */

import type { ServerResponse } from "node:http";
import type { UiEvent } from "../shared/protocol.ts";

/** Snapshots are collected for this long, then the newest one per key goes out. */
export const FLUSH_MS = 80;
/** A client buffering more than this is not reading: snapshots are dropped, not queued. */
export const CLIENT_BUFFER_MAX = 4 * 1024 * 1024;
/** Far past the soft limit the socket is dead: stop pretending it will drain. */
export const CLIENT_BUFFER_KILL = 32 * 1024 * 1024;

/**
 * Full-snapshot events: each one replaces everything the previous one said, so a
 * slow tick only has to keep the last. omp's streaming frames carry the whole
 * partial message (`message_update`) or the whole partial output
 * (`tool_execution_update`), and a thinking block of N characters produces
 * frames whose sizes add up to N²/2 — the reason a long turn could drive the
 * server to a 4 GB heap and abort.
 */
export function snapshotKey(event: UiEvent): string | null {
	if (event.t !== "frame") return null;
	const frame = event.frame;
	const type = String(frame.type ?? "");
	if (type !== "message_update" && type !== "tool_execution_update") return null;
	const callId = typeof frame.toolCallId === "string" ? frame.toolCallId : "";
	return event.sessionId + "|" + type + "|" + callId;
}

interface Queued {
	/** Non-null for a snapshot: the only kind that may be dropped when the client lags. */
	key: string | null;
	payload: string;
}

interface Client {
	response: ServerResponse;
	items: Queued[];
	/** key → index in `items`, so a newer snapshot replaces an older one in place. */
	at: Map<string, number>;
	/** Snapshots skipped because this client was not reading. */
	dropped: number;
}

export class Hub {
	#clients = new Map<ServerResponse, Client>();
	#timer: NodeJS.Timeout | undefined;
	#heartbeat: NodeJS.Timeout;

	constructor() {
		this.#heartbeat = setInterval(() => {
			for (const client of this.#clients.values()) this.#write(client, ": ping\n\n");
			this.#flush();
		}, 20_000);
		this.#heartbeat.unref();
	}

	add(response: ServerResponse) {
		if (this.#clients.has(response)) return;
		this.#clients.set(response, { response, items: [], at: new Map(), dropped: 0 });
		response.on("close", () => this.#drop(response));
	}

	broadcast(event: UiEvent) {
		const payload = `data: ${JSON.stringify(event)}\n\n`;
		const key = snapshotKey(event);
		for (const client of [...this.#clients.values()]) {
			// Nobody is reading this one any more; nothing we write will ever leave.
			if (client.response.writableLength > CLIENT_BUFFER_KILL) {
				client.dropped += 1;
				this.#drop(client.response);
				continue;
			}
			if (key === null) {
				client.items.push({ key: null, payload });
				continue;
			}
			const index = client.at.get(key);
			if (index === undefined) {
				client.at.set(key, client.items.length);
				client.items.push({ key, payload });
			} else {
				// Same snapshot, newer content: keep its place in the order.
				client.items[index] = { key, payload };
			}
		}
		this.#arm();
	}

	#arm() {
		if (this.#timer) return;
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			this.#flush();
		}, FLUSH_MS);
		this.#timer.unref();
	}

	#flush() {
		for (const client of [...this.#clients.values()]) {
			const items = client.items;
			if (items.length === 0) continue;
			client.items = [];
			client.at.clear();
			for (const item of items) {
				// A lagging client keeps the newest snapshot for the next tick; the one
				// it is skipping would only add to a backlog it cannot read anyway.
				if (item.key !== null && client.response.writableLength > CLIENT_BUFFER_MAX) {
					client.dropped += 1;
					continue;
				}
				this.#write(client, item.payload);
			}
			if (client.dropped > 0 && client.items.length === 0) {
				if (client.response.writableLength < CLIENT_BUFFER_MAX) client.dropped = 0;
			}
		}
	}

	#write(client: Client, payload: string) {
		try {
			client.response.write(payload);
		} catch {
			this.#drop(client.response);
		}
	}

	#drop(response: ServerResponse) {
		const client = this.#clients.get(response);
		if (client && client.dropped > 0) {
			console.warn(`hub: dropped ${client.dropped} snapshot frame(s) for a client that stopped reading`);
		}
		this.#clients.delete(response);
		if (this.#clients.size === 0 && this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = undefined;
		}
	}
}
