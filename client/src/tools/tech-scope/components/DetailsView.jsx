import { useMemo } from 'react';
import Icon from '../../../components/Icons.jsx';

/**
 * DetailsView — structured, scannable rendering of every scope section for
 * steps 1, 3, 4, and 5. Replaces the legacy raw-markdown `<pre>` preview.
 *
 * Step 1 — Application Flow — is the **base structure** of the requirement:
 * Master Forms (reference / lookup data that other forms depend on), then
 * Reports, Pages, and Workflows. Transactional Forms are intentionally NOT
 * rendered here — they live in Step 2 (Data Model) where the lookup
 * relationships between masters and transactional forms become the focus.
 *
 * Step 2 (Data Model) has its own dedicated `FormsView` and is NOT rendered
 * here — `StepView` routes step 2 to that component instead.
 *
 * All sections render an empty-state hint when their underlying scope array
 * is empty, so the user always sees what they can fill in next.
 */

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Master / Transactional form classification                                 */
/* ─────────────────────────────────────────────────────────────────────────── */

const LOOKUP_TYPES = new Set([
  'Single Select Lookup', 'Multi-Select Lookup', 'Subform',
]);

function isLookupField(f) {
  return f.lookup || LOOKUP_TYPES.has(f.type);
}

function lookupTarget(f) {
  if (typeof f.lookup === 'string') return f.lookup.split('.')[0] || '';
  if (f.lookup && typeof f.lookup === 'object') {
    return f.lookup.form || f.lookup.target || f.lookup.formName || '';
  }
  return '';
}

/**
 * Separate forms into master (base structure) and transactional (depends on
 * a master via Lookup).
 *
 * A form is a **Master** if ANY of these hold:
 *   1. It is referenced as a Lookup target by another form (inbound deps).
 *   2. Its name/displayName matches a known master suffix (`*_Master`,
 *      `*_Type`, `*_Category`, `*_Status`, `*_Lookup`, `*_Reference`).
 *   3. It has no outbound Lookup fields (a flat, self-contained data form
 *      that can be built standalone — by definition part of the base layer).
 *
 * Otherwise it is **Transactional** — it consumes master data via Lookups.
 *
 * Edge case: when the user has only just started authoring forms (e.g. a
 * single Employee form pointing at a not-yet-created Department_Master), the
 * three rules above leave the masters bucket empty. That defeats the whole
 * point of Step 1 ("show me the base structure"). In that case we treat the
 * authored set as the working baseline and surface every form as a master
 * so the user can always see what they have. They will get re-classified
 * automatically once lookup-target forms are added.
 */
function classifyForms(forms) {
  if (!Array.isArray(forms) || forms.length === 0) {
    return { masters: [], transactional: [] };
  }

  // 1. Build the set of form names that are pointed at by some Lookup field
  //    elsewhere in the scope. Case-insensitive on form name only.
  const referenced = new Set();
  for (const f of forms) {
    for (const fld of f.fields || []) {
      if (!isLookupField(fld)) continue;
      const t = lookupTarget(fld);
      if (t) referenced.add(t.toLowerCase());
    }
  }

  const MASTER_SUFFIX_RE =
    /(_master|_type|_category|_status|_lookup|_reference)$/i;

  const masters = [];
  const transactional = [];

  for (const f of forms) {
    const nameLower = (f.name || '').toLowerCase();
    const isReferenced = referenced.has(nameLower);
    const hasMasterSuffix =
      MASTER_SUFFIX_RE.test(f.name || '') ||
      MASTER_SUFFIX_RE.test(f.displayName || '');
    const hasOutboundLookups = (f.fields || []).some(isLookupField);

    if (isReferenced || hasMasterSuffix || !hasOutboundLookups) {
      masters.push(f);
    } else {
      transactional.push(f);
    }
  }

  // Safety net — if classification produced zero masters, treat ALL forms
  // as masters. The user is mid-authoring; we still need to show the base
  // structure rather than a blank section.
  if (masters.length === 0) {
    return { masters: forms.slice(), transactional: [] };
  }

  return { masters, transactional };
}

/* ---------------------------------- atoms ---------------------------------- */

