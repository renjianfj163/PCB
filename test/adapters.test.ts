import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentMessage } from "../shared/protocol.ts";
import {
	imageSources,
	planSegment,
	promptImageSrc,
	relativeTo,
	terminalEntries,
	toolCallsOf,
	userText,
} from "../web/src/adapters.ts";

function user(marker: string, text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text: `${marker}\n${text}` }] };
}

function assistant(content: Array<Record<string, unknown>>): AgentMessage {
	return { role: "assistant", content };
}

function text(value: string) {
	return { type: "text", text: value };
}

function call(id: string, name: string, args: unknown) {
	return { type: "toolCall", id, name, arguments: args };
}

function result(id: string, name: string, value: string, isError = false, timestamp = 0): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName: name,
		isError,
		timestamp,
		content: [{ type: "text", text: value }],
	};
}

const PLAN = "「阶段：规划」";
const BUILD = "「阶段：执行」";

test("tool calls and user text survive the phase marker", () => {
	assert.equal(userText(user(PLAN, "看一下这个项目")), "看一下这个项目");
	const calls = toolCallsOf([assistant([call("a", "bash", { command: "ls" })])]);
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.name, "bash");
});

test("the plan segment is the last planning stretch, not the last turn", () => {
	const messages = [
		user(PLAN, "第一版计划"),
		assistant([text("第一版回答")]),
		user(BUILD, "开始做"),
		assistant([call("t1", "write", { path: "a.txt" })]),
	];
	const segment = planSegment(messages);
	assert.equal(segment.length, 2, "a following build turn must not be included");
	assert.equal(userText(segment[0]!), "第一版计划");
});

test("consecutive planning turns stay together", () => {
	const messages = [
		user(BUILD, "先执行"),
		user(PLAN, "再规划一版"),
		assistant([text("计划 A")]),
		user(PLAN, "补充一下"),
		assistant([text("计划 B")]),
	];
	const segment = planSegment(messages);
	assert.equal(segment.length, 4);
	assert.equal(userText(segment[0]!), "再规划一版");
	assert.equal(userText(segment[2]!), "补充一下");
});

test("with no planning turn the segment is empty", () => {
	const messages = [user(BUILD, "做"), assistant([text("好")])];
	assert.deepEqual(planSegment(messages), []);
});

test("tool paths are normalised whether absolute or relative", () => {
	assert.equal(relativeTo("D:\\work\\proj", "hello.txt"), "hello.txt");
	assert.equal(relativeTo("D:\\work\\proj", "docs\\a.md"), "docs/a.md");
	assert.equal(relativeTo("D:\\work\\proj", "D:\\work\\proj\\src\\a.ts"), "src/a.ts");
	assert.equal(relativeTo("D:\\work\\proj", "d:\\WORK\\proj\\src\\a.ts"), "src/a.ts");
	assert.equal(relativeTo("D:\\work\\proj", "D:\\other\\a.ts"), null);
	assert.equal(relativeTo("D:\\work\\proj", "/etc/passwd"), null);
});

test("terminal entries keep call order and attach the decision to the right command", () => {
	const messages = [
		assistant([call("c1", "bash", { command: "echo one" })]),
		result("c1", "bash", "one\n", false, 1_000),
		assistant([call("c2", "bash", { command: "echo two" })]),
		result("c2", "bash", "denied by policy", true, 2_000),
		assistant([call("c3", "read", { path: "a.txt" })]),
		result("c3", "read", "contents", false, 3_000),
	];
	const entries = terminalEntries(messages, {}, [
		{ tool: "bash", decision: "approval_required" },
		{ tool: "bash", decision: "approved" },
		{ tool: "bash", decision: "denied" },
	]);

	assert.equal(entries.length, 2, "only bash calls are terminal entries");
	assert.deepEqual(
		entries.map(entry => entry.command),
		["echo one", "echo two"],
	);
	assert.equal(entries[0]?.policy, "approved");
	assert.equal(entries[0]?.status, "ok");
	assert.equal(entries[0]?.at, 1_000);
	assert.equal(entries[1]?.policy, "denied");
	assert.equal(entries[1]?.status, "error");
});

test("a live tool activity overrides the snapshot status", () => {
	const messages = [assistant([call("c1", "bash", { command: "sleep 5" })])];
	const entries = terminalEntries(messages, { c1: { name: "bash", args: {}, output: "", status: "running" } }, []);
	assert.equal(entries[0]?.status, "running");
	assert.equal(entries[0]?.policy, undefined);
});

test("a user picture becomes an image source beside its text", () => {
	const message: AgentMessage = {
		role: "user",
		content: [
			{ type: "text", text: `${PLAN}\n这是什么` },
			{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
		],
	};
	assert.deepEqual(imageSources(message), ["data:image/png;base64,iVBORw0KGgo="]);
	assert.equal(userText(message), "这是什么");
});

test("a persisted blob reference is read through the shell route", () => {
	const ref = `blob:sha256:${"a".repeat(64)}`;
	const message: AgentMessage = { role: "user", content: [{ type: "image", data: ref }] };
	assert.deepEqual(imageSources(message), [`/api/blob?ref=${encodeURIComponent(ref)}`]);
});

test("a shell picture renders from its own base64", () => {
	assert.equal(promptImageSrc({ mimeType: "image/jpeg", data: "AAAA" }), "data:image/jpeg;base64,AAAA");
});
