import { useEffect, useRef } from "react";
import { Button, Checkbox, Group, SegmentedControl, Text, TextInput } from "@mantine/core";
import type { Messages } from "../../../i18n";
import type { GraphData, GraphNode } from "../domain/contracts";
import { ForceGraph, type GraphHandle } from "./ForceGraph";
import { GraphLegend } from "./GraphLegend";
import { RuleDetail } from "./RuleDetail";
import { SplitStage } from "./SplitStage";

export function GraphCanvas({
  data,
  nodes,
  enabledKinds,
  selectedId,
  labels,
  onSelect,
  fitToken,
  m,
  detail,
}: {
  data: GraphData;
  nodes: GraphNode[];
  enabledKinds: Set<string>;
  selectedId: string;
  labels: "off" | "on" | "auto";
  onSelect: (id: string) => void;
  fitToken: number;
  m: Messages;
  detail: GraphNode | null;
}) {
  const graphRef = useRef<GraphHandle>(null);
  useEffect(() => {
    if (fitToken > 0) graphRef.current?.fit();
  }, [fitToken]);

  return (
    <SplitStage
      graph={
        <div className="graph-canvas">
          <ForceGraph
            ref={graphRef}
            data={data}
            nodes={nodes}
            enabledKinds={enabledKinds}
            selectedId={selectedId}
            labels={labels}
            onSelect={onSelect}
          />
          <GraphLegend
            nodes={nodes}
            enabledKinds={enabledKinds}
            m={m}
            onZoomIn={() => graphRef.current?.zoomBy(1.2)}
            onZoomOut={() => graphRef.current?.zoomBy(0.8)}
          />
        </div>
      }
      detail={<RuleDetail node={detail} m={m} onOpen={onSelect} />}
    />
  );
}

export function EdgeToggles({
  kinds,
  enabled,
  onToggle,
  m,
}: {
  kinds: string[];
  enabled: Set<string>;
  onToggle: (kind: string, checked: boolean) => void;
  m: Messages;
}) {
  const label: Record<string, string> = {
    related: m.edgeRelated,
    supersedes: m.edgeSupersedes,
    conflicts_with: m.edgeConflict,
    sources: m.edgeSources,
    cited_by: m.edgeCited,
    contains: m.edgeStructure,
    directory: m.edgeStructure,
    sequence: m.edgeStructure,
  };
  return (
    <Group gap="sm">
      {kinds.map((kind) => (
        <Checkbox
          key={kind}
          size="xs"
          label={label[kind] ?? kind}
          checked={enabled.has(kind)}
          onChange={(event) => onToggle(kind, event.currentTarget.checked)}
        />
      ))}
    </Group>
  );
}

export function LabelControl({
  value,
  onChange,
  m,
}: {
  value: "off" | "on" | "auto";
  onChange: (value: "off" | "on" | "auto") => void;
  m: Messages;
}) {
  return (
    <SegmentedControl
      size="xs"
      aria-label={m.auditLabels}
      value={value}
      onChange={(next) => onChange(next as "off" | "on" | "auto")}
      data={[
        { value: "off", label: "off" },
        { value: "auto", label: "auto" },
        { value: "on", label: "on" },
      ]}
    />
  );
}

export function FitButton({ onClick, m }: { onClick: () => void; m: Messages }) {
  return <Button size="xs" variant="default" onClick={onClick}>{m.auditFit}</Button>;
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <TextInput
      data-testid="audit-search"
      placeholder={placeholder}
      aria-label={placeholder}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      style={{ flex: "1 1 240px" }}
    />
  );
}

export function CountText({ children }: { children: string }) {
  return <Text size="xs" c="dimmed">{children}</Text>;
}
