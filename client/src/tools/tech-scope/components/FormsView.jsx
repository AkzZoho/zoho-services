import { useMemo } from 'react';
import Icon from '../../../components/Icons.jsx';

/**
 * FormsView — replaces the raw markdown preview on Step 2 with a structured,
 * scannable specification of every form in the scope.
 *
 * Surfaces, per form:
 *   • Form name + purpose
 *   • Each field with: Display Name · Type · Mandatory? · Lookup target & cardinality
 *
 * Also derives:
 *   • A recommended "creation order" — lookup/master forms first, then forms
 *     that depend on them, computed via a topological sort on Lookup edges.
 *   • A separate "Lookup Forms" panel listing the dropdowns that must be
 *     implemented as standalone master forms (so values can be added later
 *     without code changes).
 *   • A worked sample showing the canonical pattern.
 */

/* ---------------------------------- helpers ---------------------------------- */

const LOOKUP_TYPES = new Set([
  'Single Select Lookup',
  'Multi-Select Lookup',
  'Subform',
]);

const DROPDOWNISH_TYPES = new Set([
  'Dropdown',
  'Radio',
  'Multi-Select',
  'CheckBox',
]);

function isLookup(field) {
  if (!field) return false;
  if (field.lookup) return true;
  return LOOKUP_TYPES.has(field.type);
}

function lookupCardinality(field) {
  const t = String(field.type || '');
  if (t === 'Multi-Select Lookup' || t === 'Multi-Select' || t === 'Subform') {
    return 'Multi-Select';
  }
  return 'Single Select';
}

function lookupTarget(field) {
  if (!field) return '';
  if (typeof field.lookup === 'string') return field.lookup.split('.')[0] || '';
  if (field.lookup && typeof field.lookup === 'object') {
    return field.lookup.form || field.lookup.target || field.lookup.formName || '';
  }
  return '';
}

/**
 * Topologically sort forms so that any form referenced by a lookup is
 * created before the form holding that lookup.
 *
 * Returns an ordered list of { form, level } where `level` reflects the
 * depth in the dependency tree (0 = create first, no inbound deps).
 * Cycles are tolerated — remaining nodes are appended after stable nodes.
 */
function deriveCreationOrder(forms) {
  const byName = new Map(forms.map((f) => [f.name, f]));
  const indeg = new Map(forms.map((f) => [f.name, 0]));
  const edges = new Map(forms.map((f) => [f.name, []])); // dep -> [dependents]

  for (const f of forms) {
    for (const fld of f.fields || []) {
      if (!isLookup(fld)) continue;
      const target = lookupTarget(fld);
      if (target && byName.has(target) && target !== f.name) {
        edges.get(target).push(f.name);
        indeg.set(f.name, (indeg.get(f.name) || 0) + 1);
      }
    }
  }

  // Kahn's algorithm with deterministic tie-breaking (alphabetical).
  const queue = [...indeg.entries()]
    .filter(([, d]) => d === 0)
    .map(([n]) => n)
    .sort();
  const order = [];
  const levels = new Map();
  for (const n of queue) levels.set(n, 0);

  while (queue.length) {
    const n = queue.shift();
    order.push(n);
    const lvl = levels.get(n) ?? 0;
    for (const dep of edges.get(n) || []) {
      indeg.set(dep, indeg.get(dep) - 1);
      if (indeg.get(dep) === 0) {
        levels.set(dep, lvl + 1);
        queue.push(dep);
      }
    }
    queue.sort();
  }

  // Append any cyclic remnants so nothing is dropped.
  for (const f of forms) if (!order.includes(f.name)) order.push(f.name);

  return order.map((name) => ({
    form: byName.get(name),
    level: levels.get(name) ?? 99,
  }));
}

/**
 * Detect dropdown-style fields that should ideally be promoted to standalone
 * lookup forms (per project rule: "all dropdowns are separate forms").
 */
