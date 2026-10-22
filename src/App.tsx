import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  AppShell,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NavLink,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  AppConfig,
  Snapshot,
  cancelActiveJob,
  releaseActiveJob,
  checkPrerequisites,
  ensureRuntime,
  getConfig,
  getGlobalEmbed,
  getRuntimeStatus,
  getSnapshot,
  imprintUpDown,
  openProject,
  openExternalUrl,
  pickProjectFolder,
  revealInFinder,
  runImprint,
  runSidecarSetup,
  saveConfig,
  saveGlobalEmbed,
  startSidecarLogTail,
  stopSidecarLogTail,
  subscribeJobFinished,
  subscribeJobOutput,
  updateRuntimeComponent,
  type GlobalEmbedDoc,
  type RuntimeStatus,
} from "./api";
import { Header } from "./components/Header";
import { EmbedWizard } from "./components/EmbedWizard";
import { StatusPill } from "./components/StatusPill";
import { APP_NAME, type Locale, t } from "./i18n";
import "./App.css";

type Page = "dashboard" | "settings";

const LOG_STREAM = "main-log";
const START_WAIT_MS = 20_000;

type StartMark = { at: number; settled: boolean } | null;
type StartWatch = { host: StartMark; desk: StartMark; embed: StartMark };

function armStart(): StartMark {
  return { at: Date.now(), settled: false };
}
type ServicePhase = "running" | "stopped" | "starting";

function servicePhase(up: boolean, pending: boolean): ServicePhase {
  if (up) return "running";
  if (pending) return "starting";
  return "stopped";
}

function projectName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function projectOptionLabel(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const name = parts[parts.length - 1] ?? path;
  if (parts.length < 2) return path;
  const parent = normalized.slice(0, normalized.length - name.length).replace(/\/$/, "");
  return `${name} — ${parent}`;
}

