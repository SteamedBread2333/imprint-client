import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
      <div className="app-frame welcome">
        <Header title={appName} subtitle={m.tagline} locale={locale} onLocale={onLocale} m={m} />
        <p className="lede">{m.welcomeLead}</p>
      </div>
    );
  }

  const recentProjects = [
    ...new Set([
      ...(cfg.projectRoot ? [cfg.projectRoot] : []),
      ...(cfg.recentProjects ?? []),
    ]),
  ];

  return (
    <div className="app-frame">
      <Header title={appName} subtitle={m.tagline} locale={locale} onLocale={onLocale} m={m} />
      {showBoot && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>{m.runtimeTitle}</h2>
            <p className="muted">{m.runtimeLead}</p>
            <div className="log-panel mini">{logLines.slice(-8).join("\n") || m.noLogs}</div>
            <div className="row">
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  runJob(async () => {
                    await ensureRuntime(LOG_STREAM);
                  })
                }
              >
                {m.runtimeEnsure}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setBootDismissed(true)}
              >
                {m.skipProject}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="app-body">
      <aside className="sidebar">
        <nav>
          <button
            type="button"
            className={page === "dashboard" ? "nav active" : "nav"}
            onClick={() => {
              setPage("dashboard");
              setShowEmbedWizard(false);
            }}
          >
            {m.navOverview}
          </button>
          <button
            type="button"
            className={page === "settings" ? "nav active" : "nav"}
            onClick={() => setPage("settings")}
          >
            {m.navSettings}
          </button>
        </nav>
      </aside>

      <main className="main">
        <div className="project-bar">
          <div className="project-bar-label">{m.currentProject}</div>
          {recentProjects.length > 0 && (
            <select
              className="project-select mono"
              value={cfg.projectRoot}
              aria-label={m.recentPlaceholder}
              disabled={switchingProject}
              onChange={(e) => {
                const next = e.target.value;
                if (next && next !== cfg.projectRoot) void openProjectPath(next);
              }}
            >
              {!cfg.projectRoot && <option value="">{m.recentPlaceholder}</option>}
              {recentProjects.map((path) => (
                <option key={path} value={path} title={path}>
                  {projectOptionLabel(path)}
                </option>
              ))}
            </select>
          )}
          <div className="project-bar-path mono" title={cfg.projectRoot || m.projectOptional}>
            {cfg.projectRoot || m.projectOptional}
          </div>
          <div className="project-bar-actions">
            {cfg.projectRoot && (
              <button type="button" className="btn ghost small" onClick={() => onRevealPath(cfg.projectRoot)}>
                {m.openInFinder}
              </button>
            )}
            <button type="button" className="btn ghost small" disabled={switchingProject} onClick={onPickProject}>
              {recentProjects.length > 0 ? m.pickAnother : m.pickProject}
            </button>
          </div>
        </div>

        {snap?.hint && page === "dashboard" && !showEmbedWizard && (
          <div className="hint-bar">{snap.hint}</div>
        )}
        {notice && <div className="hint-bar">{notice}</div>}
        {(error || snap?.yamlError) && (
          <div className="error-bar">{error || snap?.yamlError}</div>
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
      </main>
      </div>
    </div>
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
    <section className="panel">
      <div className="panel-head">
        <h2>{m.serviceOverview}</h2>
        <div className="row" style={{ margin: 0 }}>
          {busy && (
            <button type="button" className="btn ghost" onClick={onCancelJob}>
              {m.cancelJob}
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onRefresh} disabled={busy}>
            {m.refresh}
          </button>
        </div>
      </div>

      <div className="scope-block scope-global">
        <div className="scope-head">
          <h3>{m.scopeGlobal}</h3>
          <span className="scope-badge global">Global</span>
        </div>
        <p className="scope-hint">{m.scopeGlobalHint}</p>
        <div className="cards cards-single">
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
                {embedPhase === "stopped" && <StatusPill label={stopLabel} tone="off" />}
              </>
            }
            actions={
              <>
                <button type="button" className="btn primary" disabled={busy} onClick={onEmbedStart}>
                  {m.embedStart}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={onEmbedStop}>
                  {m.embedStop}
                </button>
                <button type="button" className="btn ghost" onClick={onOpenEmbedWizard}>
                  {m.embedWizardOpen}
                </button>
              </>
            }
          />
        </div>
      </div>

      {hasProject && (
      <div className="scope-block scope-project">
        <div className="scope-head">
          <h3>{m.scopeProject}</h3>
          <span className="scope-badge project">Project</span>
        </div>
        <p className="scope-hint">{m.scopeProjectHint}</p>
        <div className="cards">
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
                <button type="button" className="btn primary" disabled={busy} onClick={() => onStack(true)}>
                  {m.stackUp}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => onStack(false)}>
                  {m.stackDown}
                </button>
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
            actions={<span className="muted">{m.shelvesHint}</span>}
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
              <button type="button" className="btn" disabled={!hostUp} onClick={onOpenDesk}>
                {m.openBrowser}
              </button>
            }
          />
          <div className="card vault-card">
            <h3>{m.vault}</h3>
            <p className="mono vault-path" title={snap.vault}>
              {snap.vault || "—"}
            </p>
            <button type="button" className="btn ghost" disabled={!snap.vault} onClick={onRevealVault}>
              {m.openInFinder}
            </button>
          </div>
        </div>
      </div>
      )}
    </section>
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
  const tone = phase === "running" ? "ok" : phase === "starting" ? "warn" : "off";
  return (
    <div className="card">
      <div className="card-top">
        <h3>{title}</h3>
        {port > 0 && <span className="muted">:{port}</span>}
        <StatusPill label={label} tone={tone} />
        {pills}
      </div>
      <p className="card-extra">{extra}</p>
      <div className="card-actions">{actions}</div>
    </div>
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

  return (
    <section className="panel">
      <h2>{m.settings}</h2>
      <h3>{m.runtimeTitle}</h3>
      <p className="muted">{runtimeStatus?.ready ? m.runtimeReady : m.runtimeNotReady}</p>
      <div className="row">
        <button type="button" className="btn primary" disabled={busy} onClick={onEnsureRuntime}>
          {m.runtimeEnsure}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={onRefreshRuntime}>
          {m.refresh}
        </button>
      </div>
      {(busy || runtimeLogLines.length > 0) && (
        <div className="log-panel mini runtime-log">
          {runtimeLogLines.length > 0
            ? runtimeLogLines.map((l, i) => <div key={i}>{l}</div>)
            : m.runtimeUpdating}
        </div>
      )}
      <ul className="runtime-list">
        {runtimeStatus?.components.map((c) => (
          <li key={c.name}>
            <strong>{c.name}</strong>{" "}
            {c.installed
              ? c.latest && c.version && c.latest !== c.version
                ? `${c.version} → ${c.latest}`
                : c.version || "ok"
              : c.latest
                ? `— → ${c.latest}`
                : "—"}{" "}
            · <span className="mono">{c.path || "—"}</span>
            {c.managedByConsole === true && (c.installed || c.name === "imprint") && (
              <button
                type="button"
                className="btn ghost small"
                disabled={busy}
                onClick={() => onUpdateComponent(c.name)}
              >
                {m.runtimeUpdate}
              </button>
            )}
          </li>
        ))}
      </ul>
      <h3>{m.globalEmbedTitle}</h3>
      <p className="muted">{m.globalEmbedHint}</p>
      {embedForm && (
        <>
          <label className="field check">
            <input
              type="checkbox"
              checked={embedForm.enabled}
              onChange={(e) => setEmbedForm({ ...embedForm, enabled: e.target.checked })}
            />{" "}
            {m.globalEmbedEnabled}
          </label>
          <label className="field">
            package
            <input value={embedForm.package} readOnly className="mono" />
          </label>
          <div className="field-grid">
            <label className="field">
              {m.embedPort}
              <span className="field-hint">port</span>
              <input
                type="number"
                min={1}
                max={65535}
                step={1}
                value={embedForm.port}
                onChange={(e) => setEmbedForm({ ...embedForm, port: e.target.value })}
              />
            </label>
            <label className="field">
              {m.embedTimeout}
              <span className="field-hint">timeout_seconds</span>
              <input
                type="number"
                min={1}
                max={3600}
                step={1}
                value={embedForm.timeoutSeconds}
                onChange={(e) => setEmbedForm({ ...embedForm, timeoutSeconds: e.target.value })}
              />
            </label>
            <label className="field">
              {m.embedDuplicate}
              <span className="field-hint">duplicate_threshold</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={embedForm.duplicateThreshold}
                onChange={(e) => setEmbedForm({ ...embedForm, duplicateThreshold: e.target.value })}
              />
            </label>
            <label className="field">
              {m.embedContradiction}
              <span className="field-hint">relate_contradiction_min</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={embedForm.relateContradictionMin}
                onChange={(e) =>
                  setEmbedForm({ ...embedForm, relateContradictionMin: e.target.value })
                }
              />
            </label>
            <label className="field">
              {m.embedEntailment}
              <span className="field-hint">relate_entailment_min</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={embedForm.relateEntailmentMin}
                onChange={(e) =>
                  setEmbedForm({ ...embedForm, relateEntailmentMin: e.target.value })
                }
              />
            </label>
          </div>
          <label className="field">
            {m.embedModel}
            <span className="field-hint">model</span>
            <input
              value={embedForm.model}
              className="mono"
              onChange={(e) => setEmbedForm({ ...embedForm, model: e.target.value })}
            />
          </label>
          <label className="field check">
            <input
              type="checkbox"
              checked={embedForm.relateBidirectional}
              onChange={(e) =>
                setEmbedForm({ ...embedForm, relateBidirectional: e.target.checked })
              }
            />
            <span>
              {m.embedBidirectional}
              <span className="field-hint">relate_bidirectional</span>
            </span>
          </label>
          {embedError && <div className="error-bar">{embedError}</div>}
          <button type="button" className="btn" onClick={() => void saveEmbed()}>
            {m.save}
          </button>
        </>
      )}
      <h3>{m.settings}</h3>
      <label className="field">
        {m.imprintBin}
        <span className="field-hint">{m.imprintBinHint}</span>
        <input
          value={draft.imprintBin}
          onChange={(e) => setDraft({ ...draft, imprintBin: e.target.value })}
          className="mono"
          placeholder="imprint 或绝对路径"
        />
      </label>
      <label className="field">
        {m.pollMs}
        <input
          type="number"
          value={draft.pollIntervalMs}
          onChange={(e) =>
            setDraft({ ...draft, pollIntervalMs: Number(e.target.value) || 2500 })
          }
        />
      </label>
      <label className="field">
        {m.hfEndpoint}
        <input
          value={draft.hfEndpoint}
          onChange={(e) => setDraft({ ...draft, hfEndpoint: e.target.value })}
          placeholder="https://hf-mirror.com"
        />
      </label>
      <label className="field">
        {m.imprintHf}
        <input
          value={draft.imprintHfEndpoint}
          onChange={(e) => setDraft({ ...draft, imprintHfEndpoint: e.target.value })}
        />
      </label>
      <button
        type="button"
        className="btn primary"
        onClick={() => onSave({ ...draft, locale })}
      >
        {m.save}
      </button>
    </section>
  );
}
