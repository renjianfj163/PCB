import type { SessionSummary } from "../../../shared/protocol.ts";
import { t } from "../i18n.ts";

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

function IconIde() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
			<path d="M5.4 4.6 2.4 8l3 3.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
			<path d="m10.6 4.6 3 3.4-3 3.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
			<path d="m9 3.2-2 9.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
	rightOpen,
	onToggleRight,
	onToggleSidebar,
	leftCollapsed,
	onExpandLeft,
	onResume,
	onIde,
	showIde,
	onRefresh,
}: {
	session: SessionSummary | null;
	rightOpen: boolean;
	onToggleRight: () => void;
	onToggleSidebar: () => void;
	leftCollapsed: boolean;
	onExpandLeft: () => void;
	onResume: () => Promise<void>;
	onIde: () => Promise<void>;
	showIde: boolean;
	onRefresh: () => Promise<void>;
}) {
	return (
		<header className="topbar">
			{leftCollapsed ? (
				<button type="button" className="icon-btn icon-left" title={t("展开侧栏")} onClick={onExpandLeft}>
					<IconPanel />
				</button>
			) : null}
			<button type="button" className="icon-btn icon-menu" title={t("会话列表")} onClick={onToggleSidebar}>
				<IconMenu />
			</button>

			<div className="topbar-title">
				<h1>{session?.name ?? t("新对话")}</h1>
				{session ? <span title={session.cwd}>{session.cwd}</span> : null}
			</div>

			<div className="topbar-actions">
				<button
					type="button"
					className={`icon-btn${rightOpen ? " on" : ""}`}
					title={rightOpen ? t("收起右栏") : t("展开右栏")}
					onClick={onToggleRight}
				>
					<IconPanel />
				</button>

				{session ? (
					<>
						{session.alive ? null : (
							<button type="button" className="icon-btn" title={t("恢复会话")} onClick={() => void onResume()}>
								<IconRestore />
							</button>
						)}
						{showIde ? (
							<button type="button" className="icon-btn" title={t("在 VS Code 中打开")} onClick={() => void onIde()}>
								<IconIde />
							</button>
						) : null}
						<button type="button" className="icon-btn" title={t("重新拉取会话内容")} onClick={() => void onRefresh()}>
							<IconRefresh />
						</button>
					</>
				) : null}
			</div>
		</header>
	);
}
