import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { App } from "./app.ts";
import { Hub } from "./hub.ts";
import { Store } from "./store.ts";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PCB_PORT ?? 7777);
const host = process.env.PCB_HOST ?? "127.0.0.1";
const bin = process.env.PCB_OMP ?? "omp";

const log = (message: string) => console.log(message);

const hub = new Hub();
const store = new Store();
const app = new App({
	hub,
	store,
	bin,
	webRoot: join(here, "..", "web", "dist"),
	onLog: log,
});

const server = createServer((request, response) => {
	void app.handle(request, response);
});

server.listen(port, host, () => {
	log(`PCB 已启动：http://${host}:${port}`);
});

app.startScheduler();

let closing = false;
const shutdown = async (signal: string) => {
	if (closing) return;
	closing = true;
	log(`\n收到 ${signal}，正在关闭…`);
	await app.close();
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 3_000).unref();
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
