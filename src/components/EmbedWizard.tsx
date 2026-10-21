import type { Messages } from "../i18n";
import type { Snapshot } from "../api";
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
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{m.embedWizardTitle}</h2>
        <button type="button" className="btn ghost" onClick={onBack}>
          {m.embedWizardBack}
        </button>
      </div>
      {snap && (
        <p className="ok-text" style={{ marginTop: 0 }}>
          {m.embedStatus}:{" "}
          {embedStarting && !(snap.embed.running || snap.embedHealth?.ok)
            ? m.starting
            : snap.embed.running || snap.embedHealth?.ok
              ? m.embedRunning
              : m.embedStopped}
          {snap.embedHealth?.ready ? " · ready" : snap.embedHealth?.ok ? " · /health OK" : ""}
        </p>
      )}
      <p className="muted">{m.embedWizardLead}</p>
      <ol className="wizard-steps">
        {wizardSteps.map((label, i) => (
          <li key={label} className={wizardStep === i ? "current" : ""}>
            {label}
          </li>
        ))}
      </ol>
      {prereq && <p className="ok-text">{prereq}</p>}
      <div className="row">
        {wizardSteps.map((_, i) => (
          <button
            key={i}
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => onStep(i)}
          >
            {m.runStep} {i + 1}
          </button>
        ))}
        {busy && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            {m.cancelJob}
          </button>
        )}
      </div>
      <LogPanel
        title={m.logs}
        autoScrollLabel={m.autoScroll}
        clearLabel={m.clearLogs}
        emptyLabel={m.noLogs}
        lines={logLines}
        onClear={onClearLogs}
      />
    </section>
  );
}
