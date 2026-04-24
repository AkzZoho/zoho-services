import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { buildAdjacency, collectNeighbours, edgeId, splitId } from '../lib/graph.js';

/**
 * FlowChart — interactive SVG diagram of the parsed Creator app.
 *
 * Layered left-to-right layout:
 *   Pages → Forms → Reports → Workflows → Functions
 *
 * Interactions:
 *   · Hover a node         → soft highlight of neighbourhood
 *   · Click a node         → FOCUS MODE: isolate + connections panel
 *   · Esc / click canvas   → exit focus
 *   · Tab / Shift+Tab      → cycle through connected peers (while focused)
 *   · controlledFocus prop → external focus (e.g. clicking a form name elsewhere)
 */

/* ───── layout constants ────────────────────────────────────────────────── */
const COL_X = { page: 40, form: 260, report: 480, workflow: 700, function: 920 };
const NODE_W = 180;
const NODE_H = 44;
const ROW_GAP = 14;
const COL_LABELS = {
  page: 'Pages',
  form: 'Forms',
  report: 'Reports',
  workflow: 'Workflows',
  function: 'Functions',
};
const TONES = {
  page: { fill: '#ecfdf5', stroke: '#10b981', text: '#065f46' },
  form: { fill: '#eff6ff', stroke: '#2563eb', text: '#1e3a8a' },
  report: { fill: '#faf5ff', stroke: '#9333ea', text: '#581c87' },
  workflow: { fill: '#fffbeb', stroke: '#d97706', text: '#78350f' },
  function: { fill: '#f1f5f9', stroke: '#475569', text: '#0f172a' },
};
// Directional colours for focus mode.
const INCOMING = '#2563eb'; // blue — things that point AT the focused node
const OUTGOING = '#059669'; // emerald — things the focused node points TO
const SELF_LOOP = '#d97706'; // amber

