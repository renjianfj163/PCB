import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n.ts";

export interface PaletteItem {
	key: string;
	group: "项目" | "会话" | "自动化";
	title: string;
	subtitle?: string;
}

/** Ctrl+K command palette: projects, conversations and automations in one list. */
export function Palette({
	open,
	items,
	onClose,
	onPick,
}: {
	open: boolean;
	items: PaletteItem[];
	onClose: () => void;
	onPick: (item: PaletteItem) => void;
}) {
	const [query, setQuery] = useState("");
	const [index, setIndex] = useState(0);
	const input = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (!open) {
			setQuery("");
			setIndex(0);
			return;
		}
		const timer = setTimeout(() => input.current?.focus(), 10);
		return () => clearTimeout(timer);
	}, [open]);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return items;
		return items.filter(item =>
			`${item.title} ${item.subtitle ?? ""} ${t(item.group)}`.toLowerCase().includes(needle),
		);
	}, [items, query]);

	useEffect(() => {
		setIndex(0);
	}, [query]);

	if (!open) return null;

	const pick = (item: PaletteItem | undefined) => {
		if (!item) return;
		onPick(item);
		onClose();
	};

	return (
		<div className="palette-overlay" onClick={onClose}>
			<div className="palette" onClick={event => event.stopPropagation()}>
				<input
					ref={input}
					value={query}
					placeholder={t("搜索项目、对话、自动化…")}
					onChange={event => setQuery(event.target.value)}
					onKeyDown={event => {
						if (event.key === "Escape") onClose();
						if (event.key === "ArrowDown") {
							event.preventDefault();
							setIndex(current => Math.min(current + 1, filtered.length - 1));
						}
						if (event.key === "ArrowUp") {
							event.preventDefault();
							setIndex(current => Math.max(current - 1, 0));
						}
						if (event.key === "Enter") {
							event.preventDefault();
							pick(filtered[index]);
						}
					}}
				/>
				<ul className="palette-list">
					{filtered.map((item, position) => (
						<li key={item.key}>
							<button
								type="button"
								className={position === index ? "active" : undefined}
								onMouseEnter={() => setIndex(position)}
								onClick={() => pick(item)}
							>
								<span className="palette-group">{item.group}</span>
								<span className="palette-title">{item.title}</span>
								{item.subtitle ? <span className="palette-sub">{item.subtitle}</span> : null}
							</button>
						</li>
					))}
					{filtered.length === 0 ? <li className="palette-empty">{t("没有匹配项")}</li> : null}
				</ul>
			</div>
		</div>
	);
}
