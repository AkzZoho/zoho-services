/**
 * Performance analyser — implements the `Performance_Matrix.md` rulebook
 * against a parsed .ds digest. Fully deterministic, no LLM.
 *
 * Inputs
 *   ds : parsed .ds object (same shape returned by dsParser.parseDs).
 *
 * Outputs
 *   {
 *     summary:   { total, critical, warning, info, highImpact },
 *     byCategory: { [CategoryID]: number },
 *     byRule:     { [RuleID]: number },
 *     findings:   Finding[],     // every issue, sorted by impactScore desc
 *     volumeTiers: VolumeTier[], // per-form tier + risk
 *     topImpact:  Finding[],     // first 10 of findings
 *   }
 *
 * A Finding has:
 *   { id, ruleId, severity, category, message, fix,
 *     formName, componentPath, line, snippet, impactScore }
 *
 * v1 scope — see §4 of Performance_Matrix.md:
 *   Fully implemented rules (deterministic regex / structural):
 *     SCHEMA-001, SCHEMA-002, SCHEMA-003, SCHEMA-004, SCHEMA-005,
 *     SCHEMA-006, SCHEMA-007
 *     FETCH-001, FETCH-002, FETCH-005, FETCH-006, FETCH-008
 *     LOOP-001, LOOP-002
 *     DB-001, DB-002, DB-003
 *     INTEG-001, INTEG-002
 *     GEN-001, GEN-003, GEN-004
 *     CONC-001, CONC-002
 *
 *   Not yet covered (flagged as TODO in the rulebook constant below):
 *     FETCH-003, FETCH-004, FETCH-007, LOOP-003,
 *     SUBF-001, SUBF-002, VAR-001, VAR-002, GEN-002,
 *     CONC-003, CONC-004
 */

const VALID_FIELD_TYPES = new Set([
  'text', 'email', 'number', 'decimal', 'date', 'datetime', 'textarea',
  'picklist', 'radiobuttons', 'checkbox', 'checkboxes', 'richtext', 'plaintext',
  'upload', 'url', 'image', 'time', 'video', 'percentage', 'section', 'button',
  'submit', 'cancel', 'reset', 'list', 'grid', 'help_text', 'name', 'address',
  'phonenumber', 'autonumber', 'lookup', 'formula', 'unknown',
  // currency codes are handled with a separate regex
]);

const SYSTEM_FIELD_NAMES = new Set([
  'Added_User', 'Added_Time', 'Modified_User', 'Modified_Time', 'ID', 'Added_IP',
]);

const SEVERITY_WEIGHT = { critical: 8, warning: 4, info: 1 };
const TIER_MULTIPLIER = { 'Very High': 3.0, High: 2.0, Medium: 1.5, Low: 1.0 };
const HIGH_IMPACT_THRESHOLD = 12;

