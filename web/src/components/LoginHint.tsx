import { t } from "../i18n.ts";

/**
 * First run without a model: a layer over the window, never a blocked one. It
 * says what is missing, offers the console login, and explains what the window's
 * × really does. Dismissing it is remembered; Settings keeps the same button.
 */
export function LoginHint({ onLogin, onDismiss }: { onLogin: () => void; onDismiss: () => void }) {
	return (
		<div className="dialog-overlay login-hint">
			<div className="dialog-card" role="dialog" aria-modal="true" aria-label={t("登录模型")}>
				<h2>{t("先登录模型，才能发消息")}</h2>
				<p className="dialog-body-text">
					{t("现在还没有登录任何模型，PCB 发不出消息，也执行不了计划。登录在 omp 自己的窗口里完成。")}
				</p>
				<p className="dialog-body-text muted">
					{t("点窗口的 × 只是把它藏到托盘，定时任务还在跑；真正的退出在托盘的「退出」。")}
				</p>
				<footer>
					<button type="button" className="ghost" onClick={onDismiss}>
						{t("稍后")}
					</button>
					<button type="button" className="primary" onClick={onLogin}>
						{t("登录模型")}
					</button>
				</footer>
			</div>
		</div>
	);
}
