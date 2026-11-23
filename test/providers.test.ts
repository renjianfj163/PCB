import assert from "node:assert/strict";
import { test } from "node:test";
import { isSignInProvider, loggedInProviders } from "../shared/providers.ts";

test("a sign-in catalog row is not a logged-in model", () => {
	const auth = [
		{ provider: "zai", name: "Z.AI (GLM Coding Plan)", authenticated: true },
		{ provider: "zai-login", name: "Z.AI (GLM Coding Plan · Sign in)", authenticated: true },
		{ provider: "deepseek", name: "DeepSeek", authenticated: true },
		{ provider: "openai", name: "OpenAI", authenticated: false },
		{ provider: "local", name: "本地模型 · 登录", authenticated: true },
	];
	assert.equal(isSignInProvider(auth[1]!), true);
	assert.equal(isSignInProvider(auth[4]!), true);
	assert.deepEqual(
		loggedInProviders(auth).map(item => item.name),
		["Z.AI (GLM Coding Plan)", "DeepSeek"],
	);
});

test("an empty catalog is logged out", () => {
	assert.deepEqual(loggedInProviders(undefined), []);
	assert.deepEqual(loggedInProviders([]), []);
});
