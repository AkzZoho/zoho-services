import { useMemo, useState } from 'react';
import Icon from '../../../components/Icons.jsx';

/**
 * PerformanceView — renders the deterministic performance audit attached at
 * `data.performance`, which is produced by `analyzer/performance.js` against
 * the rulebook in `Performance_Matrix.md`.
 *
 * Data contract from the backend (see functions/ds-analyzer/src/analyzer/performance.js):
 *
 *   data.performance = {
 *     summary:     { total, critical, warning, info, highImpact },
 *     byCategory:  { SCHEMA: 3, FETCH_RECORDS: 2, ... },
 *     byRule:      { "SCHEMA-001": 2, ... },
 *     volumeTiers: [{ form, displayName, tier, risk, fanIn, fanOut,
 *                     writers, workflows, dateFields, fieldCount }, ...],
 *     findings:    [Finding, ...]    // sorted by impactScore desc
 *     topImpact:   [Finding, ...]    // first 10
 *   }
 *
 *   Finding = {
 *     id, ruleId, severity ('critical'|'warning'|'info'), category, title, fix,
 *     message, formName, componentPath, line, snippet, impactScore, volumeTier
 *   }
 */
export default function PerformanceView({ data }) {
  const perf = data?.performance;
  const [severityFilter, setSeverityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!perf?.findings) return [];
    return perf.findings.filter((f) => {
      if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
      if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${f.title} ${f.message} ${f.formName} ${f.componentPath} ${f.ruleId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [perf, severityFilter, categoryFilter, search]);

  if (!data || !data.ok) return null;

  if (!perf) {
    return (
      <section className="card p-6">
        <SectionHeader />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Performance audit was not produced for this upload.
        </p>
      </section>
    );
  }

  if (perf.error) {
    return (
      <section className="card p-6 border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/30">
        <SectionHeader />
        <p className="text-sm text-amber-800 dark:text-amber-200">
          <Icon.Warning size={14} className="inline mr-1.5 -mt-0.5" />
          {perf.error}
        </p>
      </section>
    );
  }

  const { summary, byCategory, topImpact } = perf;
  const categories = Object.keys(byCategory || {});

  return (
    <section className="card p-6 space-y-5">
      <SectionHeader />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryTile label="Total findings" value={summary.total} />
        <SummaryTile label="Critical" value={summary.critical} tone="red" />
        <SummaryTile label="Warning" value={summary.warning} tone="amber" />
        <SummaryTile label="Info" value={summary.info} tone="blue" />
        <SummaryTile label="High impact" value={summary.highImpact} tone="purple" />
      </div>

      {summary.total === 0 ? (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-950/30 p-4 text-sm text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
          <Icon.Check size={16} />
          No performance issues detected against the current rulebook.
        </div>
      ) : (
        <>
          {/* Top impact */}
          {topImpact?.length > 0 && (
            <Panel title="Top 10 highest-impact issues" icon={Icon.Warning} tone="warn">
              <FindingsList findings={topImpact} compact />
            </Panel>
          )}

          {/* All findings + filters */}
          <Panel title={`All findings (${filtered.length} / ${summary.total})`} icon={Icon.Analyse}>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <SegmentedControl
                value={severityFilter}
                onChange={setSeverityFilter}
                options={[
                  { value: 'all', label: 'All severities', count: summary.total },
                  { value: 'critical', label: 'Critical', count: summary.critical, tone: 'red' },
                  { value: 'warning', label: 'Warning', count: summary.warning, tone: 'amber' },
                  { value: 'info', label: 'Info', count: summary.info, tone: 'blue' },
                ]}
              />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-2.5 py-1 text-sm rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="all">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c} ({byCategory[c]})
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search rule, form, message…"
                className="flex-1 min-w-[12rem] px-3 py-1 text-sm rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            {filtered.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-3">
                No findings match the current filters.
              </p>
            ) : (
              <FindingsList findings={filtered} />
            )}
          </Panel>
        </>
      )}

      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        Audit rules from <code>Performance_Matrix.md</code>. Impact score = severity
        weight × volume-tier multiplier; issues scoring ≥ 12 are marked high-impact.
      </p>
    </section>
  );
}

