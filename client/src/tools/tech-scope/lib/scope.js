/**
 * scope.js — canonical shape of a Technical Scope draft for a
 * **Zoho Creator** application.
 *
 * Vocabulary aligns 1:1 with what `dsParser.js` extracts from a real `.ds`
 * file (see `functions/ds-analyzer/src/parsers/dsParser.js`) so a future
 * round-trip — BRD → Tech Scope → built `.ds` → DS Analyser — stays diffable.
 *
 * Field-type strings use the canonical Creator labels defined in
 * `client/src/tools/ds-analyser/lib/fieldTypes.js` (single source of truth):
 *   Single Line · Multi Line · Number · Decimal · Currency · Percent ·
 *   Email · Phone · URL · Date · Date-Time · Time · Image · File Upload ·
 *   Audio · Video · Signature · Address · Name · Users · Notes ·
 *   Dropdown · Radio · Multi-Select · CheckBox · Decision Box ·
 *   Single Select Lookup · Multi-Select Lookup · Subform · Formula ·
 *   Auto Number · Rich Text · Section · Add Notes · Prediction · OCR.
 */

export const SCOPE_SCHEMA_VERSION = 2;

/* -------------------------------------------------------------------------- */
/*  Universal Base Forms                                                        */
/*                                                                             */
/*  These three forms MUST be present in EVERY Zoho Creator application        */
/*  regardless of domain. They are auto-injected during BRD extraction and     */
/*  are protected from removal via the DSL.                                    */
/*                                                                             */
/*  Design rules (apply to ALL forms, not just these three):                   */
/*   ✅ Use a `status` Dropdown (Active / Inactive) for visibility toggling.   */
/*   ⛔ Never use `is_active` Decision Box / CheckBox — all forms are UI-      */
/*      visible; a checkbox toggle is poor UX.                                 */
/*   ⛔ Never add system-timestamp fields (`created_time`, `last_login`,        */
/*      `modified_time`) — they clutter user-facing forms.                     */
/* -------------------------------------------------------------------------- */
export const BASE_FORMS = [
  {
    name: 'Users',
    displayName: 'Users',
    purpose: 'Application user records — who can log in and act on data.',
    _isSystemBase: true,
    fields: [
      { name: 'name',   displayName: 'Name',   type: 'Single Line',          required: true,  unique: false, lookup: null, values: null, formula: null, maxChar: null },
      { name: 'email',  displayName: 'Email',  type: 'Email',                required: true,  unique: true,  lookup: null, values: null, formula: null, maxChar: null },
      { name: 'phone',  displayName: 'Phone',  type: 'Phone',                required: false, unique: false, lookup: null, values: null, formula: null, maxChar: null },
      { name: 'role',   displayName: 'Role',   type: 'Single Select Lookup', required: true,  unique: false, lookup: 'User_Roles.ID', values: null, formula: null, maxChar: null },
      { name: 'status', displayName: 'Status', type: 'Dropdown',             required: true,  unique: false, lookup: null, values: ['Active', 'Inactive', 'Pending'], formula: null, maxChar: null },
    ],
    actionEvents: ['on add', 'on edit'],
  },
  {
    name: 'User_Roles',
    displayName: 'User Roles',
    purpose: 'Role definitions — which roles exist and what they represent.',
    _isSystemBase: true,
    fields: [
      { name: 'role_name',    displayName: 'Role Name',    type: 'Single Line',  required: true,  unique: true,  lookup: null, values: null, formula: null, maxChar: null },
      { name: 'description',  displayName: 'Description',  type: 'Multi Line',   required: false, unique: false, lookup: null, values: null, formula: null, maxChar: null },
      { name: 'permissions',  displayName: 'Permissions',  type: 'Multi-Select', required: false, unique: false, lookup: null, values: ['Create', 'Read', 'Update', 'Delete', 'Approve', 'Export'], formula: null, maxChar: null },
      { name: 'status',       displayName: 'Status',       type: 'Dropdown',     required: true,  unique: false, lookup: null, values: ['Active', 'Inactive'], formula: null, maxChar: null },
    ],
    actionEvents: ['on add', 'on edit'],
  },
  {
    name: 'Email_Templates',
    displayName: 'Email Templates',
    purpose: 'Reusable email content for notifications, approvals, and alerts.',
    _isSystemBase: true,
    fields: [
      { name: 'template_name', displayName: 'Template Name', type: 'Single Line', required: true,  unique: true,  lookup: null, values: null, formula: null, maxChar: null },
      { name: 'subject',       displayName: 'Subject',       type: 'Single Line', required: true,  unique: false, lookup: null, values: null, formula: null, maxChar: null },
      { name: 'body',          displayName: 'Body',          type: 'Rich Text',   required: true,  unique: false, lookup: null, values: null, formula: null, maxChar: null },
      { name: 'category',      displayName: 'Category',      type: 'Dropdown',    required: true,  unique: false, lookup: null, values: ['Notification', 'Approval', 'Alert', 'Welcome', 'Other'], formula: null, maxChar: null },
      { name: 'status',        displayName: 'Status',        type: 'Dropdown',    required: true,  unique: false, lookup: null, values: ['Active', 'Inactive'], formula: null, maxChar: null },
    ],
    actionEvents: ['on add', 'on edit'],
  },
];

