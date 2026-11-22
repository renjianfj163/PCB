import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { consoleArgs } from "../server/install.ts";

const OMP = "C:\\Users\\me\\AppData\\Local\\Programs\\PCB\\omp.exe";

test("a console login keeps every quoted piece a separate argument", () => {
	const argv = consoleArgs(OMP, ["login"]);
	assert.deepEqual(argv, ["/d", "/c", "start", "", OMP, "login"]);
	// The failure this guards: one long string with \" inside, which cmd turns
	// into a program named `\` instead of the login window.
	for (const arg of argv) assert.equal(arg.includes('"'), false, arg);
});

test("extra arguments travel after the program", () => {
	assert.deepEqual(consoleArgs(OMP, ["login", "--help"]), ["/d", "/c", "start", "", OMP, "login", "--help"]);
});

test("a bare command name stays bare so cmd can resolve it on PATH", () => {
	assert.deepEqual(consoleArgs("omp", ["login"]), ["/d", "/c", "start", "", "omp", "login"]);
});
