/**
 * Step-1 analyser:
 *   Parse the .ds file and produce a human-readable overview of the
 *   Creator app without requiring a requirement document.
 *
 *   Pipeline:
 *     1. Parse .ds (reuses dsParser).
 *     2. Compute deterministic stats (counts, field-type histograms, …).
 *     3. Ask an LLM for a short narrative summary (best-effort —
 *        if no provider is configured we return a rule-based summary).
 */
const { parseDs } = require('../parsers/dsParser');
const llmRouter = require('../../shared/llm/router');
const { analysePerformance } = require('./performance');

function computeStats(ds) {
  const fieldTypeHist = {};
  let totalFields = 0;
  let requiredFields = 0;
  let uniqueFields = 0;

  (ds.forms || []).forEach((f) => {
    (f.fields || []).forEach((fd) => {
      totalFields += 1;
      if (fd.required) requiredFields += 1;
      if (fd.unique) uniqueFields += 1;
      const t = fd.type || 'unknown';
      fieldTypeHist[t] = (fieldTypeHist[t] || 0) + 1;
    });
  });

  const reportTypeHist = {};
  (ds.reports || []).forEach((r) => {
    const t = r.type || 'unknown';
    reportTypeHist[t] = (reportTypeHist[t] || 0) + 1;
  });

  const workflowEventHist = {};
  (ds.workflows || []).forEach((w) => {
    const key = w.event || w.scope || 'unknown';
    workflowEventHist[key] = (workflowEventHist[key] || 0) + 1;
  });

  const pagesWithScript = (ds.pages || []).filter((p) => p.hasScript).length;

  return {
    entityCounts: {
      forms: (ds.forms || []).length,
      reports: (ds.reports || []).length,
      pages: (ds.pages || []).length,
      workflows: (ds.workflows || []).length,
      customFunctions: (ds.customFunctions || []).length,
      roles: (ds.roles || []).length,
      profiles: (ds.shareSettings || []).length,
    },
    fields: {
      total: totalFields,
      required: requiredFields,
      unique: uniqueFields,
      byType: fieldTypeHist,
    },
    reportsByType: reportTypeHist,
    workflowsByEvent: workflowEventHist,
    pagesWithScript,
  };
}

function buildFormDigest(ds) {
  return (ds.forms || []).map((f) => ({
    name: f.name,
    displayName: f.displayName,
    fieldCount: (f.fields || []).length,
    requiredFields: (f.fields || []).filter((fd) => fd.required).map((fd) => fd.name),
    fields: (f.fields || []).map((fd) => ({
      name: fd.name,
      displayName: fd.displayName,
      type: fd.type,
      required: !!fd.required,
      unique: !!fd.unique,
      maxLength: fd.maxLength ?? null,
      lookup: fd.lookup ?? null,
    })),
    actionEvents: (f.actions?.events || []).map((e) => e.event),
  }));
}

function buildReportDigest(ds) {
  return (ds.reports || []).map((r) => ({
    name: r.name,
    displayName: r.displayName,
    type: r.type,
    baseForm: r.baseForm,
    columnCount: r.columnCount,
    hidden: !!r.hidden,
    customActions: r.customActions || [],
  }));
}

function buildPageDigest(ds) {
  return (ds.pages || []).map((p) => ({
    name: p.name,
    displayName: p.displayName,
    section: p.section,
    hidden: !!p.hidden,
    contentSize: p.contentSize,
    hasScript: !!p.hasScript,
    params: p.params,
    embeddedForms: p.embeddedForms || [],
    embeddedReports: p.embeddedReports || [],
    sourceCode: p.sourceCode || '',
  }));
}

function buildWorkflowDigest(ds) {
  return (ds.workflows || []).map((w) => ({
    name: w.name,
    displayName: w.displayName,
    scope: w.scope,
    type: w.type,
    form: w.form,
    event: w.event,
    actionKinds: w.actionKinds || [],
    sourceCode: w.sourceCode || '',
  }));
}

function buildFunctionDigest(ds) {
  return (ds.customFunctions || []).map((fn) => ({
    name: fn.name,
    namespace: fn.namespace,
    returnType: fn.returnType,
    paramCount: (fn.params || []).length,
    scriptSize: fn.scriptSize,
    language: fn.language,
    // Carry the full function body through so client/server tools that
    // search by source (e.g. find-usages) have something to scan.
    sourceCode: fn.sourceCode || '',
  }));
}

