import { useState } from "react";
import type { Automation, BootInfo, SessionSummary } from "../../../shared/protocol.ts";

function shortPath(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

function baseName(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	return parts.at(-1) ?? path;
}

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

function IconChevron({ open }: { open: boolean }) {
	return (
		<svg width="10" height="10" viewBox="0 0 16 16" aria-hidden className={open ? "chevron open" : "chevron"}>
			<path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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
	onAddProjectPath,
	onRemoveProject,
	onSelectSession,
	onDeleteSession,
	onOpenAutomations,
	onCollapse,
}: {
	open: boolean;
	collapsed: boolean;
	activeView: "home" | "automations";
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
	onAddProjectPath: (cwd: string) => Promise<void>;
	onRemoveProject: (cwd: string) => Promise<void>;
	onSelectSession: (id: string) => void;
	onDeleteSession: (id: string) => Promise<void>;
	onOpenAutomations: () => void;
	onCollapse: () => void;
}) {
	const [projectsOpen, setProjectsOpen] = useState(true);
	const [picking, setPicking] = useState(false);
	const [manual, setManual] = useState(false);
	const [manualPath, setManualPath] = useState("");

	const conversations = project ? sessions.filter(session => session.cwd === project) : [];

	const addProject = async () => {
		setPicking(true);
		try {
			await onAddProject();
		} finally {
			setPicking(false);
		}
	};

	const submitManual = async (cwd: string) => {
		try {
			await onAddProjectPath(cwd);
			setManual(false);
			setManualPath("");
		} catch {
			// the caller surfaces the reason; keep the field for a retry
		}
	};

	return (
		<nav className={['sidebar', open ? 'open' : '', collapsed ? 'collapsed' : ''].filter(Boolean).join(' ')}>
			<div className="brand">
				<span className="brand-mark">PCB</span>
				<span className="brand-version">{boot?.ompVersion ?? ""}</span>
				<button type="button" className="icon-btn brand-collapse" title="收起侧栏" onClick={onCollapse}>
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

			<section className="nav-section">
				<button
					type="button"
					className="nav-heading"
					onClick={() => setProjectsOpen(open => !open)}
					aria-expanded={projectsOpen}
				>
					<span className="nav-caret" aria-hidden>
						<IconChevron open={projectsOpen} />
					</span>
					Projects
				</button>
				{projectsOpen ? (
					<div className="project-list">
						{projects.map(cwd => (
							<div
								key={cwd}
								className={`project-row${cwd === project ? " active" : ""}`}
								role="button"
								tabIndex={0}
								title={cwd}
								onClick={() => onSelectProject(cwd)}
								onKeyDown={event => {
									if (event.key === "Enter") onSelectProject(cwd);
								}}
							>
								<span className="project-name">{baseName(cwd)}</span>
								<span className="project-path">{shortPath(cwd)}</span>
								<button
									type="button"
									className="row-delete"
									title="从列表移除（不删文件）"
									onClick={event => {
										event.stopPropagation();
										void onRemoveProject(cwd);
									}}
								>
									×
								</button>
							</div>
						))}
						{projects.length === 0 ? <p className="sidebar-empty">还没有项目文件夹。</p> : null}
						<button type="button" className="nav-row nav-sub" disabled={picking} onClick={() => void addProject()}>
							<span className="nav-icon" aria-hidden>
								<IconPlus />
							</span>
							{picking ? "等待选择…" : "添加项目"}
						</button>
						{manual ? (
							<form
								className="manual-project"
								onSubmit={event => {
									event.preventDefault();
									const value = manualPath.trim();
									if (!value) return;
									void submitManual(value);
								}}
							>
								<input
									autoFocus
									value={manualPath}
									placeholder="粘贴文件夹路径，例如 D:\资料"
									onChange={event => setManualPath(event.target.value)}
								/>
								<div className="manual-actions">
									<button type="submit" className="primary" disabled={!manualPath.trim()}>
										添加
									</button>
									<button type="button" className="ghost" onClick={() => setManual(false)}>
										取消
									</button>
								</div>
							</form>
						) : (
							<button type="button" className="manual-link" onClick={() => setManual(true)}>
								对话框打不开？手动输入路径
							</button>
						)}
					</div>
				) : null}
			</section>

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

			<section className="nav-section nav-conversations">
				<div className="nav-heading static">对话</div>
				<div className="session-list">
					{project === null ? (
						<p className="sidebar-empty">选一个项目后，这里显示它的对话。</p>
					) : conversations.length === 0 ? (
						<p className="sidebar-empty">这个项目还没有对话。</p>
					) : (
						conversations.map(session => (
							<div
								key={session.id}
								className={`session-row${session.id === activeId ? " active" : ""}`}
								onClick={() => onSelectSession(session.id)}
								role="button"
								tabIndex={0}
								onKeyDown={event => {
									if (event.key === "Enter") onSelectSession(session.id);
								}}
							>
								<span className={`dot status-${session.status}`} aria-hidden />
								<span className="session-name">{session.name}</span>
								{session.phase === "plan" ? <span className="phase-chip small">规划</span> : null}
								<button
									type="button"
									className="row-delete"
									title="删除这个会话记录（不删项目文件）"
									onClick={event => {
										event.stopPropagation();
										void onDeleteSession(session.id);
									}}
								>
									×
								</button>
							</div>
						))
					)}
				</div>
			</section>
		</nav>
	);
}
