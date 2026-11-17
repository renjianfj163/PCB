/**
 * Tiny JSON store for PCB's own records (projects and sessions). omp owns the
 * transcripts; this only remembers which conversations the shell created.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Automation, Phase } from "../shared/protocol.ts";

export interface SessionRecord {
	id: string;
	cwd: string;
	name: string;
	phase: Phase;
	extensions: boolean;
	createdAt: number;
	updatedAt: number;
	/** omp's own session file, once the run reported one. */
	sessionFile?: string;
	ompSessionId?: string;
}

export interface StoredState {
	sessions: SessionRecord[];
	projects: string[];
	automations: Automation[];
	lastCwd?: string;
}

export const STATE_PATH = join(homedir(), ".pcb", "state.json");

export class Store {
	#state: StoredState = { sessions: [], projects: [], automations: [] };
	#saveTimer: NodeJS.Timeout | undefined;
	readonly #path: string;

	constructor(path = STATE_PATH) {
		this.#path = path;
		this.#load();
	}

	#load() {
		try {
			const raw = readFileSync(this.#path, "utf8");
			const parsed = JSON.parse(raw) as Partial<StoredState>;
			this.#state = {
				sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
				projects: Array.isArray(parsed.projects) ? parsed.projects : [],
				automations: Array.isArray(parsed.automations) ? parsed.automations : [],
				lastCwd: typeof parsed.lastCwd === "string" ? parsed.lastCwd : undefined,
			};
		} catch {
			this.#state = { sessions: [], projects: [], automations: [] };
		}
	}

	get state(): StoredState {
		return this.#state;
	}

	get sessions(): SessionRecord[] {
		return this.#state.sessions;
	}

	get projects(): string[] {
		return this.#state.projects;
	}

	get automations(): Automation[] {
		return this.#state.automations;
	}

	get lastCwd(): string | undefined {
		return this.#state.lastCwd;
	}

	upsertSession(record: SessionRecord) {
		const index = this.#state.sessions.findIndex(s => s.id === record.id);
		if (index >= 0) this.#state.sessions[index] = record;
		else this.#state.sessions.unshift(record);
		if (!this.#state.projects.includes(record.cwd)) this.#state.projects.unshift(record.cwd);
		this.#state.lastCwd = record.cwd;
		this.save();
	}

	removeSession(id: string) {
		this.#state.sessions = this.#state.sessions.filter(s => s.id !== id);
		this.save();
	}

	addProject(cwd: string) {
		if (!this.#state.projects.includes(cwd)) this.#state.projects.unshift(cwd);
		this.#state.lastCwd = cwd;
		this.save();
	}

	/** Drops the folder from the list; nothing on disk is touched. */
	removeProject(cwd: string) {
		this.#state.projects = this.#state.projects.filter(project => project !== cwd);
		if (this.#state.lastCwd === cwd) this.#state.lastCwd = this.#state.projects[0];
		this.save();
	}

	upsertAutomation(automation: Automation) {
		const index = this.#state.automations.findIndex(item => item.id === automation.id);
		if (index >= 0) this.#state.automations[index] = automation;
		else this.#state.automations.unshift(automation);
		this.save();
	}

	removeAutomation(id: string) {
		this.#state.automations = this.#state.automations.filter(item => item.id !== id);
		this.save();
	}

	/** Debounced atomic write: state changes are frequent during a turn. */
	save() {
		clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => this.flush(), 250);
	}

	flush() {
		const dir = dirname(this.#path);
		mkdirSync(dir, { recursive: true });
		const tmp = `${this.#path}.tmp`;
		writeFileSync(tmp, JSON.stringify(this.#state, null, "\t"), "utf8");
		renameSync(tmp, this.#path);
	}
}
