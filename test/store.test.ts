import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Store, type SessionRecord } from "../server/store.ts";

const roots: string[] = [];

after(async () => {
	// Store.save() is debounced: a pending write would recreate the folder.
	await sleep(400);
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A state file with the seed a real machine had: one folder under two spellings. */
function seeded(): string {
	const root = mkdtempSync(join(tmpdir(), "pcb-store-"));
	roots.push(root);
	const path = join(root, "state.json");
	const record = (id: string, cwd: string): SessionRecord => ({
		id,
		cwd,
		name: id,
		phase: "build",
		extensions: false,
		createdAt: 1,
		updatedAt: 1,
	});
	writeFileSync(
		path,
		JSON.stringify({
			projects: ["D:\\Developer\\clean_data", "D:\\developer\\clean_data"],
			sessions: [record("a", "D:\\Developer\\clean_data"), record("b", "D:\\developer\\clean_data")],
			automations: [],
		}),
		"utf8",
	);
	return path;
}

test("case variants of one folder collapse to the first spelling", () => {
	const store = new Store(seeded());
	assert.deepEqual(store.projects, ["D:\\Developer\\clean_data"]);
	assert.equal(store.sessions.length, 2);
});

test("a removed folder stays removed through session traffic and a restart", () => {
	const path = seeded();
	const store = new Store(path);
	store.removeProject("d:\\developer\\CLEAN_DATA");
	assert.deepEqual(store.projects, []);
	assert.equal(store.isDismissed("D:\\Developer\\clean_data"), true);

	store.upsertSession({
		id: "c",
		cwd: "D:\\developer\\clean_data",
		name: "c",
		phase: "build",
		extensions: false,
		createdAt: 2,
		updatedAt: 2,
	});
	assert.deepEqual(store.projects, []);
	assert.equal(store.sessions.length, 3);

	store.flush();
	const reopened = new Store(path);
	assert.deepEqual(reopened.projects, []);
	assert.equal(reopened.isDismissed("d:\\DEVELOPER\\clean_data"), true);
});

test("adding the folder back clears the dismissal for every spelling", () => {
	const path = seeded();
	const store = new Store(path);
	store.removeProject("D:\\Developer\\clean_data");
	store.addProject("d:\\developer\\CLEAN_DATA");
	assert.deepEqual(store.projects, ["d:\\developer\\CLEAN_DATA"]);
	assert.equal(store.isDismissed("D:\\Developer\\clean_data"), false);
});

test("a folder that was never listed can still be removed for good", () => {
	const store = new Store(seeded());
	store.removeProject("D:\\Developer\\other");
	assert.deepEqual(store.projects, ["D:\\Developer\\clean_data"]);
	assert.equal(store.isDismissed("D:\\Developer\\other"), true);
	store.ensureProject("d:\\developer\\OTHER");
	assert.deepEqual(store.projects, ["D:\\Developer\\clean_data"]);
});
