import type { AgentMessage } from "./protocol.ts";

/** How much of the provider's sentence is worth putting in a chat bubble. */
const DETAIL_MAX = 300;

/**
 * The provider's own words for a turn that died before answering, or null when
 * the turn is fine.
 *
 * omp records the failure on the assistant message (`stopReason: "error"` plus
 * `errorMessage`). Without surfacing it the reply is an empty bubble and the
 * app looks frozen: nothing streams, nothing is pending, nothing says why.
 */
export function turnErrorDetail(message: AgentMessage | undefined): string | null {
	if (!message || message.role !== "assistant" || message.stopReason !== "error") return null;
	const detail = typeof message.errorMessage === "string" ? message.errorMessage.trim() : "";
	return detail.length > DETAIL_MAX ? `${detail.slice(0, DETAIL_MAX)}…` : detail;
}
