import { useState } from "react";
import type { Automation, BootInfo, SessionSummary } from "../../../shared/protocol.ts";
import { baseName, shortPath } from "../paths.ts";
import { pathKey } from "../../../shared/paths.ts";
import { t } from "../i18n.ts";

function IconPlus() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
			<path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
		</svg>
	);
}

function IconSearch() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
			<circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
			<path d="M10.4 10.4 13.6 13.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	);
}

function IconClock() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
			<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
			<path d="M8 4.9V8.2l2.2 1.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
		</svg>
	);
}

function IconPanel() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
			<rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
			<path d="M6.4 3v10" stroke="currentColor" strokeWidth="1.3" />
		</svg>
	);
}

function IconChevron({ open }: { open: boolean }) {
	return (
		<svg width="10" height="10" viewBox="0 0 16 16" aria-hidden className={open ? "chevron open" : "chevron"}>
			<path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
		</svg>
	);
}

function IconGear() {
	return (
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
			<circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
			<path
				d="M8 2.2v2.6M8 11.2v2.6M2.2 8h2.6M11.2 8h2.6M3.9 3.9l1.9 1.9M10.2 10.2l1.9 1.9M12.1 3.9l-1.9 1.9M5.8 10.2l-1.9 1.9"
				stroke="currentColor"
				strokeWidth="1.3"
				strokeLinecap="round"
			/>
		</svg>
	);
}

/**
 * One project at a time: the project row shows the current folder plus a "+" for
 * adding folders, and only the selected project carries its conversations.
 */
export function Sidebar({
	open,
	collapsed,
	activeView,
	sessions,
	activeId,
	project,
	projects,
	automations,
	boot,
	onNew,
	onSearch,
	onSelectProject,
	onAddProject,
	onRemoveProject,
	onSelectSession,
	onDeleteSession,
	onOpenAutomations,
	onOpenSettings,
	onCollapse,
}: {
	open: boolean;
	collapsed: boolean;
	activeView: "home" | "automations" | "settings";
	sessions: SessionSummary[];
	activeId: string | null;
	project: string | null;
	projects: string[];
	automations: Automation[];
	boot: BootInfo | null;
	onNew: () => void;
	onSearch: () => void;
	onSelectProject: (cwd: string) => void;
	onAddProject: () => Promise<void>;
	onRemoveProject: (cwd: string) => Promise<void>;
	onSelectSession: (id: string) => void;
	onDeleteSession: (id: string) => Promise<void>;
	onOpenAutomations: () => void;
	onOpenSettings: () => void;
	onCollapse: () => void;
}) {
	const [projectsOpen, setProjectsOpen] = useState(false);
	const [picking, setPicking] = useState(false);
	const account = boot?.user?.trim() ?? "";
	const initial = account ? [...account][0]!.toLocaleUpperCase() : "";

	const conversations = project ? sessions.filter(item => pathKey(item.cwd) === pathKey(project)) : [];

	const addProject = async () => {
		setPicking(true);
		try {
			await onAddProject();
		} finally {
			setPicking(false);
		}
	};

	const renderConversations = () =>
		conversations.length === 0 ? (
			<p className="sidebar-empty">{t("这个项目还没有对话。")}</p>
		) : (
			conversations.map(item => (
				<div
					key={item.id}
					className={`session-row${item.id === activeId ? " active" : ""}`}
					onClick={() => onSelectSession(item.id)}
					role="button"
					tabIndex={0}
					onKeyDown={event => {
						if (event.key === "Enter") onSelectSession(item.id);
					}}
				>
					<span className={`dot status-${item.status}`} aria-hidden />
					<span className="session-name">{item.name}</span>
					{item.phase === "plan" ? <span className="phase-chip small">{t("规划")}</span> : null}
					{item.phase === "deepplan" ? <span className="phase-chip small">{t("深规划")}</span> : null}
					<button
						type="button"
						className="row-delete"
						title={t("删除这个会话记录（不删项目文件）")}
						onClick={event => {
							event.stopPropagation();
							void onDeleteSession(item.id);
						}}
					>
						×
					</button>
				</div>
			))
		);

	return (
		<nav className={["sidebar", open ? "open" : "", collapsed ? "collapsed" : ""].filter(Boolean).join(" ")}>
			<div className="brand">
				<span className="brand-mark">PCB</span>
				<span className="brand-version">{boot?.ompVersion ?? ""}</span>
				<button type="button" className="icon-btn brand-collapse" title={t("收起侧栏")} onClick={onCollapse}>
					<IconPanel />
				</button>
			</div>

			<button type="button" className="nav-row nav-primary" onClick={onNew}>
				<span className="nav-icon" aria-hidden>
					<IconPlus />
				</span>
				New
			</button>

			<button type="button" className="nav-row" onClick={onSearch}>
				<span className="nav-icon" aria-hidden>
					<IconSearch />
				</span>
				Search
				<kbd className="nav-kbd">Ctrl K</kbd>
			</button>

			<button
				type="button"
				className={`nav-row${activeView === "automations" ? " active" : ""}`}
				onClick={onOpenAutomations}
			>
				<span className="nav-icon" aria-hidden>
					<IconClock />
				</span>
				Automations
				{automations.length > 0 ? <span className="nav-badge">{automations.length}</span> : null}
			</button>

			<section className="nav-section nav-projects">
				<div className="nav-project-row">
					<button
						type="button"
						className="nav-row nav-project"
						aria-expanded={projectsOpen}
						onClick={() => setProjectsOpen(open => !open)}
					>
						Project
						<span className="nav-project-value" title={project ?? ""}>
							{project ? baseName(project) : t("未选择")}
						</span>
						<span className="nav-caret" aria-hidden>
							<IconChevron open={projectsOpen} />
						</span>
					</button>
					<button
						type="button"
						className="nav-project-add"
						title={picking ? t("等待选择…") : t("添加项目")}
						disabled={picking}
						onClick={() => void addProject()}
					>
						<IconPlus />
					</button>
				</div>

				{projectsOpen ? (
					<div className="project-list">
						{projects.map(cwd => (
							<div key={cwd} className="project-entry">
								<div
									className={`project-option${
										project !== null && pathKey(cwd) === pathKey(project) ? " active" : ""
									}`}
								>
									<button
										type="button"
										className="project-option-main"
										title={cwd}
										onClick={() => onSelectProject(cwd)}
									>
										<span className="project-name">{baseName(cwd)}</span>
										<span className="project-path">{shortPath(cwd)}</span>
									</button>
									<button
										type="button"
										className="row-delete"
										title={t("退出项目（对话保留，重新添加后回来）")}
										onClick={() => void onRemoveProject(cwd)}
									>
										×
									</button>
								</div>
								{project !== null && pathKey(cwd) === pathKey(project) ? (
									<div className="project-sessions">{renderConversations()}</div>
								) : null}
							</div>
						))}
						{projects.length === 0 ? <p className="sidebar-empty">{t("还没有项目文件夹，点右上角的 + 添加。")}</p> : null}
					</div>
				) : null}
			</section>

			<div className="sidebar-foot">
				<div className="user-row">
					<span className="avatar" aria-hidden>
						{initial || "·"}
					</span>
					<span className="user-name" title={account}>
						{account || t("本地")}
					</span>
					<button
						type="button"
						className={`icon-btn${activeView === "settings" ? " on" : ""}`}
						title={t("设置")}
						aria-pressed={activeView === "settings"}
						onClick={onOpenSettings}
					>
						<IconGear />
					</button>
				</div>
			</div>
		</nav>
	);
}
