/**
 * Read-only project browsing for the right rail.
 *
 * Everything here is confined to the project root: `..` and symlinks that point
 * outside are refused, only directories are listed, and files are previewed up
 * to a hard byte cap. Nothing in this module writes, deletes or executes.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DirEntry, DirListing, FilePreview } from "../shared/protocol.ts";

export const PREVIEW_LIMIT = 256 * 1024;
const ENTRY_LIMIT = 400;

/** Directories that are never worth walking from a UI. */
const SKIP_DIRS: Record<string, true> = {
	".git": true,
	".hg": true,
	".svn": true,
	node_modules: true,
	".venv": true,
	venv: true,
	env: true,
	__pycache__: true,
	dist: true,
	build: true,
	out: true,
	".next": true,
	".nuxt": true,
	".cache": true,
	".turbo": true,
	target: true,
	coverage: true,
};

export class PathRefused extends Error {}

function lower(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}

/** True when `target` is the root itself or something below it. */
function inside(root: string, target: string): boolean {
	const rel = relative(lower(root), lower(target));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function realRoot(root: string): string {
	const real = realpathSync(root);
	return real.endsWith(sep) ? real : real;
}

/**
 * Resolve a client-supplied relative path to an absolute one, refusing anything
 * that leaves the project (including through a symlink).
 */
export function resolveInside(root: string, path: string): string {
	const base = realRoot(root);
	const candidate = resolve(base, path || ".");
	// Reject `..` outright even before touching the filesystem.
	const rel = relative(base, candidate);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new PathRefused("只能访问项目目录里的文件");
	let real: string;
	try {
		real = realpathSync(candidate);
	} catch {
		// Missing path: judge it by its parent so a symlinked folder still counts.
		const parent = resolve(candidate, "..");
		let realParent: string;
		try {
			realParent = realpathSync(parent);
		} catch {
			throw new PathRefused("路径不存在");
		}
		real = join(realParent, candidate.slice(parent.length).replace(/^[\\/]/, ""));
	}
	if (!inside(base, real)) throw new PathRefused("这个链接指向项目外，已拒绝");
	return real;
}

function toRelative(root: string, absolute: string): string {
	return relative(realRoot(root), absolute).split(sep).join("/");
}

/** Hidden entries stay out of the tree: dotfolders are noise in a UI. */
function visible(name: string): boolean {
	return !name.startsWith(".");
}

export function listDirectory(root: string, path: string): DirListing {
	const dir = resolveInside(root, path);
	const stat = statSync(dir);
	if (!stat.isDirectory()) throw new PathRefused("不是文件夹");

	let names: string[];
	try {
		names = readdirSync(dir);
	} catch (error) {
		throw new PathRefused(`读不了这个文件夹：${(error as Error).message}`);
	}

	const entries: DirEntry[] = [];
	for (const name of names) {
		if (!visible(name)) continue;
		const absolute = join(dir, name);
		let info;
		try {
			info = statSync(absolute);
		} catch {
			continue;
		}
		const rel = toRelative(root, absolute);
		if (info.isDirectory()) {
			if (SKIP_DIRS[name.toLowerCase()]) continue;
			entries.push({ name, path: rel, kind: "dir" });
		} else if (info.isFile()) {
			entries.push({ name, path: rel, kind: "file", size: info.size });
		}
	}

	entries.sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
		return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
	});

	const truncated = entries.length > ENTRY_LIMIT;
	return { path: toRelative(root, dir), entries: truncated ? entries.slice(0, ENTRY_LIMIT) : entries, truncated };
}

export function readPreview(root: string, path: string): FilePreview {
	const file = resolveInside(root, path);
	const stat = statSync(file);
	if (!stat.isFile()) throw new PathRefused("不是文件");
	const rel = toRelative(root, file);
	if (stat.size > PREVIEW_LIMIT) {
		return { path: rel, size: stat.size, kind: "too_large" };
	}

	const buffer = readFileSync(file);
	const head = buffer.subarray(0, Math.min(buffer.length, 8000));
	if (head.includes(0)) return { path: rel, size: stat.size, kind: "binary" };

	let text = buffer.toString("utf8");
	if (text.includes("\u0000")) return { path: rel, size: stat.size, kind: "binary" };
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	return { path: rel, size: stat.size, kind: "text", text };
}