/** Names of system base forms — used to block DSL `remove form` commands. */
export const SYSTEM_BASE_FORM_NAMES = new Set(BASE_FORMS.map((f) => f.name));

/**
 * Merge base forms into a scope's `forms[]`.
 * - If a base form is absent → prepend it.
 * - If a base form already exists (BRD mentioned it) → fill in any missing
 *   fields from the base schema (BRD fields win on name collision).
 * Called automatically after BRD extraction and on scope load.
 */
export function injectBaseForms(scope) {
  const clone = { ...scope, forms: [...scope.forms] };

  for (const base of [...BASE_FORMS].reverse()) {          // reverse so prepend order is preserved
    const idx = clone.forms.findIndex(
      (f) => f.name === base.name || f.displayName === base.displayName
    );
    if (idx === -1) {
      // Not present — prepend
      clone.forms.unshift({ ...base });
    } else {
      // Present — add any missing base fields, keep BRD fields
      const existing = clone.forms[idx];
      const existingFieldNames = new Set((existing.fields || []).map((f) => f.name));
      const missingFields = base.fields.filter((f) => !existingFieldNames.has(f.name));
      clone.forms[idx] = {
        ...existing,
        _isSystemBase: true,
        fields: [...missingFields, ...(existing.fields || [])],
      };
    }
  }

  return clone;
}

