/**
 * mermaid.js — generate Mermaid syntax (flowchart + ER diagram) from a
 * **Zoho Creator** scope.
 *
 * Node shapes follow Creator vocabulary:
 *   Form         📝   →  rectangle  [..]
 *   Report       📊   →  parallelogram  [/.../]
 *   Page         🖥️   →  hexagon  {{..}}   (sections grouped via subgraph)
 *   Workflow     ⚙️   →  diamond  {..}
 *   Schedule     ⏰   →  stadium  ([..])
 *   Connection   🔌   →  cloud-ish  ((..))
 *
 * Returns plain strings — rendering is delegated to mermaid.js at view time
 * (see `MermaidView.jsx`). Pure / no DOM access here so it remains testable.
 */

/* -------------------------------------------------------------------------- */
/*  Application Flow — Step 1                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Build a `flowchart TD` showing the Creator app's runtime flow:
 *
 *   User → Page → Form/Report
 *   Form  --(on add/edit/delete)--> Workflow
 *   Schedule --runs--> Custom Function
 *   Workflow --calls--> Custom Function --invokes--> Connection
 */
export function buildFlowchart(scope) {
  const {
    forms = [],
    reports = [],
    pages = [],
    workflows = [],
    customFunctions = [],
    connections = [],
    schedules = [],
  } = scope;

  if (!forms.length && !reports.length && !pages.length && !workflows.length) {
    return 'flowchart TD\n  empty["No forms, reports, pages or workflows defined yet"]';
  }

  const lines = ['flowchart TD'];
  lines.push('  user(["👤 User"])');

  /* --- Pages grouped by section --- */
  const pagesBySection = groupBy(pages, (p) => p.section || 'Default');
  for (const [section, items] of Object.entries(pagesBySection)) {
    lines.push(`  subgraph ${safeId('sec_' + section)}["📂 ${esc(section)}"]`);
    for (const p of items) {
      const id = nodeId('page', p.name);
      lines.push(`    ${id}{{"🖥️ ${esc(p.displayName || p.name)}"}}`);
    }
    lines.push('  end');
  }
  for (const p of pages) {
    lines.push(`  user --> ${nodeId('page', p.name)}`);
  }

  /* --- Forms --- */
  for (const f of forms) {
    const id = nodeId('form', f.name);
    lines.push(`  ${id}["📝 ${esc(f.displayName || f.name)}"]`);
    if (!pages.length) lines.push(`  user --> ${id}`);
  }

  /* --- Reports --- */
  for (const r of reports) {
    const id = nodeId('rpt', r.name);
    const label = `${esc(r.displayName || r.name)}${r.type ? ` (${r.type})` : ''}`;
    lines.push(`  ${id}[/"📊 ${label}"/]`);
    if (r.baseForm) {
      const fid = nodeId('form', r.baseForm);
      if (!forms.find((x) => sameName(x.name, r.baseForm))) {
        // base form not declared — emit a stub so the diagram still parses
        lines.push(`  ${fid}["📝 ${esc(r.baseForm)}"]`);
      }
      lines.push(`  ${fid} -.->|listed in| ${id}`);
    }
    if (!pages.length) lines.push(`  user --> ${id}`);
  }

  /* --- Page → embedded form/report links --- */
  for (const p of pages) {
    const pid = nodeId('page', p.name);
    for (const fname of p.embeddedForms || []) {
      lines.push(`  ${pid} --> ${nodeId('form', fname)}`);
    }
    for (const rname of p.embeddedReports || []) {
      lines.push(`  ${pid} --> ${nodeId('rpt', rname)}`);
    }
  }

  /* --- Workflows --- */
  for (const w of workflows) {
    const id = nodeId('wf', w.name);
    lines.push(`  ${id}{"⚙️ ${esc(w.displayName || w.name)}"}`);
    if (w.form) {
      const fid = nodeId('form', w.form);
      if (!forms.find((x) => sameName(x.name, w.form))) {
        lines.push(`  ${fid}["📝 ${esc(w.form)}"]`);
      }
      lines.push(`  ${fid} -->|${esc(w.event || 'event')}| ${id}`);
    } else if (w.scope === 'schedule') {
      // schedule-triggered workflow — the schedule node will link to it
    } else {
      lines.push(`  user --> ${id}`);
    }
  }

  /* --- Schedules --- */
  for (const s of schedules) {
    const id = nodeId('sch', s.name);
    lines.push(`  ${id}(["⏰ ${esc(s.name)} — ${esc(s.frequency || 'cron')}"])`);
    if (s.calls) {
      // schedule calls a custom function (or a workflow named the same)
      const calleeFn = customFunctions.find((f) => sameName(f.name, s.calls));
      const calleeWf = workflows.find((w) => sameName(w.name, s.calls));
      if (calleeFn) lines.push(`  ${id} --> ${nodeId('fn', s.calls)}`);
      else if (calleeWf) lines.push(`  ${id} --> ${nodeId('wf', s.calls)}`);
      else lines.push(`  ${id} --> ${nodeId('fn', s.calls)}`);
    }
  }

  /* --- Custom functions & connections --- */
  for (const fn of customFunctions) {
    const id = nodeId('fn', fn.name);
    // trapezoid-alt: [\"label\"/]  — parallelogram shape, valid Mermaid syntax
    lines.push(`  ${id}[\\"λ ${esc(fn.name)}"/]`);
  }
  for (const c of connections) {
    const id = nodeId('cn', c.service);
    lines.push(`  ${id}(("🔌 ${esc(c.service)}"))`);
  }

  /* --- Class styling --- */
  lines.push('  classDef formNode  fill:#eff6ff,stroke:#2563eb,color:#1e3a8a;');
  lines.push('  classDef rptNode   fill:#ecfdf5,stroke:#059669,color:#064e3b;');
  lines.push('  classDef pageNode  fill:#fef3c7,stroke:#d97706,color:#78350f;');
  lines.push('  classDef wfNode    fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;');
  lines.push('  classDef schNode   fill:#f3e8ff,stroke:#9333ea,color:#581c87;');
  lines.push('  classDef fnNode    fill:#f1f5f9,stroke:#475569,color:#0f172a;');
  lines.push('  classDef cnNode    fill:#cffafe,stroke:#0891b2,color:#164e63;');
  for (const f of forms) lines.push(`  class ${nodeId('form', f.name)} formNode;`);
  for (const r of reports) lines.push(`  class ${nodeId('rpt', r.name)} rptNode;`);
  for (const p of pages) lines.push(`  class ${nodeId('page', p.name)} pageNode;`);
  for (const w of workflows) lines.push(`  class ${nodeId('wf', w.name)} wfNode;`);
  for (const s of schedules) lines.push(`  class ${nodeId('sch', s.name)} schNode;`);
  for (const fn of customFunctions) lines.push(`  class ${nodeId('fn', fn.name)} fnNode;`);
  for (const c of connections) lines.push(`  class ${nodeId('cn', c.service)} cnNode;`);

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/*  Data Model — Step 2                                                        */
/* -------------------------------------------------------------------------- */

/**
 * In Creator there is no separate "entity" table — each `form` IS the entity.
 * The ER diagram therefore lists each form's fields and connects forms via
 * lookup fields (Single Select Lookup, Multi-Select Lookup, Subform).
 */
export function buildErDiagram(scope) {
  const { forms = [], lookups = [] } = scope;
  if (!forms.length) {
    return 'erDiagram\n  EMPTY {\n    string note "No forms defined yet"\n  }';
  }

  const lines = ['erDiagram'];

  for (const f of forms) {
    lines.push(`  ${safeId(f.name)} {`);
    const fields = (f.fields || []).slice(0, 14);
    if (!fields.length) {
      lines.push(`    string id`);
    } else {
      for (const fd of fields) {
        const type = mapErType(fd.type);
        const flags = [];
        if (fd.required) flags.push('"required"');
        if (fd.unique) flags.push('"unique"');
        if (fd.lookup) flags.push(`"lookup:${esc(fd.lookup)}"`);
        const tail = flags.length ? ' ' + flags.join(' ') : '';
        lines.push(`    ${type} ${safeId(fd.name)}${tail}`);
      }
    }
    lines.push('  }');
  }

  for (const lk of lookups) {
    const a = safeId(lk.from);
    const b = safeId(lk.to);
    const sym = lk.kind === 'multi' ? '}o--o{' : lk.kind === 'subform' ? '||--o{' : '}o--||';
    lines.push(`  ${a} ${sym} ${b} : "${esc(lk.field || 'lookup')}"`);
  }

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function nodeId(prefix, name) {
  return `${prefix}_${String(name || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'x'}`;
}

function safeId(name) {
  return String(name || 'X')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^(\d)/, '_$1') || 'X';
}

function esc(s) {
  return String(s || '')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ');
}

function sameName(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function groupBy(arr, fn) {
  return arr.reduce((acc, x) => {
    const k = fn(x);
    (acc[k] ||= []).push(x);
    return acc;
  }, {});
}

function mapErType(t) {
  if (!t) return 'string';
  const v = String(t).toLowerCase();
  if (/(number|decimal|currency|percent|auto)/.test(v)) return 'number';
  if (/(decision|checkbox)/.test(v)) return 'boolean';
  if (/(date|time)/.test(v)) return 'date';
  if (/(lookup|subform)/.test(v)) return 'reference';
  if (/(file|image|audio|video|signature)/.test(v)) return 'binary';
  return 'string';
}