function localeFromCfg(cfg: AppConfig | null): Locale {
  return cfg?.locale === "en" ? "en" : "zh";
}

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [showEmbedWizard, setShowEmbedWizard] = useState(false);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [wizardStep, setWizardStep] = useState(0);
  const [prereq, setPrereq] = useState("");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [bootDismissed, setBootDismissed] = useState(false);
  const [switchingProject, setSwitchingProject] = useState(false);
  const [startWatch, setStartWatch] = useState<StartWatch>({
    host: null,
    desk: null,
    embed: null,
  });
  const busyRef = useRef(false);
  const startWatchRef = useRef(startWatch);
  busyRef.current = busy;
  startWatchRef.current = startWatch;
  const locale = localeFromCfg(cfg);
  const m = useMemo(() => t(locale), [locale]);
  const appName = APP_NAME[locale];
  const wizardSteps = m.wizardSteps;

  const refresh = useCallback(async () => {
    try {
      const s = await getSnapshot();
      setSnap(s);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshRuntime = useCallback(async () => {
    try {
      const rs = await getRuntimeStatus();
      setRuntimeStatus(rs);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await getConfig();
        if (!cancelled) setCfg(c);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
      if (!cancelled) void refreshRuntime();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshRuntime]);

  useEffect(() => {
    if (!cfg) return;
    let cancelled = false;
    let tmr: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      if (cancelled) return;
      void refresh();
    };
    const startPoll = window.setTimeout(() => {
      tick();
      const ms = cfg.pollIntervalMs || 2500;
      tmr = setInterval(tick, ms);
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(startPoll);
      if (tmr) clearInterval(tmr);
    };
  }, [cfg, cfg?.projectRoot, cfg?.pollIntervalMs, refresh]);

  useEffect(() => {
    if (!snap) return;
    const embedUp = snap.embed.running || snap.embedHealth?.ok === true;
    setStartWatch((prev) => {
      const next: StartWatch = {
        host: prev.host != null && snap.host.listening ? null : prev.host,
        desk: prev.desk != null && snap.desk.listening ? null : prev.desk,
        embed: prev.embed != null && embedUp ? null : prev.embed,
      };
      if (next.host === prev.host && next.desk === prev.desk && next.embed === prev.embed) {
        return prev;
      }
      return next;
    });
  }, [snap]);

  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      const now = Date.now();
      const settle = (mark: StartMark): StartMark =>
        mark == null ? null : { at: now, settled: true };
      setStartWatch((prev) => ({
        host: settle(prev.host),
        desk: settle(prev.desk),
        embed: settle(prev.embed),
      }));
    }
    wasBusy.current = busy;
  }, [busy]);

  const startUnconfirmed = m.startUnconfirmed;
  useEffect(() => {
    const id = window.setInterval(() => {
      if (busyRef.current) return;
      const prev = startWatchRef.current;
      const now = Date.now();
      const expired: string[] = [];
      const take = (mark: StartMark, name: string) => {
        if (mark != null && mark.settled && now - mark.at > START_WAIT_MS) {
          expired.push(name);
          return null;
        }
        return mark;
      };
      const next = {
        host: take(prev.host, "Host"),
        desk: take(prev.desk, "Desk"),
        embed: take(prev.embed, "Embed"),
      };
      if (expired.length === 0) return;
      startWatchRef.current = next;
      setStartWatch(next);
      setNotice(`${startUnconfirmed}: ${expired.join("、")}`);
    }, 1000);
    return () => window.clearInterval(id);
  }, [startUnconfirmed]);

  useEffect(() => {
    let unlistenOut: (() => void) | undefined;
    let unlistenDone: (() => void) | undefined;
    subscribeJobOutput((p) => {
      if (p.streamId !== LOG_STREAM) return;
      const line = `[${p.kind}] ${p.line}`;
      setLogLines((prev) => {
        if (prev.length > 0 && prev[prev.length - 1] === line) return prev;
        return [...prev, line];
      });
      if (p.line.includes("health check failed on port")) {
        setError(m.healthCheckFailed);
      }
    }).then((u) => {
      unlistenOut = u;
    });
    subscribeJobFinished(async (id) => {
      if (id !== LOG_STREAM) return;
      setBusy(false);
      void getRuntimeStatus().then((rs) => {
        setRuntimeStatus(rs);
        if (rs.ready) setBootDismissed(true);
        const imp = rs.components.find((c) => c.name === "imprint");
        if (imp?.version) {
          setNotice(`${m.runtimeUpdated}: imprint ${imp.version}`);
        }
      });
      const s = await getSnapshot();
      setSnap(s);
      if (s.embedHealth?.ok) {
        setError("");
        setNotice(
          m.sidecarUpNotice +
            (s.embedHealth.ready ? m.sidecarReady : m.sidecarNotReady),
        );
      }
      void refreshRuntime();
      if (showEmbedWizard) {
        startSidecarLogTail(LOG_STREAM).catch(() => {});
      }
    }).then((u) => {
      unlistenDone = u;
    });
    return () => {
      unlistenOut?.();
      unlistenDone?.();
    };
  }, [refresh, showEmbedWizard, m]);

  const onRevealPath = async (target: string) => {
    if (!target.trim()) return;
    setError("");
    try {
      await revealInFinder(target);
      setNotice(m.revealedInFinder);
    } catch (e) {
      setError(String(e));
    }
  };

  const openProjectPath = async (path: string) => {
    if (switchingProject) return;
    setSwitchingProject(true);
    setError("");
    setNotice("");
    try {
      const opened = await openProject(path);
      const c = await getConfig();
      setCfg(c);
      setPage("dashboard");
      setShowEmbedWizard(false);
      if (opened.stoppedStack) setNotice(m.stoppedPreviousStack);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSwitchingProject(false);
    }
  };

  const onPickProject = async () => {
    const picked = await pickProjectFolder();
    if (!picked) return;
    await openProjectPath(picked);
  };

  const setLocale = async (next: Locale) => {
    let base = cfg;
    if (!base) {
      try {
        base = await getConfig();
      } catch {
        return;
      }
    }
    const nextCfg = { ...base, locale: next };
    await saveConfig(nextCfg);
    setCfg(nextCfg);
  };

  const runJob = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await releaseActiveJob().catch(() => false);
      await fn();
      return true;
    } catch (e) {
      setBusy(false);
      setError(String(e));
      return false;
    }
  };

  const stackUpDown = async (up: boolean) => {
    setBusy(true);
    setError("");
    if (up) {
      const mark = armStart();
      setStartWatch((prev) => ({
        ...prev,
        host: snap?.host.listening ? null : mark,
        desk: snap?.desk.listening ? null : mark,
      }));
    }
    try {
      await imprintUpDown(up);
      await refresh();
    } catch (e) {
      if (up) setStartWatch((prev) => ({ ...prev, host: null, desk: null }));
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const embedReady = snap?.embedHealth?.ready === true;
  const hostUp = snap?.host.listening === true;

  const runWizardStep = async (step: number) => {
    setWizardStep(step);
    if (step === 0) {
      const p = await checkPrerequisites();
      setPrereq(`${m.prereqPython} ${p.pythonVersion} · sidecar ${p.embedPackage}`);
      return;
    }
    if (step === 1) {
      await runJob(() => runSidecarSetup(LOG_STREAM));
      return;
    }
    if (step === 2) {
      await runJob(() => runImprint(LOG_STREAM, ["embed", "prepare"]));
      return;
    }
    if (step === 3) {
      setError("");
      const s = await getSnapshot();
      const alreadyUp =
        s.embed.running || s.embedHealth?.ok === true || s.embed.healthy;
      if (alreadyUp) {
        setPrereq(m.sidecarAlreadyUp);
        try {
          await startSidecarLogTail(LOG_STREAM);
        } catch (e) {
          setError(String(e));
        }
        return;
      }
      setStartWatch((prev) => ({ ...prev, embed: armStart() }));
      const started = await runJob(async () => {
        await runImprint(LOG_STREAM, ["plugin", "start", "embed"]);
      });
      if (!started) setStartWatch((prev) => ({ ...prev, embed: null }));
    }
  };

  const onLocale = (next: Locale) => {
    void setLocale(next);
  };

  const showBoot =
    !bootDismissed && runtimeStatus !== null && !runtimeStatus.ready;

  if (!cfg) {
    return (
      <AppShell header={{ height: 56 }} padding="lg">
        <AppShell.Header>
          <Header title={appName} subtitle={m.tagline} locale={locale} onLocale={onLocale} m={m} />
        </AppShell.Header>
        <AppShell.Main>
          <Text c="dimmed" maw={560}>
            {m.welcomeLead}
          </Text>
        </AppShell.Main>
      </AppShell>
    );
  }

  const recentProjects = [
    ...new Set([
      ...(cfg.projectRoot ? [cfg.projectRoot] : []),
      ...(cfg.recentProjects ?? []),
    ]),
  ];

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 200, breakpoint: 0 }} padding="md">
      <AppShell.Header>
        <Header title={appName} subtitle={m.tagline} locale={locale} onLocale={onLocale} m={m} />
      </AppShell.Header>
      <Modal
        opened={showBoot}
        onClose={() => setBootDismissed(true)}
        title={m.runtimeTitle}
        centered
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {m.runtimeLead}
          </Text>
          <ScrollArea h={140}>
            <Text size="xs" ff="monospace" style={{ whiteSpace: "pre-wrap" }}>
              {logLines.slice(-8).join("\n") || m.noLogs}
            </Text>
          </ScrollArea>
          <Group>
            <Button
              size="xs"
              disabled={busy}
              onClick={() =>
                runJob(async () => {
                  await ensureRuntime(LOG_STREAM);
                })
              }
            >
              {m.runtimeEnsure}
            </Button>
            <Button size="xs" variant="subtle" onClick={() => setBootDismissed(true)}>
              {m.skipProject}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <AppShell.Navbar p="sm">
        <NavLink
          label={m.navOverview}
          active={page === "dashboard"}
          onClick={() => {
            setPage("dashboard");
            setShowEmbedWizard(false);
          }}
        />
        <NavLink
          label={m.navSettings}
          active={page === "settings"}
          onClick={() => setPage("settings")}
        />
      </AppShell.Navbar>
      <AppShell.Main>
        <Paper withBorder p="md" radius="md" mb="md">
          <Group justify="space-between" align="flex-end" wrap="nowrap">
            <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
              <Text size="xs" c="dimmed">
                {m.currentProject}
              </Text>
              {recentProjects.length > 1 ? (
                <Select
                  aria-label={m.recentPlaceholder}
                  data={recentProjects.map((path) => ({
                    value: path,
                    label: projectOptionLabel(path),
                  }))}
                  value={cfg.projectRoot || null}
                  disabled={switchingProject}
                  allowDeselect={false}
                  onChange={(next) => {
                    if (next && next !== cfg.projectRoot) void openProjectPath(next);
                  }}
                />
              ) : (
                <Text fw={600}>
                  {cfg.projectRoot ? projectName(cfg.projectRoot) : m.projectOptional}
                </Text>
              )}
              {cfg.projectRoot && (
                <Text size="xs" c="dimmed" ff="monospace" truncate title={cfg.projectRoot}>
                  {cfg.projectRoot}
                </Text>
              )}
            </Stack>
            <Group gap="xs" wrap="nowrap">
              {cfg.projectRoot && (
                <Button size="xs" variant="subtle" onClick={() => onRevealPath(cfg.projectRoot)}>
                  {m.openInFinder}
                </Button>
              )}
              <Button size="xs" variant="subtle" disabled={switchingProject} onClick={onPickProject}>
                {recentProjects.length > 0 ? m.pickAnother : m.pickProject}
              </Button>
            </Group>
          </Group>
        </Paper>

        <Stack gap="sm" mb="md">
          {snap?.hint && page === "dashboard" && !showEmbedWizard && (
            <Text size="sm" c="dimmed">
              {snap.hint}
            </Text>
          )}
          {notice && (
            <Alert variant="light">
              {notice}
            </Alert>
          )}
          {(error || snap?.yamlError) && (
            <Alert variant="light" color="red">
              {error || snap?.yamlError}
            </Alert>
          )}
        </Stack>

        {page === "dashboard" && showEmbedWizard && (
          <EmbedWizard
            m={m}
            snap={snap}
            wizardStep={wizardStep}
            prereq={prereq}
            wizardSteps={wizardSteps}
            logLines={logLines}
            busy={busy}
            onBack={() => setShowEmbedWizard(false)}
            onStep={runWizardStep}
            embedStarting={startWatch.embed != null}
            onCancel={() =>
              cancelActiveJob().then(() => {
                setBusy(false);
                setStartWatch((prev) => ({ ...prev, embed: null }));
              })
            }
            onClearLogs={() => setLogLines([])}
          />
        )}

        {page === "dashboard" && !showEmbedWizard && snap && (
          <Dashboard
            hasProject={!!cfg.projectRoot}
            m={m}
            snap={snap}
            busy={busy}
            hostUp={hostUp}
            embedReady={embedReady}
            onRefresh={refresh}
            onStack={stackUpDown}
            pendingHost={startWatch.host != null}
            pendingDesk={startWatch.desk != null}
            pendingEmbed={startWatch.embed != null}
            onCancelJob={() =>
              cancelActiveJob().then(() => {
                setBusy(false);
                setStartWatch((prev) => ({ ...prev, embed: null }));
              })
            }
            onOpenDesk={() => openExternalUrl(snap.deskUrl)}
            onRevealVault={() => onRevealPath(snap.vault)}
            onOpenEmbedWizard={() => setShowEmbedWizard(true)}
            onEmbedStart={async () => {
              const s = await getSnapshot();
              if (s.embed.running || s.embedHealth?.ok) {
                setError("");
                await refresh();
                return;
              }
              setStartWatch((prev) => ({ ...prev, embed: armStart() }));
              const started = await runJob(() => runImprint(LOG_STREAM, ["plugin", "start", "embed"]));
              if (!started) setStartWatch((prev) => ({ ...prev, embed: null }));
            }}
            onEmbedStop={() =>
              runJob(async () => {
                await stopSidecarLogTail();
                await runImprint(LOG_STREAM, ["plugin", "stop", "embed"]);
              })
            }
          />
        )}

        {page === "settings" && cfg && (
          <Settings
            m={m}
            cfg={cfg}
            locale={locale}
            runtimeStatus={runtimeStatus}
            busy={busy}
            onEnsureRuntime={() => runJob(() => ensureRuntime(LOG_STREAM))}
            onUpdateComponent={(name) => {
              setLogLines([]);
              runJob(() => updateRuntimeComponent(name, LOG_STREAM));
            }}
            onSave={(c) => saveConfig(c).then(() => setCfg(c))}
            onEmbedSaved={(msg) => {
              setError("");
              setNotice(msg);
            }}
            onRefreshRuntime={refreshRuntime}
            runtimeLogLines={logLines}
          />
        )}
      </AppShell.Main>
    </AppShell>
  );
}

