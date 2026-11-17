import type { AgentMessage, Phase, TodoPhase } from "../../../shared/protocol.ts";
import { t } from "../i18n.ts";
import type { BrowserShot, TerminalEntry } from "../adapters.ts";
import { FilePage } from "./FilePage.tsx";
import { PlanPage } from "./PlanPage.tsx";
import { BrowserPage } from "./BrowserPage.tsx";
import { TerminalPage } from "./TerminalPage.tsx";

export type RailTab = "files" | "plan" | "terminal" | "browser";

const TABS: Array<{ id: RailTab; label: string }> = [
	{ id: "files", label: "文件" },
	{ id: "plan", label: "计划" },
	{ id: "terminal", label: "终端" },
	{ id: "browser", label: "浏览器" },
];

function IconClose() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
			<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	);
}

/**
 * Right rail: four views over the same conversation — the project files it can
 * read, the plan it proposed, the commands it ran, and the pages it opened.
 *
 * Each tab carries a badge with how much is waiting behind it, so the other
 * three stay readable without opening them.
 */
export function RightRail({
	cwd,
	platform,
	phase,
	todos,
	segment,
	terminal,
	browser,
	changedFiles,
	canApprove,
	tab,
	onTab,
	onApprove,
	onRevise,
	onClose,
}: {
	cwd: string;
	platform: string;
	phase: Phase;
	todos: TodoPhase[];
	segment: AgentMessage[];
	terminal: TerminalEntry[];
	browser: BrowserShot[];
	changedFiles: string[];
	canApprove: boolean;
	tab: RailTab;
	onTab: (tab: RailTab) => void;
	onApprove: () => void;
	onRevise: () => void;
	onClose: () => void;
}) {
	const tasks = todos.flatMap(group => group.tasks);
	const badges: Record<RailTab, string | null> = {
		files: changedFiles.length > 0 ? String(changedFiles.length) : null,
		plan: tasks.length > 0 ? `${tasks.filter(task => task.status === "completed").length}/${tasks.length}` : null,
		terminal: terminal.length > 0 ? String(terminal.length) : null,
		browser: browser.length > 0 ? String(browser.length) : null,
	};

	const step = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		const from = TABS.findIndex(item => item.id === tab);
		const next = (from + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
		const item = TABS[next];
		if (!item) return;
		onTab(item.id);
		event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
	};

	return (
		<aside className="rail">
			<div className="rail-head">
				<div className="segmented" role="tablist" aria-label={t("右栏视图")} onKeyDown={step}>
					{TABS.map(item => (
						<button
							key={item.id}
							type="button"
							role="tab"
							id={`rail-tab-${item.id}`}
							aria-selected={tab === item.id}
							aria-controls={`rail-panel-${item.id}`}
							tabIndex={tab === item.id ? 0 : -1}
							className={tab === item.id ? "active" : undefined}
							onClick={() => onTab(item.id)}
						>
							<span className="tab-label">{t(item.label)}</span>
							{badges[item.id] ? <span className="tab-badge">{badges[item.id]}</span> : null}
						</button>
					))}
				</div>
				<button type="button" className="icon-btn" title={t("收起右栏")} onClick={onClose}>
					<IconClose />
				</button>
			</div>

			<div className="rail-panel" role="tabpanel" id={`rail-panel-${tab}`} aria-labelledby={`rail-tab-${tab}`}>
				{tab === "files" ? (
					<FilePage cwd={cwd} changed={changedFiles} />
				) : tab === "plan" ? (
					<PlanPage
						phase={phase}
						todos={todos}
						segment={segment}
						canApprove={canApprove}
						onApprove={onApprove}
						onRevise={onRevise}
					/>
				) : tab === "terminal" ? (
					<TerminalPage entries={terminal} cwd={cwd} platform={platform} />
				) : (
					<BrowserPage shots={browser} />
				)}
			</div>
		</aside>
	);
}
