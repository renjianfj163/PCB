/**
 * The model and thinking level omp would use for a new conversation.
 * One `--no-session` run also reports who is logged in, so the shell does not
 * start omp twice for the same card.
 */

import type { BootInfo, ModelRef, ShellSettings } from "../shared/protocol.ts";
import { RpcClient } from "./rpc/client.ts";

const QUERY_TIMEOUT_MS = 25_000;

export type { ShellSettings };

export interface ShellChoice {
	model?: ModelRef;
	thinking?: string;
}

export interface ShellSnapshot {
	auth: BootInfo["auth"];
	settings: ShellSettings;
}

export function overlayChoice(settings: ShellSettings, choice: ShellChoice | undefined): ShellSettings {
	return {
		models: settings.models,
		levels: settings.levels,
		current: choice?.model ?? settings.current,
		thinking: choice?.thinking ?? settings.thinking,
	};
}

export async function queryShell(
	bin: string,
	cwd: string,
	onLog?: (message: string) => void,
): Promise<ShellSnapshot> {
	const client = new RpcClient({
		bin,
		args: ["--mode", "rpc-ui", "--no-session", "--approval-mode", "always-ask"],
		cwd,
		onFrame: () => {},
		onExit: () => {},
		onLog: message => onLog?.(`shell: ${message}`),
	});

	const timer = setTimeout(() => client.kill(), QUERY_TIMEOUT_MS);
	try {
		await client.start();
		const [providers, models, state, thinking] = await Promise.all([
			client
				.call<{ providers?: Array<{ id?: string; name?: string; authenticated?: boolean }> }>(
					{ type: "get_login_providers" },
					QUERY_TIMEOUT_MS,
				)
				.catch(() => null),
			client.call<{ models?: Array<{ provider?: string; id?: string; name?: string }> }>(
				{ type: "get_available_models" },
				QUERY_TIMEOUT_MS,
			).catch(() => null),
			client.call<{ model?: { provider?: string; id?: string } | null; thinkingLevel?: string }>(
				{ type: "get_state" },
				QUERY_TIMEOUT_MS,
			).catch(() => null),
			client.call<{ levels?: unknown }>({ type: "get_available_thinking_levels" }, QUERY_TIMEOUT_MS).catch(() => null),
		]);

		const auth = (providers?.providers ?? []).map(provider => ({
			provider: String(provider.id ?? ""),
			name: String(provider.name ?? provider.id ?? ""),
			authenticated: provider.authenticated === true,
		}));
		const list = (models?.models ?? [])
			.filter(model => model.provider && model.id)
			.map(model => ({
				provider: String(model.provider),
				id: String(model.id),
				...(model.name ? { name: String(model.name) } : {}),
			}));
		const raw = state?.model;
		const current =
			raw && typeof raw.provider === "string" && typeof raw.id === "string"
				? { provider: raw.provider, id: raw.id }
				: null;
		const levels = Array.isArray(thinking?.levels)
			? thinking.levels.filter((level): level is string => typeof level === "string")
			: [];
		return {
			auth,
			settings: {
				models: list,
				current,
				levels,
				thinking: typeof state?.thinkingLevel === "string" ? state.thinkingLevel : null,
			},
		};
	} finally {
		clearTimeout(timer);
		await client.close(2000).catch(() => {});
	}
}
