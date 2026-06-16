/**
 * dsl.js — deterministic, offline prompt parser for the **Zoho Creator**
 * Technical Scope tool.
 *
 * The user types natural-ish commands, one per line. Each line is matched
 * against a small grammar; recognised commands produce a structured action
 * which `applyCommands()` then merges into the scope. Unrecognised lines
 * are appended verbatim to the step's "notes" so the user is never blocked.
 *
 * Vocabulary follows Creator: forms, reports, pages, workflows, profiles,
 * roles, custom functions, connections, schedules, public APIs.
 *
 * Legacy aliases (`add entity` → `add form`, `add module` → `add page`,
 * `add integration` → `add connection`, `add api` → `add public api`) are
 * preserved so old prompts and tests keep working.
 *
 * No LLM. No network. 100 % offline.
 */

import { cloneScope, stamp, SYSTEM_BASE_FORM_NAMES } from './scope.js';

/* -------------------------------------------------------------------------- */
/*  Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Parse a multi-line prompt into a list of actions.
 * @param {string} prompt
 * @param {string} stepId — 'step1' .. 'step5' (used for fallback notes)
 * @returns {{ actions: Array, fallbacks: Array }}
 */
export function parsePrompt(prompt, stepId = 'step1') {
  const actions = [];
  const fallbacks = [];
  if (!prompt || typeof prompt !== 'string') return { actions, fallbacks };

  for (const rawLine of prompt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    const action = matchLine(line);
    if (action) {
      actions.push(action);
    } else {
      fallbacks.push({ stepId, text: line });
    }
  }
  return { actions, fallbacks };
}

/**
 * Apply parsed actions (and fallbacks) to a scope, returning a new scope.
 */
export function applyCommands(scope, parseResult) {
  const next = cloneScope(scope);
  const summary = { applied: [], skipped: [], fallbacks: 0 };

  for (const a of parseResult.actions) {
    try {
      const ok = REDUCERS[a.kind]?.(next, a);
      if (ok) summary.applied.push(a);
      else summary.skipped.push({ ...a, reason: 'no-op' });
    } catch (err) {
      summary.skipped.push({ ...a, reason: err.message });
    }
  }

  for (const fb of parseResult.fallbacks) {
    next.notes ||= {};
    next.notes[fb.stepId] ||= [];
    next.notes[fb.stepId].push(fb.text);
    summary.fallbacks++;
  }

  return { scope: stamp(next), summary };
}

/* -------------------------------------------------------------------------- */
/*  Grammar                                                                    */
/* -------------------------------------------------------------------------- */

