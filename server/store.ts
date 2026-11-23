/**
 * Tiny JSON store for PCB's own records (projects and sessions). omp owns the
 * transcripts; this only remembers which conversations the shell created.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Automation, ModelRef, Phase } from "../shared/protocol.ts";
import { pathKey } from "../shared/paths.ts";

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

/** What the gear card last chose, so a new conversation starts on the same model. */
export interface ShellChoice {
	model?: ModelRef;
	thinking?: string;
}

export interface StoredState {
	sessions: SessionRecord[];
	projects: string[];
	/** Folders the user removed from the list; their sessions stop resurfacing. */
	dismissed: string[];
	automations: Automation[];
	lastCwd?: string;
	choice?: ShellChoice;
}

export const STATE_PATH = process.env.PCB_STATE ?? join(homedir(), ".pcb", "state.json");

export class Store {
	#state: StoredState = { sessions: [], projects: [], dismissed: [], automations: [] };
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
			// One folder, one row: case variants of the same Windows path collapse to
			// the first spelling the list kept.
			const projects = uniqueByKey(Array.isArray(parsed.projects) ? parsed.projects : []);
			const visible = new Set(projects.map(pathKey));
			const dismissed = uniqueByKey(Array.isArray(parsed.dismissed) ? parsed.dismissed : []).filter(
				cwd => !visible.has(pathKey(cwd)),
			);
			this.#state = {
				sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
				projects,
				dismissed,
				automations: Array.isArray(parsed.automations) ? parsed.automations : [],
				lastCwd: typeof parsed.lastCwd === "string" ? parsed.lastCwd : undefined,
				choice: readChoice(parsed.choice),
			};
		} catch {
			this.#state = { sessions: [], projects: [], dismissed: [], automations: [] };
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

	get dismissed(): string[] {
		return this.#state.dismissed;
	}

	/** True while this folder is out of the list on purpose. */
	isDismissed(cwd: string): boolean {
		const key = pathKey(cwd);
		return this.#state.dismissed.some(item => pathKey(item) === key);
	}

	get automations(): Automation[] {
		return this.#state.automations;
	}

	get lastCwd(): string | undefined {
		return this.#state.lastCwd;
	}

	get choice(): ShellChoice | undefined {
		return this.#state.choice;
	}

	/** Merges into the gear-card choice. Omitted fields stay as they were. */
	setChoice(patch: ShellChoice) {
		this.#state.choice = { ...this.#state.choice, ...patch };
		this.save();
	}

	upsertSession(record: SessionRecord) {
		const index = this.#state.sessions.findIndex(s => s.id === record.id);
		if (index >= 0) this.#state.sessions[index] = record;
		else this.#state.sessions.unshift(record);
		this.ensureProject(record.cwd);
	}

	removeSession(id: string) {
		this.#state.sessions = this.#state.sessions.filter(s => s.id !== id);
		this.save();
	}

	/** The user picked this folder: it is visible again, in one spelling. */
	addProject(cwd: string) {
		const key = pathKey(cwd);
		this.#state.dismissed = this.#state.dismissed.filter(item => pathKey(item) !== key);
		const existing = this.#state.projects.find(item => pathKey(item) === key);
		this.#state.projects = this.#state.projects.filter(item => pathKey(item) !== key);
		const kept = existing ?? cwd;
		this.#state.projects.unshift(kept);
		this.#state.lastCwd = kept;
		this.save();
	}

	/**
	 * Keeps a folder in the list because a conversation lives there — unless the
	 * user removed it, in which case the record stays without a row.
	 */
	ensureProject(cwd: string) {
		if (this.isDismissed(cwd)) return;
		const key = pathKey(cwd);
		if (!this.#state.projects.some(item => pathKey(item) === key)) {
			this.#state.projects.unshift(cwd);
		}
		this.#state.lastCwd = cwd;
		this.save();
	}

	/** Drops the folder from the list for good; nothing on disk is touched. */
	removeProject(cwd: string) {
		const key = pathKey(cwd);
		this.#state.projects = this.#state.projects.filter(project => pathKey(project) !== key);
		if (!this.#state.dismissed.some(item => pathKey(item) === key)) this.#state.dismissed.push(cwd);
		if (this.#state.lastCwd !== undefined && pathKey(this.#state.lastCwd) === key) {
			this.#state.lastCwd = this.#state.projects[0];
		}
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

/** First spelling wins; strings only, so a hand-edited file cannot crash a load. */
function uniqueByKey(values: unknown[]): string[] {
	const seen = new Set<string>();
	const kept: string[] = [];
	for (const value of values) {
		if (typeof value !== "string" || !value.trim()) continue;
		const key = pathKey(value);
		if (seen.has(key)) continue;
		seen.add(key);
		kept.push(value);
	}
	return kept;
}

function readChoice(value: unknown): ShellChoice | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as { model?: unknown; thinking?: unknown };
	const model = raw.model as { provider?: unknown; id?: unknown } | undefined;
	const choice: ShellChoice = {};
	if (model && typeof model.provider === "string" && typeof model.id === "string" && model.provider && model.id) {
		choice.model = { provider: model.provider, id: model.id };
	}
	if (typeof raw.thinking === "string" && raw.thinking) choice.thinking = raw.thinking;
	return choice.model || choice.thinking ? choice : undefined;
}
