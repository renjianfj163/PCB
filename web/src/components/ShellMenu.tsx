import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ShellSettings } from "../../../shared/protocol.ts";
import { t } from "../i18n.ts";

/**
 * One control for the two choices that exist before a conversation does: omp's
 * model and its thinking level. Clicking opens a panel with both lists, so the
 * first screen keeps a single row; nothing here starts omp, it only saves the
 * choice the server echoes back.
 */
export function ShellMenu({
	settings,
	providers,
	disabled,
	onChange,
}: {
	settings: ShellSettings | null;
	disabled?: boolean;
	onChange: (patch: { model?: { provider: string; id: string }; thinking?: string }) => Promise<void>;
	/** Providers omp says are logged in; an empty list means "not known yet". */
	providers: string[];
}) {
	const [open, setOpen] = useState(false);
	const [side, setSide] = useState<"down" | "up">("down");
	const root = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLDivElement>(null);

	const models = settings?.models ?? [];
	const levels = settings?.levels ?? [];
	const current = settings?.current ?? null;
	const modelKey = current ? `${current.provider}/${current.id}` : "";
	const thinking = settings?.thinking ?? "";
	// omp lists every provider's catalog; a model you cannot sign in to is noise.
	const usable = providers.length > 0 ? models.filter(model => providers.includes(model.provider)) : models;
	const ready = !disabled && (usable.length > 0 || levels.length > 0);

	// Escape closes from anywhere; a pointer outside the control does the same.
	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setOpen(false);
			trigger.current?.focus();
		};
		const onPointer = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (root.current?.contains(target)) return;
			setOpen(false);
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener("pointerdown", onPointer);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("pointerdown", onPointer);
		};
	}, [open]);

	// Opening puts focus on the value in use, so Space/Enter changes what it shows.
	useEffect(() => {
		if (!open) return;
		const active = panel.current?.querySelector<HTMLButtonElement>('[data-shell-option][data-active="true"]');
		const first = panel.current?.querySelector<HTMLButtonElement>("[data-shell-option]");
		(active ?? first)?.focus();
	}, [open]);

	// The card sits mid-page: open upward when the panel would run off the bottom.
	useLayoutEffect(() => {
		if (!open) return;
		const anchor = trigger.current?.getBoundingClientRect();
		const height = panel.current?.offsetHeight ?? 0;
		if (!anchor) return;
		setSide(window.innerHeight - anchor.bottom < height + 12 ? "up" : "down");
	}, [open]);

	/** Arrow keys walk every option of both lists; the panel is one tab stop. */
	const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
		if (step === 0) return;
		const items = Array.from(
			event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-shell-option]"),
		).filter(item => !item.disabled);
		if (items.length === 0) return;
		event.preventDefault();
		const index = items.indexOf(document.activeElement as HTMLButtonElement);
		const next = index < 0 ? (step > 0 ? 0 : items.length - 1) : (index + step + items.length) % items.length;
		items[next]?.focus();
	};

	/**
	 * Saves one choice. A row can leave the list as a result (the saved model omp
	 * no longer offers), which would drop keyboard focus on the floor.
	 */
	const pick = (patch: { model?: { provider: string; id: string }; thinking?: string }) => {
		void onChange(patch).then(() => {
			setTimeout(() => {
				if (panel.current?.contains(document.activeElement)) return;
				panel.current?.querySelector<HTMLButtonElement>('[data-shell-option][data-active="true"]')?.focus();
			}, 0);
		});
	};

	const label = current?.id ?? "";
	// The label stays short; both values live in the tooltip and the panel.
	const summary = label ? `${label}${thinking ? ` · ${thinking}` : ""}` : (thinking || "");

	return (
		<div className="shell-menu-root" ref={root}>
			<button
				type="button"
				ref={trigger}
				className="shell-trigger"
				disabled={!ready}
				aria-haspopup="dialog"
				aria-expanded={open}
				title={summary || t("模型与思考等级")}
				onClick={() => setOpen(value => !value)}
				onKeyDown={event => {
					if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
					event.preventDefault();
					setOpen(true);
				}}
			>
				<span className="shell-trigger-model">{label || "—"}</span>
				<span className="shell-trigger-caret" aria-hidden>
					▾
				</span>
			</button>

			{open ? (
				<div
					className="shell-menu"
					ref={panel}
					data-side={side}
					role="dialog"
					aria-label={t("模型与思考等级")}
					onKeyDown={onPanelKeyDown}
				>
					<div className="shell-group" role="group" aria-label={t("模型")}>
						<div className="shell-menu-title">{t("模型")}</div>
						<div className="shell-models">
							{usable.length === 0 ? <p className="shell-empty">—</p> : null}
							{usable.map(model => {
								const key = `${model.provider}/${model.id}`;
								const active = key === modelKey;
								return (
									<button
										key={key}
										type="button"
										className={`shell-option${active ? " active" : ""}`}
										data-shell-option
										data-active={active}
										aria-pressed={active}
										title={`${key}${model.name && model.name !== model.id ? ` · ${model.name}` : ""}`}
										onClick={() => pick({ model: { provider: model.provider, id: model.id } })}
									>
										<span className="shell-option-check" aria-hidden>
											{active ? "✓" : ""}
										</span>
										<span className="shell-option-name">{model.id}</span>
										<span className="shell-option-note">{model.provider}</span>
									</button>
								);
							})}
							{/* A saved model omp no longer lists still shows as the value in use. */}
							{current && !usable.some(model => `${model.provider}/${model.id}` === modelKey) ? (
								<button
									type="button"
									className="shell-option active"
									data-shell-option
									data-active="true"
									aria-pressed={true}
									onClick={() => pick({ model: { provider: current.provider, id: current.id } })}
								>
									<span className="shell-option-check" aria-hidden>
										✓
									</span>
									<span className="shell-option-name">{current.id}</span>
									<span className="shell-option-note">{current.provider}</span>
								</button>
							) : null}
						</div>
					</div>

					<div className="shell-group" role="group" aria-label={t("思考等级")}>
						<div className="shell-menu-title">{t("思考等级")}</div>
						{levels.length === 0 ? (
							<p className="shell-empty">—</p>
						) : (
							<div className="shell-levels">
								{levels.map(level => {
									const active = level === thinking;
									return (
										<button
											key={level}
											type="button"
											className={`shell-level${active ? " active" : ""}`}
											data-shell-option
											data-active={active}
											aria-pressed={active}
											onClick={() => pick({ thinking: level })}
										>
											{level}
										</button>
									);
								})}
							</div>
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}
