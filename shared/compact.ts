/**
 * `/compact` as typed in the composer.
 *
 * OMP only treats a prompt as a slash command when the whole text starts with
 * `/`. PCB otherwise prefixes a phase line, so this parser runs first and the
 * session calls the `compact` RPC (or, for a mode OMP's RPC command cannot
 * express, forwards the bare slash line).
 */

const COMPACT_MODES = ["soft", "remote", "snapcompact", "handoff"] as const;

export type CompactMode = (typeof COMPACT_MODES)[number];

export type CompactInvocation =
	| { mode?: CompactMode; instructions?: string }
	| { error: string };

function isMode(token: string): token is CompactMode {
	return (COMPACT_MODES as readonly string[]).includes(token);
}

/**
 * `null` when the text is an ordinary message. An `error` is a compact
 * command OMP would reject (snapcompact plus focus text).
 */
export function parseCompactInvocation(text: string): CompactInvocation | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/")) return null;
	const body = trimmed.slice(1);
	if (!body) return null;
	const separator = body.search(/[\s:]/);
	const name = separator === -1 ? body : body.slice(0, separator);
	if (name !== "compact") return null;
	const args = separator === -1 ? "" : body.slice(separator + 1).trim();
	if (!args) return {};

	const space = args.search(/\s/);
	const first = space === -1 ? args : args.slice(0, space);
	const mode = isMode(first.toLowerCase()) ? (first.toLowerCase() as CompactMode) : undefined;
	if (!mode) return { instructions: args };

	const focus = space === -1 ? "" : args.slice(space + 1).trim();
	if (mode === "snapcompact" && focus) {
		return { error: "snapcompact 只归档历史，不接受额外说明" };
	}
	return focus ? { mode, instructions: focus } : { mode };
}

/** OMP's refusal, in the shell's wording. A short session is the common case. */
export function compactFailureText(message: string): string {
	if (/nothing to compact|too small|already compacted/i.test(message)) return "这段对话还太短，压缩不了";
	if (message.startsWith("压缩")) return message;
	return `压缩没有完成：${message}`;
}

/** Turn omp's `/compact` command_output into the shell's own wording. */
export function compactionOutputNotice(text: string): { level: "info" | "warning"; text: string } | null {
	const failed = text.match(/^Compaction failed:\s*([\s\S]+)$/);
	if (failed?.[1]) return { level: "warning", text: `压缩没有完成：${failed[1].trim()}` };
	const tokens = text.match(/^Compaction complete\. Tokens: (\d+) -> (\d+) \(saved -?\d+\)\.$/);
	if (tokens?.[1] && tokens[2]) return { level: "info", text: `已压缩上下文，从 ${tokens[1]} 收到 ${tokens[2]}` };
	if (text === "Compaction complete.") return { level: "info", text: "已压缩上下文" };
	return null;
}
