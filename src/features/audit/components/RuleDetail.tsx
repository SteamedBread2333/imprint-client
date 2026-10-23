import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Code, Drawer, Group, Loader, ScrollArea, Stack, Text, Title } from "@mantine/core";
import type { Messages } from "../../../i18n";
import { deskClient } from "../api/desk-client";
import type { DocFile, GraphNode } from "../domain/contracts";
import { headingSection, highlightTerms, renderDocBody, renderSafeMarkdown } from "../domain/markdown";

type Source = {
  path?: string;
  heading?: string;
  snippet?: string;
  line_start?: number;
  line_end?: number;
};

function deskFailure(error: unknown): { text: string; notFound: boolean } {
  if (typeof error === "string") return { text: error, notFound: /document not found/i.test(error) };
  if (error instanceof Error) {
    return { text: error.message, notFound: /document not found/i.test(error.message) };
  }
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; detail?: unknown };
    const message = typeof record.message === "string" ? record.message : "";
    const detail = typeof record.detail === "string" ? record.detail : "";
    const notFound = /document not found/i.test(detail) || /\b404\b/.test(message);
    const text = [message, detail].filter(Boolean).join("\n");
    return { text: text || "document request failed", notFound };
  }
  return { text: String(error), notFound: false };
}

type SourcePreview = {
  file: DocFile;
  heading?: string;
  lineStart?: number;
  lineEnd?: number;
};

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
  const [sourcePreview, setSourcePreview] = useState<SourcePreview | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [failedSource, setFailedSource] = useState<Source | null>(null);
  const article = useRef<HTMLDivElement>(null);

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

  const openSource = (source: Source) => {
    const path = source.path ?? "";
    if (!path) return;
    setSourceError("");
    setFailedSource(null);
    setSourcePreview(null);
    void deskClient.docFile(path)
      .then((file) => setSourcePreview({
        file,
        heading: source.heading,
        lineStart: source.line_start,
        lineEnd: source.line_end,
      }))
      .catch((reason) => {
        const failure = deskFailure(reason);
        setFailedSource(source);
        setSourceError(failure.notFound ? m.sourceNotIndexed : failure.text);
      });
  };

  useEffect(() => {
    const root = article.current;
    if (!root || !sourcePreview) return;
    try {
      highlightTerms(root, [node?.id ?? "", node?.claim ?? "", sourcePreview.heading ?? ""]);
      root.querySelector("#doc-anchor")?.scrollIntoView({ block: "center" });
    } catch {
      // Source content remains readable if optional highlighting cannot run.
    }
  }, [node, sourcePreview]);

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
        <Button size="compact-sm" variant="light" onClick={() => openSource({ path: node.path, heading: node.heading })}>{node.path}</Button>
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
                  onClick={() => openSource(source)}
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
        opened={Boolean(sourcePreview) || Boolean(sourceError)}
        onClose={() => { setSourcePreview(null); setSourceError(""); setFailedSource(null); }}
        position="right"
        size="xl"
        title={sourcePreview?.file.path ?? failedSource?.path ?? m.detailSources}
      >
        {sourceError && (
          <Stack gap="sm">
            <Alert color="yellow">{sourceError}</Alert>
            {failedSource?.path && <Code>{failedSource.path}</Code>}
            {failedSource?.heading && <Title order={4}>{failedSource.heading}</Title>}
            {failedSource?.snippet && <Text size="sm">{failedSource.snippet}</Text>}
          </Stack>
        )}
        {sourcePreview && (
          <ScrollArea h="calc(100vh - 100px)">
            <div
              ref={article}
              className="audit-markdown"
              dangerouslySetInnerHTML={{
                __html: (() => {
                  const ranged = sourcePreview.lineStart
                    ? { start: sourcePreview.lineStart, end: sourcePreview.lineEnd || sourcePreview.lineStart }
                    : sourcePreview.heading
                      ? headingSection(sourcePreview.file.content, sourcePreview.heading)
                      : null;
                  return ranged
                    ? renderDocBody(sourcePreview.file.content, ranged.start, ranged.end)
                    : renderSafeMarkdown(sourcePreview.file.content);
                })(),
              }}
            />
          </ScrollArea>
        )}
      </Drawer>
    </Stack>
  );
}
