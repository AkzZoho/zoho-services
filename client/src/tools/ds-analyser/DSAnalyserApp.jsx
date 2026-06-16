import { useRef, useState } from 'react';
import { InspectPanel } from './components/UploadPanel.jsx';
import AppOverview from './components/AppOverview.jsx';
import SchemaView from './components/SchemaView.jsx';
import PerformanceView from './components/PerformanceView.jsx';
import SuggestChangesPanel from './components/SuggestChangesPanel.jsx';
import Icon from '../../components/Icons.jsx';
import { apiFetch } from './lib/http.js';
import { downloadPageAsHtml } from './lib/pageDownload.js';

/**
 * Creator DS Analyser — tool view (mounted by the shell at `/ds-analyser`).
 *
 * Single-step flow:
 *   1. User uploads a `.ds` file.
 *   2. Backend parses it and returns a full digest (overview + technicalScope
 *      + performance audit).
 *   3. The UI renders three sections below the upload card:
 *        · Application breakdown   — forms / reports / pages / workflows
 *        · Schema                  — every form's fields in one place
 *        · Performance report      — rule-based audit (Performance_Matrix.md)
 *
 * The app-wide chrome (top bar / theme toggle / branding) is rendered by
 * `<ShellLayout>`; this component focuses purely on the DS-Analyser workflow.
 */
export default function DSAnalyserApp() {
  const [overview, setOverview] = useState(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  // 'analyze' → show full report below; 'changes' → jump straight into the
  // SuggestChangesPanel after inspection completes.
  const [mode, setMode] = useState('analyze');

  // Captures the three report sections so the "Download as HTML" button
  // can serialise them into a standalone file.
  const reportRef = useRef(null);
  const changesRef = useRef(null);

  async function handleInspect(formData, selectedMode = 'analyze') {
    setMode(selectedMode);
    setInspectLoading(true);
    setInspectError(null);
    setOverview(null);
    try {
      const json = await apiFetch('/api/inspect', { method: 'POST', body: formData });
      setOverview(json);
      // After a "make changes" upload, scroll the change planner into view.
      if (selectedMode === 'changes') {
        // Defer until the panel has rendered.
        setTimeout(() => {
          changesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
      }
    } catch (e) {
      setInspectError(e.message);
    } finally {
      setInspectLoading(false);
    }
  }

  function handleReset() {
    setOverview(null);
    setInspectError(null);
    setMode('analyze');
  }

  async function handleDownloadHtml() {
    if (!reportRef.current || !overview) return;
    setDownloading(true);
    try {
      await downloadPageAsHtml({
        rootEl: reportRef.current,
        appName: overview?.app?.name || overview?.meta?.fileName || 'application',
      });
    } catch (err) {
      console.error('Download failed:', err);
      alert(`Could not generate HTML report: ${err.message || err}`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <InspectPanel
        onInspect={handleInspect}
        loading={inspectLoading}
        inspected={!!overview}
        onReset={handleReset}
        mode={mode}
      />

      {inspectError && <ErrorBanner message={inspectError} />}

      {overview && mode === 'analyze' && (
        <>
          {/* Single global download bar — one action exports every section below */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Inspection complete — review each section below, or export the entire
              report as a self-contained HTML file.
            </div>
            <button
              type="button"
              onClick={handleDownloadHtml}
              disabled={downloading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-brand-200 dark:border-brand-800/60 bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-100 dark:hover:bg-brand-900/50 transition disabled:opacity-60 disabled:cursor-not-allowed"
              title="Download the full page (overview + schema + performance) as a single HTML file"
            >
              {downloading ? <Icon.Spinner size={14} /> : <Icon.Download size={14} />}
              {downloading ? 'Preparing…' : 'Download as HTML'}
            </button>
          </div>

          <div ref={reportRef} className="space-y-6">
            <AppOverview data={overview} />
            <SchemaView data={overview} />
            <PerformanceView data={overview} />
          </div>
        </>
      )}

      {mode === 'changes' && (overview || inspectLoading) && (
        <div ref={changesRef}>
          <SuggestChangesPanel
            overview={overview}
            parsing={inspectLoading}
          />
        </div>
      )}

    </div>
  );
}

function ErrorBanner({ message }) {
  return (
    <div className="card p-4 border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 text-sm flex items-start gap-2">
      <Icon.Warning className="mt-0.5 shrink-0" />
      <div>
        <b>Error:</b> {message}
      </div>
    </div>
  );
}