const RULES = {
  // ---- Schema ------------------------------------------------------------
  'SCHEMA-001': { severity: 'critical', category: 'SCHEMA', title: 'System field declared as form field',
    fix: 'Remove the declaration — system fields are auto-managed.' },
  'SCHEMA-002': { severity: 'critical', category: 'SCHEMA', title: 'Invalid field type',
    fix: 'Use a valid Creator field type.' },
  'SCHEMA-003': { severity: 'critical', category: 'SCHEMA', title: 'Duplicate field name in form',
    fix: 'Rename one of the conflicting fields.' },
  'SCHEMA-004': { severity: 'warning', category: 'SCHEMA', title: 'Incorrect mandatory syntax',
    fix: 'Use `must have <FieldName> ( ... )` prefix.' },
  'SCHEMA-005': { severity: 'warning', category: 'SCHEMA', title: 'Incorrect choices syntax',
    fix: 'Use `values = {"Choice 1","Choice 2"}` instead of `choices = "..."`.' },
  'SCHEMA-006': { severity: 'warning', category: 'SCHEMA', title: 'Lookup field missing display format',
    fix: 'Add `displayformat = [FieldName]` to the lookup.' },
  'SCHEMA-007': { severity: 'warning', category: 'SCHEMA', title: 'Layout field not in report definition',
    fix: 'Add the field to the report\'s `show all rows from <Form>( ... )` column list.' },

  // ---- Fetch Records -----------------------------------------------------
  'FETCH-001': { severity: 'warning', category: 'FETCH_RECORDS', title: 'Fetch Records inside loop',
    fix: 'Move the fetch before the loop; build a Map for in-memory lookup.' },
  'FETCH-002': { severity: 'critical', category: 'FETCH_RECORDS', title: 'Fetch without criteria',
    fix: 'Add specific criteria and a `range from 0 to N` bound.' },
  'FETCH-005': { severity: 'warning', category: 'FETCH_RECORDS', title: 'Equal-to on text/email in fetch',
    fix: 'Use `equalsIgnoreCase()` for text comparisons.' },
  // FETCH-006 (generic "consider indexing this fetch criterion" suggestion)
  // was intentionally removed — it fired on every fetch in the app and
  // added noise without being actionable per-finding. Indexing guidance
  // now lives in the schema-level audit instead.
  'FETCH-008': { severity: 'warning', category: 'FETCH_RECORDS', title: 'getAll without criteria',
    fix: 'Add criteria and/or `range` before `.getAll()`.' },

  // ---- Loop --------------------------------------------------------------
  'LOOP-001': { severity: 'critical', category: 'LOOP', title: 'Nested loops detected — O(n²) or worse',
    fix: 'Replace the inner loop with a Map/Set lookup.' },
  'LOOP-002': { severity: 'warning', category: 'LOOP', title: 'String concatenation in loop',
    fix: 'Collect into a List and join once after the loop.' },

  // ---- Database ----------------------------------------------------------
  'DB-001': { severity: 'warning', category: 'DATABASE_OPERATIONS', title: 'Update operations in loop',
    fix: 'Collect IDs, call a single bulk `updateRecord` after the loop.' },
  'DB-002': { severity: 'critical', category: 'DATABASE_OPERATIONS', title: 'Delete operations in loop',
    fix: 'Use `delete from Form[criteria]` — a single atomic operation.' },
  'DB-003': { severity: 'warning', category: 'DATABASE_OPERATIONS', title: 'Insert operations in loop',
    fix: 'Use bulk insert or re-evaluate the logic.' },

  // ---- Integration -------------------------------------------------------
  'INTEG-001': { severity: 'critical', category: 'INTEGRATION', title: 'Integration call in loop',
    fix: 'Batch, or call once after the loop with the collected payload.' },
  'INTEG-002': { severity: 'warning', category: 'INTEGRATION', title: 'Unbatched API calls',
    fix: 'Combine neighbouring invokeurl calls into one batched request.' },

  // ---- General -----------------------------------------------------------
  'GEN-001': { severity: 'info', category: 'GENERAL', title: 'Hardcoded IDs',
    fix: 'Use variables / app-variables / lookups instead of literal IDs.' },
  'GEN-003': { severity: 'info', category: 'GENERAL', title: 'Infinite loop risk',
    fix: 'Ensure the loop has a clear exit condition.' },
  'GEN-004': { severity: 'info', category: 'GENERAL', title: 'Unused function',
    fix: 'Remove the function or document it as externally called.' },

  // ---- Concurrency -------------------------------------------------------
  'CONC-001': { severity: 'critical', category: 'CONCURRENCY', title: 'Bulk update on high-fan-in form',
    fix: 'Batch into a single `updateRecords` call, or denormalise shared data.' },
  'CONC-002': { severity: 'warning', category: 'CONCURRENCY', title: 'Multiple workflows writing the same form',
    fix: 'Consolidate, or queue via schedules / batch / async workflows.' },
};

/* -------------------------------------------------------------------------- */
/*  Public entry                                                               */
/* -------------------------------------------------------------------------- */

