export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "off" | "neutral";
}) {
  return <span className={`pill pill-${tone}`}>{label}</span>;
}
