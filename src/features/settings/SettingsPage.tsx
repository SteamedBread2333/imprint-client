import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  NumberInput,
  ScrollArea,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  type AppConfig,
  type GlobalEmbedDoc,
  type RuntimeStatus,
  getGlobalEmbed,
  saveGlobalEmbed,
} from "../../platform/tauri/api";
import type { Locale, Messages } from "../../i18n";

type EmbedForm = {
  enabled: boolean;
  package: string;
  port: string;
  model: string;
  duplicateThreshold: string;
  relateContradictionMin: string;
  relateEntailmentMin: string;
  relateBidirectional: boolean;
  timeoutSeconds: string;
};

const EMBED_DEFAULTS = {
  port: 4174,
  model: "BAAI/bge-small-zh-v1.5",
  duplicateThreshold: 0.65,
  relateContradictionMin: 0.4,
  relateEntailmentMin: 0.35,
  relateBidirectional: true,
  timeoutSeconds: 5,
};

function numField(v: unknown, fallback: number): string {
  const n =
    typeof v === "number" && Number.isFinite(v)
      ? v
      : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
        ? Number(v)
        : null;
  if (n == null) return String(fallback);
  return String(Number.isInteger(n) ? n : Math.round(n * 1000) / 1000);
}

function embedFormFromDoc(doc: GlobalEmbedDoc): EmbedForm {
  const c = doc.config ?? {};
  return {
    enabled: doc.enabled,
    package: doc.package,
    port: numField(c.port, EMBED_DEFAULTS.port),
    model: typeof c.model === "string" && c.model.trim() ? c.model : EMBED_DEFAULTS.model,
    duplicateThreshold: numField(c.duplicate_threshold, EMBED_DEFAULTS.duplicateThreshold),
    relateContradictionMin: numField(c.relate_contradiction_min, EMBED_DEFAULTS.relateContradictionMin),
    relateEntailmentMin: numField(c.relate_entailment_min, EMBED_DEFAULTS.relateEntailmentMin),
    relateBidirectional:
      typeof c.relate_bidirectional === "boolean"
        ? c.relate_bidirectional
        : EMBED_DEFAULTS.relateBidirectional,
    timeoutSeconds: numField(c.timeout_seconds, EMBED_DEFAULTS.timeoutSeconds),
  };
}

