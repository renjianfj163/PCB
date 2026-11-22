import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { parseCompactInvocation } from "../../shared/compact.ts";
import type { Automation, CompactResult, DialogAnswer, Phase, PromptImage, UiEvent } from "../../shared/protocol.ts";
import { api } from "./api.ts";
import { browserShots, changedFiles, planSegment, rewindNotice, stripPhaseMarker, terminalEntries } from "./adapters.ts";
import { Automations } from "./components/Automations.tsx";
import { Composer } from "./components/Composer.tsx";
import { DialogLayer } from "./components/Dialogs.tsx";
import { Home } from "./components/Home.tsx";
import { Palette, type PaletteItem } from "./components/Palette.tsx";
import { RawLog } from "./components/RawLog.tsx";
import { RightRail, type RailTab } from "./components/RightRail.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Topbar } from "./components/Topbar.tsx";
import { Transcript } from "./components/Transcript.tsx";
import { initialState, reducer } from "./state.ts";
import { t, useLocale } from "./i18n.ts";
import { sessionTitle } from "./titles.ts";

const RIGHT_PANEL_KEY = "pcb.rightPanel";
const LEFT_PANEL_KEY = "pcb.leftPanel";
const RAIL_WIDTH_KEY = "pcb.railW";
const PROJECT_KEY = "pcb.project";

const RAIL_MIN = 260;
const RAIL_SHARE = 0.8;
/** The conversation column keeps at least this much before the rail takes the rest. */
const CHAT_MIN = 360;

function compactNotice(result: CompactResult): string {
	if (typeof result.tokensBefore === "number" && typeof result.tokensAfter === "number") {
		return t("已压缩上下文，从 {before} 收到 {after}", {
			before: result.tokensBefore,
			after: result.tokensAfter,
		});
	}
	return t("已压缩上下文");
}

function clampRail(width: number): number {
	// The sidebar is 256px open and 0 when collapsed; read it instead of assuming.
	const sidebar = document.querySelector(".sidebar")?.getBoundingClientRect().width ?? 0;
	const available = Math.max(RAIL_MIN + CHAT_MIN, window.innerWidth - sidebar);
	const max = Math.max(RAIL_MIN, Math.min(available - CHAT_MIN, Math.round(available * RAIL_SHARE)));
	return Math.min(max, Math.max(RAIL_MIN, Math.round(width)));
}

function initialRailWidth(): number {
	const stored = Number(window.localStorage.getItem(RAIL_WIDTH_KEY));
	return clampRail(Number.isFinite(stored) && stored > 0 ? stored : 400);
}

function initialSidebarCollapsed(): boolean {
	return window.localStorage.getItem(LEFT_PANEL_KEY) === "closed";
}

function initialRightOpen(): boolean {
	const stored = window.localStorage.getItem(RIGHT_PANEL_KEY);
	if (stored === "open") return true;
	if (stored === "closed") return false;
	return window.innerWidth >= 1024;
}

