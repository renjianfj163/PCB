import { useCallback, useEffect, useMemo, useState } from "react";
import type { DirEntry, DirListing, FilePreview } from "../../../shared/protocol.ts";
import { relativeTo } from "../adapters.ts";
import { api } from "../api.ts";

function size(bytes: number | undefined): string {
	if (bytes === undefined) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function caret(open: boolean): string {
	return open ? "▾" : "▸";
}

/**
 * Read-only project browser: lazily lists one folder at a time and previews a
 * single file through the server. Nothing here executes or writes anything.
 */
export function FilePage({ cwd, changed }: { cwd: string; changed: string[] }) {
	const [listings, setListings] = useState<Record<string, DirListing>>({});
	const [open, setOpen] = useState<Record<string, true>>({ "": true });
	const [selected, setSelected] = useState<string | null>(null);
	const [preview, setPreview] = useState<FilePreview | null>(null);
	const [error, setError] = useState<string | null>(null);

	const changedRel = useMemo(() => {
		const set = new Set<string>();
		for (const absolute of changed) {
			const rel = relativeTo(cwd, absolute);
			if (rel) set.add(rel);
		}
		return set;
	}, [cwd, changed]);

	const load = useCallback(
		async (path: string) => {
			try {
				const data = await api.listing(cwd, path);
				setListings(previous => ({ ...previous, [path]: data }));
				setError(null);
			} catch (cause) {
				setError((cause as Error).message);
			}
		},
		[cwd],
	);

	useEffect(() => {
		setListings({});
		setOpen({ "": true });
		setSelected(null);
		setPreview(null);
		void load("");
	}, [cwd, load]);

	/** Re-read the root and every folder the user has open. */
	const refresh = useCallback(async () => {
		const targets = ['', ...Object.keys(open).filter(path => path !== '')];
		const results = await Promise.all(
			targets.map(async path => [path, await api.listing(cwd, path).catch(() => null)] as const),
		);
		setListings(previous => {
			const next = { ...previous };
			for (const [path, data] of results) if (data) next[path] = data;
			return next;
		});
	}, [cwd, open]);

	// A write/edit in the conversation should show up in the tree right away.
	useEffect(() => {
		void refresh();
	}, [refresh, changed.length]);

	const toggle = (path: string) => {
		setOpen(previous => {
			if (previous[path]) {
				const next = { ...previous };
				delete next[path];
				return next;
			}
			return { ...previous, [path]: true };
		});
		if (!listings[path]) void load(path);
	};

	const pick = async (path: string) => {
		setSelected(path);
		setPreview(null);
		try {
			setPreview(await api.file(cwd, path));
			setError(null);
		} catch (cause) {
			setError((cause as Error).message);
		}
	};

	const rows = (path: string, depth: number) => {
		const listing = listings[path];
		if (!listing) return null;
		return listing.entries.map((entry: DirEntry) => {
			const expanded = entry.kind === "dir" && open[entry.path] === true;
			return (
				<div key={entry.path}>
					<button
						type="button"
						className={`tree-row${entry.kind === "dir" ? " dir" : ""}${entry.path === selected ? " selected" : ""}`}
						style={{ paddingLeft: 8 + depth * 12 }}
						title={entry.path}
						onClick={() => (entry.kind === "dir" ? toggle(entry.path) : void pick(entry.path))}
					>
						<span className="tree-caret" aria-hidden>
							{entry.kind === "dir" ? caret(expanded) : ""}
						</span>
						<span className="tree-name">{entry.name}</span>
						{entry.kind === "file" && changedRel.has(entry.path) ? (
							<span className="tree-changed" title="这次改过">
								●
							</span>
						) : null}
						{entry.kind === "file" ? <span className="tree-size">{size(entry.size)}</span> : null}
					</button>
					{expanded ? rows(entry.path, depth + 1) : null}
				</div>
			);
		});
	};

	const root = listings[""];

	return (
		<div className="rail-body file-page">
			{error ? <p className="file-error">{error}</p> : null}

			<div className="rail-section-head">
				<h2>项目文件</h2>
				<button type="button" className="icon-btn" title="刷新目录" onClick={() => void refresh()}>
					<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
						<path
							d="M12.6 7.2A4.9 4.9 0 1 1 11 4.2"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.4"
							strokeLinecap="round"
						/>
						<path
							d="M12.9 2.4v2.6h-2.6"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.4"
							strokeLinecap="round"
						/>
					</svg>
				</button>
			</div>

			<div className="file-tree">
				{root ? null : <p className="plan-empty">正在读取目录…</p>}
				{rows("", 0)}
				{root?.truncated ? <p className="plan-empty">这个文件夹太大，只列出了前 400 项。</p> : null}
				{root && root.entries.length === 0 ? <p className="plan-empty">这个文件夹是空的。</p> : null}
			</div>

			{selected ? (
				<section className="file-preview">
					<div className="rail-section-head">
						<h2 title={selected}>{selected.split("/").at(-1)}</h2>
						<button type="button" className="icon-btn" title="关闭预览" onClick={() => setSelected(null)}>
							×
						</button>
					</div>
					{preview === null ? (
						<p className="plan-empty">正在读取…</p>
					) : preview.kind === "text" ? (
						<pre className="file-text">{preview.text}</pre>
					) : preview.kind === "binary" ? (
						<p className="plan-empty">
							二进制文件，{size(preview.size)}，不预览。
						</p>
					) : (
						<p className="plan-empty">
							文件太大（{size(preview.size)}），超过 256 KB，不预览。
						</p>
					)}
				</section>
			) : null}

			{changedRel.size > 0 ? (
				<section className="file-changed">
					<div className="rail-section-head">
						<h2>这次改过的文件</h2>
						<span className="plan-count">{changedRel.size}</span>
					</div>
					<ul className="file-list">
						{[...changedRel].map(path => (
							<li key={path}>
								<button type="button" title={path} onClick={() => void pick(path)}>
									{path}
								</button>
							</li>
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}
