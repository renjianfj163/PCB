/**
 * One value per conversation. Reading a chat that has never been written
 * returns `empty`, and writing one chat does not change any other.
 */
export interface SessionSlots<T> {
	read(sessionId: string): T;
	write(sessionId: string, value: T): void;
}

export function createSessionSlots<T>(empty: T): SessionSlots<T> {
	const slots = new Map<string, T>();
	return {
		read(sessionId) {
			return slots.get(sessionId) ?? empty;
		},
		write(sessionId, value) {
			slots.set(sessionId, value);
		},
	};
}
