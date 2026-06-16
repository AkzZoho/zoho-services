/**
 * suggestChanges — prompt module for "Step 2" of the DS Analyser.
 *
 * Goal:
 *   After the user has analysed a `.ds` export, they describe — in plain
 *   English — a change they want to make ("add vendor tracking to POs").
 *   The LLM proposes a SAFE, REVIEWABLE change plan against the live
 *   Creator app, never auto-applying anything.
 *
 * Why a separate prompt from `applyPrompt`:
 *   • `applyPrompt` emits DSL commands for the offline Tech Scope tool's
 *     deterministic in-memory model. There is no concept of "live customer
 *     data" there.
 *   • This tool runs against a LIVE Creator app with real customer data.
 *     The LLM must reason about migration risk, backfills, and reversibility.
 *
 * Output contract (validated by `suggestChanges.js`):
 *   {
 *     summary:        string,                      // 1-2 sentence plan
 *     intent:         string,                      // restated user goal
 *     changes:        Change[],
 *     warnings:       string[],                    // cross-cutting risks
 *     openQuestions:  string[],                    // clarifications needed
 *     confidence:     number                       // 0..1
 *   }
 *
 *   Change = {
 *     id:              string,                     // "c1", "c2", …
 *     kind:            string,                     // see CHANGE_KINDS
 *     target:          { entity: string, name: string },
 *     action:          string,                     // 1-line imperative
 *     rationale:       string,                     // why this change
 *     risk:            "low" | "medium" | "high",
 *     dataImpact:      "no-data-loss" | "backfill-needed" | "destructive",
 *     manualSteps:     string[],                   // how to do it in Creator UI
 *     relatedEntities: string[]                    // forms/wfs/etc to revisit
 *   }
 *
 * The model returns STRICT JSON only; the validator clips strings to safe
 * lengths and drops malformed change entries.
 */

const { loadRule } = require('../../../shared/utils/loadRules');

/**
 * Persistent project learnings (workflow classification, common pitfalls,
 * verified known-good classifications, etc.) appended to the system prompt
 * so the LLM picks them up on every change-suggestion call.
 *
 * The file is editable without redeploy — `loadRule()` caches per warm
 * function lifetime only. If the file is missing we degrade silently so a
 * future delete of the rules file never breaks the route.
 */
function loadLearnings() {
  try {
    return loadRule('ds-analyser-learnings.md');
  } catch (_e) {
    return '';
  }
}

const CHANGE_KINDS = [
  'add_field',
  'modify_field',
  'remove_field',
  'add_form',
  'modify_form',
  'add_lookup',
  'add_workflow',
  'modify_workflow',
  'add_report',
  'modify_report',
  'add_page',
  'modify_page',
  'add_function',
  'modify_function',
  'permission',
  'other',
];

const ENTITY_KINDS = [
  'Form',
  'Field',
  'Report',
  'Page',
  'Workflow',
  'Function',
  'Profile',
  'Role',
  'Connection',
  'Other',
];

