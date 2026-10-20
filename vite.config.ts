import { createLogger, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

/** Hide Vite “open in browser” URLs — this app is Tauri-only. */
const logger = createLogger();
const logInfo = logger.info.bind(logger);
logger.info = (msg, options) => {
  if (typeof msg === "string" && (msg.includes("Local:") || msg.includes("Network:"))) {
    return;
  }
  logInfo(msg, options);
};

function tauriDevHint() {
  return {
    name: "tauri-dev-hint",
    configureServer(server: { httpServer?: { once: (e: string, fn: () => void) => void } }) {
      server.httpServer?.once("listening", () => {
        logInfo("\n  ➜  Imprint Console: 请使用弹出的 Tauri 桌面窗口（勿在浏览器打开 localhost）。\n");
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tauriDevHint()],
  customLogger: logger,
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    open: false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
