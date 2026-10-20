import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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

  const onPickProject = async () => {
    setError("");
    const picked = await pickProjectFolder();
    if (!picked) return;
    try {
      await openProject(picked);
      const c = await getConfig();
      setCfg(c);
      setPage("dashboard");
      setShowEmbedWizard(false);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
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
    } catch (e) {
      setBusy(false);
      setError(String(e));
    }
  };

  const stackUpDown = async (up: boolean) => {
    setBusy(true);
    setError("");
    try {
      await imprintUpDown(up);
      await refresh();
    } catch (e) {
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
      await runJob(async () => {
        await runImprint(LOG_STREAM, ["plugin", "start", "embed"]);
      });
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
          <div className="project-bar-path mono" title={cfg.projectRoot || m.projectOptional}>
            {cfg.projectRoot || m.projectOptional}
          </div>
          <div className="project-bar-actions">
            {cfg.projectRoot && (
              <button type="button" className="btn ghost small" onClick={() => onRevealPath(cfg.projectRoot)}>
                {m.openInFinder}
              </button>
            )}
            <button type="button" className="btn ghost small" onClick={onPickProject}>
              {cfg.projectRoot ? m.switchProject : m.pickProject}
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
            onCancel={() => cancelActiveJob().then(() => setBusy(false))}
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
            onCancelJob={() => cancelActiveJob().then(() => setBusy(false))}
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
              runJob(() => runImprint(LOG_STREAM, ["plugin", "start", "embed"]));
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
  onCancelJob: () => void;
  onOpenDesk: () => void;
  onRevealVault: () => void;
  onOpenEmbedWizard: () => void;
  onEmbedStart: () => void;
  onEmbedStop: () => void;
}) {
  const embedUp = snap.embed.running || snap.embedHealth?.ok === true;
  const runLabel = m.running;
  const stopLabel = m.stopped;

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
            listening={embedUp}
            runLabel={runLabel}
            stopLabel={stopLabel}
            extra={
              embedReady
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
                {!embedUp && <StatusPill label={stopLabel} tone="off" />}
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
            listening={snap.host.listening}
            runLabel={runLabel}
            stopLabel={stopLabel}
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
            listening={snap.shelves.indexed}
            runLabel={runLabel}
            stopLabel={stopLabel}
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
            listening={snap.desk.listening}
            runLabel={runLabel}
            stopLabel={stopLabel}
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
  listening,
  extra,
  actions,
  pills,
  runLabel,
  stopLabel,
}: {
  title: string;
  port: number;
  listening: boolean;
  extra: string;
  actions: ReactNode;
  pills?: ReactNode;
  runLabel: string;
  stopLabel: string;
}) {
  return (
    <div className="card">
      <div className="card-top">
        <h3>{title}</h3>
        {port > 0 && <span className="muted">:{port}</span>}
        <StatusPill label={listening ? runLabel : stopLabel} tone={listening ? "ok" : "off"} />
        {pills}
      </div>
      <p className="card-extra">{extra}</p>
      <div className="card-actions">{actions}</div>
    </div>
  );
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
  runtimeLogLines: string[];
}) {
  const [draft, setDraft] = useState(cfg);
  const [embedDoc, setEmbedDoc] = useState<GlobalEmbedDoc | null>(null);
  useEffect(() => setDraft(cfg), [cfg]);
  useEffect(() => {
    getGlobalEmbed().then(setEmbedDoc).catch(() => {});
  }, [runtimeStatus?.ready]);

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
      {embedDoc && (
        <>
          <label className="field">
            <input
              type="checkbox"
              checked={embedDoc.enabled}
              onChange={(e) => setEmbedDoc({ ...embedDoc, enabled: e.target.checked })}
            />{" "}
            {m.globalEmbedEnabled}
          </label>
          <label className="field">
            package
            <input value={embedDoc.package} readOnly className="mono" />
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => saveGlobalEmbed(embedDoc).then(onRefreshRuntime)}
          >
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