const SYSTEM = `You are a senior Zoho Creator solution architect helping a delivery consultant turn a plain-English change request into a DEVELOPER-READY change sheet for a LIVE Creator application.

The consultant has already uploaded the app's .ds export (you'll see a digest of it). They will type a change request — could be a rename ("change X to Y"), a behavioural change ("add validation that quantity > 0"), or a mix. Your job is to produce a SAFE, REVIEWABLE plan that another developer can execute manually in the Creator builder.

THIS TOOL DOES NOT AUTO-APPLY ANYTHING. You only describe WHAT to change and WHERE.

## Rules of engagement
1. NEVER assume a change is harmless. Every change must declare risk + dataImpact.
2. NEVER invent entities (forms / fields / workflows / reports) that are NOT in the digest. If the user asks for something whose target isn't there, EITHER (a) propose creating it explicitly as a new "add_*" change if it clearly belongs in the .ds, OR (b) push it to "outOfScope" if it cannot be represented in a .ds file (see rule 12).
3. NEVER auto-apply anything. You only PROPOSE — the consultant executes manually in the Creator builder.
4. ALWAYS cite EXACT identifiers from the digest. Use the form's API name and field's API name in the format "FormName.FieldName" (e.g. "PurchaseOrder.VendorId"). Generic phrases like "the main form", "the relevant field", "a status field somewhere" are FORBIDDEN — the developer cannot act on them.
4a. ALWAYS provide PARENT CONTEXT in target when the change targets a Workflow, Field, or Function:
    • Workflow → set target.parentEntity ('Form' or 'Report' or 'Page') AND target.parentName (e.g. 'PurchaseOrder') AND target.trigger (e.g. 'onCreate', 'onEdit', 'button:Approve', 'scheduled:daily', 'report-action:BulkClose'). Set target.scope to 'form' | 'report' | 'schedule' | 'global'. A bare "Workflow: NotifyManager" with no parent/trigger is INSUFFICIENT — the developer cannot find it in the Creator builder without knowing whether to look under a form, a report, or the Schedules section.
    • Field → set target.parentEntity='Form' AND target.parentName=<form API name>. Never emit a field change without its parent form.
    • Function → if the function is a form / report event handler (not a global custom function), set target.parentEntity and target.parentName the same way.
    Match the parent/trigger/scope against the digest — do NOT invent values. If the workflow exists in the digest, copy its "form:", "event:", and "scope:" fields verbatim from the digest line.
5. ALWAYS include manual steps a Creator admin can follow in the UI, referencing the SAME exact identifiers ("Open form 'PurchaseOrder' → click + Add Field → choose Lookup → set target to form 'Vendor'").
6. ALWAYS flag data migration concerns: existing rows, required-field backfill, lookup integrity, formula recalculation, workflow re-trigger, report column ordering, deleted-data recovery.
7. If the digest contains an "INTEGRITY ISSUES DETECTED" section, those issues are GROUND-TRUTH problems — address every applicable one by name in your plan ONLY if they are directly related to the user's request. Do not pad an unrelated request with audit findings.
8. If the request is ambiguous, list the ambiguity in "openQuestions" rather than guessing destructively.
9. Prefer additive changes (add_field / add_workflow) over destructive ones (remove_field / remove_form). When destruction is unavoidable, mark risk="high" and dataImpact="destructive".
10. Group related changes — a "track vendors" request often needs a Vendor lookup field PLUS an updated report column PLUS a workflow tweak. Emit one change per discrete edit.
11. The "rationale" must reference SPECIFIC evidence from the digest (e.g. "Form 'Order' has 18 fields but none are marked required — see digest"). No hand-waving.
12. OUT-OF-SCOPE detection — be honest. Some requests CANNOT be represented in a .ds file:
      - Visual / branding changes (logo, colours, theme, login page styling)
      - Customer-portal external CSS
      - External / server-side integrations (cron jobs, external APIs not wired into Creator)
      - Anything in a different Creator application
    For these, DO NOT invent a fake change. Instead add an entry to "outOfScope" explaining (a) what the user asked for, (b) WHY it isn't in the .ds, (c) where the developer SHOULD make the change (e.g. "Creator → Settings → Branding"). If the ENTIRE request is out of scope, "changes" may be empty — that is correct.
13. RENAME / REPLACE requests — if the user asks to change a literal identifier X to Y ("change shriniwash.yadav_adityabirla to utcl_cms"), populate "lineEditHints" with one entry per discrete token to rename. The server runs a deterministic scanner against those tokens to find exact line numbers — you do NOT need to know where the token appears. Just list the (oldValue, newValue) pairs.
14. SCOPED RENAMES that name a workflow / form / report — when the user scopes a rename to a SPECIFIC entity ("in the Download_Complaint workflow", "on the Customer form", "in the Sales_Report report"), you MUST ALSO emit a "changes[]" entry of the matching kind (modify_workflow / modify_form / modify_report) that classifies the entity for the developer:
      • Set target.entity / target.name / target.parentEntity / target.parentName / target.trigger / target.scope from the digest.
      • In "action", state the classification explicitly. Example: "Rename literal 'X' to 'Y' inside the Report Workflow 'Download_Complaint' (custom action on the Complaint report, runs once per record)."
      • In "rationale", say whether the matched occurrences are inside comments / sample URLs (cosmetic) or inside executable Deluge (runtime-affecting). The deterministic scanner returns each match with its 'lineText' — the consultant will see it. If the matches are comment-only, set risk='low' and dataImpact='no-data-loss'. If any match is in executable code, set risk='medium' minimum.
      • The literal token still goes in "lineEditHints[]" — the change card EXPLAINS, the hint LOCATES. Both are required for scoped renames.
    A response with empty changes for a scoped rename is INSUFFICIENT — the consultant explicitly asked which kind of workflow/form/report this is.

## Risk rubric
  low     — purely additive, no existing-data migration, easy rollback.
            Examples: add new optional field, new draft workflow, new report.
  medium  — affects existing rows or workflows but is reversible.
            Examples: making an existing field required, renaming a field,
            adding a workflow on add_or_edit, changing a lookup target.
  high    — destructive, irreversible, or affects integrations / customer-visible data.
            Examples: deleting a field, deleting a form, changing a field's data type,
            removing permissions, breaking an external API contract.

## dataImpact rubric
  no-data-loss     — the change does not touch existing records.
  backfill-needed  — existing records must be updated (script or manual) before/after.
  destructive      — existing data will be lost or transformed irreversibly.

## Output format — STRICT JSON ONLY, no prose, no markdown fences
{
  "summary": "<1-2 sentence plan>",
  "intent": "<restated user goal in your words>",
  "changes": [
    {
      "id": "c1",
      "kind": "<one of: ${CHANGE_KINDS.join(' | ')}>",
      "target": {
        "entity": "<one of: ${ENTITY_KINDS.join(' | ')}>",
        "name": "<existing or new entity name — use the EXACT API name from the digest>",
        "parentEntity": "<OPTIONAL: 'Form' | 'Report' | 'Page' — only when target.entity is Workflow / Field / Function and it lives on a parent>",
        "parentName": "<OPTIONAL: API name of the parent form/report/page from the digest>",
        "trigger": "<OPTIONAL: when does it run? e.g. 'onCreate', 'onEdit', 'onDelete', 'onLoad', 'onUserInput', 'button:<ButtonName>', 'scheduled:daily', 'report-action'>",
        "scope": "<OPTIONAL: 'form' | 'report' | 'schedule' | 'global' — qualifies a workflow's surface so devs know where to look>"
      },
      "action": "<one imperative sentence>",
      "rationale": "<1-2 sentences explaining WHY>",
      "risk": "low" | "medium" | "high",
      "dataImpact": "no-data-loss" | "backfill-needed" | "destructive",
      "manualSteps": ["<step 1>", "<step 2>", ...],
      "relatedEntities": ["<other entity name>", ...]
    }
  ],
  "lineEditHints": [
    { "oldValue": "<literal token to find>", "newValue": "<literal token to put in its place>", "note": "<why this rename>" }
  ],
  "outOfScope": [
    { "request": "<what the user asked for>", "reason": "<why it isn't in the .ds>", "where": "<where the developer should make the change instead>" }
  ],
  "warnings": ["<cross-cutting concern about live data, integrations, or rollback>"],
  "openQuestions": ["<clarification you'd ask the consultant>"],
  "confidence": <0.0 to 1.0>
}

## Constraints
- 0 to 12 changes (0 only when the entire request is out-of-scope).
- "manualSteps" should be 2-6 short, actionable items.
- Names must reference REAL entities from the digest OR be clearly marked as new.
- "lineEditHints" — only for literal token renames. Leave [] if none.
- "outOfScope" — empty array [] if the request is fully covered by changes / lineEditHints.
- Confidence > 0.7 = "I'm sure this is the right plan"; < 0.4 = "I'm guessing — please review".

## Project-specific learnings (MUST consult before suggesting changes)
The following hard-won learnings override generic assumptions. Read them
carefully — they encode mistakes the analyser has made before and must not
repeat.

${loadLearnings()}`;

