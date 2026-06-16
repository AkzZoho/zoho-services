import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/Icons.jsx';
import { useTheme } from '../../../theme/ThemeProvider.jsx';
import { buildDataEntryFlowchart, FLOW_LEGEND } from '../lib/dataEntryFlow.js';

/**
 * FlowChartPanel — renders a Mermaid "data-entry flow" diagram for the
 * currently inspected .ds file, and lets the user download it as SVG / PNG.
 *
 * Props:
 *   - scope           the data.technicalScope (or equivalent fallback)
 *   - appName         friendly name used in download filenames
 *   - mermaidSource   (optional) pre-built Mermaid source; overrides `scope`.
 *                     Lets callers (e.g. the full-report exporter) reuse the
 *                     same SVG without re-rendering.
 *   - onSvgChange     (optional) callback invoked with the current SVG markup
 *                     whenever rendering completes — lets the parent embed
 *                     the chart into a downloadable report.
 *
 * Mermaid is lazy-loaded so users who never open the panel don't pay for it.
 */
export default function FlowChartPanel({ scope, appName = 'application', mermaidSource, onSvgChange }) {
  const { theme } = useTheme();
  const source = useMemo(
    () => mermaidSource || buildDataEntryFlowchart(scope || {}),
    [mermaidSource, scope],
  );

  const containerRef = useRef(null);
  const [renderError, setRenderError] = useState(null);
  const [renderedSvg, setRenderedSvg] = useState('');

  // Render / re-render whenever source or theme changes.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaidMod = await import('mermaid');
        const mermaid = mermaidMod.default || mermaidMod;
        mermaid.initialize({
          startOnLoad: false,
          theme: theme === 'dark' ? 'dark' : 'default',
          securityLevel: 'strict',
          flowchart: { htmlLabels: true, curve: 'basis' },
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        });

        // Unique id each render — avoids mermaid cache hitting stale DOM
        const id = `ds-flow-${Date.now().toString(36)}`;
        const { svg } = await mermaid.render(id, source);
        if (cancelled) return;
        setRenderedSvg(svg);
        setRenderError(null);
        if (typeof onSvgChange === 'function') onSvgChange(svg);
      } catch (err) {
        if (cancelled) return;
        // Mermaid surfaces both syntax and runtime errors through exceptions.
        setRenderError(err?.message || String(err));
        setRenderedSvg('');
      }
    })();

    return () => {
      cancelled = true;
    };
    // onSvgChange is intentionally excluded from deps — it's a "fire on render"
    // callback and re-running the Mermaid render just because the parent's
    // function identity changed would be wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, theme]);

  function handleDownloadSvg() {
    if (!renderedSvg) return;
    downloadBlob(
      new Blob([prependXmlHeader(renderedSvg)], { type: 'image/svg+xml;charset=utf-8' }),
      buildFileName(appName, 'svg'),
    );
  }

  async function handleDownloadPng() {
    if (!renderedSvg) return;
    try {
      const png = await svgStringToPngBlob(renderedSvg, 2); // 2x scale for crispness
      downloadBlob(png, buildFileName(appName, 'png'));
    } catch (err) {
      setRenderError(`PNG export failed: ${err?.message || err}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Data-entry flow chart
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            What happens — per form — when a user enters data: events fire,
            workflows run, actions execute, reports & pages consume the data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadSvg}
            disabled={!renderedSvg}
            className="btn-ghost text-xs inline-flex items-center gap-1 disabled:opacity-50"
            title="Download as SVG (vector, scalable)"
          >
            <Icon.Download size={14} /> SVG
          </button>
          <button
            type="button"
            onClick={handleDownloadPng}
            disabled={!renderedSvg}
            className="btn-ghost text-xs inline-flex items-center gap-1 disabled:opacity-50"
            title="Download as PNG (raster, 2× scale)"
          >
            <Icon.Download size={14} /> PNG
          </button>
        </div>
      </div>

      {renderError && (
        <div className="text-xs p-3 rounded border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200">
          Could not render flow chart: {renderError}
        </div>
      )}

      <div
        ref={containerRef}
        className="overflow-auto border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 p-4"
        style={{ maxHeight: '70vh' }}
        // Trusted — we just built the SVG from our own Mermaid source.
        dangerouslySetInnerHTML={{ __html: renderedSvg }}
      />

      <Legend />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Legend                                                                     */
/* -------------------------------------------------------------------------- */

function Legend() {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {FLOW_LEGEND.map((l) => (
        <span
          key={l.cls}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-200"
        >
          <span
            className="inline-block w-3 h-3 rounded-sm border border-slate-300 dark:border-slate-600"
            style={{ background: l.swatch }}
            aria-hidden
          />
          {l.label}
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Export helpers (pure, DOM-aware)                                           */
/* -------------------------------------------------------------------------- */

function prependXmlHeader(svgMarkup) {
  if (svgMarkup.startsWith('<?xml')) return svgMarkup;
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${svgMarkup}`;
}

function buildFileName(appName, ext) {
  const safe = String(appName || 'application')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 60);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${safe}-flowchart-${ts}.${ext}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the blob URL on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Rasterise an SVG string to a PNG Blob. Works entirely in the browser:
 *   1. Serialise SVG → data URL
 *   2. Load it into a detached <img>
 *   3. Draw into a canvas at `scale×` natural size
 *   4. canvas.toBlob("image/png")
 */
export function svgStringToPngBlob(svgMarkup, scale = 2) {
  return new Promise((resolve, reject) => {
    try {
      const withHeader = prependXmlHeader(svgMarkup);

      // Extract intrinsic width/height from the SVG root if present,
      // else fall back to the viewBox, else a sensible default.
      const { width, height } = extractSvgSize(withHeader);

      const svgBlob = new Blob([withHeader], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const ctx = canvas.getContext('2d');
          // White background so the PNG isn't transparent on most viewers.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
            'image/png',
          );
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load SVG into <img>'));
      };
      img.src = url;
    } catch (err) {
      reject(err);
    }
  });
}

function extractSvgSize(svgMarkup) {
  const widthMatch = svgMarkup.match(/<svg[^>]*\swidth="([\d.]+)(px)?"/i);
  const heightMatch = svgMarkup.match(/<svg[^>]*\sheight="([\d.]+)(px)?"/i);
  if (widthMatch && heightMatch) {
    return { width: Number(widthMatch[1]), height: Number(heightMatch[1]) };
  }
  const vb = svgMarkup.match(/<svg[^>]*\sviewBox="([\d.\s-]+)"/i);
  if (vb) {
    const parts = vb[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && !parts.some(Number.isNaN)) {
      return { width: parts[2], height: parts[3] };
    }
  }
  return { width: 1200, height: 800 };
}
