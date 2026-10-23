import { useState } from "react";
import { Group, Text } from "@mantine/core";
import type { Messages } from "../../../i18n";
import type { GraphNode } from "../domain/contracts";
import { edgeStyle, scopeColor } from "../domain/graph-model";

const EDGE_LABELS: Array<{ kind: string; label: (m: Messages) => string }> = [
  { kind: "related", label: (m) => m.edgeRelated },
  { kind: "supersedes", label: (m) => m.edgeSupersedes },
  { kind: "conflicts_with", label: (m) => m.edgeConflict },
  { kind: "sources", label: (m) => m.edgeSources },
  { kind: "cited_by", label: (m) => m.edgeCited },
];

export function EdgeSample({ kind, label }: { kind: string; label: string }) {
  const style = edgeStyle(kind);
  return (
    <Group gap={8} wrap="nowrap">
      <span
        className="edge-swatch"
        style={{ borderTopColor: style.color, borderTopStyle: style.dashed ? "dashed" : "solid" }}
      />
      <Text size="xs">{label}</Text>
    </Group>
  );
}

export function GraphLegend({
  nodes,
  enabledKinds,
  m,
  onZoomIn,
  onZoomOut,
}: {
  nodes: GraphNode[];
  enabledKinds: Set<string>;
  m: Messages;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const [focus, setFocus] = useState("");
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const scope = node._kind && node._kind !== "rule" ? "doc" : node.scope[0] || "untagged";
    counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  const scopes = [...counts.keys()];
  const edges = EDGE_LABELS.filter((edge) => enabledKinds.has(edge.kind));
  const structural = ["contains", "directory", "sequence"].some((kind) => enabledKinds.has(kind));

  return (
    <aside className="graph-legend" data-testid="graph-legend">
      <Text size="xs"><b>{m.legendTitle}</b> · {m.legendSub}</Text>
      <Group gap={6} mt={8}>
        {scopes.map((scope) => (
          <button
            key={scope}
            type="button"
            className="scope-dot"
            style={{ background: scopeColor(scope) }}
            aria-label={`${scope} ${counts.get(scope) ?? 0}`}
            onMouseEnter={() => setFocus(`${scope} · ${counts.get(scope) ?? 0}`)}
            onMouseLeave={() => setFocus("")}
            onFocus={() => setFocus(`${scope} · ${counts.get(scope) ?? 0}`)}
            onBlur={() => setFocus("")}
          />
        ))}
      </Group>
      <Text size="xs" className="legend-focus">{focus || "\u00a0"}</Text>
      <div className="graph-legend-edges">
        {edges.map((edge) => <EdgeSample key={edge.kind} kind={edge.kind} label={edge.label(m)} />)}
        {structural && <EdgeSample kind="contains" label={m.edgeStructure} />}
      </div>
      <Text size="xs" c="dimmed">{m.legendNote}</Text>
      <Group gap={6}>
        <button type="button" className="graph-zoom" onClick={onZoomOut} aria-label={m.zoomOut}>−</button>
        <button type="button" className="graph-zoom" onClick={onZoomIn} aria-label={m.zoomIn}>+</button>
      </Group>
    </aside>
  );
}