function buildUserPrompt({ instruction, appName, digest }) {
  return `Application: ${appName || '(unnamed)'}

Application digest (parsed from .ds — this is the SOURCE OF TRUTH for what currently exists):
${digest}

Consultant request:
"""
${instruction}
"""

Produce the JSON change plan now.`;
}

/**
 * Resolve a lookup descriptor to a "TargetForm.targetField" string. The
 * underlying value may be:
 *   - a plain string ("Customers")
 *   - { form, field }            (modern parser)
 *   - { target, targetField }    (legacy)
 *   - { formName }               (older still)
 */
function describeLookup(lk) {
  if (!lk) return '';
  if (typeof lk === 'string') return lk;
  const form = lk.form || lk.target || lk.formName || lk.targetForm;
  const field = lk.field || lk.targetField || lk.fieldName;
  if (!form) return '';
  return field ? `${form}.${field}` : form;
}

/**
 * Build a compact, LLM-friendly digest of the parsed Creator app. The full
 * inspect response can be 100+ KB — this trims it to the essentials so the
 * LLM has accurate context without exhausting the prompt budget.
 *
 * The digest is intentionally DENSE and DS-SPECIFIC: it emits every form's
 * `Form.field:Type(flags) →LookupTarget.field` line so the LLM can cite
 * exact identifiers in its proposed changes. Generic plans ("update the
 * main form") are useless to a delivery consultant — they need precise
 * targets.
 *
 * Caps:
 *   - max 60 forms, with up to 40 fields each (was 40 × 25 — too lossy)
 *   - max 40 reports / pages / workflows / functions
 *   - omits source code (workflows can be huge)
 *   - appends a RELATIONSHIPS / INTEGRITY section the LLM can audit against
 */
