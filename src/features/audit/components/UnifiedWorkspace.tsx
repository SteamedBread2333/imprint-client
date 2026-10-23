import { useMemo, useState } from "react";
import { Group, MultiSelect, SegmentedControl, Stack } from "@mantine/core";
import type { Messages } from "../../../i18n";
import type { UnifiedGraph } from "../domain/contracts";
import { allScopes } from "../domain/filters";
import { graphFromUnified, localSlice, pickForGraph } from "../domain/graph-model";
import { CountText, EdgeToggles, FitButton, GraphCanvas, LabelControl, SearchField } from "./GraphChrome";

const UNIFIED_EDGES = ["related", "supersedes", "conflicts_with", "sources", "cited_by", "contains", "directory", "sequence"];

export function UnifiedWorkspace({
  unified,
  query,
  scopes,
  onQuery,
  onScopes,
  selectedId,
  onSelect,
  labels,
  onLabels,
  fitToken,
  onFit,
  m,
}: {
  unified: UnifiedGraph;
  query: string;
  scopes: string[];
  onQuery: (query: string) => void;
  onScopes: (scopes: string[]) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  labels: "off" | "on" | "auto";
  onLabels: (mode: "off" | "on" | "auto") => void;
  fitToken: number;
  onFit: () => void;
  m: Messages;
}) {
  const [nodeType, setNodeType] = useState<"all" | "rules" | "docs">("all");
  const [edgeKinds, setEdgeKinds] = useState(() => new Set(UNIFIED_EDGES));
  const data = useMemo(() => graphFromUnified(unified), [unified]);
  const availableScopes = useMemo(() => allScopes(data.nodes), [data.nodes]);
  const nodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.nodes.filter((node) => {
      const isRule = !node._kind || node._kind === "rule";
      if (nodeType === "rules" && !isRule) return false;
      if (nodeType === "docs" && isRule) return false;
      if (isRule && scopes.length && !scopes.every((scope) => node.scope.includes(scope))) return false;
      if (q && !`${node.id} ${node.claim} ${node.path ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data.nodes, nodeType, query, scopes]);
  const sliced = useMemo(() => localSlice(data, nodes, edgeKinds), [data, edgeKinds, nodes]);
  const graphNodes = useMemo(() => pickForGraph(data, sliced), [data, sliced]);
  const nearby = Math.max(0, sliced.length - nodes.length);
  const selected = data.nodes.find((node) => node.id === selectedId) ?? null;
  const toggleEdge = (kind: string, checked: boolean) => {
    setEdgeKinds((current) => {
      const next = new Set(current);
      if (checked) next.add(kind);
      else next.delete(kind);
      return next;
    });
  };

  return (
    <Stack gap="xs" className="audit-workspace" data-testid="unified-workspace">
      <Group gap="xs" wrap="wrap" align="center" className="audit-toolbar">
        <SearchField value={query} placeholder={m.auditSearch} onChange={onQuery} />
        <SegmentedControl
          value={nodeType}
          onChange={(value) => setNodeType(value as typeof nodeType)}
          data={[
            { value: "all", label: m.nodesAll },
            { value: "rules", label: m.nodesRules },
            { value: "docs", label: m.nodesDocs },
          ]}
        />
        <MultiSelect
          aria-label={m.auditScopes}
          placeholder={m.auditScopes}
          searchable
          clearable
          data={availableScopes}
          value={scopes}
          onChange={onScopes}
          w={220}
        />
        <EdgeToggles kinds={["related", "supersedes", "conflicts_with", "sources", "cited_by"]} enabled={edgeKinds} onToggle={toggleEdge} m={m} />
        <LabelControl value={labels} onChange={onLabels} m={m} />
        <FitButton onClick={onFit} m={m} />
        <CountText>{`${nodes.length} ${m.rules}${nearby ? ` · +${nearby} ${m.auditNearby}` : ""}${graphNodes.truncated ? ` · ${graphNodes.truncated}` : ""}`}</CountText>
      </Group>
      <GraphCanvas
        data={data}
        nodes={graphNodes.nodes}
        enabledKinds={edgeKinds}
        selectedId={selectedId}
        labels={labels}
        onSelect={onSelect}
        fitToken={fitToken}
        m={m}
        detail={selected}
      />
    </Stack>
  );
}
