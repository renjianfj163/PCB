import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NO_CODE, createIdeManager, findCode } from "../server/vscode-desktop.ts";

const roots: string[] = [];

after(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

/** A stand-in `code` CLI: records its argv and exits. Optionally fails installs. */
function fakeCode(name: string, options: { failInstall?: boolean } = {}): {
	bin: string;
	log: string;
	vsix: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
} {
	const dir = mkdtempSync(join(tmpdir(), "pcb-code-"));
	roots.push(dir);
	const log = join(dir, "spawns.jsonl");
	const script = join(dir, "fake-code.mjs");
	writeFileSync(
		script,
		[
			`import { appendFileSync } from "node:fs";`,
			`const args = process.argv.slice(2);`,
			`appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");`,
			`if (args.includes("--install-extension") && ${options.failInstall ? "true" : "false"}) process.exit(1);`,
			`process.exit(0);`,
		].join("\n"),
	);
	const bin = join(dir, process.platform === "win32" ? `${name}.cmd` : name);
	writeFileSync(
		bin,
		process.platform === "win32"
			? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
			: `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
	);
	const vsix = join(dir, "omp-ckpt.vsix");
	writeFileSync(vsix, "vsix");
	const cwd = join(dir, "workspace");
	mkdirSync(cwd);
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PCB_VSCODE: bin,
		PCB_CKPT_VSIX: vsix,
		LOCALAPPDATA: join(dir, "empty-local"),
		ProgramFiles: join(dir, "empty-pf"),
		"ProgramFiles(x86)": join(dir, "empty-pf86"),
		PATH: dir,
		Path: dir,
	};
	return { bin, log, vsix, cwd, env };
}

function invocations(log: string): string[][] {
	if (!existsSync(log)) return [];
	return readFileSync(log, "utf8")
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line) as string[]);
}

test("desktop code opens the folder and never starts a web server", async () => {
	const fake = fakeCode("code");
	const manager = createIdeManager({ env: fake.env });

	const result = await manager.open(fake.cwd);
	assert.equal(result.ok, true, result.reason);

	const calls = invocations(fake.log);
	const opened = calls.find(args => !args.includes("--install-extension"));
	assert.deepEqual(opened, [fake.cwd]);
	const flat = calls.flat();
	assert.equal(flat.includes("serve-web"), false);
	assert.equal(flat.includes("--host"), false);
	assert.equal(flat.includes("omp"), false);
});

test("the extension is installed once, then later clicks only open the folder", async () => {
	const fake = fakeCode("code");
	const manager = createIdeManager({ env: fake.env });

	await manager.open(fake.cwd);
	await manager.open(fake.cwd);
	const calls = invocations(fake.log);
	const installs = calls.filter(args => args.includes("--install-extension"));
	assert.equal(installs.length, 1);
	assert.equal(installs[0]?.[installs[0].indexOf("--install-extension") + 1], fake.vsix);
	assert.equal(calls.filter(args => args[0] === fake.cwd).length, 2);
});

test("a failed extension install still opens the folder", async () => {
	const fake = fakeCode("code", { failInstall: true });
	const manager = createIdeManager({ env: fake.env });

	const result = await manager.open(fake.cwd);
	assert.equal(result.ok, true, result.reason);
	assert.ok(invocations(fake.log).some(args => args[0] === fake.cwd));
});

test("Cursor's code is opened when desktop VS Code is not installed", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pcb-cursor-"));
	roots.push(dir);
	const cursorBin = join(dir, "cursor", "resources", "app", "bin");
	mkdirSync(cursorBin, { recursive: true });
	const log = join(dir, "spawns.jsonl");
	const script = join(dir, "fake-code.mjs");
	writeFileSync(
		script,
		`import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
	);
	const shim = join(cursorBin, process.platform === "win32" ? "code.cmd" : "code");
	writeFileSync(
		shim,
		process.platform === "win32"
			? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
			: `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`,
	);
	const cwd = join(dir, "workspace");
	mkdirSync(cwd);
	const manager = createIdeManager({
		env: {
			...process.env,
			PCB_VSCODE: "",
			LOCALAPPDATA: join(dir, "empty-local"),
			ProgramFiles: join(dir, "empty-pf"),
			"ProgramFiles(x86)": join(dir, "empty-pf86"),
			PATH: cursorBin,
			Path: cursorBin,
			PATHEXT: ".CMD;.EXE",
		},
	});

	const result = await manager.open(cwd);
	assert.equal(result.ok, true, result.reason);
	assert.ok(invocations(log).some(args => args[0] === cwd));
	assert.equal(invocations(log).flat().includes("serve-web"), false);
});

test("an installed VS Code is used even when Cursor's code is earlier on PATH", () => {
	const dir = mkdtempSync(join(tmpdir(), "pcb-both-"));
	roots.push(dir);
	const local = join(dir, "local");
	const vscodeBin = join(local, "Programs", "Microsoft VS Code", "bin");
	mkdirSync(vscodeBin, { recursive: true });
	const vscode = join(vscodeBin, process.platform === "win32" ? "code.cmd" : "code");
	writeFileSync(vscode, "vscode");
	const cursorBin = join(dir, "cursor", "resources", "app", "bin");
	mkdirSync(cursorBin, { recursive: true });
	const cursor = join(cursorBin, process.platform === "win32" ? "code.cmd" : "code");
	writeFileSync(cursor, "cursor");

	const chosen = findCode({
		...process.env,
		PCB_VSCODE: "",
		LOCALAPPDATA: local,
		ProgramFiles: join(dir, "empty-pf"),
		"ProgramFiles(x86)": join(dir, "empty-pf86"),
		PATH: cursorBin,
		Path: cursorBin,
	});
	assert.equal(chosen, vscode);
});

test("an explicit PCB_VSCODE that is missing is not replaced by whatever else is on PATH", async () => {
	const fake = fakeCode("code");
	const manager = createIdeManager({
		env: { ...fake.env, PCB_VSCODE: join(fake.cwd, "missing-code.cmd") },
	});

	const result = await manager.open(fake.cwd);
	assert.equal(result.ok, false);
	assert.equal(result.reason, NO_CODE);
	assert.equal(invocations(fake.log).length, 0);
});

test("a folder that is not there is refused before code is started", async () => {
	const fake = fakeCode("code");
	const manager = createIdeManager({ env: fake.env });

	const result = await manager.open(join(fake.cwd, "nope"));
	assert.equal(result.ok, false);
	assert.equal(result.reason, "这个目录不存在");
	assert.equal(invocations(fake.log).length, 0);
});