/* -------------------------------------------------------------------------- */
/*  Technical Scope                                                            */
/*                                                                             */
/*  A user-facing, fully-detailed view of the parsed application:              */
/*    - every form with its full field table                                   */
/*    - every form's attached workflows (event → actions)                      */
/*    - every report with its base form                                        */
/*    - every page with embedded forms/reports                                 */
/*    - a relationship graph (lookup, baseForm, embeds, attached workflow)     */
/*                                                                             */
/*  Produced deterministically from the parsed DS — no LLM involved.           */
/* -------------------------------------------------------------------------- */

function buildRelationships(ds) {
  const edges = [];
  const formNames = new Set((ds.forms || []).map((f) => f.name));

  // Form → Form via lookup fields
  (ds.forms || []).forEach((f) => {
    (f.fields || []).forEach((fd) => {
      if (fd.lookup) {
        // lookup may be a string (target form name) or an object { form, field }
        const target =
          typeof fd.lookup === 'string'
            ? fd.lookup
            : fd.lookup.form || fd.lookup.target || fd.lookup.formName;
        if (target) {
          edges.push({
            from: `form:${f.name}`,
            to: `form:${target}`,
            kind: 'lookup',
            via: fd.name,
            resolved: formNames.has(target),
          });
        }
      }
    });
  });

  // Report → Form (baseForm)
  (ds.reports || []).forEach((r) => {
    if (r.baseForm) {
      edges.push({
        from: `report:${r.name}`,
        to: `form:${r.baseForm}`,
        kind: 'baseForm',
        resolved: formNames.has(r.baseForm),
      });
    }
  });

  // Page → Form / Page → Report
  (ds.pages || []).forEach((p) => {
    (p.embeddedForms || []).forEach((fn) =>
      edges.push({
        from: `page:${p.name}`,
        to: `form:${fn}`,
        kind: 'embedsForm',
        resolved: formNames.has(fn),
      })
    );
    (p.embeddedReports || []).forEach((rn) =>
      edges.push({
        from: `page:${p.name}`,
        to: `report:${rn}`,
        kind: 'embedsReport',
        resolved: true,
      })
    );
  });

  // Workflow → Form (attached)
  (ds.workflows || []).forEach((w) => {
    if (w.form) {
      edges.push({
        from: `workflow:${w.name}`,
        to: `form:${w.form}`,
        kind: 'attached',
        event: w.event || null,
        resolved: formNames.has(w.form),
      });
    }
  });

  return edges;
}

function buildTechnicalScope(ds, forms, reports, pages, workflows, functions) {
  // Attach each form's workflows (by w.form match on either name or displayName).
  const formsWithWf = forms.map((f) => {
    const attached = workflows.filter(
      (w) => w.form === f.name || w.form === f.displayName
    );
    return { ...f, workflows: attached };
  });

  const relationships = buildRelationships(ds);

  // Bucket edges by source for fast UI rendering
  const edgesByEntity = {};
  relationships.forEach((e) => {
    edgesByEntity[e.from] = edgesByEntity[e.from] || [];
    edgesByEntity[e.from].push(e);
  });

  return {
    forms: formsWithWf,
    reports,
    pages,
    workflows,
    customFunctions: functions,
    relationships,
    edgesByEntity,
  };
}

function deterministicSummary(ds, stats) {
  const name = ds.application?.name || ds._raw?.fileName || 'the uploaded application';
  const parts = [
    `${name} is a Zoho Creator application containing ${stats.entityCounts.forms} form(s), ` +
      `${stats.entityCounts.reports} report(s), ${stats.entityCounts.pages} page(s) and ` +
      `${stats.entityCounts.workflows} workflow(s).`,
  ];
  if (stats.fields.total > 0) {
    const topType = Object.entries(stats.fields.byType).sort((a, b) => b[1] - a[1])[0];
    parts.push(
      `It defines ${stats.fields.total} field(s) in total, of which ${stats.fields.required} ` +
        `are marked required${topType ? ` (most common type: ${topType[0]})` : ''}.`
    );
  }
  if (stats.entityCounts.customFunctions > 0) {
    parts.push(`${stats.entityCounts.customFunctions} custom function(s) defined.`);
  }
  if (stats.entityCounts.workflows > 0) {
    const events = Object.entries(stats.workflowsByEvent)
      .map(([k, v]) => `${k}×${v}`)
      .join(', ');
    parts.push(`Workflow events: ${events}.`);
  }
  if ((ds.warnings || []).length > 0) {
    parts.push(`Parser notes: ${ds.warnings.length} warning(s).`);
  }
  return parts.join(' ');
}

