/**
 * AdminPanel — interactive tool-visibility management.
 *
 * Behaviour:
 *   • Each tool has a toggle switch — flipping it (1) updates a per-device
 *     override in localStorage for instant UI feedback, and (2) calls the
 *     admin API to persist the new list into `client/.env` on the server.
 *   • The env-var base (`VITE_PUBLIC_TOOLS`) is shown alongside, so admins
 *     can see what the "default" visibility is and how they have overridden.
 *   • A "Reset to env defaults" action wipes overrides and (if the API call
 *     succeeds) also clears the env line on the server.
 *   • If the persistence call fails (no server reachable, ADMIN_PASSWORD not
 *     configured, etc.), the local override remains — the UI shows a toast
 *     explaining the situation. The local override is the user-visible
 *     contract; persistence is best-effort.
 */

import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icons.jsx';
import { useToolVisibility } from '../auth/useToolVisibility.js';
import { useAdminAuth } from '../auth/useAdminAuth.js';
import { persistToolVisibility } from '../auth/adminApi.js';
import { useToast } from '../components/Toast.jsx';

const TOOL_REGISTRY = [
  {
    id: 'ds-analyser',
    title: 'Creator DS Analyser',
    tagline: 'Inspect a Zoho Creator .ds export.',
    Ico: Icon.Analyse,
    to: '/ds-analyser',
  },
  {
    id: 'tech-scope',
    title: 'Technical Scope Creator',
    tagline: 'Upload a BRD, generate a packed PDF.',
    Ico: Icon.Plan,
    to: '/tech-scope',
  },
];

