/**
 * extractRenames — deterministic regex extractor for "rename X to Y" intents
 * inside a free-text consultant prompt.
 *
 * Why this exists:
 *   The /api/change-request orchestrator asks an LLM to populate
 *   `lineEditHints` for literal renames. But:
 *     (a) No LLM may be configured (stub mode) — we still want simple
 *         rename prompts to work end-to-end.
 *     (b) The LLM occasionally omits `lineEditHints` for short prompts.
 *   So we run THIS extractor in addition, merge the results with the LLM's
 *   hints, dedupe, and feed everything into the deterministic findUsages
 *   scanner.
 *
 * What it catches (case-insensitive, anchored to obvious verbs):
 *   - change X to Y
 *   - rename X to Y
 *   - replace X with Y
 *   - swap X for Y
 *   - update X to Y
 *
 * What it deliberately does NOT catch:
 *   - "change the status field" → no Y, ambiguous, leave to the LLM.
 *   - "remove all references to X" → no Y, treated as out-of-scope here.
 *   - Bare quoted tokens without a verb → false-positive risk.
 *
 * Token shape:
 *   X and Y may be wrapped in single quotes, double quotes, or backticks,
 *   OR be a bare identifier-like token (letters / digits / `_` / `.` / `-`,
 *   length >= 2). This keeps "rename X to Y" working with or without
 *   quoting, while rejecting noise like "change one thing to another".
 *
 * Output:
 *   [{ oldValue, newValue, source: 'prompt' }, …]
 */

// Token: either a quoted span (any quote kind, non-greedy) or a bare token.
// We keep the bare-token character class deliberately narrow — anything that
// would plausibly appear in a Deluge identifier or string literal.
const QUOTED = '(?:"([^"\\n]{1,200})"|\'([^\'\\n]{1,200})\'|`([^`\\n]{1,200})`)';
const BARE = '([A-Za-z][A-Za-z0-9_.\\-]{1,199})';
const TOKEN = `(?:${QUOTED}|${BARE})`;

// Verbs that introduce a rename. Anchored with \b so "exchange" doesn't match
// "change". Order matters only for readability — we run them all.
// NOTE: We deliberately do NOT append a trailing `\b` after the final TOKEN.
// A quoted token ends in a quote character (`"`, `'`, `` ` ``) which is a
// non-word character, so a trailing `\b` would fail to match at end-of-input
// or before whitespace — breaking every quoted rename (and any subsequent
// match in a multi-rename prompt). The leading `\b` on the verb is what
// guards against false positives like "exchange" matching "change".
const PATTERNS = [
  // change X to Y   |   rename X to Y   |   update X to Y
  new RegExp(`\\b(?:change|rename|update)\\s+${TOKEN}\\s+to\\s+${TOKEN}`, 'gi'),
  // replace X with Y
  new RegExp(`\\breplace\\s+${TOKEN}\\s+with\\s+${TOKEN}`, 'gi'),
  // swap X for Y    |   swap X with Y
  new RegExp(`\\bswap\\s+${TOKEN}\\s+(?:for|with)\\s+${TOKEN}`, 'gi'),
];

/**
 * For each TOKEN group (which contributes 4 capture slots: double, single,
 * backtick, bare), pick the first non-empty value.
 */
function pickToken(match, baseIdx) {
  return (
    match[baseIdx] || match[baseIdx + 1] || match[baseIdx + 2] || match[baseIdx + 3] || ''
  );
}

/**
 * Extract rename pairs from a free-text prompt.
 *
 * @param {string} prompt
 * @returns {Array<{ oldValue: string, newValue: string, source: 'prompt' }>}
 */
function extractRenames(prompt) {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) return [];

  const seen = new Map(); // dedupe key = `${old}\x00${new}` → true
  const out = [];

  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(prompt)) !== null) {
      // Each pattern has TWO TOKEN groups (X and Y). Each TOKEN contributes
      // 4 capture slots, so old starts at index 1, new starts at index 5.
      const oldValue = pickToken(m, 1).trim();
      const newValue = pickToken(m, 5).trim();
      if (!oldValue || !newValue) continue;
      if (oldValue === newValue) continue; // no-op rename

      const key = `${oldValue}\u0000${newValue}`;
      if (seen.has(key)) continue;
      seen.set(key, true);
      out.push({ oldValue, newValue, source: 'prompt' });

      // Guard against zero-length matches (shouldn't happen with these
      // patterns, but cheap insurance).
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }

  return out;
}

module.exports = { extractRenames, _internal: { PATTERNS } };
