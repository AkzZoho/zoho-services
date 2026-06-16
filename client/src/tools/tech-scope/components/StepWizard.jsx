import { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/Icons.jsx';
import { STEPS } from '../lib/scope.js';
import { applyCommands, parsePrompt } from '../lib/dsl.js';
import { applyAiPrompt } from '../lib/aiDsl.js';
import { saveDraft } from '../lib/storage.js';
import { exportScopeToPdf } from '../lib/exportPdf.js';
import { renderFullDocument } from '../lib/template.js';
import StepNav from './StepNav.jsx';
import StepView from './StepView.jsx';
import PromptBox from './PromptBox.jsx';

/**
 * StepWizard — orchestrates the 5-step review/edit/export flow.
 *
 * State is owned here; sub-components are pure presentational.
 */
export default function StepWizard({ scope: initialScope, slot, onRestart }) {
  const [scope, setScope] = useState(initialScope);
  const [stepIdx, setStepIdx] = useState(0);
  const [completed, setCompleted] = useState({});
  const [lastSummary, setLastSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [exportOk, setExportOk] = useState(null);
  const [aiPromptBusy, setAiPromptBusy] = useState(false);
  const [promptError, setPromptError] = useState(null);
  // Warn banner dismissal for the AI-extraction warnings on step 1.
  const [warningsDismissed, setWarningsDismissed] = useState(false);

  const currentStep = STEPS[stepIdx];

  // Auto-save draft on every scope mutation
  useEffect(() => {
    if (slot) saveDraft(slot, scope);
  }, [scope, slot]);

  /* -------------------------------------------------------------------------- */
  /*  Actions                                                                    */
  /* -------------------------------------------------------------------------- */

  async function handlePrompt(promptText, { useAi = true } = {}) {
    setPromptError(null);

    if (useAi) {
      setAiPromptBusy(true);
      try {
        const result = await applyAiPrompt(promptText, currentStep.id, scope);
        if (result.usedAi) {
          setScope(result.scope);
          setLastSummary(result.summary);
          return;
        }
        // AI returned useFallback or was unavailable — fall through to DSL.
      } catch (err) {
        setPromptError(`AI prompt failed: ${err.message}. Falling back to DSL parser.`);
        // Fall through to deterministic DSL.
      } finally {
        setAiPromptBusy(false);
      }
    }

    // Deterministic DSL path (always works, no network needed).
    const parsed = parsePrompt(promptText, currentStep.id);
    const { scope: next, summary } = applyCommands(scope, parsed);
    setScope(next);
    setLastSummary(summary);
  }

  function handleNext() {
    setCompleted((c) => ({ ...c, [currentStep.id]: true }));
    setLastSummary(null);
    if (stepIdx < STEPS.length - 1) setStepIdx(stepIdx + 1);
  }

  function handlePrev() {
    setLastSummary(null);
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  }

  function handleJump(id) {
    setLastSummary(null);
    const i = STEPS.findIndex((s) => s.id === id);
    if (i >= 0) setStepIdx(i);
  }

  async function handleExport() {
    setBusy(true);
    setExportError(null);
    setExportOk(null);
    try {
      const res = await exportScopeToPdf(scope);
      setExportOk(res);
    } catch (err) {
      setExportError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleDownloadMd() {
    const md = renderFullDocument(scope);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(scope?.meta?.title || 'technical-scope').replace(/[^A-Za-z0-9._-]+/g, '-')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* -------------------------------------------------------------------------- */
  /*  Keyboard: Ctrl/Cmd + Enter inside the prompt box submits via PromptBox.    */
  /* -------------------------------------------------------------------------- */
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const ta = document.activeElement;
        if (ta?.tagName === 'TEXTAREA' && ta.form) {
          e.preventDefault();
          ta.form.requestSubmit?.();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isLastStep = stepIdx === STEPS.length - 1;
  const allDone = useMemo(
    () => STEPS.every((s, i) => completed[s.id] || i > stepIdx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [completed, stepIdx],
  );

  /* -------------------------------------------------------------------------- */
  /*  Render                                                                     */
  /* -------------------------------------------------------------------------- */
  return (
    <div className="space-y-6">
      {/* Project header */}
      <section className="card p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
              {scope?.meta?.title || 'Untitled Project'}
            </h2>
            {/* AI-extracted badge */}
            {scope?.meta?.provenance?.source === 'ai' && (
              <span
                title={`Extracted by ${scope.meta.provenance.provider || 'AI'}${scope.meta.provenance.warnings?.length ? ` · ${scope.meta.provenance.warnings.length} warning(s)` : ''}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border border-violet-200 dark:border-violet-700 shrink-0"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
                </svg>
                AI-extracted · review carefully
              </span>
            )}
          </div>
          {scope?.meta?.sourceFile && (
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Source: {scope.meta.sourceFile}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleDownloadMd} className="btn-ghost text-sm" title="Download markdown">
            <Icon.Download size={14} /> .md
          </button>
          <button onClick={handleExport} disabled={busy} className="btn-primary text-sm" title="Export packed PDF">
            {busy ? <Icon.Spinner size={14} /> : <Icon.Download size={14} />}
            {busy ? 'Building PDF…' : 'Export PDF'}
          </button>
          <button onClick={onRestart} className="btn-ghost text-sm" title="Start over with a new BRD">
            <Icon.X size={14} /> Restart
          </button>
        </div>
      </section>

      {exportError && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <Icon.Warning size={16} className="mt-0.5 shrink-0" />
          <span>PDF export failed: {exportError}</span>
        </div>
      )}
      {exportOk && (
        <div className="rounded-md bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 p-3 text-sm text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
          <Icon.Check size={16} className="mt-0.5 shrink-0" />
          <span>PDF saved as <code>{exportOk.fileName}</code> ({exportOk.pages} page{exportOk.pages > 1 ? 's' : ''}).</span>
        </div>
      )}

      {/* AI extraction warnings — only on step 1, dismissable */}
      {stepIdx === 0 &&
        !warningsDismissed &&
        scope?.meta?.provenance?.source === 'ai' &&
        scope?.meta?.provenance?.warnings?.length > 0 && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
            <Icon.Warning size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold">
                AI extraction completed with {scope.meta.provenance.warnings.length} notice(s) — fields coerced to valid Creator types:
              </p>
              <ul className="mt-1 space-y-0.5 text-xs list-disc list-inside text-amber-700 dark:text-amber-300">
                {scope.meta.provenance.warnings.slice(0, 8).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {scope.meta.provenance.warnings.length > 8 && (
                  <li>…and {scope.meta.provenance.warnings.length - 8} more</li>
                )}
              </ul>
            </div>
            <button
              onClick={() => setWarningsDismissed(true)}
              className="text-amber-600 dark:text-amber-300 hover:text-amber-800 dark:hover:text-amber-100 shrink-0"
              title="Dismiss"
            >
              <Icon.X size={14} />
            </button>
          </div>
        )}

      {/* Prompt-level AI error (transient, non-fatal) */}
      {promptError && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
          <Icon.Warning size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{promptError}</span>
          <button onClick={() => setPromptError(null)} className="text-amber-600 dark:text-amber-300 shrink-0">
            <Icon.X size={14} />
          </button>
        </div>
      )}

      {/* Step nav */}
      <StepNav
        currentStepId={currentStep.id}
        completed={completed}
        onJump={handleJump}
      />

      {/* Step body */}
      <section className="card p-5 space-y-1">
        <header className="flex items-baseline justify-between gap-3 flex-wrap pb-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <p className="text-xs uppercase tracking-wide text-brand-600 dark:text-brand-400 font-semibold">
              Step {currentStep.n} of {STEPS.length}
            </p>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {currentStep.title}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">{currentStep.subtitle}</p>
          </div>
        </header>

        <div className="pt-4 grid lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3">
            <StepView stepId={currentStep.id} scope={scope} />
          </div>
          <div className="lg:col-span-2 space-y-3">
            <PromptBox
              stepId={currentStep.id}
              onSubmit={handlePrompt}
              busy={busy || aiPromptBusy}
              lastSummary={lastSummary}
              aiPromptBusy={aiPromptBusy}
            />
          </div>
        </div>

        {/* Navigation */}
        <div className="pt-4 mt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
          <button onClick={handlePrev} disabled={stepIdx === 0} className="btn-ghost">
            <Icon.ArrowLeft size={14} /> Previous
          </button>
          <div className="flex items-center gap-2">
            {!isLastStep ? (
              <button onClick={handleNext} className="btn-primary">
                Looks good — Next step <Icon.ArrowRight size={14} />
              </button>
            ) : (
              <button onClick={handleExport} disabled={busy} className="btn-primary">
                {busy ? <Icon.Spinner size={14} /> : <Icon.Download size={14} />}
                {busy ? 'Building PDF…' : 'Finish & Export PDF'}
              </button>
            )}
          </div>
        </div>
      </section>

      {allDone && !isLastStep && (
        <p className="text-center text-xs text-emerald-700 dark:text-emerald-400">
          All steps reviewed — you can export the PDF anytime from the top-right.
        </p>
      )}
    </div>
  );
}