function parseIntInRange(raw: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function parseUnitInterval(raw: string): number | null {
  const n = Number(raw.trim());
  return raw.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function embedFormError(form: EmbedForm): "port" | "model" | "threshold" | "timeout" | null {
  if (parseIntInRange(form.port, 1, 65535) == null) return "port";
  if (!form.model.trim()) return "model";
  if (
    parseUnitInterval(form.duplicateThreshold) == null ||
    parseUnitInterval(form.relateContradictionMin) == null ||
    parseUnitInterval(form.relateEntailmentMin) == null
  ) return "threshold";
  if (parseIntInRange(form.timeoutSeconds, 1, 3600) == null) return "timeout";
  return null;
}

function embedDocFromForm(base: GlobalEmbedDoc, form: EmbedForm): GlobalEmbedDoc {
  return {
    ...base,
    enabled: form.enabled,
    package: base.package,
    config: {
      ...base.config,
      port: parseIntInRange(form.port, 1, 65535),
      model: form.model.trim(),
      duplicate_threshold: parseUnitInterval(form.duplicateThreshold),
      relate_contradiction_min: parseUnitInterval(form.relateContradictionMin),
      relate_entailment_min: parseUnitInterval(form.relateEntailmentMin),
      relate_bidirectional: form.relateBidirectional,
      timeout_seconds: parseIntInRange(form.timeoutSeconds, 1, 3600),
    },
  };
}

export function SettingsPage({
  m,
  cfg,
  locale,
  runtimeStatus,
  busy,
  onEnsureRuntime,
  onUpdateComponent,
  onSave,
  onRefreshRuntime,
  onEmbedSaved,
  runtimeLogLines,
}: {
  m: Messages;
  cfg: AppConfig;
  locale: Locale;
  runtimeStatus: RuntimeStatus | null;
  busy: boolean;
  onEnsureRuntime: () => void;
  onUpdateComponent: (name: string) => void;
  onSave: (c: AppConfig) => Promise<void>;
  onRefreshRuntime: () => void;
  onEmbedSaved: (message: string) => void;
  runtimeLogLines: string[];
}) {
  const [draft, setDraft] = useState(cfg);
  const [embedDoc, setEmbedDoc] = useState<GlobalEmbedDoc | null>(null);
  const [embedForm, setEmbedForm] = useState<EmbedForm | null>(null);
  const [embedError, setEmbedError] = useState("");
  useEffect(() => setDraft(cfg), [cfg]);
  useEffect(() => {
    let cancelled = false;
    getGlobalEmbed().then((doc) => {
      if (!cancelled) {
        setEmbedDoc(doc);
        setEmbedForm(embedFormFromDoc(doc));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [runtimeStatus?.ready]);

  const saveEmbed = async () => {
    if (!embedForm || !embedDoc) return;
    const invalid = embedFormError(embedForm);
    if (invalid) {
      setEmbedError({
        port: m.embedInvalidPort,
        model: m.embedInvalidModel,
        threshold: m.embedInvalidThreshold,
        timeout: m.embedInvalidTimeout,
      }[invalid]);
      return;
    }
    try {
      const next = embedDocFromForm(embedDoc, embedForm);
      await saveGlobalEmbed(next);
      setEmbedDoc(next);
      setEmbedError("");
      onEmbedSaved(m.embedSaved);
      onRefreshRuntime();
    } catch (e) {
      setEmbedError(String(e));
    }
  };

  const monoInput = { input: { fontFamily: "var(--mantine-font-family-monospace)" } };
  const numberValue = (value: string) => value === "" ? "" : value;

  return (
    <Stack gap="lg" maw={760}>
      <Title order={3}>{m.settings}</Title>
      <Stack gap="sm">
        <Title order={4}>{m.runtimeTitle}</Title>
        <Text size="sm" c="dimmed">{runtimeStatus?.ready ? m.runtimeReady : m.runtimeNotReady}</Text>
        <Group>
          <Button size="xs" disabled={busy} onClick={onEnsureRuntime}>{m.runtimeEnsure}</Button>
          <Button size="xs" variant="subtle" disabled={busy} onClick={onRefreshRuntime}>{m.refresh}</Button>
        </Group>
        {(busy || runtimeLogLines.length > 0) && (
          <ScrollArea h={120}>
            <Text size="xs" ff="monospace" style={{ whiteSpace: "pre-wrap" }}>
              {runtimeLogLines.length > 0 ? runtimeLogLines.join("\n") : m.runtimeUpdating}
            </Text>
          </ScrollArea>
        )}
        <Stack gap="xs">
          {runtimeStatus?.components.map((c) => (
            <Group key={c.name} justify="space-between" wrap="nowrap">
              <Text size="sm">
                <Text span fw={600}>{c.name}</Text>{" "}
                {c.installed
                  ? c.latest && c.version && c.latest !== c.version ? `${c.version} → ${c.latest}` : c.version || "ok"
                  : c.latest ? `— → ${c.latest}` : "—"}{" "}
                · <Text span ff="monospace" size="xs">{c.path || "—"}</Text>
              </Text>
              {c.managedByConsole === true && (c.installed || c.name === "imprint") && (
                <Button size="xs" variant="subtle" disabled={busy} onClick={() => onUpdateComponent(c.name)}>
                  {m.runtimeUpdate}
                </Button>
              )}
            </Group>
          ))}
        </Stack>
      </Stack>

      <Stack gap="sm">
        <Title order={4}>{m.globalEmbedTitle}</Title>
        <Text size="sm" c="dimmed">{m.globalEmbedHint}</Text>
        {embedForm && (
          <>
            <Switch label={m.globalEmbedEnabled} checked={embedForm.enabled}
              onChange={(e) => setEmbedForm({ ...embedForm, enabled: e.currentTarget.checked })} />
            <TextInput label="package" value={embedForm.package} readOnly styles={monoInput} />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <NumberInput label={m.embedPort} description="port" min={1} max={65535}
                value={embedForm.port} onChange={(v) => setEmbedForm({ ...embedForm, port: numberValue(String(v)) })} />
              <NumberInput label={m.embedTimeout} description="timeout_seconds" min={1} max={3600}
                value={embedForm.timeoutSeconds} onChange={(v) => setEmbedForm({ ...embedForm, timeoutSeconds: numberValue(String(v)) })} />
              <NumberInput label={m.embedDuplicate} description="duplicate_threshold" min={0} max={1} step={0.01} decimalScale={2}
                value={embedForm.duplicateThreshold} onChange={(v) => setEmbedForm({ ...embedForm, duplicateThreshold: numberValue(String(v)) })} />
              <NumberInput label={m.embedContradiction} description="relate_contradiction_min" min={0} max={1} step={0.01} decimalScale={2}
                value={embedForm.relateContradictionMin} onChange={(v) => setEmbedForm({ ...embedForm, relateContradictionMin: numberValue(String(v)) })} />
              <NumberInput label={m.embedEntailment} description="relate_entailment_min" min={0} max={1} step={0.01} decimalScale={2}
                value={embedForm.relateEntailmentMin} onChange={(v) => setEmbedForm({ ...embedForm, relateEntailmentMin: numberValue(String(v)) })} />
            </SimpleGrid>
            <TextInput label={m.embedModel} description="model" value={embedForm.model} styles={monoInput}
              onChange={(e) => setEmbedForm({ ...embedForm, model: e.currentTarget.value })} />
            <Switch label={m.embedBidirectional} description="relate_bidirectional"
              checked={embedForm.relateBidirectional}
              onChange={(e) => setEmbedForm({ ...embedForm, relateBidirectional: e.currentTarget.checked })} />
            {embedError && <Alert variant="light" color="red">{embedError}</Alert>}
            <Group><Button size="xs" onClick={() => void saveEmbed()}>{m.save}</Button></Group>
          </>
        )}
      </Stack>

      <Stack gap="sm">
        <Title order={4}>{m.settings}</Title>
        <TextInput label={m.imprintBin} description={m.imprintBinHint} value={draft.imprintBin}
          styles={monoInput} placeholder="imprint 或绝对路径"
          onChange={(e) => setDraft({ ...draft, imprintBin: e.currentTarget.value })} />
        <NumberInput label={m.pollMs} value={draft.pollIntervalMs} min={500}
          onChange={(v) => setDraft({ ...draft, pollIntervalMs: typeof v === "number" ? v : Number(v) || 2500 })} />
        <TextInput label={m.hfEndpoint} value={draft.hfEndpoint} placeholder="https://hf-mirror.com"
          onChange={(e) => setDraft({ ...draft, hfEndpoint: e.currentTarget.value })} />
        <TextInput label={m.imprintHf} value={draft.imprintHfEndpoint}
          onChange={(e) => setDraft({ ...draft, imprintHfEndpoint: e.currentTarget.value })} />
        <Group><Button size="xs" onClick={() => onSave({ ...draft, locale })}>{m.save}</Button></Group>
      </Stack>
    </Stack>
  );
}
