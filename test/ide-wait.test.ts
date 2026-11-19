import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import { after, test } from "node:test";
import { percentOf, serverZipUrl } from "../server/download-progress.ts";
import { ideJobStatus, ideReady, startIdeJob, waitPage } from "../server/ide-wait.ts";

const servers: Server[] = [];

after(() => {
	for (const server of servers) server.close();
});

/**
 * A stand-in editor server: answers 202 (still downloading) a few times, then 200.
 * That is exactly the transition the waiting page has to notice.
 */
async function fakeEditor(target: { status: number }): Promise<string> {
	const server = createServer((_request, response: ServerResponse) => {
		response.writeHead(target.status);
		response.end();
	});
	servers.push(server);
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	return `http://127.0.0.1:${port}/?tkn=t`;
}

test("a 202 server is not ready, a 200 one is", async () => {
	const target = { status: 202 };
	const url = await fakeEditor(target);
	assert.equal(await ideReady(url), false);
	target.status = 200;
	assert.equal(await ideReady(url), true);
});

test("an unreachable port is not ready", async () => {
	const url = await fakeEditor({ status: 200 });
	servers.pop()?.close();
	assert.equal(await ideReady(url), false);
});

test("the job walks starting → downloading → ready, carrying the target", async () => {
	const target = { status: 202 };
	const url = await fakeEditor(target);
	let release: (value: { ok: boolean; url?: string }) => void = () => undefined;
	const launch = new Promise<{ ok: boolean; url?: string }>(resolve => {
		release = resolve;
	});

	const job = startIdeJob(() => launch, "D:\\Developer\\3PP_search");
	assert.equal((await ideJobStatus(job)).phase, "starting");

	release({ ok: true, url });
	await new Promise(resolve => setImmediate(resolve));
	const downloading = await ideJobStatus(job);
	assert.equal(downloading.phase, "downloading");
	assert.equal(downloading.target, url);

	target.status = 200;
	assert.equal((await ideJobStatus(job)).phase, "ready");
});

test("a failed launch becomes a failure with a sentence", async () => {
	const job = startIdeJob(() => Promise.resolve({ ok: false, reason: "本机没有 VS Code 网页服务" }), "C:\\x");
	await new Promise(resolve => setImmediate(resolve));
	const status = await ideJobStatus(job);
	assert.equal(status.phase, "failed");
	assert.equal(status.reason, "本机没有 VS Code 网页服务");
});

test("an unknown job id fails instead of hanging the page", async () => {
	const status = await ideJobStatus("nope");
	assert.equal(status.phase, "failed");
	assert.match(status.reason ?? "", /再点一次/);
});

test("the waiting page carries a bar, a poll and both languages", () => {
	const zh = waitPage("abc123", "zh");
	assert.match(zh, /class="track"/, "a real progress track");
	assert.match(zh, /\/api\/vscode\/status\?lang=zh/, "it asks PCB for the phase, in the page's language");
	assert.match(zh, /location\.replace/, "and navigates by itself");
	assert.match(zh, /abc123/, "the job id is baked in");
	const en = waitPage("abc123", "en");
	assert.match(en, /Starting the local VS Code web server/);
	assert.doesNotMatch(en, /正在启动本机的/);
});

test("a download stuck past the deadline becomes a sentence with the way out", async () => {
	const url = await fakeEditor({ status: 202 });
	const job = startIdeJob(() => Promise.resolve({ ok: true, url }), "C:\\x", {
		startedAt: Date.now() - 31 * 60_000,
	});
	await new Promise(resolve => setImmediate(resolve));

	const zh = await ideJobStatus(job, "zh");
	assert.equal(zh.phase, "failed", "not an endless bar");
	assert.match(zh.reason ?? "", /PCB_VSCODE_SERVER_FILE/, "names the file route");
	assert.match(zh.reason ?? "", /PCB_VSCODE_SERVER_URL/, "and the mirror route");

	const en = await ideJobStatus(job, "en");
	assert.match(en.reason ?? "", /PCB_VSCODE_SERVER_URL/);
	assert.doesNotMatch(en.reason ?? "", /下不下来/);
});

test("the percentage is a floor of bytes over the archive, never 100", () => {
	assert.equal(percentOf(0, 249_458_900), null, "nothing measured yet");
	assert.equal(percentOf(1000, null), null, "no size, no percentage");
	assert.equal(percentOf(249_458_900 / 2, 249_458_900), 50);
	assert.equal(percentOf(249_458_899, 249_458_900), 99, "the last byte is not 'done'");
	assert.equal(percentOf(1_000_000_000, 249_458_900), 99, "extra bytes from other traffic are clamped");
});

test("the archive url names this platform and architecture", () => {
	assert.equal(
		serverZipUrl("8a14f0cc1b08d531eb83255ea3764ae22aa932b5", "win32", "x64"),
		"https://update.code.visualstudio.com/commit:8a14f0cc1b08d531eb83255ea3764ae22aa932b5/server-win32-x64-web/stable",
	);
	assert.match(serverZipUrl("abc", "darwin", "arm64"), /server-darwin-arm64-web/);
});

test("the bar is only a crawl when nothing can be measured", () => {
	// The page itself decides: with a number it fills to it, without one it crawls.
	assert.match(waitPage("abc123", "zh"), /typeof status\.percent === "number"/);
	assert.match(waitPage("abc123", "zh"), /已下载 \{p\}%/);
	assert.match(waitPage("abc123", "en"), /Downloading \{p\}%/);
});
