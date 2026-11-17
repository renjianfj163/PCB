import { useState } from "react";
import type { PolicyDecision } from "../../../shared/protocol.ts";
import type { TerminalEntry } from "../adapters.ts";

const POLICY_LABEL: Record<PolicyDecision, string> = {
	auto_allow: "自动放行",
	approval_required: "等待审批",
	approved: "已批准",
	rejected: "已拒绝",
	denied: "被拒绝",
};

const STATUS_LABEL: Record<TerminalEntry["status"], string> = {
	running: "运行中",
	ok: "成功",
	error: "失败",
};

function clock(at: number | undefined): string {
	if (!at) return "";
	const date = new Date(at);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Shell history of this conversation: what ran, how it ended and who allowed it. */
export function TerminalPage({ entries }: { entries: TerminalEntry[] }) {
	const [open, setOpen] = useState<Record<string, true>>({});

	if (entries.length === 0) {
		return (
			<div className="rail-body">
				<div className="rail-section-head">
					<h2>终端</h2>
				</div>
				<p className="plan-empty">这次对话还没跑过命令。</p>
			</div>
		);
	}

	return (
		<div className="rail-body term-page">
			<div className="rail-section-head">
				<h2>终端</h2>
				<span className="plan-count">{entries.length}</span>
			</div>

			<ul className="term-list">
				{entries.map(entry => {
					const expanded = open[entry.id] === true;
					const output = entry.output.trim();
					return (
						<li key={entry.id} className={`term-item term-${entry.status}`}>
							<button
								type="button"
								className="term-head"
								title={entry.command}
								onClick={() =>
									setOpen(previous => {
										if (previous[entry.id]) {
											const next = { ...previous };
											delete next[entry.id];
											return next;
										}
										return { ...previous, [entry.id]: true };
									})
								}
							>
								<span className="term-state" aria-hidden>
									{entry.status === "running" ? "◌" : entry.status === "error" ? "✕" : "✓"}
								</span>
								<span className="term-cmd">{entry.command}</span>
								<span className="term-time">{clock(entry.at)}</span>
							</button>
							<div className="term-meta">
								<span className={`term-status st-${entry.status}`}>{STATUS_LABEL[entry.status]}</span>
								{entry.policy ? (
									<span className={`term-policy p-${entry.policy}`}>{POLICY_LABEL[entry.policy]}</span>
								) : null}
								{output ? <span className="term-more">{expanded ? "收起输出" : "输出"}</span> : null}
							</div>
							{expanded && output ? (
								<pre className="term-output">{output.length > 6000 ? `${output.slice(0, 6000)}\n…` : output}</pre>
							) : null}
						</li>
					);
				})}
			</ul>
		</div>
	);
}
