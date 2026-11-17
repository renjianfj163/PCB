/** Path helpers shared by the sidebar and the rail; display only, never filesystem access. */

/** Last segment of a path: `D:\work\proj` -> `proj`. */
export function baseName(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	return parts.at(-1) ?? path;
}

/** Trailing segments with a leading ellipsis: `D:\a\b\c` -> `…/b/c`. */
export function shortPath(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

/** Join a root and a slash-separated relative path with the root's own separator. */
export function joinPath(root: string, relative: string): string {
	const separator = root.includes("\\") ? "\\" : "/";
	const clean = root.replace(/[\\/]+$/, "");
	return `${clean}${separator}${relative.split("/").join(separator)}`;
}