/** Build an empty scope. */
export function emptyScope() {
  return {
    schemaVersion: SCOPE_SCHEMA_VERSION,

    meta: {
      title: 'Untitled Creator App',
      sourceFile: null,
      createdAt: null,
      updatedAt: null,
    },

    /* --- Application-level settings (mirror `application "..." { ... }` block) --- */
    application: {
      name: '',                 // e.g. "Help - IOWA"
      dateFormat: 'dd-MMM-yyyy',
      timeZone: 'Asia/Kolkata',
      timeFormat: '24-hr',
      edition: 'professional',  // standard | professional | flex
    },

    /* ---------------------------- Step 1 — Application Flow ---------------------------- */

    /**
     * Forms = the data layer in Creator. A form IS the table.
     * Field types use the canonical labels from `fieldTypes.js`.
     */
    forms: [],
    /* {
         name: string,                 // section/identifier ("Customer")
         displayName: string,          // human label ("Customer Master")
         purpose: string,              // 1-line BRD-derived purpose
         fields: [{
           name: string,               // identifier
           displayName: string,
           type: string,               // canonical label (see header)
           required: boolean,
           unique: boolean,
           lookup: string|null,        // "Customers.ID" — upgrades type to Lookup
           values: string[]|null,      // for Dropdown/Radio/Multi-Select
           formula: string|null,       // for Formula fields
           maxChar: number|null,
         }],
         actionEvents: string[],       // ["on add", "on edit", "on delete", "on validate"]
       } */

    /**
     * Reports = views over forms. Type drives the Creator UI.
     * Valid kinds: list | grid | summary | kanban | calendar | timeline | map | pivot | spreadsheet.
     */
    reports: [],
    /* { name, displayName, type, baseForm, columns: string[], customActions: string[], hidden: boolean } */

    /**
     * Pages = HTML/widget composites that embed forms & reports.
     * Sections are the top-level navigation grouping.
     */
    pages: [],
    /* { name, displayName, section: string, embeddedForms: string[], embeddedReports: string[], hasScript: boolean } */

    /**
     * Workflows = automation rules.
     * `scope` ≈ trigger source: form | report | schedule | button | custom_action.
     * `event` ≈ record event: "on add", "on edit", "on delete", "on validate", "on user input".
     */
    workflows: [],
    /* { name, displayName, scope, type, form, event, actionKinds: string[], description: string } */

    /* ---------------------------- Step 2 — Data Model ---------------------------- *
     * In Creator the data model = `forms` themselves. Relationships are encoded as
     * Lookup fields (Single Select Lookup / Multi-Select Lookup / Subform) on a
     * form pointing at another form. We surface them here for review.
     */
    lookups: [],
    /* { from: form, field: string, to: form, kind: 'single' | 'multi' | 'subform' } */

    /* ---------------------------- Step 3 — Pages, Roles & Profiles ---------------------------- */

    /** Roles = org hierarchy entries (`share_settings.roles`). */
    roles: [],
    /* { name, description, parent: string|null } */

    /**
     * Profiles = permission profiles (`share_settings."ProfileName" { ... }`).
     * One profile = one bundle of module-level + report-level permissions.
     */
    profiles: [],
    /* { name, description, type: string,
         modulePermissions: [{
            form: string,
            enabled: ['Create','Viewall','Modifyall','Import','Export','Tab'],
            allFieldsVisible: boolean,
            reportPermissions: [{ report: string, actions: ['View','Edit','Delete','Export'] }]
         }],
       } */

    /* ---------------------------- Step 4 — Custom Functions, Connections & APIs ---------------------------- */

    /** Deluge custom functions. */
    customFunctions: [],
    /* { name, namespace, returnType, params: [{name,type}], purpose, language: 'Deluge' } */

    /** Outbound connections to third-party services (Creator Connections). */
    connections: [],
    /* { service, authType: 'oauth2' | 'apikey' | 'basic', purpose } */

    /**
     * Blueprints = visual state-machine / process-flow on a form.
     * Each record tracks its current stage. Transitions move it between stages.
     * Transitions have Deluge hooks: before / during / after.
     */
    blueprints: [],
    /* {
         name: string,
         displayName: string,
         form: string,            // base form link name
         runWhen: 'always' | 'criteria',
         criteria: string,        // optional criteria expression
         stages: [{
           name: string,
           displayName: string,
           isInitial: boolean,    // first stage (auto-assigned on record create)
           isTerminal: boolean,   // final stage (no outgoing transitions)
         }],
         transitions: [{
           name: string,          // button label shown to user
           from: string,          // source stage name
           to: string,            // destination stage name
           owners: string[],      // "all" | role names | field names
           criteria: string,      // condition to show transition button
           beforeWorkflow: string,  // Deluge script (can cancel submit)
           afterWorkflow: string,   // Deluge script (post-transition)
           description: string,
         }],
         description: string,
       } */

    /**
     * Batch Workflows = form-bound bulk record processors.
     * Tied to a specific form, iterate matching records, apply Deluge per record.
     * Run on schedule or on-demand.
     */
    batchWorkflows: [],
    /* {
         name: string,
         displayName: string,
         form: string,           // base form link name
         criteria: string,       // which records to process
         frequency: 'daily' | 'weekly' | 'monthly' | 'on_demand' | 'schedule',
         scheduleName: string,   // linked schedule if frequency != on_demand
         delugeScript: string,   // the per-record Deluge body
         description: string,
       } */

    /** Time-based triggers. */
    schedules: [],
    /* { name, frequency: 'daily' | 'weekly' | 'monthly' | 'cron', cron: string|null, calls: string } */

    /** Public REST endpoints exposed by this Creator app. */
    publicAPIs: [],
    /* { method, path, baseForm, auth: 'none' | 'apikey' | 'oauth2', purpose } */

    /* ---------------------------- Step 5 — NFRs & Assumptions ---------------------------- */

    nfrs: [],          // { category, statement }
    assumptions: [],   // string
    outOfScope: [],    // string

    /** Free-form notes captured from the prompt-DSL fallback (per step). */
    notes: {
      step1: [],
      step2: [],
      step3: [],
      step4: [],
      step5: [],
    },
  };
}

