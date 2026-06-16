/**
 * POST /api/change-request
 *
 * Unified "Developer Change Sheet" endpoint — the single backend entry point
 * for Step 2 of the DS Analyser.
 *
 * The consultant types ONE plain-English prompt. We run a hybrid pipeline:
 *
 *   1. **Deterministic rename extractor** parses the prompt for
 *      "change X to Y" / "rename X to Y" / "replace X with Y" style verbs.
 *   2. **LLM change planner** (`suggestChanges`) produces structural /
 *      behavioural change cards AND its own `lineEditHints` for tokens it
 *      noticed in the prompt.
 *   3. **Deterministic find-usages scanner** runs once per unique
 *      (oldValue, newValue) pair from steps 1 + 2 against the parsed .ds
 *      to produce PRECISE file/line/column edit locations.
 *
 * The response is one merged object — see `RESPONSE SHAPE` below — that the
 * frontend renders as a single Developer Change Sheet (and exports as
 * Markdown for tickets).
 *
 * Why this is one endpoint, not three:
 *   - The consultant prompts ONCE. They should not have to choose "is this
 *     a rename or a structural change?" — that's our job.
 *   - Real prompts mix both (e.g. "change shriniwash.yadav_adityabirla to
 *     utcl_cms and also make the Email field on Customers required").
 *   - LLM availability is variable. The deterministic half always works;
 *     the LLM half augments it. We degrade gracefully.
 *
 * RESPONSE SHAPE (success — HTTP 200):
 *   {
 *     provider: "openai" | "anthropic" | "stub" | null,
 *     llmAvailable: boolean,
 *     plan: {
 *       summary, intent, confidence,
 *       changes:        [...],     // structural changes (LLM)
 *       lineEdits:      [...],     // grouped rename results (deterministic)
 *       outOfScope:     [...],     // honest "not in .ds" notes (LLM)
 *       warnings:       [...],
 *       openQuestions:  [...],
 *     }
 *   }
 *
 *   `lineEdits` is an array of:
 *     {
 *       oldValue, newValue, source: 'prompt' | 'llm' | 'both',
 *       note?: string,
 *       totals: { occurrences, entitiesWithMatches, truncated },
 *       groupedByEntity: [ ...findUsages-shaped entries... ],
 *     }
 *
 * ERROR CASES:
 *   400 — bad input
 *   413 — overview too large
 *   502 — LLM call failed AND no deterministic renames either
 *   200 with `llmAvailable: false` — stub-mode fallback when we DO have
 *         deterministic renames to report (the user still gets line edits).
 */

const express = require('express');
const { ApiError } = require('../../shared/utils/errors');
const { suggestChanges } = require('../llm/suggestChanges');
const { findUsages } = require('../analyzer/findUsages');
const { extractRenames } = require('../analyzer/extractRenames');

const router = express.Router();

const MAX_INSTRUCTION = 4_000;
const MAX_OVERVIEW_BYTES = 6_000_000;
const MAX_RENAMES = 12; // cap merged rename list — protects findUsages from a runaway prompt

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Merge prompt-extracted renames with LLM-supplied `lineEditHints`, dedupe
 * by (oldValue, newValue), and tag each entry with where it came from so
 * the UI can show provenance.
 *
 * Rules:
 *   - Same (old, new) appearing in BOTH lists → source: 'both', note from
 *     the LLM (the human-friendlier of the two).
 *   - The prompt extractor never produces empty newValue, so if the LLM
 *     emits a hint with an empty newValue (rare — means "find only"), we
 *     keep it as-is from the LLM source.
 *   - We cap the merged list at MAX_RENAMES to keep find-usages bounded.
 */
function mergeRenames(promptRenames, llmHints) {
  const map = new Map();
  // Tolerate null / undefined from either pipeline half — callers shouldn't
  // have to pre-check, and the route does pass `[]` defaults but unit tests
  // exercise the null path explicitly.
  const safePrompt = Array.isArray(promptRenames) ? promptRenames : [];
  const safeLlm = Array.isArray(llmHints) ? llmHints : [];

  for (const r of safePrompt) {
    if (!r || !r.oldValue || !r.newValue) continue;
    const key = `${r.oldValue}\u0000${r.newValue}`;
    map.set(key, { oldValue: r.oldValue, newValue: r.newValue, source: 'prompt', note: '' });
  }

  for (const h of safeLlm) {
    if (!h || !h.oldValue) continue;
    const newValue = typeof h.newValue === 'string' ? h.newValue : '';
    const key = `${h.oldValue}\u0000${newValue}`;
    const existing = map.get(key);
    if (existing) {
      existing.source = 'both';
      if (h.note) existing.note = h.note;
    } else {
      map.set(key, {
        oldValue: h.oldValue,
        newValue,
        source: 'llm',
        note: h.note || '',
      });
    }
  }

  return Array.from(map.values()).slice(0, MAX_RENAMES);
}

/**
 * Run the deterministic find-usages scanner for every rename pair and
 * package the results into the `lineEdits[]` array used by the response.
 *
 * Each rename gets its own findUsages call — they are independent searches
 * with different (old, new) values, so we can't batch them.
 */
