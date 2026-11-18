import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NO_SERVER, createIdeManager } from "../server/vscode-web.ts";

const roots: string[] = [];
const managers: Array<{ stop(): void }> = [];
const proxies: Array<{ close(): void }> = [];

after(() => {
	for (const manager of managers) manager.stop();
	for (const proxy of proxies) proxy.close();
	for (const root of roots) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

/** A stand-in web server: records its argv, prints a loopback URL, stays alive. */
function fakeServer(name: string): {
	bin: string;
	log: string;
	proxyLog: string;
	vsix: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
} {
	const dir = mkdtempSync(join(tmpdir(), "pcb-ide-"));
	roots.push(dir);
	const log = join(dir, "spawns.jsonl");
	const envLog = join(dir, "env.txt");
	const proxyLog = join(dir, "proxy.jsonl");
	const script = join(dir, "fake-server.mjs");
	writeFileSync(
		script,
		[
			`import { appendFileSync } from "node:fs";`,
			`const args = process.argv.slice(2);`,
			`appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");`,
			`appendFileSync(${JSON.stringify(envLog)}, "HTTPS_PROXY=" + String(process.env.HTTPS_PROXY ?? "none") + "\\n");`,
			`appendFileSync(${JSON.stringify(proxyLog)}, JSON.stringify({`,
			`  httpsProxy: process.env.HTTPS_PROXY ?? null,`,
			`  httpProxy: process.env.HTTP_PROXY ?? null,`,
			`  allProxy: process.env.ALL_PROXY ?? null,`,
			`  allProxyLower: process.env.all_proxy ?? null,`,
			`  noProxy: process.env.NO_PROXY ?? null,`,
			`}) + "\\n");`,
			`if (args.includes("--install-extension")) process.exit(0);`,
			`console.log("Web UI available at http://127.0.0.1:54321?tkn=fake");`,
			// A real subprocess has to outlive the spawn: the launcher only resolves once the
			// URL is printed and must still find the child alive on the next click. Timers in
			// this process cannot model that, so this fixture keeps itself running.
			`setInterval(() => {}, 1000);`,
		].join("\n"),
	);
	const bin = join(dir, process.platform === "win32" ? `${name}.cmd` : name);
	writeFileSync(
		bin,
		process.platform === "win32"
			? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
			: `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
	);
	const vsix = join(dir, "fake-ext.vsix");
	writeFileSync(vsix, "vsix");
	const cwd = join(dir, "workspace");
	// An empty folder is enough for the launcher; make one.
	mkdirSync(cwd, { recursive: true });
	return { bin, log, proxyLog, vsix, cwd, env: { ...process.env, PCB_VSCODE_WEB: bin, PCB_CKPT_VSIX: vsix } };
}

function invocations(log: string): string[][] {
	if (!existsSync(log)) return [];
	return readFileSync(log, "utf8")
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line) as string[]);
}

test("the fake web server is started on loopback with the folder and the license flag", async () => {
	const fake = fakeServer("openvscode-server");
	const manager = createIdeManager({ env: fake.env });
	managers.push(manager);

	const result = await manager.open(fake.cwd);
	assert.equal(result.ok, true, result.reason);
	assert.match(result.url ?? "", /^http:\/\/127\.0\.0\.1:54321/);

	const calls = invocations(fake.log);
	const serve = calls.find(args => !args.includes("--install-extension"));
	assert.ok(serve, "the server was started");
	assert.ok(serve.includes("--host"), "host flag");
	assert.equal(serve[serve.indexOf("--host") + 1], "127.0.0.1");
	assert.ok(serve.includes("--accept-server-license-terms"), "license accepted up front");
	assert.equal(serve[serve.indexOf("--default-folder") + 1], fake.cwd, "the session folder");
	for (const arg of serve) {
		assert.ok(!/0\.0\.0\.0/.test(arg), `no wildcard bind: ${arg}`);
		assert.ok(!/\bomp\b/i.test(arg), `nothing starts omp: ${arg}`);
	}
	assert.ok(!serve.some(arg => /^https?:\/\/(?!127\.0\.0\.1)/.test(arg)), "no public address handed to the server");
});

test("the extension is installed once, before the page is offered", async () => {
	const fake = fakeServer("openvscode-server");
	const manager = createIdeManager({ env: fake.env });
	managers.push(manager);

	await manager.open(fake.cwd);
	await manager.open(fake.cwd);
	const installs = invocations(fake.log).filter(args => args.includes("--install-extension"));
	assert.equal(installs.length, 1, "installed exactly once");
	assert.equal(installs[0]?.[installs[0].indexOf("--install-extension") + 1], fake.vsix);
});

test("a second open reuses the running server instead of starting another", async () => {
	const fake = fakeServer("openvscode-server");
	const manager = createIdeManager({ env: fake.env });
	managers.push(manager);

	const first = await manager.open(fake.cwd);
	const second = await manager.open(fake.cwd);
	assert.equal(second.ok, true);
	assert.equal(second.url, first.url);

	const servers = invocations(fake.log).filter(args => !args.includes("--install-extension"));
	assert.equal(servers.length, 1, "one process for the whole PCB process");
});

test("a build without --default-folder gets the folder as a URL parameter", async () => {
	const fake = fakeServer("code");
	const manager = createIdeManager({ env: fake.env });
	managers.push(manager);

	const result = await manager.open(fake.cwd);
	assert.equal(result.ok, true, result.reason);
	const serve = invocations(fake.log).find(args => !args.includes("--install-extension"));
	assert.ok(serve?.includes("serve-web"), "the subcommand the real binary needs");
	assert.ok(!serve?.includes("--default-folder"), "this build has no such flag");
	const page = new URL(result.url ?? "");
	assert.equal(page.searchParams.get("folder"), fake.cwd);
	assert.equal(page.searchParams.get("tkn"), "fake", "the connection token survives");
});

/** A local port that answers `05 00` — a SOCKS5 server's greeting reply. */
async function fakeSocks(): Promise<{ port: number; close(): void }> {
	const sockets = new Set<Socket>();
	const server = createServer(socket => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => undefined);
		socket.once("data", () => socket.write(Buffer.from([0x05, 0x00])));
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	return {
		port,
		close() {
			for (const socket of sockets) socket.destroy();
			server.close();
		},
	};
}

/** A local port that accepts and never answers — the timeout branch. */
async function fakeSilent(): Promise<{ port: number; close(): void }> {
	const sockets = new Set<Socket>();
	const server = createServer(socket => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => undefined);
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	return {
		port,
		close() {
			for (const socket of sockets) socket.destroy();
			server.close();
		},
	};
}

/** A local port that answers with a status line — an HTTP proxy. */
async function fakeHttp(): Promise<{ port: number; close(): void }> {
	const sockets = new Set<Socket>();
	const server = createServer(socket => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => undefined);
		socket.once("data", () => socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"));
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	return {
		port,
		close() {
			for (const socket of sockets) socket.destroy();
			server.close();
		},
	};
}

function lastProxyEnv(fake: { proxyLog: string }): {
	httpsProxy: string | null;
	httpProxy: string | null;
	allProxy: string | null;
	allProxyLower: string | null;
	noProxy: string | null;
} {
	const lines = readFileSync(fake.proxyLog, "utf8").trim().split("\n").filter(Boolean);
	return JSON.parse(lines.at(-1) ?? "{}");
}

test("a SOCKS5 port becomes ALL_PROXY, and the http:// variables for it go away", async () => {
	const socks = await fakeSocks();
	proxies.push(socks);
	const fake = fakeServer("openvscode-server");
	const address = `127.0.0.1:${socks.port}`;
	// A stale http:// entry for the same address must not survive into the child.
	const manager = createIdeManager({
		env: { ...fake.env, HTTPS_PROXY: `http://${address}` },
		proxy: `http://${address}`,
	});
	managers.push(manager);

	const result = await manager.open(fake.cwd);
	assert.equal(result.ok, true, result.reason);
	const env = lastProxyEnv(fake);
	assert.equal(env.allProxy, `socks5://${address}`);
	assert.equal(env.allProxyLower, `socks5://${address}`, "lowercase spelling too");
	assert.equal(env.httpsProxy, null, "no http:// claim on a SOCKS port");
	assert.equal(env.httpProxy, null);
	assert.match(env.noProxy ?? "", /127\.0\.0\.1/);
});