export default function App() {
	// Any language change re-renders the whole shell.
	useLocale();
	const [state, dispatch] = useReducer(reducer, initialState);
	const [error, setError] = useState<string | null>(null);
	const [info, setInfo] = useState<string | null>(null);
	const [view, setView] = useState<"home" | "automations">("home");
	const [project, setProjectState] = useState<string | null>(() => window.localStorage.getItem(PROJECT_KEY));
	// The selected folder survives a reload: it is the sidebar's current project.
	const setProject = (cwd: string | null) => {
		setProjectState(cwd);
		if (cwd) window.localStorage.setItem(PROJECT_KEY, cwd);
		else window.localStorage.removeItem(PROJECT_KEY);
	};
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [sending, setSending] = useState(false);
	// Bumping this remounts the blank page, so a new conversation starts on Plan.
	const [homeEpoch, setHomeEpoch] = useState(0);
	const [rightOpen, setRightOpen] = useState(initialRightOpen);
	const [rightTab, setRightTab] = useState<RailTab>("files");
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
	const [railWidth, setRailWidth] = useState(initialRailWidth);
	const railWidthRef = useRef(railWidth);
	railWidthRef.current = railWidth;
	const composerRef = useRef<HTMLTextAreaElement | null>(null);
	// A rewound message goes back into the composer as a draft: filled in, never sent.
	const [draft, setDraft] = useState<{ id: number; text: string } | null>(null);
	const draftSeq = useRef(0);

	const guard = useCallback(async (run: () => Promise<void>) => {
		try {
			await run();
			setError(null);
		} catch (cause) {
			setError((cause as Error).message);
		}
	}, []);

	useEffect(() => {
		void guard(async () => {
			const boot = await api.boot();
			dispatch({ type: "boot", boot });
		});
	}, [guard]);

	// A wider rail is only legal while the window can back it; shrink it back
	// in when the window does, instead of letting the conversation collapse.
	useEffect(() => {
		const onResize = () => setRailWidth(current => clampRail(current));
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	useEffect(() => {
		const source = new EventSource("/api/events");
		source.onmessage = event => {
			try {
				const payload = JSON.parse(event.data) as UiEvent;
				dispatch({ type: "ui", event: payload });
			} catch {
				// ignore malformed frames
			}
		};
		return () => source.close();
	}, []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setPaletteOpen(open => !open);
			}
			if (event.key === "Escape") {
				setPaletteOpen(false);
				setSidebarOpen(false);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	useEffect(() => {
		if (!state.boot || !project) return;
		if (!state.boot.projects.includes(project)) setProject(null);
	}, [state.boot, project]);

	const [resuming, setResuming] = useState<string | null>(null);
	const activeId = state.activeId;
	const session = state.sessions.find(item => item.id === activeId) ?? null;
	const projects = state.boot?.projects ?? [];

	const aliveNow = session?.alive ?? false;

	// Selecting a conversation loads it, and so does finding it dormant — after a
	// restart or a crash the process is gone while the transcript stays, so the
	// open conversation wakes itself instead of waiting for a manual resume.
	useEffect(() => {
		if (!activeId) return;
		const target = state.sessions.find(item => item.id === activeId);
		if (!target) return;
		const dormant = !target.alive;
		if (dormant) setResuming(activeId);
		void guard(async () => {
			if (dormant) await api.resumeSession(activeId);
			const [{ messages }, { state: sessionState }, { policies }] = await Promise.all([
				api.messages(activeId),
				api.state(activeId),
				api.policies(activeId),
			]);
			dispatch({ type: "ui", event: { t: "messages", sessionId: activeId, messages } });
			dispatch({ type: "ui", event: { t: "state", sessionId: activeId, state: sessionState } });
			dispatch({ type: "set_policies", sessionId: activeId, policies });
		}).finally(() => setResuming(current => (current === activeId ? null : current)));
	}, [activeId, guard, aliveNow]);

	useEffect(() => {
		if (!info) return;
		const timer = setTimeout(() => setInfo(null), 6000);
		return () => clearTimeout(timer);
	}, [info]);

	const setRightPanel = (open: boolean) => {
		setRightOpen(open);
		window.localStorage.setItem(RIGHT_PANEL_KEY, open ? "open" : "closed");
	};

	const setLeftPanel = (open: boolean) => {
		setSidebarCollapsed(!open);
		window.localStorage.setItem(LEFT_PANEL_KEY, open ? "open" : "closed");
	};

	/** Drag between the conversation column and the rail to rebalance them. */
	const startRailResize = (event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = railWidthRef.current;
		const move = (moveEvent: PointerEvent) => {
			setRailWidth(clampRail(startWidth - (moveEvent.clientX - startX)));
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			document.body.classList.remove("resizing");
			window.localStorage.setItem(RAIL_WIDTH_KEY, String(railWidthRef.current));
		};
		document.body.classList.add("resizing");
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	const openSession = (id: string) => {
		const target = state.sessions.find(item => item.id === id);
		if (target) setProject(target.cwd);
		dispatch({ type: "select", id });
		setView("home");
		setSidebarOpen(false);
	};

	const startNew = () => {
		setHomeEpoch(epoch => epoch + 1);
		dispatch({ type: "select", id: null });
		dispatch({ type: "clear_notices" });
		setView("home");
		setSidebarOpen(false);
	};

	const selectProject = (cwd: string) => {
		setProject(cwd);
		dispatch({ type: "select", id: null });
		dispatch({ type: "clear_notices" });
		setView("home");
		setSidebarOpen(false);
	};

	const addProject = () =>
		guard(async () => {
			const result = await api.pickProject();
			if (result.cancelled || !result.cwd) return;
			dispatch({ type: "set_projects", projects: result.projects });
			setProject(result.cwd);
			dispatch({ type: "select", id: null });
			dispatch({ type: "clear_notices" });
			setView("home");
		});

	const removeProject = (cwd: string) =>
		guard(async () => {
			const result = await api.removeProject(cwd);
			dispatch({ type: "set_projects", projects: result.projects });
			if (project === cwd) setProject(null);
		});

	/** First message: creates the conversation in the chosen folder and sends it. */
	const sendFromHome = async (text: string, images: PromptImage[], phase: Phase) => {
		if (!project) throw new Error(t("先选一个项目文件夹"));
		setSending(true);
		try {
			const { session: created } = await api.createSession({
				cwd: project,
				// The sidebar shows what the user asked, not the folder name.
				name: sessionTitle(text),
				extensions: false,
				phase,
				initialPrompt: text,
				...(images.length > 0 ? { initialImages: images } : {}),
			});
			dispatch({ type: "ui", event: { t: "session", session: created } });
			dispatch({ type: "select", id: created.id });
			// `/compact` is a command, not a line of the conversation.
			if (!parseCompactInvocation(text) || images.length > 0) {
				dispatch({ type: "local_user", sessionId: created.id, text, images });
			}
		} finally {
			setSending(false);
		}
	};

	const approvePlan = () =>
		guard(async () => {
			if (!session) return;
			await api.setPhase(session.id, "build");
			await api.prompt(session.id, t("按上面的计划开始执行。"));
		});

	const revisePlan = () => {
		composerRef.current?.focus();
	};

	/**
	 * Move the conversation back to just before one user message. Only the
	 * transcript moves: files are untouched, and the line goes into the composer
	 * as a draft instead of being sent again.
	 */
	const rewindTo = (entryId: string) =>
		guard(async () => {
			if (!session) return;
			const result = await api.rewind(session.id, entryId);
			const notice = rewindNotice(result);
			if (notice) {
				setInfo(t(notice));
				return;
			}
			if (!result.editorText) return;
			draftSeq.current += 1;
			setDraft({ id: draftSeq.current, text: stripPhaseMarker(result.editorText) });
		});

	/** The composer's phase switch: changes only what the next message carries. */
	const setPhaseOnly = (phase: Phase) =>
		guard(async () => {
			if (!session) return;
			await api.setPhase(session.id, phase);
		});

	const paletteItems: PaletteItem[] = useMemo(
		() => [
			...projects.map(cwd => ({
				key: `project:${cwd}`,
				group: "项目" as const,
				title: cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd,
				subtitle: cwd,
			})),
			...state.sessions.map(item => ({
				key: `session:${item.id}`,
				group: "会话" as const,
				title: item.name,
				subtitle: item.cwd,
			})),
			...state.automations.map(item => ({
				key: `automation:${item.id}`,
				group: "自动化" as const,
				title: item.name,
				subtitle: item.cwd,
			})),
		],
		[projects, state.sessions, state.automations],
	);

	const onPalettePick = (item: PaletteItem) => {
		const [kind, value] = item.key.split(/:(.*)/s) as [string, string];
		if (kind === "project") selectProject(value);
		else if (kind === "session") openSession(value);
		else if (kind === "automation") openAutomations();
	};

	const openAutomations = () => {
		dispatch({ type: "select", id: null });
		setView("automations");
		setRightOpen(false);
		setSidebarOpen(false);
	};

	const automationHandlers = {
		onCreate: (input: {
			name: string;
			cwd: string;
			phase: Phase;
			prompt: string;
			dailyAt: string | null;
			enabled: boolean;
		}) =>
			guard(async () => {
				await api.createAutomation(input);
			}),
		onRun: (id: string) =>
			guard(async () => {
				const { session: created } = await api.runAutomation(id);
				dispatch({ type: "ui", event: { t: "session", session: created } });
				setProject(created.cwd);
				dispatch({ type: "select", id: created.id });
				setView("home");
			}),
		onToggle: (automation: Automation, enabled: boolean) =>
			guard(async () => {
				await api.updateAutomation(automation.id, { enabled });
			}),
		onDelete: (id: string) =>
			guard(async () => {
				await api.deleteAutomation(id);
			}),
	};

	const messages = session ? (state.messages[session.id] ?? []) : [];
	const turn = session ? (state.turn[session.id] ?? []) : [];
	const planText = planSegment([...messages, ...turn]);
	const browser = session ? browserShots([...messages, ...turn]) : [];
	const terminal = session
		? terminalEntries([...messages, ...turn], state.tools[session.id] ?? {}, state.policies[session.id] ?? [])
		: [];
	const sessionChangedFiles = session ? changedFiles([...messages, ...turn], state.tools[session.id] ?? {}) : [];
	const showRail = Boolean(session) && rightOpen;

	return (
		<div className="app" style={{ "--rail-w": `${railWidth}px` } as React.CSSProperties}>
			{sidebarOpen ? <div className="scrim" onClick={() => setSidebarOpen(false)} /> : null}
			<Sidebar
				open={sidebarOpen}
				collapsed={sidebarCollapsed}
				activeView={session ? "home" : view}
				sessions={state.sessions}
				activeId={activeId}
				project={project}
				projects={projects}
				automations={state.automations}
				boot={state.boot}
				session={session}
				state={session ? state.states[session.id] : undefined}
				onNew={startNew}
				onSearch={() => setPaletteOpen(true)}
				onSelectProject={selectProject}
				onAddProject={addProject}
				onRemoveProject={removeProject}
				onSelectSession={openSession}
				onDeleteSession={id =>
					guard(async () => {
						await api.deleteSession(id);
					})
				}
				onOpenAutomations={openAutomations}
				onCollapse={() => setLeftPanel(false)}
				onModel={(provider, id) =>
					guard(async () => {
						if (session) await api.setModel(session.id, provider, id);
					})
				}
				onThinking={level =>
					guard(async () => {
						if (session) await api.setThinking(session.id, level);
					})
				}
			/>

			<main className="chat">
				<Topbar
					session={session}
					rightOpen={showRail}
					onToggleRight={() => setRightPanel(!rightOpen)}
					onToggleSidebar={() => setSidebarOpen(open => !open)}
					leftCollapsed={sidebarCollapsed}
					onExpandLeft={() => setLeftPanel(true)}
					onResume={() =>
						guard(async () => {
							if (session) await api.resumeSession(session.id);
						})
					}
					onIde={() =>
						guard(async () => {
							if (!session) return;
							const opened = await api.openIde(session.cwd);
							if (!opened.ok) {
								setError(t(opened.reason ?? "本机没有 VS Code 或 Cursor"));
								return;
							}
							setInfo(t("已打开本机 VS Code"));
						})
					}
					onRefresh={() =>
						guard(async () => {
							if (!session) return;
							const [{ messages: fresh }, { state: sessionState }] = await Promise.all([
								api.messages(session.id),
								api.state(session.id),
							]);
							dispatch({ type: "ui", event: { t: "messages", sessionId: session.id, messages: fresh } });
							dispatch({ type: "ui", event: { t: "state", sessionId: session.id, state: sessionState } });
						})
					}
				/>

				{session ? (
					<>
						<Transcript
							messages={messages}
							turn={turn}
							live={state.live[session.id] ?? null}
							pending={state.pending[session.id] ?? []}
							outputs={state.outputs[session.id] ?? []}
							tools={state.tools[session.id] ?? {}}
							state={state.states[session.id]}
							sessionAlive={session.alive}
							hasHistory={Boolean(session.sessionFile)}
							canRewind={
								session.alive &&
								state.states[session.id]?.streaming !== true &&
								state.states[session.id]?.compacting !== true
							}
							onRewind={rewindTo}
						/>
						<Composer
							phase={session.phase}
							state={state.states[session.id]}
							disabled={!session.alive}
							resuming={resuming === session.id}
							draft={draft}
							onDraftBlocked={text =>
								setInfo(t("输入框里还有没发出去的文字，没有覆盖它。原文：{text}", { text }))
							}
							onResume={() =>
								guard(async () => {
									await api.resumeSession(session.id);
								})
							}
							textAreaRef={composerRef}
							onPhase={phase => void setPhaseOnly(phase)}
							onSend={(text, images) =>
								guard(async () => {
									const compact = parseCompactInvocation(text);
									if (compact && "error" in compact) throw new Error(t(compact.error));
									if (compact && images.length > 0) throw new Error(t("压缩不接收图片"));
									if (compact && !compact.mode) {
										setInfo(compactNotice(await api.compact(session.id, compact.instructions)));
										return;
									}
									if (compact?.mode) {
										// soft / remote / snapcompact / handoff only exist as the slash command.
										await api.prompt(session.id, text);
										return;
									}
									const result = await api.prompt(session.id, text, images);
									dispatch({ type: "local_user", sessionId: session.id, text, images });
									if (result.queued) setInfo(t("这一轮还在跑，已排队，等它结束再发送。"));
								})
							}
							onCompact={() =>
								guard(async () => {
									setInfo(compactNotice(await api.compact(session.id)));
								})
							}
							onAbort={() =>
								guard(async () => {
									await api.abort(session.id);
								})
							}
						/>
						<RawLog sessionId={session.id} />
						<DialogLayer
							requests={state.dialogs[session.id] ?? []}
							onAnswer={(dialogId, answer: DialogAnswer) =>
								guard(async () => {
									await api.answerDialog(session.id, dialogId, answer);
								})
							}
						/>
					</>
				) : view === "automations" ? (
					<Automations automations={state.automations} projects={projects} {...automationHandlers} />
				) : (
					<Home
						key={homeEpoch}
						project={project}
						projects={projects}
						busy={sending}
						onSend={(text, images, phase) => guard(() => sendFromHome(text, images, phase))}
						onPickProject={addProject}
					/>
				)}

				<div className="toasts">
					{error ? (
						<div className="toast error" onClick={() => setError(null)}>
							{error}
						</div>
					) : null}
					{info ? (
						<div className="toast info" onClick={() => setInfo(null)}>
							{info}
						</div>
					) : null}
					{state.notices.slice(-3).map(notice => (
						<div
							key={notice.key}
							className={`toast ${notice.level}`}
							onClick={() => dispatch({ type: "dismiss", key: notice.key })}
						>
							{notice.text}
						</div>
					))}
				</div>
			</main>

			{showRail && session ? (
				<div className="splitter" role="separator" onPointerDown={startRailResize} />
			) : null}

			{showRail && session ? (
				<RightRail
					cwd={session.cwd}
					platform={state.boot?.platform ?? ""}
					phase={session.phase}
					todos={state.states[session.id]?.todos ?? []}
					segment={planText}
					terminal={terminal}
					browser={browser}
					changedFiles={sessionChangedFiles}
					canApprove={session.alive && session.phase === "plan" && planText.some(m => m.role === "assistant")}
					tab={rightTab}
					onTab={setRightTab}
					onApprove={() => void approvePlan()}
					onRevise={revisePlan}
					onClose={() => setRightPanel(false)}
				/>
			) : null}

			<Palette
				open={paletteOpen}
				items={paletteItems}
				onClose={() => setPaletteOpen(false)}
				onPick={onPalettePick}
			/>

		</div>
	);
}
