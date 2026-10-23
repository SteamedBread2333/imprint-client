import type { GraphData, GraphNode } from "./contracts";

export type RuleFilters = {
  query: string;
  status: string;
  minConfidence: number;
  scopes: string[];
};

export function isRuleNode(node: GraphNode): boolean {
  return !node._kind || node._kind === "rule";
}

export function ruleMatches(node: GraphNode, filters: RuleFilters): boolean {
  if (!isRuleNode(node)) return false;
  if (filters.status && node.status !== filters.status) return false;
  if (node.confidence < filters.minConfidence) return false;
  if (!filters.scopes.every((scope) => node.scope.includes(scope))) return false;
  const query = filters.query.trim().toLowerCase();
  if (!query) return true;
  const haystack = [
    node.id,
    node.claim,
    node.query_local ?? "",
    ...node.scope,
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

export function filterRules(data: GraphData, filters: RuleFilters): GraphNode[] {
  return data.nodes.filter((node) => ruleMatches(node, filters));
}

export function connectedDocumentIds(
  data: GraphData,
  ruleIds: Iterable<string>,
  enabledKinds: Set<string>,
): Set<string> {
  const seen = new Set(ruleIds);
  const docs = new Set<string>();
  let frontier = new Set(ruleIds);
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  while (frontier.size > 0) {
    const next = new Set<string>();
    for (const edge of data.edges) {
      if (!enabledKinds.has(edge.kind)) continue;
      const pairs: [string, string][] = [
        [edge.source, edge.target],
        [edge.target, edge.source],
      ];
      for (const [from, to] of pairs) {
        if (!frontier.has(from) || seen.has(to)) continue;
        const node = byId.get(to);
        if (node && !isRuleNode(node)) {
          seen.add(to);
          docs.add(to);
          next.add(to);
        }
      }
    }
    frontier = next;
  }
  return docs;
}

export function allScopes(nodes: GraphNode[]): string[] {
  return [...new Set(nodes.flatMap((node) => node.scope))]
    .filter((scope) => scope !== "doc")
    .sort((a, b) => a.localeCompare(b));
}
