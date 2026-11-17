import { useCallback, useEffect, useMemo, useState } from "react";
import type { DirEntry, DirListing, FilePreview } from "../../../shared/protocol.ts";
import { relativeTo } from "../adapters.ts";
import { api } from "../api.ts";
import { t } from "../i18n.ts";
import { baseName, joinPath } from "../paths.ts";

function size(bytes: number | undefined): string {
	if (bytes === undefined) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function caret(open: boolean): string {
	return open ? "▾" : "▸";
}

/** Colour cue only: folders carry the caret, files carry a dot by family. */
type Family = "code" | "doc" | "data" | "image" | "other";

const CODE = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java", "c", "h", "cpp", "cs", "rb", "php", "sh", "ps1"]);
const DOC = new Set(["md", "txt", "rst", "pdf", "docx", "doc", "adoc"]);
const DATA = new Set(["json", "jsonl", "yaml", "yml", "toml", "ini", "csv", "xml", "lock"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "ico"]);

function familyOf(name: string): Family {
	const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() ?? "" : "";
	if (CODE.has(extension)) return "code";
	if (DOC.has(extension)) return "doc";
	if (DATA.has(extension)) return "data";
	if (IMAGE.has(extension)) return "image";
	return "other";
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
	const [copied, setCopied] = useState(false);
	const [changedOpen, setChangedOpen] = useState(true);

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
		const targets = ["", ...Object.keys(open).filter(path => path !== "")];
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

	const copyPath = async () => {
		if (!selected) return;
		try {
			await navigator.clipboard.writeText(joinPath(cwd, selected));
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// clipboard blocked: the title attribute still carries the path
		}
	};

	/** Open every folder above a path so the tree shows where the file lives. */
	const reveal = async (path: string) => {
		const parts = path.split("/");
		const dirs: string[] = [];
		for (let index = 1; index < parts.length; index += 1) dirs.push(parts.slice(0, index).join("/"));
		const nextOpen: Record<string, true> = { "": true, ...open };
		let missing = false;
		for (const dir of dirs) {
			nextOpen[dir] = true;
			if (listings[dir]) continue;
			const data = await api.listing(cwd, dir).catch(() => null);
			if (!data) {
				missing = true;
				break;
			}
			setListings(previous => ({ ...previous, [dir]: data }));
		}
		if (missing) return;
		setOpen(nextOpen);
	};

	// Keep the selected file in sight, whether it was picked in the tree or the
	// changed list (which may have just opened its folders).
	useEffect(() => {
		if (!selected) return;
		const row = document.querySelector(`[data-path="${CSS.escape(selected)}"]`);
		row?.scrollIntoView({ block: "nearest" });
	}, [selected, listings, open]);

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
						data-path={entry.path}
						onClick={() => (entry.kind === "dir" ? toggle(entry.path) : void pick(entry.path))}
					>
						<span className="tree-caret" aria-hidden>
							{entry.kind === "dir" ? caret(expanded) : <i className={`tree-dot k-${familyOf(entry.name)}`} />}
						</span>
						<span className="tree-name">{entry.name}</span>
						{entry.kind === "file" && changedRel.has(entry.path) ? (
							<span className="tree-changed" title={t("这次改过")}>
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
	const selectedName = selected ? (selected.split("/").at(-1) ?? selected) : "";

	return (
		<div className="rail-body file-page">
			<div className="rail-subhead">
				<span className="sub-name" title={cwd}>
					{baseName(cwd)}
				</span>
				<div className="sub-tools">
					{changedRel.size > 0 ? <span className="sub-chip">{t("{n} 处改动", { n: changedRel.size })}</span> : null}
					<button type="button" className="icon-btn" title={t("刷新目录")} onClick={() => void refresh()}>
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
			</div>

			<div className="file-tree">
				{error ? <p className="file-error">{error}</p> : null}
				{root ? null : <p className="rail-empty">{t("正在读取目录…")}</p>}
				{rows("", 0)}
				{root?.truncated ? <p className="rail-empty">{t("这个文件夹太大，只列出了前 400 项。")}</p> : null}
				{root && root.entries.length === 0 ? <p className="rail-empty">{t("这个文件夹是空的。")}</p> : null}

				{changedRel.size > 0 ? (
					<details
						className="file-changed"
						open={changedOpen}
						onToggle={event => setChangedOpen(event.currentTarget.open)}
					>
						<summary>
							<span className="sub-meta">{t("这次改过")}</span>
							<span className="plan-count">{changedRel.size}</span>
						</summary>
						<ul className="file-list">
							{[...changedRel].map(path => (
								<li key={path}>
									<button
										type="button"
										title={path}
										onClick={() => {
											void reveal(path);
											void pick(path);
										}}
									>
										{path}
									</button>
								</li>
							))}
						</ul>
					</details>
				) : null}
			</div>

			{selected ? (
				<section className="file-preview">
					<div className="rail-subhead file-preview-head">
						<div className="file-preview-title">
							<span className="file-preview-name">{selectedName}</span>
							{selected.includes("/") ? (
								<span className="file-preview-path" title={selected}>
									{selected}
								</span>
							) : null}
						</div>
						<div className="file-preview-tools">
							{copied ? (
								<span className="rail-caption copied">{t("已复制")}</span>
							) : preview ? (
								<span className="rail-caption">{size(preview.size)}</span>
							) : null}
							<button type="button" className="icon-btn" title={t("复制完整路径")} onClick={() => void copyPath()}>
								<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
									<rect x="5.5" y="5.5" width="8" height="8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
									<path d="M10.5 5.5v-1a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4.5V10A1.5 1.5 0 0 0 4 11.5h1" fill="none" stroke="currentColor" strokeWidth="1.3" />
								</svg>
							</button>
							<button type="button" className="icon-btn" title={t("关闭预览")} onClick={() => setSelected(null)}>
								×
							</button>
						</div>
					</div>
					{preview === null ? (
						<p className="rail-empty">{t("正在读取…")}</p>
					) : preview.kind === "text" ? (
						<pre className="file-text">{preview.text}</pre>
					) : preview.kind === "binary" ? (
						<p className="rail-empty">{t("二进制文件，{s}，不预览。", { s: size(preview.size) })}</p>
					) : (
						<p className="rail-empty">{t("文件太大（{s}），超过 256 KB，不预览。", { s: size(preview.size) })}</p>
					)}
				</section>
			) : null}
		</div>
	);
}
