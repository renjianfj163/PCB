import { useState } from "react";
import type { Automation, Phase } from "../../../shared/protocol.ts";
import { getLocale, t } from "../i18n.ts";

function shortPath(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	return parts.at(-1) ?? path;
}

function clock(ms: number | null | undefined): string {
	if (!ms) return t("还没跑过");
	const date = new Date(ms);
	const pad = (value: number) => String(value).padStart(2, "0");
	return getLocale() === "en"
		? `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
		: `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface Draft {
	name: string;
	cwd: string;
	phase: Phase;
	prompt: string;
	dailyAt: string;
	enabled: boolean;
}

const EMPTY_DRAFT: Draft = { name: "", cwd: "", phase: "plan", prompt: "", dailyAt: "", enabled: true };

export function Automations({
	automations,
	projects,
	onCreate,
	onRun,
	onToggle,
	onDelete,
}: {
	automations: Automation[];
	projects: string[];
	onCreate: (input: {
		name: string;
		cwd: string;
		phase: Phase;
		prompt: string;
		dailyAt: string | null;
		enabled: boolean;
	}) => Promise<void>;
	onRun: (id: string) => Promise<void>;
	onToggle: (automation: Automation, enabled: boolean) => Promise<void>;
	onDelete: (id: string) => Promise<void>;
}) {
	const [draft, setDraft] = useState<Draft | null>(null);
	const [saving, setSaving] = useState(false);
	const [running, setRunning] = useState<string | null>(null);

	const start = () =>
		setDraft({ ...EMPTY_DRAFT, cwd: projects[0] ?? "" });

	const submit = async () => {
		if (!draft) return;
		setSaving(true);
		try {
			await onCreate({
				name: draft.name,
				cwd: draft.cwd,
				phase: draft.phase,
				prompt: draft.prompt,
				dailyAt: draft.dailyAt.trim() || null,
				enabled: draft.enabled,
			});
			setDraft(null);
		} finally {
			setSaving(false);
		}
	};

	const runNow = async (id: string) => {
		setRunning(id);
		try {
			await onRun(id);
		} finally {
			setRunning(null);
		}
	};

	return (
		<div className="automations">
			<header className="page-head">
				<div>
					<h1>{t("自动化和定时任务")}</h1>
					<p>{t("点「现在运行」会立刻开一条新对话；每天定时只在 PCB 开着时生效，错过不补。")}</p>
				</div>
				<button type="button" className="primary" onClick={start}>
					{t("＋ 新建")}
				</button>
			</header>

			{draft ? (
				<div className="auto-form">
					<label>
						{t("名称")}
						<input
							value={draft.name}
							placeholder={t("例如：每天整理下载文件夹")}
							onChange={event => setDraft({ ...draft, name: event.target.value })}
						/>
					</label>
					<label>
						{t("项目文件夹")}
						<select value={draft.cwd} onChange={event => setDraft({ ...draft, cwd: event.target.value })}>
							{draft.cwd === "" ? <option value="">{t("（先添加一个项目）")}</option> : null}
							{projects.map(cwd => (
								<option key={cwd} value={cwd}>
									{cwd}
								</option>
							))}
						</select>
					</label>
					<label>
						{t("阶段")}
						<select
							value={draft.phase}
							onChange={event => setDraft({ ...draft, phase: event.target.value === "build" ? "build" : "plan" })}
						>
							<option value="plan">{t("规划（只读，先给计划）")}</option>
							<option value="build">{t("执行（直接动手）")}</option>
						</select>
					</label>
					<label className="wide">
						{t("要它做什么")}
						<textarea
							rows={3}
							value={draft.prompt}
							placeholder={t("例如：把下载文件夹里的图片按月份归档")}
							onChange={event => setDraft({ ...draft, prompt: event.target.value })}
						/>
					</label>
					<label>
						{t("每天几点（可空）")}
						<input
							type="time"
							value={draft.dailyAt}
							onChange={event => setDraft({ ...draft, dailyAt: event.target.value })}
						/>
					</label>
					<label className="check">
						<input
							type="checkbox"
							checked={draft.enabled}
							onChange={event => setDraft({ ...draft, enabled: event.target.checked })}
						/>
						{t("启用")}
					</label>
					<div className="auto-form-actions">
						<button type="button" className="primary" disabled={saving} onClick={() => void submit()}>
							{saving ? t("保存中…") : t("保存")}
						</button>
						<button type="button" className="ghost" onClick={() => setDraft(null)}>
							{t("取消")}
						</button>
					</div>
				</div>
			) : null}

			<div className="auto-list">
				{automations.map(automation => (
					<article key={automation.id} className="auto-card">
						<div className="auto-card-head">
							<h2>{automation.name}</h2>
							<span className={`phase-pill${automation.phase === "build" ? " build" : ""}`}>
								{automation.phase === "plan" ? t("规划") : t("执行")}
							</span>
							<label className="switch" title={t("启用或停用")}>
								<input
									type="checkbox"
									checked={automation.enabled}
									onChange={event => void onToggle(automation, event.target.checked)}
								/>
								<span>{automation.enabled ? t("已启用") : t("已停用")}</span>
							</label>
						</div>
						<p className="auto-prompt">{automation.prompt}</p>
						<div className="auto-meta">
							<span title={automation.cwd}>{t("项目：{s}", { s: shortPath(automation.cwd) })}</span>
							<span>{automation.dailyAt ? t("每天 {s}", { s: automation.dailyAt }) : t("仅手动运行")}</span>
							<span>{t("上次运行：{s}", { s: clock(automation.lastRunAt) })}</span>
						</div>
						{automation.lastError ? <p className="auto-error">{t("上次失败：{s}", { s: automation.lastError })}</p> : null}
						<div className="auto-actions">
							<button
								type="button"
								className="primary"
								disabled={running === automation.id}
								onClick={() => void runNow(automation.id)}
							>
								{running === automation.id ? t("正在新开对话…") : t("现在运行")}
							</button>
							<button type="button" className="ghost" onClick={() => void onDelete(automation.id)}>
								{t("删除")}
							</button>
						</div>
					</article>
				))}
				{automations.length === 0 ? (
					<p className="auto-empty">{t("还没有自动化。点右上「新建」，让它每天替你跑同一件事。")}</p>
				) : null}
			</div>
		</div>
	);
}
