/**
 * The argv omp is launched with.
 *
 * PCB owns the policy, so omp always starts in `always-ask` mode with discovery
 * off — the only extension that loads is the one named here, by absolute path
 * (`--no-extensions` shuts down discovery, not explicit `-e`).
 */

import { existsSync } from "node:fs";

export interface LaunchRecord {
	cwd: string;
	extensions: boolean;
	sessionFile?: string;
	phase: string;
}

/**
 * The omp-ckpt host to load, or null when this machine has none.
 * Only `PCB_OMP_CKPT_HOST` names it. A missing file is normal: the session
 * still starts, just without the review server.
 */
export function ckptHost(env: NodeJS.ProcessEnv = process.env): string | null {
	const configured = env.PCB_OMP_CKPT_HOST?.trim();
	if (!configured || !existsSync(configured)) return null;
	return configured;
}

/** Everything omp needs to behave like a PCB session, in one testable list. */
export function launchArgs(record: LaunchRecord, host: string | null, prompt: string): string[] {
	const args = [
		"--mode",
		"rpc-ui",
		"--cwd",
		record.cwd,
		// Every write/exec call comes back to PCB as a dialog, so the shell can
		// apply its own plan/build policy instead of trusting a static mode.
		"--approval-mode",
		"always-ask",
		"--append-system-prompt",
		prompt,
	];
	if (!record.extensions) args.push("--no-extensions");
	// The user's other extensions stay out; this one host is how Changes and its
	// review server exist at all, so it is named explicitly.
	if (host) args.push("-e", host);
	if (record.sessionFile) args.push("--resume", record.sessionFile);
	return args;
}
