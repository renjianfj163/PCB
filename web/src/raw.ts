import { useSyncExternalStore } from "react";

/**
 * "Show omp raw output" is an engineering switch, not a feature: off is the
 * shipping state, and off must cost nothing — no stream, no buffer, no rows.
 *
 * A module-level store like the locale one, so the sidebar toggle and the
 * transcript column read the same value without prop plumbing.
 */
const KEY = "pcb.ompRaw";

/** Typed loosely on purpose: this module is also type-checked without the DOM lib. */
interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

function storage(): StorageLike | undefined {
	return (globalThis as { localStorage?: StorageLike }).localStorage;
}

function read(): boolean {
	try {
		return storage()?.getItem(KEY) === "1";
	} catch {
		return false;
	}
}

let current: boolean = read();
const listeners = new Set<() => void>();

export function getOmpRaw(): boolean {
	return current;
}

export function setOmpRaw(on: boolean): void {
	if (on === current) return;
	current = on;
	try {
		storage()?.setItem(KEY, on ? "1" : "0");
	} catch {
		// private mode: the switch just lasts for this tab
	}
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useOmpRaw(): boolean {
	return useSyncExternalStore(subscribe, getOmpRaw, getOmpRaw);
}