function Dashboard({
  m,
  snap,
  hasProject,
  busy,
  hostUp,
  embedReady,
  onRefresh,
  onStack,
  pendingHost,
  pendingDesk,
  pendingEmbed,
  onCancelJob,
  onOpenDesk,
  onRevealVault,
  onOpenEmbedWizard,
  onEmbedStart,
  onEmbedStop,
}: {
  m: ReturnType<typeof t>;
  snap: Snapshot;
  hasProject: boolean;
  busy: boolean;
  hostUp: boolean;
  embedReady: boolean;
  onRefresh: () => void;
  onStack: (up: boolean) => void;
  pendingHost: boolean;
  pendingDesk: boolean;
  pendingEmbed: boolean;
  onCancelJob: () => void;
  onOpenDesk: () => void;
  onRevealVault: () => void;
  onOpenEmbedWizard: () => void;
  onEmbedStart: () => void;
  onEmbedStop: () => void;
}) {
  const embedUp = snap.embed.running || snap.embedHealth?.ok === true;
  const embedPhase = servicePhase(embedUp, pendingEmbed);
  const runLabel = m.running;
  const stopLabel = m.stopped;
  const waitLabel = m.starting;

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>{m.serviceOverview}</Title>
        <Group gap="xs">
          {busy && (
            <Button size="xs" variant="subtle" onClick={onCancelJob}>
              {m.cancelJob}
            </Button>
          )}
          <Button size="xs" variant="subtle" onClick={onRefresh} disabled={busy}>
            {m.refresh}
          </Button>
        </Group>
      </Group>

      <Stack gap="sm">
        <Group gap="xs">
          <Title order={4}>{m.scopeGlobal}</Title>
          <Badge variant="outline">
            Global
          </Badge>
        </Group>
        <Text size="sm" c="dimmed">
          {m.scopeGlobalHint}
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <ServiceCard
            title={m.embed}
            port={snap.embed.port}
            phase={embedPhase}
            runLabel={runLabel}
            stopLabel={stopLabel}
            waitLabel={waitLabel}
            extra={
              embedPhase === "starting"
                ? m.starting
                : embedReady
                  ? m.embedReady
                  : snap.embedHealth?.ok
                    ? m.embedUpNotReady
                    : snap.embed.running
                      ? m.embedUpWait
                      : snap.embed.error || m.embedDown
            }
            pills={
              <>
                {snap.embed.healthy && <StatusPill label="healthy" tone="ok" />}
                {embedReady && <StatusPill label="ready" tone="ok" />}
              </>
            }
            actions={
              <>
                <Button size="xs" disabled={busy} onClick={onEmbedStart}>
                  {m.embedStart}
                </Button>
                <Button size="xs" variant="default" disabled={busy} onClick={onEmbedStop}>
                  {m.embedStop}
                </Button>
                <Button size="xs" variant="subtle" onClick={onOpenEmbedWizard}>
                  {m.embedWizardOpen}
                </Button>
              </>
            }
          />
        </SimpleGrid>
      </Stack>

      {hasProject && (
      <Stack gap="sm">
        <Group gap="xs">
          <Title order={4}>{m.scopeProject}</Title>
          <Badge variant="outline">Project</Badge>
        </Group>
        <Text size="sm" c="dimmed">
          {m.scopeProjectHint}
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <ServiceCard
            title={m.host}
            port={snap.host.port}
            phase={servicePhase(snap.host.listening, pendingHost)}
            runLabel={runLabel}
            stopLabel={stopLabel}
            waitLabel={waitLabel}
            extra={`${m.rules} ${snap.host.rules ?? 0}`}
            actions={
              <>
                <Button size="xs" disabled={busy} onClick={() => onStack(true)}>
                  {m.stackUp}
                </Button>
                <Button size="xs" variant="default" disabled={busy} onClick={() => onStack(false)}>
                  {m.stackDown}
                </Button>
              </>
            }
          />
          <ServiceCard
            title={m.shelves}
            port={0}
            phase={servicePhase(snap.shelves.indexed, false)}
            runLabel={runLabel}
            stopLabel={stopLabel}
            waitLabel={waitLabel}
            extra={
              snap.shelves.enabled
                ? `indexed: ${snap.shelves.indexed ? m.indexedYes : m.indexedNo} · roots: ${(snap.shelves.roots ?? []).join(", ") || "—"}`
                : m.shelvesOff
            }
            actions={
              <Text size="xs" c="dimmed">
                {m.shelvesHint}
              </Text>
            }
          />
          <ServiceCard
            title={m.desk}
            port={snap.desk.port}
            phase={servicePhase(snap.desk.listening, pendingDesk)}
            runLabel={runLabel}
            stopLabel={stopLabel}
            waitLabel={waitLabel}
            extra={hostUp ? snap.deskUrl : m.deskNeedHost}
            actions={
              <Button size="xs" variant="default" disabled={!hostUp} onClick={onOpenDesk}>
                {m.openBrowser}
              </Button>
            }
          />
          <Card withBorder padding="md" radius="md">
            <Text fw={600} mb="sm">
              {m.vault}
            </Text>
            <Text size="sm" c="dimmed" ff="monospace" lineClamp={3} title={snap.vault}>
              {snap.vault || "—"}
            </Text>
            <Group mt="md">
              <Button size="xs" variant="subtle" disabled={!snap.vault} onClick={onRevealVault}>
                {m.openInFinder}
              </Button>
            </Group>
          </Card>
        </SimpleGrid>
      </Stack>
      )}
    </Stack>
  );
}

