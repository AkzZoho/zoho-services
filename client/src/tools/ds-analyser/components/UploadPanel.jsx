import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import Icon from '../../../components/Icons.jsx';

/* -------------------------------------------------------------------------- */
/*  Security: client-side extension allowlist                                  */
/* -------------------------------------------------------------------------- */
/**
 * Returns true only if `file.name` is a simple, safe `.ds` filename.
 * Defends against:
 *   - wrong extension (e.g. `.zip`, `.exe`, `.pdf`)
 *   - double extensions (`payload.ds.exe`)
 *   - path-traversal in the filename (`../evil.ds`)
 *   - control characters / NULs
 * The server performs the authoritative check; this is defence-in-depth.
 */
function isSafeDsFile(file) {
  if (!file || typeof file.name !== 'string') return false;
  const name = file.name;
  if (name.length === 0 || name.length > 255) return false;
  // Reject path separators and control chars up front.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f/\\]/.test(name)) return false;
  // Exactly one dot separating basename from a single `.ds` extension (case-insensitive).
  // Basename must be alphanumerics, space, dash, underscore, dot segment not allowed.
  return /^[A-Za-z0-9._ \-()]+\.ds$/i.test(name) && !/\.(?!ds$)[^.]+\.ds$/i.test(name);
}

/* -------------------------------------------------------------------------- */
/*  Shared dropzone                                                            */
/* -------------------------------------------------------------------------- */

