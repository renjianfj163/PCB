/**
 * Which model providers are logged in, read without opening a conversation.
 *
 * `boot.auth` is filled by a running session (`get_login_providers`), so a shell
 * that has not started one cannot tell "nobody is logged in" from "nobody asked
 * yet" — and it used to say the first. This runs omp once with `--no-session`
 * (nothing is written to ~/.omp/agent/sessions) and closes it again.
 */

import type { BootInfo } from "../shared/protocol.ts";
import { RpcClient } from "./rpc/client.ts";

/** omp's own discovery round trip is slow; a shell-level cap keeps the UI honest. */
const QUERY_TIMEOUT_MS = 25_000;

export async function queryProviders(
	bin: string,
	cwd: string,
	onLog?: (message: string) => void,
): Promise<BootInfo["auth"]> {
	const client = new RpcClient({
		bin,
		args: ["--mode", "rpc-ui", "--no-session", "--approval-mode", "always-ask"],
		cwd,
		onFrame: () => {},
		onExit: () => {},
		onLog: message => onLog?.(`auth: ${message}`),
	});

	const timer = setTimeout(() => client.kill(), QUERY_TIMEOUT_MS);
	try {
		await client.start();
		const data = await client.call<{
			providers?: Array<{ id?: string; name?: string; authenticated?: boolean }>;
		}>({ type: "get_login_providers" }, QUERY_TIMEOUT_MS);
		return (data.providers ?? []).map(provider => ({
			provider: String(provider.id ?? ""),
			name: String(provider.name ?? provider.id ?? ""),
			authenticated: provider.authenticated === true,
		}));
	} finally {
		clearTimeout(timer);
		await client.close(2000).catch(() => {});
	}
}
