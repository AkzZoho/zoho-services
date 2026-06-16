const express = require('express');
const multer = require('multer');
const path = require('path');

const { inspectDs } = require('../analyzer/inspect');
const { ApiError } = require('../../shared/utils/errors');

const router = express.Router();

const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB || '25', 10);

/**
 * Authoritative extension allowlist — ONLY Zoho Creator `.ds` exports.
 * The filename is normalised via `path.basename` first to defeat any
 * path-traversal payload in `originalname` (e.g. `../../etc/passwd.ds`).
 * A strict filename regex additionally blocks NUL/control characters and
 * double-extensions like `payload.ds.exe`.
 */
const SAFE_DS_NAME_RE = /^[A-Za-z0-9._ \-()]+\.ds$/i;

function isAllowedDs(originalname) {
  if (typeof originalname !== 'string' || originalname.length === 0) return false;
  if (originalname.length > 255) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(originalname)) return false;
  const base = path.basename(originalname);
  return SAFE_DS_NAME_RE.test(base);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedDs(file.originalname)) {
      return cb(new ApiError(400, `Unsupported file type: only .ds files are allowed`));
    }
    cb(null, true);
  },
});

/**
 * POST /api/inspect
 * multipart/form-data:
 *   - ds : .ds file (required) — Zoho Creator application export
 *
 * Step-1 of the two-step flow: parse the .ds file and return a
 * human-readable overview of the app (no requirement doc needed).
 */
router.post('/', upload.single('ds'), async (req, res, next) => {
  try {
    const dsFile = req.file;
    if (!dsFile) throw new ApiError(400, 'Missing required file: ds');

    const result = await inspectDs({
      buffer: dsFile.buffer,
      name: path.basename(dsFile.originalname),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
// Exposed for unit tests; not part of the public HTTP surface.
module.exports._internal = { isAllowedDs, SAFE_DS_NAME_RE };
