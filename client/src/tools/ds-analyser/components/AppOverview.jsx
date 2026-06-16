import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/Icons.jsx';
import FlowChartPanel from './FlowChartPanel.jsx';
import { formatFieldType } from '../lib/fieldTypes.js';
import { describePage } from '../lib/pageDescription.js';

/**
 * AppOverview — rendered right after the user clicks "Inspect app".
 *
 * Goal: give the user the *full technical scope* of their Creator .ds
 * in a friendly, scannable layout:
 *
 *   1. App header           — name, meta, LLM-written purpose/headline
 *   2. Stat tiles           — forms / reports / workflows / fields
 *   3. Key entities / risks — high-level bullets
 *   4. Technical Scope tabs
 *        · Forms       — expandable cards showing all fields + attached workflows
 *        · Reports     — base form, type, columns
 *        · Pages       — embedded forms/reports, script flag
 *        · Workflows   — trigger (event), target form, action kinds
 *        · Functions   — custom Deluge functions
 *        · Relations   — edge list (lookups, baseForm, embeds, attached WF)
 */
export default function AppOverview({ data }) {
  if (!data || !data.ok) return null;
  const scope = data.technicalScope || fallbackScope(data);

  // Hide Creator's built-in profiles — they're seeded automatically in
  // every app, carry the same canonical grants everywhere, and add no
  // review value. We match by exact (case-insensitive) profile name so
  // that user-created profiles whose names merely contain these words
  // (e.g. "Branch Administrator") are kept.
  //
  // Then drop any profile that isn't configured to access *at least one*
  // form or report. A permission set that only grants page-level access
  // (or nothing at all) adds no signal to the review, so we hide it to
  // keep the Permission Sets tab focused on meaningful access rules.
  const formNameSet = useMemo(
    () => new Set((scope.forms || []).map((f) => f.name)),
    [scope.forms]
  );
  const pageNameSet = useMemo(
    () => new Set((scope.pages || []).map((p) => p.name)),
    [scope.pages]
  );
  const profiles = useMemo(
    () =>
      (data.profiles || [])
        .filter((p) => !isDefaultProfile(p))
        .filter((p) => hasFormOrReportGrant(p, formNameSet, pageNameSet)),
    [data.profiles, formNameSet, pageNameSet]
  );

  return (
    <section className="space-y-6">
      {/* Technical Scope tabs — the header summary panel was removed
          intentionally to reduce redundant noise; the tabs below already
          expose every entity count plus full drill-down details. */}
      <ScopeTabs scope={scope} profiles={profiles} appName={data.app?.name || data.meta?.appName || 'application'} />
    </section>
  );
}

/** Creator seeds every app with an `Administrator` and `Developer` profile.
 *  These are implicit and never customised by the user, so we filter them
 *  out of the Permission Sets tab to keep the review focused on app-specific
 *  access rules. */
const DEFAULT_PROFILE_NAMES = new Set(['administrator', 'developer']);
function isDefaultProfile(p) {
  const n = String(p?.name || '').trim().toLowerCase();
  return DEFAULT_PROFILE_NAMES.has(n);
}

/** Does this profile grant access to at least one form or one report?
 *
 *  `modulePermissions[i].form` is an entity name that may refer to a Form,
 *  Report, or Page. We classify by cross-referencing the roster sets — a
 *  permission entry targeting a page does NOT count toward this check, so
 *  a profile that only exposes pages (with no form/report grants) is hidden.
 *
 *  Unknown targets (not in any roster) are treated as forms, mirroring the
 *  bucketing that `PermissionSetCard` performs — most .ds files declare the
 *  permission target as a form name, so defaulting to "form" is the safe
 *  classification.
 *
 *  Reports are counted via the nested `reportPermissions` map on each form
 *  entry. Any non-empty map means the profile is configured for at least
 *  one report. */
function hasFormOrReportGrant(profile, formNameSet, pageNameSet) {
  const mps = profile?.modulePermissions || [];
  for (const mp of mps) {
    // Report ACLs — a single configured report is sufficient.
    if (mp.reportPermissions && Object.keys(mp.reportPermissions).length > 0) {
      return true;
    }
    // Form / unknown target — skip pages; anything else is a form grant.
    // Unknown names (in neither roster) default to the form bucket, matching
    // the bucketing logic in `PermissionSetCard`.
    const target = mp.form;
    if (target && !pageNameSet.has(target)) {
      return true;
    }
  }
  return false;
}

/* ========================================================================== */
/*  Scope tabs — raw reference tables                                          */
/*                                                                             */
/*    Forms · Reports · Pages · Workflows · Functions · Relationships          */
/* ========================================================================== */

function ScopeTabs({ scope, profiles = [], appName = 'application' }) {
  const tabs = [
    { key: 'forms', label: 'Forms', count: scope.forms?.length || 0 },
    { key: 'reports', label: 'Reports', count: scope.reports?.length || 0 },
    { key: 'pages', label: 'Pages', count: scope.pages?.length || 0 },
    { key: 'workflows', label: 'Workflows', count: scope.workflows?.length || 0 },
    { key: 'permissions', label: 'Permission Sets', count: profiles.length || 0 },
    { key: 'flowchart', label: 'Flow Chart' },
  ];
  const [tab, setTab] = useState('forms');

  // Cross-tab deep-link state. When the user clicks a relationship pill
  // inside one tab we switch to the target tab and auto-expand that
  // entity's card. Kept here (in the tab container) so it survives tab
  // switches and so any child can trigger it without prop-drilling
  // parents.
  const [focusFormName, setFocusFormName] = useState(null);
  const [focusWorkflowName, setFocusWorkflowName] = useState(null);

  // Workflow preview popup state. Clicking a "Related workflow" pill on a
  // form card opens the workflow *in-place* in a modal instead of switching
  // tabs — this keeps the user anchored on the form they were inspecting
  // while still giving them the full workflow source + metadata.
  const [previewWorkflow, setPreviewWorkflow] = useState(null);

  const focusForm = (id) => {
    const [kind, ...rest] = String(id || '').split(':');
    if (kind === 'form' && rest.length) {
      setFocusFormName(rest.join(':'));
      setTab('forms');
    }
  };

  /** Deep-link handler: "open this workflow in the Workflows tab". */
  const openWorkflow = (name) => {
    if (!name) return;
    setFocusWorkflowName(name);
    setTab('workflows');
  };

  /** Popup handler: "show this workflow in a modal without leaving the form". */
  const previewWorkflowByName = (name) => {
    if (!name) return;
    const wf = (scope.workflows || []).find((w) => w.name === name);
    if (wf) setPreviewWorkflow(wf);
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Application breakdown
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Raw reference tables for every entity parsed from the .ds file.
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        {tabs.map((t) => (
          <TabButton key={t.key} t={t} active={tab === t.key} onClick={() => setTab(t.key)} />
        ))}
      </div>

      <div className="pt-5">
        {tab === 'forms' && (
          <FormsSection
            forms={scope.forms || []}
            reports={scope.reports || []}
            pages={scope.pages || []}
            workflows={scope.workflows || []}
            initialOpenName={focusFormName}
            onPreviewWorkflow={previewWorkflowByName}
          />
        )}
        {tab === 'reports' && (
          <ReportsTable reports={scope.reports || []} onFocusInFlow={focusForm} />
        )}
        {tab === 'pages' && (
          <PagesTable pages={scope.pages || []} onFocusInFlow={focusForm} />
        )}
        {tab === 'workflows' && (
          <WorkflowsTable
            workflows={scope.workflows || []}
            onFocusInFlow={focusForm}
            initialOpenName={focusWorkflowName}
          />
        )}
        {tab === 'permissions' && (
          <PermissionSetsSection
            profiles={profiles}
            forms={scope.forms || []}
            reports={scope.reports || []}
            pages={scope.pages || []}
          />
        )}
        {tab === 'flowchart' && (
          <FlowChartPanel scope={scope} appName={appName} />
        )}
      </div>

      {previewWorkflow && (
        <WorkflowPopup
          workflow={previewWorkflow}
          onClose={() => setPreviewWorkflow(null)}
          onOpenInTab={() => {
            const name = previewWorkflow.name;
            setPreviewWorkflow(null);
            openWorkflow(name);
          }}
        />
      )}
    </div>
  );
}

