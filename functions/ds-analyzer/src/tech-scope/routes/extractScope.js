/**
 * POST /api/extract-scope
 *
 * Body (application/json):
 *   { brdText: string (required), title?: string, sourceFile?: string }
 *
 * Responses:
 *   200 { provider, scope, warnings[] }     — AI extraction succeeded
 *   501 { useFallback: true, reason }        — no LLM configured; client should
 *                                              fall back to local heuristics
 *   502 { error }                            — LLM call/validation failed; client
 *                                              should fall back to local heuristics
 *   400 { error }                            — bad input
 */
const express = require('express');
const { ApiError } = require('../../shared/utils/errors');
const { extractScope } = require('../llm/extractScope');

const router = express.Router();

const MAX_BRD_BYTES = 1_000_000; // 1 MB of text — the JSON body limiter is 1 MB total

router.post('/', async (req, res, next) => {
  try {
    const { brdText, title, sourceFile } = req.body || {};
    if (typeof brdText !== 'string' || brdText.trim().length === 0) {
      throw new ApiError(400, 'brdText is required');
    }
    if (Buffer.byteLength(brdText, 'utf8') > MAX_BRD_BYTES) {
      throw new ApiError(413, `brdText exceeds ${MAX_BRD_BYTES} bytes`);
    }
    if (title != null && typeof title !== 'string') {
      throw new ApiError(400, 'title must be a string');
    }
    if (sourceFile != null && typeof sourceFile !== 'string') {
      throw new ApiError(400, 'sourceFile must be a string');
    }

    const result = await extractScope({ brdText, title, sourceFile });

    if (result && result.useFallback) {
      // No LLM configured — explicit signal to the client to use heuristics.
      return res.status(501).json({
        useFallback: true,
        reason: result.reason,
      });
    }

    return res.json({
      provider: result.provider,
      scope: result.scope,
      warnings: result.warnings || [],
    });
  } catch (err) {
    // Map LLM/validation failures to 502 so the client knows to fall back.
    if (err instanceof ApiError) return next(err);
    // Defensive log + 502 response.
    console.warn('[extract-scope] LLM extraction failed:', err.message);
    return res.status(502).json({
      error: 'AI extraction failed. Falling back to local heuristics.',
      detail: err.message,
    });
  }
});

module.exports = router;
