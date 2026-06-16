import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/Icons.jsx';
import SchemaColumnsView from './SchemaColumnsView.jsx';

/* ============================================================
   SchemaView — Form relationship graph
   ============================================================
   Shows how the Forms of the Creator application are linked via
   lookup fields. Reports, Pages, Workflows and Fields are
   intentionally omitted — the Application breakdown tab already
   surfaces those, and keeping this canvas focused on forms makes
   the business-domain model readable at a glance.

       • Green circles = Forms (radius scales with field count)
       • Green arrows  = Lookup relationships (A → B means form A
                         has a lookup field targeting form B)

   Interaction:
       • Drag a node to pin it
       • Click a node to highlight its neighbourhood (form + every
         other form it looks up to or is looked up from)
       • Scroll to zoom · drag empty canvas to pan
       • "Connections" toggle switches to a tabular edge list
   ============================================================ */

/* ─── lookup → target form name ──────────────────────────── */
function normaliseLookup(lk) {
  if (!lk) return null;
  if (typeof lk === 'string') {
    // The parser stores lookups as "Form.Field" strings; keep only the form.
    const s = lk.trim();
    if (!s) return null;
    return s.split('.')[0] || null;
  }
  if (typeof lk === 'object') return lk.form || lk.target || lk.formName || null;
  return String(lk);
}

/* ─── field-type → relation kind ──────────────────────────
 * In Creator `.ds`, cross-form references are declared by pairing a
 * `values = OtherForm.Field` attribute with a particular `type`:
 *   • type = picklist   → Single-Select Lookup
 *   • type = list       → Multi-Select Lookup
 *   • type = grid       → Subform (embedded child form)
 * A generic edge without a type distinction obscures these very
 * different relationships, so we tag every edge with its kind. */
function classifyFieldRelation(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'grid') return 'subform';
  if (t === 'picklist' || t === 'list') return 'lookup';
  // Fallback — still a cross-form reference, just unknown shape.
  return 'lookup';
}

/* ─── helpers ────────────────────────────────────────────── */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/* ─── physics constants ─────────────────────────────────── */
const REPEL_STRENGTH   = 22_000;
const LINK_STRENGTH    = 0.045;
const CENTER_PULL      = 0.010;
const DAMPING          = 0.82;
const MIN_DIST         = 8;
// Hard safety cap so the simulation *always* terminates even if it never
// settles (e.g. a super-dense graph that oscillates against canvas
// boundaries). Without this, large apps like EHS/EQS (58 forms, 266 lookup
// edges) keep requestAnimationFrame spinning forever, pegging a CPU core
// and making the whole tab janky.
const MAX_TICKS        = 600;
// Velocity clamp — prevents the repulsion force from launching a node
// across the canvas when two nodes end up near-identical positions.
// Without this, clamp() on node.x/y feeds back into repulsion → oscillation.
const MAX_VELOCITY     = 40;

const FORM_RADIUS_BASE = 28;
const FORM_RADIUS_MAX  = 56;

/* ─── colour tokens ──────────────────────────────────────── */
const BG_LIGHT   = '#f8fafc';
const BG_DARK    = '#0f172a';
const TEXT_LIGHT = '#1e293b';
const TEXT_DARK  = '#f1f5f9';

const FORM_STYLE = {
  fillLight:  '#f0fdf4',
  fillDark:   '#052e16',
  stroke:     '#16a34a',
  badgeLight: '#15803d',
  badgeDark:  '#166534',
};

/* Edge palette — each relation kind gets its own colour so users can tell
 * lookups apart from subforms at a glance. Both use solid lines; subforms
 * are drawn slightly thicker to hint at the stronger "embeds" semantics. */
const EDGE_COLOR_LOOKUP  = '#16a34a'; // emerald — Lookup (picklist/list)
const EDGE_COLOR_SUBFORM = '#7c3aed'; // violet  — Subform (grid)
const HOVER_RING = '#fbbf24';

/** Resolve the edge's dominant colour / label from its field-kind set. */
function edgeKindInfo(edge) {
  const kinds = edge.kinds || new Set(['lookup']);
  const hasSubform = kinds.has('subform');
  const hasLookup = kinds.has('lookup');
  if (hasSubform && hasLookup) {
    return { color: EDGE_COLOR_SUBFORM, label: 'lookup + subform', mixed: true };
  }
  if (hasSubform) return { color: EDGE_COLOR_SUBFORM, label: 'subform', mixed: false };
  return { color: EDGE_COLOR_LOOKUP, label: 'lookup', mixed: false };
}

