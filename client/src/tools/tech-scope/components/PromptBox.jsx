import { useState } from 'react';
import Icon from '../../../components/Icons.jsx';

/**
 * PromptBox — multi-line input where the user types commands or natural-language
 * instructions to adjust the current step.
 *
 * When "AI assist" is ON (default), the text is sent to /api/apply-prompt which
 * uses an LLM to translate it into DSL commands. The AI result is shown inline
 * (explanation + commands used). Falls back to the deterministic DSL parser
 * transparently when the AI is unavailable or returns low-confidence output.
 *
 * When "AI assist" is OFF, the deterministic DSL parser runs locally with no
 * network call — fully offline.
 */

const EXAMPLES = {
  step1: [
    'add form: Customer with fields: id, name, email, phone',
    'add workflow: Invoice Approval triggered by Invoice.create',
    'rename form: Customer to Client',
    'remove workflow: Onboarding',
    'split Vendor into Vendor and Vendor Contact',
    'add a dashboard page that shows the All Invoices report',
  ],
  step2: [
    'add entity: Invoice with fields: id, customer_id (uuid, fk:Customer), amount (decimal), status',
    'add relationship: Customer <-> Invoice as customer_id',
    'add field to entity Invoice: due_date (date, required)',
    'link Purchase Order to Vendor with a single lookup',
  ],
  step3: [
    'add module: Sales',
    'add module: Finance',
    'add role: Sales Rep can read, write on Sales',
    'add role: Admin can all on all modules',
    'create a Finance Manager role that reports to Admin',
  ],
  step4: [
    'add api: GET /api/customers returns Customer[]',
    'add api: POST /api/invoices returns Invoice',
    'add integration: Stripe via Webhook',
    'set auth: Zoho OAuth',
    'add a daily schedule that calls the generateMonthlyReport function',
  ],
  step5: [
    'add nfr: Performance — p95 response time under 500ms for list APIs',
    'add nfr: Security — all PII encrypted at rest using AES-256',
    'add assumption: Single-tenant deployment per customer',
    'add out of scope: Mobile app for v1',
  ],
};

