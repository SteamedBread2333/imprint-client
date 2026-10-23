import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppShell,
  Button,
  Group,
  Modal,
  NavLink,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import {
  type AppConfig,
  type Snapshot,
  cancelActiveJob,
  releaseActiveJob,
  checkPrerequisites,
  ensureRuntime,
  getConfig,
  getRuntimeStatus,
  getSnapshot,
  imprintUpDown,
  openProject,
  pickProjectFolder,
  revealInFinder,
  runImprint,
  runSidecarSetup,
  saveConfig,
  startSidecarLogTail,
  stopSidecarLogTail,
  subscribeJobFinished,
  subscribeJobOutput,
  updateRuntimeComponent,
  type RuntimeStatus,
} from "./platform/tauri/api";
import { Header } from "./components/Header";
import { EmbedWizard } from "./components/EmbedWizard";
import { DashboardPage } from "./features/ops/DashboardPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { DeskPage } from "./features/audit/DeskPage";
import { APP_NAME, type Locale, t } from "./i18n";
import "./App.css";

type Page = "dashboard" | "audit" | "settings";

const LOG_STREAM = "main-log";
const START_WAIT_MS = 20_000;

type StartMark = { at: number; settled: boolean } | null;
type StartWatch = { host: StartMark; embed: StartMark };

function armStart(): StartMark {
  return { at: Date.now(), settled: false };
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
        embed: prev.embed != null && embedUp ? null : prev.embed,
      };
      if (next.host === prev.host && next.embed === prev.embed) {
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
      await openProject(path);
      const c = await getConfig();
      setCfg(c);
      setPage("dashboard");
      setShowEmbedWizard(false);
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
      }));
    }
    try {
      await imprintUpDown(up);
      await refresh();
    } catch (e) {
      if (up) setStartWatch((prev) => ({ ...prev, host: null }));
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
          data-testid="nav-dashboard"
          label={m.navOverview}
          active={page === "dashboard"}
          onClick={() => {
            setPage("dashboard");
            setShowEmbedWizard(false);
          }}
        />
        <NavLink
          data-testid="nav-audit"
          label={m.navAudit}
          active={page === "audit"}
          disabled={!cfg.projectRoot}
          onClick={() => {
            setPage("audit");
            setShowEmbedWizard(false);
          }}
        />
        <NavLink
          label={m.navSettings}
          active={page === "settings"}
          onClick={() => setPage("settings")}
        />
      </AppShell.Navbar>
      <AppShell.Main className={page === "audit" ? "audit-shell" : undefined}>
        {page !== "audit" && (
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
        )}

        {((snap?.hint && page === "dashboard" && !showEmbedWizard) || notice || error || snap?.yamlError) && (
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
        )}

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
          <DashboardPage
            hasProject={!!cfg.projectRoot}
            m={m}
            snap={snap}
            busy={busy}
            hostUp={hostUp}
            embedReady={embedReady}
            onRefresh={refresh}
            onStack={stackUpDown}
            pendingHost={startWatch.host != null}
            pendingEmbed={startWatch.embed != null}
            onCancelJob={() =>
              cancelActiveJob().then(() => {
                setBusy(false);
                setStartWatch((prev) => ({ ...prev, embed: null }));
              })
            }
            onOpenAudit={() => setPage("audit")}
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

        {page === "audit" && snap && (
          <DeskPage
            vaultKey={snap.vault}
            hostUp={hostUp}
            shelvesEnabled={snap.shelves.enabled}
            m={m}
          />
        )}

        {page === "settings" && cfg && (
          <SettingsPage
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