export default function AdminPanel() {
  const {
    visibility,
    publicCount,
    publicIds,
    envBase,
    envPublicIds,
    overrides,
    hasOverrides,
    toggleToolVisibility,
    resetToolVisibility,
  } = useToolVisibility();
  const { adminPassword } = useAdminAuth();
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);

  /**
   * Persist the given list of public IDs to client/.env via the admin API.
   * Always called AFTER the local state has been mutated (so UI feedback is
   * instant). A failure here never rolls back the local change — instead the
   * admin gets a toast they can act on (e.g. start the server / configure
   * ADMIN_PASSWORD).
   */
  const persist = useCallback(
    async (nextPublicIds) => {
      if (!adminPassword) {
        // Without a password we can't authenticate against the API. This is
        // expected when running with VITE_ADMIN_PASSWORD unset, in which
        // case the panel itself shouldn't be reachable — but guard anyway.
        showToast(
          'No admin password configured — change applied locally only.',
          'warn'
        );
        return;
      }
      setSaving(true);
      try {
        const result = await persistToolVisibility({
          publicIds: nextPublicIds,
          password: adminPassword,
        });
        showToast(
          result.restartRequired
            ? 'Saved to client/.env. Restart the Vite dev server for the new baseline to take effect.'
            : 'Saved to client/.env.',
          'success'
        );
      } catch (err) {
        showToast(
          `Could not save to .env: ${err.message}. The change is still applied locally.`,
          'warn'
        );
      } finally {
        setSaving(false);
      }
    },
    [adminPassword, showToast]
  );

  function handleToggle(tool) {
    const newVal = toggleToolVisibility(tool.id);
    showToast(
      `${tool.title} is now ${newVal ? 'public' : 'admin-only'}.`,
      newVal ? 'success' : 'info'
    );
    // Compute the next public-ids list and persist. We can't read `publicIds`
    // here because the hook hasn't re-rendered yet — derive it ourselves.
    const nextSet = new Set(publicIds);
    if (newVal) nextSet.add(tool.id);
    else nextSet.delete(tool.id);
    // Preserve canonical ordering (matches ALL_TOOL_IDS in useToolVisibility)
    const ordered = ['ds-analyser', 'tech-scope'].filter((id) => nextSet.has(id));
    persist(ordered);
  }

  function handleReset() {
    resetToolVisibility();
    showToast('Overrides cleared. Visibility reset to env defaults.', 'info');
    // After reset, "effective" === env base. We do NOT call persist() here
    // because the env base is exactly what's already in client/.env — there
    // is nothing new to write. (If we wrote anyway, we'd just overwrite the
    // same value, which is a no-op but wastes a round trip.)
  }

  const envLine = `VITE_PUBLIC_TOOLS=${envPublicIds.join(',')}`;
  const effectiveEnvLine = `VITE_PUBLIC_TOOLS=${publicIds.join(',')}`;

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
      {/* Header */}
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Tool visibility
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
          Toggle visibility for each tool below. Changes apply immediately on
          this device <em>and</em> are persisted to
          {' '}<code className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">client/.env</code>
          {' '}via the admin API so the new
          {' '}<code className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">VITE_PUBLIC_TOOLS</code>
          {' '}baseline survives across browsers. A Vite dev-server restart
          (or production rebuild) is required for the new baseline to take
          effect for fresh visitors — see the guide at the bottom.
        </p>
        {saving && (
          <p className="text-xs text-slate-500 dark:text-slate-400 italic">
            Saving to client/.env…
          </p>
        )}
      </header>

      {/* Summary chip + reset */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <Icon.Eye size={14} />
          <span>
            <strong className="text-slate-900 dark:text-slate-100">{publicCount}</strong>
            {' of '}
            <strong className="text-slate-900 dark:text-slate-100">{TOOL_REGISTRY.length}</strong>
            {' tools are public.'}
            {hasOverrides && (
              <span className="ml-2 chip bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-xs font-medium">
                <Icon.Warning size={11} />
                Local overrides active
              </span>
            )}
          </span>
        </div>

        {hasOverrides && (
          <button
            type="button"
            onClick={handleReset}
            className="btn-ghost text-xs"
            title="Drop local overrides — revert to env-var defaults"
          >
            <Icon.Trash size={12} />
            Reset to env defaults
          </button>
        )}
      </div>

      {/* Toggle list */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Tools
        </h3>
        <div className="space-y-2">
          {TOOL_REGISTRY.map((tool) => (
            <ToolToggleRow
              key={tool.id}
              tool={tool}
              isPublic={visibility[tool.id] === true}
              envDefault={envBase[tool.id] === true}
              isOverridden={Object.prototype.hasOwnProperty.call(overrides, tool.id)}
              onToggle={() => handleToggle(tool)}
            />
          ))}
        </div>
      </section>

      {/* Effective + env values */}
      <EnvValueBlocks
        envLine={envLine}
        effectiveEnvLine={effectiveEnvLine}
        hasOverrides={hasOverrides}
        onCopy={() => showToast('Copied to clipboard.', 'success')}
      />

      {/* How to publish cross-device */}
      <HowToPublish />
    </div>
  );
}

/* --------------------------------------------------------------------- */
/*  Tool toggle row                                                      */
/* --------------------------------------------------------------------- */

