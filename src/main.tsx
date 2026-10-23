async function start() {
  if (import.meta.env.DEV || import.meta.env.VITE_WDIO === "true") {
    await import("@wdio/tauri-plugin");
  }
  await import("./bootstrap");
}

void start();
