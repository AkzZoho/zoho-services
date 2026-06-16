/**
 * POST /api/suggest-changes
 *
 * Step-2 of the DS Analyser: after parsing a .ds, the consultant types
 * a plain-English change request and we ask an LLM to propose a SAFE,
 * REVIEWABLE change plan against the live Creator app.
 *
 * Body (application/json):
 *   {
 *     instruction: string  (required when mode !== 'audit'; 1..4000 chars)
 *     overview:    object  (required) — the full response from /api/inspect
 *     mode:        'request' | 'audit'   (optional, defaults to 'request')
 *         - 'request': the consultant typed a specific change request.
 *         - 'audit':   no instruction needed; the server asks the LLM to
 *                      proactively audit the .ds for the highest-value
 *                      DS-specific improvements (uses AUDIT_INSTRUCTION).
 *   }
 *
 * Responses:
 *   200 { provider, plan }
 *       — see plan shape in `llm/suggestChanges.js`.
 *   501 { useFallback: true, reason }
 *       — no LLM provider configured.
 *   400 { error }
 *       — bad input.
 *   502 { error, detail }
 *       — LLM call failed.
 */
const express = require('express');
const { ApiError } = require('../../shared/utils/errors');
const { suggestChanges } = require('../llm/suggestChanges');

const router = express.Router();

const MAX_INSTRUCTION = 4_000;
// Hard ceiling on the raw overview JSON. Large customer apps can produce
// 1.5–2 MB inspect responses (lots of workflows with embedded Deluge source).
// We accept anything up to this cap and then SLIM it down to a digest-shaped
// subset before measuring against MAX_DIGEST_INPUT_BYTES below — this keeps
// the LLM prompt safe without rejecting valid uploads.
const MAX_OVERVIEW_BYTES = 5_000_000; // 5 MB raw overview
// After slimming (see slimOverview), the keys that actually feed the digest
// must fit inside this cap. 1.5 MB is generous — the digest itself is tiny.
const MAX_DIGEST_INPUT_BYTES = 1_500_000;

/**
 * Strip the overview down to the keys buildDigest() actually reads.
 * Everything else (workflow source code, raw XML, field display attributes,
 * etc.) is wasted prompt budget. Keeps the route resilient to large apps.
 */
function slimOverview(overview) {
  const o = overview || {};
  return {
    app: o.app
      ? { name: o.app.name, namespace: o.app.namespace, timeZone: o.app.timeZone }
      : undefined,
    meta: o.meta ? { fileName: o.meta.fileName } : undefined,
    forms: Array.isArray(o.forms)
      ? o.forms.map((f) => ({
          name: f && f.name,
          displayName: f && f.displayName,
          fields: Array.isArray(f && f.fields)
            ? f.fields.map((fd) => ({
                name: fd && fd.name,
                type: fd && fd.type,
                required: fd && fd.required,
                unique: fd && fd.unique,
                lookup: fd && fd.lookup,
              }))
            : [],
        }))
      : [],
    reports: Array.isArray(o.reports)
      ? o.reports.map((r) => ({
          name: r && r.name,
          displayName: r && r.displayName,
          type: r && r.type,
          baseForm: r && r.baseForm,
        }))
      : [],
    pages: Array.isArray(o.pages)
      ? o.pages.map((p) => ({
          name: p && p.name,
          displayName: p && p.displayName,
          embeddedForms: Array.isArray(p && p.embeddedForms) ? p.embeddedForms : [],
          embeddedReports: Array.isArray(p && p.embeddedReports) ? p.embeddedReports : [],
        }))
      : [],
    workflows: Array.isArray(o.workflows)
      ? o.workflows.map((w) => ({
          name: w && w.name,
          displayName: w && w.displayName,
          form: w && w.form,
          event: w && w.event,
          actionKinds: Array.isArray(w && w.actionKinds) ? w.actionKinds : [],
        }))
      : [],
    customFunctions: Array.isArray(o.customFunctions)
      ? o.customFunctions.map((fn) => ({
          namespace: fn && fn.namespace,
          name: fn && fn.name,
          returnType: fn && fn.returnType,
          paramCount: fn && fn.paramCount,
        }))
      : [],
    roles: Array.isArray(o.roles) ? o.roles : [],
    profiles: Array.isArray(o.profiles) ? o.profiles : [],
  };
}

router.post('/', async (req, res, next) => {
  try {
    const { instruction, overview, mode: rawMode } = req.body || {};
    const mode = rawMode === 'audit' ? 'audit' : 'request';

    // In 'request' mode the consultant MUST type something. In 'audit' mode
    // we generate the prompt ourselves, so an empty instruction is fine.
    if (mode === 'request') {
      if (typeof instruction !== 'string' || instruction.trim().length === 0) {
        throw new ApiError(400, 'instruction is required');
      }
      if (instruction.length > MAX_INSTRUCTION) {
        throw new ApiError(400, `instruction too long (max ${MAX_INSTRUCTION} chars)`);
      }
    } else if (typeof instruction === 'string' && instruction.length > MAX_INSTRUCTION) {
      throw new ApiError(400, `instruction too long (max ${MAX_INSTRUCTION} chars)`);
    }
    if (!overview || typeof overview !== 'object' || Array.isArray(overview)) {
      throw new ApiError(400, 'overview (object) is required — pass the /api/inspect response');
    }

    // Upper-bound the raw payload first — protects against truly absurd bodies.
    const rawSize = Buffer.byteLength(JSON.stringify(overview), 'utf8');
    if (rawSize > MAX_OVERVIEW_BYTES) {
      throw new ApiError(
        413,
        `Uploaded application is too large to analyse (${(rawSize / 1024 / 1024).toFixed(1)} MB; ` +
          `max ${(MAX_OVERVIEW_BYTES / 1024 / 1024).toFixed(0)} MB). ` +
          `Try splitting the .ds export or contact support.`
      );
    }

    // Slim down to the keys the digest actually consumes. This drops embedded
    // workflow source code, raw XML payloads, field display metadata, etc.,
    // so a 1.5–2 MB overview comfortably fits the digest budget.
    const slim = slimOverview(overview);
    const slimSize = Buffer.byteLength(JSON.stringify(slim), 'utf8');
    if (slimSize > MAX_DIGEST_INPUT_BYTES) {
      throw new ApiError(
        413,
        `Application metadata exceeds the safe digest budget after slimming ` +
          `(${(slimSize / 1024).toFixed(0)} KB; max ${(MAX_DIGEST_INPUT_BYTES / 1024).toFixed(0)} KB). ` +
          `The app likely has thousands of forms/fields — please contact support.`
      );
    }

    const result = await suggestChanges({
      instruction: typeof instruction === 'string' ? instruction.trim() : '',
      overview: slim,
      mode,
    });

    if (result && result.useFallback) {
      return res.status(501).json({ useFallback: true, reason: result.reason });
    }

    return res.json({ provider: result.provider, plan: result.plan });
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    console.warn('[suggest-changes] failed:', err.message);
    return res.status(502).json({
      error: 'AI change-suggestion failed.',
      detail: err.message,
    });
  }
});

module.exports = router;
