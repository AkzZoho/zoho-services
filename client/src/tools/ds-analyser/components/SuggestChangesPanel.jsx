import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/Icons.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { apiFetch } from '../lib/http.js';
import {
  planToMarkdown,
  combinedPlanToMarkdown,
  downloadFilename,
} from '../lib/changeSheetMarkdown.js';

/**
 * SuggestChangesPanel — Step 2 of the DS Analyser: "Suggest changes".
 *
 * The user types a plain-English change request — e.g. a rename
 * ("change X to Y") or a structural ask ("add a status field and email
 * the owner when it changes") — and the tool produces a developer-ready
 * change sheet with instructions a Creator developer can apply manually.
 *
 * Each submit fires one backend call to /api/change-request which:
 *   1. Extracts literal renames from the prompt (deterministic regex).
 *   2. Asks the assistant for structural / behavioural follow-ups plus
 *      line-edit hints and out-of-scope notes.
 *   3. Resolves every rename to exact file/line/column hits in the .ds.
 *
 * The panel keeps a conversation of (prompt → plan) turns so the user
 * can refine or add changes without losing earlier work. Turns can be
 * undone, cleared, or exported as one combined Markdown document.
 *
 * Each call is independent on the wire — phrase follow-up prompts as
 * self-contained requests.
 */