function ServiceCard({
  title,
  port,
  phase,
  extra,
  actions,
  pills,
  runLabel,
  stopLabel,
  waitLabel,
}: {
  title: string;
  port: number;
  phase: ServicePhase;
  extra: string;
  actions: ReactNode;
  pills?: ReactNode;
  runLabel: string;
  stopLabel: string;
  waitLabel: string;
}) {
  const label = phase === "running" ? runLabel : phase === "starting" ? waitLabel : stopLabel;
  const color = phase === "running" ? "teal" : phase === "starting" ? "yellow" : "gray";
  return (
    <Card withBorder padding="md" radius="md">
      <Group justify="space-between" mb="sm">
        <Text fw={600}>{title}</Text>
        {port > 0 && (
          <Text size="xs" c="dimmed" ff="monospace">
            {port}
          </Text>
        )}
      </Group>
      <Badge variant="dot" color={color} size="sm">
        {label}
      </Badge>
      {pills && (
        <Group gap={6} mt="xs">
          {pills}
        </Group>
      )}
      <Text size="sm" c="dimmed" mt="sm" style={{ minHeight: 40 }}>
        {extra}
      </Text>
      <Group mt="md" gap="xs">
        {actions}
      </Group>
    </Card>
  );
}

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
  let n: number | null = null;
  if (typeof v === "number" && Number.isFinite(v)) n = v;
  else if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) n = Number(v);
  if (n == null) return String(fallback);
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1000) / 1000);
}

