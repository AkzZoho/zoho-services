import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import Icon from './Icons.jsx';

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

function DropBox({ label, hint, accept, file, onFile, required, icon: IconC, disabled, validate }) {
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
      <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
        {file ? (
          <b className="text-brand-700 dark:text-brand-400">{file.name}</b>
        ) : (
          hint || 'Drag & drop or click to select'
        )}
      </p>
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

export function InspectPanel({ onInspect, loading, inspected, onReset }) {
  const [dsFile, setDsFile] = useState(null);

  function submit(e) {
    e.preventDefault();
    if (!dsFile) return alert('Please upload a Creator .ds file.');
    // Final guard before hitting the network — server still re-validates.
    if (!isSafeDsFile(dsFile)) {
      setDsFile(null);
      return alert('Only Zoho Creator .ds files are allowed.');
    }
    const fd = new FormData();
    fd.append('ds', dsFile);
    onInspect(fd);
  }

  // Wrap the setter so files that slip past the dropzone's MIME filter
  // (e.g. via native file picker in some browsers) are still rejected.
  function handleDsFile(f) {
    if (!isSafeDsFile(f)) {
      alert('Only Zoho Creator .ds files are allowed.');
      return;
    }
    setDsFile(f);
  }

  return (
    <form onSubmit={submit} className="card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Upload a Creator <code>.ds</code> file
        </h3>
        {inspected && (
          <span className="ml-auto chip bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 inline-flex items-center gap-1">
            <Icon.Check size={12} /> Inspected
          </span>
        )}
      </div>

      <DropBox
        label="Zoho Creator .ds file"
        hint="Drag & drop or click to select a .ds file"
        accept={{ 'application/octet-stream': ['.ds'] }}
        file={dsFile}
        onFile={handleDsFile}
        validate={isSafeDsFile}
        icon={Icon.FileCode}
        disabled={loading}
        required
      />

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          We’ll parse the file and give you a breakdown, schema and performance audit.
        </p>
        <div className="flex items-center gap-2">
          {inspected && (
            <button type="button" onClick={onReset} className="btn-ghost">
              <Icon.X size={14} /> Start over
            </button>
          )}
          <button type="submit" disabled={loading || !dsFile} className="btn-primary">
            {loading ? <Icon.Spinner size={16} /> : <Icon.Analyse size={16} />}
            {loading ? 'Inspecting…' : inspected ? 'Re-inspect' : 'Inspect app'}
          </button>
        </div>
      </div>
    </form>
  );
}

/* Default export kept for backward compatibility with any legacy import. */
export default InspectPanel;
