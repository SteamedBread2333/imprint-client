import { useEffect, useRef, useState } from "react";

export function LogPanel({
  lines,
  onClear,
  title = "Logs",
  autoScrollLabel = "Auto-scroll",
  clearLabel = "Clear",
  emptyLabel = "(empty)",
}: {
  lines: string[];
  onClear: () => void;
  title?: string;
  autoScrollLabel?: string;
  clearLabel?: string;
  emptyLabel?: string;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);

  useEffect(() => {
    if (stick && bottom.current) {
      bottom.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, stick]);

  return (
    <div className="log-panel">
      <div className="log-toolbar">
        <span>{title}</span>
        <div>
          <label className="log-stick">
            <input
              type="checkbox"
              checked={stick}
              onChange={(e) => setStick(e.target.checked)}
            />
            {autoScrollLabel}
          </label>
          <button type="button" className="btn ghost" onClick={onClear}>
            {clearLabel}
          </button>
        </div>
      </div>
      <pre className="log-body">
        {lines.length === 0 ? (
          <span className="muted">{emptyLabel}</span>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={logClass(line)}>
              {line}
            </div>
          ))
        )}
        <div ref={bottom} />
      </pre>
    </div>
  );
}

function logClass(line: string): string {
  const l = line.toLowerCase();
  if (l.includes("error") || l.includes("failed")) return "log-line err";
  if (l.includes("warn")) return "log-line warn";
  return "log-line";
}
