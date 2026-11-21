import { useEffect, useState } from "react";
import type { ModelsInfo, SessionState, SessionSummary } from "../../../shared/protocol.ts";
import { t } from "../i18n.ts";

/**
 * Model switch for the open conversation. Lives in the sidebar's config card;
 * without a conversation it renders a disabled placeholder.
 */
export function ModelPicker({
	session,
	state,
	onModel,
}: {
	session: SessionSummary | null;
	state: SessionState | undefined;
	onModel: (provider: string, id: string) => Promise<void>;
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

	if (!session) return null;

	const current = state?.model ?? session.model ?? null;
	const value = current ? `${current.provider}/${current.id}` : "";
	const options = models?.models ?? [];

	return (
		<>
			<div className="config-title">{t("模型")}</div>
			<select
				className="config-select"
				value={value}
				disabled={!session.alive}
				title={t("模型")}
				onChange={event => {
					const [provider, id] = event.target.value.split("/");
					if (provider && id) void onModel(provider, id);
				}}
			>
				{value ? null : <option value="">{t("模型")}</option>}
				{options.map(model => (
					<option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
						{model.id}
					</option>
				))}
				{value && !options.some(model => `${model.provider}/${model.id}` === value) ? (
					<option value={value}>{current?.id}</option>
				) : null}
			</select>
		</>
	);
}
