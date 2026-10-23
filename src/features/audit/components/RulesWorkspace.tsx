import { useMemo } from "react";
import { Badge, Card, Group, MultiSelect, ScrollArea, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import type { Messages } from "../../../i18n";
import type { GraphData } from "../domain/contracts";
import { allScopes, filterRules, type RuleFilters } from "../domain/filters";
import { localSlice, pickForGraph } from "../domain/graph-model";
import type { AuditView } from "../domain/url-state";
import { CountText, EdgeToggles, FitButton, GraphCanvas, LabelControl, SearchField } from "./GraphChrome";
import { RuleDetail } from "./RuleDetail";
import { SplitStage } from "./SplitStage";

const RULE_EDGES = ["related", "supersedes", "conflicts_with"];

export function RulesWorkspace({
  data,
  filters,
  onFilters,
  view,
  onView,
  selectedId,
  onSelect,
  labels,
  onLabels,
  edgeKinds,
  onEdgeKinds,
  fitToken,
  onFit,
  m,
}: {
  data: GraphData;
  filters: RuleFilters;
  onFilters: (filters: RuleFilters) => void;
  view: AuditView;
  onView: (view: AuditView) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  labels: "off" | "on" | "auto";
  onLabels: (mode: "off" | "on" | "auto") => void;
  edgeKinds: Set<string>;
  onEdgeKinds: (value: Set<string>) => void;
  fitToken: number;
  onFit: () => void;
  m: Messages;
}) {
  const filtered = useMemo(() => filterRules(data, filters), [data, filters]);
  const sliced = useMemo(
    () => (view === "graph" ? localSlice(data, filtered, edgeKinds) : filtered),
    [data, edgeKinds, filtered, view],
  );
  const graphNodes = useMemo(() => pickForGraph(data, sliced), [data, sliced]);
  const nearby = Math.max(0, sliced.length - filtered.length);
  const selected = data.nodes.find((node) => node.id === selectedId) ?? null;
  const scopes = useMemo(() => allScopes(data.nodes), [data.nodes]);
  const toggleEdge = (kind: string, checked: boolean) => {
    const next = new Set(edgeKinds);
    if (checked) next.add(kind);
    else next.delete(kind);
    onEdgeKinds(next);
  };

  return (
    <Stack gap="xs" className="audit-workspace" data-testid="rules-workspace">
      <Group gap="xs" wrap="wrap" align="center" className="audit-toolbar">
        <SearchField
          value={filters.query}
          placeholder={m.auditSearch}
          onChange={(query) => onFilters({ ...filters, query })}
        />
        <Select
          aria-label={m.auditStatus}
          placeholder={m.auditAnyStatus}
          value={filters.status || null}
          clearable
          data={[
            { value: "active", label: "active" },
            { value: "dormant", label: "dormant" },
            { value: "superseded", label: "superseded" },
          ]}
          onChange={(status) => onFilters({ ...filters, status: status ?? "" })}
          w={148}
        />
        <Select
          aria-label={m.auditConfidence}
          value={String(filters.minConfidence)}
          data={[
            { value: "0", label: m.auditAnyConfidence },
            { value: "0.3", label: "≥ 0.30" },
            { value: "0.6", label: "≥ 0.60" },
            { value: "0.85", label: "≥ 0.85" },
          ]}
          onChange={(value) => onFilters({ ...filters, minConfidence: Number(value ?? 0) })}
          w={148}
        />
        <MultiSelect
          aria-label={m.auditScopes}
          placeholder={m.auditScopes}
          searchable
          clearable
          data={scopes}
          value={filters.scopes}
          onChange={(value) => onFilters({ ...filters, scopes: value })}
          w={220}
        />
        <SegmentedControl
          value={view}
          onChange={(value) => onView(value as AuditView)}
          data={[
            { value: "list", label: m.auditViewList },
            { value: "graph", label: m.auditViewGraph },
          ]}
        />
        {view === "graph" && (
          <>
            <EdgeToggles kinds={RULE_EDGES} enabled={edgeKinds} onToggle={toggleEdge} m={m} />
            <LabelControl value={labels} onChange={onLabels} m={m} />
            <FitButton onClick={onFit} m={m} />
          </>
        )}
        <CountText>
          {`${filtered.length} ${m.rules}${nearby ? ` · +${nearby} ${m.auditNearby}` : ""}${graphNodes.truncated ? ` · ${graphNodes.truncated}` : ""}`}
        </CountText>
      </Group>
      {view === "graph" ? (
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
      ) : (
        <SplitStage
          graph={
            <ScrollArea h="100%">
              <Stack gap={0}>
                {filtered.map((node) => (
                  <Card
                    key={node.id}
                    data-testid={`rule-${node.id}`}
                    padding="sm"
                    radius={0}
                    withBorder={node.id === selectedId}
                    onClick={() => onSelect(node.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Text size="sm" fw={600} lineClamp={2}>{node.claim}</Text>
                      <Badge size="xs" variant="light">{node.confidence.toFixed(2)}</Badge>
                    </Group>
                    <Text size="xs" c="dimmed" ff="monospace">{node.id}</Text>
                  </Card>
                ))}
              </Stack>
            </ScrollArea>
          }
          detail={<RuleDetail node={selected} m={m} onOpen={onSelect} />}
        />
      )}
    </Stack>
  );
}
