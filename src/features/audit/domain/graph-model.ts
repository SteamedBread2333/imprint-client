import type { GraphData, GraphEdge, GraphNode, UnifiedGraph } from "./contracts";

export const MAX_GRAPH_NODES = 300;

export function graphFromUnified(unified: UnifiedGraph): GraphData {
  return {
    generated_at: unified.generated_at,
    nodes: unified.nodes.map((node) => {
      if (node.kind === "rule") {
        return {
          id: node.id,
          claim: node.claim ?? node.label ?? node.id,
          scope: node.scope ?? [],
          confidence: node.confidence ?? 0,
          status: node.status ?? "active",
          reinforcement_count: node.reinforcement_count ?? 0,
          supersedes: node.supersedes ?? [],
          related: node.related ?? [],
          conflicts_with: node.conflicts_with ?? [],
          evidence_log: node.evidence_log ?? [],
          query_local: node.query_local ?? "",
          referenced_by: node.referenced_by ?? [],
          updated_at: node.updated_at,
          _kind: "rule",
        };
      }
      return {
        id: node.id,
        claim: node.label ?? node.heading ?? node.path ?? node.id,
        scope: ["doc"],
        confidence: 0.5,
        status: "active",
        reinforcement_count: 0,
        supersedes: [],
        related: [],
        conflicts_with: [],
        evidence_log: [],
        query_local: "",
        referenced_by: [],
        _kind: node.kind,
        path: node.path,
        heading: node.heading,
      };
    }),
    edges: unified.edges,
  };
}

export function pickForGraph(
  data: GraphData,
  nodes: GraphNode[],
  limit = MAX_GRAPH_NODES,
): { nodes: GraphNode[]; truncated: number } {
  if (nodes.length <= limit) return { nodes, truncated: 0 };
  const connected = new Set<string>();
  for (const edge of data.edges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }
  const withEdges = nodes.filter((node) => connected.has(node.id));
  const rest = nodes
    .filter((node) => !connected.has(node.id))
    .sort((a, b) => b.confidence - a.confidence);
  const kept = [...withEdges, ...rest].slice(0, limit);
  return { nodes: kept, truncated: nodes.length - kept.length };
}

export function localSlice(
  data: GraphData,
  nodes: GraphNode[],
  enabledKinds: Set<string>,
): GraphNode[] {
  const ids = new Set(nodes.map((node) => node.id));
  for (const edge of data.edges) {
    if (!enabledKinds.has(edge.kind)) continue;
    if (ids.has(edge.source)) ids.add(edge.target);
    if (ids.has(edge.target)) ids.add(edge.source);
  }
  return data.nodes.filter((node) => ids.has(node.id));
}

export function graphStructureKey(
  nodes: GraphNode[],
  edges: GraphEdge[],
  enabledKinds: ReadonlySet<string>,
  labels: string,
): string {
  const kinds = [...enabledKinds].sort().join(",");
  const nodePart = nodes
    .map((node) => `${node.id}\u001f${node._kind ?? ""}\u001f${node.claim}\u001f${node.scope[0] ?? ""}`)
    .sort()
    .join("\u001e");
  const edgePart = edges
    .filter((edge) => enabledKinds.has(edge.kind))
    .map((edge) => `${edge.kind}\u001f${edge.source}\u001f${edge.target}`)
    .sort()
    .join("\u001e");
  return `${labels}\u001d${kinds}\u001d${nodePart}\u001d${edgePart}`;
}

export function nodeRadius(node: { confidence?: number; _kind?: string }, focused: boolean): number {
  if (node._kind && node._kind !== "rule") return 5 + (focused ? 4 : 0);
  return 7 + Math.round((node.confidence || 0) * 10) + (focused ? 6 : 0);
}

export function edgeStyle(kind: string): { color: string; dashed: boolean } {
  switch (kind) {
    case "supersedes":
      return { color: "#ffd43b", dashed: false };
    case "conflicts_with":
      return { color: "#f06595", dashed: false };
    case "sources":
      return { color: "#6ec4c0", dashed: false };
    case "cited_by":
      return { color: "#c4b5fd", dashed: true };
    case "related":
      return { color: "#d4b483", dashed: true };
    default:
      return { color: "#868e96", dashed: true };
  }
}

export function graphFit(
  nodes: Array<{ x?: number; y?: number; r?: number }>,
  viewWidth: number,
  viewHeight: number,
  labelPad = 0,
): { cx: number; cy: number; k: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let counted = 0;
  for (const node of nodes) {
    if (node.x == null || node.y == null || !Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
    counted += 1;
    const pad = (node.r ?? 10) + 28;
    minX = Math.min(minX, node.x - pad);
    maxX = Math.max(maxX, node.x + pad + labelPad);
    minY = Math.min(minY, node.y - pad);
    maxY = Math.max(maxY, node.y + pad);
  }
  if (!counted || viewWidth < 1 || viewHeight < 1 || !Number.isFinite(minX)) {
    return { cx: viewWidth / 2, cy: viewHeight / 2, k: 1 };
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const boundsWidth = Math.max(maxX - minX, 1);
  const boundsHeight = Math.max(maxY - minY, 1);
  const fitK = Math.min(viewWidth / boundsWidth, viewHeight / boundsHeight) * 0.92;
  const maxK = counted <= 8 ? 1.6 : 2.2;
  const k = Math.min(maxK, fitK);
  return { cx, cy, k: k > 0 ? k : 1 };
}

export function clampDetailWidth(requested: number, frameWidth: number, windowWidth: number): number {
  const max = Math.min(windowWidth / 3, Math.max(180, frameWidth - 320));
  const min = Math.min(220, max);
  return Math.min(max, Math.max(min, requested));
}

export function scopeColor(scope: string): string {
  if (scope === "doc") return "#6ec4c0";
  const palette = ["#9b5de5", "#f15bb5", "#e0a04a", "#c4a574", "#f8961e", "#86c56a"];
  let hash = 2166136261;
  for (const char of scope || "untagged") {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return palette[Math.abs(hash) % palette.length];
}
