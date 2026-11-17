import type { AgentMessage, Phase, TodoPhase } from "../../../shared/protocol.ts";
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
 */
export function RightRail({
	cwd,
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
	return (
		<aside className="rail">
			<div className="rail-head">
				<div className="segmented" role="tablist">
					{TABS.map(item => (
						<button
							key={item.id}
							type="button"
							role="tab"
							aria-selected={tab === item.id}
							className={tab === item.id ? "active" : undefined}
							onClick={() => onTab(item.id)}
						>
							{item.label}
						</button>
					))}
				</div>
				<button type="button" className="icon-btn" title="收起右栏" onClick={onClose}>
					<IconClose />
				</button>
			</div>

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
				<TerminalPage entries={terminal} />
			) : (
				<BrowserPage shots={browser} />
			)}
		</aside>
	);
}