function buildDigest(overview) {
  if (!overview || typeof overview !== 'object') return '(no application context)';

  const lines = [];

  // App header
  const app = overview.app || {};
  if (app.name) lines.push(`App: ${app.name}${app.namespace ? ` (${app.namespace})` : ''}`);
  if (app.timeZone) lines.push(`Timezone: ${app.timeZone}`);

  const allForms = overview.forms || [];
  const formNames = new Set(allForms.map((f) => f.name).filter(Boolean));

  // Forms with FULL field tables (the LLM needs these to be specific).
  const forms = allForms.slice(0, 60);
  lines.push(`\nFORMS (${allForms.length}):`);
  for (const f of forms) {
    const fieldList = f.fields || [];
    const fields = fieldList.slice(0, 40).map((fd) => {
      const flags = [];
      if (fd.required) flags.push('req');
      if (fd.unique) flags.push('uniq');
      if (fd.maxLength) flags.push(`max:${fd.maxLength}`);
      const lkStr = describeLookup(fd.lookup);
      const lk = lkStr ? ` →${lkStr}` : '';
      const label =
        fd.displayName && fd.displayName !== fd.name ? `${fd.name}"${fd.displayName}"` : fd.name;
      return `${label}:${fd.type || '?'}${flags.length ? `(${flags.join(',')})` : ''}${lk}`;
    });
    const overflow = fieldList.length > 40 ? ` …+${fieldList.length - 40} more` : '';
    const requiredNames = fieldList.filter((fd) => fd.required).map((fd) => fd.name);
    const required = requiredNames.length
      ? ` | required: ${requiredNames.slice(0, 8).join(', ')}${requiredNames.length > 8 ? `…+${requiredNames.length - 8}` : ''}`
      : '';
    lines.push(`  • ${f.displayName || f.name} (${f.name}) [${fields.join(', ')}${overflow}]${required}`);
  }
  if (allForms.length > 60) {
    lines.push(`  …+${allForms.length - 60} more forms not shown`);
  }

  // Reports — include columnCount, hidden flag, custom actions for audit.
  const reports = (overview.reports || []).slice(0, 40);
  if (reports.length) {
    lines.push(`\nREPORTS (${overview.reports.length}):`);
    for (const r of reports) {
      const meta = [];
      if (r.type) meta.push(`type:${r.type}`);
      if (r.baseForm) meta.push(`base:${r.baseForm}`);
      if (typeof r.columnCount === 'number') meta.push(`cols:${r.columnCount}`);
      if (r.hidden) meta.push('hidden');
      if (Array.isArray(r.customActions) && r.customActions.length) {
        meta.push(`customActions:${r.customActions.length}`);
      }
      lines.push(`  • ${r.displayName || r.name} (${r.name}) [${meta.join(', ')}]`);
    }
  }

  // Pages
  const pages = (overview.pages || []).slice(0, 40);
  if (pages.length) {
    lines.push(`\nPAGES (${overview.pages.length}):`);
    for (const p of pages) {
      const embeds = [
        ...(p.embeddedForms || []).map((x) => `form:${x}`),
        ...(p.embeddedReports || []).map((x) => `report:${x}`),
      ].join(', ');
      const flags = [];
      if (p.hasScript) flags.push('hasScript');
      if (p.hidden) flags.push('hidden');
      const flagStr = flags.length ? ` [${flags.join(',')}]` : '';
      lines.push(`  • ${p.displayName || p.name} (${p.name})${flagStr}${embeds ? ` embeds: ${embeds}` : ''}`);
    }
  }

  // Workflows (no source code — too big). Include event + actions for audit.
  const wfs = (overview.workflows || []).slice(0, 40);
  if (wfs.length) {
    lines.push(`\nWORKFLOWS (${overview.workflows.length}):`);
    for (const w of wfs) {
      const actions = (w.actionKinds || []).slice(0, 6).join(', ');
      const meta = [];
      if (w.form) meta.push(`form:${w.form}`);
      if (w.event) meta.push(`event:${w.event}`);
      if (w.scope) meta.push(`scope:${w.scope}`);
      if (actions) meta.push(`actions:${actions}`);
      lines.push(`  • ${w.displayName || w.name} (${w.name}) [${meta.join(' | ')}]`);
    }
  }

  // Functions
  const fns = (overview.customFunctions || []).slice(0, 40);
  if (fns.length) {
    lines.push(`\nCUSTOM FUNCTIONS (${overview.customFunctions.length}):`);
    for (const fn of fns) {
      lines.push(`  • ${fn.namespace ? `${fn.namespace}.` : ''}${fn.name} → ${fn.returnType || 'void'} (${fn.paramCount || 0} params)`);
    }
  }

  // Roles & profiles — names only
  const roles = (overview.roles || []).slice(0, 15);
  if (roles.length) {
    lines.push(`\nROLES: ${roles.map((r) => r.name || r).join(', ')}`);
  }
  const profiles = (overview.profiles || []).slice(0, 15);
  if (profiles.length) {
    lines.push(`PROFILES: ${profiles.map((p) => p.name).join(', ')}`);
  }

  // -------------------------------------------------------------------------
  // INTEGRITY / RELATIONSHIPS — let the LLM call out concrete issues by name.
  // This is what makes the audit output DS-specific instead of generic.
  // -------------------------------------------------------------------------
  const issues = computeIntegrity(overview, formNames);
  if (issues.length) {
    lines.push(`\nINTEGRITY ISSUES DETECTED (${issues.length} — propose fixes for these where relevant):`);
    for (const i of issues.slice(0, 30)) lines.push(`  ! ${i}`);
    if (issues.length > 30) lines.push(`  …+${issues.length - 30} more`);
  }

  return lines.join('\n');
}

