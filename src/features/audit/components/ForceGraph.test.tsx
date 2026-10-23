// @vitest-environment jsdom
import { act, type ReactNode } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import type { GraphData } from "../domain/contracts";
import { ForceGraph } from "./ForceGraph";

const data: GraphData = {
  generated_at: "2026-10-23T00:00:00Z",
  nodes: [{
    id: "r-1",
    claim: "Stay still",
    scope: ["design"],
    confidence: 0.8,
    status: "active",
    reinforcement_count: 0,
    supersedes: [],
    related: [],
    conflicts_with: [],
    evidence_log: [],
    query_local: "",
    referenced_by: [],
  }],
  edges: [],
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
});

function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(node));
}

it("keeps the running simulation when equivalent graph props get new identities", () => {
  const kinds = new Set(["related"]);
  render(
    <ForceGraph
      data={data}
      nodes={data.nodes}
      enabledKinds={kinds}
      selectedId=""
      labels="off"
      onSelect={() => {}}
    />,
  );
  const svg = host?.querySelector("svg");
  act(() => {
    root?.render(
      <ForceGraph
        data={{ ...data, generated_at: "2026-10-23T00:00:01Z" }}
        nodes={data.nodes.map((node) => ({ ...node }))}
        enabledKinds={new Set(kinds)}
        selectedId=""
        labels="off"
        onSelect={() => {}}
      />,
    );
  });
  expect(host?.querySelector("svg")).toBe(svg);

  act(() => {
    root?.render(
      <ForceGraph
        data={data}
        nodes={data.nodes}
        enabledKinds={kinds}
        selectedId="r-1"
        labels="off"
        onSelect={() => {}}
      />,
    );
  });
  expect(host?.querySelector("svg")).toBe(svg);
  expect(host?.querySelector("circle")?.getAttribute("r")).toBe("21");
});
