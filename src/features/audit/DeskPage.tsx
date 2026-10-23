import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Group, LoadingOverlay, SegmentedControl, Stack, Title } from "@mantine/core";
import type { Messages } from "../../i18n";
import { AuditErrorBoundary } from "./components/AuditErrorBoundary";
import { AuditHelp } from "./components/AuditHelp";
import { DocsWorkspace } from "./components/DocsWorkspace";
import { RulesWorkspace } from "./components/RulesWorkspace";
import { UnifiedWorkspace } from "./components/UnifiedWorkspace";
import { parseAuditUrl, serializeAuditUrl, type AuditUrlState } from "./domain/url-state";
import { DeskProvider, useDeskSession } from "./state/DeskProvider";

export function DeskPage({
  vaultKey,
  hostUp,
  shelvesEnabled,
  m,
}: {
  vaultKey: string;
  hostUp: boolean;
  shelvesEnabled: boolean;
  m: Messages;
}) {
  return (
    <AuditErrorBoundary fallback={m.auditFailed}>
      <DeskProvider vaultKey={vaultKey} hostUp={hostUp}>
        <DeskPageContent shelvesEnabled={shelvesEnabled} m={m} />
      </DeskProvider>
    </AuditErrorBoundary>
  );
}

function DeskPageContent({ shelvesEnabled, m }: { shelvesEnabled: boolean; m: Messages }) {
  const { health, graph, unified, loading, offline, error, refresh } = useDeskSession();
  const [helpOpen, setHelpOpen] = useState(false);
  const [fitToken, setFitToken] = useState(0);
  const [state, setState] = useState<AuditUrlState>(() => parseAuditUrl(window.location.search));
  const [edgeKinds, setEdgeKinds] = useState(
    () => new Set(["related", "supersedes", "conflicts_with"]),
  );

  useEffect(() => {
    const onPopState = () => setState(parseAuditUrl(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    window.history.replaceState({}, "", `${window.location.pathname}${serializeAuditUrl(state)}`);
  }, [state]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "?" && !typing) {
        event.preventDefault();
        setHelpOpen(true);
      } else if (event.key === "/" && !typing) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>("[data-testid=audit-search]")?.focus();
      } else if (event.key === "Escape") {
        setHelpOpen(false);
      } else if ((event.key === "f" || event.key === "F") && !typing && state.mode !== "docs") {
        setFitToken((value) => value + 1);
      } else if ((event.key === "l" || event.key === "L") && !typing && state.mode !== "docs") {
        const order = ["off", "auto", "on"] as const;
        const next = order[(order.indexOf(state.labelMode) + 1) % order.length];
        setState((current) => ({ ...current, labelMode: next }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.labelMode, state.mode]);

  const docsEnabled = health?.shelves.enabled ?? shelvesEnabled;
  const modes = useMemo(() => [
    { value: "rules", label: m.auditRules },
    { value: "docs", label: m.auditDocs, disabled: !docsEnabled },
    { value: "unified", label: m.auditUnified, disabled: !docsEnabled },
  ], [docsEnabled, m]);

  return (
    <Stack gap="sm" className="audit-page" data-testid="audit-page">
      <LoadingOverlay visible={loading && !graph} />
      <Group justify="space-between" wrap="nowrap">
        <Title order={3}>{m.audit}</Title>
        <Group gap="xs" wrap="nowrap">
          <SegmentedControl
            data={modes}
            value={state.mode}
            onChange={(mode) => setState((current) => ({ ...current, mode: mode as AuditUrlState["mode"], selectedId: "" }))}
          />
          <Button size="xs" variant="default" data-testid="audit-help" onClick={() => setHelpOpen(true)}>{m.auditHelp}</Button>
          <Button size="xs" variant="subtle" onClick={() => void refresh()}>{m.refresh}</Button>
        </Group>
      </Group>
      {offline && <Alert color="yellow">{m.auditOffline}</Alert>}
      {error && <Alert color="red">{error}</Alert>}
      {!graph && !loading && !offline && <Alert color="yellow">{m.deskNeedHost}</Alert>}
      {graph && state.mode === "rules" && (
        <RulesWorkspace
          data={graph}
          filters={state.filters}
          onFilters={(filters) => setState((current) => ({ ...current, filters }))}
          view={state.view}
          onView={(view) => setState((current) => ({ ...current, view }))}
          selectedId={state.selectedId}
          onSelect={(selectedId) => setState((current) => ({ ...current, selectedId }))}
          labels={state.labelMode}
          onLabels={(labelMode) => setState((current) => ({ ...current, labelMode }))}
          edgeKinds={edgeKinds}
          onEdgeKinds={setEdgeKinds}
          fitToken={fitToken}
          onFit={() => setFitToken((value) => value + 1)}
          m={m}
        />
      )}
      {state.mode === "docs" && (
        <DocsWorkspace
          enabled={docsEnabled}
          query={state.docQuery}
          onQuery={(docQuery) => setState((current) => ({ ...current, docQuery }))}
        />
      )}
      {state.mode === "unified" && unified && (
        <UnifiedWorkspace
          unified={unified}
          query={state.filters.query}
          scopes={state.filters.scopes}
          onQuery={(query) => setState((current) => ({ ...current, filters: { ...current.filters, query } }))}
          onScopes={(scopes) => setState((current) => ({ ...current, filters: { ...current.filters, scopes } }))}
          selectedId={state.selectedId}
          onSelect={(selectedId) => setState((current) => ({ ...current, selectedId }))}
          labels={state.labelMode}
          onLabels={(labelMode) => setState((current) => ({ ...current, labelMode }))}
          fitToken={fitToken}
          onFit={() => setFitToken((value) => value + 1)}
          m={m}
        />
      )}
      <AuditHelp opened={helpOpen} onClose={() => setHelpOpen(false)} m={m} />
    </Stack>
  );
}
