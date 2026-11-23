/**
 * Which omp catalog rows count as "a model is logged in".
 *
 * omp lists a sign-in action as its own provider — "Z.AI (GLM Coding Plan · Sign in)" —
 * and may mark that row authenticated. It is the button, not a logged-in model.
 */

export interface ProviderAuth {
	provider: string;
	name: string;
	authenticated: boolean;
}

export function isSignInProvider(item: { name?: string; provider?: string }): boolean {
	const label = `${item.name ?? ""} ${item.provider ?? ""}`;
	return /sign[\s-]*in/i.test(label) || /登[录錄入]/.test(label);
}

export function loggedInProviders<T extends ProviderAuth>(auth: readonly T[] | undefined): T[] {
	return (auth ?? []).filter(item => item.authenticated && !isSignInProvider(item));
}
