import type { RuleFilters } from "./filters";

export type AuditMode = "rules" | "docs" | "unified";
export type AuditView = "list" | "graph";

export type AuditUrlState = {
  mode: AuditMode;
  filters: RuleFilters;
  view: AuditView;
  selectedId: string;
  docQuery: string;
  labelMode: "off" | "on" | "auto";
};

export const defaultAuditUrlState: AuditUrlState = {
  mode: "rules",
  filters: { query: "", status: "", minConfidence: 0, scopes: [] },
  view: "graph",
  selectedId: "",
  docQuery: "",
  labelMode: "auto",
};

export function parseAuditUrl(search: string): AuditUrlState {
  const params = new URLSearchParams(search);
  const mode = params.get("audit");
  const view = params.get("view");
  const labels = params.get("labels");
  const confidence = Number(params.get("conf") ?? 0);
  return {
    mode: mode === "docs" || mode === "unified" ? mode : "rules",
    filters: {
      query: params.get("q") ?? "",
      status: params.get("status") ?? "",
      minConfidence: Number.isFinite(confidence) ? confidence : 0,
      scopes: (params.get("scope") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    },
    view: view === "list" ? "list" : "graph",
    selectedId: params.get("id") ?? "",
    docQuery: params.get("docQ") ?? "",
    labelMode: labels === "off" || labels === "on" ? labels : "auto",
  };
}

export function serializeAuditUrl(state: AuditUrlState): string {
  const params = new URLSearchParams();
  if (state.mode !== "rules") params.set("audit", state.mode);
  if (state.filters.query) params.set("q", state.filters.query);
  if (state.filters.status) params.set("status", state.filters.status);
  if (state.filters.minConfidence > 0) params.set("conf", String(state.filters.minConfidence));
  if (state.filters.scopes.length) params.set("scope", state.filters.scopes.join(","));
  if (state.view !== "graph") params.set("view", state.view);
  if (state.selectedId) params.set("id", state.selectedId);
  if (state.docQuery) params.set("docQ", state.docQuery);
  if (state.labelMode !== "auto") params.set("labels", state.labelMode);
  const value = params.toString();
  return value ? `?${value}` : "";
}
