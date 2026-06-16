/**
 * extractScope — call an LLM to convert BRD text into a v2 scope JSON.
 *
 * This is the server-side counterpart to client/src/tools/tech-scope/lib/heuristics.js.
 * Both produce the same shape (defined in client/src/tools/tech-scope/lib/scope.js).
 *
 * Flow:
 *   1. Build a constrained prompt (prompts/extractScope.js).
 *   2. Run through the LLM router (Anthropic-first per task preference).
 *   3. If router returns the stub sentinel → bubble up { useFallback: true } so
 *      the client falls back to its local heuristic extractor.
 *   4. Validate the LLM response against the v2 schema; on failure throw so the
 *      HTTP layer returns 502 → client falls back as well.
 *   5. Return { provider, scope } on success.
 */

const router = require('../../shared/llm/router');
const { SYSTEM, buildUserPrompt, CANONICAL_FIELD_TYPES, REPORT_TYPES } = require('./prompts/extractScope');

const MAX_BRD_CHARS = 60_000; // ~15k tokens — safe for Claude 3.5 Sonnet + budget-conscious

const VALID_FIELD_TYPES = new Set(CANONICAL_FIELD_TYPES);
const VALID_REPORT_TYPES = new Set(REPORT_TYPES);
const VALID_WF_SCOPES = new Set(['form', 'report', 'schedule', 'button', 'custom_action']);
const VALID_WF_EVENTS = new Set(['on add', 'on edit', 'on delete', 'on validate', 'on user input']);
const VALID_LOOKUP_KINDS = new Set(['single', 'multi', 'subform']);
const VALID_BLUEPRINT_RUNWHEN = new Set(['always', 'criteria']);
const VALID_BATCH_FREQ = new Set(['daily', 'weekly', 'monthly', 'on_demand', 'schedule']);
const VALID_SCHEDULE_FREQ = new Set(['daily', 'weekly', 'monthly', 'cron']);
const VALID_AUTH_TYPES = new Set(['none', 'apikey', 'oauth2', 'basic']);
const VALID_EDITIONS = new Set(['standard', 'professional', 'flex']);

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function isStr(v) { return typeof v === 'string'; }
function isArr(v) { return Array.isArray(v); }
function isBool(v) { return typeof v === 'boolean'; }

/**
 * Validate the LLM-produced scope. Throws on hard structural errors; logs
 * non-fatal violations as `warnings` returned alongside the scope so the UI
 * can surface them ("AI emitted 2 unknown field types — coerced to Single Line").
 *
 * Coerces unknown enums to safe defaults rather than rejecting the whole
 * response, because an LLM that emits "Text" instead of "Single Line" is still
 * orders of magnitude more useful than the regex extractor.
 */
