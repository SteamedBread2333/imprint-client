import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ScrollArea } from "@mantine/core";
import { clampDetailWidth } from "../domain/graph-model";

export function SplitStage({ graph, detail }: { graph: ReactNode; detail: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const apply = () => {
      setWidth((current) => clampDetailWidth(current, element.clientWidth, window.innerWidth));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, []);

  const resizeTo = (clientX: number) => {
    const element = frame.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setWidth(clampDetailWidth(rect.right - clientX, rect.width, window.innerWidth));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeTo(event.clientX);
  };

  return (
    <div className="graph-stage" ref={frame} data-testid="graph-stage">
      <div className="graph-stage-main">{graph}</div>
      <div
        className="graph-stage-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize detail panel"
        data-testid="graph-resizer"
        onPointerDown={onPointerDown}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeTo(event.clientX);
        }}
      />
      <aside className="graph-stage-detail" style={{ width }}>
        <ScrollArea h="100%" p="md">{detail}</ScrollArea>
      </aside>
    </div>
  );
}
