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

/**
 * Provider ids the auth catalog knows and reports as logged out.
 *
 * A provider the catalog does not list at all is not "logged out": its key can
 * come from the environment (google/gemini via GEMINI_API_KEY) or from
 * models.yml, and omp already omits such providers from get_available_models
 * when it cannot use them.
 */
export function loggedOutProviders<T extends ProviderAuth>(auth: readonly T[] | undefined): Set<string> {
	const seen = new Map<string, boolean>();
	for (const item of auth ?? []) {
		const usable = item.authenticated && !isSignInProvider(item);
		seen.set(item.provider, (seen.get(item.provider) ?? false) || usable);
	}
	const out = new Set<string>();
	for (const [provider, usable] of seen) if (!usable) out.add(provider);
	return out;
}

/** Models omp offers, minus those whose provider the auth catalog reports as logged out. */
export function selectableModels<T extends { provider: string }>(
	models: readonly T[],
	auth: readonly ProviderAuth[] | undefined,
): T[] {
	const blocked = loggedOutProviders(auth);
	return models.filter(model => !blocked.has(model.provider));
}
