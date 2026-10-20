import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

export interface AppConfig {
  projectRoot: string;
  imprintBin: string;
  pollIntervalMs: number;
  hfEndpoint: string;
  imprintHfEndpoint: string;
  locale?: string;
}

export interface RuntimeProbe {
  port: number;
  listening: boolean;
  vault?: string;
  rules?: number;
  error?: string;
}

export interface ShelvesStatus {
  enabled: boolean;
  indexed: boolean;
  roots?: string[];
  error?: string;
}

export interface PluginRow {
  id: string;
  enabled: boolean;
  package: string;
  port: number;
  running: boolean;
  healthy: boolean;
  url?: string;
  error?: string;
  name?: string;
  version?: string;
}

export interface EmbedHealthDetail {
  ok: boolean;
  ready: boolean;
  raw?: unknown;
}

export interface Snapshot {
  project: string;
  vault: string;
  hint: string;
  host: RuntimeProbe;
  desk: RuntimeProbe;
  shelves: ShelvesStatus;
  embed: PluginRow;
  embedHealth?: EmbedHealthDetail | null;
  hostUrl: string;
  deskUrl: string;
  sidecarLogPath: string;
  yamlError: string;
}

export type JobOutputHandler = (payload: {
  streamId: string;
  kind: string;
  line: string;
}) => void;

export async function getConfig(): Promise<AppConfig> {
  return invoke("get_config");
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  return invoke("save_app_config", { cfg });
}

export async function pickProjectFolder(): Promise<string | null> {
  return invoke<string | null>("pick_project_folder");
}

export async function openProject(path: string): Promise<{ projectRoot: string }> {
  return invoke("open_project", { path });
}

export interface ComponentStatus {
  name: string;
  installed: boolean;
  path: string;
  version: string;
  latest: string;
  detail: string;
  managedByConsole?: boolean;
}

export interface RuntimeStatus {
  components: ComponentStatus[];
  globalEmbedPath: string;
  ready: boolean;
}

export interface GlobalEmbedDoc {
  enabled: boolean;
  package: string;
  config: Record<string, unknown>;
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  return invoke("get_runtime_status_cmd");
}

export async function ensureRuntime(streamId: string): Promise<void> {
  return invoke("ensure_runtime", { streamId });
}

export async function updateRuntimeComponent(name: string, streamId: string): Promise<void> {
  return invoke("update_runtime_component", { name, streamId });
}

export async function getGlobalEmbed(): Promise<GlobalEmbedDoc> {
  return invoke("get_global_embed_cmd");
}

export async function saveGlobalEmbed(doc: GlobalEmbedDoc): Promise<void> {
  return invoke("save_global_embed_cmd", { doc });
}

export async function getSnapshot(): Promise<Snapshot> {
  return invoke("get_snapshot");
}

export async function checkPrerequisites(): Promise<{
  pythonVersion: string;
  embedPackage: string;
  embedPort: number;
}> {
  return invoke("check_prerequisites");
}

export async function runImprint(streamId: string, args: string[]): Promise<void> {
  return invoke("run_imprint_simple", { streamId, args });
}

export async function runSidecarSetup(streamId: string): Promise<void> {
  return invoke("run_sidecar_setup", { streamId });
}

export async function cancelActiveJob(): Promise<void> {
  return invoke("cancel_active_job");
}

export async function releaseActiveJob(): Promise<boolean> {
  return invoke("release_active_job");
}

export async function startSidecarLogTail(streamId: string): Promise<void> {
  return invoke("start_sidecar_log_tail", { streamId });
}

export async function stopSidecarLogTail(): Promise<void> {
  return invoke("stop_sidecar_log_tail");
}

export async function imprintUpDown(up: boolean): Promise<string> {
  return invoke("imprint_up_down", { up });
}

export async function revealInFinder(path: string): Promise<void> {
  return invoke("reveal_in_finder", { path });
}

export async function openExternalUrl(url: string): Promise<void> {
  await openUrl(url);
}

export function subscribeJobOutput(handler: JobOutputHandler): Promise<() => void> {
  return listen<{ streamId: string; kind: string; line: string }>("job-output", (ev) => {
    handler(ev.payload);
  });
}

export function subscribeJobFinished(handler: (streamId: string) => void): Promise<() => void> {
  return listen<{ streamId: string }>("job-finished", (ev) => {
    handler(ev.payload.streamId);
  });
}
