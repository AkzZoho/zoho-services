import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import Icon from '../../../components/Icons.jsx';
import { ACCEPTED_BRD_EXTENSIONS } from '../lib/parseBRD.js';

/**
 * UploadStep — first screen of the wizard.
 *
 * Lets the user either:
 *   · Upload a BRD/requirement file (.txt / .md / .pdf / .docx), OR
 *   · Click "Start blank" to skip parsing and build a scope from scratch
 *     (still fully usable via the prompt DSL on each step).
 */

const ACCEPT_MAP = {
  'text/plain': ['.txt'],
  'text/markdown': ['.md', '.markdown'],
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};

function isSafeBrd(file) {
  if (!file?.name) return false;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return ACCEPTED_BRD_EXTENSIONS.has(ext);
}

export default function UploadStep({ onParse, onBlank, busy, busyStage, error, notice }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  // AI extraction is ON by default. The server transparently falls back to
  // local heuristics if no LLM provider is configured (returns 501 useFallback).
  const [useAi, setUseAi] = useState(true);

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    accept: ACCEPT_MAP,
    maxFiles: 1,
    disabled: busy,
    validator: (f) => (isSafeBrd(f) ? null : { code: 'file-invalid-type', message: 'Use .txt / .md / .pdf / .docx' }),
    onDrop: (accepted) => accepted[0] && setFile(accepted[0]),
  });

  const rejection = fileRejections?.[0]?.errors?.[0]?.message;

  function submit(e) {
    e.preventDefault();
    if (!file) return;
    onParse({ file, title: title.trim() || null, useAi });
  }

  const busyLabel =
    busyStage === 'parsing' ? 'Reading document…' :
    busyStage === 'ai' ? 'AI extracting scope…' :
    busyStage === 'heuristic' ? 'Deriving scope…' :
    'Working…';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <section className="card p-6 space-y-5">
        <header className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300 flex items-center justify-center shrink-0">
            <Icon.Plan size={22} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Upload your BRD or Requirement Document
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Supported formats: <code>.txt</code>, <code>.md</code>, <code>.pdf</code>, <code>.docx</code>.
              {' '}File parsing runs locally; AI extraction (when enabled) sends the document
              text to your configured AI provider.
            </p>
          </div>
        </header>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Project title <span className="text-slate-400">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. ACME Procurement Portal"
              className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              disabled={busy}
            />
          </div>

          {/* AI toggle — default ON. Server falls back to local heuristics if no LLM is configured. */}
          <label className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition ${
            useAi
              ? 'border-brand-300 bg-brand-50/60 dark:border-brand-700 dark:bg-brand-900/20'
              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
          } ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}>
            <input
              type="checkbox"
              checked={useAi}
              onChange={(e) => setUseAi(e.target.checked)}
              disabled={busy}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="flex-1">
              <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                Use AI for best output
                <span className="ml-2 text-[10px] uppercase tracking-wide font-semibold text-brand-600 dark:text-brand-300 bg-brand-100 dark:bg-brand-900/40 px-1.5 py-0.5 rounded">
                  Recommended
                </span>
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Reads the BRD with Claude / GPT to infer realistic forms, fields, lookups,
                blueprints and NFRs. Falls back to the local extractor if the server has
                no AI provider configured.
              </span>
            </span>
          </label>

          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition cursor-pointer
              ${isDragActive
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                : 'border-slate-300 hover:border-brand-500 dark:border-slate-700 dark:hover:border-brand-400'}
              ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <input {...getInputProps()} />
            <Icon.Upload size={32} className="mx-auto text-slate-400 dark:text-slate-500" />
            <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
              {file ? file.name : 'Drag & drop your document or click to select'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              .txt · .md · .pdf · .docx
            </p>
            {rejection && !file && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-2" role="alert">{rejection}</p>
            )}
          </div>

          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
              <Icon.Warning size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!error && notice && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
              <Icon.Warning size={16} className="mt-0.5 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={onBlank}
              disabled={busy}
              className="btn-ghost"
              title="Skip the BRD and start with a blank scope"
            >
              <Icon.Plus size={14} /> Start blank
            </button>
            <div className="flex items-center gap-2">
              {file && (
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  disabled={busy}
                  className="btn-ghost"
                >
                  <Icon.X size={14} /> Clear
                </button>
              )}
              <button type="submit" disabled={busy || !file} className="btn-primary">
                {busy ? <Icon.Spinner size={16} /> : <Icon.Analyse size={16} />}
                {busy ? busyLabel : (useAi ? 'Extract with AI' : 'Parse & generate draft')}
              </button>
            </div>
          </div>
        </form>
      </section>

      <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
        After extraction, you'll review 5 steps — Application Flow, Data Model, Roles &amp; Profiles,
        Functions &amp; Connections, and NFRs — and adjust each via plain-English prompts before
        exporting a packed PDF.
      </p>
    </div>
  );
}
