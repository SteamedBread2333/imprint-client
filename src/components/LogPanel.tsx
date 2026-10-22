import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Group, Paper, Text } from "@mantine/core";

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
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" mb="xs">
        <Text size="sm" fw={600}>
          {title}
        </Text>
        <Group gap="sm">
          <Checkbox
            size="xs"
            label={autoScrollLabel}
            checked={stick}
            onChange={(e) => setStick(e.currentTarget.checked)}
          />
          <Button size="xs" variant="subtle" onClick={onClear}>
            {clearLabel}
          </Button>
        </Group>
      </Group>
      <pre className="log-body">
        {lines.length === 0 ? (
          <Text span size="xs" c="dimmed">
            {emptyLabel}
          </Text>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={logClass(line)}>
              {line}
            </div>
          ))
        )}
        <div ref={bottom} />
      </pre>
    </Paper>
  );
}

function logClass(line: string): string {
  const l = line.toLowerCase();
  if (l.includes("error") || l.includes("failed")) return "log-line err";
  if (l.includes("warn")) return "log-line warn";
  return "log-line";
}