export default function FlowChart({ scope, controlledFocus = null, onFocusChange }) {
  const { nodes, edges, width, height } = useMemo(() => buildGraph(scope), [scope]);
  const adj = useMemo(() => buildAdjacency(edges), [edges]);

  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null); // focused node id
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef(null);
  const scrollRef = useRef(null);
  const pressPos = useRef(null); // for drag-vs-click discrimination

  // Sync external focus requests (e.g. user clicked a form name in Forms tab).
  useEffect(() => {
    if (controlledFocus === undefined) return;
    setSelected(controlledFocus || null);
  }, [controlledFocus]);

  // Clear focus if the graph changes underneath us.
  useEffect(() => {
    if (selected && !nodes.find((n) => n.id === selected)) setSelected(null);
  }, [nodes, selected]);

  // Keyboard: Esc to exit focus, Tab/Shift+Tab to cycle neighbours.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && selected) {
        e.preventDefault();
        applySelection(null);
      } else if (selected && (e.key === 'Tab' || (e.shiftKey && e.key === 'Tab'))) {
        const nb = collectNeighbours(selected, adj);
        const peers = Array.from(nb.nodes).filter((id) => id !== selected);
        if (!peers.length) return;
        e.preventDefault();
        const i = peers.indexOf(selected);
        const next = peers[(i + (e.shiftKey ? -1 : 1) + peers.length) % peers.length];
        applySelection(next);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, adj]);

  function applySelection(id) {
    setSelected(id);
    if (id) scrollNodeIntoView(id);
    onFocusChange?.(id);
  }

  // Bring a node into the viewport of the scroll container (respecting zoom).
  function scrollNodeIntoView(id) {
    const n = nodes.find((x) => x.id === id);
    const box = scrollRef.current;
    if (!n || !box) return;
    const cx = (n.x + NODE_W / 2) * zoom;
    const cy = (n.y + NODE_H / 2) * zoom;
    box.scrollTo({
      left: Math.max(0, cx - box.clientWidth / 2),
      top: Math.max(0, cy - box.clientHeight / 2),
      behavior: 'smooth',
    });
  }

  if (nodes.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
        Nothing to diagram — the parsed application has no forms, reports, pages or workflows.
      </div>
    );
  }

  // Derive current highlight set (focus takes priority over hover).
  const activeId = selected || hover;
  const nb = activeId ? collectNeighbours(activeId, adj) : null;

  const vb = `0 0 ${width} ${height}`;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Legend />
        <div className="flex items-center gap-1">
          {selected && (
            <button
              onClick={() => applySelection(null)}
              className="px-2 py-1 rounded border border-brand-300 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300 dark:border-brand-700 text-xs font-medium hover:bg-brand-100"
              title="Exit focus (Esc)"
            >
              ✕ Clear focus
            </button>
          )}
          <ToolBtn title="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}>−</ToolBtn>
          <span className="text-xs tabular-nums w-10 text-center text-slate-600 dark:text-slate-300">
            {Math.round(zoom * 100)}%
          </span>
          <ToolBtn title="Zoom in" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}>+</ToolBtn>
          <ToolBtn title="Reset" onClick={() => setZoom(1)}>⟳</ToolBtn>
          <ToolBtn
            title="Download SVG"
            onClick={() => downloadSvg(svgRef.current, 'ds-flowchart.svg')}
          >
            <Icon.Download size={14} />
          </ToolBtn>
        </div>
      </div>

      {/* Canvas + overlay */}
      <div className="relative border rounded-lg bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800">
        <div
          ref={scrollRef}
          className="overflow-auto rounded-lg"
          style={{ maxHeight: 640 }}
          onClick={(e) => {
            // Click on empty canvas clears focus.
            if (e.target === e.currentTarget.firstChild || e.target.tagName === 'svg') {
              if (selected) applySelection(null);
            }
          }}
        >
          <div style={{ width: width * zoom, height: height * zoom }}>
            <svg
              ref={svgRef}
              viewBox={vb}
              width={width * zoom}
              height={height * zoom}
              xmlns="http://www.w3.org/2000/svg"
              className="block"
              onMouseDown={(e) => (pressPos.current = { x: e.clientX, y: e.clientY })}
              onClick={(e) => {
                // Clicks directly on <svg> background (not a node group) clear focus.
                if (e.target === svgRef.current && selected) applySelection(null);
              }}
            >
              <defs>
                <marker id="fc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" />
                </marker>
                <marker id="fc-arrow-in" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={INCOMING} />
                </marker>
                <marker id="fc-arrow-out" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={OUTGOING} />
                </marker>
                <marker id="fc-arrow-self" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={SELF_LOOP} />
                </marker>
              </defs>

              {/* Column headers */}
              {Object.entries(COL_X).map(([k, x]) => (
                <text
                  key={k}
                  x={x + NODE_W / 2}
                  y={22}
                  textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-400"
                  style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1 }}
                >
                  {COL_LABELS[k].toUpperCase()}
                </text>
              ))}

              {/* Edges first so nodes paint on top */}
              {edges.map((e) => {
                const a = nodes.find((n) => n.id === e.from);
                const b = nodes.find((n) => n.id === e.to);
                if (!a || !b) return null;
                const id = edgeId(e);
                const isHot = nb && nb.edges.has(id);
                const dim = nb && !isHot;
                // Direction relative to the active node (for colour).
                let dir = null;
                if (activeId && isHot) {
                  if (e.from === activeId && e.to === activeId) dir = 'self';
                  else if (e.to === activeId) dir = 'in';
                  else if (e.from === activeId) dir = 'out';
                  else dir = 'peer'; // neighbour-to-neighbour (rare, kept neutral)
                }
                return (
                  <EdgePath
                    key={id}
                    from={a}
                    to={b}
                    kind={e.kind}
                    resolved={e.resolved !== false}
                    isHot={isHot}
                    dim={dim}
                    focusDir={dir}
                  />
                );
              })}

              {/* Nodes */}
              {nodes.map((n) => {
                const isHot = nb && nb.nodes.has(n.id);
                const dim = nb && !isHot;
                const isSelected = selected === n.id;
                return (
                  <Node
                    key={n.id}
                    node={n}
                    isHot={isHot}
                    dim={dim}
                    isSelected={isSelected}
                    onEnter={() => setHover(n.id)}
                    onLeave={() => setHover(null)}
                    onActivate={(ev) => {
                      // Ignore click if this was really a drag.
                      const p = pressPos.current;
                      if (p && (Math.abs(ev.clientX - p.x) > 4 || Math.abs(ev.clientY - p.y) > 4)) return;
                      applySelection(isSelected ? null : n.id);
                    }}
                  />
                );
              })}
            </svg>
          </div>
        </div>

        {/* Connections panel (floats over the canvas, top-right) */}
        {selected && nb && (
          <ConnectionsCard
            selectedId={selected}
            neighbourhood={nb}
            onJump={(peerId) => applySelection(peerId)}
            onClose={() => applySelection(null)}
          />
        )}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {selected
          ? 'Focus mode · Esc to exit · Tab to cycle peers'
          : `Click a node to focus its connections · Hover to preview · ${nodes.length} nodes · ${edges.length} edges`}
      </p>
    </div>
  );
}

