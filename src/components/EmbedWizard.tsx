import { Button, Group, Stack, Stepper, Text, Title } from "@mantine/core";
import type { Messages } from "../i18n";
import type { Snapshot } from "../platform/tauri/api";
import { LogPanel } from "./LogPanel";

export function EmbedWizard({
  m,
  snap,
  wizardStep,
  prereq,
  wizardSteps,
  logLines,
  busy,
  embedStarting,
  onBack,
  onStep,
  onCancel,
  onClearLogs,
}: {
  m: Messages;
  snap: Snapshot | null;
  wizardStep: number;
  prereq: string;
  wizardSteps: readonly string[];
  logLines: string[];
  busy: boolean;
  embedStarting: boolean;
  onBack: () => void;
  onStep: (step: number) => void;
  onCancel: () => void;
  onClearLogs: () => void;
}) {
  const status =
    embedStarting && !(snap?.embed.running || snap?.embedHealth?.ok)
      ? m.starting
      : snap?.embed.running || snap?.embedHealth?.ok
        ? m.embedRunning
        : m.embedStopped;
  const health = snap?.embedHealth?.ready
    ? " · ready"
    : snap?.embedHealth?.ok
      ? " · /health OK"
      : "";

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3}>{m.embedWizardTitle}</Title>
        <Button variant="subtle" size="xs" onClick={onBack}>
          {m.embedWizardBack}
        </Button>
      </Group>
      {snap && (
        <Text size="sm">
          {m.embedStatus}: {status}
          {health}
        </Text>
      )}
      <Text size="sm" c="dimmed">
        {m.embedWizardLead}
      </Text>
      <Stepper active={wizardStep} size="sm">
        {wizardSteps.map((label) => (
          <Stepper.Step key={label} label={label} />
        ))}
      </Stepper>
      {prereq && <Text size="sm">{prereq}</Text>}
      <Group>
        {wizardSteps.map((_, i) => (
          <Button key={i} size="xs" variant="default" disabled={busy} onClick={() => onStep(i)}>
            {m.runStep} {i + 1}
          </Button>
        ))}
        {busy && (
          <Button size="xs" variant="subtle" onClick={onCancel}>
            {m.cancelJob}
          </Button>
        )}
      </Group>
      <LogPanel
        title={m.logs}
        autoScrollLabel={m.autoScroll}
        clearLabel={m.clearLogs}
        emptyLabel={m.noLogs}
        lines={logLines}
        onClear={onClearLogs}
      />
    </Stack>
  );
}
