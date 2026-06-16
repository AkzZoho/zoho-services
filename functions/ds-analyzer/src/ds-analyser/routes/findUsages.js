/**
 * POST /api/find-usages
 *
 * Deterministic "where is this token used?" search across the parsed app's
 * workflows, custom functions and pages.
 *
 * Body (application/json):
 *   {
 *     oldValue: string  (required, 1..500 chars)
 *     newValue: string  (optional — if provided, each occurrence gets a
 *                        replacement-preview line)
 *     overview: object  (required — the /api/inspect response)
 *     options:  {
 *       matchCase?: boolean,           // default false
 *       wholeWord?: boolean,           // default true — for identifier renames
 *       useRegExp?: boolean,           // default false
 *       maxOccurrencesPerEntity?: number,
 *       maxTotalOccurrences?: number
 *     }
 *   }
 *
 * Responses:
 *   200 { query, totals, occurrences, groupedByEntity }
 *   400 { error }
 *   413 { error }    — overview too large
 */
const express = require('express');
const { ApiError } = require('../../shared/utils/errors');
const { findUsages } = require('../analyzer/findUsages');

const router = express.Router();

const MAX_OLD_VALUE = 500;
const MAX_NEW_VALUE = 500;
const MAX_OVERVIEW_BYTES = 6_000_000; // 6 MB — same envelope as /api/suggest-changes

router.post('/', (req, res, next) => {
  try {
    const { oldValue, newValue, overview, options } = req.body || {};

    if (typeof oldValue !== 'string' || oldValue.trim().length === 0) {
      throw new ApiError(400, 'oldValue is required');
    }
    if (oldValue.length > MAX_OLD_VALUE) {
      throw new ApiError(400, `oldValue too long (max ${MAX_OLD_VALUE} chars)`);
    }
    if (newValue !== undefined && newValue !== null) {
      if (typeof newValue !== 'string') {
        throw new ApiError(400, 'newValue must be a string when provided');
      }
      if (newValue.length > MAX_NEW_VALUE) {
        throw new ApiError(400, `newValue too long (max ${MAX_NEW_VALUE} chars)`);
      }
    }
    if (!overview || typeof overview !== 'object' || Array.isArray(overview)) {
      throw new ApiError(400, 'overview (object) is required — pass the /api/inspect response');
    }

    const rawSize = Buffer.byteLength(JSON.stringify(overview), 'utf8');
    if (rawSize > MAX_OVERVIEW_BYTES) {
      throw new ApiError(
        413,
        `Uploaded application is too large to scan (${(rawSize / 1024 / 1024).toFixed(1)} MB; ` +
          `max ${(MAX_OVERVIEW_BYTES / 1024 / 1024).toFixed(0)} MB).`
      );
    }

    // Default to wholeWord=true: most "Change X to Y" requests are identifier
    // renames, where partial substring matches would be noise. The UI can
    // toggle this off for free-text renames.
    const mergedOptions = {
      wholeWord: true,
      ...(options && typeof options === 'object' ? options : {}),
    };

    const result = findUsages(overview, oldValue.trim(), {
      ...mergedOptions,
      newValue: typeof newValue === 'string' ? newValue : undefined,
    });

    if (result.error) {
      throw new ApiError(400, result.error);
    }

    return res.json(result);
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    return next(err);
  }
});

module.exports = router;
