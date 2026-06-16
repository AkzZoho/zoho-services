/**
 * POST /api/apply-prompt
 *
 * Body (application/json):
 *   {
 *     instruction: string (required) — free-text user request ("split Vendor into …")
 *     stepId:      string            — "step1".."step5" (defaults to "step1")
 *     scope:       object            — current scope snapshot (used for context only)
 *   }
 *
 * Responses:
 *   200 { provider, commands[], explanation, confidence }
 *       — AI translated the instruction into DSL commands. Client applies them
 *         through its deterministic parsePrompt+applyCommands pipeline.
 *   501 { useFallback: true, reason }
 *       — No LLM configured; client should fall back to deterministic DSL parser.
 *   502 { error }
 *       — LLM call failed; client should fall back to deterministic DSL parser.
 *   400 { error }
 *       — Bad input.
 */
const express = require('express');
const { ApiError } = require('../../shared/utils/errors');
const { applyPrompt } = require('../llm/applyPrompt');

const router = express.Router();

const VALID_STEP_IDS = new Set(['step1', 'step2', 'step3', 'step4', 'step5']);

router.post('/', async (req, res, next) => {
  try {
    const { instruction, stepId, scope } = req.body || {};

    if (typeof instruction !== 'string' || instruction.trim().length === 0) {
      throw new ApiError(400, 'instruction is required');
    }
    if (instruction.length > 5_000) {
      throw new ApiError(400, 'instruction too long (max 5000 chars)');
    }
    if (stepId != null && !VALID_STEP_IDS.has(stepId)) {
      throw new ApiError(400, `stepId must be one of: ${[...VALID_STEP_IDS].join(', ')}`);
    }
    if (scope != null && (typeof scope !== 'object' || Array.isArray(scope))) {
      throw new ApiError(400, 'scope must be an object');
    }

    const result = await applyPrompt({
      instruction: instruction.trim(),
      stepId: stepId || 'step1',
      scope: scope || null,
    });

    if (result && result.useFallback) {
      return res.status(501).json({ useFallback: true, reason: result.reason });
    }

    return res.json({
      provider: result.provider,
      commands: result.commands,
      explanation: result.explanation,
      confidence: result.confidence,
    });
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    console.warn('[apply-prompt] LLM failed:', err.message);
    return res.status(502).json({
      error: 'AI prompt translation failed. Falling back to DSL parser.',
      detail: err.message,
    });
  }
});

module.exports = router;
