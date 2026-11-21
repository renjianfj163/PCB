import { useEffect, useState } from "react";
import type { SessionState, SessionSummary, ThinkingInfo } from "../../../shared/protocol.ts";
import { api } from "../api.ts";
import { t } from "../i18n.ts";

/**
 * Thinking effort for the open conversation. The levels come from omp for the model
 * in use (it answers "off" plus whatever efforts that model accepts), so the list is
 * refetched whenever the model changes.
 */
export function ThinkingPicker({
	session,
	state,
	onThinking,
}: {
	session: SessionSummary | null;
	state: SessionState | undefined;
	onThinking: (level: string) => Promise<void>;
}) {
	const [info, setInfo] = useState<ThinkingInfo | null>(null);

	useEffect(() => {
		if (!session) return;
		let cancelled = false;
		void (async () => {
			try {
				const response = await api.thinking(session.id);
				if (!cancelled) setInfo(response);
			} catch {
				// keep the previous list; the level still shows from session state
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [session?.id, session?.status, state?.model?.id, state?.model?.provider]);

	if (!session) {
		return (
			<select className="config-select" disabled title={t("思考等级")}>
				<option>{t("先开始一次对话")}</option>
			</select>
		);
	}

	const value = state?.thinkingLevel ?? info?.current ?? "";
	const levels = info?.levels ?? [];

	return (
		<select
			className="config-select"
			value={value}
			disabled={!session.alive || levels.length === 0}
			title={t("思考等级")}
			onChange={event => void onThinking(event.target.value)}
		>
			{value && !levels.includes(value) ? <option value={value}>{value}</option> : null}
			{levels.length === 0 ? <option value="">{t("这个模型没有档位")}</option> : null}
			{levels.map(level => (
				<option key={level} value={level}>
					{level}
				</option>
			))}
		</select>
	);
}