function DropBox({ label, accept, file, onFile, icon: IconC, disabled, validate }) {
  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    accept,
    maxFiles: 1,
    disabled,
    // Custom per-file validator runs *in addition* to the MIME/extension accept map.
    validator: validate
      ? (f) => (validate(f) ? null : { code: 'file-invalid-type', message: 'Only .ds files are allowed' })
      : undefined,
    onDrop: (accepted) => accepted[0] && onFile(accepted[0]),
  });
  const rejection = fileRejections?.[0]?.errors?.[0]?.message;
  return (
    <div
      {...getRootProps()}
      className={`flex-1 border-2 border-dashed rounded-lg p-6 text-center transition
        ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
        ${isDragActive
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
          : 'border-slate-300 hover:border-brand-500 dark:border-slate-700 dark:hover:border-brand-400'}`}
    >
      <input {...getInputProps()} />
      <IconC size={28} className="mx-auto text-slate-400 dark:text-slate-500" />
      {file ? (
        <p className="mt-2 text-sm font-medium">
          <b className="text-brand-700 dark:text-brand-400">{file.name}</b>
        </p>
      ) : (
        label && (
          <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            {label}
          </p>
        )
      )}
      {rejection && !file && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-2" role="alert">
          {rejection}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  InspectPanel — the only upload surface                                     */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*  Action mode card — radio-style option tile                                 */
/* -------------------------------------------------------------------------- */

function ModeCard({ value, selected, onSelect, icon: IconC, title, description, disabled }) {
  const isActive = selected === value;
  return (
    <label
      className={`flex-1 border-2 rounded-lg p-4 cursor-pointer transition select-none
        ${disabled ? 'opacity-60 cursor-not-allowed' : ''}
        ${isActive
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 ring-1 ring-brand-500/40'
          : 'border-slate-200 hover:border-brand-400 dark:border-slate-700 dark:hover:border-brand-500'}`}
    >
      <input
        type="radio"
        name="ds-action-mode"
        value={value}
        checked={isActive}
        onChange={() => onSelect(value)}
        disabled={disabled}
        className="sr-only"
      />
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 shrink-0 rounded-md p-2
            ${isActive
              ? 'bg-brand-500 text-white'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
        >
          <IconC size={18} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </div>
          {description && (
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              {description}
            </p>
          )}
        </div>
        <div
          className={`ml-auto shrink-0 w-4 h-4 rounded-full border-2 mt-0.5
            ${isActive
              ? 'border-brand-500 bg-brand-500'
              : 'border-slate-300 dark:border-slate-600'}`}
          aria-hidden="true"
        >
          {isActive && (
            <span className="block w-full h-full rounded-full ring-2 ring-white dark:ring-slate-900" />
          )}
        </div>
      </div>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/*  InspectPanel — the only upload surface                                     */
/* -------------------------------------------------------------------------- */

export function InspectPanel({ onInspect, loading, inspected, onReset, mode: modeProp }) {
  const [dsFile, setDsFile] = useState(null);
  const [mode, setMode] = useState(modeProp || 'analyze'); // 'analyze' | 'changes'

  function fireInspect(file, chosenMode) {
    if (!file || !chosenMode) return;
    if (!isSafeDsFile(file)) {
      setDsFile(null);
      alert('Only Zoho Creator .ds files are allowed.');
      return;
    }
    const fd = new FormData();
    fd.append('ds', file);
    onInspect(fd, chosenMode);
  }

  function submit(e) {
    e.preventDefault();
    if (!dsFile) return alert('Please upload a Creator .ds file.');
    if (!mode) return alert('Please choose what you want to do with the .ds file.');
    fireInspect(dsFile, mode);
  }

  // Wrap the setter so files that slip past the dropzone's MIME filter
  // (e.g. via native file picker in some browsers) are still rejected.
  function handleDsFile(f) {
    if (!isSafeDsFile(f)) {
      alert('Only Zoho Creator .ds files are allowed.');
      return;
    }
    setDsFile(f);
    // If the user already chose "Make changes", uploading the file is the
    // implicit submit — jump straight to the prompt panel.
    if (mode === 'changes' && !loading && !inspected) {
      fireInspect(f, 'changes');
    }
  }

  // Clicking the "Make changes" tile is itself the submit gesture when a
  // file is already on hand — no Continue button required.
  function handleModeSelect(nextMode) {
    setMode(nextMode);
    if (nextMode === 'changes' && dsFile && !loading && !inspected) {
      fireInspect(dsFile, 'changes');
    }
  }

  const showSubmit = mode !== 'changes' || inspected;
  const submitLabel = loading
    ? mode === 'changes' ? 'Preparing…' : 'Inspecting…'
    : inspected
      ? mode === 'changes' ? 'Re-run for changes' : 'Re-inspect'
      : 'Inspect app';
  const SubmitIcon = mode === 'changes' ? Icon.Edit : Icon.Analyse;

  return (
    <form onSubmit={submit} className="card p-6 space-y-4">
      {inspected && (
        <div className="flex">
          <span className="ml-auto chip bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 inline-flex items-center gap-1">
            <Icon.Check size={12} /> Inspected
          </span>
        </div>
      )}

      <DropBox
        label={dsFile ? null : 'Drop a .ds file or click to select'}
        accept={{ 'application/octet-stream': ['.ds'] }}
        file={dsFile}
        onFile={handleDsFile}
        validate={isSafeDsFile}
        icon={Icon.FileCode}
        disabled={loading}
      />

      <fieldset disabled={loading}>
        <div className="flex flex-col md:flex-row gap-3">
          <ModeCard
            value="analyze"
            selected={mode}
            onSelect={handleModeSelect}
            icon={Icon.Analyse}
            title="Analyse the application"
            description="Get an overview of forms, fields, reports, workflows and find-usages search."
            disabled={loading}
          />
          <ModeCard
            value="changes"
            selected={mode}
            onSelect={handleModeSelect}
            icon={Icon.Edit}
            title="Plan a change for the developer"
            description="Describe a change you want made — get a precise handover (form, field, workflow, trigger, line numbers) the developer can apply in Creator."
            disabled={loading}
          />
        </div>
      </fieldset>

      {(showSubmit || inspected) && (
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {inspected && (
            <button type="button" onClick={onReset} className="btn-ghost">
              <Icon.X size={14} /> Start over
            </button>
          )}
          {showSubmit && (
            <button type="submit" disabled={loading || !dsFile || !mode} className="btn-primary">
              {loading ? <Icon.Spinner size={16} /> : <SubmitIcon size={16} />}
              {submitLabel}
            </button>
          )}
        </div>
      )}
    </form>
  );
}

/* Default export kept for backward compatibility with any legacy import. */
export default InspectPanel;
