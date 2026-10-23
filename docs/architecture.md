# Architecture

Imprint Console is a Tauri application with four explicit boundaries:

- `src/features/ops` owns operational Host, Shelves, and Embed controls.
- `src/features/audit` owns the read-only Rules, Documents, and Unified workspaces.
- `src/platform/tauri` is the frontend boundary for native commands.
- `src-tauri/src/commands` and `src-tauri/src/services` separate IPC validation from Host HTTP access.

## Audit data flow

The React audit feature sends a typed `DeskRequest` through Tauri IPC. The Rust gateway derives the Host origin from the selected project's configuration, requires a loopback HTTP address, maps each request variant to an allowlisted endpoint, URL-encodes identifiers, and applies a request timeout. The frontend cannot provide an arbitrary URL, path, or HTTP method.

Rules and unified graphs are validated at the frontend boundary before entering feature state. Documents are rendered through a sanitized Markdown pipeline. D3 and Mermaid execute only inside isolated components whose effects clean up their simulations and generated content.

Audit uses a vault-keyed IndexedDB cache for read-only offline fallback. Switching projects unmounts the feature and prevents data from one vault from being displayed for another.

## Runtime boundary

Console talks directly to the local imprint Host. The application does not run a Desk Node/Express process, reserve port 4173, or require the adjacent Desk repository.

The production webview uses a restrictive content security policy and system fonts. WebdriverIO plugins are optional Cargo dependencies compiled and registered only for debug builds with the `e2e` feature.