async function llmSummary(ds, stats) {
  const digest = {
    application: ds.application,
    stats,
    forms: buildFormDigest(ds).slice(0, 25),
    reports: buildReportDigest(ds).slice(0, 25),
    pages: buildPageDigest(ds).slice(0, 15),
    workflows: buildWorkflowDigest(ds).slice(0, 25),
    customFunctions: buildFunctionDigest(ds).slice(0, 15),
    roles: (ds.roles || []).slice(0, 15),
  };

  const system =
    'You are a senior Zoho Creator consultant. Given a parsed Creator application digest, ' +
    'write a concise briefing for a product manager who has never seen the app. ' +
    'Output STRICT JSON matching this shape and nothing else:\n' +
    '{\n' +
    '  "headline": string,                // one sentence, <=140 chars\n' +
    '  "purpose": string,                 // 2-3 sentences describing what the app appears to do\n' +
    '  "keyEntities": string[],           // 3-6 bullets naming the most important forms/reports\n' +
    '  "automation": string,              // 1-2 sentences on workflows / custom functions / scripts\n' +
    '  "risks": string[]                  // 0-4 short risk / assumption notes\n' +
    '}';

  const user =
    '### APPLICATION DIGEST\n```json\n' +
    JSON.stringify(digest, null, 2) +
    '\n```\n\nReturn ONLY the JSON object.';

  try {
    const { provider, data } = await llmRouter.run('pmRewrite', { system, user });
    if (data && typeof data === 'object' && data.headline) {
      return { provider, overview: data };
    }
  } catch (err) {
    return { provider: null, error: err.message };
  }
  return { provider: null };
}

async function inspectDs({ buffer, name }) {
  const ds = await parseDs(buffer, name);
  const stats = computeStats(ds);

  const { provider, overview, error } = await llmSummary(ds, stats);
  const fallbackSummary = deterministicSummary(ds, stats);

  const formsDigest = buildFormDigest(ds);
  const reportsDigest = buildReportDigest(ds);
  const pagesDigest = buildPageDigest(ds);
  const workflowsDigest = buildWorkflowDigest(ds);
  const functionsDigest = buildFunctionDigest(ds);

  const technicalScope = buildTechnicalScope(
    ds,
    formsDigest,
    reportsDigest,
    pagesDigest,
    workflowsDigest,
    functionsDigest
  );

  // Performance audit (deterministic, based on rules/Performance_Matrix.md)
  let performance = null;
  try {
    performance = analysePerformance(ds);
  } catch (err) {
    performance = {
      summary: { total: 0, critical: 0, warning: 0, info: 0, highImpact: 0 },
      byCategory: {}, byRule: {}, findings: [], topImpact: [], volumeTiers: [],
      error: `Performance analyser failed: ${err.message}`,
    };
  }

  return {
    ok: true,
    meta: {
      provider: provider || 'deterministic',
      fileName: ds._raw?.fileName,
      format: ds._raw?.format,
      sizeBytes: ds._raw?.sizeBytes,
      dsWarnings: ds.warnings,
      llmError: error || null,
    },
    app: {
      name: ds.application?.name || '',
      namespace: ds.application?.namespace || '',
      version: ds.application?.version || '',
      dateFormat: ds.application?.dateFormat || '',
      timeZone: ds.application?.timeZone || '',
      timeFormat: ds.application?.timeFormat || '',
    },
    stats,
    forms: formsDigest,
    reports: reportsDigest,
    pages: pagesDigest,
    workflows: workflowsDigest,
    customFunctions: functionsDigest,
    roles: ds.roles || [],
    profiles: ds.shareSettings || [],
    technicalScope,
    performance,
    overview: overview || {
      headline: fallbackSummary,
      purpose: '',
      keyEntities: (ds.forms || [])
        .slice(0, 5)
        .map((f) => f.displayName || f.name),
      automation:
        stats.entityCounts.workflows > 0 || stats.entityCounts.customFunctions > 0
          ? `${stats.entityCounts.workflows} workflow(s) and ${stats.entityCounts.customFunctions} custom function(s) defined.`
          : 'No workflows or custom functions detected.',
      risks: ds.warnings || [],
    },
  };
}

module.exports = {
  inspectDs,
  _internal: { computeStats, deterministicSummary, buildTechnicalScope, buildRelationships },
};