function ToolToggleRow({ tool, isPublic, envDefault, isOverridden, onToggle }) {
  const { Ico } = tool;
  return (
    <div className="card p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-brand-600 dark:text-brand-400 flex-shrink-0">
        <Ico size={20} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {tool.title}
          </h4>
          <span
            className={`chip text-xs font-medium ${
              isPublic
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            {isPublic ? (
              <>
                <Icon.Eye size={11} />
                Public
              </>
            ) : (
              <>
                <Icon.Lock size={11} />
                Admin-only
              </>
            )}
          </span>
          <code className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
            {tool.id}
          </code>
          {isOverridden && (
            <span
              className="chip text-[10px] font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
              title={`Env default for this tool: ${envDefault ? 'public' : 'admin-only'}`}
            >
              Override
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
          {tool.tagline}
        </p>
      </div>

      <Link
        to={tool.to}
        className="btn-ghost text-xs hidden md:inline-flex"
        title={`Open ${tool.title}`}
      >
        Open
        <Icon.ArrowRight size={12} />
      </Link>

      <ToggleSwitch checked={isPublic} onChange={onToggle} label={`Toggle ${tool.title}`} />
    </div>
  );
}

/* --------------------------------------------------------------------- */
/*  Toggle switch (accessible)                                           */
/* --------------------------------------------------------------------- */

function ToggleSwitch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={[
        'relative inline-flex flex-shrink-0 h-6 w-11 rounded-full transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2',
        'focus:ring-offset-white dark:focus:ring-offset-slate-900',
        checked
          ? 'bg-emerald-500 dark:bg-emerald-600'
          : 'bg-slate-300 dark:bg-slate-600',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0',
          'transition-transform duration-200 ease-out absolute top-0.5',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        ].join(' ')}
      />
    </button>
  );
}

/* --------------------------------------------------------------------- */
/*  Env value blocks (effective + base)                                  */
/* --------------------------------------------------------------------- */

function EnvValueBlocks({ envLine, effectiveEnvLine, hasOverrides, onCopy }) {
  return (
    <div className="space-y-3">
      <CopyableEnv
        label={hasOverrides ? 'Effective value (with your local overrides)' : 'Current value'}
        envLine={effectiveEnvLine}
        onCopy={onCopy}
        accent={hasOverrides}
      />
      {hasOverrides && (
        <CopyableEnv
          label="Env-var base (shared across all visitors)"
          envLine={envLine}
          onCopy={onCopy}
          muted
        />
      )}
    </div>
  );
}

function CopyableEnv({ label, envLine, onCopy, accent = false, muted = false }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(envLine);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — silent */
    }
  }

  return (
    <div
      className={[
        'rounded-lg border p-4 space-y-2',
        accent
          ? 'border-brand-200 dark:border-brand-900 bg-brand-50/60 dark:bg-brand-900/10'
          : muted
            ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 opacity-90'
            : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-700 dark:text-slate-300 uppercase tracking-wide">
          {label}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="btn-ghost text-xs"
          title="Copy to clipboard"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="font-mono text-xs text-slate-800 dark:text-slate-200 overflow-x-auto whitespace-pre-wrap break-all">
        {envLine}
      </pre>
    </div>
  );
}

/* --------------------------------------------------------------------- */
/*  How to publish cross-device                                          */
/* --------------------------------------------------------------------- */

function HowToPublish() {
  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-4 space-y-3">
      <div className="flex items-start gap-2">
        <Icon.Warning
          size={16}
          className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"
        />
        <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          How persistence works
        </h3>
      </div>

      <div className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed space-y-3 pl-6">
        <p>
          Each toggle does two things:
        </p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>
            Writes a per-device override in <code className="font-mono">localStorage</code>{' '}
            so this browser reflects the change instantly.
          </li>
          <li>
            Calls{' '}
            <code className="font-mono">POST /api/admin/tool-visibility</code> on the API,
            which rewrites the <code className="font-mono">VITE_PUBLIC_TOOLS</code> line
            inside <code className="font-mono">client/.env</code>.
          </li>
        </ol>

        <p>
          The API authenticates using the same admin password baked into the bundle
          (<code className="font-mono">VITE_ADMIN_PASSWORD</code>). The server-side variable
          is <code className="font-mono">ADMIN_PASSWORD</code> in{' '}
          <code className="font-mono">functions/ds-analyzer/.env</code> — the two must match.
        </p>

        <div>
          <p className="font-medium mb-1">After saving</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>
              <strong>Local dev:</strong> restart the Vite dev server so it picks up the
              new <code className="font-mono">VITE_PUBLIC_TOOLS</code> value. Until then,
              your localStorage override keeps the UI in sync.
            </li>
            <li>
              <strong>Production:</strong> rebuild (<code className="font-mono">npm run build</code>){' '}
              and redeploy <code className="font-mono">client/dist/</code> so fresh visitors
              get the new baseline.
            </li>
          </ul>
        </div>

        <p className="opacity-90">
          If the save call fails (server unreachable, <code className="font-mono">ADMIN_PASSWORD</code>{' '}
          not set, etc.), the toggle still applies locally and a toast explains the
          situation. Use <em>Reset to env defaults</em> to drop overrides whenever the env
          baseline already matches what you want.
        </p>
      </div>
    </div>
  );
}