/* ============================================================
   Build graph data — forms as nodes, lookups as directed edges.
   Parallel edges (two fields on the same form pointing to the
   same target) are collapsed into one visual edge with a list of
   field names, keeping the canvas readable.
   ============================================================ */
function buildGraph(scope) {
  const forms = scope?.forms || [];
  const nodes = [];
  const indexByName = new Map();

  forms.forEach((f) => {
    const idx = nodes.length;
    nodes.push({
      id: `form:${f.name}`,
      name: f.name,
      label: f.displayName || f.name,
      weight: f.fields?.length || 0,
      x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null,
    });
    indexByName.set(f.name, idx);
  });

  /* Collapse parallel edges: key = "si->ti" — but keep a per-field record of
   * the relation kind so we can colour the aggregated edge correctly. */
  const edgeMap = new Map();
  for (const f of forms) {
    const si = indexByName.get(f.name);
    if (si == null) continue;
    for (const fd of f.fields || []) {
      const target = normaliseLookup(fd.lookup);
      if (!target) continue;
      const ti = indexByName.get(target);
      if (ti == null || ti === si) continue;
      const kind = classifyFieldRelation(fd.type);
      const key = `${si}->${ti}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { si, ti, fields: [], kinds: new Set() });
      }
      const rec = edgeMap.get(key);
      rec.fields.push({ name: fd.displayName || fd.name, kind });
      rec.kinds.add(kind);
    }
  }
  const edges = Array.from(edgeMap.values());

  /* Normalise form radius by field count (min 28px, max 56px) */
  const maxFields = forms.reduce((m, f) => Math.max(m, f.fields?.length || 0), 1);
  for (const n of nodes) {
    n.radius = FORM_RADIUS_BASE
      + (FORM_RADIUS_MAX - FORM_RADIUS_BASE) * Math.sqrt(n.weight / maxFields);
  }

  /* Degree (in + out) for the sidebar badge */
  const degree = nodes.map(() => 0);
  for (const e of edges) { degree[e.si]++; degree[e.ti]++; }
  nodes.forEach((n, i) => { n.degree = degree[i]; });

  return { nodes, edges };
}

/* ============================================================
   Main export
   ============================================================ */
export default function SchemaView({ data }) {
  // 'columns' | 'graph' | 'table'. We default to the columns layout because
  // the force-directed graph becomes illegible on large Creator apps (e.g.
  // 70+ forms, 140+ lookups). Users can still flip to the free-form graph
  // for small apps where the spring layout looks better.
  const [viewMode, setViewMode] = useState('columns');

  const scope = useMemo(() => {
    if (!data) return null;
    return data.technicalScope || { forms: data.forms || [] };
  }, [data]);

  const { nodes, edges } = useMemo(
    () => (scope ? buildGraph(scope) : { nodes: [], edges: [] }),
    [scope]
  );

  if (!data || !data.ok || !scope) return null;

  // Split field-level counts by relation kind so users can see at a glance
  // how many of the connections are Lookups vs Subforms.
  let totalLookups = 0;
  let totalSubforms = 0;
  for (const e of edges) {
    for (const f of e.fields) {
      if (f.kind === 'subform') totalSubforms++;
      else totalLookups++;
    }
  }
  const connectedForms = new Set();
  for (const e of edges) {
    connectedForms.add(e.si);
    connectedForms.add(e.ti);
  }
  const isolatedForms = nodes.length - connectedForms.size;

  return (
    <section className="card p-6 space-y-4" data-schema-view>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300 flex items-center gap-2">
            <Icon.FileCode size={14} /> Application Schema
          </div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-1">
            Form relationship graph
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Forms grouped into columns by dependency depth · Arrows show lookup / subform relationships (A → B means a field on A points at B)
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded border border-slate-200 dark:border-slate-700 overflow-hidden text-xs font-medium">
            {[
              { k: 'columns', label: 'Columns', title: 'Layered column layout — best for large apps' },
              { k: 'graph',   label: 'Graph',   title: 'Force-directed layout — best for small apps' },
              { k: 'table',   label: 'Connections', title: 'Flat table of every relationship' },
            ].map(({ k, label, title }, i) => (
              <button
                key={k}
                title={title}
                onClick={() => setViewMode(k)}
                className={`px-3 py-1.5 transition ${i > 0 ? 'border-l border-slate-200 dark:border-slate-700' : ''} ${
                  viewMode === k
                    ? 'bg-brand-600 text-white'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI strip — breaks out Lookups vs Subforms so the two
           relationship types can be compared at a glance. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Forms"     value={nodes.length} tone="emerald" />
        <Kpi
          label="Lookups"
          value={totalLookups}
          tone="emerald"
          hint={`picklist / list fields referencing another form`}
        />
        <Kpi
          label="Subforms"
          value={totalSubforms}
          tone="purple"
          hint={`grid fields embedding a child form`}
        />
        <Kpi label="Connected forms" value={connectedForms.size}
             hint={connectedForms.size === nodes.length && nodes.length > 0
               ? 'all forms linked'
               : `${connectedForms.size}/${nodes.length}`} />
        <Kpi label="Isolated"  value={isolatedForms}
             tone={isolatedForms > 0 ? 'amber' : undefined}
             hint={isolatedForms > 0 ? 'no lookup in or out' : 'none'} />
      </div>

      {viewMode === 'columns' && (
        <SchemaColumnsView nodes={nodes} edges={edges} />
      )}
      {viewMode === 'graph' && (
        <GraphCanvas nodes={nodes} edges={edges} />
      )}
      {viewMode === 'table' && (
        <ConnectionsTable nodes={nodes} edges={edges} />
      )}

      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        {nodes.length} form(s) · {edges.length} edge(s) ·{' '}
        {totalLookups} lookup{totalLookups === 1 ? '' : 's'} ·{' '}
        {totalSubforms} subform{totalSubforms === 1 ? '' : 's'} ·{' '}
        {data.app?.version ? <>version <code>{data.app.version}</code></> : 'version —'}
      </p>
    </section>
  );
}

/* ============================================================
   Force-directed graph canvas
   ============================================================ */
function GraphCanvas({ nodes: inputNodes, edges: inputEdges }) {
  const canvasRef = useRef(null);
  const stateRef  = useRef(null);
  const rafRef    = useRef(null);
  const darkRef   = useRef(false);

  /* Track dark-mode class changes on <html> */
  useEffect(() => {
    const obs = new MutationObserver(() => {
      darkRef.current = document.documentElement.classList.contains('dark');
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    darkRef.current = document.documentElement.classList.contains('dark');
    return () => obs.disconnect();
  }, []);

  /* Undirected neighbour map for selection highlighting */
  const neighbours = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < inputNodes.length; i++) map.set(i, new Set());
    for (const e of inputEdges) {
      map.get(e.si)?.add(e.ti);
      map.get(e.ti)?.add(e.si);
    }
    return map;
  }, [inputNodes, inputEdges]);

  /* (Re)initialise simulation state */
  const initState = useCallback((width, height) => {
    const nodes = inputNodes.map((n) => ({ ...n }));
    const edges = inputEdges.map((e) => ({ ...e }));
    const cx = width / 2;
    const cy = height / 2;

    /* Seed nodes on a ring so the layout starts pleasantly spread out
       rather than from the same point (which looks like an explosion). */
    const spread = Math.min(width, height) * 0.32;
    nodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1);
      n.x = cx + Math.cos(angle) * spread;
      n.y = cy + Math.sin(angle) * spread;
    });

    stateRef.current = {
      nodes,
      edges,
      width,
      height,
      hoverId: null,
      selectedId: null,
      dragIdx: null,
      dragOffX: 0,
      dragOffY: 0,
      panX: 0, panY: 0,
      scale: 1,
      isPanning: false,
      panStartX: 0, panStartY: 0,
      panOriginX: 0, panOriginY: 0,
      ticks: 0,
      running: true,
    };
  }, [inputNodes, inputEdges]);

  /* Physics tick
   *
   * Design notes for large graphs (see Creator apps with 50+ forms):
   *   • Forces are scaled by node count so layouts with many forms don't
   *     explode — O(N²) repulsion is fine up to ~200 nodes because each
   *     frame still completes in well under a ms, but we MUST tame the
   *     cumulative force or the nodes will bounce against the canvas
   *     clamp() boundaries forever and never converge.
   *   • We clamp the per-axis velocity. A node that ends up exactly
   *     co-located with another gets a huge repulsion impulse; without
   *     a clamp it would rubber-band against the wall.
   *   • A hard MAX_TICKS ceiling guarantees termination even if the
   *     oscillation tolerance check never fires. This is the actual fix
   *     for the "big ds loops forever" bug reported for EHS/EQS.
   */
  const tick = useCallback(() => {
    const s = stateRef.current;
    if (!s || !s.running) return;
    const { nodes, edges, width, height } = s;
    const cx = width / 2;
    const cy = height / 2;

    // Scale repulsion down when there are many nodes — otherwise cumulative
    // force across N*(N-1)/2 pairs dominates attraction and the layout
    // never settles. Stays at full strength for small graphs (< 20 nodes).
    const repelScale = nodes.length > 20 ? 20 / nodes.length : 1;
    const repelStrength = REPEL_STRENGTH * repelScale;

    /* repulsion */
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x || 0.01;
        const dy = b.y - a.y || 0.01;
        const d2 = Math.max(dist2(a, b), MIN_DIST ** 2);
        const f  = repelStrength / d2;
        const invD = 1 / Math.sqrt(d2);
        const nx = dx * invD, ny = dy * invD;
        if (a.fx === null) { a.vx -= f * nx; a.vy -= f * ny; }
        if (b.fx === null) { b.vx += f * nx; b.vy += f * ny; }
      }
    }

    /* link attraction */
    for (const e of edges) {
      const a = nodes[e.si], b = nodes[e.ti];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d  = Math.sqrt(dx ** 2 + dy ** 2) || 1;
      const ideal = a.radius + b.radius + 72;
      const delta = (d - ideal) * LINK_STRENGTH;
      const fx = (dx / d) * delta;
      const fy = (dy / d) * delta;
      if (a.fx === null) { a.vx += fx; a.vy += fy; }
      if (b.fx === null) { b.vx -= fx; b.vy -= fy; }
    }

    /* centre pull */
    for (const n of nodes) {
      if (n.fx === null) {
        n.vx += (cx - n.x) * CENTER_PULL;
        n.vy += (cy - n.y) * CENTER_PULL;
      }
    }

    /* integrate + damp (with velocity clamp) */
    for (const n of nodes) {
      if (n.fx !== null) { n.x = n.fx; n.y = n.fy; continue; }
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      // Clamp per-axis velocity to stop runaway impulses from near-overlaps.
      n.vx = clamp(n.vx, -MAX_VELOCITY, MAX_VELOCITY);
      n.vy = clamp(n.vy, -MAX_VELOCITY, MAX_VELOCITY);
      n.x  += n.vx;
      n.y  += n.vy;
      const pad = n.radius + 10;
      n.x = clamp(n.x, pad, width  - pad);
      n.y = clamp(n.y, pad, height - pad);
    }

    s.ticks++;
    const maxV = nodes.reduce((m, n) => Math.max(m, Math.abs(n.vx), Math.abs(n.vy)), 0);
    // Two independent stop conditions — whichever fires first wins:
    //   (a) graph is visually settled      (maxV below epsilon after warm-up)
    //   (b) hard iteration ceiling reached (prevents infinite loops on
    //       pathological graphs that never converge cleanly)
    if ((maxV < 0.15 && s.ticks > 60) || s.ticks >= MAX_TICKS) {
      s.running = false;
    }
  }, []);

  /* Draw one frame */
  const draw = useCallback(() => {
    const s = stateRef.current;
    const canvas = canvasRef.current;
    if (!s || !canvas) return;
    const ctx  = canvas.getContext('2d');
    const dark = darkRef.current;
    const { nodes, edges, hoverId, selectedId, panX, panY, scale, width, height } = s;
    const bg  = dark ? BG_DARK  : BG_LIGHT;
    const txt = dark ? TEXT_DARK : TEXT_LIGHT;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(scale, scale);

    /* Determine which nodes/edges are focused */
    let focusedSet = null;
    if (selectedId) {
      const focusedNodeIdx = nodes.findIndex((n) => n.id === selectedId);
      if (focusedNodeIdx >= 0) {
        focusedSet = new Set([focusedNodeIdx, ...(neighbours.get(focusedNodeIdx) || [])]);
      }
    }

    /* ── edges ── */
    for (const e of edges) {
      const a = nodes[e.si];
      const b = nodes[e.ti];
      const inFocus = !focusedSet || (focusedSet.has(e.si) && focusedSet.has(e.ti));
      const kindInfo = edgeKindInfo(e);
      const edgeColor = kindInfo.color;

      ctx.globalAlpha = inFocus ? 0.75 : 0.12;
      ctx.strokeStyle = edgeColor;
      // Subform edges are a touch thicker to reflect their stronger
      // "embeds" semantics; lookups keep the lighter stroke.
      const extraWeight = e.kinds?.has('subform') ? 0.8 : 0;
      ctx.lineWidth = (inFocus ? 1.8 + extraWeight : 1.1 + extraWeight) / scale;

      /* Curve the edge slightly so bidirectional pairs don't overlap */
      const dx = b.x - a.x, dy = b.y - a.y;
      const d  = Math.sqrt(dx ** 2 + dy ** 2) || 1;
      const nx = -dy / d, ny = dx / d;            // unit normal
      const curve = Math.min(d * 0.12, 26);        // gentle bow
      const mx = (a.x + b.x) / 2 + nx * curve;
      const my = (a.y + b.y) / 2 + ny * curve;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.stroke();

      /* Arrow head just before the target node's boundary */
      /* Tangent of the quadratic at t=1 is 2*(P2 - P1) = 2*(b - m) */
      const tx = b.x - mx;
      const ty = b.y - my;
      const tn = Math.sqrt(tx ** 2 + ty ** 2) || 1;
      const tipX = b.x - (tx / tn) * (b.radius + 2);
      const tipY = b.y - (ty / tn) * (b.radius + 2);
      const ang  = Math.atan2(ty, tx);
      const size = 8 / scale;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(ang - 0.45) * size, tipY - Math.sin(ang - 0.45) * size);
      ctx.lineTo(tipX - Math.cos(ang + 0.45) * size, tipY - Math.sin(ang + 0.45) * size);
      ctx.closePath();
      ctx.fillStyle = edgeColor;
      ctx.fill();

      /* Multi-field count badge at the curve midpoint (only when >1 field
         collapses into this edge — keeps the visual quiet in the common case) */
      if (e.fields.length > 1 && inFocus && scale > 0.5) {
        const badge = `×${e.fields.length}`;
        ctx.font = `600 ${Math.max(9, 10 / scale)}px system-ui, sans-serif`;
        const w = ctx.measureText(badge).width + 8 / scale;
        const h = 13 / scale;
        // Light fill tinted to match the edge colour (dark theme gets a
        // heavier, desaturated version to stay legible against the canvas).
        ctx.fillStyle = dark
          ? (e.kinds?.has('subform') ? '#2e1065' : '#052e16')
          : (e.kinds?.has('subform') ? '#ede9fe' : '#dcfce7');
        roundRect(ctx, mx - w / 2, my - h / 2, w, h, 4 / scale);
        ctx.fill();
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = 1 / scale;
        ctx.stroke();
        ctx.fillStyle = edgeColor;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(badge, mx, my + 0.3);
      }
    }
    ctx.globalAlpha = 1;

    /* ── nodes ── */
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const isHovered  = n.id === hoverId;
      const isSelected = n.id === selectedId;
      const isFocused  = !focusedSet || focusedSet.has(i);

      ctx.globalAlpha = isFocused ? 1 : 0.28;

      if (isHovered || isSelected) {
        ctx.shadowColor = HOVER_RING;
        ctx.shadowBlur  = 18 / scale;
      }

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = dark ? FORM_STYLE.fillDark : FORM_STYLE.fillLight;
      ctx.fill();

      ctx.strokeStyle = isSelected ? HOVER_RING : FORM_STYLE.stroke;
      ctx.lineWidth   = (isSelected ? 2.6 : 1.8) / scale;
      ctx.stroke();

      ctx.shadowBlur  = 0;
      ctx.shadowColor = 'transparent';

      /* Label inside the node (wraps to two lines if needed) */
      const fontSize = clamp(12 / scale, 9, 14);
      ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
      ctx.fillStyle = txt;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const maxW  = n.radius * 1.7;
      const words = n.label.split(/\s+/);
      const lines = [];
      let cur = '';
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (ctx.measureText(test).width > maxW && cur) {
          lines.push(cur); cur = w;
        } else { cur = test; }
      }
      if (cur) lines.push(cur);
      const lineH  = fontSize * 1.25;
      const startY = n.y - ((lines.length - 1) * lineH) / 2;
      lines.forEach((ln, li) => ctx.fillText(ln, n.x, startY + li * lineH));

      /* Degree badge — fan-in + fan-out count, shown top-right of the node */
      if (n.degree > 0) {
        const badge = String(n.degree);
        const bR = Math.max(9, 9 / scale);
        ctx.beginPath();
        ctx.arc(n.x + n.radius - bR * 0.6, n.y - n.radius + bR * 0.6, bR, 0, Math.PI * 2);
        ctx.fillStyle = dark ? FORM_STYLE.badgeDark : FORM_STYLE.badgeLight;
        ctx.fill();
        ctx.font = `bold ${clamp(9 / scale, 7, 11)}px system-ui, sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.fillText(badge, n.x + n.radius - bR * 0.6, n.y - n.radius + bR * 0.6);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }, [neighbours]);

  /* RAF loop
   *
   * Keeps ticking only while the simulation is running. Once the layout
   * settles (or the hard MAX_TICKS cap fires), we draw one final frame and
   * STOP scheduling new frames. Any subsequent user interaction (drag,
   * hover-moves that change selection, resize, new data) calls
   * `ensureRunning()` to resume the loop.
   *
   * This is critical for large apps: without it we'd keep paying the
   * cost of O(N²) repulsion every frame forever, even after the graph
   * is visually stable, pegging a CPU core while the tab is open.
   */
  const loop = useCallback(() => {
    const s = stateRef.current;
    tick();
    draw();
    if (s && s.running) {
      rafRef.current = requestAnimationFrame(loop);
    } else {
      rafRef.current = null;
    }
  }, [tick, draw]);

  /* Kick the simulation back on if it's currently idle. Safe to call from
   * any event handler; a no-op when a frame is already scheduled. */
  const ensureRunning = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    s.running = true;
    s.ticks = 0; // reset the MAX_TICKS budget for this fresh interaction
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(loop);
    }
  }, [loop]);

  /* Coordinate helpers */
  const toWorld = (cx, cy) => {
    const s = stateRef.current;
    if (!s) return { x: cx, y: cy };
    return { x: (cx - s.panX) / s.scale, y: (cy - s.panY) / s.scale };
  };
  const hitNode = (wx, wy) => {
    const s = stateRef.current;
    if (!s) return -1;
    for (let i = s.nodes.length - 1; i >= 0; i--) {
      const n = s.nodes[i];
      if ((wx - n.x) ** 2 + (wy - n.y) ** 2 <= n.radius ** 2) return i;
    }
    return -1;
  };

  /* Mouse events */
  const onMouseMove = useCallback((e) => {
    const s = stateRef.current;
    if (!s) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    if (s.dragIdx !== null) {
      const { x: wx, y: wy } = toWorld(cx, cy);
      s.nodes[s.dragIdx].fx = wx - s.dragOffX;
      s.nodes[s.dragIdx].fy = wy - s.dragOffY;
      ensureRunning();
    } else if (s.isPanning) {
      s.panX = s.panOriginX + (cx - s.panStartX);
      s.panY = s.panOriginY + (cy - s.panStartY);
    } else {
      const { x: wx, y: wy } = toWorld(cx, cy);
      const idx = hitNode(wx, wy);
      const prev = s.hoverId;
      s.hoverId = idx >= 0 ? s.nodes[idx].id : null;
      canvasRef.current.style.cursor = idx >= 0 ? 'grab' : 'default';
      if (prev !== s.hoverId) draw();
    }
  }, [draw, ensureRunning]);

  const onMouseDown = useCallback((e) => {
    const s = stateRef.current;
    if (!s) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const { x: wx, y: wy } = toWorld(cx, cy);
    const idx = hitNode(wx, wy);

    if (idx >= 0) {
      s.dragIdx = idx;
      s.dragOffX = wx - s.nodes[idx].x;
      s.dragOffY = wy - s.nodes[idx].y;
      s.nodes[idx].fx = s.nodes[idx].x;
      s.nodes[idx].fy = s.nodes[idx].y;
      canvasRef.current.style.cursor = 'grabbing';
    } else {
      s.isPanning = true;
      s.panStartX = cx;
      s.panStartY = cy;
      s.panOriginX = s.panX;
      s.panOriginY = s.panY;
      canvasRef.current.style.cursor = 'move';
      if (s.selectedId) {
        s.selectedId = null;
        draw();
      }
    }
    e.preventDefault();
  }, [draw]);

  const onMouseUp = useCallback((e) => {
    const s = stateRef.current;
    if (!s) return;

    if (s.dragIdx !== null) {
      const rect = canvasRef.current.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const { x: wx, y: wy } = toWorld(cx, cy);
      const idx = s.dragIdx;
      const n = s.nodes[idx];
      const moved = Math.abs(wx - s.dragOffX - n.fx) + Math.abs(wy - s.dragOffY - n.fy);
      n.fx = null; n.fy = null;

      /* A "click" (no meaningful movement) toggles selection rather than pinning */
      if (moved < 5) {
        s.selectedId = s.selectedId === n.id ? null : n.id;
        ensureRunning();
        draw();
      }
      s.dragIdx = null;
    }
    s.isPanning = false;
    canvasRef.current.style.cursor = s.hoverId ? 'grab' : 'default';
  }, [draw, ensureRunning]);

  const onWheel = useCallback((e) => {
    const s = stateRef.current;
    if (!s) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.93;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    s.panX  = cx - (cx - s.panX) * factor;
    s.panY  = cy - (cy - s.panY) * factor;
    s.scale = clamp(s.scale * factor, 0.15, 4);
    draw();
  }, [draw]);

  /* Resize observer — first resize seeds the simulation state */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
        if (!stateRef.current) {
          initState(width, height);
          // First seed — kick the sim on (will auto-stop after MAX_TICKS or
          // once the layout settles).
          ensureRunning();
        } else {
          stateRef.current.width = width;
          stateRef.current.height = height;
          ensureRunning();
        }
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [initState, ensureRunning]);

  /* Start RAF */
  useEffect(() => {
    ensureRunning();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [ensureRunning]);

  /* Re-init when graph data changes (e.g. new upload) */
  useEffect(() => {
    if (!stateRef.current) return;
    const { width, height } = stateRef.current;
    initState(width, height);
    ensureRunning();
  }, [initState, ensureRunning]);

  /* Events */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('mousemove', onMouseMove, { passive: true });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup',   onMouseUp,   { passive: true });
    canvas.addEventListener('wheel',     onWheel,     { passive: false });
    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup',   onMouseUp);
      canvas.removeEventListener('wheel',     onWheel);
    };
  }, [onMouseMove, onMouseDown, onMouseUp, onWheel]);

  /* Overlay: legend */
  const Legend = () => (
    <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 text-[10px] text-slate-600 dark:text-slate-300 pointer-events-none select-none bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1.5">
      <div className="font-semibold text-slate-500 dark:text-slate-400 uppercase text-[9px] tracking-wider mb-0.5">Legend</div>
      <div className="flex items-center gap-1.5">
        <span
          className="w-3 h-3 inline-block rounded-full border-2"
          style={{ borderColor: FORM_STYLE.stroke, background: 'transparent' }}
        />
        Form (size ∝ fields)
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-[2px] rounded" style={{ background: EDGE_COLOR_LOOKUP }} />
        Lookup (picklist / list)
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-[3px] rounded" style={{ background: EDGE_COLOR_SUBFORM }} />
        Subform (grid)
      </div>
      <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
        <span
          className="inline-flex items-center justify-center text-[8px] font-bold text-white rounded-full"
          style={{ width: 12, height: 12, background: FORM_STYLE.badgeLight }}
        >
          n
        </span>
        Relation count
      </div>
    </div>
  );

  /* Overlay: controls */
  const Controls = () => {
    const resetView = () => {
      const s = stateRef.current;
      if (!s) return;
      s.panX = 0; s.panY = 0; s.scale = 1;
      draw();
    };
    const reflow = () => {
      if (!stateRef.current) return;
      const { width, height } = stateRef.current;
      initState(width, height);
    };
    return (
      <div className="absolute top-3 right-3 flex flex-col gap-1.5 pointer-events-auto">
        {[
          { title: 'Reset view', action: resetView, label: '⊡' },
          { title: 'Re-layout',  action: reflow,    label: '↺' },
        ].map(({ title, action, label }) => (
          <button
            key={title}
            title={title}
            onClick={action}
            className="w-7 h-7 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center justify-center"
          >
            {label}
          </button>
        ))}
      </div>
    );
  };

  if (inputNodes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
        No forms found to graph.
      </div>
    );
  }

  return (
    <div
      className="relative w-full rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      style={{ height: 520 }}
    >
      <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />
      <Legend />
      <Controls />
      <div className="absolute top-3 left-3 text-[10px] text-slate-400 dark:text-slate-500 pointer-events-none select-none">
        Scroll to zoom · Drag node to pin · Click node to highlight neighbours
      </div>
    </div>
  );
}

/* Rounded-rectangle path helper used for edge count badges */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
}

/* ============================================================
   Flat table view — one row per (source form → target form) pair,
   with the contributing lookup field names listed in the last col.
   ============================================================ */
function ConnectionsTable({ nodes, edges }) {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('all'); // 'all' | 'lookup' | 'subform'

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return edges
      .map((e) => {
        const s = nodes[e.si], t = nodes[e.ti];
        return {
          id: `${s.id}->${t.id}`,
          src: s,
          dst: t,
          fields: e.fields, // [{ name, kind }]
          kinds: e.kinds,
        };
      })
      .filter((r) => {
        if (kindFilter === 'lookup' && !r.kinds.has('lookup')) return false;
        if (kindFilter === 'subform' && !r.kinds.has('subform')) return false;
        if (!q) return true;
        return (
          r.src.label.toLowerCase().includes(q) ||
          r.dst.label.toLowerCase().includes(q) ||
          r.fields.some((f) => f.name.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => a.src.label.localeCompare(b.src.label));
  }, [nodes, edges, query, kindFilter]);

  if (edges.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
        No lookup or subform relationships detected — the forms are isolated.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${edges.length} relation${edges.length === 1 ? '' : 's'}…`}
          className="flex-1 min-w-[12rem] md:max-w-96 px-3 py-1.5 text-sm rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div className="flex rounded border border-slate-200 dark:border-slate-700 overflow-hidden text-xs font-medium">
          {[
            { k: 'all', label: 'All' },
            { k: 'lookup', label: 'Lookups' },
            { k: 'subform', label: 'Subforms' },
          ].map(({ k, label }) => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className={`px-3 py-1.5 transition border-l border-slate-200 dark:border-slate-700 first:border-l-0 ${
                kindFilter === k
                  ? 'bg-brand-600 text-white'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <th className="py-2 pr-3 font-medium">Source form</th>
              <th className="py-2 pr-3 font-medium">Relationship</th>
              <th className="py-2 pr-3 font-medium">Target form</th>
              <th className="py-2 pr-3 font-medium">Via field(s)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <tr key={r.id} className="text-slate-700 dark:text-slate-200">
                <td className="py-1.5 pr-3"><FormPill node={r.src} /></td>
                <td className="py-1.5 pr-3">
                  <RelationChip kinds={r.kinds} />
                </td>
                <td className="py-1.5 pr-3"><FormPill node={r.dst} /></td>
                <td className="py-1.5 pr-3 text-xs font-mono text-slate-500 dark:text-slate-400">
                  <div className="flex flex-wrap gap-1">
                    {r.fields.map((f, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border"
                        style={{
                          borderColor:
                            f.kind === 'subform' ? EDGE_COLOR_SUBFORM : EDGE_COLOR_LOOKUP,
                          color:
                            f.kind === 'subform' ? EDGE_COLOR_SUBFORM : EDGE_COLOR_LOOKUP,
                          background:
                            (f.kind === 'subform' ? EDGE_COLOR_SUBFORM : EDGE_COLOR_LOOKUP) + '12',
                        }}
                        title={`${f.kind === 'subform' ? 'Subform (grid)' : 'Lookup (picklist / list)'} — ${f.name}`}
                      >
                        {f.name}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                  No matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Compact "→ lookup" / "→ subform" / "→ lookup + subform" chip coloured
 *  by the edge's dominant kind. */
function RelationChip({ kinds }) {
  const hasSubform = kinds?.has('subform');
  const hasLookup = kinds?.has('lookup');
  const color = hasSubform ? EDGE_COLOR_SUBFORM : EDGE_COLOR_LOOKUP;
  const label = hasSubform && hasLookup
    ? '→ lookup + subform'
    : hasSubform
    ? '→ subform'
    : '→ lookup';
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap"
      style={{ borderColor: color, color, background: `${color}15` }}
    >
      {label}
    </span>
  );
}

function FormPill({ node }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border
                 bg-emerald-50 text-emerald-700 border-emerald-200
                 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800/60"
      title={node.id}
    >
      <span className="font-mono text-[10px] opacity-70">Form</span>
      {node.label}
    </span>
  );
}

/* ─── shared KPI tile ─────────────────────────────────────── */
function Kpi({ label, value, hint, tone }) {
  const c =
    tone === 'red'     ? 'text-red-700 dark:text-red-300' :
    tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' :
    tone === 'amber'   ? 'text-amber-700 dark:text-amber-300' :
    tone === 'purple'  ? 'text-purple-700 dark:text-purple-300' :
                         'text-slate-900 dark:text-slate-100';
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 dark:bg-slate-800/40 dark:border-slate-700">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-2xl font-semibold leading-tight ${c}`}>{value}</div>
      {hint && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{hint}</div>}
    </div>
  );
}