function locateLineEdits(overview, renames) {
  const out = [];
  for (const r of renames) {
    const result = findUsages(overview, r.oldValue, {
      wholeWord: true, // identifier-rename default; matches the route's wholeWord:true rule
      // newValue '' is legitimate ("find references only") — pass undefined in that case
      // so the scanner skips the replacement-preview path.
      newValue: r.newValue || undefined,
    });
    out.push({
      oldValue: r.oldValue,
      newValue: r.newValue,
      source: r.source,
      note: r.note || '',
      totals: result.totals,
      groupedByEntity: result.groupedByEntity,
      error: result.error || undefined,
    });
  }
  return out;
}

/**
 * Build lookup indexes over the parsed overview so we can deterministically
 * back-fill missing `target.parentEntity` / `target.parentName` / `target.trigger`
 * / `target.scope` on LLM-proposed changes. The LLM is REQUIRED by prompt rules
 * to emit these for Workflows / Fields / Functions, but older / weaker models
 * occasionally omit them — and the deterministic .ds digest is the source of
 * truth anyway, so we trust it over the model.
 *
 * Returned shape:
 *   {
 *     workflowsByName: Map<name, { form, event, scope }>,
 *     fieldOwnersByFieldName: Map<fieldName, formName[]>,
 *     functionFormByName: Map<functionName, { formName, kind }>,
 *   }
 *
 * `fieldOwnersByFieldName` can resolve a bare "FieldX" to its parent form
 * ONLY when the name is unique across the app. Ambiguous fields (same name
 * on multiple forms) deliberately resolve to `null` so we don't lie.
 */
function buildOverviewIndex(overview) {
  const workflowsByName = new Map();
  for (const w of overview?.workflows || []) {
    if (!w?.name) continue;
    workflowsByName.set(w.name, {
      form: w.form || '',
      event: w.event || '',
      scope: w.scope || '',
    });
  }

  const fieldOwnersByFieldName = new Map();
  for (const f of overview?.forms || []) {
    for (const fd of f?.fields || []) {
      if (!fd?.name) continue;
      const owners = fieldOwnersByFieldName.get(fd.name) || [];
      owners.push(f.name);
      fieldOwnersByFieldName.set(fd.name, owners);
    }
  }

  return { workflowsByName, fieldOwnersByFieldName };
}

/**
 * Mutate `plan.changes` so every change targeting a Workflow / Field /
 * Function carries enough parent context for a developer to find it in the
 * Creator builder without re-reading the .ds. We never overwrite values the
 * LLM provided — we only fill in MISSING ones.
 *
 * Returns the same plan object for fluent use.
 */
function enrichChangeTargets(plan, overview) {
  if (!plan || !Array.isArray(plan.changes) || plan.changes.length === 0) {
    return plan;
  }
  const { workflowsByName, fieldOwnersByFieldName } = buildOverviewIndex(overview);

  for (const c of plan.changes) {
    if (!c || !c.target) continue;
    const t = c.target;
    const isWorkflow = t.entity === 'Workflow';
    const isField = t.entity === 'Field';

    if (isWorkflow && t.name && workflowsByName.has(t.name)) {
      const wf = workflowsByName.get(t.name);
      if (!t.parentName && wf.form) {
        t.parentName = wf.form;
        // parentEntity defaults to 'Form' for form-bound workflows. Report-
        // bound workflows would have scope='report' and the parser would set
        // `form` to '' — we leave parentEntity unset in that case so the UI
        // shows trigger/scope alone rather than a wrong "Form: …" badge.
        if (!t.parentEntity) t.parentEntity = 'Form';
      }
      if (!t.trigger && wf.event) t.trigger = wf.event;
      if (!t.scope && wf.scope) t.scope = wf.scope;
    }

    if (isField && t.name && !t.parentName) {
      // The LLM is supposed to send "FormName.FieldName" but sometimes sends
      // "FieldName" alone. If the bare field name is unique across the app
      // we can recover the parent form deterministically; if it's ambiguous
      // we leave it blank rather than guess.
      let bareFieldName = t.name;
      let parentFromDotted = '';
      const dotIdx = t.name.indexOf('.');
      if (dotIdx > 0) {
        parentFromDotted = t.name.slice(0, dotIdx);
        bareFieldName = t.name.slice(dotIdx + 1);
      }
      if (parentFromDotted) {
        t.parentEntity = t.parentEntity || 'Form';
        t.parentName = parentFromDotted;
      } else {
        const owners = fieldOwnersByFieldName.get(bareFieldName) || [];
        if (owners.length === 1) {
          t.parentEntity = t.parentEntity || 'Form';
          t.parentName = owners[0];
        }
      }
    }
  }
  return plan;
}

/**
 * Stub-mode plan factory. When no LLM is configured we still want a
 * structured response to render so the deterministic line edits are useful
 * on their own. We assemble a minimal plan with explicit messaging that
 * the LLM did not run.
 */
