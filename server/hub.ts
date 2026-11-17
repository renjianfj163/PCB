/** Server-sent events fanout to every open browser tab. */

import type { ServerResponse } from "node:http";
import type { UiEvent } from "../shared/protocol.ts";

export class Hub {
	#clients = new Set<ServerResponse>();
	#heartbeat: NodeJS.Timeout;

	constructor() {
		this.#heartbeat = setInterval(() => {
			for (const client of this.#clients) client.write(": ping\n\n");
		}, 20_000);
		this.#heartbeat.unref();
	}

	add(response: ServerResponse) {
		this.#clients.add(response);
		response.on("close", () => this.#clients.delete(response));
	}

	broadcast(event: UiEvent) {
		const payload = `data: ${JSON.stringify(event)}\n\n`;
		for (const client of this.#clients) {
			try {
				client.write(payload);
			} catch {
				this.#clients.delete(client);
			}
		}
	}
}
