import { useMemo, useRef, useState } from 'react';

/* ============================================================
   SchemaColumnsView
   ============================================================
   An alternative, de-cluttered layout for the Form relationship
   graph: every form is placed in a column based on its depth in
   the lookup/subform dependency DAG, and connections are drawn
   as right-to-left bezier curves between columns.

   Why it exists
   -------------
   The force-directed `GraphCanvas` works well for small apps, but
   large Creator apps (70+ forms, 160+ edges) collapse into an
   illegible blob. A layered column layout:

       Column 0  →  Column 1  →  Column 2  →  Column N
        (roots)      (mid)        (mid)        (leaves)

   makes the flow readable at a glance.

   Interactions
   ------------
     • Hover / click a form  → highlight its 1-hop neighbourhood
                               and dim/blur the rest
     • Scroll inside the     → native scroll (horizontal &
       bounded container        vertical) — no free zoom/pan
   ============================================================ */

/* ─── layout tuning ──────────────────────────────────────── */
const MAX_COLS         = 8;   // visual ceiling; deeper nodes fold into last col
const COL_WIDTH        = 280; // px between column centres
const COL_LEFT_PAD     = 56;
const ROW_HEIGHT       = 74;  // px between rows within a column
const ROW_TOP_PAD      = 72;  // room for column header
const NODE_W           = 200;
const NODE_H           = 48;
const CANVAS_MIN_H     = 560;
const VIEWPORT_HEIGHT  = 640; // fixed height of the scroll container

/* ─── colour tokens (must match SchemaView) ──────────────── */
const EDGE_COLOR_LOOKUP  = '#16a34a';
const EDGE_COLOR_SUBFORM = '#7c3aed';
const FORM_STROKE        = '#16a34a';

/* ─── depth computation ──────────────────────────────────── */

/** Tarjan's SCC — returns [sccId per nodeIndex]. */
function stronglyConnectedComponents(n, outAdj) {
  let index = 0;
  const stack = [];
  const onStack = new Array(n).fill(false);
  const idx = new Array(n).fill(-1);
  const low = new Array(n).fill(0);
  const comp = new Array(n).fill(-1);
  let compId = 0;

  // Iterative Tarjan (avoids stack overflow on big apps)
  function strongconnect(root) {
    const work = [{ v: root, pi: 0 }];
    idx[root] = low[root] = index++;
    stack.push(root);
    onStack[root] = true;
    while (work.length) {
      const frame = work[work.length - 1];
      const v = frame.v;
      const kids = outAdj[v];
      if (frame.pi < kids.length) {
        const w = kids[frame.pi++];
        if (idx[w] === -1) {
          idx[w] = low[w] = index++;
          stack.push(w);
          onStack[w] = true;
          work.push({ v: w, pi: 0 });
        } else if (onStack[w]) {
          low[v] = Math.min(low[v], idx[w]);
        }
      } else {
        if (low[v] === idx[v]) {
          while (stack.length) {
            const w = stack.pop();
            onStack[w] = false;
            comp[w] = compId;
            if (w === v) break;
          }
          compId++;
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1].v;
          low[parent] = Math.min(low[parent], low[v]);
        }
      }
    }
  }

  for (let v = 0; v < n; v++) if (idx[v] === -1) strongconnect(v);
  return comp;
}

/**
 * Compute a column index (0 = leftmost / roots) for every form.
 * Cycles are collapsed per-SCC so the layout is always a DAG.
 */
function computeDepths(nodes, edges) {
  const n = nodes.length;
  if (n === 0) return [];

  const outAdj = Array.from({ length: n }, () => []);
  for (const e of edges) outAdj[e.si].push(e.ti);

  const scc = stronglyConnectedComponents(n, outAdj);
  const C = Math.max(...scc, 0) + 1;
  const sccIn = Array.from({ length: C }, () => new Set());
  for (let v = 0; v < n; v++) {
    for (const w of outAdj[v]) {
      if (scc[v] !== scc[w]) sccIn[scc[w]].add(scc[v]);
    }
  }

  const sccDepth = new Array(C).fill(-1);
  function depthOf(c) {
    if (sccDepth[c] !== -1) return sccDepth[c];
    sccDepth[c] = 0;
    let best = 0;
    for (const p of sccIn[c]) {
      const d = depthOf(p) + 1;
      if (d > best) best = d;
    }
    sccDepth[c] = best;
    return best;
  }
  for (let c = 0; c < C; c++) depthOf(c);

  const depth = new Array(n).fill(0);
  for (let v = 0; v < n; v++) {
    depth[v] = Math.min(sccDepth[scc[v]], MAX_COLS - 1);
  }
  return depth;
}

