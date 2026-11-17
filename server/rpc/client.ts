/**
 * Minimal omp RPC client: newline-delimited JSON over a child's stdio.
 *
 * Implements exactly what docs/rpc.md promises for protocol v1/v2:
 *  - one JSON object per line, both directions
 *  - `ready` first, then `negotiate_protocol: 2` so oversized objects arrive as
 *    `rpc_chunk` sequences instead of being truncated
 *  - responses correlate on `id`; events carry no id
 */

import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

export type RpcFrame = Record<string, unknown> & { type: string };

export interface RpcResponse extends RpcFrame {
	type: "response";
	command?: string;
	success?: boolean;
	data?: unknown;
	error?: string;
	code?: string;
}

export interface RpcClientOptions {
	bin: string;
	args: string[];
	cwd: string;
	env?: NodeJS.ProcessEnv;
	onFrame: (frame: RpcFrame) => void;
	onExit: (info: { code: number | null; signal: string | null; stderr: string }) => void;
	onLog?: (message: string) => void;
}

interface Pending {
	resolve: (value: RpcResponse) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

interface ChunkAssembly {
	count: number;
	byteLength: number;
	parts: Map<number, Buffer>;
	received: number;
}

const REQUEST_TIMEOUT_MS = 30_000;

/** Commands that wait on discovery, provider round trips, or a whole turn. */
const SLOW_COMMANDS: Record<string, true> = {
	get_available_models: true,
	get_login_providers: true,
	export_html: true,
	get_messages: true,
	get_messages_page: true,
	compact: true,
	handoff: true,
	login: true,
};

const STDERR_KEEP = 8 * 1024;
const READY_TIMEOUT_MS = 60_000;

export class RpcClient {
	#options: RpcClientOptions;
	#child: ChildProcessWithoutNullStreams | undefined;
	#pending = new Map<string, Pending>();
	#stdout = "";
	#stderr = "";
	#chunks = new Map<string, ChunkAssembly>();
	#requestSeq = 0;
	#exited = false;
	#exitPromise: Promise<{ code: number | null; signal: string | null; stderr: string }> | undefined;
	#readyDeferred = Promise.withResolvers<RpcFrame>();

	constructor(options: RpcClientOptions) {
		this.#options = options;
	}

	get exited(): boolean {
		return this.#exited;
	}

	get stderr(): string {
		return this.#stderr;
	}

	/** Spawn the child and resolve with its `ready` frame. */
	async start(): Promise<RpcFrame> {
		const child = spawn(this.#options.bin, this.#options.args, {
			cwd: this.#options.cwd,
			env: { ...process.env, ...this.#options.env },
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		this.#child = child;

		const exited = Promise.withResolvers<{ code: number | null; signal: string | null; stderr: string }>();
		this.#exitPromise = exited.promise;

		child.once("exit", (code, signal) => {
			this.#exited = true;
			for (const [id, pending] of this.#pending) {
				clearTimeout(pending.timer);
				pending.reject(new Error(`omp exited before answering ${id}`));
			}
			this.#pending.clear();
			this.#readyDeferred.reject(new Error(`omp exited before ready (code ${code})`));
			const info = { code, signal, stderr: this.#stderr };
			exited.resolve(info);
			this.#options.onExit(info);
		});
		child.once("error", error => {
			this.#stderr += `\n[spawn] ${error.message}`;
		});

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.#onStdout(chunk));
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			this.#stderr = (this.#stderr + chunk).slice(-STDERR_KEEP);
		});

		const timer = setTimeout(
			() => this.#readyDeferred.reject(new Error("omp did not report ready within 60s")),
			READY_TIMEOUT_MS,
		);
		let ready: RpcFrame;
		try {
			ready = await this.#readyDeferred.promise;
		} finally {
			clearTimeout(timer);
		}

		// Opt into the lossless transport before any payload can overflow 1 MiB.
		try {
			await this.request({ type: "negotiate_protocol", protocolVersion: 2 }, 10_000);
		} catch (error) {
			this.#options.onLog?.(`negotiate_protocol failed: ${(error as Error).message}`);
		}
		return ready;
	}

	#onStdout(chunk: string) {
		this.#stdout += chunk;
		let newline: number;
		while ((newline = this.#stdout.indexOf("\n")) >= 0) {
			const line = this.#stdout.slice(0, newline);
			this.#stdout = this.#stdout.slice(newline + 1);
			if (line.trim()) this.#handleLine(line);
		}
	}

	#handleLine(line: string) {
		let frame: RpcFrame;
		try {
			frame = JSON.parse(line) as RpcFrame;
		} catch {
			this.#options.onLog?.(`unparsable frame: ${line.slice(0, 200)}`);
			return;
		}
		if (frame.type === "rpc_chunk") {
			const assembled = this.#assemble(frame);
			if (assembled) this.#handleLine(assembled);
			return;
		}
		if (frame.type === "ready") this.#readyDeferred.resolve(frame);
		if (frame.type === "response") {
			const id = typeof frame.id === "string" ? frame.id : undefined;
			const pending = id === undefined ? undefined : this.#pending.get(id);
			if (pending && id !== undefined) {
				clearTimeout(pending.timer);
				this.#pending.delete(id);
				pending.resolve(frame as RpcResponse);
			}
		}
		if (frame.type === "rpc_frame_error") {
			this.#options.onLog?.(`transport overflow: ${JSON.stringify(frame).slice(0, 200)}`);
		}
		this.#options.onFrame(frame);
	}

