// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { GraphData, GraphNode } from "./contracts";
import { clearAuditCache, getCachedGraph, putCachedGraph } from "./cache";
import { filterRules } from "./filters";
import { clampDetailWidth, graphFit, graphFromUnified, graphStructureKey, pickForGraph } from "./graph-model";
import { highlightInElement, renderSafeMarkdown, splitHighlight } from "./markdown";
import { defaultAuditUrlState, parseAuditUrl, serializeAuditUrl } from "./url-state";

const node = (id: string, scope: string[], confidence = 0.7): GraphNode => ({
  id,
  claim: `Claim ${id}`,
  scope,
  confidence,
  status: "active",
  reinforcement_count: 0,
  supersedes: [],
  related: [],
  conflicts_with: [],
  evidence_log: [],
  query_local: "",
  referenced_by: [],
});

const graph = (nodes: GraphNode[]): GraphData => ({
  generated_at: "now",
  nodes,
  edges: [],
});

describe("audit domain", () => {
  beforeEach(async () => {
    try { await clearAuditCache(); } catch { /* first run */ }
  });

  it("combines query, confidence and AND scopes", () => {
    const data = graph([
      node("r-1", ["go", "naming"], 0.9),
      node("r-2", ["go"], 0.95),
      node("r-3", ["naming"], 0.5),
    ]);
    const result = filterRules(data, {
      query: "claim",
      status: "active",
      minConfidence: 0.85,
      scopes: ["go", "naming"],
    });
    expect(result.map((item) => item.id)).toEqual(["r-1"]);
  });

  it("round-trips URL state", () => {
    const state = {
      ...defaultAuditUrlState,
      mode: "unified" as const,
      view: "graph" as const,
      selectedId: "r-1",
      filters: { query: "memory", status: "active", minConfidence: 0.85, scopes: ["go", "naming"] },
    };
    expect(parseAuditUrl(serializeAuditUrl(state))).toEqual(state);
  });

  it("converts unified document nodes", () => {
    const data = graphFromUnified({
      generated_at: "now",
      nodes: [{ id: "file:docs/a.md", kind: "file", path: "docs/a.md", label: "A" }],
      edges: [],
    });
    expect(data.nodes[0]).toMatchObject({ _kind: "file", scope: ["doc"], path: "docs/a.md" });
  });

  it("keeps the graph layout key stable across equivalent payloads", () => {
    const nodes = [node("b", ["design"]), node("a", ["go"])];
    const edges = [
      { source: "b", target: "a", kind: "related" },
      { source: "a", target: "b", kind: "supersedes" },
    ];
    const kinds = new Set(["related", "supersedes"]);
    expect(graphStructureKey(nodes, edges, kinds, "auto"))
      .toBe(graphStructureKey([...nodes].reverse(), [...edges].reverse(), new Set(kinds), "auto"));
    expect(graphStructureKey(nodes, edges, new Set(["related"]), "auto"))
      .not.toBe(graphStructureKey(nodes, edges, kinds, "auto"));
  });

  it("keeps connected graph nodes before high-confidence isolates", () => {
    const nodes = [node("linked", [], 0.1), node("high", [], 0.99), node("other", [], 0.8)];
    const data = { ...graph(nodes), edges: [{ source: "linked", target: "other", kind: "related" }] };
    expect(pickForGraph(data, nodes, 2).nodes.map((item) => item.id)).toEqual(["linked", "other"]);
  });

  it("isolates graph cache by vault", async () => {
    await putCachedGraph("/vault/a", graph([node("a", [])]));
    await putCachedGraph("/vault/b", graph([node("b", [])]));
    expect((await getCachedGraph("/vault/a"))?.nodes[0].id).toBe("a");
    expect((await getCachedGraph("/vault/b"))?.nodes[0].id).toBe("b");
  });

  it("frames every node inside the first view", () => {
    const fit = graphFit(
      [{ x: 0, y: 0, r: 10 }, { x: 800, y: 200, r: 12 }],
      400,
      300,
    );
    const place = (x: number, y: number) => ({
      x: 200 + (x - fit.cx) * fit.k,
      y: 150 + (y - fit.cy) * fit.k,
    });
    const left = place(0, 0);
    const right = place(800, 200);
    expect(left.x).toBeGreaterThan(0);
    expect(right.x).toBeLessThan(400);
    expect(left.y).toBeGreaterThan(0);
    expect(right.y).toBeLessThan(300);
    expect(fit.k).toBeLessThan(1);

    const tight = graphFit([{ x: 0, y: 0, r: 8 }, { x: 30, y: 10, r: 8 }], 900, 700);
    expect(tight.k).toBeGreaterThan(1);
    expect(tight.k).toBeLessThanOrEqual(1.6);
  });

  it("keeps the detail panel within one third of the window", () => {
    expect(clampDetailWidth(9999, 1200, 900)).toBe(300);
    expect(clampDetailWidth(100, 1200, 900)).toBe(220);
    expect(clampDetailWidth(9999, 400, 1200)).toBe(180);
  });

  it("sanitizes scripts and event handlers from markdown", () => {
    const html = renderSafeMarkdown('<img src=x onerror="alert(1)"><script>alert(2)</script>');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
  });

  it("highlights matched keywords without treating markup as text", () => {
    expect(splitHighlight("The React audit feature", "audit")).toEqual([
      { text: "The React ", hit: false },
      { text: "audit", hit: true },
      { text: " feature", hit: false },
    ]);
    const root = document.createElement("div");
    root.innerHTML = "<p>The React audit feature</p><pre><code>audit</code></pre>";
    highlightInElement(root, "audit");
    expect(root.querySelector("p mark.search-hl")?.textContent).toBe("audit");
    expect(root.querySelector("code mark")).toBeNull();
  });
});
