import { useEffect, useState } from "react";
import { Alert, Badge, Button, Code, Drawer, Group, Loader, ScrollArea, Stack, Text, Title } from "@mantine/core";
import type { Messages } from "../../../i18n";
import { deskClient } from "../api/desk-client";
import type { DocFile, GraphNode } from "../domain/contracts";
import { renderSafeMarkdown } from "../domain/markdown";

type Source = { path?: string; heading?: string };

function asSources(value: unknown): Source[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as Source[] : [];
}

function links(ids: string[] | undefined, onOpen: (id: string) => void) {
  if (!ids?.length) return <Text size="sm" c="dimmed">—</Text>;
  return (
    <Group gap={6}>
      {ids.map((id) => (
        <Button key={id} size="compact-xs" variant="subtle" onClick={() => onOpen(id)}>{id}</Button>
      ))}
    </Group>
  );
}

export function RuleDetail({
  node,
  m,
  onOpen,
}: {
  node: GraphNode | null;
  m: Messages;
  onOpen: (id: string) => void;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sourceFile, setSourceFile] = useState<DocFile | null>(null);
  const [sourceError, setSourceError] = useState("");

  useEffect(() => {
    let active = true;
    setSources([]);
    setError("");
    if (!node || (node._kind && node._kind !== "rule")) return;
    setLoading(true);
    deskClient.ruleDetail(node.id)
      .then((value) => { if (active) setSources(asSources(value.resolved_sources)); })
      .catch((reason) => { if (active) setError(String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [node]);

  const openPath = (path: string) => {
    setSourceError("");
    setSourceFile(null);
    void deskClient.docFile(path)
      .then(setSourceFile)
      .catch((reason) => setSourceError(String(reason)));
  };

  if (!node) return <Text c="dimmed" size="sm">{m.detailEmpty}</Text>;

  const evidence = node.evidence_log.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as { at?: string; kind?: string; text?: string };
    return [entry];
  }).slice().reverse();

  return (
    <Stack gap="sm" data-testid="rule-detail">
      <Group justify="space-between" align="flex-start">
        <Code>{node.id}</Code>
        <Badge variant="light">{node._kind && node._kind !== "rule" ? node._kind : node.status}</Badge>
      </Group>
      <Title order={4}>{node.heading || node.claim}</Title>
      {node.path && (
        <Button size="compact-sm" variant="light" onClick={() => openPath(node.path ?? "")}>{node.path}</Button>
      )}
      {(!node._kind || node._kind === "rule") && (
        <Stack gap={8}>
          <Group gap={6}>{node.scope.map((scope) => <Badge key={scope} variant="outline">{scope}</Badge>)}</Group>
          <Text size="sm">{m.detailConfidence} {node.confidence.toFixed(2)} · {m.nodeSizeHint}</Text>
          <Text size="sm">{m.detailReinforced} {node.reinforcement_count}</Text>
          {node.query_local?.trim() && <Text size="sm">{m.detailQueryLocal}: {node.query_local}</Text>}
          <div><Text size="xs" c="dimmed">{m.detailSupersedes}</Text>{links(node.supersedes, onOpen)}</div>
          <div><Text size="xs" c="dimmed">{m.detailRelated}</Text>{links(node.related, onOpen)}</div>
          <div><Text size="xs" c="dimmed">{m.detailConflicts}</Text>{links(node.conflicts_with, onOpen)}</div>
          <div>
            <Text size="xs" c="dimmed">{m.detailReferenced}</Text>
            {node.referenced_by.length === 0 ? <Text size="sm" c="dimmed">—</Text> : (
              <Stack gap={4}>
                {node.referenced_by.map((link) => (
                  <Button key={`${link.kind ?? ""}-${link.id}`} size="compact-xs" variant="subtle" justify="flex-start" onClick={() => onOpen(link.id)}>
                    {link.id}{link.kind ? ` · ${link.kind}` : ""}
                  </Button>
                ))}
              </Stack>
            )}
          </div>
          <div>
            <Text size="xs" c="dimmed">{m.detailSources}</Text>
            {loading && <Loader size="xs" />}
            {error && <Alert color="red">{error}</Alert>}
            {!loading && sources.length === 0 && !error && <Text size="sm" c="dimmed">—</Text>}
            <Stack gap={4}>
              {sources.map((source, index) => (
                <Button
                  key={`${source.path ?? ""}-${index}`}
                  size="compact-xs"
                  variant="subtle"
                  justify="flex-start"
                  onClick={() => openPath(String(source.path ?? ""))}
                >
                  {source.heading || source.path}
                </Button>
              ))}
            </Stack>
          </div>
          <div>
            <Text size="xs" c="dimmed">{m.detailEvidence}</Text>
            {evidence.length === 0 ? <Text size="sm" c="dimmed">{m.detailEvidenceEmpty}</Text> : (
              <Stack gap={6}>
                {evidence.map((entry, index) => (
                  <Text key={`${entry.at ?? ""}-${index}`} size="sm">
                    <Text span c="dimmed" size="xs">{entry.at} {entry.kind}</Text>
                    {entry.text ? ` — ${entry.text}` : ""}
                  </Text>
                ))}
              </Stack>
            )}
          </div>
        </Stack>
      )}
      <Drawer
        opened={Boolean(sourceFile) || Boolean(sourceError)}
        onClose={() => { setSourceFile(null); setSourceError(""); }}
        position="right"
        size="xl"
        title={sourceFile?.path ?? m.detailSources}
      >
        {sourceError && <Alert color="red">{sourceError}</Alert>}
        {sourceFile && (
          <ScrollArea h="calc(100vh - 100px)">
            <div className="audit-markdown" dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(sourceFile.content) }} />
          </ScrollArea>
        )}
      </Drawer>
    </Stack>
  );
}