/* ───── Connections card ────────────────────────────────────────────────── */
function ConnectionsCard({ selectedId, neighbourhood, onJump, onClose }) {
  const { type, name } = splitId(selectedId);
  const { incoming, outgoing, selfLoops } = neighbourhood;
  const tone = TONES[type] || TONES.function;

  return (
    <div
      className="absolute top-3 right-3 w-80 max-w-[90%] max-h-[560px] overflow-auto rounded-lg border shadow-lg bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
      role="dialog"
      aria-label={`Connections for ${type} ${name}`}
    >
      <div
        className="px-3 py-2 flex items-start justify-between gap-2 border-b border-slate-200 dark:border-slate-700"
        style={{ background: tone.fill, color: tone.text }}
      >
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: tone.stroke }}>
            {type}
          </div>
          <div className="font-semibold truncate">{name}</div>
          <div className="text-xs opacity-80 mt-0.5">
            {incoming.length} in · {outgoing.length} out
            {selfLoops.length ? ` · ${selfLoops.length} self` : ''}
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 text-sm opacity-60 hover:opacity-100"
          title="Close (Esc)"
          aria-label="Close connections panel"
        >
          ✕
        </button>
      </div>

      <div className="p-2 space-y-3">
        <EdgeGroup
          title="Incoming"
          subtitle="points at this node"
          colour={INCOMING}
          edges={incoming}
          peerSide="from"
          onJump={onJump}
        />
        <EdgeGroup
          title="Outgoing"
          subtitle="this node points at"
          colour={OUTGOING}
          edges={outgoing}
          peerSide="to"
          onJump={onJump}
        />
        {selfLoops.length > 0 && (
          <EdgeGroup
            title="Self-reference"
            subtitle="self-loop"
            colour={SELF_LOOP}
            edges={selfLoops}
            peerSide="to"
            onJump={onJump}
          />
        )}
        {incoming.length === 0 && outgoing.length === 0 && selfLoops.length === 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400 px-2 py-3 text-center">
            No connections detected for this node.
          </p>
        )}
      </div>
    </div>
  );
}