/** Stamp `createdAt`/`updatedAt`. */
export function stamp(scope) {
  const now = new Date().toISOString();
  if (!scope.meta.createdAt) scope.meta.createdAt = now;
  scope.meta.updatedAt = now;
  return scope;
}

/** Deep-clone via JSON (safe for our plain shape). */
export function cloneScope(scope) {
  return JSON.parse(JSON.stringify(scope));
}

/**
 * Step metadata — drives the UI wizard and the PDF table-of-contents.
 * Subtitles use Creator vocabulary verbatim.
 */
export const STEPS = [
  { id: 'step1', n: 1, title: 'Application Flow',
    subtitle: 'Forms · Reports · Pages · Workflows' },
  { id: 'step2', n: 2, title: 'Data Model',
    subtitle: 'Form Fields · Lookups · Subforms' },
  { id: 'step3', n: 3, title: 'Roles & Profiles',
    subtitle: 'Org Hierarchy · Permission Profiles · Page Access' },
  { id: 'step4', n: 4, title: 'Functions, Connections & Schedules',
    subtitle: 'Deluge Functions · Blueprints · Batch Workflows · Schedules · Connections · Public APIs' },
  { id: 'step5', n: 5, title: 'NFRs & Assumptions',
    subtitle: 'Edition · Limits · Out-of-Scope' },
];

/* -------------------------------------------------------------------------- */
/*  Backward-compat shims                                                      */
/* -------------------------------------------------------------------------- */
/**
 * v1 scopes (pre-Creator overhaul) used `entities`, `modules`, `apis`,
 * `integrations`, `auth`. We migrate them on load so old localStorage drafts
 * keep opening.
 */
