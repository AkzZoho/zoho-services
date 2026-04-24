import { useRef, useState } from 'react';
import { InspectPanel } from './components/UploadPanel.jsx';
import AppOverview from './components/AppOverview.jsx';
import SchemaView from './components/SchemaView.jsx';
import PerformanceView from './components/PerformanceView.jsx';
import Icon from './components/Icons.jsx';
import { useTheme } from './theme/ThemeProvider.jsx';
import { apiFetch } from './lib/http.js';
import { downloadPageAsHtml } from './lib/pageDownload.js';

/**
 * Creator DS Analyser — top-level shell.
 *
 * Single-step flow:
 *   1. User uploads a `.ds` file.
 *   2. Backend parses it and returns a full digest (overview + technicalScope
 *      + performance audit).
 *   3. The UI renders three sections below the upload card:
 *        · Application breakdown   — forms / reports / pages / workflows
 *        · Schema                  — every form's fields in one place
 *        · Performance report      — rule-based audit (Performance_Matrix.md)
 */
export default function App() {
  const [overview, setOverview] = useState(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  // Captures the three report sections so the "Download as HTML" button
  // can serialise them into a standalone file.
  const reportRef = useRef(null);

  async function handleInspect(formData) {
    setInspectLoading(true);
    setInspectError(null);
    setOverview(null);
    try {
      const json = await apiFetch('/api/inspect', { method: 'POST', body: formData });
      setOverview(json);
    } catch (e) {
      setInspectError(e.message);
    } finally {
      setInspectLoading(false);
    }
  }

  function handleReset() {
    setOverview(null);
    setInspectError(null);
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
    <div className="min-h-screen">
      <AppHeader />

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {!overview && <IntroCard />}

        <InspectPanel
          onInspect={handleInspect}
          loading={inspectLoading}
          inspected={!!overview}
          onReset={handleReset}
        />

        {inspectError && <ErrorBanner message={inspectError} />}

        {overview && (
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

        {!overview && !inspectLoading && !inspectError && (
          <div className="text-center text-slate-400 dark:text-slate-500 text-sm py-8">
            Drop a <code>.ds</code> file above to inspect the app.
          </div>
        )}
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Header                                                                     */
/* -------------------------------------------------------------------------- */

function AppHeader() {
  const { theme, toggle } = useTheme();

  return (
    <header className="bg-white border-b border-slate-200 dark:bg-slate-900 dark:border-slate-800 sticky top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-slate-900/80">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Icon.LogoMark size={32} />
          <div className="min-w-0">
            <h1 className="text-base md:text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
              Creator DS Analyser
            </h1>
            <p className="hidden md:block text-xs text-slate-500 dark:text-slate-400">
              Upload a Creator <code>.ds</code> file to explore its structure, schema, and performance.
            </p>
          </div>
        </div>

        <nav className="flex items-center gap-1">
          <button
            onClick={toggle}
            className="btn-ghost ml-1"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Icon.Sun size={16} /> : <Icon.Moon size={16} />}
          </button>

          <span className="chip bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300 ml-1 font-medium">
            v0.3
          </span>
        </nav>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/*  Intro card — shown only before the first inspection                        */
/* -------------------------------------------------------------------------- */

function IntroCard() {
  const sections = [
    {
      title: 'Application breakdown',
      Ico: Icon.Folder,
      body: 'Provides a complete structural view of the uploaded application. Lists all Forms, Reports, Pages and Workflows, letting you explore each component’s configuration, fields and underlying source code from a single unified view.',
    },
    {
      title: 'Schema',
      Ico: Icon.FileCode,
      body: 'Presents the application’s entire data model in a clean, tabular format. Outlines every Form and its fields, including data types, constraints and lookup relationships — giving you a quick, exportable reference of how your data is structured across the app.',
    },
    {
      title: 'Performance report',
      Ico: Icon.Warning,
      body: 'Generates an automated audit of the uploaded application, highlighting areas that may affect performance or maintainability. Each finding is mapped to a specific form with an associated impact level, helping you identify and prioritize optimizations effectively.',
    },
  ];

  return (
    <section className="card p-6">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        Upload a <code>.ds</code> file to start
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
        <b className="text-slate-800 dark:text-slate-200">Creator DS Analyser</b> parses your
        exported Zoho Creator app and produces three views of it — a component breakdown,
        the full schema, and a deterministic performance audit.
      </p>

      <div className="grid md:grid-cols-3 gap-4 mt-5">
        {sections.map(({ title, Ico, body }) => (
          <div
            key={title}
            className="border border-slate-200 rounded-lg p-4 bg-slate-50
                       dark:bg-slate-800/40 dark:border-slate-700"
          >
            <div className="flex items-center gap-2 text-brand-700 dark:text-brand-300 text-xs font-semibold uppercase tracking-wide">
              <Ico size={14} /> {title}
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 mt-2">{body}</p>
          </div>
        ))}
      </div>
    </section>
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