function EdgeGroup({ title, subtitle, colour, edges, peerSide, onJump }) {
  if (!edges.length) return null;
  return (
    <div>
      <div className="flex items-center gap-2 px-2 mb-1">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: colour }} />
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{title}</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">· {edges.length} · {subtitle}</span>
      </div>
      <ul className="space-y-1">
        {edges.map((e) => {
          const peerId = e[peerSide];
          const { type, name } = splitId(peerId);
          const t = TONES[type] || TONES.function;
          return (
            <li key={edgeId(e)}>
              <button
                onClick={() => onJump(peerId)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-2 text-xs"
              >
                <span
                  className="uppercase font-semibold tracking-wide shrink-0"
                  style={{ color: t.stroke, fontSize: 9 }}
                >
                  {type}
                </span>
                <span className="truncate font-medium text-slate-800 dark:text-slate-100">{name}</span>
                <span className="ml-auto shrink-0 chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 text-[10px]">
                  {e.kind}
                  {e.via ? `: ${e.via}` : ''}
                  {e.event ? ` · ${e.event}` : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ───── small UI bits ───────────────────────────────────────────────────── */
function ToolBtn({ children, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
    >
      {children}
    </button>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(COL_LABELS).map(([k, label]) => (
        <span
          key={k}
          className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border"
          style={{ borderColor: TONES[k].stroke, color: TONES[k].text, background: TONES[k].fill }}
        >
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: TONES[k].stroke }} />
          {label}
        </span>
      ))}
    </div>
  );
}

/* ───── node ────────────────────────────────────────────────────────────── */
function Node({ node, isHot, dim, isSelected, onEnter, onLeave, onActivate }) {
  const t = TONES[node.kind] || TONES.function;
  const opacity = dim ? 0.15 : 1;
  const ring = isSelected ? 3 : isHot ? 2.2 : 1.4;
  const ringColour = isSelected ? '#1d4ed8' : isHot ? '#2563eb' : t.stroke;

  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      opacity={opacity}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onActivate}
      style={{ cursor: 'pointer' }}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${node.kind} ${node.label}`}
    >
      {isSelected && (
        <rect
          x={-3}
          y={-3}
          width={NODE_W + 6}
          height={NODE_H + 6}
          rx={10}
          ry={10}
          fill="none"
          stroke={ringColour}
          strokeWidth={1.2}
          strokeOpacity={0.35}
        />
      )}
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={8}
        ry={8}
        fill={t.fill}
        stroke={ringColour}
        strokeWidth={ring}
        style={isSelected ? { filter: 'drop-shadow(0 2px 4px rgba(37,99,235,0.35))' } : undefined}
      />
      <text x={12} y={18} style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, fill: t.stroke }}>
        {node.kind.toUpperCase()}
      </text>
      <text x={12} y={34} style={{ fontSize: 12, fontWeight: 600, fill: t.text }}>
        {truncate(node.label, 22)}
      </text>
      {node.sub && (
        <text x={NODE_W - 10} y={18} textAnchor="end" style={{ fontSize: 10, fill: '#64748b' }}>
          {node.sub}
        </text>
      )}
      <title>
        {node.kind}: {node.label}
        {node.sub ? ` · ${node.sub}` : ''}
      </title>
    </g>
  );
}

/* ───── edge ────────────────────────────────────────────────────────────── */
function EdgePath({ from, to, kind, resolved, isHot, dim, focusDir }) {
  // Source: right-middle of `from`. Target: left-middle of `to`.
  const sx = from.x + NODE_W;
  const sy = from.y + NODE_H / 2;
  const tx = to.x;
  const ty = to.y + NODE_H / 2;
  const dx = Math.max(40, Math.abs(tx - sx) * 0.5);
  const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;

  let stroke = resolved ? '#94a3b8' : '#f59e0b';
  let marker = 'url(#fc-arrow)';
  if (isHot) {
    if (focusDir === 'in') { stroke = INCOMING; marker = 'url(#fc-arrow-in)'; }
    else if (focusDir === 'out') { stroke = OUTGOING; marker = 'url(#fc-arrow-out)'; }
    else if (focusDir === 'self') { stroke = SELF_LOOP; marker = 'url(#fc-arrow-self)'; }
    else { stroke = INCOMING; marker = 'url(#fc-arrow-in)'; }
  }
  const strokeWidth = isHot ? 2.4 : 1.3;
  const dash = kind === 'lookup' ? '4 3' : kind === 'attached' ? '1 3' : undefined;
  const opacity = dim ? 0.12 : isHot ? 1 : resolved ? 0.85 : 0.75;

  return (
    <path
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={dash}
      opacity={opacity}
      markerEnd={marker}
      style={isHot ? { pointerEvents: 'none' } : undefined}
    />
  );
}

/* ───── graph builder (pure, deterministic) ─────────────────────────────── */
function buildGraph(scope) {
  const safe = scope || {};
  const forms = safe.forms || [];
  const reports = safe.reports || [];
  const pages = safe.pages || [];
  const workflows = safe.workflows || [];
  const functions = safe.customFunctions || [];

  const cols = {
    page: pages.map((p, i) => ({
      id: `page:${p.name || i}`,
      kind: 'page',
      label: p.name || `Page ${i + 1}`,
      sub: p.section,
    })),
    form: forms.map((f, i) => ({
      id: `form:${f.name || i}`,
      kind: 'form',
      label: f.name || `Form ${i + 1}`,
      sub:
        f.fieldCount != null
          ? `${f.fieldCount}f`
          : f.fields?.length
          ? `${f.fields.length}f`
          : undefined,
    })),
    report: reports.map((r, i) => ({
      id: `report:${r.name || i}`,
      kind: 'report',
      label: r.name || `Report ${i + 1}`,
      sub: r.type,
    })),
    workflow: workflows.map((w, i) => ({
      id: `workflow:${w.name || i}`,
      kind: 'workflow',
      label: w.name || `Workflow ${i + 1}`,
      sub: w.event,
    })),
    function: functions.map((fn, i) => ({
      id: `function:${fn.name || i}`,
      kind: 'function',
      label: fn.name || `Function ${i + 1}`,
      sub: fn.returnType,
    })),
  };

  const TOP = 40;
  const nodes = [];
  Object.entries(cols).forEach(([k, list]) => {
    list.forEach((n, idx) => {
      nodes.push({ ...n, x: COL_X[k], y: TOP + idx * (NODE_H + ROW_GAP) });
    });
  });

  const rels =
    Array.isArray(safe.relationships) && safe.relationships.length
      ? safe.relationships
      : deriveRelationships(safe);

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = rels
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e) => ({ ...e, resolved: e.resolved !== false }));

  const tallest = Math.max(...Object.values(cols).map((l) => l.length), 1);
  const height = TOP + tallest * (NODE_H + ROW_GAP) + 20;
  const width = COL_X.function + NODE_W + 40;

  return { nodes, edges, width, height };
}

/** Backward-compat: derive minimal relationships when server didn't send any. */
function deriveRelationships(s) {
  const out = [];
  (s.forms || []).forEach((f) => {
    (f.fields || []).forEach((fld) => {
      const tgt = fld.lookup?.form || fld.lookup?.targetForm;
      if (tgt) out.push({ from: `form:${f.name}`, to: `form:${tgt}`, kind: 'lookup', via: fld.name });
    });
  });
  (s.reports || []).forEach((r) => {
    if (r.baseForm) out.push({ from: `report:${r.name}`, to: `form:${r.baseForm}`, kind: 'baseForm' });
  });
  (s.pages || []).forEach((p) => {
    (p.embeddedForms || []).forEach((fn) =>
      out.push({ from: `page:${p.name}`, to: `form:${fn}`, kind: 'embedsForm' }),
    );
    (p.embeddedReports || []).forEach((rn) =>
      out.push({ from: `page:${p.name}`, to: `report:${rn}`, kind: 'embedsReport' }),
    );
  });
  (s.workflows || []).forEach((w) => {
    if (w.form) out.push({ from: `workflow:${w.name}`, to: `form:${w.form}`, kind: 'attached', event: w.event });
  });
  return out;
}

/* ───── helpers ─────────────────────────────────────────────────────────── */
function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function downloadSvg(svgEl, fileName) {
  if (!svgEl) return;
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const src = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([src], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