	#assemble(frame: RpcFrame): string | undefined {
		const chunkId = String(frame.chunkId);
		const index = Number(frame.index);
		const count = Number(frame.count);
		const byteLength = Number(frame.byteLength);
		const data = typeof frame.data === "string" ? frame.data : "";
		let assembly = this.#chunks.get(chunkId);
		if (!assembly) {
			assembly = { count, byteLength, parts: new Map(), received: 0 };
			this.#chunks.set(chunkId, assembly);
		}
		if (assembly.count !== count || assembly.byteLength !== byteLength || assembly.parts.has(index)) {
			this.#chunks.delete(chunkId);
			this.#options.onLog?.(`interrupted chunk sequence ${chunkId}`);
			return undefined;
		}
		assembly.parts.set(index, Buffer.from(data, "base64"));
		assembly.received++;
		if (assembly.received < count) return undefined;
		this.#chunks.delete(chunkId);
		const parts: Buffer[] = [];
		for (let i = 0; i < count; i++) {
			const part = assembly.parts.get(i);
			if (!part) {
				this.#options.onLog?.(`missing chunk ${chunkId}#${i}`);
				return undefined;
			}
			parts.push(part);
		}
		const buffer = Buffer.concat(parts);
		if (buffer.byteLength !== byteLength) {
			this.#options.onLog?.(`chunk byteLength mismatch ${chunkId}`);
			return undefined;
		}
		return buffer.toString("utf8");
	}

	/** Fire-and-forget command write. */
	send(command: Record<string, unknown>) {
		const child = this.#child;
		if (!child || this.#exited) throw new Error("omp process is not running");
		child.stdin.write(`${JSON.stringify(command)}\n`);
	}

	/** Send a command and wait for its correlated response. */
	async request(command: Record<string, unknown> & { type: string }, timeoutMs?: number): Promise<RpcResponse> {
		const id = `pcb_${++this.#requestSeq}`;
		const timeout = timeoutMs ?? (SLOW_COMMANDS[command.type] ? 180_000 : REQUEST_TIMEOUT_MS);
		const deferred = Promise.withResolvers<RpcResponse>();
		const timer = setTimeout(() => {
			this.#pending.delete(id);
			deferred.reject(new Error(`${command.type} timed out after ${timeout}ms`));
		}, timeout);
		this.#pending.set(id, { resolve: deferred.resolve, reject: deferred.reject, timer });
		try {
			this.send({ id, ...command });
		} catch (error) {
			clearTimeout(timer);
			this.#pending.delete(id);
			throw error;
		}
		return deferred.promise;
	}

	/** Request, throwing on `success: false`. */
	async call<T = unknown>(command: Record<string, unknown> & { type: string }, timeoutMs?: number): Promise<T> {
		const response = await this.request(command, timeoutMs);
		if (response.success === false) throw new Error(response.error ?? `${command.type} failed`);
		return response.data as T;
	}

	respondToDialog(id: string, answer: Record<string, unknown>) {
		this.send({ type: "extension_ui_response", id, ...answer });
	}

	/** Close stdin, then make sure the child is gone. */
	async close(graceMs = 5_000): Promise<void> {
		const child = this.#child;
		const exit = this.#exitPromise;
		if (!child || !exit) return;
		if (!this.#exited) {
			try {
				child.stdin.end();
			} catch {
				// stdin already closed
			}
		}
		const timer = setTimeout(() => {
			if (!this.#exited) child.kill();
		}, graceMs);
		try {
			await exit;
		} finally {
			clearTimeout(timer);
		}
	}

	kill() {
		this.#child?.kill();
	}
}
