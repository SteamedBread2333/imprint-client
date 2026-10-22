import { Badge } from "@mantine/core";

export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "off" | "neutral";
}) {
  const color =
    tone === "ok" ? "teal" : tone === "warn" ? "yellow" : tone === "off" ? "gray" : undefined;
  return (
    <Badge variant="light" color={color} size="sm">
      {label}
    </Badge>
  );
}
