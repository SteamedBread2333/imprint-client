import { useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import { Alert, Code, Loader, Stack, Text, TextInput, Title } from "@mantine/core";
import "highlight.js/styles/base16/black-metal-dark-funeral.min.css";
import { deskClient } from "../api/desk-client";
import type { DocChunk, DocFile, DocHit } from "../domain/contracts";
import { highlightInElement, renderDocBody, splitHighlight } from "../domain/markdown";

function Highlighted({ text, query }: { text: string; query: string }) {
  return splitHighlight(text, query).map((part, index) =>
    part.hit
      ? <mark key={index} className="search-hl">{part.text}</mark>
      : <span key={index}>{part.text}</span>,
  );
}

export function DocsWorkspace({
  enabled,
  query,
  onQuery,
}: {
  enabled: boolean;
  query: string;
  onQuery: (query: string) => void;
}) {
  const [debounced] = useDebouncedValue(query, 320);
  const [hits, setHits] = useState<DocHit[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [chunk, setChunk] = useState<DocChunk | null>(null);
  const [file, setFile] = useState<DocFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const article = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setError("");
    if (!enabled || !debounced.trim()) {
      setHits([]);
      setSelectedId("");
      return;
    }
    setLoading(true);
    deskClient.searchDocs(debounced)
      .then((result) => {
        if (!active) return;
        setHits(result.hits);
        setSelectedId((current) =>
          current && result.hits.some((hit) => hit.id === current)
            ? current
            : result.hits[0]?.id ?? "",
        );
      })
      .catch((reason) => { if (active) setError(String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [debounced, enabled]);

  useEffect(() => {
    let active = true;
    setChunk(null);
    setFile(null);
    if (!selectedId) return;
    setLoading(true);
    deskClient.docChunk(selectedId)
      .then(async (nextChunk) => {
        const nextFile = await deskClient.docFile(nextChunk.path);
        if (active) {
          setChunk(nextChunk);
          setFile(nextFile);
        }
      })
      .catch((reason) => { if (active) setError(String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedId]);

  useEffect(() => {
    const root = article.current;
    if (!root) return;
    if (!file) {
      root.innerHTML = "";
      return;
    }
    root.innerHTML = renderDocBody(file.content, chunk?.line_start, chunk?.line_end);
    highlightInElement(root, debounced);
    const anchor = root.querySelector("#doc-anchor");
    if (anchor && !root.querySelector(".doc-rule-range")) {
      const block = anchor.closest("p, li, h1, h2, h3, h4, h5, h6, td, blockquote, pre") || anchor.parentElement;
      block?.classList.add("doc-match-block");
    }
    const nodes = root.querySelectorAll<HTMLElement>(".mermaid");
    let active = true;
    if (nodes.length) {
      void import("mermaid").then(async ({ default: mermaid }) => {
        if (!active) return;
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        await mermaid.run({ nodes: [...nodes], suppressErrors: true });
      }).catch(() => {});
    }
    const reader = root.closest(".docs-reader");
    if (anchor && reader) {
      const readerRect = reader.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      reader.scrollTop += anchorRect.top - readerRect.top - reader.clientHeight / 3;
    }
    return () => { active = false; };
  }, [file, chunk, debounced]);

  if (!enabled) {
    return <Alert color="yellow">Shelves is disabled for this project.</Alert>;
  }
  return (
    <Stack gap="sm" className="audit-workspace" data-testid="docs-workspace">
      <TextInput
        placeholder="Search indexed Markdown"
        aria-label="Search documentation"
        value={query}
        onChange={(event) => onQuery(event.currentTarget.value)}
      />
      {error && <Alert color="red">{error}</Alert>}
      <div className="docs-split">
        <div className="docs-pane docs-hits">
          {loading && hits.length === 0 && <Loader size="sm" m="md" />}
          {!loading && debounced && hits.length === 0 && <Text c="dimmed" p="md">No documents found.</Text>}
          {hits.map((hit) => (
            <button
              key={hit.id}
              type="button"
              data-testid={`doc-hit-${hit.id}`}
              className={selectedId === hit.id ? "doc-hit doc-hit-on" : "doc-hit"}
              onClick={() => setSelectedId(hit.id)}
            >
              <Text fw={600} size="sm"><Highlighted text={hit.heading || hit.path} query={debounced} /></Text>
              <Text ff="monospace" c="dimmed" size="xs">{hit.path} · {hit.score.toFixed(2)}</Text>
              <Text size="xs" mt={6}><Highlighted text={hit.snippet} query={debounced} /></Text>
            </button>
          ))}
        </div>
        <div className="docs-pane docs-reader">
          {!file && !loading && (
            <Stack>
              <Title order={4}>Search workspace documentation</Title>
              <Text c="dimmed" size="sm">Indexed Markdown from the configured Shelves roots.</Text>
            </Stack>
          )}
          {loading && !file && <Loader size="sm" />}
          {file && (
            <Stack gap="sm" data-testid="doc-preview">
              <Title order={3}><Highlighted text={chunk?.heading || file.path} query={debounced} /></Title>
              <Code>{file.path}</Code>
              <div ref={article} className="audit-markdown" />
            </Stack>
          )}
        </div>
      </div>
    </Stack>
  );
}
