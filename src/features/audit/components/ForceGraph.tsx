import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import {
  drag,
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  select,
  zoom,
  zoomIdentity,
  type Selection,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  type ZoomBehavior,
} from "d3";
import type { GraphData, GraphNode } from "../domain/contracts";
import { edgeStyle, graphFit, graphStructureKey, nodeRadius, scopeColor } from "../domain/graph-model";

type SimNode = GraphNode & SimulationNodeDatum & { r: number };
type SimLink = SimulationLinkDatum<SimNode> & { kind: string };
type NodeSelection = Selection<SVGGElement, SimNode, SVGGElement, unknown>;
type GraphView = {
  svg: Selection<SVGSVGElement, unknown, null, undefined>;
  zoom: ZoomBehavior<SVGSVGElement, unknown>;
  nodes: SimNode[];
  width: number;
  height: number;
};

export type GraphHandle = {
  fit: () => void;
  zoomBy: (factor: number) => void;
};

function labelOpacity(mode: "off" | "on" | "auto", count: number, selected: boolean, hovered: boolean) {
  if (mode === "on" || (mode === "auto" && count <= 14) || selected || hovered) return 1;
  return 0;
}

export const ForceGraph = forwardRef<GraphHandle, {
  data: GraphData;
  nodes: GraphNode[];
  enabledKinds: Set<string>;
  selectedId: string;
  labels: "off" | "on" | "auto";
  onSelect: (id: string) => void;
}>(function ForceGraph({ data, nodes, enabledKinds, selectedId, labels, onSelect }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<() => void>(() => {});
  const onSelectRef = useRef(onSelect);
  const selectedRef = useRef(selectedId);
  const labelsRef = useRef(labels);
  const modelRef = useRef({ data, nodes, enabledKinds });
  const drawnNodesRef = useRef<NodeSelection | null>(null);
  const viewRef = useRef<GraphView | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; body: string } | null>(null);
  const [sizeEpoch, setSizeEpoch] = useState(0);
  onSelectRef.current = onSelect;
  selectedRef.current = selectedId;
  labelsRef.current = labels;
  modelRef.current = { data, nodes, enabledKinds };
  const structureKey = graphStructureKey(nodes, data.edges, enabledKinds, "layout");

  const fitView = () => fitRef.current();

  useImperativeHandle(ref, () => ({
    fit: fitView,
    zoomBy(factor: number) {
      const view = viewRef.current;
      if (!view) return;
      view.svg.transition().duration(180).call(view.zoom.scaleBy, factor);
    },
  }));

  useEffect(() => {
    const host = hostRef.current;
    if (!host || (host.clientWidth >= 20 && host.clientHeight >= 20)) return;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (host.clientWidth >= 20 && host.clientHeight >= 20) setSizeEpoch((value) => value + 1);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [structureKey, sizeEpoch]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { data: graph, nodes: sourceNodes, enabledKinds: kinds } = modelRef.current;
    host.replaceChildren();
    const measured = host.clientWidth >= 20 && host.clientHeight >= 20;
    const width = measured ? host.clientWidth : 640;
    const height = measured ? host.clientHeight : 420;
    const nodeIds = new Set(sourceNodes.map((node) => node.id));
    const simNodes: SimNode[] = sourceNodes.map((node, index) => {
      const radius = 36 + Math.sqrt(sourceNodes.length) * 18;
      const angle = (2 * Math.PI * index) / Math.max(sourceNodes.length, 1) - Math.PI / 2;
      return {
        ...node,
        r: nodeRadius(node, node.id === selectedRef.current),
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      };
    });
    const links: SimLink[] = graph.edges
      .filter((edge) => kinds.has(edge.kind) && nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => ({ ...edge }));

    const svg = select(host)
      .append("svg")
      .attr("data-testid", "force-graph")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", `0 0 ${width} ${height}`);
    const root = svg.append("g");
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.02, 8])
      .filter((event) => {
        if (event.type === "wheel") return true;
        const target = event.target as Element;
        return !target.closest("[data-node]");
      })
      .on("zoom", (event) => root.attr("transform", event.transform));
    svg.call(zoomBehavior);
    svg.on("dblclick.zoom", null);

    const line = root
      .append("g")
      .attr("stroke-opacity", 0.8)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (edge) => edgeStyle(edge.kind).color)
      .attr("stroke-dasharray", (edge) => edgeStyle(edge.kind).dashed ? "5 3" : null)
      .attr("stroke-width", (edge) => edge.kind === "conflicts_with" ? 2.2 : 1.5);

    const node = root
      .append("g")
      .selectAll<SVGGElement, SimNode>("g")
      .data(simNodes, (datum) => datum.id)
      .join("g")
      .attr("data-node", (datum) => datum.id)
      .attr("role", "button")
      .attr("tabindex", 0)
      .style("cursor", "grab")
      .on("click", (_event, datum) => onSelectRef.current(datum.id))
      .on("keydown", (event, datum) => {
        if (event.key === "Enter" || event.key === " ") onSelectRef.current(datum.id);
      })
      .on("mouseover", (event, datum) => {
        const bounds = host.getBoundingClientRect();
        setTip({
          x: event.clientX - bounds.left + 14,
          y: event.clientY - bounds.top + 14,
          title: `${datum.id} · ${datum.status} · ${datum.confidence.toFixed(2)}`,
          body: datum.claim,
        });
        select(event.currentTarget as SVGGElement).select("text").style("opacity", 1);
      })
      .on("mouseout", (event, datum) => {
        setTip(null);
        const opacity = labelOpacity(
          labelsRef.current,
          simNodes.length,
          datum.id === selectedRef.current,
          false,
        );
        select(event.currentTarget as SVGGElement).select("text").style("opacity", opacity);
      });
    drawnNodesRef.current = node;

    node
      .append("circle")
      .attr("fill", (datum) => scopeColor(datum._kind && datum._kind !== "rule" ? "doc" : datum.scope[0] ?? ""))
      .attr("stroke", "#fff")
      .attr("stroke-width", (datum) => datum.id === selectedRef.current ? 2 : 0);
    node
      .append("text")
      .text((datum) => datum.claim.length > 34 ? `${datum.claim.slice(0, 32)}…` : datum.claim)
      .attr("x", 12)
      .attr("y", 4)
      .attr("fill", "currentColor")
      .attr("font-size", 11)
      .style("pointer-events", "none")
      .style("opacity", (datum) => labelOpacity(
        labelsRef.current,
        simNodes.length,
        datum.id === selectedRef.current,
        false,
      ));
    node.select("circle").attr("r", (datum) => datum.r);

    const simulation = forceSimulation(simNodes)
      .force("link", forceLink<SimNode, SimLink>(links).id((datum) => datum.id).distance(72).strength(0.45))
      .force("charge", forceManyBody().strength(-120))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide<SimNode>().radius((datum) => datum.r + 6))
      .stop();

    const draw = () => {
      line
        .attr("x1", (edge) => (edge.source as SimNode).x ?? 0)
        .attr("y1", (edge) => (edge.source as SimNode).y ?? 0)
        .attr("x2", (edge) => (edge.target as SimNode).x ?? 0)
        .attr("y2", (edge) => (edge.target as SimNode).y ?? 0);
      node.attr("transform", (datum) => `translate(${datum.x ?? 0},${datum.y ?? 0})`);
    };
    simulation.on("tick", draw);
    simulation.alpha(1).tick(300);
    draw();

    const fit = (animate: boolean) => {
      const viewWidth = host.clientWidth >= 20 ? host.clientWidth : width;
      const viewHeight = host.clientHeight >= 20 ? host.clientHeight : height;
      svg.attr("viewBox", `0 0 ${viewWidth} ${viewHeight}`);
      const labelPad = labelOpacity(labelsRef.current, simNodes.length, false, false) > 0 ? 120 : 0;
      const frame = graphFit(simNodes, viewWidth, viewHeight, labelPad);
      const next = zoomIdentity.translate(viewWidth / 2, viewHeight / 2).scale(frame.k).translate(-frame.cx, -frame.cy);
      zoomBehavior.extent([[0, 0], [viewWidth, viewHeight]]);
      const target = animate ? svg.transition().duration(420) : svg;
      target.call(zoomBehavior.transform, next);
      if (viewRef.current) {
        viewRef.current.width = viewWidth;
        viewRef.current.height = viewHeight;
      }
    };
    fitRef.current = () => fit(true);
    viewRef.current = { svg, zoom: zoomBehavior, nodes: simNodes, width, height };
    fit(false);

    node.call(
      drag<SVGGElement, SimNode>()
        .on("start", (event, datum) => {
          if (!event.active) simulation.alphaTarget(0.25).restart();
          datum.fx = datum.x;
          datum.fy = datum.y;
        })
        .on("drag", (event, datum) => {
          datum.fx = event.x;
          datum.fy = event.y;
        })
        .on("end", (event, datum) => {
          if (!event.active) simulation.alphaTarget(0);
          datum.fx = null;
          datum.fy = null;
        }),
    );

    return () => {
      drawnNodesRef.current = null;
      viewRef.current = null;
      fitRef.current = () => {};
      simulation.stop();
      svg.on(".zoom", null);
      host.replaceChildren();
    };
  }, [structureKey, sizeEpoch]);

  useEffect(() => {
    const node = drawnNodesRef.current;
    if (!node) return;
    node.select("circle")
      .attr("r", (datum) => nodeRadius(datum, datum.id === selectedId))
      .attr("stroke-width", (datum) => datum.id === selectedId ? 2 : 0);
    node.select("text").style("opacity", (datum) => labelOpacity(
      labels,
      node.size(),
      datum.id === selectedId,
      false,
    ));
  }, [labels, selectedId, structureKey]);

  return (
    <div className="force-graph">
      <div ref={hostRef} className="force-graph-canvas" />
      {tip && (
        <div className="graph-tip" style={{ left: tip.x, top: tip.y }}>
          <strong>{tip.title}</strong>
          <span>{tip.body}</span>
        </div>
      )}
    </div>
  );
});
