/**
 * template.js — convert a scope object into Zoho Creator-format markdown.
 *
 * The output mirrors what `buildTechnicalScope` in
 * `functions/ds-analyzer/src/analyzer/inspect.js` produces from a real `.ds`,
 * so a future round-trip stays diffable.
 *
 * Pure functions, easy to unit-test.
 */

import { buildFlowchart, buildErDiagram } from './mermaid.js';

/* -------------------------------------------------------------------------- */
/*  Step 1 — Application Flow                                                  */
/* -------------------------------------------------------------------------- */

export function renderStep1(scope) {
  const { forms, reports, pages, workflows, application = {} } = scope;
  const lines = [];
  lines.push('## Step 1 — Application Flow');
  lines.push('');
  lines.push(
    `**Application:** \`${application.name || scope.meta?.title || 'Untitled'}\` · ` +
    `**Date format:** ${application.dateFormat || 'dd-MMM-yyyy'} · ` +
    `**Time zone:** ${application.timeZone || 'Asia/Kolkata'} · ` +
    `**Edition:** ${application.edition || 'professional'}`
  );
  lines.push('');

  /* --- Forms --- */
  lines.push('### 📝 Forms');
  if (!forms.length) {
    lines.push('_No forms detected yet. Use the prompt below to add some._');
  } else {
    lines.push('| Form | Display Name | Fields | Action Events | Purpose |');
    lines.push('| --- | --- | ---:| --- | --- |');
    for (const f of forms) {
      const events = (f.actionEvents || []).join(', ') || 'on add, on edit';
      lines.push(
        `| \`${f.name}\` | ${esc(f.displayName || f.name)} | ${(f.fields || []).length} | ${events} | ${esc(f.purpose || '—')} |`
      );
    }
  }
  lines.push('');

  /* --- Reports --- */
  lines.push('### 📊 Reports');
  if (!reports.length) {
    lines.push('_No reports defined yet._');
  } else {
    lines.push('| Report | Type | Base Form | Columns | Custom Actions |');
    lines.push('| --- | --- | --- | ---:| --- |');
    for (const r of reports) {
      const acts = (r.customActions || []).map((a) => `"${a}"`).join(', ') || '—';
      lines.push(
        `| \`${r.name}\` | ${r.type || 'list'} | ${r.baseForm ? `\`${r.baseForm}\`` : '—'} | ${(r.columns || []).length || '—'} | ${acts} |`
      );
    }
  }
  lines.push('');

  /* --- Pages --- */
  lines.push('### 🖥️ Pages');
  if (!pages.length) {
    lines.push('_No pages defined yet._');
  } else {
    const bySection = groupBy(pages, (p) => p.section || 'Default');
    for (const sec of Object.keys(bySection).sort()) {
      lines.push(`- **Section: ${sec}**`);
      for (const p of bySection[sec]) {
        const embeds = [
          ...(p.embeddedForms || []).map((x) => `Form:\`${x}\``),
          ...(p.embeddedReports || []).map((x) => `Report:\`${x}\``),
        ].join(', ');
        lines.push(`  - **${p.displayName || p.name}** \`${p.name}\`${embeds ? ` — embeds ${embeds}` : ''}${p.hasScript ? ' _(has script)_' : ''}`);
      }
    }
  }
  lines.push('');

  /* --- Workflows --- */
  lines.push('### ⚙️ Workflows');
  if (!workflows.length) {
    lines.push('_No workflows defined yet._');
  } else {
    lines.push('| Workflow | Scope | Trigger Form | Event | Actions |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const w of workflows) {
      const acts = (w.actionKinds || []).join(', ') || '—';
      lines.push(
        `| \`${w.name}\` | ${w.scope || 'form'} | ${w.form ? `\`${w.form}\`` : '—'} | ${w.event || '—'} | ${acts} |`
      );
    }
  }
  lines.push('');

  /* --- Diagram --- */
  lines.push('### Application Flow Diagram');
  lines.push('');
  lines.push('```mermaid');
  lines.push(buildFlowchart(scope));
  lines.push('```');

  appendNotes(lines, scope, 'step1');
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/*  Step 2 — Data Model (Form fields & Lookups)                                */
/* -------------------------------------------------------------------------- */

export function renderStep2(scope) {
  const { forms, lookups } = scope;
  const lines = [];
  lines.push('## Step 2 — Data Model');
  lines.push('');
  lines.push('> In Zoho Creator, each **Form** _is_ the entity (table). Relationships are encoded as **Lookup fields** (Single-Select Lookup, Multi-Select Lookup, or Subform).');
  lines.push('');

  /* --- Form-by-form field listing --- */
  lines.push('### Form Fields');
  if (!forms.length) {
    lines.push('_No forms defined yet._');
  } else {
    for (const f of forms) {
      lines.push('');
      lines.push(`#### \`${f.name}\` — ${esc(f.displayName || f.name)}`);
      if ((f.fields || []).length === 0) {
        lines.push('_No fields yet._');
        continue;
      }
      lines.push('| Field | Display Name | Type | Required | Unique | Reference |');
      lines.push('| --- | --- | --- | :---: | :---: | --- |');
      for (const fd of f.fields) {
        const ref = fd.lookup
          ? `\`${fd.lookup}\``
          : (fd.values && fd.values.length
              ? '{' + fd.values.map((v) => `"${v}"`).join(', ') + '}'
              : (fd.formula ? `formula: \`${esc(fd.formula)}\`` : '—'));
        lines.push(
          `| \`${fd.name}\` | ${esc(fd.displayName || fd.name)} | ${fd.type || 'Single Line'} | ${fd.required ? '✓' : ''} | ${fd.unique ? '✓' : ''} | ${ref} |`
        );
      }
    }
  }
  lines.push('');

  /* --- Lookups summary --- */
  lines.push('### Lookups & Relationships');
  if (!lookups.length) {
    lines.push('_No lookup relationships defined yet._');
  } else {
    lines.push('| From Form | Field | → To Form | Kind |');
    lines.push('| --- | --- | --- | --- |');
    for (const lk of lookups) {
      lines.push(`| \`${lk.from}\` | \`${lk.field}\` | \`${lk.to}\` | ${lk.kind || 'single'} |`);
    }
  }
  lines.push('');

  /* --- ER diagram --- */
  lines.push('### Data Relationship Diagram');
  lines.push('');
  lines.push('```mermaid');
  lines.push(buildErDiagram(scope));
  lines.push('```');

  appendNotes(lines, scope, 'step2');
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/*  Step 3 — Roles & Profiles                                                  */
/* -------------------------------------------------------------------------- */

export function renderStep3(scope) {
  const { roles, profiles, pages } = scope;
  const lines = [];
  lines.push('## Step 3 — Roles & Profiles');
  lines.push('');
  lines.push('> In Creator, **Roles** form the org hierarchy and **Profiles** (declared inside `share_settings`) bundle the actual permissions per Form/Report. Pages inherit access from the profile that owns the embedded forms/reports.');
  lines.push('');

  /* --- Roles --- */
  lines.push('### 👥 Roles (org hierarchy)');
  if (!roles.length) {
    lines.push('_No roles defined yet._');
  } else {
    lines.push('| Role | Reports To | Description |');
    lines.push('| --- | --- | --- |');
    for (const r of roles) {
      lines.push(`| ${esc(r.name)} | ${r.parent ? esc(r.parent) : '—'} | ${esc(r.description || '—')} |`);
    }
  }
  lines.push('');

  /* --- Profiles --- */
  lines.push('### 🛡️ Permission Profiles');
  if (!profiles.length) {
    lines.push('_No profiles defined yet._');
  } else {
    for (const p of profiles) {
      lines.push('');
      lines.push(`#### ${esc(p.name)}${p.type ? ` _(type: ${p.type})_` : ''}`);
      if (p.description) lines.push(`> ${esc(p.description)}`);
      lines.push('');
      const mods = p.modulePermissions || [];
      if (!mods.length) {
        lines.push('_No module permissions set._');
        continue;
      }
      lines.push('| Form | Enabled Permissions | All Fields Visible | Report Access |');
      lines.push('| --- | --- | :---: | --- |');
      for (const m of mods) {
        const enabled = (m.enabled || []).join(', ') || '—';
        const reports = (m.reportPermissions || [])
          .map((rp) => `\`${rp.report}\`: ${(rp.actions || []).join('/')}`)
          .join('; ') || '—';
        lines.push(`| \`${m.form}\` | ${enabled} | ${m.allFieldsVisible ? '✓' : ''} | ${reports} |`);
      }
    }
  }
  lines.push('');

  /* --- Page access summary --- */
  lines.push('### 🖥️ Page Access');
  if (!pages.length) {
    lines.push('_No pages declared (see Step 1)._');
  } else {
    lines.push('| Page | Section | Inherits Access From |');
    lines.push('| --- | --- | --- |');
    for (const pg of pages) {
      const inherits =
        [...(pg.embeddedForms || []), ...(pg.embeddedReports || [])].map((x) => `\`${x}\``).join(', ')
        || '_open to all profiles_';
      lines.push(`| \`${pg.name}\` | ${pg.section || 'Default'} | ${inherits} |`);
    }
  }

  appendNotes(lines, scope, 'step3');
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/*  Step 4 — Functions, Connections, Blueprints, Batch Workflows & APIs        */
/* -------------------------------------------------------------------------- */

export function renderStep4(scope) {
  const {
    customFunctions = [],
    connections = [],
    schedules = [],
    publicAPIs = [],
    blueprints = [],
    batchWorkflows = [],
  } = scope;
  const lines = [];
  lines.push('## Step 4 — Functions, Connections, Blueprints, Batch Workflows & APIs');
  lines.push('');

  /* --- Blueprints --- */
  lines.push('### 🔷 Blueprints (Process / State-Machine Workflows)');
  lines.push('');
  lines.push('> Blueprints model a record\'s lifecycle as **Stages** connected by **Transitions**.');
  lines.push('> Each transition can have Before/After Deluge scripts and designated Transition Owners.');
  lines.push('');
  if (!blueprints.length) {
    lines.push('_No blueprints defined yet._');
  } else {
    for (const bp of blueprints) {
      lines.push(`#### Blueprint: \`${bp.name}\` — ${esc(bp.displayName)}`);
      lines.push(`- **Base Form:** \`${bp.form || '—'}\``);
      lines.push(`- **Run when:** ${bp.runWhen || 'always'}${bp.criteria ? ` (criteria: \`${esc(bp.criteria)}\`)` : ''}`);
      if (bp.description) lines.push(`- **Description:** ${esc(bp.description)}`);
      lines.push('');

      // Stages table
      if ((bp.stages || []).length) {
        lines.push('**Stages:**');
        lines.push('');
        lines.push('| Stage | Display | Initial | Terminal |');
        lines.push('| --- | --- | :---: | :---: |');
        for (const st of bp.stages) {
          lines.push(`| \`${st.name}\` | ${esc(st.displayName)} | ${st.isInitial ? '✓' : ''} | ${st.isTerminal ? '✓' : ''} |`);
        }
        lines.push('');
      }

      // Transitions table
      if ((bp.transitions || []).length) {
        lines.push('**Transitions:**');
        lines.push('');
        lines.push('| Transition | From Stage | → To Stage | Owners | Has Before Script | Has After Script |');
        lines.push('| --- | --- | --- | --- | :---: | :---: |');
        for (const tr of bp.transitions) {
          const owners = Array.isArray(tr.owners) ? tr.owners.join(', ') : (tr.owners || 'all');
          lines.push(
            `| **${esc(tr.name)}** | \`${tr.from}\` | \`${tr.to}\` | ${esc(owners)} | ${tr.beforeWorkflow ? '✓' : ''} | ${tr.afterWorkflow ? '✓' : ''} |`
          );
        }
        lines.push('');
      }

      // Mermaid state diagram
      lines.push('**State Diagram:**');
      lines.push('');
      lines.push('```mermaid');
      lines.push(buildBlueprintStateDiagram(bp));
      lines.push('```');
      lines.push('');

      // Per-transition Deluge skeleton
      if ((bp.transitions || []).length) {
        lines.push('**Transition Deluge Scripts (copy-paste skeleton):**');
        lines.push('');
        for (const tr of bp.transitions) {
          lines.push(`_Transition: **${esc(tr.name)}** (${tr.from} → ${tr.to})_`);
          lines.push('');
          lines.push('```deluge');
          lines.push(buildTransitionDelugeScript(bp, tr));
          lines.push('```');
          lines.push('');
        }
      }

      lines.push('---');
      lines.push('');
    }
  }

  /* --- Batch Workflows --- */
  lines.push('### ⚡ Batch Workflows (Bulk Record Processors)');
  lines.push('');
  lines.push('> Batch Workflows iterate over records in a form matching a criteria and apply Deluge per record.');
  lines.push('');
  if (!batchWorkflows.length) {
    lines.push('_No batch workflows defined yet._');
  } else {
    for (const bw of batchWorkflows) {
      lines.push(`#### Batch Workflow: \`${bw.name}\``);
      lines.push(`- **Form:** \`${bw.form || '—'}\``);
      lines.push(`- **Criteria:** ${bw.criteria ? `\`${esc(bw.criteria)}\`` : '_Process all records_'}`);
      lines.push(`- **Frequency:** ${bw.frequency || 'on_demand'}`);
      if (bw.scheduleName) lines.push(`- **Schedule:** \`${bw.scheduleName}\``);
      if (bw.description) lines.push(`- **Description:** ${esc(bw.description)}`);
      lines.push('');
      lines.push('**Deluge Script (per-record skeleton):**');
      lines.push('');
      lines.push('```deluge');
      lines.push(buildBatchWorkflowScript(bw));
      lines.push('```');
      lines.push('');
    }
  }

  /* --- Deluge custom functions --- */
  lines.push('### λ Custom Functions (Deluge)');
  lines.push('');
  if (!customFunctions.length) {
    lines.push('_No custom functions defined yet._');
  } else {
    // Summary table
    lines.push('| Function | Namespace | Returns | Params | Purpose |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const fn of customFunctions) {
      const params = (fn.params || [])
        .map((p) => `${p.name}:${p.type || 'string'}`)
        .join(', ') || '—';
      lines.push(
        `| \`${fn.name}\` | ${fn.namespace || '—'} | ${fn.returnType || 'void'} | ${params} | ${esc(fn.purpose || '—')} |`
      );
    }
    lines.push('');

    // Full Deluge skeleton per function
    lines.push('**Function Skeletons (copy-paste ready):**');
    lines.push('');
    for (const fn of customFunctions) {
      lines.push(`_Function: \`${fn.name}\`${fn.namespace ? ` (namespace: ${fn.namespace})` : ''}_`);
      lines.push('');
      lines.push('```deluge');
      lines.push(buildFunctionSkeleton(fn));
      lines.push('```');
      lines.push('');
    }
  }

  /* --- Connections --- */
  lines.push('### 🔌 Connections (third-party services)');
  if (!connections.length) {
    lines.push('_No connections defined yet._');
  } else {
    lines.push('| Service | Auth Type | Purpose |');
    lines.push('| --- | --- | --- |');
    for (const c of connections) {
      lines.push(`| ${esc(c.service)} | ${c.authType || 'oauth2'} | ${esc(c.purpose || '—')} |`);
    }
  }
  lines.push('');

  /* --- Schedules --- */
  lines.push('### ⏰ Schedules (time-based triggers)');
  if (!schedules.length) {
    lines.push('_No schedules defined yet._');
  } else {
    lines.push('| Name | Frequency | Cron | Calls |');
    lines.push('| --- | --- | --- | --- |');
    for (const s of schedules) {
      lines.push(
        `| \`${s.name}\` | ${s.frequency || '—'} | ${s.cron ? `\`${s.cron}\`` : '—'} | ${s.calls ? `\`${s.calls}\`` : '—'} |`
      );
    }
  }
  lines.push('');

  /* --- Public REST APIs --- */
  lines.push('### 🌐 Public REST APIs');
  if (!publicAPIs.length) {
    lines.push('_No public APIs exposed._');
  } else {
    lines.push('| Method | Path | Base Form | Auth | Purpose |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const a of publicAPIs) {
      lines.push(
        `| \`${a.method}\` | \`${a.path}\` | ${a.baseForm ? `\`${a.baseForm}\`` : '—'} | ${a.auth || 'apikey'} | ${esc(a.purpose || '—')} |`
      );
    }
  }

  appendNotes(lines, scope, 'step4');
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/*  Blueprint helpers                                                          */
/* -------------------------------------------------------------------------- */

function buildBlueprintStateDiagram(bp) {
  const lines = ['stateDiagram-v2'];
  const stages = bp.stages || [];
  const transitions = bp.transitions || [];

  // Initial stage
  const initial = stages.find((s) => s.isInitial);
  if (initial) lines.push(`    [*] --> ${initial.name}`);

  // Transitions
  for (const tr of transitions) {
    const label = tr.name ? ` : ${tr.name}` : '';
    lines.push(`    ${tr.from} --> ${tr.to}${label}`);
  }

  // Terminal stages
  for (const st of stages.filter((s) => s.isTerminal)) {
    lines.push(`    ${st.name} --> [*]`);
  }

  return lines.join('\n');
}

function buildTransitionDelugeScript(bp, tr) {
  const formName = bp.form || 'Your_Form';
  return [
    `// Blueprint: ${bp.displayName}`,
    `// Transition: "${tr.name}" | From: ${tr.from} → To: ${tr.to}`,
    `// Transition Owners: ${Array.isArray(tr.owners) ? tr.owners.join(', ') : (tr.owners || 'all')}`,
    `//`,
    `// ─── BEFORE TRANSITION SCRIPT ───────────────────────────────────────────────`,
    `// Runs before the stage changes. Use 'cancel submit' to block the transition.`,
    `//`,
    `// Fetch the current record`,
    `rec = ${formName}[ID == input.ID];`,
    ``,
    `// TODO: Add validation logic`,
    `// Example: Validate required fields before allowing transition`,
    `if(rec.Notes == null || rec.Notes == "")`,
    `{`,
    `    alert "Please add notes before moving to ${tr.to.replace(/_/g, ' ')}.";`,
    `    cancel submit;`,
    `}`,
    ``,
    ``,
    `// ─── AFTER TRANSITION SCRIPT ────────────────────────────────────────────────`,
    `// Runs after the stage has changed. Cannot cancel here.`,
    `//`,
    `rec = ${formName}[ID == input.ID];`,
    ``,
    `// TODO: Add post-transition automation`,
    `// Example 1: Update a field to reflect the new stage`,
    `rec.Status = "${tr.to.replace(/_/g, ' ')}";`,
    `rec.Last_Transition_By = zoho.loginuser;`,
    `rec.Last_Transition_Date = zoho.currenttime;`,
    ``,
    `// Example 2: Send notification email`,
    `// sendmail`,
    `// [`,
    `//     from: zoho.adminuserid`,
    `//     to: rec.Requestor_Email`,
    `//     subject: "Record moved to ${tr.to.replace(/_/g, ' ')}"`,
    `//     message: "Your record has been moved to the <b>${tr.to.replace(/_/g, ' ')}</b> stage by " + zoho.loginuser`,
    `// ]`,
    ``,
    `// Example 3: Log the transition`,
    `insert into ${formName}_Activity_Log`,
    `[`,
    `    Parent_Record = input.ID`,
    `    Action = "${tr.name}"`,
    `    From_Stage = "${tr.from}"`,
    `    To_Stage = "${tr.to}"`,
    `    Performed_By = zoho.loginuser`,
    `    Action_Time = zoho.currenttime`,
    `]`,
  ].join('\n');
}

/* -------------------------------------------------------------------------- */
/*  Batch Workflow helpers                                                     */
/* -------------------------------------------------------------------------- */

function buildBatchWorkflowScript(bw) {
  const formName = bw.form || 'Your_Form';
  const criteriaComment = bw.criteria
    ? `// Records matching criteria: ${bw.criteria}`
    : `// Criteria: all records (add criteria to filter)`;
  return [
    `// Batch Workflow: ${bw.displayName}`,
    `// Form: ${formName}`,
    criteriaComment,
    `// Frequency: ${bw.frequency || 'on_demand'}`,
    `// input.* = the current record being processed`,
    `//`,
    `// ─── PER-RECORD LOGIC ───────────────────────────────────────────────────────`,
    ``,
    `// TODO: Replace with your actual batch logic`,
    `// The batch workflow engine calls this script once per matching record.`,
    `// 'input.*' refers to fields of the CURRENT record being processed.`,
    ``,
    `// Example: Update a status field`,
    `// if(input.Due_Date < zoho.currentdate && input.Status == "Pending")`,
    `// {`,
    `//     input.Status = "Overdue";`,
    `//     input.Overdue_Since = zoho.currentdate;`,
    `// }`,
    ``,
    `// Example: Send an email per record`,
    `// sendmail`,
    `// [`,
    `//     from: zoho.adminuserid`,
    `//     to: input.Email`,
    `//     subject: "Notification for " + input.Name`,
    `//     message: "This is an automated notification for record: " + input.ID`,
    `// ]`,
    ``,
    `// Example: Create a related record`,
    `// insert into Related_Form`,
    `// [`,
    `//     Parent_Record = input.ID`,
    `//     Generated_On = zoho.currentdate`,
    `//     Status = "New"`,
    `// ]`,
    ``,
    `// Example: Log batch execution`,
    `insert into Batch_Execution_Log`,
    `[`,
    `    Batch_Name = "${bw.name}"`,
    `    Record_ID = input.ID`,
    `    Processed_On = zoho.currenttime`,
    `    Status = "Processed"`,
    `]`,
  ].join('\n');
}

/* -------------------------------------------------------------------------- */
/*  Function skeleton builder                                                  */
/* -------------------------------------------------------------------------- */

function buildFunctionSkeleton(fn) {
  const returnType = fn.returnType || 'void';
  const params = (fn.params || [])
    .map((p) => `${p.type || 'string'} ${p.name}`)
    .join(', ');
  const signature = `${returnType} ${fn.name}(${params})`;

  const purposeComment = fn.purpose ? `// Purpose: ${fn.purpose}` : `// Purpose: TODO — describe what this function does`;
  const namespaceComment = fn.namespace ? `// Namespace: ${fn.namespace} (call as: thisapp.${fn.namespace}.${fn.name}(...))` : `// Call as: thisapp.${fn.name}(...)`;

  // Build return statement based on return type
  let returnStatement = '';
  if (returnType !== 'void') {
    const returnDefaults = {
      string: 'return "";',
      int: 'return 0;',
      decimal: 'return 0.0;',
      bool: 'return false;',
      map: 'return Map();',
      list: 'return List();',
    };
    returnStatement = returnDefaults[returnType.toLowerCase()] || `return null; // TODO: return ${returnType}`;
  }

  const lines = [
    purposeComment,
    namespaceComment,
    `//`,
    signature,
    `{`,
    `    // TODO: Implement the function body`,
    `    //`,
    `    // Available system variables:`,
    `    //   zoho.loginuser     — current user's username`,
    `    //   zoho.loginuserid   — current user's email`,
    `    //   zoho.currentdate   — today's date`,
    `    //   zoho.currenttime   — current date + time`,
    `    //   zoho.adminuserid   — app owner email`,
    ``,
  ];

  // Add param usage hints
  for (const p of (fn.params || [])) {
    lines.push(`    // param '${p.name}': ${p.type || 'string'} — TODO: use this parameter`);
  }

  if (fn.params && fn.params.length > 0) lines.push('');
  lines.push(`    // Example: fetch records`);
  lines.push(`    // records = Form_Name[criteria];`);
  lines.push(`    // for each rec in records { ... }`);
  lines.push('');
  lines.push(`    // Example: insert a record`);
  lines.push(`    // insert into Form_Name [ Field1 = "value" Field2 = 42 ]`);
  lines.push('');
  lines.push(`    // Example: send email`);
  lines.push(`    // sendmail [ from: zoho.adminuserid to: "email@example.com" subject: "Subject" message: "Body" ]`);
  lines.push('');
  lines.push(`    // Example: call external API`);
  lines.push(`    // response = invokeurl [ url: "https://api.example.com" type: GET connection: "my_connection" ]`);

  if (returnStatement) {
    lines.push('');
    lines.push(`    ${returnStatement}`);
  }

  lines.push(`}`);
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/*  Step 5 — NFRs & Assumptions                                                */
/* -------------------------------------------------------------------------- */

export function renderStep5(scope) {
  const { nfrs, assumptions, outOfScope, application = {} } = scope;
  const lines = [];
  lines.push('## Step 5 — NFRs & Assumptions');
  lines.push('');

  /* --- Creator-specific platform assumptions --- */
  lines.push('### 🏗️ Creator Platform Assumptions');
  lines.push(`- **Edition:** ${application.edition || 'professional'} _(Standard / Professional / Flex)_`);
  lines.push(`- **Date format:** \`${application.dateFormat || 'dd-MMM-yyyy'}\``);
  lines.push(`- **Time zone:** \`${application.timeZone || 'Asia/Kolkata'}\``);
  lines.push(`- **Time format:** \`${application.timeFormat || '24-hr'}\``);
  lines.push('- Default storage and compute governance limits per Creator edition apply.');
  lines.push('- Built-in audit trail, role-based access, and field-level permissions used as-is.');
  lines.push('');

  /* --- NFRs --- */
  lines.push('### 📐 Non-Functional Requirements');
  if (!nfrs.length) {
    lines.push('_No NFRs captured yet._');
  } else {
    const byCat = groupBy(nfrs, (n) => n.category || 'General');
    for (const cat of Object.keys(byCat).sort()) {
      lines.push(`- **${cat}**`);
      for (const n of byCat[cat]) lines.push(`  - ${esc(n.statement)}`);
    }
  }
  lines.push('');

  /* --- Assumptions --- */
  lines.push('### 📋 Assumptions');
  if (!assumptions.length) {
    lines.push('_No assumptions captured yet._');
  } else {
    for (const a of assumptions) lines.push(`- ${esc(a)}`);
  }
  lines.push('');

  /* --- Out of Scope --- */
  lines.push('### 🚫 Out of Scope');
  if (!outOfScope.length) {
    lines.push('_Nothing explicitly out of scope._');
  } else {
    for (const o of outOfScope) lines.push(`- ${esc(o)}`);
  }

  appendNotes(lines, scope, 'step5');
  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/*  Combined document                                                          */
/* -------------------------------------------------------------------------- */

export function renderFullDocument(scope) {
  const { meta, application = {} } = scope;
  const out = [];
  out.push(`# Technical Scope — ${application.name || meta.title || 'Untitled Creator App'}`);
  out.push('');
  out.push(`> Generated by **Technical Scope Creator** on ${new Date(meta.updatedAt || Date.now()).toLocaleString()}.`);
  out.push(`> Output format: **Zoho Creator** application scope (mirrors \`.ds\` vocabulary).`);
  if (meta.sourceFile) out.push(`> Source BRD: \`${meta.sourceFile}\``);
  out.push('');
  out.push('---');
  out.push('');
  out.push('## Table of Contents');
  out.push('1. **Application Flow** — Forms · Reports · Pages · Workflows');
  out.push('2. **Data Model** — Form Fields · Lookups · Subforms');
  out.push('3. **Roles & Profiles** — Org Hierarchy · Permission Profiles · Page Access');
  out.push('4. **Functions, Connections, Blueprints, Batch Workflows & APIs** — Deluge Functions · Blueprints · Batch Workflows · Schedules · Connections · Public APIs');
  out.push('5. **NFRs & Assumptions** — Edition · Limits · Out-of-Scope');
  out.push('');
  out.push('---');
  out.push('');
  out.push(renderStep1(scope));
  out.push('');
  out.push('---');
  out.push('');
  out.push(renderStep2(scope));
  out.push('');
  out.push('---');
  out.push('');
  out.push(renderStep3(scope));
  out.push('');
  out.push('---');
  out.push('');
  out.push(renderStep4(scope));
  out.push('');
  out.push('---');
  out.push('');
  out.push(renderStep5(scope));
  return out.join('\n');
}

export const STEP_RENDERERS = {
  step1: renderStep1,
  step2: renderStep2,
  step3: renderStep3,
  step4: renderStep4,
  step5: renderStep5,
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function appendNotes(lines, scope, stepId) {
  const notes = scope.notes?.[stepId] || [];
  if (!notes.length) return;
  lines.push('');
  lines.push('### 📝 Notes');
  for (const n of notes) lines.push(`- ${esc(n)}`);
}

function esc(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function groupBy(arr, fn) {
  return arr.reduce((acc, x) => {
    const k = fn(x);
    (acc[k] ||= []).push(x);
    return acc;
  }, {});
}
