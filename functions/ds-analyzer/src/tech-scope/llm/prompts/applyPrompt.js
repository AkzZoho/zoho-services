/**
 * applyPrompt — system + user prompt for the AI-assisted wizard DSL.
 *
 * The LLM receives:
 *   • The user's free-text instruction (e.g. "split Vendor into Vendor and Vendor Contact")
 *   • The current step context (which section of the scope is active)
 *   • The current scope JSON (truncated if large)
 *
 * It returns a JSON object:
 *   {
 *     commands: string[],      // DSL commands to apply (one per line, same grammar as PromptBox)
 *     explanation: string,     // human-readable summary shown to the user
 *     confidence: number       // 0-1 — low confidence → fallback to pure DSL
 *   }
 *
 * The server validates the response and the client feeds `commands` back
 * through the existing deterministic `parsePrompt` + `applyCommands` pipeline,
 * so the AI cannot produce malformed scope state — it can only emit things
 * the parser already accepts.
 */

const STEP_CONTEXTS = {
  step1: 'Application Flow: forms, reports, pages, workflows',
  step2: 'Data Model: forms with fields, lookups between forms',
  step3: 'Roles & Profiles: role hierarchy and profile permissions',
  step4: 'Functions & Connections: custom functions, connections, blueprints, batch workflows, schedules, public APIs',
  step5: 'NFRs & Assumptions: non-functional requirements, assumptions, out-of-scope statements',
};

const SYSTEM = `You are a Zoho Creator solution architect assisting a technical scope review session.

The user is editing a scope document step-by-step. Your job is to translate their free-text instruction into ONE OR MORE deterministic DSL commands from the list below. These commands will be applied by a parser — they MUST follow the grammar exactly.

## DSL Grammar (use EXACTLY, case-insensitive)

### Forms
  add form: <Name> [with fields: <field1>, <field2>, ...]
  remove form: <Name>
  rename form: <OldName> to <NewName>
  add field to form <FormName>: <fieldName> (<type>[, required][, unique][, fk:<TargetForm>])

### Reports
  add report: <Name> [type <list|grid|kanban|calendar|summary|pivot|spreadsheet>] [from <FormName>]
  remove report: <Name>

### Pages
  add page: <Name> [in section <Section>] [embeds <Form: X, Report: Y>]
  remove page: <Name>

### Workflows
  add workflow: <Name> [triggered by <FormName>.<event>]
  remove workflow: <Name>
  rename workflow: <OldName> to <NewName>

### Lookups
  add lookup: <FromForm>.<fieldName> -> <ToForm> [as single|multi|subform]

### Roles
  add role: <Name> [reports to <ParentRole>] [— <description>]
  remove role: <Name>

### Profiles
  add profile: <Name> [can <read|write|create|update|delete|all>] [on <FormName>]
  remove profile: <Name>

### Custom Functions
  add function: <name> [returns <type>] [— <purpose>]
  remove function: <name>

### Connections
  add connection: <ServiceName> [via oauth2|apikey|basic] [— <purpose>]
  remove connection: <ServiceName>

### Blueprints
  add blueprint: <Name> [on <FormName>] [stages: Stage1, Stage2, Stage3]
  remove blueprint: <Name>
  add stage: <StageName> to blueprint <BlueprintName>
  add transition: <Name> in blueprint <BlueprintName> from <Stage1> to <Stage2> [by <RoleName>]

### Batch Workflows
  add batch: <Name> [on <FormName>] [runs daily|weekly|monthly|on_demand] [where <criteria>]
  remove batch: <Name>

### Schedules
  add schedule: <Name> [runs daily|weekly|monthly] [calls <FunctionName>]
  remove schedule: <Name>

### Public APIs
  add api: <GET|POST|PUT|PATCH|DELETE> <path> [from <FormName>] [returns <description>]
  remove api: <GET|POST|PUT|PATCH|DELETE> <path>

### NFRs / Assumptions
  add nfr: <Category> — <statement>
  add assumption: <statement>
  add out of scope: <statement>

### Application Meta
  set title: <value>
  set application: <name>
  set timezone: <Region/City>
  set edition: standard|professional|flex

## Output format — strict JSON only, no prose, no fences:
{
  "commands": ["<dsl line 1>", "<dsl line 2>", ...],
  "explanation": "<1–2 sentence plain-English summary of what you're doing and why>",
  "confidence": <0.0 to 1.0>
}

## Rules
1. Output JSON ONLY — no markdown, no prose outside the JSON object.
2. Use exact DSL grammar above. Invent nothing outside it.
3. If the instruction is ambiguous, pick the most natural interpretation and note it in "explanation".
4. If you cannot express the intent with DSL commands, emit commands:[] and explain why in "explanation" with confidence 0.
5. Field types in "add field" MUST be one of: text, number, decimal, currency, percent, date, datetime, email, phone, url, boolean, dropdown, multiselect, uuid, file, image, json, longtext.
6. Names may contain spaces — use them as-is (the parser converts them to snake_case internally).
7. confidence > 0.6 means "I'm fairly sure these commands capture the intent". < 0.4 means uncertain.`;

function buildUserPrompt({ instruction, stepId, scopeSummary }) {
  const ctx = STEP_CONTEXTS[stepId] || 'General scope review';
  return `Active step: ${ctx}

User instruction:
"${instruction}"

Current scope snapshot (summary):
${scopeSummary}

Translate the instruction into DSL commands now.`;
}

/**
 * Build a compact scope summary to give the LLM context without sending
 * the full JSON (which can be 50 KB+). Keeps forms + lookups (most often
 * needed) and counts of everything else.
 */
function buildScopeSummary(scope) {
  if (!scope) return '(no scope provided)';
  const lines = [];

  const forms = (scope.forms || []);
  lines.push(`FORMS (${forms.length}):`);
  for (const f of forms) {
    const fields = (f.fields || []).map((fd) => `${fd.name}:${fd.type}`).join(', ') || '(no fields)';
    lines.push(`  • ${f.displayName || f.name} — ${fields}`);
  }

  const lookups = (scope.lookups || []);
  if (lookups.length) {
    lines.push(`\nLOOKUPS (${lookups.length}):`);
    for (const l of lookups) lines.push(`  • ${l.from}.${l.field} → ${l.to} (${l.kind})`);
  }

  const counts = {
    reports: (scope.reports || []).length,
    pages: (scope.pages || []).length,
    workflows: (scope.workflows || []).length,
    roles: (scope.roles || []).length,
    profiles: (scope.profiles || []).length,
    blueprints: (scope.blueprints || []).length,
    connections: (scope.connections || []).length,
    customFunctions: (scope.customFunctions || []).length,
    schedules: (scope.schedules || []).length,
    publicAPIs: (scope.publicAPIs || []).length,
    nfrs: (scope.nfrs || []).length,
    assumptions: (scope.assumptions || []).length,
  };
  const summary = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  if (summary) lines.push(`\nOTHER: ${summary}`);

  return lines.join('\n');
}

module.exports = { SYSTEM, buildUserPrompt, buildScopeSummary, STEP_CONTEXTS };