/** Build columnar layout with (x,y) per node. */
function buildColumnLayout(nodes, edges) {
  const depth = computeDepths(nodes, edges);
  const numCols = Math.min(MAX_COLS, (Math.max(0, ...depth) + 1) || 1);

  const columns = Array.from({ length: numCols }, () => []);
  nodes.forEach((node, i) => columns[depth[i]].push({ idx: i, node }));

  for (const col of columns) {
    col.sort((a, b) => (b.node.degree || 0) - (a.node.degree || 0)
      || a.node.label.localeCompare(b.node.label));
  }

  const positions = new Array(nodes.length);
  let maxRows = 0;
  columns.forEach((col, ci) => {
    maxRows = Math.max(maxRows, col.length);
    col.forEach((entry, ri) => {
      positions[entry.idx] = {
        x: COL_LEFT_PAD + ci * COL_WIDTH,
        y: ROW_TOP_PAD + ri * ROW_HEIGHT,
        col: ci,
        row: ri,
      };
    });
  });

  const width = COL_LEFT_PAD + numCols * COL_WIDTH + 40;
  const height = Math.max(CANVAS_MIN_H, ROW_TOP_PAD + maxRows * ROW_HEIGHT + 40);

  return { columns, positions, numCols, width, height };
}

/* ─── main component ─────────────────────────────────────── */
export default function SchemaColumnsView({ nodes, edges }) {
  const { columns, positions, numCols, width, height } = useMemo(
    () => buildColumnLayout(nodes, edges),
    [nodes, edges]
  );

  const [hoverIdx, setHoverIdx] = useState(null);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const scrollRef = useRef(null);

  /* Neighbour map for highlighting (undirected). */
  const neighbours = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < nodes.length; i++) map.set(i, new Set());
    for (const e of edges) {
      map.get(e.si)?.add(e.ti);
      map.get(e.ti)?.add(e.si);
    }
    return map;
  }, [nodes, edges]);

  const focusIdx = selectedIdx ?? hoverIdx;
  const focusSet = useMemo(() => {
    if (focusIdx == null) return null;
    const s = new Set([focusIdx]);
    for (const n of neighbours.get(focusIdx) || []) s.add(n);
    return s;
  }, [focusIdx, neighbours]);

  // Click on empty scroll area clears selection
  const handleBackgroundClick = (e) => {
    if (e.target.closest('[data-form-node]')) return;
    setSelectedIdx(null);
  };

  if (nodes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
        No forms found to graph.
      </div>
    );
  }

  return (
    <div
      className="relative w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 overflow-hidden"
      style={{ height: VIEWPORT_HEIGHT }}
    >
      {/* Scrollable stage — natural overflow drives scroll bars */}
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-auto"
        onClick={handleBackgroundClick}
      >
        {/* Blur/dim overlay (sticky inside the scroll container so it always
            covers the visible viewport, even when scrolled). */}
        {focusSet && (
          <div
            className="sticky top-0 left-0 z-[1] pointer-events-none bg-white/45 dark:bg-slate-950/45"
            style={{
              width: '100%',
              height: VIEWPORT_HEIGHT,
              marginBottom: -VIEWPORT_HEIGHT, // don't take layout space
              backdropFilter: 'blur(3px)',
              WebkitBackdropFilter: 'blur(3px)',
            }}
          />
        )}

        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block relative z-[2]"
          style={{ display: 'block' }}
        >
          {/* Column backgrounds + headers */}
          {columns.map((col, ci) => {
            const cx = COL_LEFT_PAD + ci * COL_WIDTH;
            return (
              <g key={`col-${ci}`}>
                <rect
                  x={cx - 18}
                  y={18}
                  width={NODE_W + 36}
                  height={height - 36}
                  rx={14}
                  className="fill-white/80 dark:fill-slate-800/30 stroke-slate-200 dark:stroke-slate-700"
                  strokeWidth={1}
                  strokeDasharray="3 6"
                  opacity={0.72}
                />
                <text
                  x={cx + NODE_W / 2}
                  y={40}
                  textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-400"
                  style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.8 }}
                >
                  {labelForColumn(ci, numCols, col.length)}
                </text>
              </g>
            );
          })}

          {/* Arrowhead defs */}
          <defs>
            <marker id="col-arrow-lookup" viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={EDGE_COLOR_LOOKUP} />
            </marker>
            <marker id="col-arrow-subform" viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={EDGE_COLOR_SUBFORM} />
            </marker>
            <marker id="col-arrow-dim" viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#cbd5e1" />
            </marker>
          </defs>

          {/* Edges first (so nodes paint above) */}
          {edges.map((e, ei) => {
            const a = positions[e.si];
            const b = positions[e.ti];
            if (!a || !b) return null;
            const inFocus = !focusSet || (focusSet.has(e.si) && focusSet.has(e.ti));
            const isSubform = e.kinds?.has('subform');
            const color = isSubform ? EDGE_COLOR_SUBFORM : EDGE_COLOR_LOOKUP;

            const fwd = b.x >= a.x;
            const sx = a.x + NODE_W;
            const sy = a.y + NODE_H / 2;
            const tx = b.x;
            const ty = b.y + NODE_H / 2;
            const ctl = Math.max(40, Math.abs(tx - sx) * 0.45);

            let d;
            if (fwd) {
              d = `M ${sx} ${sy} C ${sx + ctl} ${sy}, ${tx - ctl} ${ty}, ${tx} ${ty}`;
            } else {
              const bowY = (sy + ty) / 2 + (sy < ty ? 60 : -60);
              d = `M ${sx} ${sy} C ${sx + 80} ${bowY}, ${tx - 80} ${bowY}, ${tx} ${ty}`;
            }

            return (
              <path
                key={`edge-${ei}`}
                d={d}
                fill="none"
                stroke={inFocus ? color : '#cbd5e1'}
                strokeWidth={inFocus ? (isSubform ? 2.2 : 1.6) : 1}
                strokeOpacity={inFocus ? 0.85 : 0.22}
                markerEnd={`url(#${inFocus ? (isSubform ? 'col-arrow-subform' : 'col-arrow-lookup') : 'col-arrow-dim'})`}
                style={{ pointerEvents: 'none' }}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((n, i) => {
            const p = positions[i];
            if (!p) return null;
            const inFocus = !focusSet || focusSet.has(i);
            const isSelected = selectedIdx === i;
            const isHovered = hoverIdx === i;
            return (
              <g
                key={n.id}
                data-form-node
                transform={`translate(${p.x}, ${p.y})`}
                opacity={inFocus ? 1 : 0.28}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setSelectedIdx((prev) => (prev === i ? null : i));
                }}
                style={{ cursor: 'pointer' }}
              >
                {isSelected && (
                  <rect
                    x={-4} y={-4}
                    width={NODE_W + 8} height={NODE_H + 8}
                    rx={10}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    strokeOpacity={0.7}
                  />
                )}
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  className="fill-emerald-50 dark:fill-emerald-950/40"
                  stroke={FORM_STROKE}
                  strokeWidth={isHovered || isSelected ? 2.2 : 1.4}
                />
                <text
                  x={10} y={17}
                  style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, fill: FORM_STROKE }}
                >
                  FORM
                </text>
                <text
                  x={10} y={32}
                  className="fill-slate-800 dark:fill-slate-100"
                  style={{ fontSize: 12, fontWeight: 600 }}
                >
                  {truncate(n.label, 22)}
                </text>
                {n.degree > 0 && (
                  <g transform={`translate(${NODE_W - 18}, 4)`}>
                    <circle r={9} cx={8} cy={8} fill="#15803d" />
                    <text
                      x={8} y={8}
                      textAnchor="middle"
                      dominantBaseline="central"
                      style={{ fontSize: 10, fontWeight: 700, fill: '#fff' }}
                    >
                      {n.degree}
                    </text>
                  </g>
                )}
                <title>
                  {n.label} — {n.weight || 0} field{n.weight === 1 ? '' : 's'}
                  {n.degree ? ` · ${n.degree} connection${n.degree === 1 ? '' : 's'}` : ''}
                </title>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend — sits above the scroll layer */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 text-[10px] text-slate-600 dark:text-slate-300 select-none bg-white/85 dark:bg-slate-900/85 backdrop-blur-sm border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1.5 z-10 pointer-events-none">
        <div className="font-semibold text-slate-500 dark:text-slate-400 uppercase text-[9px] tracking-wider mb-0.5">
          Columns = dependency depth
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm border-2" style={{ borderColor: FORM_STROKE, background: 'transparent' }} />
          Form
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-[2px] rounded" style={{ background: EDGE_COLOR_LOOKUP }} />
          Lookup (picklist / list)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-[3px] rounded" style={{ background: EDGE_COLOR_SUBFORM }} />
          Subform (grid)
        </div>
      </div>

      <div className="absolute top-3 left-3 text-[10px] text-slate-500 dark:text-slate-400 pointer-events-none select-none bg-white/75 dark:bg-slate-900/75 backdrop-blur-sm px-2 py-1 rounded z-10">
        Scroll to navigate · Click a form to highlight its connections
      </div>
    </div>
  );
}

/* ─── helpers ─────────────────────────────────────────────── */

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Friendly header for each column:
 *   · 1st col  → "ROOTS"
 *   · last col → "LEAVES"
 *   · middle   → "LEVEL n"
 * "n forms" is always appended.
 */
function labelForColumn(i, total, count) {
  let prefix;
  if (total === 1) prefix = 'FORMS';
  else if (i === 0) prefix = 'ROOTS';
  else if (i === total - 1) prefix = 'LEAVES';
  else prefix = `LEVEL ${i}`;
  return `${prefix} · ${count}`;
}