function findDropdownsNeedingPromotion(forms) {
  const out = [];
  for (const f of forms) {
    for (const fld of f.fields || []) {
      if (!DROPDOWNISH_TYPES.has(fld.type)) continue;
      if (isLookup(fld)) continue; // already a lookup ✓
      const values = Array.isArray(fld.values) ? fld.values : [];
      out.push({
        form: f.name,
        field: fld.displayName || fld.name,
        type: fld.type,
        sampleValues: values.slice(0, 5),
      });
    }
  }
  return out;
}

/* --------------------------------- subviews --------------------------------- */

function MandatoryBadge({ required }) {
  if (required) {
    return (
      <span className="chip text-[10px] bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
        Mandatory
      </span>
    );
  }
  return (
    <span className="chip text-[10px] bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
      Optional
    </span>
  );
}

function LookupBadge({ field }) {
  if (!isLookup(field)) return null;
  const target = lookupTarget(field);
  const card = lookupCardinality(field);
  const tone =
    card === 'Multi-Select'
      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
      : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300';
  return (
    <span className={`chip text-[10px] ${tone}`} title={`Lookup → ${target}`}>
      🔗 {card}
      {target ? ` → ${target}` : ''}
    </span>
  );
}

function FieldRow({ field }) {
  return (
    <tr className="border-t border-slate-100 dark:border-slate-800">
      <td className="py-1.5 pr-3">
        <div className="text-sm text-slate-900 dark:text-slate-100">
          {field.displayName || field.name}
        </div>
        {field.displayName && field.name && field.displayName !== field.name && (
          <div className="text-[11px] text-slate-500 font-mono">{field.name}</div>
        )}
      </td>
      <td className="py-1.5 pr-3">
        <span className="chip text-[10px] bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {field.type || '—'}
        </span>
      </td>
      <td className="py-1.5 pr-3">
        <MandatoryBadge required={!!field.required} />
      </td>
      <td className="py-1.5 pr-3">
        <LookupBadge field={field} />
        {field.unique && (
          <span className="chip text-[10px] ml-1 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            Unique
          </span>
        )}
      </td>
    </tr>
  );
}