test("an HTTP proxy keeps HTTPS_PROXY and never sets ALL_PROXY", async () => {
	const http = await fakeHttp();
	proxies.push(http);
	const fake = fakeServer("openvscode-server");
	const address = `127.0.0.1:${http.port}`;
	const manager = createIdeManager({ env: fake.env, proxy: `http://${address}` });
	managers.push(manager);

	await manager.open(fake.cwd);
	const env = lastProxyEnv(fake);
	assert.equal(env.httpsProxy, `http://${address}`);
	assert.equal(env.httpProxy, `http://${address}`);
	assert.equal(env.allProxy, null);
	assert.equal(env.allProxyLower, null);
});

test("a port that answers nothing is neither flavour: the child gets no proxy", async () => {
	const silent = await fakeSilent();
	proxies.push(silent);
	const fake = fakeServer("openvscode-server");
	const address = `127.0.0.1:${silent.port}`;
	const manager = createIdeManager({ env: fake.env, proxy: `http://${address}` });
	managers.push(manager);

	const result = await manager.open(fake.cwd);
	assert.equal(result.ok, true, result.reason);
	const env = lastProxyEnv(fake);
	assert.equal(env.httpsProxy, null, "guessing http:// is what broke the download");
	assert.equal(env.allProxy, null);
	assert.equal(env.noProxy, null, "no proxy at all, so no bypass list either");
});

test("no candidate on this machine: one line, and nothing is spawned", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pcb-ide-none-"));
	roots.push(dir);
	const missing = join(dir, process.platform === "win32" ? "vscode.cmd" : "vscode");
	const manager = createIdeManager({
		env: { PATH: dir, PATHEXT: ".CMD", PCB_VSCODE_WEB: missing, PCB_CKPT_VSIX: join(dir, "none.vsix") },
	});
	managers.push(manager);

	const result = await manager.open(dir);
	assert.equal(result.ok, false);
	assert.equal(result.reason, NO_SERVER);
	assert.equal(existsSync(missing), false);
});