function SectionHeader() {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300 flex items-center gap-2">
        <Icon.Warning size={14} /> Performance Audit
      </div>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-1">
        Rule-based performance report
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
        Deterministic audit against <code>Performance_Matrix.md</code> — schema,
        fetch, loop, concurrency, generic and more.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Findings list                                                              */
/* -------------------------------------------------------------------------- */

function FindingsList({ findings, compact = false }) {
  return (
    <ul className="divide-y divide-slate-200 dark:divide-slate-800">
      {findings.map((f) => (
        <FindingRow key={f.id} finding={f} compact={compact} />
      ))}
    </ul>
  );
}

function FindingRow({ finding, compact }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!(finding.snippet || finding.fix || finding.componentPath || finding.line);

  return (
    <li className="py-2.5">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className="w-full text-left flex items-start gap-3 group"
        aria-expanded={open}
        disabled={!hasDetail}
      >
        <SeverityBadge severity={finding.severity} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {finding.title}
            </span>
            <span className="chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 text-[10px] font-mono">
              {finding.ruleId}
            </span>
            {finding.impactScore != null && (
              <span
                className={`chip text-[10px] font-semibold ${
                  finding.impactScore >= 12
                    ? 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                }`}
                title="Impact score = severity weight × volume-tier multiplier"
              >
                impact {finding.impactScore}
              </span>
            )}
            {finding.volumeTier && (
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                tier: {finding.volumeTier}
              </span>
            )}
          </div>
          {!compact && finding.message && (
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">
              {finding.message}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
            {finding.formName && (
              <span>
                form: <span className="font-mono">{finding.formName}</span>
              </span>
            )}
            {finding.componentPath && (
              <span>· {finding.componentPath}</span>
            )}
            {finding.line != null && <span>· line {finding.line}</span>}
          </div>
        </div>
        {hasDetail && (
          <span
            className={`shrink-0 mt-1 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden
          >
            ▸
          </span>
        )}
      </button>

      {open && hasDetail && (
        <div className="ml-[1.75rem] mt-2 space-y-2">
          {compact && finding.message && (
            <p className="text-sm text-slate-600 dark:text-slate-300">{finding.message}</p>
          )}
          {finding.snippet && (
            <pre className="text-xs font-mono bg-slate-950 text-slate-100 rounded-md p-2 overflow-x-auto whitespace-pre-wrap">
              {finding.snippet}
            </pre>
          )}
          {finding.fix && (
            <div className="text-xs flex gap-2 items-start text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-md p-2">
              <Icon.Check size={12} className="mt-0.5 shrink-0" />
              <span>
                <b>Suggested fix:</b> {finding.fix}
              </span>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function SeverityBadge({ severity }) {
  const map = {
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 ring-red-200 dark:ring-red-800/60',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 ring-amber-200 dark:ring-amber-800/60',
    info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 ring-blue-200 dark:ring-blue-800/60',
  };
  const cls = map[severity] || map.info;
  return (
    <span
      className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ring-1 ${cls}`}
    >
      {severity}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Small UI helpers                                                           */
/* -------------------------------------------------------------------------- */

function SummaryTile({ label, value, tone }) {
  const toneCls =
    tone === 'red'
      ? 'text-red-700 dark:text-red-300'
      : tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300'
      : tone === 'blue'
      ? 'text-blue-700 dark:text-blue-300'
      : tone === 'purple'
      ? 'text-purple-700 dark:text-purple-300'
      : 'text-slate-900 dark:text-slate-100';
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 dark:bg-slate-800/40 dark:border-slate-700">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-2xl font-semibold leading-tight ${toneCls}`}>{value}</div>
    </div>
  );
}

function Panel({ title, icon: IconC, tone, children }) {
  const toneCls =
    tone === 'warn'
      ? 'border-amber-200 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-950/20'
      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40';
  return (
    <div className={`border rounded-lg p-4 ${toneCls}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 flex items-center gap-2 mb-3">
        {IconC && <IconC size={14} />} {title}
      </div>
      {children}
    </div>
  );
}

function SegmentedControl({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
      {options.map((o) => {
        const active = value === o.value;
        const toneCls = !active
          ? 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          : o.tone === 'red'
          ? 'bg-red-600 text-white'
          : o.tone === 'amber'
          ? 'bg-amber-600 text-white'
          : o.tone === 'blue'
          ? 'bg-blue-600 text-white'
          : 'bg-brand-600 text-white';
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`px-2.5 py-1 text-xs font-medium transition ${toneCls}`}
          >
            {o.label}
            {o.count != null && (
              <span className="ml-1 opacity-80">({o.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
