import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			"/api": {
				target: "http://127.0.0.1:7777",
				changeOrigin: false,
			},
		},
		fs: {
			// shared/protocol.ts lives one level above the Vite root.
			allow: [".."],
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
});
