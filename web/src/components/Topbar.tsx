import { useEffect, useState } from "react";
import type { ModelsInfo, SessionState, SessionSummary } from "../../../shared/protocol.ts";

function IconMenu() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
			<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	);
}

function IconPanel() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
			<rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
			<path d="M9.6 3v10" stroke="currentColor" strokeWidth="1.3" />
		</svg>
	);
}

function IconExport() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
			<path d="M8 2.5v7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
			<path d="M5.2 6.6 8 9.4l2.8-2.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
			<path d="M3 11.5v1.2h10v-1.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
		</svg>
	);
}

function IconRefresh() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
			<path d="M12.6 7.2A4.9 4.9 0 1 1 11 4.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
			<path d="M12.9 2.4v2.6h-2.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
		</svg>
	);
}

function IconRestore() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
			<path d="M3.4 7.2A4.9 4.9 0 1 0 5 4.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
			<circle cx="8" cy="8" r="1.1" fill="currentColor" />
		</svg>
	);
}

export function Topbar({
	session,
	state,
	rightOpen,
	onToggleRight,
	onToggleSidebar,
	leftCollapsed,
	onExpandLeft,
	onModel,
	onResume,
	onExport,
	onRefresh,
}: {
	session: SessionSummary | null;
	state: SessionState | undefined;
	rightOpen: boolean;
	onToggleRight: () => void;
	onToggleSidebar: () => void;
	leftCollapsed: boolean;
	onExpandLeft: () => void;
	onModel: (provider: string, id: string) => Promise<void>;
	onResume: () => Promise<void>;
	onExport: () => Promise<void>;
	onRefresh: () => Promise<void>;
}) {
	const [models, setModels] = useState<ModelsInfo | null>(null);

	useEffect(() => {
		if (!session) return;
		let cancelled = false;
		let attempt = 0;
		let timer: number | undefined;

		const load = async () => {
			try {
				const response = await fetch(`/api/sessions/${session.id}/models`);
				if (!response.ok) return;
				const data = (await response.json()) as ModelsInfo;
				if (cancelled) return;
				setModels(data);
				// Provider catalog discovery runs in the background on the server.
				if (data.models.length === 0 && attempt < 8) {
					attempt++;
					timer = window.setTimeout(() => void load(), 1500);
				}
			} catch {
				// keep the previous list
			}
		};

		void load();
		return () => {
			cancelled = true;
			if (timer !== undefined) window.clearTimeout(timer);
		};
	}, [session?.id, session?.status, session?.updatedAt]);

	const current = state?.model ?? session?.model ?? null;
	const value = current ? `${current.provider}/${current.id}` : "";
	const options = models?.models ?? [];

	return (
		<header className="topbar">
			{leftCollapsed ? (
				<button type="button" className="icon-btn icon-left" title="展开侧栏" onClick={onExpandLeft}>
					<IconPanel />
				</button>
			) : null}
			<button type="button" className="icon-btn icon-menu" title="会话列表" onClick={onToggleSidebar}>
				<IconMenu />
			</button>

			<div className="topbar-title">
				<h1>{session?.name ?? "新对话"}</h1>
				{session ? <span title={session.cwd}>{session.cwd}</span> : null}
			</div>

			<div className="topbar-actions">
				{session ? (
					<select
						className="model-select"
						value={value}
						disabled={!session.alive}
						title="模型"
						onChange={event => {
							const [provider, id] = event.target.value.split("/");
							if (provider && id) void onModel(provider, id);
						}}
					>
						{value ? null : <option value="">模型</option>}
						{options.map(model => (
							<option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
								{model.id}
							</option>
						))}
						{value && !options.some(model => `${model.provider}/${model.id}` === value) ? (
							<option value={value}>{current?.id}</option>
						) : null}
					</select>
				) : null}

				<button
					type="button"
					className={`icon-btn${rightOpen ? " on" : ""}`}
					title={rightOpen ? "收起右栏" : "展开右栏"}
					onClick={onToggleRight}
				>
					<IconPanel />
				</button>

				{session ? (
					<>
						{session.alive ? null : (
							<button type="button" className="icon-btn" title="恢复会话" onClick={() => void onResume()}>
								<IconRestore />
							</button>
						)}
						<button type="button" className="icon-btn" title="导出 HTML" onClick={() => void onExport()}>
							<IconExport />
						</button>
						<button type="button" className="icon-btn" title="重新拉取会话内容" onClick={() => void onRefresh()}>
							<IconRefresh />
						</button>
					</>
				) : null}
			</div>
		</header>
	);
}