function TabButton({ t, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm font-medium transition border-b-2 -mb-px whitespace-nowrap
        ${
          active
            ? 'border-brand-600 text-brand-700 dark:text-brand-300'
            : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
        }`}
    >
      {t.label}{' '}
      {t.count != null && (
        <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">· {t.count}</span>
      )}
    </button>
  );
}

/* ========================================================================== */
/*  Forms — expandable cards with full field tables + attached workflows      */
/* ========================================================================== */

function FormsSection({ forms, reports, pages, workflows, initialOpenName, onPreviewWorkflow }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return forms;
    return forms.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.displayName || '').toLowerCase().includes(q) ||
        (f.fields || []).some((fd) => fd.name.toLowerCase().includes(q))
    );
  }, [forms, query]);

  // Pre-compute relations once per prop change so the per-card render is O(1).
  const reportsByForm = useMemo(() => {
    const map = {};
    for (const r of reports || []) {
      if (!r.baseForm) continue;
      (map[r.baseForm] ||= []).push(r);
    }
    return map;
  }, [reports]);

  const pagesByForm = useMemo(() => {
    const map = {};
    for (const p of pages || []) {
      for (const fname of p.embeddedForms || []) {
        (map[fname] ||= []).push(p);
      }
    }
    return map;
  }, [pages]);

  if (forms.length === 0) {
    return <Empty text="No forms detected." />;
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter forms or fields…"
        className="w-full md:w-80 px-3 py-1.5 text-sm rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
      <div className="space-y-2">
        {filtered.map((f) => (
          <FormCard
            key={f.name}
            form={f}
            relatedReports={reportsByForm[f.name] || []}
            relatedPages={pagesByForm[f.name] || []}
            defaultOpen={f.name === initialOpenName}
            onPreviewWorkflow={onPreviewWorkflow}
          />
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">No matches.</p>
        )}
      </div>
    </div>
  );
}

function FormCard({
  form,
  relatedReports = [],
  relatedPages = [],
  defaultOpen = false,
  onPreviewWorkflow,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const fields = form.fields || [];
  // Only show *form-based* workflows (i.e. `scope === 'form'` → `on add`,
  // `on edit`, `on delete`, `on validate`, etc.). Entries where
  // `scope === 'functions'` are custom action / button functions declared
  // inside the form — they are Deluge functions, not event-driven workflows,
  // and belong in the dedicated Functions/Custom-action listing instead.
  // Scheduled workflows (`scope === 'schedule'`) are also excluded since
  // they don't fire off a form event.
  const wfs = (form.workflows || []).filter((w) => {
    const s = String(w.scope || '').toLowerCase();
    return s === '' || s === 'form';
  });

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50/50 dark:bg-slate-800/30">
      <div className="w-full flex items-center justify-between gap-3 px-4 py-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 min-w-0 text-left flex items-start gap-3 group"
          aria-expanded={open}
        >
          <span
            className={`shrink-0 mt-1 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden
          >
            ▸
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-slate-900 dark:text-slate-100 group-hover:text-brand-700 dark:group-hover:text-brand-300">
                {form.displayName || form.name}
              </span>
              {form.displayName && form.displayName !== form.name && (
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {form.name}
                </span>
              )}
            </span>
            <span className="flex flex-wrap gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
              <span>{fields.length} field(s)</span>
              <span>· {form.requiredFields?.length || 0} required</span>
              {wfs.length > 0 && <span>· {wfs.length} workflow(s)</span>}
              {relatedReports.length > 0 && <span>· {relatedReports.length} report(s)</span>}
              {relatedPages.length > 0 && <span>· {relatedPages.length} page(s)</span>}
              {form.actionEvents?.length > 0 && (
                <span>· events: {form.actionEvents.join(', ')}</span>
              )}
            </span>
          </span>
        </button>

      </div>

      {open && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-4 space-y-4">
          {/* Fields table */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-2">
              Fields
            </h4>
            {fields.length === 0 ? (
              <Empty text="No fields declared." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                      <th className="py-1.5 pr-3 font-medium">Name</th>
                      <th className="py-1.5 pr-3 font-medium">Type</th>
                      <th className="py-1.5 pr-3 font-medium">Attrs</th>
                      <th className="py-1.5 pr-3 font-medium">Max</th>
                      <th className="py-1.5 pr-3 font-medium">Lookup</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {fields.map((fd) => (
                      <tr key={fd.name} className="text-slate-700 dark:text-slate-200">
                        <td className="py-1.5 pr-3">
                          <div className="font-medium">{fd.displayName || fd.name}</div>
                          {fd.displayName && fd.displayName !== fd.name && (
                            <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
                              {fd.name}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          <span
                            className="text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded"
                            title={fd.type || 'unknown'}
                          >
                            {formatFieldType(fd)}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-xs">
                          {fd.required && (
                            <span className="chip bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 mr-1">
                              required
                            </span>
                          )}
                          {fd.unique && (
                            <span className="chip bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                              unique
                            </span>
                          )}
                          {!fd.required && !fd.unique && (
                            <span className="text-slate-400 dark:text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-xs text-slate-500 dark:text-slate-400">
                          {fd.maxLength ?? '—'}
                        </td>
                        <td className="py-1.5 pr-3 text-xs font-mono text-slate-500 dark:text-slate-400">
                          {renderLookup(fd.lookup)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Related reports */}
          {relatedReports.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-2">
                Related reports
              </h4>
              <div className="flex flex-wrap gap-2">
                {relatedReports.map((r) => (
                  <span
                    key={r.name}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium
                               bg-purple-50 text-purple-700 border border-purple-200
                               dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800/60"
                    title={r.baseForm ? `Base form: ${r.baseForm}` : undefined}
                  >
                    <Icon.FileCode size={12} />
                    {r.displayName || r.name}
                    {r.type && (
                      <span className="opacity-70">· {r.type}</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Attached workflows — clickable pills that deep-link into the
              Workflows tab and auto-expand the target workflow's card. */}
          {wfs.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-2">
                Related workflows
              </h4>
              <div className="flex flex-wrap gap-2">
                {wfs.map((w) => {
                  const label = w.displayName || w.name;
                  const title = [
                    w.event ? `Event: ${w.event}` : null,
                    w.actionKinds?.length ? `Actions: ${w.actionKinds.join(', ')}` : null,
                    'Click to preview the workflow source',
                  ]
                    .filter(Boolean)
                    .join(' · ');

                  const content = (
                    <>
                      <Icon.Plan size={12} />
                      <span className="font-medium">{label}</span>
                      {w.event && (
                        <span className="opacity-70">· on {w.event}</span>
                      )}
                      {w.actionKinds?.length > 0 && (
                        <span className="opacity-70">
                          · {w.actionKinds.slice(0, 2).join(', ')}
                          {w.actionKinds.length > 2 ? '…' : ''}
                        </span>
                      )}
                    </>
                  );

                  const baseCls =
                    'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs ' +
                    'bg-brand-50 text-brand-700 border border-brand-200 ' +
                    'dark:bg-brand-900/30 dark:text-brand-300 dark:border-brand-800/60';

                  return onPreviewWorkflow ? (
                    <button
                      key={w.name}
                      type="button"
                      onClick={() => onPreviewWorkflow(w.name)}
                      title={title}
                      className={`${baseCls} hover:bg-brand-100 dark:hover:bg-brand-900/50 transition cursor-pointer`}
                    >
                      {content}
                    </button>
                  ) : (
                    <span key={w.name} title={title} className={baseCls}>
                      {content}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Related pages */}
          {relatedPages.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-2">
                Related pages
              </h4>
              <div className="flex flex-wrap gap-2">
                {relatedPages.map((p) => (
                  <span
                    key={p.name}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium
                               bg-emerald-50 text-emerald-700 border border-emerald-200
                               dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/60"
                  >
                    <Icon.Folder size={12} />
                    {p.displayName || p.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function renderLookup(lk) {
  if (!lk) return '—';
  if (typeof lk === 'string') return lk;
  if (typeof lk === 'object') {
    return lk.form || lk.target || lk.formName || JSON.stringify(lk);
  }
  return String(lk);
}

/* ========================================================================== */
/*  Reports / Pages / Workflows / Functions                                    */
/* ========================================================================== */

function FlowLink({ onClick, children }) {
  if (!onClick) return <>{children}</>;
  return (
    <button
      onClick={onClick}
      className="text-left font-medium text-slate-900 dark:text-slate-100 hover:text-brand-700 dark:hover:text-brand-300 hover:underline decoration-dotted underline-offset-4"
      title="Show connections in the Flowchart"
    >
      {children}
    </button>
  );
}

function ReportsTable({ reports, onFocusInFlow }) {
  if (reports.length === 0) return <Empty text="No reports detected." />;
  return (
    <SimpleTable
      columns={['Name', 'Type', 'Base form', 'Columns', 'Custom actions', 'Hidden']}
      rows={reports.map((r) => [
        <FlowLink key="n" onClick={onFocusInFlow ? () => onFocusInFlow(`report:${r.name}`) : null}>
          {r.displayName || r.name}
        </FlowLink>,
        <code key="t" className="text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
          {r.type || '—'}
        </code>,
        r.baseForm ? (
          <FlowLink key="b" onClick={onFocusInFlow ? () => onFocusInFlow(`form:${r.baseForm}`) : null}>
            <span className="text-xs font-mono">{r.baseForm}</span>
          </FlowLink>
        ) : (
          <span key="b" className="text-xs font-mono text-slate-500 dark:text-slate-400">—</span>
        ),
        r.columnCount ?? '—',
        (r.customActions || []).join(', ') || '—',
        r.hidden ? 'yes' : '—',
      ])}
    />
  );
}

function PagesTable({ pages, onFocusInFlow }) {
  const [openName, setOpenName] = useState(null);
  if (pages.length === 0) return <Empty text="No pages detected." />;

  return (
    <div className="space-y-2">
      {pages.map((p) => {
        const open = openName === p.name;
        return (
          <div
            key={p.name}
            className="border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50/50 dark:bg-slate-800/30"
          >
            <button
              onClick={() => setOpenName(open ? null : p.name)}
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
                  <span className="font-medium text-slate-900 dark:text-slate-100 group-hover:text-brand-700 dark:group-hover:text-brand-300">
                    {p.displayName || p.name}
                  </span>
                  {p.section && (
                    <span className="chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 text-xs">
                      {p.section}
                    </span>
                  )}
                  {p.hidden && (
                    <span className="chip bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-xs">
                      hidden
                    </span>
                  )}
                  {p.hasScript && (
                    <span className="chip bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-xs">
                      script
                    </span>
                  )}
                </span>
                <span className="flex flex-wrap gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {p.embeddedForms?.length > 0 && (
                    <span>
                      forms: {p.embeddedForms.map((f) => (
                        <FlowLink
                          key={f}
                          onClick={onFocusInFlow ? () => onFocusInFlow(`form:${f}`) : null}
                        >
                          <span className="font-mono">{f}</span>
                        </FlowLink>
                      )).reduce((prev, curr) => [prev, ', ', curr])}
                    </span>
                  )}
                  {p.embeddedReports?.length > 0 && (
                    <span>· reports: {p.embeddedReports.join(', ')}</span>
                  )}
                  {p.sourceCode && (
                    <span>· {p.sourceCode.split('\n').length} lines</span>
                  )}
                </span>
              </span>
            </button>

            {open && (
              <div className="border-t border-slate-200 dark:border-slate-700 p-3">
                <PageDescription page={p} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ========================================================================== */
/*  Page preview components were removed — a simulated dummy-data render of   */
/*  a Creator page was misleading (Deluge logic, validations, dynamic CSS     */
/*  and server-side fetches can't be faithfully mocked from static metadata). */
/*  The plain-English `PageDescription` card below covers what the page does  */
/*  by analysing its Deluge + HTML + CSS directly. See lib/pageDescription.js.*/
/* ========================================================================== */

/* ========================================================================== */
/*  Page description — plain-English summary of a Creator Page's              */
/*  Deluge + HTML + CSS mix. The raw source is NOT shown — pages routinely    */
/*  span thousands of lines, and the interesting thing is WHAT the page does, */
/*  not its exact markup. See lib/pageDescription.js for the analysis rules.  */
/* ========================================================================== */

function PageDescription({ page }) {
  const { headline, composition, behaviour, externals, notes, sizeLine } = useMemo(
    () => describePage(page),
    [page]
  );

  return (
    <div className="rounded-md border border-brand-200 dark:border-brand-800/60 bg-brand-50/70 dark:bg-brand-900/20 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
          <Icon.Plan size={11} /> What this page does
        </div>
        <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
          {sizeLine}
        </div>
      </div>

      <p className="text-sm text-slate-800 dark:text-slate-100 font-medium leading-relaxed">
        {headline}
      </p>

      <DescriptionList title="Composition" items={composition} />
      <DescriptionList title="Behaviour" items={behaviour} />
      <DescriptionList title="External references" items={externals} />

      {notes.length > 0 && (
        <p className="text-xs italic text-slate-500 dark:text-slate-400">
          {notes.join(' · ')}
        </p>
      )}

      <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-brand-200/60 dark:border-brand-800/40">
        Pages combine Deluge + HTML + CSS. Raw source is intentionally hidden —
        this summary captures the page's intent without the clutter.
      </p>
    </div>
  );
}

function DescriptionList({ title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
        {title}
      </div>
      <ul className="list-disc ml-5 space-y-0.5 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function WorkflowsTable({ workflows, onFocusInFlow, initialOpenName }) {
  const [openName, setOpenName] = useState(initialOpenName || null);
  const [highlightName, setHighlightName] = useState(initialOpenName || null);
  const rowRefs = useRef({});

  // Whenever the parent re-focuses a workflow (via the "Related workflows"
  // pill on a form card), open that card and scroll it into view.
  useEffect(() => {
    if (!initialOpenName) return;
    setOpenName(initialOpenName);
    setHighlightName(initialOpenName);
    const el = rowRefs.current[initialOpenName];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    // Remove the highlight ring after the user has had a moment to spot it.
    const t = setTimeout(() => setHighlightName(null), 1600);
    return () => clearTimeout(t);
  }, [initialOpenName]);

  if (workflows.length === 0) return <Empty text="No workflows detected." />;

  return (
    <div className="space-y-2">
      {workflows.map((w) => {
        const open = openName === w.name;
        const highlighted = highlightName === w.name;
        return (
          <div
            key={w.name}
            ref={(el) => {
              if (el) rowRefs.current[w.name] = el;
            }}
            className={`border rounded-lg bg-slate-50/50 dark:bg-slate-800/30 transition-shadow ${
              highlighted
                ? 'border-brand-500 dark:border-brand-400 ring-2 ring-brand-400/40 dark:ring-brand-500/30'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <button
              onClick={() => setOpenName(open ? null : w.name)}
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
                  <span className="font-medium text-slate-900 dark:text-slate-100 group-hover:text-brand-700 dark:group-hover:text-brand-300">
                    {w.displayName || w.name}
                  </span>
                  {w.event && (
                    <span className="chip bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                      on {w.event}
                    </span>
                  )}
                  {w.scope && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">{w.scope}</span>
                  )}
                  {w.type && (
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400">{w.type}</span>
                  )}
                </span>
                <span className="flex flex-wrap gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {w.form ? (
                    <FlowLink
                      onClick={onFocusInFlow ? () => onFocusInFlow(`form:${w.form}`) : null}
                    >
                      <span className="text-xs font-mono">on {w.form}</span>
                    </FlowLink>
                  ) : (
                    <span>no target form</span>
                  )}
                  {w.actionKinds?.length > 0 && (
                    <span>· actions: {w.actionKinds.join(', ')}</span>
                  )}
                  {w.sourceCode && (
                    <span>· {w.sourceCode.split('\n').length} lines</span>
                  )}
                </span>
              </span>
            </button>

            {open && (
              <div className="border-t border-slate-200 dark:border-slate-700 p-3 space-y-3">
                <WorkflowDescription workflow={w} />
                <SourceBlock code={w.sourceCode} label={`Workflow · ${w.name}`} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ========================================================================== */
/*  Workflow description — deterministic, plain-English walk of the Deluge     */
/*  source. See docs/shared/deluge-reference.md for the canonical statement →  */
/*  description mapping; any new pattern added here must also be documented    */
/*  there so the two stay in sync.                                             */
/*                                                                             */
/*  Output shape:                                                              */
/*    { trigger: string, actions: string[], notes: string[] }                  */
/*  Rendered by <WorkflowDescription/> as:                                     */
/*    · a short "When & where" paragraph                                       */
/*    · a numbered "Step-by-step" list                                         */
/*    · a muted notes line at the bottom                                       */
/* ========================================================================== */

/** 1. Trigger sentence — where/when the workflow fires. */
function describeTrigger(w) {
  // The parser stores events verbatim ("on add", "on add or edit", …).
  // Strip the leading "on " so our lookup table is clean.
  const rawEvent = String(w?.event || '').trim().toLowerCase();
  const event = rawEvent.replace(/^on\s+/, '');
  const scope = String(w?.scope || '').trim().toLowerCase();
  const form = w?.form ? `**${w.form}**` : 'the form';

  if (scope === 'schedule') {
    return `Runs on a **scheduled** basis${w?.form ? ` against ${form}` : ''}.`;
  }
  if (scope === 'functions') {
    return `Custom function (button / action) on ${form}. Runs only when called explicitly.`;
  }

  const phrase =
    event === 'add' ? 'when a new record is **added**'
    : event === 'edit' ? 'when a record is **edited**'
    : event === 'add or edit' ? 'when a record is **added or edited**'
    : event === 'delete' ? 'when a record is **deleted**'
    : event === 'validate' ? 'to **validate** the form before submit'
    : event === 'load' ? 'when the form **loads**'
    : event === 'user input' ? 'when the user **changes a field**'
    : event ? `on **${event}**` : 'when triggered';

  return `Runs ${phrase} of ${form}.`;
}

/**
 * 2. Extract the executable body from a workflow's raw source. Real
 * Creator exports wrap logic either as:
 *
 *     custom deluge script ( … )            // imperative script
 *     actions { hide X,Y; }                 // declarative field rule
 *     actions { disable A,B; }              //    "     "     "
 *
 * We join the bodies of every `actions { … }` block with semicolons so
 * the line-splitter can emit one step per action. Falls back to the
 * whole raw source when no wrapper is found (schedule / function
 * bodies).
 */
function extractDelugeBody(rawSource) {
  if (!rawSource) return '';

  // 2a. Custom deluge script — the common case. The body is wrapped in
  //     `( … )` which typically contains its own parentheses (e.g. inside
  //     `if (cond)` expressions). We anchor the close on `)` followed by
  //     a closing `}` so inner parens are ignored.
  const script = rawSource.match(/custom\s+deluge\s+script\s*\(\s*([\s\S]*?)\s*\)\s*}/i);
  if (script && script[1] && script[1].trim()) return script[1];

  // 2b. Declarative field-rule actions. A workflow may have several of
  //     these; we concatenate each block's body separated by ';' so
  //     `toLogicalLines` can split them cleanly.
  const blocks = [];
  const actionRe = /\bactions\s*\{([\s\S]*?)\}/gi;
  let am;
  while ((am = actionRe.exec(rawSource)) !== null) {
    const inner = am[1].trim();
    if (inner) blocks.push(inner);
  }
  if (blocks.length) return blocks.join('; ');

  return rawSource;
}

/**
 * 3. Strip comments and collapse whitespace so our regexes can match
 * without worrying about tab/newline noise. We deliberately keep an
 * array of "logical lines" (split on ';' or newline) so step numbering
 * mirrors what the user sees.
 */
function toLogicalLines(body) {
  if (!body) return [];
  // Strip // line comments and /* */ block comments.
  const noLine = body.replace(/\/\/[^\n]*/g, '');
  const noBlock = noLine.replace(/\/\*[\s\S]*?\*\//g, '');
  // Split on ';' at top level AND on newlines — we'll rejoin multi-line
  // brace structures (sendmail / invokeurl / insert into) below.
  const lines = [];
  let buf = '';
  let bracketDepth = 0;
  let braceDepth = 0;
  for (const ch of noBlock) {
    if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);

    // Split on ';' only when we're not inside brackets/braces (keeps
    // `sendmail [ … ]` and `if { … }` together as one chunk).
    if (ch === ';' && bracketDepth === 0 && braceDepth === 0) {
      const s = buf.trim();
      if (s) lines.push(s);
      buf = '';
    } else {
      buf += ch;
    }
  }
  const tail = buf.trim();
  if (tail) lines.push(tail);
  return lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Quote-and-strip a value for inline rendering inside descriptions. */
function prettyValue(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (/^zoho\.loginuserid$/i.test(s)) return 'the logged-in user\'s email';
  if (/^zoho\.loginuser$/i.test(s)) return 'the logged-in user';
  if (/^zoho\.currentdate$/i.test(s)) return "today's date";
  if (/^input\.[A-Za-z_][\w]*$/.test(s)) return `the submitted *${s.slice(6)}*`;
  // Truncate overly long literals
  if (s.length > 60) return `\`${s.slice(0, 57)}…\``;
  return `\`${s}\``;
}

/**
 * 4. Describe a single logical statement. Returns a plain-English string
 * (may include **bold** markers) or null to skip.
 *
 * Pattern priority matters — the first match wins, so we put the most
 * specific patterns first.
 */
function describeStatement(stmt) {
  if (!stmt || stmt.length < 2) return null;

  // -- sendmail [ … ] ------------------------------------------------------
  let m = stmt.match(/^sendmail\s*\[(.+)\]\s*$/is);
  if (m) {
    const body = m[1];
    const to = (body.match(/\bto\s*:\s*([^\n]+?)(?:\s+(?:from|subject|message|cc|bcc)\s*:|$)/i) || [])[1];
    const subj = (body.match(/\bsubject\s*:\s*([^\n]+?)(?:\s+(?:from|to|message|cc|bcc)\s*:|$)/i) || [])[1];
    const parts = ['Sends an **email**'];
    if (to) parts.push(`to ${prettyValue(to.trim())}`);
    if (subj) parts.push(`with subject ${prettyValue(subj.trim())}`);
    return parts.join(' ') + '.';
  }

  // -- invokeurl [ … ] -----------------------------------------------------
  m = stmt.match(/^invokeurl\s*\[(.+)\]\s*$/is);
  if (m) {
    const body = m[1];
    const url = (body.match(/\burl\s*:\s*([^\n]+?)(?:\s+(?:type|parameters|headers|connection)\s*:|$)/i) || [])[1];
    const type = (body.match(/\btype\s*:\s*([A-Z]+)/i) || [])[1];
    const u = url ? prettyValue(url.trim()) : 'an external URL';
    return `Calls ${u}${type ? ` with **${type.toUpperCase()}**` : ''} (external API).`;
  }

  // -- insert into Form [ … ] ---------------------------------------------
  m = stmt.match(/^(?:\w+\s*=\s*)?insert\s+into\s+([A-Za-z_]\w*)\s*\[(.+)\]\s*$/is);
  if (m) {
    const form = m[1];
    const body = m[2];
    const fieldCount = (body.match(/\b[A-Za-z_]\w*\s*=/g) || []).length;
    return `Creates a new **${form}** record${fieldCount ? ` with ${fieldCount} field${fieldCount === 1 ? '' : 's'}` : ''}.`;
  }

  // -- <Form>[criteria].field / .count() / .getAll() ----------------------
  m = stmt.match(/^(\w+)\s*=\s*([A-Z][A-Za-z0-9_]*)\[([^\]]+)\](?:\.(\w+))?(?:\.(count|getAll|sum|max|min|avg))?\s*\(?\s*\)?\s*$/);
  if (m) {
    const varName = m[1];
    const form = m[2];
    const field = m[4];
    const agg = m[5];
    const aggLabel = agg === 'count' ? ' (count)' : agg === 'getAll' ? ' (all matching values)' : agg ? ` (${agg})` : '';
    if (field) {
      return `Fetches **${form}.${field}**${aggLabel} into \`${varName}\`.`;
    }
    return `Fetches matching **${form}** records into \`${varName}\`${aggLabel}.`;
  }

  // -- <var>.<Field> = <value>  (record field write on a fetched record) --
  m = stmt.match(/^(\w+)\.([A-Za-z_]\w*)\s*=\s*(.+)$/);
  if (m && !/^input$/i.test(m[1])) {
    const varName = m[1];
    const field = m[2];
    const value = m[3];
    return `Updates **${varName}.${field}** → ${prettyValue(value)}.`;
  }

  // -- input.Field = value ------------------------------------------------
  m = stmt.match(/^input\.([A-Za-z_]\w*)\s*=\s*(.+)$/);
  if (m) {
    return `Sets the form's **${m[1]}** field to ${prettyValue(m[2])}.`;
  }

  // -- thisapp.<ns>.<fn>(args) --------------------------------------------
  m = stmt.match(/^(?:\w+\s*=\s*)?thisapp\.([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?\s*\(([^)]*)\)\s*$/);
  if (m) {
    const ns = m[1];
    const fn = m[2];
    const args = m[3].trim();
    const argCount = args ? args.split(',').length : 0;
    const fnName = fn ? `**${ns}.${fn}**` : `**${ns}**`;
    return `Calls the custom function ${fnName}${argCount ? ` with ${argCount} argument${argCount === 1 ? '' : 's'}` : ''}.`;
  }

  // -- openUrl("#Page:Foo", "same window") --------------------------------
  m = stmt.match(/^openUrl\s*\(\s*"([^"]+)"\s*,/i);
  if (m) {
    const target = m[1];
    if (/#Script:page\.reload/i.test(target)) return 'Reloads the current page.';
    const hash = target.match(/#(Page|Report|Form):([A-Za-z_]\w*)/);
    if (hash) {
      const kind = hash[1].toLowerCase();
      return `Navigates the user to the **${hash[2]}** ${kind}.`;
    }
    return `Opens ${prettyValue(target)}.`;
  }

  // -- alert "…" / info "…" ------------------------------------------------
  m = stmt.match(/^(alert|info)\s+"([^"]*)"\s*$/i);
  if (m) {
    const kind = m[1].toLowerCase();
    return `${kind === 'alert' ? 'Shows an **alert**' : 'Shows an **info message**'}: ${prettyValue(m[2])}.`;
  }

  // -- show / hide / disable / enable X, Y ---------------------------------
  m = stmt.match(/^(show|hide|disable|enable)\s+(.+)$/i);
  if (m) {
    const verb = m[1].toLowerCase();
    // Filter out modifiers like "add row of", "delete row of"
    const targets = m[2]
      .replace(/\b(add|delete)\s+row\s+of\s+/gi, '')
      .split(/\s*,\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!targets.length) return null;
    const labels = targets.map((t) => `**${t}**`).join(', ');
    const verbLabel = verb === 'show' ? 'Shows' : verb === 'hide' ? 'Hides' : verb === 'disable' ? 'Disables' : 'Enables';
    return `${verbLabel} the field${targets.length === 1 ? '' : 's'} ${labels}.`;
  }

  // -- for each v in collection { … } -------------------------------------
  m = stmt.match(/^for\s+each\s+(\w+)\s+in\s+([^\s{]+)/i);
  if (m) {
    return `Loops over each entry in \`${m[2]}\` (as \`${m[1]}\`).`;
  }

  // -- if ( cond ) { … } ---------------------------------------------------
  m = stmt.match(/^if\s*\(([^)]+)\)/i);
  if (m) {
    let cond = m[1].trim();
    // Normalise common idioms
    cond = cond
      .replace(/\s*==\s*null\s*$/i, ' is empty')
      .replace(/\s*!=\s*null\s*$/i, ' is filled in')
      .replace(/\.count\(\)\s*==\s*0\s*$/i, ' has no records')
      .replace(/\.count\(\)\s*>\s*0\s*$/i, ' has records')
      .replace(/^input\./i, '');
    if (cond.length > 80) cond = cond.slice(0, 77) + '…';
    return `If **${cond}**, runs a conditional branch.`;
  }

  // -- simple variable assignment (scalar) ---------------------------------
  m = stmt.match(/^(\w+)\s*=\s*(.+)$/);
  if (m && !/[[\]{}]/.test(m[2])) {
    // Only describe if the RHS is simple-ish and non-trivial
    if (m[2].length < 60 && /[a-zA-Z_]/.test(m[2])) {
      return `Computes \`${m[1]}\` = ${prettyValue(m[2])}.`;
    }
  }

  return null;
}

/** 5. Main: build { trigger, actions[], notes[] } from a workflow. */
function describeWorkflow(w) {
  if (!w) return { trigger: '', actions: [], notes: [] };

  const trigger = describeTrigger(w);
  const body = extractDelugeBody(w.sourceCode);
  const lines = toLogicalLines(body);

  const actions = [];
  const MAX_ACTIONS = 12;
  for (const line of lines) {
    const desc = describeStatement(line);
    if (desc && !actions.includes(desc)) {
      actions.push(desc);
      if (actions.length >= MAX_ACTIONS) break;
    }
  }

  // Is the original body effectively empty (only comments / whitespace)?
  const rawBodyLines = (body || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !/^\/\*/.test(l) && !/^\*\/?$/.test(l));

  const notes = [];
  if (!rawBodyLines.length) {
    notes.push('The workflow has no executable code (empty or fully commented out).');
  } else if (!actions.length) {
    notes.push(
      `The body has ~${rawBodyLines.length} line${rawBodyLines.length === 1 ? '' : 's'} of Deluge but uses patterns this explainer doesn't recognise — read the code below for details.`
    );
  } else if (lines.length > actions.length + 2) {
    const skipped = lines.length - actions.length;
    notes.push(
      `+${skipped} more statement${skipped === 1 ? '' : 's'} not shown (helper assignments, complex expressions).`
    );
  }

  return { trigger, actions, notes };
}

/** Convert a string with **bold** markers to React nodes. */
function renderBold(text, keyPrefix = 'b') {
  const segments = String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return segments.map((seg, i) =>
    seg.startsWith('**') && seg.endsWith('**') ? (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold text-slate-900 dark:text-slate-100">
        {seg.slice(2, -2)}
      </strong>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{seg}</span>
    )
  );
}

/** Render the structured description: trigger paragraph + numbered steps. */
function WorkflowDescription({ workflow }) {
  const { trigger, actions, notes } = useMemo(
    () => describeWorkflow(workflow),
    [workflow]
  );
  if (!trigger && !actions.length && !notes.length) return null;

  return (
    <div className="rounded-md border border-brand-200 dark:border-brand-800/60 bg-brand-50/70 dark:bg-brand-900/20 px-4 py-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
        <Icon.Plan size={11} /> What this code does
      </div>

      {trigger && (
        <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
          {renderBold(trigger, 'trig')}
        </p>
      )}

      {actions.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
            Step-by-step
          </div>
          <ol className="list-decimal ml-5 space-y-1 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
            {actions.map((a, i) => (
              <li key={i}>{renderBold(a, `a${i}`)}</li>
            ))}
          </ol>
        </div>
      )}

      {notes.length > 0 && (
        <p className="text-xs italic text-slate-500 dark:text-slate-400">
          {notes.map((n, i) => (
            <span key={i}>
              {i > 0 ? ' ' : ''}
              {n}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  Source-code viewer for workflows & pages                                   */
/* ========================================================================== */

function SourceBlock({ code, label }) {
  const [copied, setCopied] = useState(false);

  if (!code) {
    return (
      <div className="text-xs text-slate-500 dark:text-slate-400 italic py-2">
        Source not available — the parser could not preserve the raw <code>.ds</code> slice.
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="rounded-md border border-slate-800 bg-slate-950 overflow-hidden shadow-inner">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <Icon.Code size={12} />
          <span>{label || 'Source'}</span>
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs text-slate-300 hover:bg-slate-800 transition"
          title="Copy source"
        >
          {copied ? <Icon.Check size={12} /> : <Icon.Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="px-3 py-2 overflow-x-auto text-xs font-mono text-slate-100 whitespace-pre max-h-[480px] leading-relaxed">
        {code}
      </pre>
    </div>
  );
}

/* ========================================================================== */
/*  Workflow preview modal                                                     */
/*                                                                             */
/*  Opened when the user clicks a "Related workflows" pill on a form card.     */
/*  Shows the workflow's metadata (trigger, target form, action kinds) and     */
/*  its raw Deluge source — without navigating away from the Forms tab.        */
/* ========================================================================== */

function WorkflowPopup({ workflow, onClose, onOpenInTab }) {
  // Close on Esc + lock body scroll while the modal is open — keeps it
  // feeling like a native modal and prevents background chrome from
  // flickering behind the dialog.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (!workflow) return null;
  const lineCount = workflow.sourceCode
    ? workflow.sourceCode.split('\n').length
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-slate-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Workflow ${workflow.displayName || workflow.name}`}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Icon.Plan size={16} className="text-brand-600 dark:text-brand-400" />
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                {workflow.displayName || workflow.name}
              </h3>
              {workflow.event && (
                <span className="chip bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300 text-xs">
                  on {workflow.event}
                </span>
              )}
              {workflow.type && (
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {workflow.type}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
              {workflow.form && (
                <span>
                  target: <span className="font-mono">{workflow.form}</span>
                </span>
              )}
              {workflow.scope && <span>· scope: {workflow.scope}</span>}
              {workflow.actionKinds?.length > 0 && (
                <span>· actions: {workflow.actionKinds.join(', ')}</span>
              )}
              {lineCount > 0 && <span>· {lineCount} lines</span>}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {onOpenInTab && (
              <button
                type="button"
                onClick={onOpenInTab}
                className="px-2.5 py-1 text-xs font-medium rounded text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/30 transition"
                title="Open this workflow in the Workflows tab"
              >
                Open in tab
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-slate-700/60 transition"
              title="Close (Esc)"
              aria-label="Close"
            >
              <Icon.X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <WorkflowDescription workflow={workflow} />
          {workflow.sourceCode ? (
            <SourceBlock
              code={workflow.sourceCode}
              label={`Workflow · ${workflow.name}`}
            />
          ) : (
            <div className="text-sm text-slate-500 dark:text-slate-400 italic">
              Source not available — the parser could not preserve the raw
              <code className="mx-1">.ds</code> slice for this workflow.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/*  Permission Sets — shows which profile has what access per form / report /  */
/*  page. Source: data.profiles (ds.shareSettings), produced by                */
/*  parseShareSettings + parseModulePermissions in dsParser.js.                */
/*                                                                             */
/*  Per-profile data shape:                                                    */
/*    { name, type, description, permissions: {...global flags…},              */
/*      modulePermissions: [                                                   */
/*        { form, enabled: [...ops], allFieldsVisible,                         */
/*          reportPermissions: { <ReportName>: [ops...] } }                    */
/*      ] }                                                                    */
/*                                                                             */
/*  `modulePermissions[i].form` is an entity name that may refer to a Form,    */
/*  Report, or Page. We bucketize by cross-referencing the scope rosters so    */
/*  each profile clearly shows its Form, Report and Page-level access.         */
/* ========================================================================== */

function PermissionSetsSection({ profiles, forms, reports, pages }) {
  const [query, setQuery] = useState('');

  // Roster lookup sets — O(1) classification of a permission entry.
  const formSet = useMemo(() => new Set(forms.map((f) => f.name)), [forms]);
  const reportSet = useMemo(() => new Set(reports.map((r) => r.name)), [reports]);
  const pageSet = useMemo(() => new Set(pages.map((p) => p.name)), [pages]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) => {
      if (p.name?.toLowerCase().includes(q)) return true;
      if (p.type?.toLowerCase().includes(q)) return true;
      return (p.modulePermissions || []).some(
        (m) =>
          m.form?.toLowerCase().includes(q) ||
          Object.keys(m.reportPermissions || {}).some((r) => r.toLowerCase().includes(q))
      );
    });
  }, [profiles, query]);

  if (!profiles || profiles.length === 0) {
    return (
      <Empty text="No custom permission sets with form or report grants in this app." />
    );
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter profiles, forms, or reports…"
        className="w-full md:w-80 px-3 py-1.5 text-sm rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
      <div className="space-y-2">
        {filtered.map((profile) => (
          <PermissionSetCard
            key={profile.name}
            profile={profile}
            formSet={formSet}
            reportSet={reportSet}
            pageSet={pageSet}
          />
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">No matches.</p>
        )}
      </div>
    </div>
  );
}

function PermissionSetCard({ profile, formSet, reportSet, pageSet }) {
  const [open, setOpen] = useState(false);

  // Split the flat modulePermissions array into Form / Page buckets. Every
  // form keeps its nested reportPermissions attached so the table can render
  // per-report sub-rows directly under their owning form.
  const { formEntries, pageEntries, reportCount } = useMemo(() => {
    const f = [];
    const p = [];
    let rc = 0;
    for (const mp of profile.modulePermissions || []) {
      rc += Object.keys(mp.reportPermissions || {}).length;
      if (pageSet.has(mp.form)) {
        p.push(mp);
      } else if (formSet.has(mp.form)) {
        f.push(mp);
      } else {
        // Unknown name — default to the forms bucket (most .ds files declare
        // the permission target as a form name).
        f.push(mp);
      }
    }
    return { formEntries: f, pageEntries: p, reportCount: rc };
  }, [profile, formSet, pageSet]);

  const totalTargets = formEntries.length + pageEntries.length + reportCount;

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50/50 dark:bg-slate-800/30">
      <button
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
            <Icon.PmUser size={14} className="text-brand-600 dark:text-brand-400" />
            <span className="font-medium text-slate-900 dark:text-slate-100 group-hover:text-brand-700 dark:group-hover:text-brand-300">
              {profile.name}
            </span>
            {profile.type && (
              <span className="chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 text-xs">
                {profile.type}
              </span>
            )}
          </span>
          <span className="flex flex-wrap gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
            <span>{formEntries.length} form(s)</span>
            <span>· {reportCount} report ACL(s)</span>
            <span>· {pageEntries.length} page(s)</span>
            {totalTargets === 0 && <span>· no per-entity grants</span>}
          </span>
          {profile.description && (
            <span className="block text-xs text-slate-500 dark:text-slate-400 mt-1 whitespace-pre-line">
              {profile.description.trim()}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-4 space-y-4">
          {/* Global profile flags (Chat / ApiAccess / PIIAccess / …). */}
          {profile.permissions && Object.keys(profile.permissions).length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-2">
                Global flags
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(profile.permissions).map(([k, v]) => (
                  <FlagChip key={k} label={k} on={v === true || v === 'true'} />
                ))}
              </div>
            </div>
          )}

          <FormPermissionsTable
            entries={formEntries}
            reportSet={reportSet}
            emptyText="No form-level permissions granted."
          />

          <PagePermissionsTable
            entries={pageEntries}
            emptyText="No page-level permissions granted."
          />
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Form permissions table
 *
 *   One row per form, each with ✓/✗ columns for every supported operation.
 *   When a form exposes `reportPermissions`, sub-rows are rendered directly
 *   below it with their own View / Edit / Delete ✓/✗ grid so the mapping
 *   "which profile can do what to which entity" reads like a spreadsheet.
 *
 *   Column model follows the Creator `.ds` enum:
 *     Form-level :  Create · View All · Edit All · Import · Export · Tab · All Fields
 *     Report-lvl :  View · Edit · Delete
 * ------------------------------------------------------------------------ */

/** Canonical operation columns shown for every form row. The `key` values map
 *  to the strings the parser emits in `modulePermissions[i].enabled`. */
const FORM_OP_COLUMNS = [
  { key: 'Create', label: 'Create' },
  { key: 'Viewall', label: 'View All' },
  { key: 'Modifyall', label: 'Edit All' },
  { key: 'Import', label: 'Import' },
  { key: 'Export', label: 'Export' },
  { key: 'Tab', label: 'Tab' },
];

const REPORT_OP_COLUMNS = [
  { key: 'View', label: 'View' },
  { key: 'Edit', label: 'Edit' },
  { key: 'Delete', label: 'Delete' },
];

/** Case-insensitive "is this op enabled?" check — the `.ds` format uses
 *  `Viewall` / `Modifyall` but we want to be resilient to casing variants. */
function hasOp(ops, key) {
  if (!ops || ops.length === 0) return false;
  const k = key.toLowerCase();
  return ops.some((op) => String(op).toLowerCase() === k);
}

function FormPermissionsTable({ entries, reportSet, emptyText }) {
  if (!entries || entries.length === 0) {
    return (
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-2">
          Forms
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400">{emptyText}</p>
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-2">
        Forms
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <th className="py-1.5 pr-3 font-medium">Form</th>
              <th className="py-1.5 pr-3 font-medium">Related reports</th>
              {FORM_OP_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className="py-1.5 px-2 font-medium text-center whitespace-nowrap"
                >
                  {c.label}
                </th>
              ))}
              <th className="py-1.5 px-2 font-medium text-center whitespace-nowrap">
                All Fields
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((mp) => {
              const reports = Object.entries(mp.reportPermissions || {});
              return (
                <FormPermissionRow
                  key={mp.form}
                  mp={mp}
                  reports={reports}
                  reportSet={reportSet}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <PermissionLegend />
    </div>
  );
}

function FormPermissionRow({ mp, reports, reportSet }) {
  const [expanded, setExpanded] = useState(false);
  const hasReports = reports.length > 0;

  return (
    <>
      <tr className="text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800">
        <td className="py-2 pr-3 font-medium">{mp.form}</td>
        <td className="py-2 pr-3">
          {hasReports ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-300 hover:underline"
              aria-expanded={expanded}
              title={expanded ? 'Hide report ACLs' : 'Show report ACLs'}
            >
              <span
                className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}
                aria-hidden
              >
                ▸
              </span>
              {reports.length} report{reports.length === 1 ? '' : 's'}
            </button>
          ) : (
            <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
          )}
        </td>
        {FORM_OP_COLUMNS.map((c) => (
          <td key={c.key} className="py-2 px-2 text-center">
            <AccessMark on={hasOp(mp.enabled, c.key)} label={c.label} />
          </td>
        ))}
        <td className="py-2 px-2 text-center">
          <AccessMark on={Boolean(mp.allFieldsVisible)} label="All Fields" />
        </td>
      </tr>

      {hasReports && expanded && (
        <tr className="bg-slate-50/60 dark:bg-slate-800/30">
          <td
            colSpan={FORM_OP_COLUMNS.length + 3}
            className="py-2 pl-6 pr-3 border-b border-slate-100 dark:border-slate-800"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase text-slate-500 dark:text-slate-400">
                    <th className="py-1 pr-3 font-medium">Report</th>
                    {REPORT_OP_COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        className="py-1 px-2 font-medium text-center whitespace-nowrap"
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reports.map(([reportName, ops]) => (
                    <tr
                      key={reportName}
                      className="text-slate-700 dark:text-slate-200"
                    >
                      <td className="py-1.5 pr-3">
                        <span className="text-xs font-medium">{reportName}</span>
                        {!reportSet.has(reportName) && (
                          <span
                            className="ml-1.5 text-[10px] text-amber-600 dark:text-amber-400"
                            title="Report name not found in the parsed report list."
                          >
                            (unresolved)
                          </span>
                        )}
                      </td>
                      {REPORT_OP_COLUMNS.map((c) => (
                        <td key={c.key} className="py-1.5 px-2 text-center">
                          <AccessMark on={hasOp(ops, c.key)} label={c.label} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* --------------------------------------------------------------------------
 * Page permissions table — pages only support the `Tab` grant in `.ds`, so
 * we render a single boolean column plus any extra enabled values we see.
 * ------------------------------------------------------------------------ */
function PagePermissionsTable({ entries, emptyText }) {
  if (!entries || entries.length === 0) {
    return (
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-2">
          Pages
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400">{emptyText}</p>
      </div>
    );
  }
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-2">
        Pages
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <th className="py-1.5 pr-3 font-medium">Page</th>
              <th className="py-1.5 px-2 font-medium text-center whitespace-nowrap">
                Tab
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {entries.map((mp) => (
              <tr key={mp.form} className="text-slate-700 dark:text-slate-200">
                <td className="py-1.5 pr-3 font-medium">{mp.form}</td>
                <td className="py-1.5 px-2 text-center">
                  <AccessMark on={hasOp(mp.enabled, 'Tab')} label="Tab" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Boolean access indicator — green tick when granted, grey cross when not.
 *  Used everywhere we need to show a single ✓/✗ for a permission column. */
function AccessMark({ on, label }) {
  if (on) {
    return (
      <span
        className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300"
        title={label ? `${label}: granted` : 'Granted'}
        aria-label={label ? `${label}: granted` : 'Granted'}
      >
        <Icon.Check size={12} />
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
      title={label ? `${label}: not granted` : 'Not granted'}
      aria-label={label ? `${label}: not granted` : 'Not granted'}
    >
      <Icon.X size={12} />
    </span>
  );
}

function PermissionLegend() {
  return (
    <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-500 dark:text-slate-400">
      <span className="inline-flex items-center gap-1">
        <AccessMark on={true} /> granted
      </span>
      <span className="inline-flex items-center gap-1">
        <AccessMark on={false} /> not granted
      </span>
      <span className="italic">
        Tip: expand "Related reports" on a row to see per-report View / Edit / Delete ACLs.
      </span>
    </div>
  );
}

/** Boolean flag pill used for the profile's global permissions map. */
function FlagChip({ label, on }) {
  const cls = on
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
    : 'bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border ${cls}`}
      title={`${label}: ${on ? 'on' : 'off'}`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          on ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-500'
        }`}
        aria-hidden
      />
      {label}
    </span>
  );
}

/* ========================================================================== */
/*  Primitive UI helpers                                                       */
/* ========================================================================== */
/* Note: the previous `Stat` and `Panel` helpers were removed along with the
 * Technical Scope header card. Re-introduce them if that summary card is
 * ever brought back. */

function Empty({ text }) {
  return (
    <div className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{text}</div>
  );
}

function SimpleTable({ columns, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
            {columns.map((c) => (
              <th key={c} className="py-2 pr-3 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r, i) => (
            <tr key={i} className="text-slate-700 dark:text-slate-200">
              {r.map((c, j) => (
                <td key={j} className="py-2 pr-3">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ========================================================================== */
/*  Back-compat: if backend didn't yet include technicalScope, synthesize it. */
/* ========================================================================== */

function fallbackScope(data) {
  return {
    forms: (data.forms || []).map((f) => ({ ...f, workflows: [] })),
    reports: data.reports || [],
    pages: data.pages || [],
    workflows: data.workflows || [],
  };
}
