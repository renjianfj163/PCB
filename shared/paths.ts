/**
 * Path identity, shared by the server (which stores folders) and the browser
 * (which matches a session's cwd against them). Windows paths are the same
 * folder in any case; POSIX paths are not. This is for comparing, never for
 * opening: the original spelling is what gets stored and spawned.
 */

/** Identity of a folder for matching, never for opening. */
export function pathKey(cwd: string): string {
	const forward = cwd.trim().replace(/\\/g, "/");
	// A UNC root's double slash is part of the path, not a separator to collapse.
	const unc = forward.startsWith("//");
	const slashed = unc ? `//${forward.slice(2).replace(/\/+/g, "/")}` : forward.replace(/\/+/g, "/");
	const windows = unc || /^[a-z]:\//i.test(slashed);
	if (/^[a-z]:\/$/i.test(slashed) || slashed === "/") return windows ? slashed.toLowerCase() : slashed;
	const clean = slashed.replace(/\/+$/, "");
	return windows ? clean.toLowerCase() : clean;
}
