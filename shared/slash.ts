/**
 * Slash commands as typed in the composer.
 *
 * OMP only treats an incoming prompt as a command when the text starts with `/`.
 * PCB prefixes a phase line to ordinary messages, so the session asks this first
 * and sends a command bare instead (`/compact` keeps its own path: it has a
 * native RPC call and modes the text form alone can express).
 */

/** `/name`, `/name arg`, `/name:arg`. */
const SHAPE = /^\/([A-Za-z][\w-]*)(?=[\s:]|$)/;

/**
 * The command name a message starts with, or `undefined` for ordinary text.
 *
 * `known` is omp's own catalog (`get_available_commands`). With it, only names omp
 * admits count, so `/home 看看` stays a path. Without it (an omp that does not
 * answer that call) any command-shaped leading slash counts, because a real path
 * like `/home/me/x` never matches the shape above.
 */
export function leadingCommand(text: string, known: ReadonlySet<string>): string | undefined {
	const match = SHAPE.exec(text.trim());
	const name = match?.[1];
	if (!name) return undefined;
	return known.size === 0 || known.has(name) ? name : undefined;
}