const PATTERNS = [
  /* ----------- Forms (Step 1) -------------------------------------------- */
  {
    re: /^add\s+form\s*[:\-]\s*([A-Za-z0-9 _-]+?)(?:\s+with\s+fields\s*[:\-]\s*(.+))?$/i,
    kind: 'addForm',
    map: (m) => ({ name: clean(m[1]), fields: parseFieldList(m[2]) }),
  },
  {
    re: /^remove\s+form\s*[:\-]\s*([A-Za-z0-9 _-]+)$/i,
    kind: 'removeForm',
    map: (m) => ({ name: clean(m[1]) }),
  },
  {
    re: /^rename\s+form\s*[:\-]\s*([A-Za-z0-9 _-]+?)\s+to\s+([A-Za-z0-9 _-]+)$/i,
    kind: 'renameForm',
    map: (m) => ({ from: clean(m[1]), to: clean(m[2]) }),
  },
  {
    re: /^add\s+field\s+to\s+form\s+([A-Za-z0-9 _-]+?)\s*[:\-]\s*([A-Za-z0-9_]+)(?:\s*\(([^)]*)\))?$/i,
    kind: 'addFieldToForm',
    map: (m) => ({
      formName: clean(m[1]),
      field: parseFieldDescriptor(m[2], m[3]),
    }),
  },

  /* ----------- Reports (Step 1) ------------------------------------------ */
  {
    re: /^add\s+report\s*[:\-]\s*([A-Za-z0-9 _-]+?)(?:\s+(?:type|as)\s+(list|grid|kanban|calendar|timeline|map|pivot|summary|spreadsheet))?(?:\s+from\s+([A-Za-z0-9 _-]+))?$/i,
    kind: 'addReport',
    map: (m) => ({
      name: clean(m[1]),
      type: (m[2] || 'list').toLowerCase(),
      baseForm: m[3] ? clean(m[3]) : '',
    }),
  },
  {
    re: /^remove\s+report\s*[:\-]\s*([A-Za-z0-9 _-]+)$/i,
    kind: 'removeReport',
    map: (m) => ({ name: clean(m[1]) }),
  },

  /* ----------- Pages (Step 1) -------------------------------------------- */
  {
    re: /^add\s+page\s*[:\-]\s*([A-Za-z0-9 _-]+?)(?:\s+in\s+section\s+([A-Za-z0-9 _-]+?))?(?:\s+embeds\s+(.+))?$/i,
    kind: 'addPage',
    map: (m) => ({
      name: clean(m[1]),
      section: m[2] ? clean(m[2]) : 'Default',
      embeds: parseEmbedList(m[3]),
    }),
  },
  {
    re: /^remove\s+page\s*[:\-]\s*([A-Za-z0-9 _-]+)$/i,
    kind: 'removePage',
    map: (m) => ({ name: clean(m[1]) }),
  },

  /* ----------- Workflows (Step 1) ---------------------------------------- */
  {
    re: /^add\s+workflow\s*[:\-]\s*([A-Za-z0-9 _-]+?)(?:\s+triggered\s+by\s+([A-Za-z0-9_ ]+?)(?:\.([A-Za-z _]+))?)?$/i,
    kind: 'addWorkflow',
    map: (m) => ({
      name: clean(m[1]),
      trigger: m[2] ? { form: clean(m[2]), event: normaliseEvent(m[3]) } : null,
    }),
  },
  {
    re: /^remove\s+workflow\s*[:\-]\s*([A-Za-z0-9 _-]+)$/i,
    kind: 'removeWorkflow',
    map: (m) => ({ name: clean(m[1]) }),
  },
  {
    re: /^rename\s+workflow\s*[:\-]\s*([A-Za-z0-9 _-]+?)\s+to\s+([A-Za-z0-9 _-]+)$/i,
    kind: 'renameWorkflow',
    map: (m) => ({ from: clean(m[1]), to: clean(m[2]) }),
  },

  /* ----------- Lookups (Step 2) — Creator's relationship mechanism -------- */
  {
    re: /^add\s+lookup\s*[:\-]\s*([A-Za-z0-9 _-]+?)\.([A-Za-z0-9_]+)\s*->\s*([A-Za-z0-9 _-]+?)(?:\s+as\s+(single|multi|subform))?$/i,
    kind: 'addLookup',
    // NB: use `lookupKind` (not `kind`) so the action's outer `kind: 'addLookup'`
    // discriminator is not overwritten by the spread in `matchLine`.
    map: (m) => ({
      from: clean(m[1]),
      field: clean(m[2]),
      to: clean(m[3]),
      lookupKind: (m[4] || 'single').toLowerCase(),
    }),
  },

  /* ----------- LEGACY: Entities + Relationships (route to Forms/Lookups) -- */
  {
    re: /^add\s+entity\s*[:\-]\s*([A-Za-z0-9 _-]+?)(?:\s+with\s+fields\s*[:\-]\s*(.+))?$/i,
    kind: 'addForm', // alias: entity → form
    map: (m) => ({ name: clean(m[1]), fields: parseFieldList(m[2]) }),
  },
  {
    re: /^remove\s+entity\s*[:\-]\s*([A-Za-z0-9 _-]+)$/i,
    kind: 'removeForm',
    map: (m) => ({ name: clean(m[1]) }),
  },
  {
    re: /^add\s+field\s+to\s+entity\s+([A-Za-z0-9 _-]+?)\s*[:\-]\s*([A-Za-z0-9_]+)(?:\s*\(([^)]*)\))?$/i,
    kind: 'addFieldToForm',
    map: (m) => ({
      formName: clean(m[1]),
      field: parseFieldDescriptor(m[2], m[3]),
    }),
  },
  {
    re: /^add\s+relationship\s*[:\-]\s*([A-Za-z0-9 _-]+?)\s*<->\s*([A-Za-z0-9 _-]+?)(?:\s+as\s+([A-Za-z0-9_]+))?(?:\s+\((1-1|1-N|N-N)\))?$/i,
    kind: 'addLookup',
    map: (m) => ({
      from: clean(m[1]),
      to: clean(m[2]),
      field: m[3] ? clean(m[3]) : `${clean(m[2]).replace(/\s+/g, '_')}_lookup`,
      lookupKind: (m[4] === 'N-N') ? 'multi' : 'single',
    }),
  },

  /* ----------- Pages (alias: module → page) ------------------------------ */
  {
    re: /^add\s+module\s*[:\-]\s*([A-Za-z0-9 _-]+?)(?:\s*[—-]\s*(.+))?$/i,
    kind: 'addPage',
    map: (m) => ({ name: clean(m[1]), section: 'Default', embeds: [], description: (m[2] || '').trim() }),
  },
  {
    re: /^remove\s+module\s*[:\-]\s*([A-Za-z0-9 _-]+)$/i,
    kind: 'removePage',
    map: (m) => ({ name: clean(m[1]) }),
  },

  /* ----------- Roles (Step 3) -------------------------------------------- */
  {
    re: /^add\s+role\s*[:\-]\s*([A-Za-z0-9 _-]+?)(?:\s+reports\s+to\s+([A-Za-z0-9 _-]+?))?(?:\s*[—-]\s*(.+))?$/i,
    kind: 'addRole',
    map: (m) => ({
      name: clean(m[1]),
      parent: m[2] ? clean(m[2]) : null,
      description: (m[3] || '').trim(),
    }),
  },
  {
    re: /^remove\s+role\s*[:\-]\s*([A-Za-z0-9 _-]+)$/i,
    kind: 'removeRole',
    map: (m) => ({ name: clean(m[1]) }),
  },

  /* ----------- Profiles (Step 3) ----------------------------------------- */
  {
    re: /^add\s+profile\s*[:\-]\s*([A-Za-z0-9 _-]+?)(?:\s+can\s+(.+?))?(?:\s+on\s+(.+))?$/i,
    kind: 'addProfile',
    map: (m) => ({
      name: clean(m[1]),
      actions: parseActionList(m[2]),
      forms: parseFormList(m[3]),
    }),
  },
  {
    re: /^remove\s+profile\s*[:\-]\s*([A-Za-z0-9 _-]+)$/i,
    kind: 'removeProfile',
    map: (m) => ({ name: clean(m[1]) }),
  },

  /* ----------- Custom Functions (Step 4) --------------------------------- */
  {
    re: /^add\s+(?:custom\s+)?function\s*[:\-]\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s+returns\s+([A-Za-z_][A-Za-z0-9_]*))?(?:\s*[—-]\s*(.+))?$/i,
    kind: 'addCustomFunction',
    map: (m) => ({
      name: clean(m[1]),
      returnType: m[2] || 'void',
      purpose: (m[3] || '').trim(),
    }),
  },
  {
    re: /^remove\s+(?:custom\s+)?function\s*[:\-]\s*([A-Za-z_][A-Za-z0-9_]*)$/i,
    kind: 'removeCustomFunction',
    map: (m) => ({ name: clean(m[1]) }),
  },

  /* ----------- Connections (Step 4) -------------------------------------- */
  {
    re: /^add\s+connection\s*[:\-]\s*([A-Za-z0-9 _-]+?)(?:\s+(?:via|using|auth)\s+(oauth2?|apikey|api\s*key|basic))?(?:\s*[—-]\s*(.+))?$/i,
    kind: 'addConnection',
    map: (m) => ({
      service: clean(m[1]),
      authType: normaliseAuth(m[2]),
      purpose: (m[3] || '').trim(),
    }),
  },
  {
    re: /^remove\s+connection\s*[:\-]\s*([A-Za-z0-9 _-]+)$/i,
    kind: 'removeConnection',
    map: (m) => ({ service: clean(m[1]) }),
  },
  // alias: integration → connection
  {
    re: /^add\s+integration\s*[:\-]\s*([A-Za-z0-9 _-]+?)(?:\s+via\s+([A-Za-z0-9 _-]+))?$/i,
    kind: 'addConnection',
    map: (m) => ({
      service: clean(m[1]),
      authType: m[2] && /key/i.test(m[2]) ? 'apikey' : 'oauth2',
      purpose: '',
    }),
  },

  /* ----------- Blueprints (Step 4) --------------------------------------- */
  {
    re: /^add\s+blueprint\s*[:\-]\s*([A-Za-z0-9 _-]+?)(?:\s+on\s+([A-Za-z0-9 _-]+?))?(?:\s+stages\s*[:\-]\s*(.+))?$/i,
    kind: 'addBlueprint',
    map: (m) => ({
      name: clean(m[1]),
      form: m[2] ? clean(m[2]) : '',
      stageList: m[3] ? m[3].split(/\s*[,;→>\|]\s*/).map((s) => s.trim()).filter(Boolean) : [],
    }),
  },
  {
    re: /^remove\s+blueprint\s*[:\-]\s*([A-Za-z0-9 _-]+)$/i,
    kind: 'removeBlueprint',
    map: (m) => ({ name: clean(m[1]) }),
  },
  {
    re: /^add\s+(?:blueprint\s+)?stage\s*[:\-]\s*([A-Za-z0-9 _-]+)\s+to\s+(?:blueprint\s+)?([A-Za-z0-9 _-]+)$/i,
    kind: 'addBlueprintStage',
    map: (m) => ({ stage: clean(m[1]), blueprint: clean(m[2]) }),
  },
  {
    re: /^add\s+transition\s*[:\-]\s*([A-Za-z0-9 _-]+)\s+(?:in|to)\s+(?:blueprint\s+)?([A-Za-z0-9 _-]+)\s+from\s+([A-Za-z0-9 _-]+)\s+to\s+([A-Za-z0-9 _-]+)(?:\s+by\s+(.+))?$/i,
    kind: 'addTransition',
    map: (m) => ({
      name: clean(m[1]),
      blueprint: clean(m[2]),
      from: clean(m[3]),
      to: clean(m[4]),
      owners: m[5] ? m[5].split(/\s*,\s*/).map(clean) : ['all'],
    }),
  },

  /* ----------- Batch Workflows (Step 4) ---------------------------------- */
  {
    re: /^add\s+batch(?:\s+workflow)?\s*[:\-]\s*([A-Za-z0-9 _-]+?)(?:\s+on\s+([A-Za-z0-9 _-]+?))?(?:\s+(?:runs?|every)\s+(daily|weekly|monthly|on[_\s]demand|hourly))?(?:\s+where\s+(.+))?$/i,
    kind: 'addBatchWorkflow',
    map: (m) => ({
      name: clean(m[1]),
      form: m[2] ? clean(m[2]) : '',
      frequency: m[3] ? clean(m[3]).replace(/\s+/g, '_') : 'on_demand',
      criteria: m[4] ? clean(m[4]) : '',
    }),
  },
  {
    re: /^remove\s+batch(?:\s+workflow)?\s*[:\-]\s*([A-Za-z0-9 _-]+)$/i,
    kind: 'removeBatchWorkflow',
    map: (m) => ({ name: clean(m[1]) }),
  },

  /* ----------- Schedules (Step 4) ---------------------------------------- */
  {
    re: /^add\s+schedule\s*[:\-]\s*([A-Za-z0-9 _-]+?)(?:\s+(?:runs|every)\s+(daily|weekly|monthly|hourly))?(?:\s+calls\s+([A-Za-z_][A-Za-z0-9_ ]*))?$/i,
    kind: 'addSchedule',
    map: (m) => ({
      name: clean(m[1]),
      frequency: (m[2] || 'daily').toLowerCase(),
      calls: m[3] ? clean(m[3]) : '',
    }),
  },
  {
    re: /^remove\s+schedule\s*[:\-]\s*([A-Za-z0-9 _-]+)$/i,
    kind: 'removeSchedule',
    map: (m) => ({ name: clean(m[1]) }),
  },

  /* ----------- Public APIs (Step 4) -------------------------------------- */
  {
    re: /^add\s+(?:public\s+)?api\s*[:\-]\s*(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)(?:\s+(?:from|on)\s+([A-Za-z0-9 _-]+?))?(?:\s+returns\s+(.+))?$/i,
    kind: 'addPublicAPI',
    map: (m) => ({
      method: m[1].toUpperCase(),
      path: m[2],
      baseForm: m[3] ? clean(m[3]) : '',
      purpose: (m[4] || '').trim(),
    }),
  },
  {
    re: /^remove\s+(?:public\s+)?api\s*[:\-]\s*(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)$/i,
    kind: 'removePublicAPI',
    map: (m) => ({ method: m[1].toUpperCase(), path: m[2] }),
  },

  /* ----------- NFRs + Assumptions (Step 5) ------------------------------- */
  {
    re: /^add\s+nfr\s*[:\-]\s*([A-Za-z]+)\s*[—\-]\s*(.+)$/i,
    kind: 'addNfr',
    map: (m) => ({ category: clean(m[1]), statement: m[2].trim() }),
  },
  {
    re: /^add\s+assumption\s*[:\-]\s*(.+)$/i,
    kind: 'addAssumption',
    map: (m) => ({ statement: m[1].trim() }),
  },
  {
    re: /^add\s+(?:out\s*of\s*scope|oos)\s*[:\-]\s*(.+)$/i,
    kind: 'addOutOfScope',
    map: (m) => ({ statement: m[1].trim() }),
  },

  /* ----------- Application meta ------------------------------------------ */
  {
    re: /^set\s+application\s*[:\-]\s*(.+)$/i,
    kind: 'setApplication',
    map: (m) => ({ name: m[1].trim() }),
  },
  {
    re: /^set\s+title\s*[:\-]\s*(.+)$/i,
    kind: 'setTitle',
    map: (m) => ({ title: m[1].trim() }),
  },
  {
    re: /^set\s+timezone\s*[:\-]\s*([A-Za-z_]+\/[A-Za-z_]+)$/i,
    kind: 'setTimezone',
    map: (m) => ({ tz: m[1] }),
  },
  {
    re: /^set\s+(?:date\s+)?format\s*[:\-]\s*([A-Za-z\-/]+)$/i,
    kind: 'setDateFormat',
    map: (m) => ({ fmt: m[1] }),
  },
  {
    re: /^set\s+edition\s*[:\-]\s*(standard|professional|flex)$/i,
    kind: 'setEdition',
    map: (m) => ({ edition: m[1].toLowerCase() }),
  },
];

