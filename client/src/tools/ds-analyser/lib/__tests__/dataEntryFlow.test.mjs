/**
 * Unit tests for dataEntryFlow.js — Mermaid flowchart source builder.
 *
 *   node --test client/src/lib/__tests__/dataEntryFlow.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDataEntryFlowchart, FLOW_LEGEND } from '../dataEntryFlow.js';

/* -------------------------------------------------------------------------- */

test('buildDataEntryFlowchart: empty scope → placeholder', () => {
  const src = buildDataEntryFlowchart({});
  assert.match(src, /^flowchart TD/);
  assert.match(src, /No forms detected/);
});

test('buildDataEntryFlowchart: single form with implicit Submit event', () => {
  const src = buildDataEntryFlowchart({
    forms: [{ name: 'Customer', displayName: 'Customer' }],
    workflows: [],
    reports: [],
    pages: [],
  });
  assert.match(src, /subgraph SG_s_Customer/);
  assert.match(src, /entry_Customer/);
  assert.match(src, /evt_Customer_Submit/);
});

test('buildDataEntryFlowchart: workflow + report + page downstream links', () => {
  const src = buildDataEntryFlowchart({
    forms: [{ name: 'Lead', actionEvents: ['on add'] }],
    workflows: [
      { name: 'Notify_Sales', form: 'Lead', event: 'on add', actionKinds: ['send_email'] },
    ],
    reports: [{ name: 'All_Leads', baseForm: 'Lead' }],
    pages: [{ name: 'LeadDash', embeddedForms: ['Lead'] }],
  });
  assert.match(src, /wf_Lead_Notify_Sales/);
  assert.match(src, /act_Notify_Sales_send_email_0/);
  assert.match(src, /rpt_Lead_All_Leads/);
  assert.match(src, /pg_Lead_LeadDash/);
  // Downstream consumers should be linked from the entry, not the workflow
  assert.match(src, /entry_Lead -\.->\|stored data\| rpt_Lead_All_Leads/);
  assert.match(src, /entry_Lead -\.->\|embedded in\| pg_Lead_LeadDash/);
});

test('buildDataEntryFlowchart: unique node ids for every form + workflow', () => {
  // A synthetic mid-sized scope — must produce Mermaid source with no
  // duplicate node declarations (duplicates would silently corrupt the
  // rendered SVG or throw a parse error).
  const forms = Array.from({ length: 30 }, (_, i) => ({
    name: `Form${i}`,
    actionEvents: ['on add', 'on edit'],
  }));
  const workflows = forms.flatMap((f, i) => [
    { name: `W_${i}_a`, form: f.name, event: 'on add', actionKinds: ['send_email', 'update_field'] },
    { name: `W_${i}_b`, form: f.name, event: 'on edit', actionKinds: ['call_function'] },
  ]);
  const src = buildDataEntryFlowchart({ forms, workflows, reports: [], pages: [] });

  // Collect every node declaration id (first token before a shape char)
  const declRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[\(\[\{]/gm;
  const seen = new Map(); // id → first-seen line number
  const duplicates = [];
  for (const m of src.matchAll(declRe)) {
    const id = m[1];
    // Skip Mermaid keywords / class modifiers
    if (id === 'subgraph' || id === 'direction' || id === 'class' || id === 'classDef') continue;
    if (seen.has(id)) duplicates.push(id);
    else seen.set(id, m.index);
  }
  assert.deepEqual(duplicates, [], `unexpected duplicate node declarations: ${duplicates.join(', ')}`);
});

test('buildDataEntryFlowchart: terminates + stays bounded on large scopes', () => {
  // Regression guard for the "big ds" scenario — 60 forms × 10 workflows.
  // Prior to the schema-canvas iteration cap the flow physics could spin;
  // the Mermaid builder should at least terminate quickly AND produce a
  // source whose size scales linearly, not quadratically, with the inputs.
  const N = 60;
  const forms = Array.from({ length: N }, (_, i) => ({ name: `F${i}` }));
  const workflows = forms.flatMap((f, i) =>
    Array.from({ length: 10 }, (_, j) => ({
      name: `wf_${i}_${j}`,
      form: f.name,
      event: 'on add',
      actionKinds: ['send_email'],
    })),
  );
  const t0 = Date.now();
  const src = buildDataEntryFlowchart({ forms, workflows, reports: [], pages: [] });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 500, `builder should be fast, took ${elapsed}ms`);
  // Size sanity: one workflow contributes ~4 lines of Mermaid. 600 workflows
  // ⇒ ≤ ~4000 lines. If we ever regress to quadratic, this fails loudly.
  const lines = src.split('\n').length;
  assert.ok(lines < 4000, `unexpected Mermaid source size: ${lines} lines`);
});

test('FLOW_LEGEND is non-empty and every entry has required fields', () => {
  assert.ok(Array.isArray(FLOW_LEGEND));
  assert.ok(FLOW_LEGEND.length > 0);
  for (const item of FLOW_LEGEND) {
    assert.equal(typeof item.cls, 'string');
    assert.equal(typeof item.label, 'string');
    assert.equal(typeof item.swatch, 'string');
  }
});