function embedFormFromDoc(doc: GlobalEmbedDoc): EmbedForm {
  const c = doc.config ?? {};
  const bidirectional = c.relate_bidirectional;
  return {
    enabled: doc.enabled,
    package: doc.package,
    port: numField(c.port, EMBED_DEFAULTS.port),
    model: typeof c.model === "string" && c.model.trim() ? c.model : EMBED_DEFAULTS.model,
    duplicateThreshold: numField(c.duplicate_threshold, EMBED_DEFAULTS.duplicateThreshold),
    relateContradictionMin: numField(c.relate_contradiction_min, EMBED_DEFAULTS.relateContradictionMin),
    relateEntailmentMin: numField(c.relate_entailment_min, EMBED_DEFAULTS.relateEntailmentMin),
    relateBidirectional:
      typeof bidirectional === "boolean" ? bidirectional : EMBED_DEFAULTS.relateBidirectional,
    timeoutSeconds: numField(c.timeout_seconds, EMBED_DEFAULTS.timeoutSeconds),
  };
}

function parseIntInRange(raw: string, min: number, max: number): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function parseUnitInterval(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

type EmbedFieldError = "port" | "model" | "threshold" | "timeout";

function embedFormError(form: EmbedForm): EmbedFieldError | null {
  if (parseIntInRange(form.port, 1, 65535) == null) return "port";
  if (!form.model.trim()) return "model";
  if (
    parseUnitInterval(form.duplicateThreshold) == null ||
    parseUnitInterval(form.relateContradictionMin) == null ||
    parseUnitInterval(form.relateEntailmentMin) == null
  ) {
    return "threshold";
  }
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

function Settings({
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
  m: ReturnType<typeof t>;
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
    getGlobalEmbed()
      .then((doc) => {
        if (cancelled) return;
        setEmbedDoc(doc);
        setEmbedForm(embedFormFromDoc(doc));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [runtimeStatus?.ready]);

  const saveEmbed = async () => {
    if (!embedForm || !embedDoc) return;
    const invalid = embedFormError(embedForm);
    if (invalid === "port") {
      setEmbedError(m.embedInvalidPort);
      return;
    }
    if (invalid === "model") {
      setEmbedError(m.embedInvalidModel);
      return;
    }
    if (invalid === "threshold") {
      setEmbedError(m.embedInvalidThreshold);
      return;
    }
    if (invalid === "timeout") {
      setEmbedError(m.embedInvalidTimeout);
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

  return (
    <Stack gap="lg" maw={760}>
      <Title order={3}>{m.settings}</Title>
      <Stack gap="sm">
        <Title order={4}>{m.runtimeTitle}</Title>
        <Text size="sm" c="dimmed">
          {runtimeStatus?.ready ? m.runtimeReady : m.runtimeNotReady}
        </Text>
        <Group>
          <Button size="xs" disabled={busy} onClick={onEnsureRuntime}>
            {m.runtimeEnsure}
          </Button>
          <Button size="xs" variant="subtle" disabled={busy} onClick={onRefreshRuntime}>
            {m.refresh}
          </Button>
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
                <Text span fw={600}>
                  {c.name}
                </Text>{" "}
                {c.installed
                  ? c.latest && c.version && c.latest !== c.version
                    ? `${c.version} → ${c.latest}`
                    : c.version || "ok"
                  : c.latest
                    ? `— → ${c.latest}`
                    : "—"}{" "}
                ·{" "}
                <Text span ff="monospace" size="xs">
                  {c.path || "—"}
                </Text>
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
        <Text size="sm" c="dimmed">
          {m.globalEmbedHint}
        </Text>
        {embedForm && (
          <>
            <Switch
              label={m.globalEmbedEnabled}
              checked={embedForm.enabled}
              onChange={(e) => setEmbedForm({ ...embedForm, enabled: e.currentTarget.checked })}
            />
            <TextInput label="package" value={embedForm.package} readOnly styles={monoInput} />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <NumberInput
                label={m.embedPort}
                description="port"
                min={1}
                max={65535}
                value={embedForm.port}
                onChange={(v) => setEmbedForm({ ...embedForm, port: v === "" ? "" : String(v) })}
              />
              <NumberInput
                label={m.embedTimeout}
                description="timeout_seconds"
                min={1}
                max={3600}
                value={embedForm.timeoutSeconds}
                onChange={(v) =>
                  setEmbedForm({ ...embedForm, timeoutSeconds: v === "" ? "" : String(v) })
                }
              />
              <NumberInput
                label={m.embedDuplicate}
                description="duplicate_threshold"
                min={0}
                max={1}
                step={0.01}
                decimalScale={2}
                value={embedForm.duplicateThreshold}
                onChange={(v) =>
                  setEmbedForm({ ...embedForm, duplicateThreshold: v === "" ? "" : String(v) })
                }
              />
              <NumberInput
                label={m.embedContradiction}
                description="relate_contradiction_min"
                min={0}
                max={1}
                step={0.01}
                decimalScale={2}
                value={embedForm.relateContradictionMin}
                onChange={(v) =>
                  setEmbedForm({
                    ...embedForm,
                    relateContradictionMin: v === "" ? "" : String(v),
                  })
                }
              />
              <NumberInput
                label={m.embedEntailment}
                description="relate_entailment_min"
                min={0}
                max={1}
                step={0.01}
                decimalScale={2}
                value={embedForm.relateEntailmentMin}
                onChange={(v) =>
                  setEmbedForm({ ...embedForm, relateEntailmentMin: v === "" ? "" : String(v) })
                }
              />
            </SimpleGrid>
            <TextInput
              label={m.embedModel}
              description="model"
              value={embedForm.model}
              styles={monoInput}
              onChange={(e) => setEmbedForm({ ...embedForm, model: e.currentTarget.value })}
            />
            <Switch
              label={m.embedBidirectional}
              description="relate_bidirectional"
              checked={embedForm.relateBidirectional}
              onChange={(e) =>
                setEmbedForm({ ...embedForm, relateBidirectional: e.currentTarget.checked })
              }
            />
            {embedError && (
              <Alert variant="light" color="red">
                {embedError}
              </Alert>
            )}
            <Group>
              <Button size="xs" onClick={() => void saveEmbed()}>
                {m.save}
              </Button>
            </Group>
          </>
        )}
      </Stack>

      <Stack gap="sm">
        <Title order={4}>{m.settings}</Title>
        <TextInput
          label={m.imprintBin}
          description={m.imprintBinHint}
          value={draft.imprintBin}
          styles={monoInput}
          placeholder="imprint 或绝对路径"
          onChange={(e) => setDraft({ ...draft, imprintBin: e.currentTarget.value })}
        />
        <NumberInput
          label={m.pollMs}
          value={draft.pollIntervalMs}
          min={500}
          onChange={(v) =>
            setDraft({ ...draft, pollIntervalMs: typeof v === "number" ? v : Number(v) || 2500 })
          }
        />
        <TextInput
          label={m.hfEndpoint}
          value={draft.hfEndpoint}
          placeholder="https://hf-mirror.com"
          onChange={(e) => setDraft({ ...draft, hfEndpoint: e.currentTarget.value })}
        />
        <TextInput
          label={m.imprintHf}
          value={draft.imprintHfEndpoint}
          onChange={(e) => setDraft({ ...draft, imprintHfEndpoint: e.currentTarget.value })}
        />
        <Group>
          <Button size="xs" onClick={() => onSave({ ...draft, locale })}>
            {m.save}
          </Button>
        </Group>
      </Stack>
    </Stack>
  );
}