function SectionHeader({ icon, title, count, hint }) {
  const Cmp = icon || Icon.FileDoc;
  return (
    <header className="flex items-center justify-between mb-2 flex-wrap gap-2">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
        <Cmp size={14} />
        {title}
        {typeof count === 'number' && (
          <span className="chip text-[10px] bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {count}
          </span>
        )}
      </h3>
      {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </header>
  );
}

function Empty({ children }) {
  return (
    <p className="text-xs italic text-slate-500 dark:text-slate-400 px-3 py-2 rounded border border-dashed border-slate-200 dark:border-slate-800">
      {children}
    </p>
  );
}

function Chip({ tone = 'slate', children, mono }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    sky: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  };
  return (
    <span className={`chip text-[10px] ${tones[tone] || tones.slate} ${mono ? 'font-mono' : ''}`}>
      {children}
    </span>
  );
}

function KeyVal({ k, v }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <div className="text-[11px] flex gap-2">
      <span className="text-slate-500 dark:text-slate-400 min-w-[110px]">{k}</span>
      <span className="text-slate-800 dark:text-slate-200 font-mono break-all">{v}</span>
    </div>
  );
}

function Card({ children }) {
  return (
    <article className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-3 space-y-1.5">
      {children}
    </article>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Form card atoms (shared between Master and Transactional sections)         */
/* ─────────────────────────────────────────────────────────────────────────── */

function FieldTypeChip({ type }) {
  const isLookup = LOOKUP_TYPES.has(type);
  return (
    <span className={`chip text-[10px] ${
      isLookup
        ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
    }`}>
      {type || '—'}
    </span>
  );
}

function FormFieldTable({ fields }) {
  if (!fields || fields.length === 0) {
    return <p className="text-[11px] italic text-slate-500 mt-1">No fields captured yet.</p>;
  }
  return (
    <table className="w-full text-xs mt-2">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          <th className="pb-1 pr-3 font-medium">Field</th>
          <th className="pb-1 pr-3 font-medium">Type</th>
          <th className="pb-1 pr-3 font-medium">Req</th>
          <th className="pb-1 font-medium">Lookup / Notes</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((fld) => {
          const target = isLookupField(fld) ? lookupTarget(fld) : null;
          return (
            <tr key={fld.name || fld.displayName}
                className="border-t border-slate-100 dark:border-slate-800 align-top">
              <td className="py-1 pr-3">
                <span className="text-slate-900 dark:text-slate-100">
                  {fld.displayName || fld.name}
                </span>
                {fld.displayName && fld.name && fld.displayName !== fld.name && (
                  <div className="text-[10px] font-mono text-slate-400">{fld.name}</div>
                )}
              </td>
              <td className="py-1 pr-3"><FieldTypeChip type={fld.type} /></td>
              <td className="py-1 pr-3">
                {fld.required
                  ? <span className="text-[10px] font-semibold text-rose-600 dark:text-rose-400">●</span>
                  : <span className="text-[10px] text-slate-300 dark:text-slate-600">○</span>}
              </td>
              <td className="py-1 text-[11px] text-slate-600 dark:text-slate-400">
                {target && (
                  <span className="chip bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 text-[10px]">
                    → {target}
                  </span>
                )}
                {fld.unique && <span className="chip bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 text-[10px] ml-1">Unique</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FormWorkflowsInline({ formName, workflows, blueprints = [] }) {
  const wfs = (workflows || []).filter(
    (w) => w.form === formName || w.form === formName.toLowerCase()
  );
  const bps = (blueprints || []).filter(
    (b) => b.form === formName || b.form === formName.toLowerCase()
  );
  if (wfs.length === 0 && bps.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
      <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">
        Automation
      </p>
      <div className="space-y-1">
        {wfs.map((w) => (
          <div key={w.name} className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <Chip tone="violet">{w.displayName || w.name}</Chip>
            <span className="text-slate-500">workflow</span>
            <Chip tone="emerald">{w.event || 'on add'}</Chip>
            {(w.actionKinds || []).map((a, i) => <Chip key={i}>{a}</Chip>)}
            {w.description && (
              <span className="text-slate-500 italic">— {w.description}</span>
            )}
          </div>
        ))}
        {bps.map((b) => (
          <div key={b.name} className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <Chip tone="indigo">{b.displayName || b.name}</Chip>
            <span className="text-slate-500">blueprint</span>
            {(b.stages || []).length > 0 && (
              <span className="text-slate-500">
                {b.stages.length} stages:&nbsp;
                {b.stages.map((s) => s.displayName || s.name).join(' → ')}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FormReportsInline({ formName, reports }) {
  const rs = (reports || []).filter((r) => r.baseForm === formName);
  if (rs.length === 0) return null;
  return (
    <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
      <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">
        Reports
      </p>
      <div className="flex flex-wrap gap-1.5">
        {rs.map((r) => (
          <span key={r.name} className="chip text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            {r.displayName || r.name}
            <span className="ml-1 opacity-60">{r.type}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * A single rich form card: fields + associated reports + associated workflows.
 */
function FormDetailCard({ form, index, tone = 'slate', badge, reports, workflows, blueprints }) {
  const fields = form.fields || [];
  const mandatoryCount = fields.filter((f) => f.required).length;
  const lookupCount = fields.filter(isLookupField).length;

  const headerTones = {
    slate:   'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800',
    indigo:  'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800/40',
    sky:     'bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-800/40',
  };
  const borderTones = {
    slate:  'border-slate-200 dark:border-slate-800',
    indigo: 'border-indigo-200 dark:border-indigo-800/40',
    sky:    'border-sky-200 dark:border-sky-800/40',
  };

  return (
    <article className={`rounded-lg border ${borderTones[tone] || borderTones.slate} bg-white dark:bg-slate-900/40`}>
      {/* ── Header ── */}
      <header className={`flex flex-wrap items-center gap-2 px-4 py-2.5 border-b ${headerTones[tone] || headerTones.slate}`}>
        <span className="chip text-[10px] font-mono bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          #{String(index + 1).padStart(2, '0')}
        </span>
        {badge && (
          <span className={`chip text-[10px] ${
            tone === 'indigo'
              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
              : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
          }`}>
            {badge}
          </span>
        )}
        <h4 className="font-semibold text-slate-900 dark:text-slate-100">
          {form.displayName || form.name}
        </h4>
        {form.displayName && form.name && form.displayName !== form.name && (
          <span className="text-[11px] text-slate-500 font-mono">({form.name})</span>
        )}
        <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
          {fields.length > 0 && <span>{fields.length} fields</span>}
          {mandatoryCount > 0 && <span>{mandatoryCount} mandatory</span>}
          {lookupCount > 0 && <span>{lookupCount} lookups</span>}
        </div>
      </header>

      {/* ── Body ── */}
      <div className="px-4 pb-4 pt-2">
        {form.purpose && (
          <p className="text-xs italic text-slate-600 dark:text-slate-400 mb-2">{form.purpose}</p>
        )}

        {/* Action events */}
        {(form.actionEvents || []).length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            <span className="text-[10px] text-slate-500">Triggers:</span>
            {(form.actionEvents || ['on add', 'on edit']).map((e) => (
              <Chip key={e} tone="slate">{e}</Chip>
            ))}
          </div>
        )}

        {/* Fields table */}
        <FormFieldTable fields={fields} />

        {/* Inline reports */}
        <FormReportsInline formName={form.name} reports={reports} />

        {/* Inline workflows & blueprints */}
        <FormWorkflowsInline formName={form.name} workflows={workflows} blueprints={blueprints} />
      </div>
    </article>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/*  Step 1 — Application Flow                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Application Flow — Master Forms · Reports · Pages · Workflows
 *
 * Step 1 is exclusively the **base structure** of the application: the master
 * (reference / lookup) forms every other form depends on, plus the surrounding
 * reports, pages, and global workflows. Transactional forms — those that
 * consume master data via Lookups — are intentionally deferred to Step 2
 * (Data Model) where the relationships matter.
 *
 * Each Master Form card shows the full field list, any reports built on it,
 * and any workflows/blueprints wired to it.
 */
function Step1Details({ scope }) {
  const {
    forms = [],
    reports = [],
    pages = [],
    workflows = [],
    blueprints = [],
  } = scope;

  const { masters } = useMemo(() => classifyForms(forms), [forms]);

  // Orphan workflows — not tied to any known form name
  const formNames = new Set(forms.map((f) => f.name.toLowerCase()));
  const orphanWorkflows = workflows.filter(
    (w) => !w.form || !formNames.has(w.form.toLowerCase())
  );

  // Group pages by section
  const pagesBySection = pages.reduce((acc, p) => {
    const k = p.section || 'Default';
    (acc[k] ||= []).push(p);
    return acc;
  }, {});

  // Reports not tied to a known form (standalone / cross-form)
  const orphanReports = reports.filter(
    (r) => !r.baseForm || !formNames.has(r.baseForm.toLowerCase())
  );

  return (
    <div className="space-y-8">

      {/* ══════════════════════ MASTER FORMS ══════════════════════ */}
      <section>
        <header className="flex items-center gap-3 mb-1">
          <div className="flex-1 border-t border-indigo-200 dark:border-indigo-800/50" />
          <h2 className="text-sm font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-widest whitespace-nowrap px-1">
            Master Forms
          </h2>
          <div className="flex-1 border-t border-indigo-200 dark:border-indigo-800/50" />
        </header>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 text-center">
          The base structure of your application. Build these first — every
          dropdown / selection in transactional forms (Step 2) points here.
        </p>

        {masters.length === 0 ? (
          <Empty>
            No forms in the scope yet. Use the prompt box to declare your first
            form — e.g. <span className="font-mono">create form Department_Master with fields Name, Code</span>.
          </Empty>
        ) : (
          <div className="space-y-4">
            {masters.map((f, i) => (
              <FormDetailCard
                key={f.name}
                form={f}
                index={i}
                tone="indigo"
                badge="Master"
                reports={reports}
                workflows={workflows}
                blueprints={blueprints}
              />
            ))}
          </div>
        )}
      </section>

      {/* ══════════════════════ REPORTS ══════════════════════════ */}
      {orphanReports.length > 0 && (
        <section>
          <SectionHeader
            icon={Icon.Analyse}
            title="Standalone Reports"
            count={orphanReports.length}
            hint="not tied to a single form"
          />
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 px-3 font-medium">Report</th>
                  <th className="py-1.5 px-3 font-medium">Type</th>
                  <th className="py-1.5 px-3 font-medium">Base Form</th>
                  <th className="py-1.5 px-3 font-medium">Custom Actions</th>
                </tr>
              </thead>
              <tbody>
                {orphanReports.map((r) => (
                  <tr key={r.name} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 px-3 font-mono text-slate-700 dark:text-slate-300">
                      {r.displayName || r.name}
                    </td>
                    <td className="py-1.5 px-3"><Chip tone="indigo">{r.type || 'list'}</Chip></td>
                    <td className="py-1.5 px-3 font-mono text-slate-500">{r.baseForm || '—'}</td>
                    <td className="py-1.5 px-3 text-[11px]">
                      {(r.customActions || []).length === 0
                        ? <span className="text-slate-500">—</span>
                        : (r.customActions || []).map((a, i) => <Chip key={i} tone="sky">{a}</Chip>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ══════════════════════ PAGES ════════════════════════════ */}
      {pages.length > 0 && (
        <section>
          <SectionHeader icon={Icon.FileCode} title="Pages" count={pages.length} hint="HTML / widget composites" />
          <div className="space-y-3">
            {Object.keys(pagesBySection).sort().map((sec) => (
              <div key={sec} className="rounded-lg border border-slate-200 dark:border-slate-800">
                <header className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wide text-slate-600 dark:text-slate-400 font-semibold">
                  Section · {sec}
                </header>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {pagesBySection[sec].map((p) => (
                    <li key={p.name} className="px-3 py-2 text-xs flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {p.displayName || p.name}
                      </span>
                      <Chip mono>{p.name}</Chip>
                      {(p.embeddedForms || []).map((x) => (
                        <Chip key={`f-${x}`} tone="emerald">Form: {x}</Chip>
                      ))}
                      {(p.embeddedReports || []).map((x) => (
                        <Chip key={`r-${x}`} tone="sky">Report: {x}</Chip>
                      ))}
                      {p.hasScript && <Chip tone="violet">has script</Chip>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ══════════════════ ORPHAN WORKFLOWS ═════════════════════ */}
      {orphanWorkflows.length > 0 && (
        <section>
          <SectionHeader
            icon={Icon.Plan}
            title="Global Workflows"
            count={orphanWorkflows.length}
            hint="not tied to a specific form"
          />
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 px-3 font-medium">Workflow</th>
                  <th className="py-1.5 px-3 font-medium">Scope</th>
                  <th className="py-1.5 px-3 font-medium">Event</th>
                  <th className="py-1.5 px-3 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {orphanWorkflows.map((w) => (
                  <tr key={w.name} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 px-3 font-medium text-slate-900 dark:text-slate-100">
                      {w.displayName || w.name}
                    </td>
                    <td className="py-1.5 px-3"><Chip tone="indigo">{w.scope || 'form'}</Chip></td>
                    <td className="py-1.5 px-3"><Chip tone="emerald">{w.event || '—'}</Chip></td>
                    <td className="py-1.5 px-3 italic text-slate-600 dark:text-slate-400 text-[11px]">
                      {w.description || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <NotesBlock scope={scope} stepId="step1" />
    </div>
  );
}

/* --------------------------------- Step 3 --------------------------------- */
/** Roles & Profiles — Org Hierarchy · Permission Profiles · Page Access */
function Step3Details({ scope }) {
  const { roles = [], profiles = [], pages = [] } = scope;

  return (
    <div className="space-y-6">
      <section>
        <SectionHeader icon={Icon.PmUser} title="Roles" count={roles.length} hint="org hierarchy" />
        {roles.length === 0 ? (
          <Empty>No roles defined yet.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 px-3 font-medium">Role</th>
                  <th className="py-1.5 px-3 font-medium">Reports To</th>
                  <th className="py-1.5 px-3 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.name} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 px-3 font-medium text-slate-900 dark:text-slate-100">{r.name}</td>
                    <td className="py-1.5 px-3 text-slate-600 dark:text-slate-400">{r.parent || '—'}</td>
                    <td className="py-1.5 px-3 text-slate-600 dark:text-slate-400 italic">{r.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <SectionHeader icon={Icon.Save} title="Permission Profiles" count={profiles.length} />
        {profiles.length === 0 ? (
          <Empty>No profiles defined yet.</Empty>
        ) : (
          <div className="space-y-3">
            {profiles.map((p) => (
              <Card key={p.name}>
                <header className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold text-slate-900 dark:text-slate-100">{p.name}</h4>
                  {p.type && <Chip tone="indigo">type: {p.type}</Chip>}
                </header>
                {p.description && (
                  <p className="text-[11px] italic text-slate-500">{p.description}</p>
                )}
                {(p.modulePermissions || []).length === 0 ? (
                  <p className="text-[11px] text-slate-500">No module permissions set.</p>
                ) : (
                  <div className="overflow-x-auto rounded border border-slate-100 dark:border-slate-800">
                    <table className="w-full text-[11px]">
                      <thead className="bg-slate-50 dark:bg-slate-900/60">
                        <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                          <th className="py-1 px-2 font-medium">Form</th>
                          <th className="py-1 px-2 font-medium">Permissions</th>
                          <th className="py-1 px-2 font-medium">All Fields</th>
                          <th className="py-1 px-2 font-medium">Report Access</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.modulePermissions.map((m, i) => (
                          <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="py-1 px-2 font-mono">{m.form}</td>
                            <td className="py-1 px-2">
                              {(m.enabled || []).map((x, k) => <Chip key={k} tone="emerald">{x}</Chip>)}
                            </td>
                            <td className="py-1 px-2">{m.allFieldsVisible ? '✓' : ''}</td>
                            <td className="py-1 px-2 text-slate-600 dark:text-slate-400">
                              {(m.reportPermissions || []).length === 0
                                ? '—'
                                : m.reportPermissions.map((rp, k) => (
                                    <span key={k} className="font-mono mr-2">
                                      {rp.report}: {(rp.actions || []).join('/')}
                                    </span>
                                  ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader icon={Icon.FileCode} title="Page Access" count={pages.length} />
        {pages.length === 0 ? (
          <Empty>No pages declared (see Step 1).</Empty>
        ) : (
          <ul className="space-y-1 text-xs">
            {pages.map((pg) => {
              const inherits = [...(pg.embeddedForms || []), ...(pg.embeddedReports || [])];
              return (
                <li key={pg.name} className="px-3 py-1.5 rounded border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/30 flex flex-wrap items-center gap-2">
                  <Chip mono>{pg.name}</Chip>
                  <span className="text-slate-600 dark:text-slate-400">section: {pg.section || 'Default'}</span>
                  <span className="ml-auto text-[11px] text-slate-500">
                    {inherits.length === 0
                      ? 'open to all profiles'
                      : <>inherits from: {inherits.map((x, i) => <Chip key={i} mono>{x}</Chip>)}</>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <NotesBlock scope={scope} stepId="step3" />
    </div>
  );
}

/* --------------------------------- Step 4 --------------------------------- */
/** Functions, Connections, Blueprints, Batch Workflows, Schedules, APIs */
function Step4Details({ scope }) {
  const {
    customFunctions = [],
    connections = [],
    schedules = [],
    publicAPIs = [],
    blueprints = [],
    batchWorkflows = [],
  } = scope;

  return (
    <div className="space-y-6">
      {/* Blueprints */}
      <section>
        <SectionHeader icon={Icon.Plan} title="Blueprints" count={blueprints.length} hint="state-machine workflows" />
        {blueprints.length === 0 ? (
          <Empty>No blueprints defined yet.</Empty>
        ) : (
          <div className="space-y-3">
            {blueprints.map((bp) => (
              <Card key={bp.name}>
                <header className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold text-slate-900 dark:text-slate-100">{bp.displayName || bp.name}</h4>
                  <Chip mono>{bp.name}</Chip>
                  {bp.form && <Chip tone="indigo">form: {bp.form}</Chip>}
                  <Chip tone="emerald">run: {bp.runWhen || 'always'}</Chip>
                </header>
                {bp.description && <p className="text-[11px] italic text-slate-500">{bp.description}</p>}
                {bp.criteria && <KeyVal k="Criteria" v={bp.criteria} />}

                {(bp.stages || []).length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-2">Stages</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {bp.stages.map((st) => (
                        <Chip
                          key={st.name}
                          tone={st.isInitial ? 'emerald' : st.isTerminal ? 'rose' : 'slate'}
                        >
                          {st.isInitial ? '▶ ' : st.isTerminal ? '■ ' : ''}
                          {st.displayName || st.name}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}

                {(bp.transitions || []).length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-2">Transitions</p>
                    <ul className="mt-1 space-y-1 text-[11px]">
                      {bp.transitions.map((tr, i) => (
                        <li key={i} className="font-mono text-slate-700 dark:text-slate-300">
                          <strong className="text-slate-900 dark:text-slate-100">{tr.name}</strong>
                          {' · '}
                          <span className="text-slate-500">{tr.from}</span>
                          {' → '}
                          <span className="text-slate-500">{tr.to}</span>
                          {tr.beforeWorkflow && <Chip tone="amber">before script</Chip>}
                          {tr.afterWorkflow && <Chip tone="violet">after script</Chip>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Batch Workflows */}
      <section>
        <SectionHeader icon={Icon.Code} title="Batch Workflows" count={batchWorkflows.length} hint="bulk record processors" />
        {batchWorkflows.length === 0 ? (
          <Empty>No batch workflows defined yet.</Empty>
        ) : (
          <div className="space-y-2">
            {batchWorkflows.map((bw) => (
              <Card key={bw.name}>
                <header className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold text-slate-900 dark:text-slate-100">{bw.displayName || bw.name}</h4>
                  <Chip mono>{bw.name}</Chip>
                  {bw.form && <Chip tone="indigo">form: {bw.form}</Chip>}
                  <Chip tone="emerald">{bw.frequency || 'on_demand'}</Chip>
                  {bw.scheduleName && <Chip tone="sky">schedule: {bw.scheduleName}</Chip>}
                </header>
                {bw.description && <p className="text-[11px] italic text-slate-500">{bw.description}</p>}
                <KeyVal k="Criteria" v={bw.criteria || 'process all records'} />
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Custom Functions */}
      <section>
        <SectionHeader icon={Icon.DevCode} title="Custom Functions" count={customFunctions.length} hint="Deluge" />
        {customFunctions.length === 0 ? (
          <Empty>No custom functions defined yet.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 px-3 font-medium">Function</th>
                  <th className="py-1.5 px-3 font-medium">Namespace</th>
                  <th className="py-1.5 px-3 font-medium">Returns</th>
                  <th className="py-1.5 px-3 font-medium">Params</th>
                  <th className="py-1.5 px-3 font-medium">Purpose</th>
                </tr>
              </thead>
              <tbody>
                {customFunctions.map((fn) => (
                  <tr key={fn.name} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 px-3 font-mono text-slate-700 dark:text-slate-300">{fn.name}</td>
                    <td className="py-1.5 px-3 text-slate-600 dark:text-slate-400">{fn.namespace || '—'}</td>
                    <td className="py-1.5 px-3"><Chip tone="indigo">{fn.returnType || 'void'}</Chip></td>
                    <td className="py-1.5 px-3 text-[11px] font-mono text-slate-600 dark:text-slate-400">
                      {(fn.params || []).map((p) => `${p.name}:${p.type || 'string'}`).join(', ') || '—'}
                    </td>
                    <td className="py-1.5 px-3 italic text-slate-600 dark:text-slate-400">{fn.purpose || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Connections */}
      <section>
        <SectionHeader icon={Icon.Folder} title="Connections" count={connections.length} hint="third-party services" />
        {connections.length === 0 ? (
          <Empty>No connections defined yet.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 px-3 font-medium">Service</th>
                  <th className="py-1.5 px-3 font-medium">Auth Type</th>
                  <th className="py-1.5 px-3 font-medium">Purpose</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((c, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 px-3 font-medium text-slate-900 dark:text-slate-100">{c.service}</td>
                    <td className="py-1.5 px-3"><Chip tone="amber">{c.authType || 'oauth2'}</Chip></td>
                    <td className="py-1.5 px-3 italic text-slate-600 dark:text-slate-400">{c.purpose || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Schedules */}
      <section>
        <SectionHeader icon={Icon.Plan} title="Schedules" count={schedules.length} hint="time-based triggers" />
        {schedules.length === 0 ? (
          <Empty>No schedules defined yet.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 px-3 font-medium">Name</th>
                  <th className="py-1.5 px-3 font-medium">Frequency</th>
                  <th className="py-1.5 px-3 font-medium">Cron</th>
                  <th className="py-1.5 px-3 font-medium">Calls</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.name} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 px-3 font-mono text-slate-700 dark:text-slate-300">{s.name}</td>
                    <td className="py-1.5 px-3"><Chip tone="emerald">{s.frequency || '—'}</Chip></td>
                    <td className="py-1.5 px-3 font-mono text-slate-600 dark:text-slate-400">{s.cron || '—'}</td>
                    <td className="py-1.5 px-3 font-mono text-slate-600 dark:text-slate-400">{s.calls || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Public APIs */}
      <section>
        <SectionHeader icon={Icon.Code} title="Public REST APIs" count={publicAPIs.length} />
        {publicAPIs.length === 0 ? (
          <Empty>No public APIs exposed.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/60">
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 px-3 font-medium">Method</th>
                  <th className="py-1.5 px-3 font-medium">Path</th>
                  <th className="py-1.5 px-3 font-medium">Base Form</th>
                  <th className="py-1.5 px-3 font-medium">Auth</th>
                  <th className="py-1.5 px-3 font-medium">Purpose</th>
                </tr>
              </thead>
              <tbody>
                {publicAPIs.map((a, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 px-3"><Chip tone="indigo" mono>{a.method}</Chip></td>
                    <td className="py-1.5 px-3 font-mono text-slate-700 dark:text-slate-300">{a.path}</td>
                    <td className="py-1.5 px-3 font-mono text-slate-600 dark:text-slate-400">{a.baseForm || '—'}</td>
                    <td className="py-1.5 px-3"><Chip tone="amber">{a.auth || 'apikey'}</Chip></td>
                    <td className="py-1.5 px-3 italic text-slate-600 dark:text-slate-400">{a.purpose || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <NotesBlock scope={scope} stepId="step4" />
    </div>
  );
}

/* --------------------------------- Step 5 --------------------------------- */
/** NFRs · Assumptions · Out-of-Scope */
function Step5Details({ scope }) {
  const { application = {}, nfrs = [], assumptions = [], outOfScope = [] } = scope;

  // Group NFRs by category for scannability.
  const byCat = nfrs.reduce((acc, n) => {
    const k = n.category || 'General';
    (acc[k] ||= []).push(n);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <section>
        <SectionHeader icon={Icon.Plan} title="Creator Platform Assumptions" />
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 grid sm:grid-cols-2 gap-x-6 gap-y-1">
          <KeyVal k="Edition" v={application.edition || 'professional'} />
          <KeyVal k="Date format" v={application.dateFormat || 'dd-MMM-yyyy'} />
          <KeyVal k="Time zone" v={application.timeZone || 'Asia/Kolkata'} />
          <KeyVal k="Time format" v={application.timeFormat || '24-hr'} />
        </div>
        <p className="text-[11px] text-slate-500 mt-2">
          Default storage / compute governance limits per Creator edition apply.
          Built-in audit trail, role-based access, and field-level permissions used as-is.
        </p>
      </section>

      <section>
        <SectionHeader icon={Icon.Analyse} title="Non-Functional Requirements" count={nfrs.length} />
        {nfrs.length === 0 ? (
          <Empty>No NFRs captured yet.</Empty>
        ) : (
          <div className="space-y-2">
            {Object.keys(byCat).sort().map((cat) => (
              <div key={cat} className="rounded-lg border border-slate-200 dark:border-slate-800">
                <header className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wide text-slate-600 dark:text-slate-400 font-semibold">
                  {cat}
                </header>
                <ul className="px-3 py-2 text-xs space-y-1">
                  {byCat[cat].map((n, i) => (
                    <li key={i} className="text-slate-700 dark:text-slate-300">• {n.statement}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader icon={Icon.Check} title="Assumptions" count={assumptions.length} />
        {assumptions.length === 0 ? (
          <Empty>No assumptions captured yet.</Empty>
        ) : (
          <ul className="text-xs space-y-1">
            {assumptions.map((a, i) => (
              <li
                key={i}
                className="px-3 py-1.5 rounded border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/30 text-slate-700 dark:text-slate-300"
              >
                {a}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader icon={Icon.X} title="Out of Scope" count={outOfScope.length} />
        {outOfScope.length === 0 ? (
          <Empty>Nothing explicitly out of scope.</Empty>
        ) : (
          <ul className="text-xs space-y-1">
            {outOfScope.map((o, i) => (
              <li
                key={i}
                className="px-3 py-1.5 rounded border border-rose-100 dark:border-rose-900/40 bg-rose-50/60 dark:bg-rose-900/10 text-rose-800 dark:text-rose-300"
              >
                {o}
              </li>
            ))}
          </ul>
        )}
      </section>

      <NotesBlock scope={scope} stepId="step5" />
    </div>
  );
}

/* --------------------------------- Notes --------------------------------- */
function NotesBlock({ scope, stepId }) {
  const notes = scope?.notes?.[stepId] || [];
  if (notes.length === 0) return null;
  return (
    <section>
      <SectionHeader icon={Icon.Edit} title="Notes" count={notes.length} />
      <ul className="text-xs space-y-1">
        {notes.map((n, i) => (
          <li
            key={i}
            className="px-3 py-1.5 rounded border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/30 text-slate-700 dark:text-slate-300"
          >
            {n}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------------------------- root ---------------------------------- */

export default function DetailsView({ stepId, scope }) {
  switch (stepId) {
    case 'step1':
      return <Step1Details scope={scope} />;
    case 'step3':
      return <Step3Details scope={scope} />;
    case 'step4':
      return <Step4Details scope={scope} />;
    case 'step5':
      return <Step5Details scope={scope} />;
    default:
      return null;
  }
}