// eslint-disable-next-line no-unused-vars
export default function SuggestChangesPanel({ overview, parsing: _parsing = false }) {
  const { showToast } = useToast();

  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // When the .ds is still being parsed in the background, we accept typing
  // but defer the actual API call until `overview` is available. A pending
  // submission is captured here so it auto-fires the moment parsing finishes.
  const [pendingSubmit, setPendingSubmit] = useState(false);

  // Conversation history. Each turn is:
  //   {
  //     id:           string  — stable react key
  //     kind:         'request'
  //     instruction:  string   — the user prompt that produced this turn
  //     plan:         object   — the plan returned by the server
  //     provider:     string
  //     llmAvailable: boolean
  //     ts:           number   — Date.now()
  //   }
  const [turns, setTurns] = useState([]);
  const latest = turns.length ? turns[turns.length - 1] : null;
  const provider = latest?.provider || null;
  const llmAvailable = latest?.llmAvailable !== false;

  // Ref to the latest turn so we can scroll it into view after a new
  // turn is appended.
  const latestTurnRef = useRef(null);
  useEffect(() => {
    if (latestTurnRef.current) {
      latestTurnRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [turns.length]);

  const charCount = instruction.length;
  const tooLong = charCount > 4000;
  const tooShort = instruction.trim().length < 8;

  // If the user hit submit before parsing finished, flush as soon as the
  // overview lands.
  useEffect(() => {
    if (pendingSubmit && overview && !loading) {
      setPendingSubmit(false);
      runChangeRequest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview, pendingSubmit]);

  const appName = overview?.app?.name || overview?.meta?.fileName || '';

  async function runChangeRequest() {
    if (loading || tooLong || tooShort) return;
    // If the .ds is still being parsed, queue the submission and let the
    // effect below fire it as soon as `overview` becomes available.
    if (!overview) {
      setPendingSubmit(true);
      return;
    }

    setLoading(true);
    setError(null);

    const trimmedInstruction = instruction.trim();
    try {
      const res = await apiFetch('/api/change-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: trimmedInstruction,
          overview,
        }),
      });

      const newTurn = {
        id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'request',
        instruction: trimmedInstruction,
        plan: res.plan,
        provider: res.provider || 'unknown',
        llmAvailable: res.llmAvailable !== false,
        ts: Date.now(),
      };
      setTurns((t) => [...t, newTurn]);
      // Clear the textarea so the user can immediately type the next
      // refinement without manually wiping the previous prompt.
      setInstruction('');

      const totalLineHits = (res.plan.lineEdits || []).reduce(
        (sum, e) => sum + (e?.totals?.occurrences || 0),
        0
      );
      const changeCount = (res.plan.changes || []).length;
      const oosCount = (res.plan.outOfScope || []).length;

      const parts = [];
      if (changeCount) parts.push(`${changeCount} structural change${changeCount === 1 ? '' : 's'}`);
      if (totalLineHits) parts.push(`${totalLineHits} line edit${totalLineHits === 1 ? '' : 's'}`);
      if (oosCount) parts.push(`${oosCount} out-of-scope note${oosCount === 1 ? '' : 's'}`);
      const turnLabel = turns.length === 0 ? 'Developer handover ready' : `Request ${turns.length + 1} added`;
      showToast(parts.length ? `${turnLabel}: ${parts.join(', ')}` : turnLabel, 'success');
    } catch (err) {
      const msg = err?.message || 'Could not generate the handover.';
      setError(msg);
      showToast('Could not generate the handover', 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e) {
    e?.preventDefault?.();
    runChangeRequest();
  }

  /** Wipe the whole conversation and start over. */
  function handleNewSession() {
    setInstruction('');
    setError(null);
    setTurns([]);
  }

  /** Pop just the most recent turn (Undo). */
  function handleUndoLastTurn() {
    if (loading || turns.length === 0) return;
    setTurns((t) => t.slice(0, -1));
    showToast('Removed last turn', 'success');
  }

  /** Copy a single combined Markdown document covering every turn. */
  async function handleCopyCombined() {
    if (turns.length === 0) return;
    const md = combinedPlanToMarkdown(turns, { appName });
    try {
      await navigator.clipboard.writeText(md);
      showToast('Developer handover copied as Markdown', 'success');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = md;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        showToast('Developer handover copied as Markdown', 'success');
      } catch {
        showToast('Copy failed — please use the Download button', 'error');
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  /** Download a single combined .md file covering every turn. */
  function handleDownloadCombined() {
    if (turns.length === 0) return;
    const md = combinedPlanToMarkdown(turns, { appName });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadFilename(appName ? `${appName}-combined` : 'combined');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Downloaded ${a.download}`, 'success');
  }

  const hasTurns = turns.length > 0;

  return (
    <section className="card p-6 space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-brand-600 text-white text-[10px] font-bold">2</span>
            Suggest changes
          </div>
          <h2 className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            Describe the change — get a developer handover
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Type the change you want in plain English. The tool reads the uploaded
            <code className="font-mono mx-1 px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[12px]">.ds</code>
            and tells your developer <b>exactly where to make it</b> — which form, field,
            workflow or report, the trigger that fires it, and the precise line numbers
            for any renames. Developers know <em>how</em> to change a Creator app; this
            tool tells them <em>where</em>. <b>Nothing is auto-applied.</b>
          </p>
        </div>
      </header>

      {/* Live-data warning — always visible above the prompt input */}
      <LiveDataNotice />

      {/* Free-text prompt — repeatable. Each submit appends a new turn. */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            {hasTurns ? 'Add another change' : 'What change does the developer need to make?'}
          </span>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={
              hasTurns
                ? 'e.g. Also make the Phone field required on the Customers form and add a +91 prefix validation.'
                : 'e.g. On the PurchaseOrder form, add a Vendor lookup pointing to the Vendors form, show it on the PO_List report, and trigger an email to the buyer onCreate.'
            }
            rows={4}
            disabled={loading}
            className="mt-1 w-full px-3 py-2 text-sm rounded-md border border-slate-200 dark:border-slate-700
                       bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100
                       focus:outline-none focus:ring-2 focus:ring-brand-500
                       disabled:opacity-60 disabled:cursor-not-allowed
                       resize-y leading-relaxed"
          />
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              {hasTurns
                ? 'Each new request appends to the handover below — use Undo to drop the last one.'
                : 'Cite real form, field, workflow and report names from your app. Group related edits in one request — split unrelated ones.'}
            </span>
            <span
              className={
                tooLong
                  ? 'text-red-600 dark:text-red-400 font-medium'
                  : 'text-slate-400 dark:text-slate-500'
              }
            >
              {charCount} / 4000
            </span>
          </div>
        </label>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="submit"
            disabled={loading || tooLong || tooShort || pendingSubmit}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-700
                       text-white text-sm font-medium transition
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {(loading || pendingSubmit) ? <Icon.Spinner size={14} /> : <Icon.Plan size={14} />}
            {pendingSubmit
              ? 'Preparing…'
              : loading
                ? 'Locating in your app…'
                : hasTurns
                  ? 'Add this change'
                  : 'Generate developer handover'}
          </button>
          {hasTurns && (
            <button
              type="button"
              onClick={handleUndoLastTurn}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md
                         text-slate-600 dark:text-slate-300 text-sm
                         hover:bg-slate-100 dark:hover:bg-slate-800 transition
                         disabled:opacity-50 disabled:cursor-not-allowed"
              title="Remove the most recent turn"
            >
              <Icon.X size={14} /> Undo last turn
            </button>
          )}
          {(instruction || hasTurns || error) && (
            <button
              type="button"
              onClick={handleNewSession}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md
                         text-slate-600 dark:text-slate-300 text-sm
                         hover:bg-slate-100 dark:hover:bg-slate-800 transition
                         disabled:opacity-50 disabled:cursor-not-allowed"
              title="Clear all turns and start a fresh session"
            >
              <Icon.X size={14} /> New session
            </button>
          )}
          {provider && (
            <span className="text-xs text-slate-500 dark:text-slate-400 ml-auto">
              Powered by <code className="font-mono">{provider}</code>
              {!llmAvailable && (
                <span className="ml-1 text-amber-600 dark:text-amber-400">
                  (deterministic only)
                </span>
              )}
            </span>
          )}
        </div>
      </form>

      {error && (
        <div className="rounded-md border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40
                        text-red-800 dark:text-red-200 text-sm p-3 flex items-start gap-2">
          <Icon.Warning className="mt-0.5 shrink-0" size={14} />
          <div className="min-w-0">
            <b>Something went wrong:</b> {error}
          </div>
        </div>
      )}

      {/* Conversation history — one block per turn, oldest first. */}
      {hasTurns && (
        <div className="space-y-6 border-t border-slate-200 dark:border-slate-800 pt-5">
          <ConversationHeader
            turnCount={turns.length}
            onCopyCombined={handleCopyCombined}
            onDownloadCombined={handleDownloadCombined}
          />
          {turns.map((turn, i) => (
            <ConversationTurn
              key={turn.id}
              turn={turn}
              index={i + 1}
              isLatest={i === turns.length - 1}
              appName={appName}
              showToast={showToast}
              scrollRef={i === turns.length - 1 ? latestTurnRef : null}
            />
          ))}
        </div>
      )}

      {!hasTurns && !error && !loading && (
        <ExampleHints onPick={(s) => setInstruction(s)} />
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Conversation header — combined-export controls + summary                   */
/* -------------------------------------------------------------------------- */

function ConversationHeader({ turnCount, onCopyCombined, onDownloadCombined }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Developer handover ({turnCount} request{turnCount === 1 ? '' : 's'})
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCopyCombined}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md
                     text-xs font-medium border border-brand-200 dark:border-brand-800/60
                     text-brand-700 dark:text-brand-200
                     hover:bg-brand-100 dark:hover:bg-brand-900/40 transition"
          title="Copy all turns as one combined developer handover (Markdown)"
        >
          <Icon.Code size={12} /> Copy full handover
        </button>
        <button
          type="button"
          onClick={onDownloadCombined}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md
                     text-xs font-medium border border-brand-200 dark:border-brand-800/60
                     text-brand-700 dark:text-brand-200
                     hover:bg-brand-100 dark:hover:bg-brand-900/40 transition"
          title="Download all turns as one combined developer handover (.md)"
        >
          <Icon.Code size={12} /> Download full handover
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  A single turn — user prompt bubble + plan result                           */
/* -------------------------------------------------------------------------- */

function ConversationTurn({ turn, index, isLatest, appName, showToast, scrollRef }) {
  const kindLabel = index === 1 ? 'initial request' : 'refinement';
  return (
    <div ref={scrollRef} className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full
                         bg-brand-600 text-white text-[10px] font-bold">
          {index}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Turn {index} — {kindLabel}
        </span>
        {isLatest && index > 1 && (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded
                           bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300
                           border border-emerald-200 dark:border-emerald-800/60">
            latest
          </span>
        )}
      </div>
      <div className="rounded-md border border-slate-200 dark:border-slate-700
                      bg-slate-50/70 dark:bg-slate-800/40 px-3 py-2
                      text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-2">
          Prompt:
        </span>
        {turn.instruction}
      </div>
      <PlanResult
        plan={turn.plan}
        provider={turn.provider}
        llmAvailable={turn.llmAvailable}
        instruction={turn.instruction}
        appName={appName}
        showToast={showToast}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Live-data warning banner — always above the prompt input                   */
/* -------------------------------------------------------------------------- */

function LiveDataNotice() {
  return (
    <div className="rounded-md border border-sky-200 dark:border-sky-800/60
                    bg-sky-50 dark:bg-sky-900/20 px-3 py-2.5
                    text-xs text-sky-900 dark:text-sky-200 flex items-start gap-2">
      <Icon.Help size={14} className="mt-0.5 shrink-0" />
      <div className="leading-relaxed">
        <b>How to use this:</b> write the request the way you'd describe it to your
        developer. Use real form / field / report names from the
        <em> Application overview</em> above. Submit the response (Markdown
        export) directly to the developer — every change shows the parent form,
        trigger, risk level and exact line numbers to edit.
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Example prompt chips                                                       */
/* -------------------------------------------------------------------------- */

const EXAMPLE_PROMPTS = [
  'Rename Customer_Code to Customer_ID everywhere it appears in workflows, functions and pages.',
  'On the Orders form, add a Status picklist (Draft / Submitted / Approved) and email the record owner whenever it changes.',
  'Make the Email field on the Customers form required and add a uniqueness check.',
  'Add a manager-approval step on the Leave_Request form before status can move from Submitted to Approved.',
  'In the Download_Complaint workflow, change the report link from the staging URL to the production URL.',
];

function ExampleHints({ onPick }) {
  return (
    <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
        Examples a Solution Architect might write
      </div>
      <div className="flex flex-wrap gap-2">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="text-left text-xs px-2.5 py-1.5 rounded border
                       border-slate-200 dark:border-slate-700
                       text-slate-700 dark:text-slate-200
                       bg-slate-50 dark:bg-slate-800/40
                       hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/30
                       transition"
            title="Use this as your prompt"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Plan result — header (with export buttons), line edits, changes,           */
/*  out-of-scope, warnings, open questions                                     */
/* -------------------------------------------------------------------------- */

function PlanResult({ plan, provider, llmAvailable, instruction, appName, showToast }) {
  const {
    summary,
    intent,
    changes = [],
    lineEdits = [],
    outOfScope = [],
    warnings = [],
    openQuestions = [],
    confidence,
  } = plan;

  // Aggregate risk + line-hit counts for the header chip strip.
  const riskCounts = useMemo(() => {
    return changes.reduce(
      (acc, c) => {
        acc[c.risk] = (acc[c.risk] || 0) + 1;
        return acc;
      },
      { low: 0, medium: 0, high: 0 }
    );
  }, [changes]);

  const totalLineHits = useMemo(
    () => lineEdits.reduce((s, e) => s + (e?.totals?.occurrences || 0), 0),
    [lineEdits]
  );

  async function handleCopy() {
    const md = planToMarkdown(plan, { provider, llmAvailable, instruction, appName });
    try {
      await navigator.clipboard.writeText(md);
      showToast?.('Developer handover copied as Markdown', 'success');
    } catch {
      // Older browsers / non-secure-context fallback: drop into a hidden
      // textarea and use execCommand. Best-effort — if it fails, we still
      // have the Download button.
      const ta = document.createElement('textarea');
      ta.value = md;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        showToast?.('Developer handover copied as Markdown', 'success');
      } catch {
        showToast?.('Copy failed — please use the Download button', 'error');
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  function handleDownload() {
    const md = planToMarkdown(plan, { provider, llmAvailable, instruction, appName });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadFilename(appName);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Defer revoke so the click handler actually completes the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast?.(`Downloaded ${a.download}`, 'success');
  }

  return (
    <div className="space-y-4">
      {/* Summary block + export buttons */}
      <div className="rounded-md border border-brand-200 dark:border-brand-800/60
                      bg-brand-50/70 dark:bg-brand-900/20 px-4 py-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300 mb-1.5">
              <Icon.Plan size={11} /> Developer handover — what to change & where
            </div>
            {summary && (
              <p className="text-sm text-slate-800 dark:text-slate-100 font-medium leading-relaxed">
                {summary}
              </p>
            )}
            {intent && intent !== summary && (
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 italic">
                Interpreted goal: {intent}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md
                         text-xs font-medium border border-brand-200 dark:border-brand-800/60
                         text-brand-700 dark:text-brand-200
                         hover:bg-brand-100 dark:hover:bg-brand-900/40 transition"
              title="Copy the developer handover as Markdown — paste into Jira / Slack / email"
            >
              <Icon.Code size={12} /> Copy for developer
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md
                         text-xs font-medium border border-brand-200 dark:border-brand-800/60
                         text-brand-700 dark:text-brand-200
                         hover:bg-brand-100 dark:hover:bg-brand-900/40 transition"
              title="Download the developer handover as a .md file"
            >
              <Icon.Code size={12} /> Download .md
            </button>
          </div>
        </div>

        {/* Chip strip */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {totalLineHits > 0 && (
            <span className="chip bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60">
              <Icon.Code size={11} className="inline -mt-0.5 mr-1" />
              <span className="font-semibold">{totalLineHits}</span> precise line edit{totalLineHits === 1 ? '' : 's'}
            </span>
          )}
          <RiskCount label="High" count={riskCounts.high} tone="high" />
          <RiskCount label="Medium" count={riskCounts.medium} tone="medium" />
          <RiskCount label="Low" count={riskCounts.low} tone="low" />
          {outOfScope.length > 0 && (
            <span className="chip bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
              <Icon.Warning size={11} className="inline -mt-0.5 mr-1" />
              <span className="font-semibold">{outOfScope.length}</span> out-of-scope
            </span>
          )}
          <span className="text-slate-500 dark:text-slate-400 ml-1">
            · Confidence: <ConfidencePill value={confidence} />
          </span>
        </div>
      </div>

      {/* Line edits — deterministic file/line/column results */}
      {lineEdits.length > 0 && <LineEditsSection lineEdits={lineEdits} />}

      {/* Structural / behavioural changes */}
      {changes.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Where to apply each change in Creator ({changes.length})
          </h3>
          <ol className="space-y-2">
            {changes.map((c, i) => (
              <ChangeCard key={c.id || i} change={c} index={i + 1} />
            ))}
          </ol>
        </div>
      ) : lineEdits.length === 0 && outOfScope.length === 0 ? (
        <div className="text-sm text-slate-500 dark:text-slate-400 italic">
          The assistant didn't propose any concrete changes — see open questions below.
        </div>
      ) : null}

      {/* Out of scope — Q3 honesty section */}
      {outOfScope.length > 0 && <OutOfScopeSection items={outOfScope} />}

      {/* Warnings */}
      {warnings.length > 0 && (
        <CalloutList
          title="Cross-cutting warnings"
          tone="warn"
          icon={<Icon.Warning size={11} />}
          items={warnings}
        />
      )}

      {/* Open questions */}
      {openQuestions.length > 0 && (
        <CalloutList
          title="Open questions to clarify before proceeding"
          tone="info"
          icon={<Icon.Help size={11} />}
          items={openQuestions}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Line edits section — precise file/line/column hits                         */
/* -------------------------------------------------------------------------- */

function LineEditsSection({ lineEdits }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        Exact line edits for the developer ({lineEdits.length})
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1">
        Every workflow, function and page in the <code className="font-mono">.ds</code> was
        scanned. The developer can open each entity in Creator and apply the
        edit at the line number shown — no searching required.
      </p>
      <ul className="space-y-2">
        {lineEdits.map((edit, i) => (
          <LineEditCard key={`${edit.oldValue}->${edit.newValue}-${i}`} edit={edit} />
        ))}
      </ul>
    </div>
  );
}

function LineEditCard({ edit }) {
  const hits = edit?.totals?.occurrences ?? 0;
  const [open, setOpen] = useState(hits > 0 && hits <= 20); // auto-open small results
  return (
    <li className="border border-sky-200 dark:border-sky-800/60 rounded-lg
                   bg-sky-50/40 dark:bg-sky-900/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 group"
        aria-expanded={open}
      >
        <span
          className={`shrink-0 mt-1 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ▸
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 flex-wrap font-mono text-xs">
            <span className="text-slate-700 dark:text-slate-200 font-semibold">
              {edit.oldValue}
            </span>
            <span className="text-slate-400">→</span>
            <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
              {edit.newValue || <em className="font-normal text-amber-700 dark:text-amber-300">(remove)</em>}
            </span>
          </span>
          <span className="flex flex-wrap gap-1.5 mt-1.5 text-[11px]">
            <span className="chip bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60">
              <span className="font-semibold">{hits}</span> hit{hits === 1 ? '' : 's'}
            </span>
            {edit.totals?.entitiesWithMatches > 0 && (
              <span className="chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                in {edit.totals.entitiesWithMatches} location{edit.totals.entitiesWithMatches === 1 ? '' : 's'}
              </span>
            )}
            <span className="chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 capitalize">
              source: {edit.source}
            </span>
            {edit.totals?.truncated && (
              <span className="chip bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
                results truncated
              </span>
            )}
          </span>
          {edit.note && (
            <p className="text-xs text-slate-600 dark:text-slate-300 italic mt-1">{edit.note}</p>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-sky-200 dark:border-sky-800/60 px-4 py-3 space-y-2">
          {hits === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 italic">
              No occurrences of <code className="font-mono">{edit.oldValue}</code> found
              in any workflow, function or page source. If you expected hits, double-check
              the identifier spelling or untick "Whole identifier" via the API.
            </p>
          ) : (
            (edit.groupedByEntity || []).map((g) => (
              <EntityGroup key={g.entityKey} group={g} />
            ))
          )}
        </div>
      )}
    </li>
  );
}

function EntityGroup({ group }) {
  return (
    <div className="rounded border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-slate-200 dark:border-slate-700">
        <EntityKindBadge kind={group.entityKind} />
        <span className="font-mono text-xs text-slate-800 dark:text-slate-100 truncate">
          {group.displayName || group.entityName}
        </span>
        <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
          {group.matches.length} hit{group.matches.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {group.matches.map((m, i) => (
          <Occurrence key={`${m.line}:${m.column}:${i}`} match={m} />
        ))}
      </div>
    </div>
  );
}

function Occurrence({ match }) {
  const scope = match.enclosingScope || (Array.isArray(match.scopePath) ? match.scopePath.join(' → ') : '');
  return (
    <div className="text-xs leading-relaxed">
      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded
                         bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300
                         border border-slate-200 dark:border-slate-700">
          line {match.line}, col {match.column}
        </span>
        {scope && (
          <span
            className="font-mono text-[10px] px-1.5 py-0.5 rounded
                       bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300
                       border border-purple-200 dark:border-purple-800/60 truncate max-w-full"
            title={`Enclosing block: ${scope}`}
          >
            in <span className="font-semibold">{scope}</span>
          </span>
        )}
      </div>
      <pre className="font-mono whitespace-pre-wrap break-all
                      bg-slate-50 dark:bg-slate-800/60
                      border border-slate-200 dark:border-slate-700
                      rounded px-2 py-1.5 text-[11.5px] text-slate-800 dark:text-slate-100">
        {renderHighlighted(match.lineText, match.matchText)}
      </pre>
      {match.replacement !== undefined && (
        <pre className="mt-1 font-mono whitespace-pre-wrap break-all
                        bg-emerald-50 dark:bg-emerald-900/20
                        border border-emerald-200 dark:border-emerald-800/60
                        rounded px-2 py-1.5 text-[11.5px] text-emerald-900 dark:text-emerald-200">
          <span className="text-emerald-700 dark:text-emerald-300 mr-1">→</span>
          {match.replacement}
        </pre>
      )}
    </div>
  );
}

/**
 * Render the matched line with the matched substring(s) highlighted in amber.
 * Always case-insensitive — the server already determined what matched.
 */
function renderHighlighted(lineText, matchText) {
  if (!matchText || !lineText) return lineText || '';
  const escaped = matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'gi');

  const parts = [];
  let lastIdx = 0;
  let m;
  let counter = 0;
  while ((m = re.exec(lineText)) !== null) {
    if (m.index > lastIdx) parts.push(lineText.slice(lastIdx, m.index));
    parts.push(
      <mark
        key={`hl-${counter++}`}
        className="bg-amber-200 dark:bg-amber-400/40 text-amber-900 dark:text-amber-100
                   rounded px-0.5 font-semibold"
      >
        {m[0]}
      </mark>
    );
    lastIdx = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  if (lastIdx < lineText.length) parts.push(lineText.slice(lastIdx));
  return parts.length ? parts : lineText;
}

function EntityKindBadge({ kind }) {
  const map = {
    workflow: {
      label: 'Workflow',
      cls: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-800/60',
    },
    function: {
      label: 'Function',
      cls: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 border-sky-200 dark:border-sky-800/60',
    },
    page: {
      label: 'Page',
      cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60',
    },
  };
  const cfg = map[kind] || {
    label: kind,
    cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  };
  return (
    <span
      className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Out-of-scope section — Q3 honesty                                          */
/* -------------------------------------------------------------------------- */

function OutOfScopeSection({ items }) {
  return (
    <div className="rounded-md border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-900/20 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200 mb-2">
        <Icon.Warning size={11} /> Out of scope for this .ds ({items.length})
      </div>
      <p className="text-xs text-amber-900 dark:text-amber-200 mb-2">
        These parts of your request can't be represented in a <code>.ds</code> export.
        Handle them in Creator's UI or in another system as noted.
      </p>
      <ul className="space-y-1.5 text-sm text-amber-900 dark:text-amber-100">
        {items.map((o, i) => (
          <li key={i} className="leading-relaxed">
            <div className="font-medium">{o.request}</div>
            <div className="text-xs italic">Reason: {o.reason}</div>
            {o.where && (
              <div className="text-xs">
                <span className="font-semibold">Where: </span>
                {o.where}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Target chip cluster — answers "WHAT is this change against, and where     */
/*  does the developer find it in the Creator builder?"                       */
/*                                                                            */
/*  For a Workflow this means: is it on a form / report / schedule? Which     */
/*  parent? What trigger fires it? We render up to four chips:                */
/*                                                                            */
/*    1. Entity + name           (always)                                     */
/*    2. Parent (Form / Report)  (when target.parentName present)             */
/*    3. Trigger                 (e.g. onCreate, scheduled:daily, button:Foo) */
/*    4. Scope tag               (form / report / schedule / global)          */
/*                                                                            */
/*  Each chip uses a slightly different palette so a developer can scan the   */
/*  card and instantly see "this is the OnCreate workflow on Form X" without  */
/*  opening it.                                                               */
/* -------------------------------------------------------------------------- */

function TargetChips({ target }) {
  if (!target || !target.entity || !target.name) return null;
  const { entity, name, parentEntity, parentName, trigger, scope } = target;

  // Heuristic: when the target is a Workflow / Field / Function we colour
  // the parent chip differently so it pops. For Form / Report targets the
  // parent chip won't render (they have no parent).
  return (
    <>
      {/* Primary target */}
      <span className="chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
        {entity}: <span className="font-mono ml-1">{name}</span>
      </span>

      {/* Parent context — only when present. parentEntity may be missing
          even when parentName isn't (e.g. older LLM responses); default to
          a generic "on" prefix in that case. */}
      {parentName && (
        <span
          className="chip bg-indigo-50 text-indigo-700 border border-indigo-200
                     dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800/60"
          title={`This ${entity.toLowerCase()} lives on ${parentEntity || 'entity'} "${parentName}"`}
        >
          on {parentEntity || 'entity'}:{' '}
          <span className="font-mono ml-1">{parentName}</span>
        </span>
      )}

      {/* Trigger — when this workflow / function fires */}
      {trigger && (
        <span
          className="chip bg-sky-50 text-sky-700 border border-sky-200
                     dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800/60"
          title={`Triggered: ${trigger}`}
        >
          <Icon.Plan size={11} /> <span className="font-mono">{trigger}</span>
        </span>
      )}

      {/* Scope tag — only for workflows / functions; redundant for
          Form / Report targets so we suppress it then to keep the row tidy. */}
      {scope && entity !== 'Form' && entity !== 'Report' && entity !== 'Page' && (
        <span
          className="chip bg-violet-50 text-violet-700 border border-violet-200
                     dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800/60"
          title={`Workflow surface: ${scope}`}
        >
          {scope}
        </span>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Single structural change card                                              */
/* -------------------------------------------------------------------------- */

function ChangeCard({ change, index }) {
  const [open, setOpen] = useState(index <= 2);

  const riskCls = RISK_CLASSES[change.risk] || RISK_CLASSES.medium;
  const dataImpactCls = DATA_IMPACT_CLASSES[change.dataImpact] || DATA_IMPACT_CLASSES['no-data-loss'];

  return (
    <li className="border border-slate-200 dark:border-slate-700 rounded-lg
                   bg-slate-50/50 dark:bg-slate-800/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 group"
        aria-expanded={open}
      >
        <span
          className={`shrink-0 mt-1 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ▸
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
              #{index}
            </span>
            <span className="font-medium text-slate-900 dark:text-slate-100 group-hover:text-brand-700 dark:group-hover:text-brand-300">
              {change.action}
            </span>
          </span>
          <span className="flex flex-wrap gap-1.5 mt-1.5 text-xs">
            <span className="chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {KIND_LABELS[change.kind] || change.kind}
            </span>
            <TargetChips target={change.target} />
            <span className={`chip ${riskCls}`}>
              <span className="font-semibold uppercase">{change.risk}</span> risk
            </span>
            <span className={`chip ${dataImpactCls}`}>
              {DATA_IMPACT_LABELS[change.dataImpact] || change.dataImpact}
            </span>
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-4 space-y-3">
          {change.rationale && (
            <Section title="Why">
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                {change.rationale}
              </p>
            </Section>
          )}

          {change.manualSteps && change.manualSteps.length > 0 && (
            <Section title="Developer steps in Creator builder">
              <ol className="list-decimal ml-5 space-y-1 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                {change.manualSteps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </Section>
          )}

          {change.relatedEntities && change.relatedEntities.length > 0 && (
            <Section title="Also revisit">
              <div className="flex flex-wrap gap-1.5">
                {change.relatedEntities.map((r) => (
                  <span
                    key={r}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs
                               bg-purple-50 text-purple-700 border border-purple-200
                               dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800/60"
                  >
                    <Icon.Folder size={11} /> {r}
                  </span>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </li>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tone helpers + small UI primitives                                         */
/* -------------------------------------------------------------------------- */

const KIND_LABELS = {
  add_field: 'Add field',
  modify_field: 'Modify field',
  remove_field: 'Remove field',
  add_form: 'Add form',
  modify_form: 'Modify form',
  add_lookup: 'Add lookup',
  add_workflow: 'Add workflow',
  modify_workflow: 'Modify workflow',
  add_report: 'Add report',
  modify_report: 'Modify report',
  add_page: 'Add page',
  modify_page: 'Modify page',
  add_function: 'Add function',
  modify_function: 'Modify function',
  permission: 'Permissions',
  other: 'Other',
};

const RISK_CLASSES = {
  low: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60',
  medium: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60',
  high: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-800/60',
};

const DATA_IMPACT_LABELS = {
  'no-data-loss': 'No data loss',
  'backfill-needed': 'Backfill needed',
  destructive: 'Destructive',
};

const DATA_IMPACT_CLASSES = {
  'no-data-loss':
    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700',
  'backfill-needed':
    'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60',
  destructive:
    'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-800/60',
};

function RiskCount({ label, count, tone }) {
  if (!count) return null;
  return (
    <span className={`chip ${RISK_CLASSES[tone]}`}>
      <span className="font-semibold">{count}</span> {label}
    </span>
  );
}

function ConfidencePill({ value }) {
  const pct = Math.round((Number(value) || 0) * 100);
  const tone =
    pct >= 70 ? 'text-emerald-700 dark:text-emerald-300'
    : pct >= 40 ? 'text-amber-700 dark:text-amber-300'
    : 'text-red-700 dark:text-red-300';
  return <span className={`font-semibold ${tone}`}>{pct}%</span>;
}

function CalloutList({ title, tone, icon, items }) {
  const cls =
    tone === 'warn'
      ? 'border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200'
      : 'border-sky-200 dark:border-sky-800/60 bg-sky-50 dark:bg-sky-900/20 text-sky-900 dark:text-sky-200';
  return (
    <div className={`rounded-md border px-4 py-3 ${cls}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide mb-1.5">
        {icon} {title}
      </div>
      <ul className="list-disc ml-5 space-y-1 text-sm leading-relaxed">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
