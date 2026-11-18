/**
 * The argv omp is launched with.
 *
 * PCB owns the policy, so omp always starts in `always-ask` mode with discovery
 * off — the only extension that loads is the one named here, by absolute path
 * (`--no-extensions` shuts down discovery, not explicit `-e`).
 */

import { existsSync } from "node:fs";

/** The omp-ckpt host extension: checkpointing and the review server live there. */
export const DEFAULT_CKPT_HOST = "D:\\Developer\\zed_omp\\host\\omp-host.ts";

export interface LaunchRecord {
	cwd: string;
	extensions: boolean;
	sessionFile?: string;
	phase: string;
}

/** The host file to load, or null when it is not on this machine (a normal state, not an error). */
export function ckptHost(env: NodeJS.ProcessEnv = process.env): string | null {
	const configured = env.PCB_OMP_CKPT_HOST?.trim() || DEFAULT_CKPT_HOST;
	return existsSync(configured) ? configured : null;
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