function validateAndNormalize(raw) {
  if (!isObj(raw)) throw new Error('extractScope: response is not an object');
  const warnings = [];
  const out = {};

  out.schemaVersion = 2;

  out.meta = {
    title: isStr(raw?.meta?.title) ? raw.meta.title : 'Untitled Creator App',
    sourceFile: isStr(raw?.meta?.sourceFile) ? raw.meta.sourceFile : null,
    createdAt: null,
    updatedAt: null,
  };

  const app = isObj(raw.application) ? raw.application : {};
  out.application = {
    name: isStr(app.name) ? app.name : (out.meta.title || 'Untitled_App'),
    dateFormat: isStr(app.dateFormat) ? app.dateFormat : 'dd-MMM-yyyy',
    timeZone: isStr(app.timeZone) ? app.timeZone : 'Asia/Kolkata',
    timeFormat: isStr(app.timeFormat) ? app.timeFormat : '24-hr',
    edition: VALID_EDITIONS.has(app.edition) ? app.edition : 'professional',
  };

  out.forms = (isArr(raw.forms) ? raw.forms : []).map((f, i) => {
    if (!isObj(f) || !isStr(f.name)) {
      warnings.push(`forms[${i}]: missing name — skipped`);
      return null;
    }
    return {
      name: f.name,
      displayName: isStr(f.displayName) ? f.displayName : f.name,
      purpose: isStr(f.purpose) ? f.purpose : '',
      fields: (isArr(f.fields) ? f.fields : []).map((fd, j) => {
        if (!isObj(fd) || !isStr(fd.name)) {
          warnings.push(`forms[${i}].fields[${j}]: missing name — skipped`);
          return null;
        }
        let type = isStr(fd.type) ? fd.type : 'Single Line';
        if (!VALID_FIELD_TYPES.has(type)) {
          warnings.push(`forms[${i}].fields[${j}] (${fd.name}): unknown type "${type}" → coerced to "Single Line"`);
          type = 'Single Line';
        }
        return {
          name: fd.name,
          displayName: isStr(fd.displayName) ? fd.displayName : fd.name,
          type,
          required: !!fd.required,
          unique: !!fd.unique,
          lookup: isStr(fd.lookup) ? fd.lookup : null,
          values: isArr(fd.values) ? fd.values.filter(isStr) : null,
          formula: isStr(fd.formula) ? fd.formula : null,
          maxChar: typeof fd.maxChar === 'number' ? fd.maxChar : null,
        };
      }).filter(Boolean),
      actionEvents: isArr(f.actionEvents) ? f.actionEvents.filter(isStr) : ['on add', 'on edit'],
    };
  }).filter(Boolean);

  out.reports = (isArr(raw.reports) ? raw.reports : []).map((r, i) => {
    if (!isObj(r) || !isStr(r.name)) {
      warnings.push(`reports[${i}]: missing name — skipped`); return null;
    }
    let type = isStr(r.type) ? r.type : 'list';
    if (!VALID_REPORT_TYPES.has(type)) {
      warnings.push(`reports[${i}] (${r.name}): unknown type "${type}" → coerced to "list"`);
      type = 'list';
    }
    return {
      name: r.name,
      displayName: isStr(r.displayName) ? r.displayName : r.name,
      type,
      baseForm: isStr(r.baseForm) ? r.baseForm : '',
      columns: isArr(r.columns) ? r.columns.filter(isStr) : [],
      customActions: isArr(r.customActions) ? r.customActions.filter(isStr) : [],
      hidden: !!r.hidden,
    };
  }).filter(Boolean);

  out.pages = (isArr(raw.pages) ? raw.pages : []).map((p) => isObj(p) && isStr(p.name) ? {
    name: p.name,
    displayName: isStr(p.displayName) ? p.displayName : p.name,
    section: isStr(p.section) ? p.section : 'Default',
    embeddedForms: isArr(p.embeddedForms) ? p.embeddedForms.filter(isStr) : [],
    embeddedReports: isArr(p.embeddedReports) ? p.embeddedReports.filter(isStr) : [],
    hasScript: !!p.hasScript,
  } : null).filter(Boolean);

  out.workflows = (isArr(raw.workflows) ? raw.workflows : []).map((w, i) => {
    if (!isObj(w) || !isStr(w.name)) { warnings.push(`workflows[${i}]: missing name — skipped`); return null; }
    let scope = isStr(w.scope) ? w.scope : 'form';
    if (!VALID_WF_SCOPES.has(scope)) { warnings.push(`workflows[${i}]: unknown scope "${scope}" → "form"`); scope = 'form'; }
    let event = isStr(w.event) ? w.event : 'on add';
    if (!VALID_WF_EVENTS.has(event)) { warnings.push(`workflows[${i}]: unknown event "${event}" → "on add"`); event = 'on add'; }
    return {
      name: w.name,
      displayName: isStr(w.displayName) ? w.displayName : w.name,
      scope,
      type: 'workflow',
      form: isStr(w.form) ? w.form : '',
      event,
      actionKinds: isArr(w.actionKinds) ? w.actionKinds.filter(isStr) : [],
      description: isStr(w.description) ? w.description : '',
    };
  }).filter(Boolean);

  out.lookups = (isArr(raw.lookups) ? raw.lookups : []).map((l) => isObj(l) && isStr(l.from) && isStr(l.to) ? {
    from: l.from,
    field: isStr(l.field) ? l.field : `${l.to}_lookup`,
    to: l.to,
    kind: VALID_LOOKUP_KINDS.has(l.kind) ? l.kind : 'single',
  } : null).filter(Boolean);

  out.roles = (isArr(raw.roles) ? raw.roles : []).map((r) => isObj(r) && isStr(r.name) ? {
    name: r.name,
    description: isStr(r.description) ? r.description : '',
    parent: isStr(r.parent) ? r.parent : null,
  } : null).filter(Boolean);

  out.profiles = (isArr(raw.profiles) ? raw.profiles : []).map((p) => isObj(p) && isStr(p.name) ? {
    name: p.name,
    description: isStr(p.description) ? p.description : '',
    type: isStr(p.type) ? p.type : 'standard',
    modulePermissions: isArr(p.modulePermissions) ? p.modulePermissions.map((mp) => isObj(mp) && isStr(mp.form) ? {
      form: mp.form,
      enabled: isArr(mp.enabled) ? mp.enabled.filter(isStr) : ['Tab', 'Viewall'],
      allFieldsVisible: mp.allFieldsVisible !== false,
      reportPermissions: isArr(mp.reportPermissions) ? mp.reportPermissions.map((rp) => isObj(rp) && isStr(rp.report) ? {
        report: rp.report,
        actions: isArr(rp.actions) ? rp.actions.filter(isStr) : ['View'],
      } : null).filter(Boolean) : [],
    } : null).filter(Boolean) : [],
  } : null).filter(Boolean);

  out.customFunctions = (isArr(raw.customFunctions) ? raw.customFunctions : []).map((c) => isObj(c) && isStr(c.name) ? {
    name: c.name,
    namespace: isStr(c.namespace) ? c.namespace : '',
    returnType: isStr(c.returnType) ? c.returnType : 'void',
    params: isArr(c.params) ? c.params.filter((x) => isObj(x) && isStr(x.name)) : [],
    purpose: isStr(c.purpose) ? c.purpose : '',
    language: 'Deluge',
  } : null).filter(Boolean);

  out.connections = (isArr(raw.connections) ? raw.connections : []).map((c) => isObj(c) && isStr(c.service) ? {
    service: c.service,
    authType: VALID_AUTH_TYPES.has(c.authType) ? c.authType : 'oauth2',
    purpose: isStr(c.purpose) ? c.purpose : '',
  } : null).filter(Boolean);

  out.blueprints = (isArr(raw.blueprints) ? raw.blueprints : []).map((b) => isObj(b) && isStr(b.name) ? {
    name: b.name,
    displayName: isStr(b.displayName) ? b.displayName : b.name,
    form: isStr(b.form) ? b.form : '',
    runWhen: VALID_BLUEPRINT_RUNWHEN.has(b.runWhen) ? b.runWhen : 'always',
    criteria: isStr(b.criteria) ? b.criteria : '',
    stages: isArr(b.stages) ? b.stages.map((s) => isObj(s) && isStr(s.name) ? {
      name: s.name,
      displayName: isStr(s.displayName) ? s.displayName : s.name,
      isInitial: !!s.isInitial,
      isTerminal: !!s.isTerminal,
    } : null).filter(Boolean) : [],
    transitions: isArr(b.transitions) ? b.transitions.map((t) => isObj(t) && isStr(t.name) ? {
      name: t.name,
      from: isStr(t.from) ? t.from : '',
      to: isStr(t.to) ? t.to : '',
      owners: isArr(t.owners) ? t.owners.filter(isStr) : ['all'],
      criteria: isStr(t.criteria) ? t.criteria : '',
      beforeWorkflow: isStr(t.beforeWorkflow) ? t.beforeWorkflow : '',
      afterWorkflow: isStr(t.afterWorkflow) ? t.afterWorkflow : '',
      description: isStr(t.description) ? t.description : '',
    } : null).filter(Boolean) : [],
    description: isStr(b.description) ? b.description : '',
  } : null).filter(Boolean);

  out.batchWorkflows = (isArr(raw.batchWorkflows) ? raw.batchWorkflows : []).map((b) => isObj(b) && isStr(b.name) ? {
    name: b.name,
    displayName: isStr(b.displayName) ? b.displayName : b.name,
    form: isStr(b.form) ? b.form : '',
    criteria: isStr(b.criteria) ? b.criteria : '',
    frequency: VALID_BATCH_FREQ.has(b.frequency) ? b.frequency : 'on_demand',
    scheduleName: isStr(b.scheduleName) ? b.scheduleName : '',
    delugeScript: isStr(b.delugeScript) ? b.delugeScript : '',
    description: isStr(b.description) ? b.description : '',
  } : null).filter(Boolean);

  out.schedules = (isArr(raw.schedules) ? raw.schedules : []).map((s) => isObj(s) && isStr(s.name) ? {
    name: s.name,
    frequency: VALID_SCHEDULE_FREQ.has(s.frequency) ? s.frequency : 'daily',
    cron: isStr(s.cron) ? s.cron : null,
    calls: isStr(s.calls) ? s.calls : '',
  } : null).filter(Boolean);

  out.publicAPIs = (isArr(raw.publicAPIs) ? raw.publicAPIs : []).map((a) => isObj(a) && isStr(a.method) && isStr(a.path) ? {
    method: a.method.toUpperCase(),
    path: a.path,
    baseForm: isStr(a.baseForm) ? a.baseForm : '',
    auth: VALID_AUTH_TYPES.has(a.auth) ? a.auth : 'apikey',
    purpose: isStr(a.purpose) ? a.purpose : '',
  } : null).filter(Boolean);

  out.nfrs = (isArr(raw.nfrs) ? raw.nfrs : []).map((n) => isObj(n) && isStr(n.statement) ? {
    category: isStr(n.category) ? n.category : 'Performance',
    statement: n.statement,
  } : null).filter(Boolean);

  out.assumptions = isArr(raw.assumptions) ? raw.assumptions.filter(isStr) : [];
  out.outOfScope = isArr(raw.outOfScope) ? raw.outOfScope.filter(isStr) : [];

  out.notes = {
    step1: isArr(raw?.notes?.step1) ? raw.notes.step1.filter(isStr) : [],
    step2: isArr(raw?.notes?.step2) ? raw.notes.step2.filter(isStr) : [],
    step3: isArr(raw?.notes?.step3) ? raw.notes.step3.filter(isStr) : [],
    step4: isArr(raw?.notes?.step4) ? raw.notes.step4.filter(isStr) : [],
    step5: isArr(raw?.notes?.step5) ? raw.notes.step5.filter(isStr) : [],
  };

  // Hard requirement: at least one form. Anything else is a meaningless scope.
  if (out.forms.length === 0) {
    throw new Error('extractScope: response contains zero forms');
  }

  // Stamp timestamps now that the shape is valid.
  const now = new Date().toISOString();
  out.meta.createdAt = now;
  out.meta.updatedAt = now;

  return { scope: out, warnings };
}