export default function PromptBox({ stepId, onSubmit, busy, aiPromptBusy, lastSummary }) {
  const [value, setValue] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [useAi, setUseAi] = useState(true);
  const [showCommands, setShowCommands] = useState(false);

  function submit(e) {
    e.preventDefault();
    if (!value.trim()) return;
    onSubmit(value, { useAi });
    setValue('');
    setShowCommands(false);
  }

  const exs = EXAMPLES[stepId] || [];
  const isActuallyBusy = busy || aiPromptBusy;

  // Determine summary display mode.
  const hasAiResult = lastSummary?.aiExplanation;
  const hasDslResult = lastSummary && !hasAiResult;

  return (
    <section className="card p-4 space-y-3">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Icon.Edit size={14} /> Adjust this step
        </h3>
        <div className="flex items-center gap-2">
          {/* AI assist toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none" title="When on, your text is sent to the AI to translate into precise commands">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">AI assist</span>
            <button
              type="button"
              role="switch"
              aria-checked={useAi}
              onClick={() => setUseAi((v) => !v)}
              disabled={isActuallyBusy}
              className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 ${
                useAi
                  ? 'bg-violet-500 dark:bg-violet-600'
                  : 'bg-slate-300 dark:bg-slate-600'
              } ${isActuallyBusy ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                  useAi ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
          >
            <Icon.Help size={12} /> {showHelp ? 'Hide' : 'Show'} examples
          </button>
        </div>
      </header>

      {/* AI assist info strip */}
      {useAi && (
        <div className="flex items-start gap-1.5 text-[11px] text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded px-2.5 py-1.5">
          {aiPromptBusy ? (
            <Icon.Spinner size={12} className="mt-0.5 shrink-0" />
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="mt-0.5 shrink-0" aria-hidden="true">
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
            </svg>
          )}
          <span>
            {aiPromptBusy
              ? 'AI is translating your instruction into commands…'
              : 'Type naturally — AI will convert to precise DSL commands. Falls back instantly if unavailable.'}
          </span>
        </div>
      )}

      {showHelp && (
        <div className="text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded p-3 space-y-1.5">
          <p className="text-slate-600 dark:text-slate-300 font-medium">
            {useAi
              ? 'Try natural language or DSL commands. Click an example to insert it:'
              : 'One DSL command per line. Click an example to insert it:'}
          </p>
          {exs.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setValue((v) => (v ? v + '\n' + ex : ex))}
              className="block w-full text-left font-mono text-[11px] text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-900 rounded px-2 py-1 transition"
            >
              {ex}
            </button>
          ))}
          <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
            {useAi
              ? 'Anything the AI cannot express as a command is kept as a free-text note.'
              : 'Anything that doesn\'t match a command is added as a free-text note (so you\'re never blocked).'}
          </p>
        </div>
      )}

      <form onSubmit={submit} className="space-y-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          placeholder={useAi
            ? (exs.slice(-1)[0] || 'Describe what you want to change…')
            : (exs[0] || 'Type a command…')}
          disabled={isActuallyBusy}
          className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
        />
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Tip: <kbd className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-[10px]">Ctrl/⌘ + Enter</kbd> to apply
          </p>
          <button type="submit" disabled={isActuallyBusy || !value.trim()} className="btn-primary">
            {aiPromptBusy
              ? <><Icon.Spinner size={14} /> AI thinking…</>
              : busy
              ? <><Icon.Spinner size={14} /> Working…</>
              : <><Icon.Plus size={14} /> {useAi ? 'Apply with AI' : 'Apply'}</>
            }
          </button>
        </div>
      </form>

      {/* AI result summary */}
      {hasAiResult && (
        <div className="space-y-1.5">
          <div className="text-[11px] bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded px-3 py-2 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1 font-semibold text-violet-700 dark:text-violet-300">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
                </svg>
                AI applied
                {lastSummary.lowConfidence && (
                  <span className="ml-1 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                    · low confidence — review changes
                  </span>
                )}
              </div>
              {lastSummary.aiCommands?.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCommands((v) => !v)}
                  className="text-[10px] text-violet-600 dark:text-violet-400 hover:underline shrink-0"
                >
                  {showCommands ? 'Hide' : 'Show'} commands ({lastSummary.aiCommands.length})
                </button>
              )}
            </div>

            {lastSummary.aiExplanation && (
              <p className="text-slate-700 dark:text-slate-300">{lastSummary.aiExplanation}</p>
            )}

            {showCommands && lastSummary.aiCommands?.length > 0 && (
              <pre className="mt-1.5 text-[10px] font-mono bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-700 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                {lastSummary.aiCommands.join('\n')}
              </pre>
            )}
          </div>

          {/* DSL application results (applied / skipped / fallbacks) */}
          <div className="text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 rounded px-3 py-2 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              ✓ {lastSummary.applied.length} applied
            </span>
            {lastSummary.skipped.length > 0 && (
              <span className="text-amber-700 dark:text-amber-400">
                · {lastSummary.skipped.length} skipped (no-op or duplicate)
              </span>
            )}
            {lastSummary.fallbacks > 0 && (
              <span className="text-blue-700 dark:text-blue-400">
                · {lastSummary.fallbacks} kept as note
              </span>
            )}
          </div>
        </div>
      )}

      {/* Pure DSL result (no AI) */}
      {hasDslResult && (
        <div className="text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 rounded px-3 py-2 border border-slate-200 dark:border-slate-700">
          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
            ✓ {lastSummary.applied.length} applied
          </span>
          {lastSummary.skipped.length > 0 && (
            <>
              {' · '}
              <span className="text-amber-700 dark:text-amber-400">
                {lastSummary.skipped.length} skipped (no-op or duplicate)
              </span>
            </>
          )}
          {lastSummary.fallbacks > 0 && (
            <>
              {' · '}
              <span className="text-blue-700 dark:text-blue-400">
                {lastSummary.fallbacks} kept as note
              </span>
            </>
          )}
        </div>
      )}
    </section>
  );
}
