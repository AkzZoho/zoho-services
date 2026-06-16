/**
 * Unit tests for graph.js — the pure helpers behind the FlowChart focus feature.
 *
 *   node --test client/src/lib/__tests__/graph.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeId, buildAdjacency, collectNeighbours, splitId } from '../graph.js';

/* -------------------------------------------------------------------------- */
test('edgeId: stable, distinct for different via / event', () => {
  const a = edgeId({ from: 'form:A', to: 'form:B', kind: 'lookup', via: 'customer_id' });
  const b = edgeId({ from: 'form:A', to: 'form:B', kind: 'lookup', via: 'other_id' });
  assert.notEqual(a, b);
  const c = edgeId({ from: 'form:A', to: 'form:B', kind: 'lookup', via: 'customer_id' });
  assert.equal(a, c);
});

test('buildAdjacency: collapses duplicate edges', () => {
  const adj = buildAdjacency([
    { from: 'A', to: 'B', kind: 'lookup' },
    { from: 'A', to: 'B', kind: 'lookup' }, // dup
    { from: 'A', to: 'B', kind: 'lookup', via: 'f2' }, // different edgeId
    { from: 'C', to: 'A', kind: 'attached' },
  ]);
  assert.equal(adj.get('A').out.length, 2);   // two unique outgoing
  assert.equal(adj.get('B').in.length, 2);
  assert.equal(adj.get('A').in.length, 1);
  assert.equal(adj.get('C').out.length, 1);
});

test('buildAdjacency: ignores malformed edges', () => {
  const adj = buildAdjacency([null, undefined, { kind: 'foo' }, { from: 'X' }, { to: 'Y' }]);
  assert.equal(adj.size, 0);
});

test('collectNeighbours: classifies in/out/self', () => {
  const edges = [
    { from: 'A', to: 'B', kind: 'k' },
    { from: 'C', to: 'A', kind: 'k' },
    { from: 'A', to: 'A', kind: 'k' },
  ];
  const adj = buildAdjacency(edges);
  const nb = collectNeighbours('A', adj);
  assert.equal(nb.outgoing.length, 1);
  assert.equal(nb.incoming.length, 1);
  assert.equal(nb.selfLoops.length, 1);
  assert.ok(nb.nodes.has('A'));
  assert.ok(nb.nodes.has('B'));
  assert.ok(nb.nodes.has('C'));
});

test('collectNeighbours: unknown id returns empty shape', () => {
  const adj = buildAdjacency([{ from: 'A', to: 'B', kind: 'k' }]);
  const nb = collectNeighbours('Z', adj);
  assert.equal(nb.outgoing.length, 0);
  assert.equal(nb.incoming.length, 0);
  assert.deepEqual(Array.from(nb.nodes), ['Z']);
});

test('splitId: handles names containing colons', () => {
  assert.deepEqual(splitId('form:Leads'), { type: 'form', name: 'Leads' });
  assert.deepEqual(splitId('report:All:Active'), { type: 'report', name: 'All:Active' });
  assert.deepEqual(splitId('no_colon'), { type: '', name: 'no_colon' });
});