/**
 * Public entry — used by the Express route handler.
 *
 * @param {{ brdText: string, title?: string, sourceFile?: string }} args
 * @returns {Promise<{ provider: string, scope: object, warnings: string[] } | { useFallback: true, reason: string }>}
 */
async function extractScope({ brdText, title, sourceFile }) {
  if (!isStr(brdText) || brdText.trim().length === 0) {
    throw new Error('extractScope: brdText is required');
  }
  // Truncate long BRDs to keep token cost predictable.
  const trimmed = brdText.length > MAX_BRD_CHARS
    ? brdText.slice(0, MAX_BRD_CHARS) + '\n\n[…BRD truncated for length…]'
    : brdText;

  const { provider, data } = await router.run('extractScope', {
    system: SYSTEM,
    user: buildUserPrompt({ brdText: trimmed, title }),
  });

  // Stub sentinel → tell caller to fall back to client-side heuristics.
  if (data && data.__stub) {
    return { useFallback: true, reason: data.reason || 'no LLM provider configured' };
  }

  const { scope, warnings } = validateAndNormalize(data);
  if (sourceFile) scope.meta.sourceFile = sourceFile;
  if (title) scope.meta.title = title;

  return { provider, scope, warnings };
}

module.exports = { extractScope, _internal: { validateAndNormalize, MAX_BRD_CHARS } };
