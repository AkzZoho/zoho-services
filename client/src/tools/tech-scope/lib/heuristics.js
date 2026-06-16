/**
 * heuristics.js — turn raw BRD text into a *draft* **Zoho Creator** scope,
 * with **zero AI calls**. Pure, deterministic, regex-driven.
 *
 * The parser is intentionally liberal: it would rather create an extra item
 * the user can delete via the DSL than miss one entirely.
 *
 * Field-type strings emitted here use the canonical Creator labels declared
 * in `client/src/tools/ds-analyser/lib/fieldTypes.js`.
 */

import { emptyScope, stamp } from './scope.js';

/* -------------------------------------------------------------------------- */
/*  Public entry                                                               */
/* -------------------------------------------------------------------------- */

/**
 * @param {string} text  raw BRD text (already extracted by parseBRD.js)
 * @param {object} [opts] { title?: string, sourceFile?: string }
 * @returns {object} draft Creator scope
 */
export function deriveScope(text, opts = {}) {
  const scope = emptyScope();
  const guessed = guessTitle(text);
  scope.meta.title = opts.title || guessed || 'Untitled Creator App';
  scope.meta.sourceFile = opts.sourceFile || null;
  scope.application.name = opts.title || guessed || 'Untitled_App';

  if (!text || typeof text !== 'string') return stamp(scope);

  extractForms(text, scope);
  extractReports(text, scope);
  extractPages(text, scope);
  extractWorkflows(text, scope);
  extractBlueprints(text, scope);
  extractBatchWorkflows(text, scope);
  extractLookups(text, scope);
  extractRolesAndProfiles(text, scope);
  extractCustomFunctions(text, scope);
  extractConnections(text, scope);
  extractSchedules(text, scope);
  extractPublicAPIs(text, scope);
  extractNFRsAndAssumptions(text, scope);
  applicationDefaultsFromText(text, scope);

  return stamp(scope);
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function uniquePush(arr, item, keyFn = (x) => (x.name || '').toLowerCase()) {
  if (!item) return;
  const k = keyFn(item);
  if (!k) return;
  if (arr.some((x) => keyFn(x) === k)) return;
  arr.push(item);
}

function titleCase(s) {
  return String(s || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}

function safeIdent(s) {
  return titleCase(s).replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '');
}

function lines(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function guessTitle(text) {
  for (const l of lines(text).slice(0, 10)) {
    if (l.length > 4 && l.length <= 80 && !/\.{2,}/.test(l) && /[A-Za-z]/.test(l)) {
      return l.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim();
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Application defaults                                                       */
/* -------------------------------------------------------------------------- */

function applicationDefaultsFromText(text, scope) {
  const tz = text.match(/\b(?:time\s*zone|timezone)\s*[:\-]?\s*([A-Za-z_]+\/[A-Za-z_]+)/i);
  if (tz) scope.application.timeZone = tz[1];

  const date = text.match(/\bdate\s*format\s*[:\-]?\s*([A-Za-z\-/]+)/i);
  if (date) scope.application.dateFormat = date[1];

  if (/\bflex\s+edition\b/i.test(text)) scope.application.edition = 'flex';
  else if (/\bstandard\s+edition\b/i.test(text)) scope.application.edition = 'standard';
  else if (/\bprofessional\s+edition\b/i.test(text)) scope.application.edition = 'professional';
}

/* -------------------------------------------------------------------------- */
/*  Forms                                                                      */
/* -------------------------------------------------------------------------- */

function extractForms(text, scope) {
  // Pattern A: "Form: <Name>" / "Master: <Name>"
  const reLabeled = /^\s*(?:[-*•]\s*)?(?:form|master)\s*[:\-–]\s*([A-Z][A-Za-z0-9 _-]{2,60})\s*$/gim;
  let m;
  while ((m = reLabeled.exec(text)) !== null) {
    addForm(scope, m[1]);
  }

  // Pattern B: "<Name> form" / "<Name> master"
  const reTrailing = /\b([A-Z][A-Za-z0-9_]+(?:\s+[A-Z][A-Za-z0-9_]+){0,3})\s+(?:form|master)\b/g;
  while ((m = reTrailing.exec(text)) !== null) {
    const name = titleCase(m[1]);
    if (name.length >= 3 && !/^(The|A|An|This|That|These|Those|Form|Master)$/i.test(name)) {
      addForm(scope, name);
    }
  }

  // Pattern C: bullet lists under a "Forms:" / "Masters:" heading
  const headingBlocks = text.split(/\n(?=#+\s)|\n(?=[A-Z][A-Za-z ]{2,30}:\s*$)/m);
  for (const block of headingBlocks) {
    const head = block.split('\n')[0].toLowerCase();
    if (!/^[#\s]*(forms?|masters?)\b/i.test(head)) continue;
    const bullets = block.match(/^\s*[-*•]\s+(.+)$/gm) || [];
    for (const b of bullets) {
      const name = titleCase(b.replace(/^\s*[-*•]\s+/, '').split(/[:\-–]/)[0]);
      if (name.length >= 3 && name.length < 60) addForm(scope, name);
    }
  }
}

function addForm(scope, rawName) {
  const display = titleCase(rawName);
  const ident = safeIdent(rawName);
  if (!ident) return;
  uniquePush(
    scope.forms,
    {
      name: ident,
      displayName: display,
      purpose: '',
      fields: [],
      actionEvents: ['on add', 'on edit'],
    },
    (x) => x.name.toLowerCase()
  );
}

/* -------------------------------------------------------------------------- */
/*  Reports                                                                    */
/* -------------------------------------------------------------------------- */

const REPORT_TYPE_HINTS = [
  { kind: 'kanban',      re: /\bkanban\b/i },
  { kind: 'calendar',    re: /\bcalendar\s+view\b/i },
  { kind: 'timeline',    re: /\btimeline\s+view\b/i },
  { kind: 'map',         re: /\bmap\s+view\b/i },
  { kind: 'pivot',       re: /\bpivot\b/i },
  { kind: 'summary',     re: /\bsummary\s+(?:report|view)\b/i },
  { kind: 'spreadsheet', re: /\bspreadsheet\s+view\b/i },
  { kind: 'grid',        re: /\bgrid\s+view\b/i },
];

function extractReports(text, scope) {
  // Pattern A: "Report: <Name>" / "View: <Name>"
  const reLabeled = /^\s*(?:[-*•]\s*)?(?:report|view|listing|dashboard)\s*[:\-–]\s*([A-Z][A-Za-z0-9 _-]{2,60})\s*$/gim;
  let m;
  while ((m = reLabeled.exec(text)) !== null) {
    addReport(scope, m[1]);
  }

  // Pattern B: "list of <X>" / "view all <X>" / "<X> listing"
  const reList = /\b(?:list of|view all|listing of|all)\s+([A-Z][A-Za-z0-9_]+(?:\s+[A-Z][A-Za-z0-9_]+){0,2})\b/g;
  while ((m = reList.exec(text)) !== null) {
    const baseName = titleCase(m[1]);
    addReport(scope, `All_${safeIdent(baseName)}`, baseName, 'list');
  }

  // Pattern C: explicit type hints anywhere in the document
  for (const hint of REPORT_TYPE_HINTS) {
    if (!hint.re.test(text)) continue;
    // Try to find a name near the hint
    const re = new RegExp(`\\b([A-Z][A-Za-z0-9_]+)\\s+${hint.re.source}`, 'gi');
    let mm;
    while ((mm = re.exec(text)) !== null) {
      addReport(scope, `${safeIdent(mm[1])}_${hint.kind}`, titleCase(mm[1]), hint.kind);
    }
  }
}

function addReport(scope, rawName, baseFormName = '', type = 'list') {
  const ident = safeIdent(rawName);
  if (!ident) return;
  let baseForm = '';
  if (baseFormName) {
    const match = scope.forms.find(
      (f) => f.name.toLowerCase() === safeIdent(baseFormName).toLowerCase() ||
             f.displayName.toLowerCase() === titleCase(baseFormName).toLowerCase()
    );
    baseForm = match ? match.name : safeIdent(baseFormName);
  }
  uniquePush(
    scope.reports,
    {
      name: ident,
      displayName: titleCase(rawName),
      type,
      baseForm,
      columns: [],
      customActions: [],
      hidden: false,
    },
    (x) => x.name.toLowerCase()
  );
}

/* -------------------------------------------------------------------------- */
/*  Pages                                                                      */
/* -------------------------------------------------------------------------- */

function extractPages(text, scope) {
  // "Page: <Name>" / "Dashboard: <Name>" / "Home page: <Name>"
  const reLabeled = /^\s*(?:[-*•]\s*)?(?:page|dashboard|home\s*page|landing\s*page)\s*[:\-–]\s*([A-Z][A-Za-z0-9 _-]{2,60})\s*$/gim;
  let m;
  while ((m = reLabeled.exec(text)) !== null) {
    addPage(scope, m[1]);
  }

  // "<X> dashboard" sentences
  const reDash = /\b([A-Z][A-Za-z0-9_]+(?:\s+[A-Z][A-Za-z0-9_]+){0,2})\s+dashboard\b/g;
  while ((m = reDash.exec(text)) !== null) {
    addPage(scope, `${titleCase(m[1])} Dashboard`);
  }
}

function addPage(scope, rawName) {
  const ident = safeIdent(rawName);
  if (!ident) return;
  uniquePush(
    scope.pages,
    {
      name: ident,
      displayName: titleCase(rawName),
      section: 'Default',
      embeddedForms: [],
      embeddedReports: [],
      hasScript: false,
    },
    (x) => x.name.toLowerCase()
  );
}

/* -------------------------------------------------------------------------- */
/*  Workflows                                                                  */
/* -------------------------------------------------------------------------- */

const WF_VERBS = /\b(approve|approval|notify|notification|send|generate|escalate|trigger|process|onboard|review|reject|publish|sync|import|export|calculate|update)\b/i;

const EVENT_HINTS = [
  { event: 'on add',      re: /\b(?:on\s+(?:create|submit|add)|when\s+(?:created|submitted|added))\b/i },
  { event: 'on edit',     re: /\b(?:on\s+(?:edit|update|modify)|when\s+(?:edited|updated|modified))\b/i },
  { event: 'on delete',   re: /\b(?:on\s+delete|when\s+deleted)\b/i },
  { event: 'on validate', re: /\b(?:on\s+validate|on\s+save\s+validation)\b/i },
];

function extractWorkflows(text, scope) {
  // Pattern A: "Workflow: <Name>" / "Process: <Name>" / "Automation: <Name>"
  const reLabeled = /^\s*(?:[-*•]\s*)?(?:workflow|process|automation|rule)\s*[:\-–]\s*([A-Z][A-Za-z0-9 _-]{2,60})\s*$/gim;
  let m;
  while ((m = reLabeled.exec(text)) !== null) {
    addWorkflow(scope, m[1], guessEvent(text, m.index));
  }

  // Pattern B: "<Verb> <object>" sentences
  for (const l of lines(text)) {
    if (!WF_VERBS.test(l)) continue;
    if (l.length > 160) continue;
    const verbMatch = l.match(/\b(approve|notify|send|generate|escalate|process|onboard|review|reject|publish|sync|import|export|calculate|update)\s+([A-Za-z][A-Za-z0-9 _-]{2,40})/i);
    if (!verbMatch) continue;
    const name = titleCase(`${verbMatch[1]} ${verbMatch[2]}`);
    addWorkflow(scope, name, guessEventInLine(l));
  }

  // Cap to keep drafts readable
  scope.workflows = scope.workflows.slice(0, 16);
}

function guessEvent(text, idx) {
  const window = text.slice(Math.max(0, idx - 80), idx + 140);
  return guessEventInLine(window);
}

function guessEventInLine(s) {
  for (const h of EVENT_HINTS) if (h.re.test(s)) return h.event;
  return 'on add';
}

function addWorkflow(scope, rawName, event = 'on add') {
  const ident = safeIdent(rawName);
  if (!ident) return;
  uniquePush(
    scope.workflows,
    {
      name: ident,
      displayName: titleCase(rawName),
      scope: 'form',
      type: 'workflow',
      form: '',
      event,
      actionKinds: [],
      description: '',
    },
    (x) => x.name.toLowerCase()
  );
}

/* -------------------------------------------------------------------------- */
/*  Blueprints (state machines / process flows)                               */
/* -------------------------------------------------------------------------- */

// Phrases that indicate a multi-stage process (→ Blueprint, not a simple Workflow)
const BLUEPRINT_INDICATORS = /\b(stages?|transitions?|lifecycle|process\s+flow|state\s+machine|approval\s+stages?|multi[\s-]?stage|status\s+moves?|status\s+changes?\s+through|goes?\s+through\s+stages?)\b/i;

// Common stage-transition vocabulary
const STAGE_VERB_RE = /\b(submit|approve|reject|escalate|assign|dispatch|ship|deliver|receive|close|complete|cancel|review|verify|publish|return|reopen)\b/gi;

function extractBlueprints(text, scope) {
  // Explicit "Blueprint: <Name>" label
  const reLabeled = /^\s*(?:[-*•]\s*)?blueprint\s*[:\-–]\s*([A-Z][A-Za-z0-9 _-]{2,60})/gim;
  let m;
  while ((m = reLabeled.exec(text)) !== null) {
    const bpName = titleCase(m[1]);
    // Try to guess the associated form
    const windowText = text.slice(m.index, m.index + 300);
    const formGuess = guessFormForBlueprint(windowText, scope);
    addBlueprint(scope, bpName, formGuess, windowText);
  }

  // Implicit: a form + multi-stage language nearby
  if (!BLUEPRINT_INDICATORS.test(text)) return;

  for (const f of scope.forms) {
    const formRe = new RegExp(`\\b${escapeRegexH(f.displayName)}\\b`, 'i');
    // Find mentions of this form near blueprint indicators
    const re = new RegExp(
      `(${escapeRegexH(f.displayName)}|${escapeRegexH(f.name)})` +
      `.{0,200}` +
      BLUEPRINT_INDICATORS.source,
      'gi'
    );
    if (re.test(text)) {
      const bpName = `${f.displayName} Process`;
      if (!scope.blueprints.find((b) => b.form === f.name)) {
        // Extract stage names near this form mention
        const stageWindow = text.slice(
          Math.max(0, text.search(formRe) - 100),
          Math.min(text.length, text.search(formRe) + 600)
        );
        addBlueprint(scope, bpName, f.name, stageWindow);
      }
    }
  }

  // Cap
  scope.blueprints = scope.blueprints.slice(0, 6);
}

function guessFormForBlueprint(windowText, scope) {
  for (const f of scope.forms) {
    if (new RegExp(`\\b${escapeRegexH(f.displayName)}\\b`, 'i').test(windowText)) {
      return f.name;
    }
  }
  return scope.forms.length ? scope.forms[0].name : '';
}

function addBlueprint(scope, rawName, formName, contextText) {
  const ident = safeIdent(rawName);
  if (!ident) return;
  if (scope.blueprints.find((b) => b.name.toLowerCase() === ident.toLowerCase())) return;

  // Extract stage names from context
  const stages = extractStageNames(contextText);
  // Extract transition verbs from context
  const transitions = extractTransitionNames(contextText, stages);

  scope.blueprints.push({
    name: ident,
    displayName: titleCase(rawName),
    form: formName,
    runWhen: 'always',
    criteria: '',
    stages,
    transitions,
    description: '',
  });
}

function extractStageNames(text) {
  const stages = [];
  // Look for explicit stage lists: "stages: New, Pending, Approved, Closed"
  const stageList = text.match(/stages?\s*[:\-–]\s*([A-Za-z][A-Za-z0-9 ,_-]{5,200})/i);
  if (stageList) {
    const names = stageList[1].split(/\s*[,;→>\|]\s*/).map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 40);
    for (let i = 0; i < names.length; i++) {
      stages.push({
        name: safeIdent(names[i]),
        displayName: titleCase(names[i]),
        isInitial: i === 0,
        isTerminal: i === names.length - 1,
      });
    }
    return stages;
  }

  // Fallback: generic stages based on common lifecycle words
  const defaultStages = ['Draft', 'Pending Review', 'Approved', 'Completed'];
  return defaultStages.map((s, i) => ({
    name: safeIdent(s),
    displayName: s,
    isInitial: i === 0,
    isTerminal: i === defaultStages.length - 1,
  }));
}

function extractTransitionNames(text, stages) {
  const transitions = [];
  const verbs = new Set();
  let m;
  const re = new RegExp(STAGE_VERB_RE.source, 'gi');
  while ((m = re.exec(text)) !== null) {
    verbs.add(titleCase(m[0]));
    if (verbs.size >= 5) break;
  }
  if (verbs.size === 0) {
    verbs.add('Submit'); verbs.add('Approve'); verbs.add('Reject');
  }

  const stageNames = stages.map((s) => s.name);
  const verbArr = Array.from(verbs);
  for (let i = 0; i < Math.min(verbArr.length, stageNames.length - 1); i++) {
    transitions.push({
      name: verbArr[i],
      from: stageNames[i] || 'Draft',
      to: stageNames[i + 1] || 'Completed',
      owners: ['all'],
      criteria: '',
      beforeWorkflow: '',
      afterWorkflow: '',
      description: '',
    });
  }
  return transitions;
}

function escapeRegexH(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* -------------------------------------------------------------------------- */
/*  Batch Workflows (bulk record processors)                                   */
/* -------------------------------------------------------------------------- */

const BATCH_INDICATORS = /\b(bulk\s+update|batch\s+process|mass\s+(?:email|update|notify)|process\s+all|for\s+all\s+records|bulk\s+send|bulk\s+assign|bulk\s+close)\b/i;

function extractBatchWorkflows(text, scope) {
  // Explicit "Batch Workflow: <Name>"
  const reLabeled = /^\s*(?:[-*•]\s*)?batch\s+workflow\s*[:\-–]\s*([A-Za-z0-9 _-]{2,60})/gim;
  let m;
  while ((m = reLabeled.exec(text)) !== null) {
    const windowText = text.slice(Math.max(0, m.index - 100), m.index + 300);
    const formGuess = guessFormForBlueprint(windowText, scope);
    const freqGuess = guessBatchFrequency(windowText);
    pushBatchWorkflow(scope, m[1], formGuess, freqGuess, '');
  }

  // Implicit: bulk processing language near a known form
  if (!BATCH_INDICATORS.test(text)) return;

  const batchRe = new RegExp(BATCH_INDICATORS.source, 'gi');
  while ((m = batchRe.exec(text)) !== null) {
    const windowText = text.slice(Math.max(0, m.index - 80), m.index + 250);
    const formGuess = guessFormForBlueprint(windowText, scope);
    if (!formGuess) continue;
    const verb = titleCase(m[0].replace(/\s+/g, '_'));
    const name = `${verb}_${formGuess}`;
    const freq = guessBatchFrequency(windowText);
    pushBatchWorkflow(scope, name, formGuess, freq, '');
  }

  scope.batchWorkflows = scope.batchWorkflows.slice(0, 6);
}

function guessBatchFrequency(text) {
  if (/\bdaily\b|\bevery\s+day\b/i.test(text)) return 'daily';
  if (/\bweekly\b|\bevery\s+week\b/i.test(text)) return 'weekly';
  if (/\bmonthly\b|\bevery\s+month\b/i.test(text)) return 'monthly';
  return 'on_demand';
}

function pushBatchWorkflow(scope, rawName, form, frequency, delugeScript) {
  const ident = safeIdent(rawName);
  if (!ident) return;
  if (scope.batchWorkflows.find((b) => b.name.toLowerCase() === ident.toLowerCase())) return;
  scope.batchWorkflows.push({
    name: ident,
    displayName: titleCase(rawName),
    form,
    criteria: '',
    frequency,
    scheduleName: '',
    delugeScript,
    description: '',
  });
}

/* -------------------------------------------------------------------------- */
/*  Lookups (relationships)                                                    */
/* -------------------------------------------------------------------------- */

function extractLookups(text, scope) {
  // "<A> belongs to <B>" / "<A> has many <B>" / "<A> references <B>"
  const re1 = /\b([A-Z][A-Za-z0-9_]{2,30})\s+(?:belongs\s+to|references|linked\s+to)\s+([A-Z][A-Za-z0-9_]{2,30})\b/g;
  let m;
  while ((m = re1.exec(text)) !== null) {
    pushLookup(scope, m[1], m[2], 'single', `${safeIdent(m[2])}_lookup`);
  }
  const re2 = /\b([A-Z][A-Za-z0-9_]{2,30})\s+has\s+many\s+([A-Z][A-Za-z0-9_]{2,30})\b/gi;
  while ((m = re2.exec(text)) !== null) {
    pushLookup(scope, m[2], m[1], 'single', `${safeIdent(m[1])}_lookup`);
  }
}

function pushLookup(scope, fromName, toName, kind, fieldName) {
  const fromForm = scope.forms.find((f) => f.name.toLowerCase() === safeIdent(fromName).toLowerCase());
  const toForm = scope.forms.find((f) => f.name.toLowerCase() === safeIdent(toName).toLowerCase());
  if (!fromForm || !toForm) return; // only emit lookups between forms we already know
  scope.lookups.push({
    from: fromForm.name,
    field: fieldName,
    to: toForm.name,
    kind,
  });
}

/* -------------------------------------------------------------------------- */
/*  Roles & Profiles                                                           */
/* -------------------------------------------------------------------------- */

const ROLE_KEYWORDS = /\b(admin|administrator|user|manager|reviewer|approver|requester|customer|vendor|sales\s*rep|finance|hr|employee|guest|owner|operator|ceo|cfo|director|supervisor|clerk|agent)\b/gi;

function extractRolesAndProfiles(text, scope) {
  const seen = new Set();
  let m;
  while ((m = ROLE_KEYWORDS.exec(text)) !== null) {
    const name = titleCase(m[1]);
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    scope.roles.push({ name, description: '', parent: null });
  }
  scope.roles = scope.roles.slice(0, 8);

  // Build a default "Standard" profile granting Tab + Viewall on every form
  if (scope.forms.length) {
    scope.profiles.push({
      name: 'Standard',
      description: 'Default permission profile (read-only access to every form). Tighten as needed.',
      type: 'standard',
      modulePermissions: scope.forms.map((f) => ({
        form: f.name,
        enabled: ['Tab', 'Viewall'],
        allFieldsVisible: true,
        reportPermissions: scope.reports
          .filter((r) => r.baseForm === f.name)
          .map((r) => ({ report: r.name, actions: ['View'] })),
      })),
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Custom functions                                                           */
/* -------------------------------------------------------------------------- */

function extractCustomFunctions(text, scope) {
  // "Custom function: <name>" / "Function: <name>" / "Calculate <X>"
  const reLabeled = /^\s*(?:[-*•]\s*)?(?:custom\s+function|deluge\s+function|function)\s*[:\-–]\s*([a-zA-Z_][A-Za-z0-9_]{1,60})/gim;
  let m;
  while ((m = reLabeled.exec(text)) !== null) {
    pushFn(scope, m[1]);
  }
  const reCalc = /\b(?:calculate|compute|derive|generate)\s+([a-z][A-Za-z0-9_ ]{2,30})\b/gi;
  while ((m = reCalc.exec(text)) !== null) {
    // Build a stable lower-snake identifier: e.g. "total_amount" → calc_total_amount
    const tail = String(m[1]).trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 20);
    if (!tail) continue;
    pushFn(scope, `calc_${tail}`, `Calculates ${m[1].toLowerCase()}.`);
  }
}

function pushFn(scope, rawName, purpose = '') {
  // Preserve the casing the caller passes in (so `calc_total_amount` stays
  // lower-snake instead of getting title-cased into `Calc_Total_Amount`).
  const trimmed = String(rawName || '').trim();
  // If the name already looks like a valid identifier, keep it verbatim.
  const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)
    ? trimmed
    : safeIdent(trimmed).replace(/^_+/, '');
  if (!ident) return;
  uniquePush(
    scope.customFunctions,
    {
      name: ident,
      namespace: '',
      returnType: 'void',
      params: [],
      purpose,
      language: 'Deluge',
    },
    (x) => x.name.toLowerCase()
  );
}

/* -------------------------------------------------------------------------- */
/*  Connections (third-party services)                                         */
/* -------------------------------------------------------------------------- */

const KNOWN_SERVICES = [
  // Zoho family
  'Zoho CRM', 'Zoho Books', 'Zoho Desk', 'Zoho People', 'Zoho Inventory',
  'Zoho Projects', 'Zoho Analytics', 'Zoho Mail', 'Zoho Sign', 'Zoho WorkDrive',
  // Common 3rd-party
  'Salesforce', 'HubSpot', 'Slack', 'Microsoft Teams', 'Office 365', 'OneDrive',
  'Google Drive', 'Google Calendar', 'Gmail', 'Stripe', 'PayPal', 'Razorpay',
  'Twilio', 'SendGrid', 'Mailchimp', 'AWS S3', 'Dropbox', 'DocuSign',
  'QuickBooks', 'Xero', 'SAP', 'Oracle', 'ServiceDesk Plus', 'ServiceNow',
  'Jira', 'GitHub', 'GitLab', 'Bitbucket',
];

function extractConnections(text, scope) {
  for (const svc of KNOWN_SERVICES) {
    const re = new RegExp(`\\b${escapeRegex(svc)}\\b`, 'i');
    if (re.test(text)) {
      uniquePush(
        scope.connections,
        {
          service: svc,
          authType: 'oauth2',
          purpose: '',
        },
        (x) => x.service.toLowerCase()
      );
    }
  }
  // "API key for <X>"
  const reKey = /\bAPI\s+key\s+(?:for|to)\s+([A-Z][A-Za-z0-9 ]{2,30})\b/g;
  let m;
  while ((m = reKey.exec(text)) !== null) {
    uniquePush(
      scope.connections,
      { service: titleCase(m[1]), authType: 'apikey', purpose: '' },
      (x) => x.service.toLowerCase()
    );
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* -------------------------------------------------------------------------- */
/*  Schedules                                                                  */
/* -------------------------------------------------------------------------- */

const FREQUENCY_HINTS = [
  { freq: 'daily',   re: /\bdaily\b|\bevery\s+day\b/i },
  { freq: 'weekly',  re: /\bweekly\b|\bevery\s+week\b/i },
  { freq: 'monthly', re: /\bmonthly\b|\bevery\s+month\b/i },
  { freq: 'hourly',  re: /\bhourly\b|\bevery\s+hour\b/i },
];

function extractSchedules(text, scope) {
  // "Schedule: <Name>" / "Scheduled job: <Name>"
  const reLabeled = /^\s*(?:[-*•]\s*)?(?:schedule|scheduled\s+job|cron|cron\s+job)\s*[:\-–]\s*([A-Za-z][A-Za-z0-9_ ]{2,60})/gim;
  let m;
  while ((m = reLabeled.exec(text)) !== null) {
    const window = text.slice(Math.max(0, m.index - 80), m.index + 200);
    const freqHit = FREQUENCY_HINTS.find((h) => h.re.test(window));
    pushSchedule(scope, m[1], freqHit ? freqHit.freq : 'daily');
  }
  // "every (day|week|month) ..." sentences
  for (const l of lines(text)) {
    const hit = FREQUENCY_HINTS.find((h) => h.re.test(l));
    if (!hit) continue;
    const name = `${hit.freq}_job_${scope.schedules.length + 1}`;
    if (/\bsend|notify|generate|export|import|sync\b/i.test(l)) {
      pushSchedule(scope, name, hit.freq);
    }
  }
  scope.schedules = scope.schedules.slice(0, 8);
}

function pushSchedule(scope, rawName, frequency) {
  const ident = safeIdent(rawName);
  if (!ident) return;
  uniquePush(
    scope.schedules,
    { name: ident, frequency, cron: null, calls: '' },
    (x) => x.name.toLowerCase()
  );
}

/* -------------------------------------------------------------------------- */
/*  Public REST APIs                                                           */
/* -------------------------------------------------------------------------- */

function extractPublicAPIs(text, scope) {
  const re = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_\-/:{}.]*)/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(text)) !== null) {
    const key = `${m[1]} ${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scope.publicAPIs.push({
      method: m[1].toUpperCase(),
      path: m[2],
      baseForm: '',
      auth: 'apikey',
      purpose: '',
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  NFRs & Assumptions                                                         */
/* -------------------------------------------------------------------------- */

const NFR_HINTS = [
  { cat: 'Performance',   re: /\b(performance|latency|response time|throughput|p\d{2,3}|\bsla\b|seconds? to respond)\b/i },
  { cat: 'Security',      re: /\b(security|encrypt|encryption|gdpr|hipaa|pii|authentication|authorization|oauth|jwt|tls|ssl|rbac)\b/i },
  { cat: 'Scalability',   re: /\b(scal\w*|concurrent users|throughput|records|volume|growth)\b/i },
  { cat: 'Availability',  re: /\b(availab\w*|uptime|99\.\d+%|24x7|24\/7)\b/i },
  { cat: 'Accessibility', re: /\b(accessibility|wcag|aria|screen reader)\b/i },
  { cat: 'Compliance',    re: /\b(compliance|audit|sox|iso\s*27001|soc\s*2)\b/i },
];

const MUST_RE = /\b(must|shall|should|will be required to|is required to)\b/i;
const OOS_RE = /\b(out\s*of\s*scope|not\s+in\s+scope|will\s+not\s+(?:be|include))\b/i;

function extractNFRsAndAssumptions(text, scope) {
  const sentences = text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10 && s.length < 280);

  const seenNfr = new Set();
  const seenAss = new Set();
  const seenOos = new Set();

  for (const s of sentences) {
    if (OOS_RE.test(s)) {
      if (!seenOos.has(s)) { seenOos.add(s); scope.outOfScope.push(s); }
      continue;
    }
    let matchedNfr = false;
    for (const { cat, re } of NFR_HINTS) {
      if (re.test(s)) {
        const key = `${cat}:${s}`;
        if (!seenNfr.has(key)) {
          seenNfr.add(key);
          scope.nfrs.push({ category: cat, statement: s });
        }
        matchedNfr = true;
        break;
      }
    }
    if (matchedNfr) continue;
    if (MUST_RE.test(s)) {
      if (!seenAss.has(s)) { seenAss.add(s); scope.assumptions.push(s); }
    }
  }

  scope.nfrs = scope.nfrs.slice(0, 12);
  scope.assumptions = scope.assumptions.slice(0, 12);
  scope.outOfScope = scope.outOfScope.slice(0, 8);
}
