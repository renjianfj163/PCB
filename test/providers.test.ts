import assert from "node:assert/strict";
import { test } from "node:test";
import { isSignInProvider, loggedInProviders, loggedOutProviders, selectableModels } from "../shared/providers.ts";

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

test("a provider absent from the login catalog is still selectable", () => {
	const models = [
		{ provider: "google", id: "gemini-3.8-flash" },
		{ provider: "openai", id: "gpt-5" },
	];
	const auth = [{ provider: "openai", name: "OpenAI", authenticated: false }];
	assert.deepEqual(
		selectableModels(models, auth).map(model => model.id),
		["gemini-3.8-flash"],
	);
});

test("one logged-in row keeps a provider selectable", () => {
	const models = [{ provider: "zai", id: "glm-5" }];
	const auth = [
		{ provider: "zai", name: "Z.AI (GLM Coding Plan)", authenticated: false },
		{ provider: "zai", name: "Z.AI (GLM Coding Plan)", authenticated: true },
	];
	assert.deepEqual(selectableModels(models, auth).map(model => model.id), ["glm-5"]);
});

test("a sign-in row alone does not make a provider selectable", () => {
	const auth = [{ provider: "zai-coding-plan", name: "Z.AI (GLM Coding Plan · Sign in)", authenticated: true }];
	assert.deepEqual([...loggedOutProviders(auth)], ["zai-coding-plan"]);
	assert.deepEqual(selectableModels([{ provider: "zai-coding-plan", id: "glm-5" }], auth), []);
});

test("a missing catalog filters nothing", () => {
	const models = [{ provider: "google", id: "gemini-3.8-flash" }];
	assert.deepEqual(selectableModels(models, undefined), models);
	assert.deepEqual(selectableModels(models, []), models);
});
