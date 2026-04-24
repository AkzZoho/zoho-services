/**
 * dataEntryFlow.js — convert a parsed `.ds` technicalScope into a Mermaid
 * `flowchart TD` source string that visualises the *application's flow
 * driven by data entry*.
 *
 * The chart reads top-down for each form:
 *
 *     [User enters <Form> data]
 *              │
 *              ▼
 *        (Form.Submit)          ← declared form events
 *              │
 *              ▼
 *     [Workflow A triggers]     ← workflows attached to that form
 *              │
 *              ▼
 *     <action kinds…>           ← send_email / update_field / call_function …
 *              │
 *              ▼
 *     [Report: Base(<Form>)]    ← reports built on this form
 *     [Page embeds <Form>]      ← pages that embed this form
 *
 * Pure function, side-effect free, DOM-free — unit-testable.
 *
 *   @param {object} scope  technicalScope from /api/inspect
 *   @returns {string}      Mermaid flowchart source (starts with "flowchart TD")
 */

/** Mermaid-safe node id. Strips everything that isn't alphanumeric/underscore. */
function nid(prefix, name) {
  const safe = String(name || '')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^(\d)/, '_$1'); // ids can't start with digit
  return `${prefix}_${safe || 'x'}`;
}

/** Escape a label for a Mermaid node. Quotes + backticks are the main hazards. */
function lbl(text) {
  return String(text ?? '')
    .replace(/"/g, "'")
    .replace(/\n+/g, ' ')
    .replace(/`/g, "'")
    .slice(0, 80);
}

/**
 * Build a Mermaid `flowchart TD` source for the data-entry flow.
 *
 * Algorithm (deterministic, single pass):
 *   1. Emit one lane per form:
 *        entry  =([User enters <Form> data])
 *        event  ((Form.<evt>))         for each declared actionEvents entry
 *        wf     [<Workflow name>]       for each attached workflow
 *        act    {{<action kind>}}       for each actionKind on that workflow
 *   2. After the workflow lanes, emit downstream consumers:
 *        report [(<Report name>)]       for every report whose baseForm == form.name
 *        page   [/<Page name>/]         for every page that embeds this form
 *   3. Connect lanes strictly top-down so the diagram reads like a user journey.
 *
 * If `scope` is empty / falsy, a single friendly placeholder node is emitted.
 */
export function buildDataEntryFlowchart(scope) {
  const forms = Array.isArray(scope?.forms) ? scope.forms : [];
  const workflows = Array.isArray(scope?.workflows) ? scope.workflows : [];
  const reports = Array.isArray(scope?.reports) ? scope.reports : [];
  const pages = Array.isArray(scope?.pages) ? scope.pages : [];

  const lines = ['flowchart TD'];
  // Shared styling classes — applied per kind so users get a colour legend.
  lines.push(
    '  classDef entry fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a,stroke-width:1px;',
    '  classDef event fill:#fef3c7,stroke:#b45309,color:#7c2d12;',
    '  classDef wf    fill:#fde68a,stroke:#92400e,color:#78350f;',
    '  classDef act   fill:#ecfccb,stroke:#4d7c0f,color:#365314;',
    '  classDef rpt   fill:#ede9fe,stroke:#6d28d9,color:#4c1d95;',
    '  classDef page  fill:#dcfce7,stroke:#15803d,color:#14532d;',
    '  classDef none  fill:#f1f5f9,stroke:#64748b,color:#334155;',
  );

  if (forms.length === 0) {
    lines.push('  empty([No forms detected — nothing to flow]):::none');
    return lines.join('\n');
  }

  // Index: form name → list of attached workflows.
  const wfByForm = new Map();
  for (const w of workflows) {
    if (!w?.form) continue;
    const arr = wfByForm.get(w.form) || [];
    arr.push(w);
    wfByForm.set(w.form, arr);
  }
  // Index: form name → reports based on it.
  const reportsByForm = new Map();
  for (const r of reports) {
    if (!r?.baseForm) continue;
    const arr = reportsByForm.get(r.baseForm) || [];
    arr.push(r);
    reportsByForm.set(r.baseForm, arr);
  }
  // Index: form name → pages embedding it.
  const pagesByForm = new Map();
  for (const p of pages) {
    for (const emb of p?.embeddedForms || []) {
      const arr = pagesByForm.get(emb) || [];
      arr.push(p);
      pagesByForm.set(emb, arr);
    }
  }

  const classed = []; // [{ id, cls }] to emit `class` statements after nodes
  const addClass = (id, cls) => classed.push({ id, cls });

  forms.forEach((form, idx) => {
    const fName = form.displayName || form.name;
    const entryId = nid('entry', form.name);
    lines.push(`  subgraph SG_${nid('s', form.name)} ["${lbl(fName)}"]`);
    lines.push(`    direction TB`);

    // 1. Entry node
    lines.push(`    ${entryId}(["User enters ${lbl(fName)} data"])`);
    addClass(entryId, 'entry');

    // 2. Events on this form
    const events = (form.actionEvents || []).filter(Boolean);
    // Fallback: every form implicitly has a Submit if nothing declared
    const evtList = events.length ? events : ['Submit'];
    const evtIds = evtList.map((evt) => {
      const id = nid(`evt_${form.name}`, evt);
      lines.push(`    ${id}(("${lbl(form.name)}.${lbl(evt)}"))`);
      addClass(id, 'event');
      lines.push(`    ${entryId} --> ${id}`);
      return { evt, id };
    });

    // 3. Workflows attached to this form, grouped by their event
    const attached = wfByForm.get(form.name) || [];
    attached.forEach((w) => {
      const wfId = nid(`wf_${form.name}`, w.name);
      const wLabel = w.displayName || w.name;
      lines.push(`    ${wfId}["${lbl(wLabel)}"]`);
      addClass(wfId, 'wf');
      // Link from the matching event node if we know it, else from every event.
      const link = evtIds.find((e) => e.evt === w.event);
      if (link) {
        lines.push(`    ${link.id} --> ${wfId}`);
      } else if (w.event) {
        // Workflow declares its own event not present in form.actionEvents —
        // add a fresh event node and link it from entry.
        const freshEvtId = nid(`evt_${form.name}`, w.event);
        if (!evtIds.some((e) => e.id === freshEvtId)) {
          lines.push(`    ${freshEvtId}(("${lbl(form.name)}.${lbl(w.event)}"))`);
          addClass(freshEvtId, 'event');
          lines.push(`    ${entryId} --> ${freshEvtId}`);
          evtIds.push({ evt: w.event, id: freshEvtId });
        }
        lines.push(`    ${freshEvtId} --> ${wfId}`);
      } else {
        // Workflow has no event → link from every event to be safe
        evtIds.forEach((e) => lines.push(`    ${e.id} --> ${wfId}`));
      }

      // 4. Action kinds under this workflow
      const kinds = w.actionKinds || [];
      if (kinds.length === 0) {
        const actId = nid(`act_${w.name}`, 'noop');
        lines.push(`    ${actId}{{"(no explicit action)"}}`);
        addClass(actId, 'act');
        lines.push(`    ${wfId} --> ${actId}`);
      } else {
        kinds.forEach((k, ki) => {
          const actId = nid(`act_${w.name}`, `${k}_${ki}`);
          lines.push(`    ${actId}{{"${lbl(k)}"}}`);
          addClass(actId, 'act');
          lines.push(`    ${wfId} --> ${actId}`);
        });
      }
    });

    lines.push('  end');

    // 5. Downstream consumers (outside the form subgraph, shared across lanes)
    const formReports = reportsByForm.get(form.name) || [];
    formReports.forEach((r) => {
      const rid = nid('rpt', `${form.name}_${r.name}`);
      const rlabel = `Report: ${r.displayName || r.name}`;
      lines.push(`  ${rid}[("${lbl(rlabel)}")]`);
      addClass(rid, 'rpt');
      lines.push(`  ${entryId} -.->|stored data| ${rid}`);
    });
    const formPages = pagesByForm.get(form.name) || [];
    formPages.forEach((p) => {
      const pid = nid('pg', `${form.name}_${p.name}`);
      const plabel = `Page: ${p.displayName || p.name}`;
      lines.push(`  ${pid}[/"${lbl(plabel)}"/]`);
      addClass(pid, 'page');
      lines.push(`  ${entryId} -.->|embedded in| ${pid}`);
    });

    // Separator blank line between form lanes for readability of the source
    if (idx < forms.length - 1) lines.push('');
  });

  // Emit class assignments (grouped per class for compactness)
  const byCls = new Map();
  for (const { id, cls } of classed) {
    const arr = byCls.get(cls) || [];
    arr.push(id);
    byCls.set(cls, arr);
  }
  for (const [cls, ids] of byCls) {
    // class statements: `class id1,id2,id3 clsName;`
    // split into chunks of 40 to keep lines reasonable
    for (let i = 0; i < ids.length; i += 40) {
      lines.push(`  class ${ids.slice(i, i + 40).join(',')} ${cls};`);
    }
  }

  return lines.join('\n');
}

/** Human-readable legend used by the UI underneath the chart. */
export const FLOW_LEGEND = [
  { cls: 'entry', label: 'User data entry', swatch: '#dbeafe' },
  { cls: 'event', label: 'Form event', swatch: '#fef3c7' },
  { cls: 'wf', label: 'Workflow', swatch: '#fde68a' },
  { cls: 'act', label: 'Action', swatch: '#ecfccb' },
  { cls: 'rpt', label: 'Report (downstream)', swatch: '#ede9fe' },
  { cls: 'page', label: 'Page (embeds form)', swatch: '#dcfce7' },
];
