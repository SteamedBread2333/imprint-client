import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = process.platform === "win32" ? ".exe" : "";

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./desk.e2e.ts"],
  maxInstances: 1,
  services: [[
    "@wdio/tauri-service",
    {
      driverProvider: "embedded",
      appBinaryPath: path.join(root, "src-tauri", "target", "debug", `imprint-client${extension}`),
      embeddedPort: 4445,
      startTimeout: 90_000,
      captureBackendLogs: true,
      captureFrontendLogs: true,
    },
  ]],
  capabilities: [{
    browserName: "tauri",
    "tauri:options": {
      application: path.join(root, "src-tauri", "target", "debug", `imprint-client${extension}`),
    },
  }],
  logLevel: "info",
  waitforTimeout: 12_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 90_000,
  },
};
