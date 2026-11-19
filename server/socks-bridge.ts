import { connect, createServer, type Socket } from "node:net";

/**
 * A loopback HTTP proxy that speaks SOCKS5 upstream.
 *
 * `code serve-web` downloads its web client from update.code.visualstudio.com and
 * only understands HTTP_PROXY: the binary has no `socks5` string at all, so the
 * SOCKS5 URL this machine has (xray on 10808) leaves the download connected and
 * silent. Pointing HTTPS_PROXY straight at the SOCKS port does the same. So the
 * child talks plain HTTP to this bridge, and the bridge carries CONNECT onward
 * through SOCKS5.
 */
export interface SocksBridge {
	/** `http://127.0.0.1:<port>` — what HTTP_PROXY / HTTPS_PROXY should be. */
	url: string;
	close(): void;
}

/** Listen on 127.0.0.1 and forward every CONNECT through the SOCKS5 proxy. */
export function startSocksBridge(socksHost: string, socksPort: number): Promise<SocksBridge> {
	const live = new Set<Socket>();
	const keep = (socket: Socket) => {
		live.add(socket);
		socket.on("close", () => live.delete(socket));
		socket.on("error", () => socket.destroy());
	};

	const server = createServer(client => {
		keep(client);
		readHeader(client, (request, rest) => {
			const line = request.split("\r\n", 1)[0] ?? "";
			const match = /^CONNECT\s+(\S+):(\d+)\s+HTTP\/1\.[01]$/i.exec(line.trim());
			if (!match) {
				client.end("HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
				return;
			}
			const host = match[1] ?? "";
			const port = Number(match[2]);
			openSocks(socksHost, socksPort, host, port).then(
				({ socket: upstream, rest: early }) => {
					keep(upstream);
					if (client.destroyed) {
						upstream.destroy();
						return;
					}
					client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
					if (rest.length > 0) upstream.write(rest);
					if (early.length > 0) client.write(early);
					client.pipe(upstream);
					upstream.pipe(client);
				},
				(error: Error) => {
					client.end(`HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
					client.destroy();
					void error;
				},
			);
		});
	});

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.removeListener("error", reject);
			server.on("error", () => undefined);
			const address = server.address();
			const port = address && typeof address === "object" ? address.port : 0;
			resolve({
				url: `http://127.0.0.1:${port}`,
				close() {
					for (const socket of live) socket.destroy();
					live.clear();
					server.close();
				},
			});
		});
	});
}

/** Collect bytes until the HTTP header terminator; anything after it is the tunnel's. */
function readHeader(socket: Socket, ready: (header: string, rest: Buffer) => void) {
	let buffer = Buffer.alloc(0);
	const onData = (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);
		const end = buffer.indexOf("\r\n\r\n");
		if (end < 0) {
			// A CONNECT header is short; anything longer is not one.
			if (buffer.length > 8192) socket.destroy();
			return;
		}
		socket.off("data", onData);
		ready(buffer.subarray(0, end).toString("latin1"), buffer.subarray(end + 4));
	};
	socket.on("data", onData);
	socket.once("close", () => socket.off("data", onData));
}

/**
 * Reads exact byte counts off a socket without losing anything: SOCKS replies can
 * arrive split across packets, or several of them inside one.
 */
function bufferedReader(socket: Socket) {
	let pending = Buffer.alloc(0);
	const waiters: Array<{ size: number; resolve: (bytes: Buffer) => void; reject: (error: Error) => void }> = [];
	const pump = () => {
		while (waiters.length > 0 && pending.length >= (waiters[0] as { size: number }).size) {
			const waiter = waiters.shift() as (typeof waiters)[number];
			const slice = pending.subarray(0, waiter.size);
			pending = pending.subarray(waiter.size);
			waiter.resolve(slice);
		}
	};
	const onData = (chunk: Buffer) => {
		pending = Buffer.concat([pending, chunk]);
		pump();
	};
	const fail = (error: Error) => {
		for (const waiter of waiters.splice(0)) waiter.reject(error);
	};
	const onError = (error: Error) => fail(error);
	const onClose = () => fail(new Error("socks closed"));
	socket.on("data", onData);
	socket.once("error", onError);
	socket.once("close", onClose);
	return {
		read(size: number): Promise<Buffer> {
			return new Promise<Buffer>((resolve, reject) => {
				waiters.push({ size, resolve, reject });
				pump();
			});
		},
		/** Stop reading; whatever arrived beyond the handshake belongs to the tunnel. */
		dispose(): Buffer {
			socket.off("data", onData);
			socket.off("error", onError);
			socket.off("close", onClose);
			const rest = pending;
			pending = Buffer.alloc(0);
			return rest;
		},
	};
}

/** SOCKS5 no-auth CONNECT; resolves with the tunnelled socket and any early bytes. */
async function openSocks(
	socksHost: string,
	socksPort: number,
	host: string,
	port: number,
): Promise<{ socket: Socket; rest: Buffer }> {
	const socket = connect({ host: socksHost, port: socksPort });
	socket.setTimeout(15_000, () => socket.destroy(new Error("socks timeout")));
	const reader = bufferedReader(socket);
	try {
		await new Promise<void>((resolve, reject) => {
			socket.once("connect", resolve);
			socket.once("error", reject);
		});
		socket.write(Buffer.from([0x05, 0x01, 0x00]));
		const greeting = await reader.read(2);
		if (greeting[0] !== 0x05 || greeting[1] !== 0x00) throw new Error("socks refused no-auth");
		const name = Buffer.from(host);
		const request = Buffer.alloc(5 + name.length + 2);
		request[0] = 0x05;
		request[1] = 0x01;
		request[2] = 0x00;
		request[3] = 0x03;
		request[4] = name.length;
		name.copy(request, 5);
		request.writeUInt16BE(port, 5 + name.length);
		socket.write(request);
		// Reply: version, code, reserved, type, address (4 / 16 / 1+len), port.
		const head = await reader.read(4);
		if (head[1] !== 0x00) throw new Error(`socks connect refused (${head[1]})`);
		const kind = head[3];
		const addressLength = kind === 0x01 ? 4 : kind === 0x04 ? 16 : (await reader.read(1))[0] ?? 0;
		await reader.read(addressLength + 2);
		socket.setTimeout(0);
		return { socket, rest: reader.dispose() };
	} catch (error) {
		reader.dispose();
		socket.destroy();
		throw error;
	}
}