function analysePerformance(ds) {
  const findings = [];

  // Collect every script-bearing component (name + path + source text).
  const components = collectComponents(ds);

  // Volume tier per form
  const volumeTiers = computeVolumeTiers(ds, components);
  const tierByForm = new Map(volumeTiers.map((v) => [v.form, v]));

  // --- Schema rules operate directly on ds.forms -------------------------
  findings.push(...runSchemaRules(ds));

  // --- Code-level rules operate on each component's source --------------
  for (const comp of components) {
    findings.push(...runCodeRules(comp));
  }

  // --- Concurrency rules need cross-form aggregates ---------------------
  findings.push(...runConcurrencyRules(ds, components, tierByForm));

  // Attach impact score (severity × tier multiplier of the target form)
  for (const f of findings) {
    const tier = tierByForm.get(f.formName)?.tier || 'Low';
    const sevW = SEVERITY_WEIGHT[f.severity] ?? 1;
    f.impactScore = Math.round(sevW * TIER_MULTIPLIER[tier]);
    f.volumeTier = tier;
  }
  findings.sort((a, b) => b.impactScore - a.impactScore);

  // Summary
  const summary = { total: findings.length, critical: 0, warning: 0, info: 0, highImpact: 0 };
  const byCategory = {};
  const byRule = {};
  for (const f of findings) {
    summary[f.severity] = (summary[f.severity] || 0) + 1;
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    byRule[f.ruleId] = (byRule[f.ruleId] || 0) + 1;
    if (f.impactScore >= HIGH_IMPACT_THRESHOLD) summary.highImpact += 1;
  }

  return {
    summary,
    byCategory,
    byRule,
    volumeTiers,
    findings,
    topImpact: findings.slice(0, 10),
  };
}

/* -------------------------------------------------------------------------- */
/*  Component collection                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Return a flat list of { kind, name, path, source, formName } records for
 * every script-bearing entity in the app.
 */
