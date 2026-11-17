/**
 * The sidebar label for a new conversation: what the user typed, cut to one
 * line. No naming dialog and no "clean_data 2" — the first sentence already
 * says what the conversation is about, and omp may rename it later anyway.
 */
export function sessionTitle(text: string, limit = 28): string {
	const firstLine = text.split(/\r?\n/).find(line => line.trim().length > 0) ?? "";
	const compact = firstLine.replace(/\s+/g, " ").trim();
	if (!compact) return "";
	const letters = [...compact];
	return letters.length <= limit ? compact : `${letters.slice(0, limit).join("")}…`;
}