function buildStubPlan(reason, hadRenames) {
  return {
    summary: hadRenames
      ? 'AI is not configured — showing deterministic rename results only. Structural / behavioural analysis was skipped.'
      : 'AI is not configured and no literal rename was detected in your prompt. No automated analysis available.',
    intent: '',
    confidence: hadRenames ? 0.5 : 0,
    changes: [],
    outOfScope: [],
    warnings: [
      `No AI provider configured on the server (${reason}). ` +
        'Add an OPENAI_API_KEY or ANTHROPIC_API_KEY to functions/ds-analyzer/.env and restart for full analysis.',
    ],
    openQuestions: [],
  };
}

// -----------------------------------------------------------------------------
// Route
// -----------------------------------------------------------------------------

router.post('/', async (req, res, next) => {
  try {
    const { instruction, overview } = req.body || {};

    if (typeof instruction !== 'string' || instruction.trim().length === 0) {
      throw new ApiError(400, 'instruction is required');
    }
    if (instruction.length > MAX_INSTRUCTION) {
      throw new ApiError(400, `instruction too long (max ${MAX_INSTRUCTION} chars)`);
    }
    if (!overview || typeof overview !== 'object' || Array.isArray(overview)) {
      throw new ApiError(400, 'overview (object) is required — pass the /api/inspect response');
    }
    const rawSize = Buffer.byteLength(JSON.stringify(overview), 'utf8');
    if (rawSize > MAX_OVERVIEW_BYTES) {
      throw new ApiError(
        413,
        `Uploaded application is too large to analyse (${(rawSize / 1024 / 1024).toFixed(1)} MB; ` +
          `max ${(MAX_OVERVIEW_BYTES / 1024 / 1024).toFixed(0)} MB).`
      );
    }

    const trimmedInstruction = instruction.trim();

    // (1) Deterministic prompt scan — runs even when the LLM is absent.
    const promptRenames = extractRenames(trimmedInstruction);

    // (2) LLM change plan. We isolate failures so they don't kill the
    //     deterministic half of the response.
    let llmResult = null;
    let llmError = null;
    try {
      llmResult = await suggestChanges({
        instruction: trimmedInstruction,
        overview,
        mode: 'request',
      });
    } catch (err) {
      llmError = err;
      console.warn('[change-request] LLM step failed:', err.message);
    }

    // Classify the LLM outcome.
    const llmFallback = !!(llmResult && llmResult.useFallback);
    const llmPlan = llmResult && llmResult.plan ? llmResult.plan : null;
    const llmHints = llmPlan ? llmPlan.lineEditHints || [] : [];

    // (3) Merge renames + locate them deterministically.
    const renames = mergeRenames(promptRenames, llmHints);
    const lineEdits = locateLineEdits(overview, renames);

    // -------------------------------------------------------------------------
    // Build the response.
    // -------------------------------------------------------------------------

    // Happy path: LLM succeeded.
    if (llmPlan) {
      // Deterministically back-fill parent / trigger / scope on every change
      // target where the LLM omitted it. Done OUT-OF-LINE from the LLM so
      // even older models / cached responses benefit. Pure mutation — safe.
      enrichChangeTargets(llmPlan, overview);
      return res.json({
        provider: llmResult.provider,
        llmAvailable: true,
        plan: {
          summary: llmPlan.summary,
          intent: llmPlan.intent,
          confidence: llmPlan.confidence,
          changes: llmPlan.changes,
          lineEdits,
          outOfScope: llmPlan.outOfScope,
          warnings: llmPlan.warnings,
          openQuestions: llmPlan.openQuestions,
        },
      });
    }

    // Stub fallback: LLM not configured. Deterministic half may still have
    // useful results.
    if (llmFallback) {
      return res.json({
        provider: 'stub',
        llmAvailable: false,
        plan: {
          ...buildStubPlan(llmResult.reason || 'no LLM provider configured', renames.length > 0),
          lineEdits,
        },
      });
    }

    // LLM call genuinely failed. If we have deterministic renames, still
    // return them with a clear warning. Otherwise surface as 502.
    if (lineEdits.length > 0) {
      return res.json({
        provider: null,
        llmAvailable: false,
        plan: {
          summary:
            'AI step failed — showing deterministic rename results only. Re-run the request to retry the AI analysis.',
          intent: '',
          confidence: 0.5,
          changes: [],
          lineEdits,
          outOfScope: [],
          warnings: [
            `AI step failed: ${llmError ? llmError.message : 'unknown error'}`,
          ],
          openQuestions: [],
        },
      });
    }

    // Nothing usable from either half.
    return res.status(502).json({
      error: 'Change-request analysis failed.',
      detail: llmError ? llmError.message : 'No content from any pipeline step.',
    });
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    console.warn('[change-request] failed:', err.message);
    return res.status(502).json({
      error: 'Change-request analysis failed.',
      detail: err.message,
    });
  }
});

// Default export = the Express router so `app.use('/api/change-request', require(...))`
// works the same way as every other route in this codebase. The helpers are
// re-attached for unit-test access.
module.exports = router;
module.exports._internal = {
  mergeRenames,
  locateLineEdits,
  buildStubPlan,
  enrichChangeTargets,
  buildOverviewIndex,
};
