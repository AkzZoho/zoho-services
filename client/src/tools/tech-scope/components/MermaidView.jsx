import { useEffect, useRef, useState, useCallback } from 'react';
import Icon from '../../../components/Icons.jsx';

/**
 * MermaidView — render arbitrary Mermaid source to inline SVG, with a
 * graceful error state. Re-renders whenever `source` changes.
 *
 * Includes built-in pan & zoom controls so large flow diagrams remain
 * readable in the Technical Scope tool. Users can:
 *   • Click +/- buttons to zoom in/out
 *   • Click the reset button to fit the diagram
 *   • Click the fullscreen button to expand the viewer
 *   • Use Ctrl/Cmd + mouse wheel to zoom
 *   • Click & drag to pan around when zoomed in
 *
 * Mermaid is loaded lazily so the main bundle stays small.
 */
let mermaidInitPromise = null;

async function getMermaid() {
  if (!mermaidInitPromise) {
    mermaidInitPromise = import('mermaid').then((m) => {
      const mm = m.default;
      mm.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
      return mm;
    });
  }
  return mermaidInitPromise;
}

let renderId = 0;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.2;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export default function MermaidView({ source, className = '' }) {
  const hostRef = useRef(null);          // scrollable viewport
  const stageRef = useRef(null);         // transformed inner stage
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const dragRef = useRef(null);

  // Render Mermaid whenever source changes.
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);

    (async () => {
      try {
        const mermaid = await getMermaid();
        const id = `mermaid-view-${++renderId}`;
        const { svg } = await mermaid.render(id, source || '');
        if (cancelled || !stageRef.current) return;
        stageRef.current.innerHTML = svg;
        const svgEl = stageRef.current.querySelector('svg');
        if (svgEl) {
          // Let the SVG size to its intrinsic dimensions so zoom math works
          // predictably; we drive the visible size via the CSS transform.
          svgEl.style.maxWidth = 'none';
          svgEl.style.height = 'auto';
          svgEl.style.display = 'block';
        }
        // Reset view on new diagrams so users always start fitted.
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } catch (err) {
        if (!cancelled) setError(err?.message || String(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => { cancelled = true; };
  }, [source]);

  const zoomIn  = useCallback(() => setZoom((z) => clamp(+(z + ZOOM_STEP).toFixed(2), MIN_ZOOM, MAX_ZOOM)), []);
  const zoomOut = useCallback(() => setZoom((z) => clamp(+(z - ZOOM_STEP).toFixed(2), MIN_ZOOM, MAX_ZOOM)), []);
  const reset   = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);
  const toggleFullscreen = useCallback(() => setFullscreen((v) => !v), []);

  // Ctrl/Cmd + wheel = zoom; otherwise allow native scroll.
  const onWheel = useCallback((e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setZoom((z) => clamp(+(z + delta).toFixed(2), MIN_ZOOM, MAX_ZOOM));
  }, []);

  // Click-and-drag panning.
  const onMouseDown = useCallback((e) => {
    // Only start panning on primary button and when not on a link.
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const onMouseMove = useCallback((e) => {
    if (!dragRef.current) return;
    const { startX, startY, panX, panY } = dragRef.current;
    setPan({ x: panX + (e.clientX - startX), y: panY + (e.clientY - startY) });
  }, []);

  const endDrag = useCallback(() => { dragRef.current = null; }, []);

  // Esc exits fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const containerClass = fullscreen
    ? 'fixed inset-4 z-50 flex flex-col border rounded-lg bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xl'
    : `relative border rounded-lg bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 ${className}`;

  return (
    <>
      {fullscreen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm"
          onClick={toggleFullscreen}
          aria-hidden="true"
        />
      )}
      <div className={containerClass}>
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {busy ? 'Rendering…' : `Zoom ${Math.round(zoom * 100)}%`}
          </div>
          <div className="flex items-center gap-1">
            <ToolbarButton title="Zoom out (Ctrl/⌘ + scroll)" onClick={zoomOut} disabled={zoom <= MIN_ZOOM}>
              <MinusIcon />
            </ToolbarButton>
            <ToolbarButton title="Reset view" onClick={reset}>
              <ResetIcon />
            </ToolbarButton>
            <ToolbarButton title="Zoom in (Ctrl/⌘ + scroll)" onClick={zoomIn} disabled={zoom >= MAX_ZOOM}>
              <PlusIcon />
            </ToolbarButton>
            <ToolbarButton title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'} onClick={toggleFullscreen}>
              {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
            </ToolbarButton>
          </div>
        </div>

        {/* Viewport */}
        <div
          ref={hostRef}
          className={`relative overflow-auto ${fullscreen ? 'flex-1' : ''}`}
          style={{
            minHeight: fullscreen ? undefined : 320,
            cursor: dragRef.current ? 'grabbing' : 'grab',
          }}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400 pointer-events-none">
              <Icon.Spinner size={20} />
            </div>
          )}
          {error && !busy && (
            <pre className="m-3 text-xs text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-300 p-3 rounded whitespace-pre-wrap">
              Diagram failed to render:
              {'\n'}{error}
            </pre>
          )}
          <div
            ref={stageRef}
            className="mermaid-host inline-block p-4 origin-top-left select-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              transition: dragRef.current ? 'none' : 'transform 120ms ease-out',
            }}
          />
        </div>
      </div>
    </>
  );
}

/* -------------------------- presentational bits -------------------------- */

function ToolbarButton({ children, title, onClick, disabled }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}

const iconBase = {
  width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
};

function PlusIcon()  { return <svg {...iconBase}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function MinusIcon() { return <svg {...iconBase}><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function ResetIcon() { return <svg {...iconBase}><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/></svg>; }
function FullscreenIcon()     { return <svg {...iconBase}><polyline points="4 9 4 4 9 4"/><polyline points="20 9 20 4 15 4"/><polyline points="4 15 4 20 9 20"/><polyline points="20 15 20 20 15 20"/></svg>; }
function ExitFullscreenIcon() { return <svg {...iconBase}><polyline points="9 4 4 4 4 9"/><polyline points="15 4 20 4 20 9"/><polyline points="9 20 4 20 4 15"/><polyline points="15 20 20 20 20 15"/></svg>; }
