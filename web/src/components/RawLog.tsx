import { useEffect, useRef, useState } from "react";
import type { RawEvent } from "../../../shared/protocol.ts";
import { api } from "../api.ts";
import { t } from "../i18n.ts";
import { useOmpRaw } from "../raw.ts";

const LIMIT = 1000;

function clock(at: number): string {
	const date = new Date(at);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * The child process's own output, line by line, for the session on screen.
 *
 * Dev-only: it mounts only with the switch on, opens its own stream, and keeps
 * nothing when unmounted. The protocol text is what omp wrote, not a rendering.
 */
export function RawLog({ sessionId }: { sessionId: string }) {
	const on = useOmpRaw();
	const [lines, setLines] = useState<RawEvent[]>([]);
	const box = useRef<HTMLDivElement | null>(null);
	/** True while the view follows the tail; only scrolling *up* turns it off. */
	const stick = useRef(true);
	const lastTop = useRef(0);

	useEffect(() => {
		if (!on) {
			setLines([]);
			return;
		}
		const source = new EventSource(`/api/raw?session=${encodeURIComponent(sessionId)}`);
		source.onmessage = event => {
			let frame: RawEvent;
			try {
				frame = JSON.parse(event.data as string) as RawEvent;
			} catch {
				return;
			}
			if (frame.t !== "raw" || frame.sessionId !== sessionId) return;
			setLines(previous => {
				const next = [...previous, frame];
				return next.length > LIMIT ? next.slice(next.length - LIMIT) : next;
			});
		};
		return () => source.close();
	}, [on, sessionId]);

	useEffect(() => {
		const node = box.current;
		if (node && stick.current) node.scrollTop = node.scrollHeight;
	}, [lines]);

	const clear = async () => {
		setLines([]);
		stick.current = true;
		// Clearing the view is not enough: the server buffer for this session goes too.
		await api.clearRaw(sessionId).catch(() => null);
	};

	const onScroll = () => {
		const node = box.current;
		if (!node) return;
		// Content growing pushes the bottom away without the user touching anything:
		// only an upward move counts as "I want to read here".
		const movedUp = node.scrollTop < lastTop.current - 1;
		lastTop.current = node.scrollTop;
		if (movedUp) stick.current = false;
		else if (node.scrollHeight - node.scrollTop - node.clientHeight < 24) stick.current = true;
	};

	if (!on) return null;
	return (
		<section className="raw-log" aria-label={t("原文")}>
			<div className="raw-head">
				<span>{t("原文")}</span>
				<button type="button" className="raw-clear" onClick={() => void clear()}>
					{t("清空")}
				</button>
			</div>
			<div className="raw-lines" ref={box} onScroll={onScroll}>
				{lines.map((line, index) => (
					<div className="raw-line" key={`${line.at}-${index}`}>
						<span className="raw-time">{clock(line.at)}</span>
						<span className={`raw-stream ${line.stream}`}>{line.stream}</span>
						<span className="raw-text">{line.line}</span>
					</div>
				))}
			</div>
		</section>
	);
}