function FormCard({ form, index }) {
  const fields = form.fields || [];
  const mandatoryCount = fields.filter((f) => f.required).length;
  const lookupCount = fields.filter(isLookup).length;

  return (
    <article className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40">
      <header className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-slate-800">
        <span className="chip bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 text-[11px] font-mono">
          #{index + 1}
        </span>
        <h4 className="font-semibold text-slate-900 dark:text-slate-100">
          {form.displayName || form.name}
        </h4>
        {form.displayName && form.name && form.displayName !== form.name && (
          <span className="text-[11px] text-slate-500 font-mono">({form.name})</span>
        )}
        <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
          <span>{fields.length} fields</span>
          {mandatoryCount > 0 && <span>· {mandatoryCount} mandatory</span>}
          {lookupCount > 0 && <span>· {lookupCount} lookups</span>}
        </div>
      </header>
      {form.purpose && (
        <p className="px-4 pt-2 text-xs text-slate-600 dark:text-slate-400 italic">
          {form.purpose}
        </p>
      )}
      <div className="px-4 pb-3 pt-2 overflow-x-auto">
        {fields.length === 0 ? (
          <p className="text-xs text-slate-500">No fields captured yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="py-1 pr-3 font-medium">Field</th>
                <th className="py-1 pr-3 font-medium">Type</th>
                <th className="py-1 pr-3 font-medium">Required</th>
                <th className="py-1 pr-3 font-medium">Lookup / Notes</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <FieldRow key={f.name || f.displayName} field={f} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </article>
  );
}

/* ---------------------------------- main ---------------------------------- */

export default function FormsView({ scope }) {
  const forms = scope?.forms || [];

  const order = useMemo(() => deriveCreationOrder(forms), [forms]);
  const promotions = useMemo(() => findDropdownsNeedingPromotion(forms), [forms]);

  if (forms.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
        <Icon.FileDoc size={20} className="mx-auto text-slate-400 mb-2" />
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No forms captured yet. Use the prompt box above to define forms — e.g.
          <span className="font-mono mx-1 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">
            create form Customer with fields Name, Email, Phone
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* --------- Recommended creation order --------- */}
      <section>
        <header className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Icon.Plan size={14} />
            Recommended Creation Order
          </h3>
          <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 text-[10px]">
            lookup-first topological sort
          </span>
        </header>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
          Build forms in this order — every form a lookup points to is created
          before the form holding the lookup, so references resolve cleanly.
        </p>
        <ol className="space-y-1">
          {order.map(({ form, level }, i) => {
            const lookups = (form.fields || []).filter(isLookup);
            return (
              <li
                key={form.name}
                className="flex items-start gap-3 text-sm py-1 px-3 rounded border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/30"
              >
                <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 mt-0.5 w-6">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {form.displayName || form.name}
                </span>
                <span className="chip text-[10px] bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Tier {level}
                </span>
                {lookups.length > 0 && (
                  <span className="text-[11px] text-slate-500 ml-auto">
                    depends on:{' '}
                    {lookups
                      .map((l) => lookupTarget(l))
                      .filter(Boolean)
                      .join(', ') || '—'}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* --------- Dropdowns needing promotion --------- */}
      {promotions.length > 0 && (
        <section className="rounded-lg border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/10 p-4">
          <header className="flex items-center gap-2 mb-2">
            <Icon.Warning size={14} className="text-amber-600" />
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Dropdowns to promote → standalone Lookup forms
            </h3>
          </header>
          <p className="text-xs text-amber-800 dark:text-amber-200/80 mb-2">
            Project rule: <strong>every dropdown is its own form</strong> so
            values can be added later without code changes. The fields below
            currently use static values — promote each one to a Single Select
            Lookup pointing at a new master form.
          </p>
          <ul className="text-xs space-y-1">
            {promotions.map((p, i) => (
              <li key={i} className="font-mono">
                <span className="text-slate-700 dark:text-slate-300">
                  {p.form}.{p.field}
                </span>
                <span className="text-slate-500"> ({p.type})</span>
                {p.sampleValues.length > 0 && (
                  <span className="text-slate-500">
                    {' '}
                    → e.g. [{p.sampleValues.join(', ')}]
                  </span>
                )}
                <span className="text-emerald-700 dark:text-emerald-400">
                  {' → create form '}
                  <strong>{p.field.replace(/\s+/g, '')}_Master</strong>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --------- Per-form spec cards --------- */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Icon.FileDoc size={14} />
          Forms &amp; Fields ({forms.length})
        </h3>
        {order.map(({ form }, i) => (
          <FormCard key={form.name} form={form} index={i} />
        ))}
      </section>

      {/* --------- Worked sample --------- */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-2">
          <Icon.FileCode size={14} />
          Sample — canonical pattern
        </h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
          A complete worked example showing how lookup forms come first, then
          dropdowns are wired as Single/Multi-Select lookups (never as static
          dropdown values).
        </p>
        <pre className="text-[11px] font-mono leading-relaxed bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-3 overflow-x-auto">
{`# 1. Lookup masters (build first — no inbound deps)
Form: Department_Master
  • Name           — Single Line   — Mandatory · Unique
  • Code           — Single Line   — Mandatory · Unique

Form: Status_Master
  • Name           — Single Line   — Mandatory · Unique
  • Order          — Number        — Optional

# 2. Transactional forms (build after their lookups)
Form: Employee
  • Employee_ID    — Auto Number   — Mandatory · Unique
  • Full_Name      — Name          — Mandatory
  • Email          — Email         — Mandatory · Unique
  • Department     — Single Select Lookup → Department_Master
  • Skills         — Multi-Select Lookup → Skill_Master
  • Status         — Single Select Lookup → Status_Master
  • Joined_On      — Date          — Mandatory`}
        </pre>
      </section>
    </div>
  );
}
