/**
 * Allow/deny decisions survive a service restart.
 *
 * omp's event stream carries them only live, and the terminal page matches each
 * decision to the next command of the same tool — so the file keeps the original
 * order. One append-only JSONL per PCB session id under `~/.pcb/policies/`.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PolicyDecision } from "../shared/protocol.ts";

export interface StoredPolicy {
	tool: string;
	decision: PolicyDecision;
}

const DIR = join(homedir(), ".pcb", "policies");
const LIMIT = 2000;

function fileFor(sessionId: string): string {
	return join(DIR, `${sessionId}.jsonl`);
}

export function loadPolicies(sessionId: string): StoredPolicy[] {
	let text: string;
	try {
		text = readFileSync(fileFor(sessionId), "utf8");
	} catch {
		return [];
	}
	const policies: StoredPolicy[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			const parsed = JSON.parse(line) as Partial<StoredPolicy>;
			if (typeof parsed.tool === "string" && typeof parsed.decision === "string") {
				policies.push({ tool: parsed.tool, decision: parsed.decision as PolicyDecision });
			}
		} catch {
			// a torn last line after a crash: skip it
		}
	}
	return policies.slice(-LIMIT);
}

export function appendPolicy(sessionId: string, policy: StoredPolicy): void {
	try {
		mkdirSync(dirname(fileFor(sessionId)), { recursive: true });
		appendFileSync(fileFor(sessionId), `${JSON.stringify(policy)}\n`, "utf8");
	} catch {
		// persistence is best-effort; the live event still goes out
	}
}
