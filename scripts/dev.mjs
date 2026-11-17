// Dev runner: server (Node with type stripping, --watch) + Vite dev server.
import { spawn } from "node:child_process";

const children = [];

const run = (command, args, cwd) => {
	const child = spawn(command, args, { stdio: "inherit", cwd, shell: process.platform === "win32" });
	children.push(child);
	child.on("exit", code => {
		if (code !== 0 && code !== null) stop(code);
	});
	return child;
};

const stop = code => {
	for (const child of children) {
		if (!child.killed) child.kill();
	}
	process.exit(code);
};

run(process.execPath, ["--watch", "server/main.ts"], process.cwd());
run("npm", ["run", "dev"], "web");

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
