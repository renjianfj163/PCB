/**
 * Versions as the updater compares them: `1.2.3`, `v1.2.3`, `1.2.3-main.abc1234`.
 *
 * A trailing `-…` is a prerelease and sorts before the same core version, which
 * is what keeps a `main` build from looking newer than the release it follows.
 * Anything unparsable is simply not comparable: the caller decides what to say.
 */

export interface Version {
	major: number;
	minor: number;
	patch: number;
	pre: string | null;
}

const SHAPE = /^(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/;

export function parseVersion(text: string): Version | null {
	if (typeof text !== "string") return null;
	const trimmed = text.trim().replace(/^[vV]/, "");
	const match = SHAPE.exec(trimmed);
	if (!match) return null;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		pre: match[4] ?? null,
	};
}

/** Negative when `a` is older, 0 when equal, positive when `a` is newer. */
export function compareVersions(a: string, b: string): number {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) return 0;
	const core = left.major - right.major || left.minor - right.minor || left.patch - right.patch;
	if (core !== 0) return core;
	if (left.pre === right.pre) return 0;
	if (left.pre === null) return 1;
	if (right.pre === null) return -1;
	return left.pre < right.pre ? -1 : 1;
}

/**
 * Only a parsed pair counts: an unknown current version never invites an update,
 * and neither does an unknown release.
 */
export function isNewer(candidate: string, current: string): boolean {
	if (!parseVersion(candidate) || !parseVersion(current)) return false;
	return compareVersions(candidate, current) > 0;
}