export function migrateScope(raw) {
  if (!raw || typeof raw !== 'object') return emptyScope();
  if (raw.schemaVersion === SCOPE_SCHEMA_VERSION) return raw;

  const next = emptyScope();
  next.meta = { ...next.meta, ...(raw.meta || {}) };
  next.application.name = raw.meta?.title || next.application.name;

  // v1 forms → v2 forms (keep what we have; default the new fields)
  if (Array.isArray(raw.forms)) {
    next.forms = raw.forms.map((f) => ({
      name: f.name,
      displayName: f.displayName || f.name,
      purpose: f.purpose || '',
      fields: (f.fields || []).map((fd) => ({
        name: fd.name,
        displayName: fd.displayName || fd.name,
        type: mapV1FieldType(fd.type),
        required: !!fd.required,
        unique: !!fd.unique,
        lookup: fd.fk ? `${fd.fk}.ID` : null,
        values: fd.values || null,
        formula: null,
        maxChar: fd.maxChar || null,
      })),
      actionEvents: f.actionEvents || ['on add', 'on edit'],
    }));
  }

  // v1 entities → lookups (fk fields become lookups; rest is lossless after forms migration)
  if (Array.isArray(raw.entities)) {
    for (const e of raw.entities) {
      for (const f of e.fields || []) {
        if (f.fk) {
          next.lookups.push({ from: e.name, field: f.name, to: f.fk, kind: 'single' });
        }
      }
    }
  }

  // v1 workflows → v2 (event/scope defaults)
  if (Array.isArray(raw.workflows)) {
    next.workflows = raw.workflows.map((w) => ({
      name: w.name,
      displayName: w.displayName || w.name,
      scope: 'form',
      type: 'workflow',
      form: w.trigger?.form || '',
      event: w.trigger?.event || 'on add',
      actionKinds: [],
      description: w.outcome || (w.steps || []).join(' → ') || '',
    }));
  }

  // v1 modules → v2 pages (Creator's nearest equivalent)
  if (Array.isArray(raw.modules)) {
    next.pages = raw.modules.map((m) => ({
      name: m.name.replace(/\s+/g, '_'),
      displayName: m.name,
      section: 'Default',
      embeddedForms: m.includes || [],
      embeddedReports: [],
      hasScript: false,
    }));
  }

  // v1 roles → v2 roles + a single permissive profile capturing old action lists
  if (Array.isArray(raw.roles)) {
    next.roles = raw.roles.map((r) => ({ name: r.name, description: '', parent: null }));
    for (const r of raw.roles) {
      if (!(r.permissions || []).length) continue;
      next.profiles.push({
        name: r.name,
        description: `Migrated from v1 role`,
        type: 'standard',
        modulePermissions: r.permissions.map((p) => ({
          form: p.module,
          enabled: mapV1ActionsToCreator(p.actions),
          allFieldsVisible: true,
          reportPermissions: [],
        })),
      });
    }
  }

  // v1 apis → publicAPIs
  if (Array.isArray(raw.apis)) {
    next.publicAPIs = raw.apis.map((a) => ({
      method: a.method,
      path: a.path,
      baseForm: '',
      auth: a.auth === 'required' ? 'apikey' : (a.auth || 'apikey'),
      purpose: a.returns ? `Returns ${a.returns}` : '',
    }));
  }

  // v1 integrations → connections
  if (Array.isArray(raw.integrations)) {
    next.connections = raw.integrations.map((i) => ({
      service: i.service,
      authType: (i.auth || 'oauth2').toLowerCase().includes('key') ? 'apikey' : 'oauth2',
      purpose: i.purpose || '',
    }));
  }

  next.nfrs = Array.isArray(raw.nfrs) ? raw.nfrs : [];
  next.assumptions = Array.isArray(raw.assumptions) ? raw.assumptions : [];
  next.outOfScope = Array.isArray(raw.outOfScope) ? raw.outOfScope : [];
  next.notes = { ...next.notes, ...(raw.notes || {}) };

  // v2 additions — blueprints and batchWorkflows (preserve if already present)
  next.blueprints = Array.isArray(raw.blueprints) ? raw.blueprints : [];
  next.batchWorkflows = Array.isArray(raw.batchWorkflows) ? raw.batchWorkflows : [];

  return stamp(next);
}

/** Map old generic field-types onto canonical Creator labels. */
function mapV1FieldType(t) {
  const s = String(t || '').toLowerCase();
  if (!s) return 'Single Line';
  if (s === 'uuid' || s === 'id' || s === 'auto') return 'Auto Number';
  if (s === 'text' || s === 'string') return 'Single Line';
  if (s === 'longtext' || s === 'multiline') return 'Multi Line';
  if (s === 'number' || s === 'int' || s === 'integer') return 'Number';
  if (s === 'decimal' || s === 'float' || s === 'double') return 'Decimal';
  if (s === 'currency' || s === 'money' || s === 'usd') return 'Currency';
  if (s === 'date') return 'Date';
  if (s === 'datetime') return 'Date-Time';
  if (s === 'time') return 'Time';
  if (s === 'email') return 'Email';
  if (s === 'phone' || s === 'tel') return 'Phone';
  if (s === 'url') return 'URL';
  if (s === 'bool' || s === 'boolean') return 'Decision Box';
  if (s === 'enum' || s === 'select' || s === 'dropdown') return 'Dropdown';
  if (s === 'multiselect') return 'Multi-Select';
  return t; // unknown — let downstream display it as-is
}

function mapV1ActionsToCreator(actions = []) {
  const out = new Set(['Tab']);
  for (const a of actions.map((x) => String(x).toLowerCase())) {
    if (a === 'read' || a === 'view') out.add('Viewall');
    else if (a === 'write' || a === 'create') { out.add('Create'); out.add('Modifyall'); }
    else if (a === 'delete') out.add('Modifyall');
    else if (a === 'export') out.add('Export');
    else if (a === 'import') out.add('Import');
    else if (a === 'approve') out.add('Modifyall');
  }
  return Array.from(out);
}