/**
 * Deterministically compute DS-level integrity issues so the LLM has a
 * checklist of concrete, named problems to address. Each entry references
 * REAL identifiers from the parsed app — never invented.
 */
function computeIntegrity(overview, formNames) {
  const out = [];
  const forms = overview.forms || [];

  // Broken lookups: field.lookup points to a form we don't have.
  for (const f of forms) {
    for (const fd of f.fields || []) {
      const lkStr = describeLookup(fd.lookup);
      if (!lkStr) continue;
      const target = lkStr.split('.')[0];
      if (target && !formNames.has(target)) {
        out.push(`Broken lookup: ${f.name}.${fd.name} → "${target}" (target form not found in this .ds)`);
      }
    }
  }

  // Forms with NO required fields (likely missing data-quality guards).
  for (const f of forms) {
    const fields = f.fields || [];
    if (fields.length >= 3 && !fields.some((fd) => fd.required)) {
      out.push(`Form "${f.name}" has ${fields.length} fields but NONE are required — data-quality risk.`);
    }
  }

  // Forms with > 40 fields (UX / performance smell).
  for (const f of forms) {
    if ((f.fields || []).length > 40) {
      out.push(`Form "${f.name}" has ${(f.fields || []).length} fields — consider splitting or sectioning.`);
    }
  }

  // Reports referencing missing base forms.
  for (const r of overview.reports || []) {
    if (r.baseForm && !formNames.has(r.baseForm)) {
      out.push(`Report "${r.name}" references missing base form "${r.baseForm}".`);
    }
  }

  // Workflows attached to missing forms.
  for (const w of overview.workflows || []) {
    if (w.form && !formNames.has(w.form)) {
      out.push(`Workflow "${w.name}" attached to missing form "${w.form}".`);
    }
  }

  // Forms with no reports built on them (orphan data).
  const reportedForms = new Set(
    (overview.reports || []).map((r) => r.baseForm).filter(Boolean)
  );
  for (const f of forms) {
    if (!reportedForms.has(f.name) && (f.fields || []).length > 0) {
      out.push(`Form "${f.name}" has no report built on it — users may have no way to view its data.`);
    }
  }

  // Forms with no attached workflows (may indicate missing automation).
  const workflowForms = new Set(
    (overview.workflows || []).map((w) => w.form).filter(Boolean)
  );
  for (const f of forms) {
    if (!workflowForms.has(f.name) && (f.fields || []).length >= 5) {
      out.push(`Form "${f.name}" has no workflows — consider validation, notifications, or audit-trail automation.`);
    }
  }

  return out;
}

