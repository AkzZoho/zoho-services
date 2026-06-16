import { useMemo, useState } from 'react';
import Icon from '../../../components/Icons.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { apiFetch } from '../lib/http.js';

/**
 * FindUsagesPanel — deterministic "where is X used?" lookup.
 *
 * The consultant types the OLD identifier (e.g. shriniwash.yadav_adityabirla)
 * and optionally a NEW one (e.g. utcl_cms). The server scans every workflow,
 * function and page source in the parsed app and returns precise
 * file/line/column hits — no LLM involved, so the line numbers are
 * always correct.
 *
 * This sits inside SuggestChangesPanel alongside the free-text "Suggest
 * changes" prompt. It's the right tool for rename refactors; the prompt is
 * for higher-level reasoning.
 */
export default function FindUsagesPanel({ overview }) {
  const { showToast } = useToast();

  const [oldValue, setOldValue] = useState('');
  const [newValue, setNewValue] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(true);
  const [useRegExp, setUseRegExp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const canSearch =
    oldValue.trim().length > 0 && oldValue.length <= 500 && !loading;

  async function handleSearch(e) {
    e?.preventDefault?.();
    if (!canSearch) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await apiFetch('/api/find-usages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldValue: oldValue.trim(),
          // Only send newValue if the consultant actually typed one;
          // server treats undefined as "find only, don't preview replacement".
          ...(newValue.trim() ? { newValue: newValue.trim() } : {}),
          overview,
          options: { matchCase, wholeWord, useRegExp },
        }),
      });

      setResult(res);
      const count = res?.totals?.occurrences ?? 0;
      if (count === 0) {
        showToast(`No occurrences of "${oldValue.trim()}" found`, 'info');
      } else {
        showToast(
          `Found ${count} occurrence${count === 1 ? '' : 's'} in ${
            res.totals.entitiesWithMatches
          } location${res.totals.entitiesWithMatches === 1 ? '' : 's'}`,
          'success'
        );
      }
    } catch (err) {
      setError(err?.message || 'Find-usages request failed.');
      showToast('Could not run search', 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setOldValue('');
    setNewValue('');
    setResult(null);
    setError(null);
  }

  return (
    <div className="rounded-lg border border-sky-200 dark:border-sky-800/60
                    bg-gradient-to-br from-sky-50 to-white dark:from-sky-900/20 dark:to-slate-900/40
                    p-4 space-y-3">
      <div>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300 mb-1">
          <Icon.Code size={11} /> Find &amp; replace
        </div>
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
          Where is this used in the app?
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
          Type an identifier (e.g. <code className="text-[11px]">shriniwash.yadav_adityabirla</code>)
          and the tool scans every workflow, custom function and page in the parsed{' '}
          <code className="text-[11px]">.ds</code> and lists the exact{' '}
          <b>file → line</b> where it appears. Optionally type a replacement to preview
          the rewritten line. <b>Nothing is applied to your app — this is a discovery aid only.</b>
        </p>
      </div>

      <form onSubmit={handleSearch} className="space-y-2.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Find (old value)
            </span>
            <input
              type="text"
              value={oldValue}
              onChange={(e) => setOldValue(e.target.value)}
              placeholder="shriniwash.yadav_adityabirla"
              disabled={loading}
              className="mt-1 w-full px-2.5 py-1.5 text-sm font-mono rounded-md border border-slate-200 dark:border-slate-700
                         bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100
                         focus:outline-none focus:ring-2 focus:ring-sky-500
                         disabled:opacity-60 disabled:cursor-not-allowed"
              maxLength={500}
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Replace with <span className="text-slate-400 normal-case font-normal">(optional)</span>
            </span>
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="utcl_cms"
              disabled={loading}
              className="mt-1 w-full px-2.5 py-1.5 text-sm font-mono rounded-md border border-slate-200 dark:border-slate-700
                         bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100
                         focus:outline-none focus:ring-2 focus:ring-sky-500
                         disabled:opacity-60 disabled:cursor-not-allowed"
              maxLength={500}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <CheckOption
            label="Match case"
            checked={matchCase}
            onChange={setMatchCase}
            disabled={loading}
          />
          <CheckOption
            label="Whole identifier"
            checked={wholeWord}
            onChange={setWholeWord}
            disabled={loading || useRegExp}
            title="Avoids matching the value as a substring of a longer identifier"
          />
          <CheckOption
            label="Regex"
            checked={useRegExp}
            onChange={(v) => {
              setUseRegExp(v);
              if (v) setWholeWord(false); // wholeWord is meaningless for regex
            }}
            disabled={loading}
            title="Treat the find value as a regular expression"
          />
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="submit"
              disabled={!canSearch}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                         bg-sky-600 hover:bg-sky-700 text-white text-xs font-medium transition
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Icon.Spinner size={12} /> : <Icon.Code size={12} />}
              {loading ? 'Scanning…' : 'Find usages'}
            </button>
            {(oldValue || newValue || result || error) && (
              <button
                type="button"
                onClick={handleClear}
                disabled={loading}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md
                           text-slate-600 dark:text-slate-300 text-xs
                           hover:bg-slate-100 dark:hover:bg-slate-800 transition
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon.X size={11} /> Clear
              </button>
            )}
          </div>
        </div>
      </form>

      {error && (
        <div className="rounded-md border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40
                        text-red-800 dark:text-red-200 text-xs p-2.5 flex items-start gap-2">
          <Icon.Warning className="mt-0.5 shrink-0" size={12} />
          <div className="min-w-0">{error}</div>
        </div>
      )}

      {result && <FindUsagesResult result={result} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Result rendering                                                           */
/* -------------------------------------------------------------------------- */

function FindUsagesResult({ result }) {
  const { totals, groupedByEntity, query } = result;

  const summary = useMemo(() => {
    const o = totals.occurrences;
    const e = totals.entitiesWithMatches;
    if (o === 0) {
      return `No occurrences of "${query.oldValue}" found in any workflow, function or page.`;
    }
    return `${o} occurrence${o === 1 ? '' : 's'} in ${e} location${e === 1 ? '' : 's'}${
      totals.truncated ? ' (results truncated by safety cap)' : ''
    }.`;
  }, [totals, query]);

  return (
    <div className="border-t border-sky-200 dark:border-sky-800/60 pt-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
          {totals.occurrences > 0 ? (
            <>
              <Icon.Check size={11} className="inline -mt-0.5 mr-1 text-emerald-600" />
              {summary}
            </>
          ) : (
            <>
              <Icon.Help size={11} className="inline -mt-0.5 mr-1 text-slate-400" />
              {summary}
            </>
          )}
        </div>
        {query.newValue && totals.occurrences > 0 && (
          <span className="text-[11px] font-mono px-2 py-0.5 rounded
                           bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300
                           border border-emerald-200 dark:border-emerald-800/60">
            {query.oldValue} → {query.newValue}
          </span>
        )}
      </div>

      {groupedByEntity.length > 0 && (
        <ul className="space-y-1.5">
          {groupedByEntity.map((g) => (
            <EntityGroup key={g.entityKey} group={g} query={query} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EntityGroup({ group, query }) {
  const [open, setOpen] = useState(true);
  return (
    <li className="rounded border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2 flex items-center gap-2 group"
        aria-expanded={open}
      >
        <span
          className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ▸
        </span>
        <EntityKindBadge kind={group.entityKind} />
        <span className="font-mono text-xs text-slate-800 dark:text-slate-100 truncate">
          {group.displayName}
        </span>
        <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
          {group.matches.length} hit{group.matches.length === 1 ? '' : 's'}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-2 space-y-1.5">
          {group.matches.map((m, i) => (
            <Occurrence key={`${m.line}:${m.column}:${i}`} match={m} query={query} />
          ))}
        </div>
      )}
    </li>
  );
}

function Occurrence({ match, query }) {
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
        {renderHighlighted(match.lineText, match.matchText, query)}
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
 * Render the matched line with the matched substring(s) highlighted.
 *
 * We highlight by literally searching for `matchText` within `lineText`.
 * Because the server already clipped the line around the match position,
 * we're guaranteed at least one occurrence of matchText is present.
 */
function renderHighlighted(lineText, matchText, query) {
  if (!matchText || !lineText) return lineText || '';
  // Case sensitivity follows the server-side query setting.
  const flags = query?.matchCase ? 'g' : 'gi';
  // Always escape — matchText is the literal text the server matched.
  const escaped = matchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, flags);

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
    if (m.index === re.lastIndex) re.lastIndex += 1; // zero-width guard
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

function CheckOption({ label, checked, onChange, disabled, title }) {
  return (
    <label
      className={`inline-flex items-center gap-1.5 select-none ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      }`}
      title={title}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-600
                   text-sky-600 focus:ring-sky-500 dark:bg-slate-800"
      />
      <span className="text-slate-700 dark:text-slate-200">{label}</span>
    </label>
  );
}
