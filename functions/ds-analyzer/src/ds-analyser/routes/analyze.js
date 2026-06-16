/**
 * @deprecated
 * POST /api/analyze — two-step LLM comparison pipeline.
 *
 * This route is no longer exposed in the UI (the app is now a single-step
 * inspect-only tool). It is kept in the codebase so that:
 *   1. Existing `api.test.js` route-reachability assertions continue to pass.
 *   2. The route can be re-enabled if the LLM comparison feature is revived.
 *
 * To fully prune: remove this file, update `app.js`, and update
 * `tests/api.test.js` + `tests/routeReachability.test.js`.
 */
const express = require('express');
const multer = require('multer');
const path = require('path');

const { analyzeDsAgainstRequirement } = require('../analyzer');
const { ApiError } = require('../../shared/utils/errors');

const router = express.Router();

const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB || '25', 10);

/**
 * Per-field extension allowlist.
 *   - `ds`          : Zoho Creator export — ONLY `.ds`
 *   - `requirement` : user-supplied spec document — `.pdf` or `.docx`
 * Other field names are rejected outright. Filenames are normalised via
 * `path.basename` and must pass a strict whitespace/char allowlist to
 * defeat NUL-injection, control chars, and path-traversal payloads.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f]/;
const SAFE_NAME_CHARS_RE = /^[A-Za-z0-9._ \-()]+$/;

const FIELD_EXTENSIONS = {
  ds: /\.ds$/i,
  requirement: /\.(pdf|docx)$/i,
};

function isAllowedUpload(file) {
  if (!file || typeof file.originalname !== 'string') return false;
  const name = file.originalname;
  if (name.length === 0 || name.length > 255) return false;
  if (CONTROL_RE.test(name)) return false;
  const base = path.basename(name);
  if (!SAFE_NAME_CHARS_RE.test(base)) return false;
  const extRe = FIELD_EXTENSIONS[file.fieldname];
  if (!extRe) return false;
  return extRe.test(base);
}

// Accept files in memory — keeps the route stateless (no disk writes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedUpload(file)) {
      const allowed = file.fieldname === 'requirement' ? '.pdf, .docx' : '.ds';
      return cb(
        new ApiError(400, `Unsupported file type for field "${file.fieldname}": only ${allowed} allowed`)
      );
    }
    cb(null, true);
  },
});

/**
 * POST /api/analyze
 * multipart/form-data:
 *   - ds          : .ds file (required)
 *   - requirement : .pdf / .docx  (optional if requirementUrl provided)
 *   - requirementUrl : string (optional — public Zoho Sheet link)
 */
router.post(
  '/',
  upload.fields([
    { name: 'ds', maxCount: 1 },
    { name: 'requirement', maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const dsFile = req.files?.ds?.[0];
      const reqFile = req.files?.requirement?.[0];
      const requirementUrl = req.body?.requirementUrl;

      if (!dsFile) throw new ApiError(400, 'Missing required file: ds');
      if (!reqFile && !requirementUrl) {
        throw new ApiError(400, 'Provide either a requirement file or requirementUrl');
      }

      const result = await analyzeDsAgainstRequirement({
        ds: { buffer: dsFile.buffer, name: path.basename(dsFile.originalname) },
        requirement: reqFile
          ? { buffer: reqFile.buffer, name: path.basename(reqFile.originalname) }
          : null,
        requirementUrl,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