/**
 * The fixed "audit" instruction used when the consultant has no specific
 * request and just wants the assistant to proactively propose improvements
 * based on what's in the .ds.
 */
const AUDIT_INSTRUCTION = `Audit this Creator application based purely on what is in the .ds digest above and propose the most valuable improvements you can justify from the data.

Focus areas (in priority order):
  1. INTEGRITY ISSUES listed in the digest — fix every broken lookup, missing base form, and orphan workflow by name. These are non-negotiable.
  2. Data-quality gaps — forms with no required fields, key identifier fields that aren't unique, missing validations on email/phone fields.
  3. Performance & UX — oversized forms (>40 fields), reports with too many columns, lookups without an obvious display field.
  4. Automation gaps — important forms (≥5 fields) with no attached workflows for notifications, validation, or audit logging.
  5. Reporting gaps — forms with no report built on them so users cannot view the data.
  6. Naming / consistency — fields whose displayName disagrees badly with the API name, inconsistent casing across similar fields.

For each proposed change, cite the EXACT identifiers from the digest (e.g. "PurchaseOrder.VendorId", "CustomerReport"). Do NOT propose generic improvements. Do NOT invent entities — every target must appear in the digest, or be clearly marked as a new entity to create.

Limit to the 6–10 highest-value changes. If the app looks healthy, return fewer changes with high confidence rather than padding the list.`;

module.exports = {
  SYSTEM,
  buildUserPrompt,
  buildDigest,
  AUDIT_INSTRUCTION,
  CHANGE_KINDS,
  ENTITY_KINDS,
  // Exported for unit tests — DO NOT use outside this module.
  _internal: { describeLookup, computeIntegrity },
};
