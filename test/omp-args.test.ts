import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ckptHost, launchArgs } from "../server/omp-args.ts";

const record = { cwd: "C:\\work\\app", extensions: false, phase: "build" };
const HOST = "C:\\ckpt\\omp-host.ts";

const flags = (args: string[], flag: string) => args.filter(arg => arg === flag).length;

test("the omp-ckpt host is the only extension on the command line", () => {
	const args = launchArgs(record, HOST, "PROMPT");
	assert.equal(flags(args, "-e"), 1, "exactly one -e");
	assert.equal(args[args.indexOf("-e") + 1], HOST);
	// --no-extensions kills discovery, not the explicit path; both belong here.
	assert.equal(flags(args, "--no-extensions"), 1);
	assert.ok(args.includes("always-ask"));
	assert.equal(flags(args, "--extension"), 0);
});

test("without the host file the session still launches, just without it", () => {
	const args = launchArgs(record, null, "PROMPT");
	assert.equal(flags(args, "-e"), 0);
	assert.ok(args.includes("--no-extensions"));
	assert.equal(args[args.indexOf("--mode") + 1], "rpc-ui");
});

test("an existing session file is resumed after the host is named", () => {
	const args = launchArgs({ ...record, sessionFile: "C:\\tmp\\s.jsonl" }, HOST, "P");
	assert.deepEqual(args.slice(-2), ["--resume", "C:\\tmp\\s.jsonl"]);
	assert.ok(args.indexOf("-e") < args.indexOf("--resume"));
});

test("extensions on means no --no-extensions, and the host still loads once", () => {
	const args = launchArgs({ ...record, extensions: true }, HOST, "P");
	assert.equal(flags(args, "--no-extensions"), 0);
	assert.equal(flags(args, "-e"), 1);
});

test("PCB_OMP_CKPT_HOST is used only when that file exists", () => {
	assert.equal(ckptHost({}), null, "nothing is loaded when the variable is unset");
	assert.equal(ckptHost({ PCB_OMP_CKPT_HOST: "   " }), null);
	assert.equal(ckptHost({ PCB_OMP_CKPT_HOST: "C:\\nope\\host.ts" }), null, "a missing file never blocks a session");

	const dir = mkdtempSync(join(tmpdir(), "pcb-ckpt-host-"));
	const host = join(dir, "omp-host.ts");
	writeFileSync(host, "// host\n");
	assert.equal(ckptHost({ PCB_OMP_CKPT_HOST: host }), host);
	assert.equal(ckptHost({ PCB_OMP_CKPT_HOST: `  ${host}  ` }), host, "surrounding spaces are trimmed");
});