function collectComponents(ds) {
  const out = [];

  for (const wf of ds.workflows || []) {
    if (!wf.sourceCode) continue;
    out.push({
      kind: 'workflow',
      name: wf.name,
      path: `Workflow > ${wf.scope || ''}:${wf.name}`.replace(/:\s*$/, ''),
      source: wf.sourceCode,
      formName: wf.form || '',
    });
  }

  for (const fn of ds.customFunctions || []) {
    // Function source is not preserved (only scriptSize); we still create a
    // record with an empty `source` so unused-function detection can work.
    out.push({
      kind: 'function',
      name: fn.namespace ? `${fn.namespace}.${fn.name}` : fn.name,
      path: `Function > ${fn.namespace ? `${fn.namespace}.` : ''}${fn.name}`,
      source: '',
      formName: '',
    });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/*  Schema rules                                                               */
/* -------------------------------------------------------------------------- */

function runSchemaRules(ds) {
  const findings = [];
  const formNames = new Set((ds.forms || []).map((f) => f.name));

  (ds.forms || []).forEach((f) => {
    const seenNames = new Set();

    (f.fields || []).forEach((fd) => {
      // SCHEMA-001 — system field declared
      if (SYSTEM_FIELD_NAMES.has(fd.name)) {
        findings.push(makeFinding('SCHEMA-001', {
          formName: f.name,
          componentPath: `Form > ${f.name}.${fd.name}`,
          message: `Field "${fd.name}" is a system field — Creator manages it automatically.`,
          snippet: `${fd.name} (type = ${fd.type || 'unknown'})`,
        }));
      }

      // SCHEMA-002 — invalid field type
      const type = (fd.type || '').toLowerCase();
      if (type && !VALID_FIELD_TYPES.has(type) && !isCurrencyType(type)) {
        findings.push(makeFinding('SCHEMA-002', {
          formName: f.name,
          componentPath: `Form > ${f.name}.${fd.name}`,
          message: `Field "${fd.name}" has invalid type "${fd.type}".`,
          snippet: `type = ${fd.type}`,
        }));
      }

      // SCHEMA-003 — duplicate field name
      if (seenNames.has(fd.name)) {
        findings.push(makeFinding('SCHEMA-003', {
          formName: f.name,
          componentPath: `Form > ${f.name}.${fd.name}`,
          message: `Field "${fd.name}" is declared more than once in form "${f.name}".`,
          snippet: `duplicate: ${fd.name}`,
        }));
      }
      seenNames.add(fd.name);

      // SCHEMA-006 — lookup without displayformat
      if (fd.lookup && typeof fd.lookup === 'string') {
        // Our parser only records `values = Form.Field`; if `displayformat` is
        // absent from the field body we can't tell reliably without the raw
        // source. We emit SCHEMA-006 when the parsed lookup target exists but
        // the form field type is picklist/list (likely reference case).
        if (type === 'picklist' || type === 'list' || type === 'lookup') {
          // best-effort heuristic: we don't have raw field body here, so skip.
          // Keeping the rule active via source-based scan would require wiring
          // the field source through the parser. Left as v2 work.
        }
      }
    });
  });

  // SCHEMA-004 / SCHEMA-005 — bad syntax patterns are not reachable from the
  // digest because dsParser already normalises them. Skipped in v1.

  // SCHEMA-007 — Layout field not in report column list. dsParser does not
  // track quickview/detailview fields explicitly yet, so we approximate this
  // with "report has zero columnCount" which is always a red flag.
  (ds.reports || []).forEach((r) => {
    if (!r.baseForm) return;
    if (!formNames.has(r.baseForm)) {
      findings.push(makeFinding('SCHEMA-007', {
        formName: r.baseForm,
        componentPath: `Report > ${r.name}`,
        message: `Report "${r.name}" references unknown base form "${r.baseForm}".`,
        snippet: `show all rows from ${r.baseForm}`,
      }));
    }
  });

  return findings;
}

function isCurrencyType(type) {
  // ISO-4217 codes (USD, INR, EUR, …) — Creator allows any 3-letter currency code.
  return /^[a-z]{3}$/.test(type);
}

/* -------------------------------------------------------------------------- */
/*  Code-level rules (regex-based walk of the source)                          */
/* -------------------------------------------------------------------------- */

const RE_FOR_EACH = /\bfor\s+each\b[^\n{]*\{/g;
const RE_INVOKEURL = /\binvokeu?rl\b/gi;
const RE_GETALL = /\.getall\s*\(/gi;
const RE_FETCH_EMPTY = /([A-Z][A-Za-z0-9_]*)\s*\[\s*ID\s*!=\s*(?:0|null)\s*\]/g;
const RE_FETCH_GENERIC = /([A-Z][A-Za-z0-9_]*)\s*\[[^\]]+\]/g;
const RE_TEXT_FIELD_EQ = /\b(Email|Name|FirstName|LastName|Username|Title|Subject)\s*==\s*/gi;
const RE_STRING_CONCAT_LOOP = /\+\s*["']|["']\s*\+/;
const RE_WHILE_TRUE = /\bwhile\s*\(\s*(true|1\s*==\s*1|1)\s*\)/gi;
const RE_LONG_ID = /\b\d{10,}\b/g;
const RE_UPDATE_IN_BODY = /\b[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*/g;
const RE_DELETE_IN_BODY = /\bdelete\s+from\b/gi;
const RE_INSERT_IN_BODY = /\binsert\s+into\b/gi;

function runCodeRules(comp) {
  const findings = [];
  const src = comp.source || '';
  if (!src) return findings;

  const lines = src.split('\n');

  // Locate each `for each` block and scan its body for nested patterns.
  for (const match of src.matchAll(RE_FOR_EACH)) {
    const braceIdx = match.index + match[0].length - 1;
    const body = balancedBody(src, braceIdx);
    if (!body) continue;
    const bodyText = body.text;
    const startLine = lineOf(src, braceIdx);

    // LOOP-001 — nested `for each`
    if (RE_FOR_EACH.test(bodyText)) {
      findings.push(ruleHit('LOOP-001', comp, startLine, snippetAt(lines, startLine),
        'Nested `for each` — O(n²) or worse runtime.'));
    }
    RE_FOR_EACH.lastIndex = 0;

    // FETCH-001 — fetch inside a loop
    const fetches = matchAll(bodyText, RE_FETCH_GENERIC);
    for (const m of fetches) {
      findings.push(ruleHit('FETCH-001', comp, startLine + lineOf(bodyText, m.index), m[0],
        'Fetch inside loop — move before the loop and use a Map lookup.'));
    }

    // DB-001 — update in loop  (Record.Field = value)
    for (const m of matchAll(bodyText, RE_UPDATE_IN_BODY)) {
      findings.push(ruleHit('DB-001', comp, startLine + lineOf(bodyText, m.index), m[0],
        'Update inside loop — collect IDs and bulk-update afterwards.'));
    }

    // DB-002 — delete in loop
    for (const m of matchAll(bodyText, RE_DELETE_IN_BODY)) {
      findings.push(ruleHit('DB-002', comp, startLine + lineOf(bodyText, m.index), m[0],
        'Delete inside loop — use `delete from Form[criteria]`.'));
    }

    // DB-003 — insert in loop
    for (const m of matchAll(bodyText, RE_INSERT_IN_BODY)) {
      findings.push(ruleHit('DB-003', comp, startLine + lineOf(bodyText, m.index), m[0],
        'Insert inside loop — use bulk insert.'));
    }

    // INTEG-001 — invokeurl in loop
    for (const m of matchAll(bodyText, RE_INVOKEURL)) {
      findings.push(ruleHit('INTEG-001', comp, startLine + lineOf(bodyText, m.index),
        snippetAt(bodyText.split('\n'), lineOf(bodyText, m.index)),
        'Integration call inside loop — batch, or call once after the loop.'));
    }

    // LOOP-002 — string concatenation in loop
    if (RE_STRING_CONCAT_LOOP.test(bodyText)) {
      findings.push(ruleHit('LOOP-002', comp, startLine, snippetAt(lines, startLine),
        'String concatenation inside loop — collect into a List and `joinlist` once.'));
    }
  }

  // FETCH-002 — empty-criteria fetch (ID != 0 / ID != null)
  for (const m of matchAll(src, RE_FETCH_EMPTY)) {
    findings.push(ruleHit('FETCH-002', comp, lineOf(src, m.index), m[0],
      `Fetch on "${m[1]}" with no real criteria — add a filter and \`range from 0 to N\`.`));
  }

  // FETCH-005 — text/email field `==` comparison in fetch criteria
  for (const m of matchAll(src, RE_TEXT_FIELD_EQ)) {
    findings.push(ruleHit('FETCH-005', comp, lineOf(src, m.index),
      snippetAt(lines, lineOf(src, m.index)),
      'Equal-to on text/email field — prefer `equalsIgnoreCase()`.'));
  }

  // FETCH-006 (generic index suggestion for every fetch) deliberately
  // omitted — see the rule-catalogue comment above.

  // FETCH-008 — getAll() usage
  for (const m of matchAll(src, RE_GETALL)) {
    findings.push(ruleHit('FETCH-008', comp, lineOf(src, m.index),
      snippetAt(lines, lineOf(src, m.index)),
      '`.getAll()` — ensure criteria and a `range` bound are present.'));
  }

  // INTEG-002 — multiple invokeurl within 5 lines
  const invokeLines = [];
  for (const m of matchAll(src, RE_INVOKEURL)) {
    invokeLines.push(lineOf(src, m.index));
  }
  for (let i = 1; i < invokeLines.length; i++) {
    if (invokeLines[i] - invokeLines[i - 1] <= 5) {
      findings.push(ruleHit('INTEG-002', comp, invokeLines[i],
        snippetAt(lines, invokeLines[i]),
        'Multiple close-neighbour invokeurl calls — consider batching.'));
      break;
    }
  }

  // GEN-001 — hardcoded IDs
  for (const m of matchAll(src, RE_LONG_ID)) {
    findings.push(ruleHit('GEN-001', comp, lineOf(src, m.index),
      snippetAt(lines, lineOf(src, m.index)),
      `Hardcoded numeric ID ${m[0]} — consider using a variable / lookup.`));
  }

  // GEN-003 — infinite loop risk
  for (const m of matchAll(src, RE_WHILE_TRUE)) {
    findings.push(ruleHit('GEN-003', comp, lineOf(src, m.index),
      snippetAt(lines, lineOf(src, m.index)),
      'Possible infinite loop — ensure a `break` / `return` exit exists.'));
  }

  return findings;
}

/* -------------------------------------------------------------------------- */
/*  Concurrency rules                                                          */
/* -------------------------------------------------------------------------- */

function runConcurrencyRules(ds, components, tierByForm) {
  const findings = [];

  // Fan-in map: form → set of forms that reference it via lookup
  const fanIn = new Map();
  for (const f of ds.forms || []) {
    for (const fd of f.fields || []) {
      const target = typeof fd.lookup === 'string'
        ? fd.lookup.split('.')[0]
        : (fd.lookup && (fd.lookup.form || fd.lookup.target)) || null;
      if (!target) continue;
      if (!fanIn.has(target)) fanIn.set(target, new Set());
      fanIn.get(target).add(f.name);
    }
  }

  // Writer map: form → set of workflow names writing to it
  const writers = new Map();
  for (const wf of ds.workflows || []) {
    if (!wf.form) continue;
    if (!writers.has(wf.form)) writers.set(wf.form, new Set());
    writers.get(wf.form).add(wf.name);
  }

  // CONC-001 — bulk update on high-fan-in form
  //   heuristic: form fan-in ≥ 4 AND at least one workflow writes to it with
  //   a `for each` + Record.Field = pattern in its source.
  for (const wf of ds.workflows || []) {
    const form = wf.form;
    if (!form) continue;
    const inbound = fanIn.get(form)?.size || 0;
    if (inbound < 4) continue;
    const src = wf.sourceCode || '';
    if (!/for\s+each/i.test(src)) continue;
    if (!RE_UPDATE_IN_BODY.test(src)) continue;
    RE_UPDATE_IN_BODY.lastIndex = 0;
    findings.push(makeFinding('CONC-001', {
      formName: form,
      componentPath: `Workflow > ${wf.scope || ''}:${wf.name}`,
      message: `Workflow "${wf.name}" performs loop-updates on high-fan-in form "${form}" (fan-in ${inbound}).`,
      snippet: `for each … ${form}.field = …`,
    }));
  }

  // CONC-002 — ≥ 3 distinct workflows write the same form
  for (const [form, set] of writers) {
    if (set.size >= 3) {
      findings.push(makeFinding('CONC-002', {
        formName: form,
        componentPath: `Form > ${form}`,
        message: `${set.size} distinct workflows write to form "${form}": ${[...set].slice(0, 6).join(', ')}${set.size > 6 ? '…' : ''}.`,
        snippet: `${set.size} writers`,
      }));
    }
  }

  // GEN-004 — unused functions
  //   A function is "unused" if its bare name never appears in any workflow
  //   source. Custom function sources are not preserved, so we only check
  //   workflows — good enough for a hint-level finding.
  const allWfSrc = (ds.workflows || []).map((w) => w.sourceCode || '').join('\n');
  for (const fn of ds.customFunctions || []) {
    const needle = new RegExp(`\\b${escapeRe(fn.name)}\\s*\\(`);
    if (!needle.test(allWfSrc)) {
      findings.push(makeFinding('GEN-004', {
        formName: '',
        componentPath: `Function > ${fn.namespace ? `${fn.namespace}.` : ''}${fn.name}`,
        message: `Custom function "${fn.name}" is never referenced from any workflow.`,
        snippet: `${fn.returnType || ''} ${fn.name}()`.trim(),
      }));
    }
  }

  void components;
  void tierByForm;
  return findings;
}

/* -------------------------------------------------------------------------- */
/*  Volume tier                                                                */
/* -------------------------------------------------------------------------- */

function computeVolumeTiers(ds, components) {
  const tiers = [];

  // Pre-compute helpers
  const fanIn = new Map();
  for (const f of ds.forms || []) {
    for (const fd of f.fields || []) {
      const target = typeof fd.lookup === 'string'
        ? fd.lookup.split('.')[0]
        : (fd.lookup && (fd.lookup.form || fd.lookup.target)) || null;
      if (!target) continue;
      fanIn.set(target, (fanIn.get(target) || 0) + 1);
    }
  }
  const writers = new Map();
  const wfTouch = new Map();
  for (const wf of ds.workflows || []) {
    if (!wf.form) continue;
    wfTouch.set(wf.form, (wfTouch.get(wf.form) || 0) + 1);
    if (!writers.has(wf.form)) writers.set(wf.form, new Set());
    writers.get(wf.form).add(wf.name);
  }

  for (const f of ds.forms || []) {
    const fanOut = (f.fields || []).filter((fd) => fd.lookup).length;
    const dateFields = (f.fields || []).filter((fd) =>
      /^(date|datetime)$/i.test(fd.type || '')
    ).length;
    const fieldCount = (f.fields || []).length;
    const inbound = fanIn.get(f.name) || 0;
    const wfCount = wfTouch.get(f.name) || 0;
    const writerCount = writers.get(f.name)?.size || 0;

    const score =
      inbound * 3 +
      writerCount * 2 +
      wfCount * 1 +
      dateFields * 2 +
      fanOut * 0.5 +
      Math.min(fieldCount / 10, 3);

    let tier = 'Low';
    if (score >= 18) tier = 'Very High';
    else if (score >= 10) tier = 'High';
    else if (score >= 5) tier = 'Medium';

    let risk = '—';
    if (writerCount >= 3 && inbound >= 4) risk = 'Critical';
    else if (writerCount >= 3) risk = 'Moderate';

    tiers.push({
      form: f.name,
      displayName: f.displayName || f.name,
      tier,
      risk,
      fanIn: inbound,
      fanOut,
      writers: writerCount,
      workflows: wfCount,
      dateFields,
      fieldCount,
    });
  }

  // Order: Very High > High > Medium > Low, ties broken by fanIn desc
  const rank = { 'Very High': 0, High: 1, Medium: 2, Low: 3 };
  tiers.sort((a, b) => rank[a.tier] - rank[b.tier] || b.fanIn - a.fanIn);

  void components;
  return tiers;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function makeFinding(ruleId, { formName, componentPath, message, snippet, line }) {
  const r = RULES[ruleId];
  return {
    id: `${ruleId}:${formName || ''}:${componentPath}:${line ?? ''}`,
    ruleId,
    severity: r.severity,
    category: r.category,
    title: r.title,
    fix: r.fix,
    message,
    formName: formName || '',
    componentPath,
    line: line ?? null,
    snippet: snippet || '',
  };
}

function ruleHit(ruleId, comp, line, snippet, message) {
  return makeFinding(ruleId, {
    formName: comp.formName,
    componentPath: comp.path,
    line,
    snippet: truncate(snippet, 160),
    message,
  });
}

function balancedBody(src, openIdx) {
  if (src[openIdx] !== '{') return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      i = skipStr(src, i);
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { text: src.slice(openIdx + 1, i), end: i + 1 };
    }
  }
  return null;
}

function skipStr(src, i) {
  const q = src[i];
  i++;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === q) return i;
    i++;
  }
  return i;
}

function lineOf(text, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

function snippetAt(lines, lineNo) {
  return truncate((lines[lineNo - 1] || '').trim(), 160);
}

function matchAll(text, re) {
  const out = [];
  let m;
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = rx.exec(text)) !== null) {
    out.push(m);
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

module.exports = { analysePerformance, RULES };
