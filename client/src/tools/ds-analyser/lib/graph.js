/**
 * graph.js — pure helpers for the FlowChart focus/selection feature.
 *
 * All functions are deterministic and side-effect free so they can be unit-tested
 * without a DOM. An edge is expected to look like:
 *   { from: 'form:Leads', to: 'form:Accounts', kind: 'lookup', via?: string, event?: string, resolved?: boolean }
 */

/** Stable string id for an edge (for dedupe + React keys). */
export function edgeId(e) {
  return `${e.from}→${e.to}|${e.kind}|${e.via || ''}|${e.event || ''}`;
}

/**
 * Build an adjacency index:
 *   Map<nodeId, { in: Edge[], out: Edge[] }>
 * Duplicate edges (same edgeId) are collapsed.
 */
export function buildAdjacency(edges) {
  const adj = new Map();
  const seen = new Set();
  const ensure = (id) => {
    if (!adj.has(id)) adj.set(id, { in: [], out: [] });
    return adj.get(id);
  };

  for (const e of edges || []) {
    if (!e || !e.from || !e.to) continue;
    const id = edgeId(e);
    if (seen.has(id)) continue;
    seen.add(id);
    ensure(e.from).out.push(e);
    ensure(e.to).in.push(e);
  }
  return adj;
}

/**
 * Collect every node + edge directly connected to `id` (1-hop neighbourhood).
 * Self-loops (from === to === id) are included once in both groups but
 * reported as `selfLoops` separately for UI labelling.
 *
 * Returns:
 *   {
 *     nodes: Set<nodeId>,       // includes `id` itself
 *     edges: Set<edgeId>,       // edges incident to `id`
 *     incoming: Edge[],         // edges where .to === id (excluding self-loops)
 *     outgoing: Edge[],         // edges where .from === id (excluding self-loops)
 *     selfLoops: Edge[],        // edges where both ends are id
 *   }
 */
export function collectNeighbours(id, adj) {
  const nodes = new Set([id]);
  const edges = new Set();
  const incoming = [];
  const outgoing = [];
  const selfLoops = [];
  const bucket = adj.get(id);
  if (!bucket) return { nodes, edges, incoming, outgoing, selfLoops };

  for (const e of bucket.out) {
    edges.add(edgeId(e));
    if (e.to === id) selfLoops.push(e);
    else {
      outgoing.push(e);
      nodes.add(e.to);
    }
  }
  for (const e of bucket.in) {
    edges.add(edgeId(e));
    if (e.from === id) {
      // already pushed from `out` loop; skip duplicate
    } else {
      incoming.push(e);
      nodes.add(e.from);
    }
  }
  return { nodes, edges, incoming, outgoing, selfLoops };
}

/** Split an id like 'form:Leads' into { type, name }. Safe for ids containing ':'. */
export function splitId(id) {
  const i = id.indexOf(':');
  if (i < 0) return { type: '', name: id };
  return { type: id.slice(0, i), name: id.slice(i + 1) };
}