function matchLine(line) {
  for (const p of PATTERNS) {
    const m = line.match(p.re);
    if (m) return { kind: p.kind, ...p.map(m) };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Reducers                                                                   */
/* -------------------------------------------------------------------------- */

const REDUCERS = {
  /* Forms */
  addForm(s, a) {
    const ident = toIdent(a.name);
    if (findByName(s.forms, ident)) return false;
    s.forms.push({
      name: ident,
      displayName: a.name,
      purpose: '',
      fields: (a.fields || []).map(asCreatorField),
      actionEvents: ['on add', 'on edit'],
    });
    return true;
  },
  removeForm(s, a) {
    // System base forms are protected and cannot be removed via DSL.
    const ident = toIdent(a.name);
    if (SYSTEM_BASE_FORM_NAMES.has(ident) || SYSTEM_BASE_FORM_NAMES.has(a.name)) {
      throw new Error(
        `"${a.name}" is a required system base form and cannot be removed. ` +
        `Renaming is allowed. Base forms: ${[...SYSTEM_BASE_FORM_NAMES].join(', ')}.`
      );
    }
    const before = s.forms.length;
    s.forms = s.forms.filter((f) => !nameEq(f.name, a.name) && !nameEq(f.displayName, a.name));
    return s.forms.length < before;
  },
  renameForm(s, a) {
    const f = findByName(s.forms, a.from) || s.forms.find((x) => nameEq(x.displayName, a.from));
    if (!f) return false;
    f.name = toIdent(a.to);
    f.displayName = a.to;
    return true;
  },
  addFieldToForm(s, a) {
    const f = findByName(s.forms, a.formName) || s.forms.find((x) => nameEq(x.displayName, a.formName));
    if (!f) return false;
    f.fields ||= [];
    if (f.fields.find((x) => nameEq(x.name, a.field.name))) return false;
    f.fields.push(asCreatorField(a.field));
    return true;
  },

  /* Reports */
  addReport(s, a) {
    const ident = toIdent(a.name);
    if (findByName(s.reports, ident)) return false;
    let baseForm = '';
    if (a.baseForm) {
      const f = s.forms.find((x) => nameEq(x.name, a.baseForm) || nameEq(x.displayName, a.baseForm));
      baseForm = f ? f.name : toIdent(a.baseForm);
    }
    s.reports.push({
      name: ident,
      displayName: a.name,
      type: a.type || 'list',
      baseForm,
      columns: [],
      customActions: [],
      hidden: false,
    });
    return true;
  },
  removeReport(s, a) {
    const before = s.reports.length;
    s.reports = s.reports.filter((r) => !nameEq(r.name, a.name) && !nameEq(r.displayName, a.name));
    return s.reports.length < before;
  },

  /* Pages */
  addPage(s, a) {
    const ident = toIdent(a.name);
    if (findByName(s.pages, ident)) return false;
    const embeds = a.embeds || [];
    s.pages.push({
      name: ident,
      displayName: a.name,
      section: a.section || 'Default',
      embeddedForms: embeds.filter((e) => e.kind === 'form').map((e) => toIdent(e.name)),
      embeddedReports: embeds.filter((e) => e.kind === 'report').map((e) => toIdent(e.name)),
      hasScript: false,
    });
    return true;
  },
  removePage(s, a) {
    const before = s.pages.length;
    s.pages = s.pages.filter((p) => !nameEq(p.name, a.name) && !nameEq(p.displayName, a.name));
    return s.pages.length < before;
  },

  /* Workflows */
  addWorkflow(s, a) {
    const ident = toIdent(a.name);
    if (findByName(s.workflows, ident)) return false;
    s.workflows.push({
      name: ident,
      displayName: a.name,
      scope: a.trigger ? 'form' : 'button',
      type: 'workflow',
      form: a.trigger?.form ? toIdent(a.trigger.form) : '',
      event: a.trigger?.event || (a.trigger ? 'on add' : ''),
      actionKinds: [],
      description: '',
    });
    return true;
  },
  removeWorkflow(s, a) {
    const before = s.workflows.length;
    s.workflows = s.workflows.filter((w) => !nameEq(w.name, a.name) && !nameEq(w.displayName, a.name));
    return s.workflows.length < before;
  },
  renameWorkflow(s, a) {
    const w = findByName(s.workflows, a.from) || s.workflows.find((x) => nameEq(x.displayName, a.from));
    if (!w) return false;
    w.name = toIdent(a.to);
    w.displayName = a.to;
    return true;
  },

  /* Lookups */
  addLookup(s, a) {
    const fromForm = s.forms.find((f) => nameEq(f.name, a.from) || nameEq(f.displayName, a.from));
    const toForm = s.forms.find((f) => nameEq(f.name, a.to) || nameEq(f.displayName, a.to));
    if (!fromForm || !toForm) return false;
    const lookupKind = a.lookupKind || 'single';
    const exists = s.lookups.find(
      (l) => nameEq(l.from, fromForm.name) && nameEq(l.to, toForm.name) && nameEq(l.field, a.field)
    );
    if (exists) return false;
    s.lookups.push({
      from: fromForm.name,
      field: a.field,
      to: toForm.name,
      kind: lookupKind,
    });
    // Also reflect on the source form's fields (so Step 2's per-form table shows the lookup)
    fromForm.fields ||= [];
    if (!fromForm.fields.find((x) => nameEq(x.name, a.field))) {
      fromForm.fields.push({
        name: a.field,
        displayName: a.field.replace(/_/g, ' '),
        type: lookupKind === 'multi' ? 'Multi-Select Lookup' :
              lookupKind === 'subform' ? 'Subform' : 'Single Select Lookup',
        required: false,
        unique: false,
        lookup: `${toForm.name}.ID`,
        values: null,
        formula: null,
        maxChar: null,
      });
    }
    return true;
  },

  /* Roles */
  addRole(s, a) {
    if (findByName(s.roles, a.name)) return false;
    s.roles.push({ name: a.name, description: a.description || '', parent: a.parent || null });
    return true;
  },
  removeRole(s, a) {
    const before = s.roles.length;
    s.roles = s.roles.filter((r) => !nameEq(r.name, a.name));
    return s.roles.length < before;
  },

  /* Profiles */
  addProfile(s, a) {
    if (findByName(s.profiles, a.name)) return false;
    const targetForms = (a.forms && a.forms.length)
      ? a.forms
      : s.forms.map((f) => f.name);
    s.profiles.push({
      name: a.name,
      description: '',
      type: 'standard',
      modulePermissions: targetForms.map((fname) => ({
        form: toIdent(fname),
        enabled: actionsToCreatorEnabled(a.actions),
        allFieldsVisible: true,
        reportPermissions: [],
      })),
    });
    return true;
  },
  removeProfile(s, a) {
    const before = s.profiles.length;
    s.profiles = s.profiles.filter((p) => !nameEq(p.name, a.name));
    return s.profiles.length < before;
  },

  /* Custom Functions */
  addCustomFunction(s, a) {
    if (findByName(s.customFunctions, a.name)) return false;
    s.customFunctions.push({
      name: a.name,
      namespace: '',
      returnType: a.returnType || 'void',
      params: [],
      purpose: a.purpose || '',
      language: 'Deluge',
    });
    return true;
  },
  removeCustomFunction(s, a) {
    const before = s.customFunctions.length;
    s.customFunctions = s.customFunctions.filter((f) => !nameEq(f.name, a.name));
    return s.customFunctions.length < before;
  },

  /* Connections */
  addConnection(s, a) {
    if (s.connections.find((c) => nameEq(c.service, a.service))) return false;
    s.connections.push({
      service: a.service,
      authType: a.authType || 'oauth2',
      purpose: a.purpose || '',
    });
    return true;
  },
  removeConnection(s, a) {
    const before = s.connections.length;
    s.connections = s.connections.filter((c) => !nameEq(c.service, a.service));
    return s.connections.length < before;
  },

  /* Blueprints */
  addBlueprint(s, a) {
    const ident = toIdent(a.name);
    if (s.blueprints && s.blueprints.find((b) => nameEq(b.name, ident))) return false;
    s.blueprints ||= [];
    const formObj = s.forms.find((f) => nameEq(f.name, a.form) || nameEq(f.displayName, a.form));
    const formName = formObj ? formObj.name : toIdent(a.form);
    const stageList = (a.stageList || []);
    const stages = stageList.length
      ? stageList.map((st, i) => ({
          name: toIdent(st),
          displayName: st,
          isInitial: i === 0,
          isTerminal: i === stageList.length - 1,
        }))
      : [
          { name: 'Draft', displayName: 'Draft', isInitial: true, isTerminal: false },
          { name: 'In_Review', displayName: 'In Review', isInitial: false, isTerminal: false },
          { name: 'Approved', displayName: 'Approved', isInitial: false, isTerminal: false },
          { name: 'Completed', displayName: 'Completed', isInitial: false, isTerminal: true },
        ];
    s.blueprints.push({
      name: ident,
      displayName: a.name,
      form: formName,
      runWhen: 'always',
      criteria: '',
      stages,
      transitions: [],
      description: '',
    });
    return true;
  },
  removeBlueprint(s, a) {
    s.blueprints ||= [];
    const before = s.blueprints.length;
    s.blueprints = s.blueprints.filter((b) => !nameEq(b.name, a.name) && !nameEq(b.displayName, a.name));
    return s.blueprints.length < before;
  },
  addBlueprintStage(s, a) {
    s.blueprints ||= [];
    const bp = s.blueprints.find((b) => nameEq(b.name, a.blueprint) || nameEq(b.displayName, a.blueprint));
    if (!bp) return false;
    if (bp.stages.find((st) => nameEq(st.name, a.stage))) return false;
    bp.stages.forEach((st) => { st.isTerminal = false; });
    bp.stages.push({ name: toIdent(a.stage), displayName: a.stage, isInitial: false, isTerminal: true });
    return true;
  },
  addTransition(s, a) {
    s.blueprints ||= [];
    const bp = s.blueprints.find((b) => nameEq(b.name, a.blueprint) || nameEq(b.displayName, a.blueprint));
    if (!bp) return false;
    if (bp.transitions.find((t) => nameEq(t.name, a.name))) return false;
    bp.transitions.push({
      name: a.name,
      from: toIdent(a.from),
      to: toIdent(a.to),
      owners: a.owners || ['all'],
      criteria: '',
      beforeWorkflow: '',
      afterWorkflow: '',
      description: '',
    });
    return true;
  },

  /* Batch Workflows */
  addBatchWorkflow(s, a) {
    s.batchWorkflows ||= [];
    const ident = toIdent(a.name);
    if (s.batchWorkflows.find((b) => nameEq(b.name, ident))) return false;
    const formObj = s.forms.find((f) => nameEq(f.name, a.form) || nameEq(f.displayName, a.form));
    const formName = formObj ? formObj.name : toIdent(a.form || '');
    s.batchWorkflows.push({
      name: ident,
      displayName: a.name,
      form: formName,
      criteria: a.criteria || '',
      frequency: a.frequency || 'on_demand',
      scheduleName: '',
      delugeScript: '',
      description: '',
    });
    return true;
  },
  removeBatchWorkflow(s, a) {
    s.batchWorkflows ||= [];
    const before = s.batchWorkflows.length;
    s.batchWorkflows = s.batchWorkflows.filter((b) => !nameEq(b.name, a.name) && !nameEq(b.displayName, a.name));
    return s.batchWorkflows.length < before;
  },

  /* Schedules */
  addSchedule(s, a) {
    if (findByName(s.schedules, a.name)) return false;
    s.schedules.push({
      name: toIdent(a.name),
      frequency: a.frequency || 'daily',
      cron: null,
      calls: a.calls || '',
    });
    return true;
  },
  removeSchedule(s, a) {
    const before = s.schedules.length;
    s.schedules = s.schedules.filter((sc) => !nameEq(sc.name, a.name));
    return s.schedules.length < before;
  },

  /* Public APIs */
  addPublicAPI(s, a) {
    if (s.publicAPIs.find((x) => x.method === a.method && x.path === a.path)) return false;
    s.publicAPIs.push({
      method: a.method,
      path: a.path,
      baseForm: a.baseForm ? toIdent(a.baseForm) : '',
      auth: 'apikey',
      purpose: a.purpose || '',
    });
    return true;
  },
  removePublicAPI(s, a) {
    const before = s.publicAPIs.length;
    s.publicAPIs = s.publicAPIs.filter((x) => !(x.method === a.method && x.path === a.path));
    return s.publicAPIs.length < before;
  },

  /* NFRs */
  addNfr(s, a) {
    if (s.nfrs.find((x) => x.category === a.category && x.statement === a.statement)) return false;
    s.nfrs.push({ category: a.category, statement: a.statement });
    return true;
  },
  addAssumption(s, a) {
    if (s.assumptions.includes(a.statement)) return false;
    s.assumptions.push(a.statement);
    return true;
  },
  addOutOfScope(s, a) {
    if (s.outOfScope.includes(a.statement)) return false;
    s.outOfScope.push(a.statement);
    return true;
  },

  /* Meta */
  setApplication(s, a) {
    s.application.name = a.name;
    s.meta.title = a.name;
    return true;
  },
  setTitle(s, a) {
    s.meta.title = a.title;
    return true;
  },
  setTimezone(s, a) {
    s.application.timeZone = a.tz;
    return true;
  },
  setDateFormat(s, a) {
    s.application.dateFormat = a.fmt;
    return true;
  },
  setEdition(s, a) {
    s.application.edition = a.edition;
    return true;
  },
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function clean(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

function toIdent(s) {
  return clean(s).replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '');
}

function nameEq(a, b) {
  return clean(a).toLowerCase() === clean(b).toLowerCase();
}

function findByName(arr, name, key = 'name') {
  return arr.find((x) => nameEq(x[key], name));
}

function normaliseEvent(raw) {
  if (!raw) return 'on add';
  const e = String(raw).trim().toLowerCase();
  if (/^on\s/.test(e)) return e;
  if (/(create|add|submit)/.test(e)) return 'on add';
  if (/(edit|update|modify)/.test(e)) return 'on edit';
  if (/delete/.test(e)) return 'on delete';
  if (/validate/.test(e)) return 'on validate';
  return `on ${e}`;
}

function normaliseAuth(raw) {
  if (!raw) return 'oauth2';
  const v = String(raw).toLowerCase().replace(/\s+/g, '');
  if (v.startsWith('oauth')) return 'oauth2';
  if (v.includes('key')) return 'apikey';
  if (v === 'basic') return 'basic';
  return 'oauth2';
}

/**
 * Map BRD-style field types onto canonical Creator labels.
 * Returns a Creator-shaped field object (matches the schema in scope.js).
 */
function asCreatorField(f) {
  if (!f) return f;
  const TYPE_MAP = {
    text: 'Single Line', string: 'Single Line',
    longtext: 'Multi Line', multiline: 'Multi Line',
    number: 'Number', int: 'Number', integer: 'Number',
    decimal: 'Decimal', float: 'Decimal', double: 'Decimal',
    currency: 'Currency', money: 'Currency', usd: 'Currency',
    percent: 'Percent',
    date: 'Date', datetime: 'Date-Time', time: 'Time',
    email: 'Email', phone: 'Phone', tel: 'Phone',
    url: 'URL', boolean: 'Decision Box', bool: 'Decision Box',
    enum: 'Dropdown', select: 'Dropdown', dropdown: 'Dropdown',
    multiselect: 'Multi-Select',
    uuid: 'Auto Number', auto: 'Auto Number',
    json: 'Multi Line', file: 'File Upload', image: 'Image',
  };
  const lower = String(f.type || '').toLowerCase();
  let type = TYPE_MAP[lower] || (f.type ? titleCase(f.type) : 'Single Line');
  let lookup = null;
  if (f.fk) {
    type = 'Single Select Lookup';
    lookup = `${toIdent(f.fk)}.ID`;
  }
  return {
    name: f.name,
    displayName: f.displayName || (f.name || '').replace(/_/g, ' '),
    type,
    required: !!f.required,
    unique: !!f.unique,
    lookup,
    values: f.values || null,
    formula: f.formula || null,
    maxChar: f.maxChar || null,
  };
}

function titleCase(s) {
  return String(s).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function actionsToCreatorEnabled(actions = []) {
  const out = new Set(['Tab']);
  for (const a of actions) {
    const v = String(a).toLowerCase();
    if (v === 'read' || v === 'view') out.add('Viewall');
    else if (v === 'create' || v === 'write') { out.add('Create'); out.add('Modifyall'); }
    else if (v === 'update' || v === 'edit') out.add('Modifyall');
    else if (v === 'delete') out.add('Modifyall');
    else if (v === 'export') out.add('Export');
    else if (v === 'import') out.add('Import');
    else if (v === 'approve') out.add('Modifyall');
    else if (v === 'all' || v === 'crud') {
      out.add('Create'); out.add('Viewall'); out.add('Modifyall');
      out.add('Import'); out.add('Export');
    }
  }
  return Array.from(out);
}

function parseFieldList(s) {
  if (!s) return [];
  // Split on top-level commas only — preserve commas inside (...).
  const parts = [];
  let depth = 0;
  let buf = '';
  for (const ch of String(s)) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.map((p) => parseFieldDescriptor(p));
}

function parseFieldDescriptor(name, opts = '') {
  // name may itself be "field (type, required)"
  let n = name, o = opts || '';
  const inline = String(name).match(/^([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*$/);
  if (inline) { n = inline[1]; o = inline[2]; }
  const field = { name: clean(n).replace(/\s+/g, '_'), type: 'text', required: false };
  if (o) {
    const parts = String(o).split(',').map((p) => p.trim()).filter(Boolean);
    for (const p of parts) {
      const low = p.toLowerCase();
      if (low === 'required' || low === 'mandatory') field.required = true;
      else if (low === 'unique') field.unique = true;
      else if (/^fk:/i.test(p)) field.fk = p.slice(3).trim(); // preserve original case
      else if (/^(text|number|int|integer|decimal|float|boolean|bool|date|datetime|email|phone|url|uuid|json|currency|percent)$/i.test(p)) {
        field.type = low;
      }
    }
  }
  return field;
}

function parseActionList(s) {
  if (!s) return [];
  return s
    .split(/[,\s]+(?:and\s+)?/i)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => /^(read|write|create|update|delete|approve|view|edit|export|import|all|crud)$/.test(p));
}

function parseFormList(s) {
  if (!s) return [];
  if (/^all\s+forms?$/i.test(s.trim())) return [];
  return s.split(/\s*,\s*|\s+and\s+/i).map(clean).filter(Boolean);
}

function parseEmbedList(s) {
  if (!s) return [];
  // "Form: Customer, Report: All_Customers, Order"   (default → form)
  return s.split(/\s*,\s*/).filter(Boolean).map((part) => {
    const m = part.match(/^(form|report)\s*[:\-]\s*(.+)$/i);
    if (m) return { kind: m[1].toLowerCase(), name: clean(m[2]) };
    return { kind: 'form', name: clean(part) };
  });
}

/* Re-export tiny bits used by tests */
export const __test__ = { matchLine, parseFieldDescriptor, parseFieldList, parseActionList, asCreatorField, toIdent };
