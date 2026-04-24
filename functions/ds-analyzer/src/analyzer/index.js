/**
 * @deprecated
 * Full LLM analysis pipeline (ds + requirement → change report).
 *
 * This module is no longer used by the UI — the app now operates in
 * single-step inspect-only mode (`/api/inspect` → `analyzer/inspect.js`).
 * It is kept so that `routes/analyze.js` and its tests continue to compile
 * and run. Remove together with `routes/analyze.js` and `analyzer/schema.js`
 * when the two-step feature is formally retired.
 *
 * Original pipeline:
 *   1. Parse .ds → normalised structure.
 *   2. Parse requirement (file or URL) → plain text.
 *   3. Build LLM prompt using rules/*.md.
 *   4. Route through LLM router, picking task type by doc length.
 *   5. Validate output against Zod schema.
 *   6. Return result + metadata.
 */
const { parseDs } = require('../parsers/dsParser');
const { parseFromBuffer, parseFromUrl } = require('../parsers/requirementParser');
const { loadRule } = require('../utils/loadRules');
const llmRouter = require('../llm/router');
const { AnalysisResult } = require('./schema');

/** Rough token estimate — 4 chars/token. */
function estimateTokens(str) {
  return Math.ceil((str || '').length / 4);
}

function buildSystemPrompt() {
  const promptRules = loadRule('llm-prompt-rules.md');
  const parserRules = loadRule('ds-parser-rules.md');
  return [
    promptRules,
    '---',
    '### Parser Rules Context (for grounding)',
    parserRules,
  ].join('\n\n');
}

function buildUserPrompt({ dsNormalised, requirementText, requirementSource }) {
  // Truncate any single giant Deluge script before sending.
  const safeDs = JSON.parse(JSON.stringify(dsNormalised));
  (safeDs.workflows || []).forEach((w) => {
    if (typeof w.script === 'string' && w.script.length > 8000) {
      w.script = w.script.slice(0, 8000) + '\n/* …truncated for prompt… */';
    }
  });

  return [
    '### CURRENT APPLICATION (parsed from .ds)',
    '```json',
    JSON.stringify(safeDs, null, 2),
    '```',
    '',
    `### REQUIREMENT DOCUMENT (source: ${requirementSource})`,
    requirementText,
    '',
    '### TASK',
    'Return ONLY the JSON object defined in the output contract. No prose.',
  ].join('\n');
}

async function analyzeDsAgainstRequirement({ ds, requirement, requirementUrl }) {
  // 1. Parse DS
  const dsNormalised = await parseDs(ds.buffer, ds.name);

  // 2. Parse requirement
  let requirementDoc;
  if (requirement) {
    requirementDoc = await parseFromBuffer(requirement.buffer, requirement.name);
  } else {
    requirementDoc = await parseFromUrl(requirementUrl);
  }

  // 3. Build prompt
  const system = buildSystemPrompt();
  const user = buildUserPrompt({
    dsNormalised,
    requirementText: requirementDoc.text,
    requirementSource: requirementDoc.source,
  });

  // 4. Pick task type
  const totalTokens = estimateTokens(system) + estimateTokens(user);
  const task = totalTokens > 15_000 ? 'longDoc' : 'extractChanges';

  const { provider, data } = await llmRouter.run(task, { system, user });

  // 5. Validate. If invalid, try once more forcing extractChanges via a different provider.
  let validated;
  const parsed = AnalysisResult.safeParse(data);
  if (parsed.success) {
    validated = parsed.data;
  } else {
    const retry = await llmRouter.run('extractChanges', {
      system: system + '\n\nPREVIOUS OUTPUT WAS INVALID. Strictly follow the JSON contract.',
      user,
    });
    const retryParsed = AnalysisResult.safeParse(retry.data);
    if (!retryParsed.success) {
      return {
        ok: false,
        error: 'LLM output did not match expected schema',
        issues: retryParsed.error.issues.slice(0, 10),
        rawPreview: JSON.stringify(retry.data).slice(0, 1000),
        meta: { provider: retry.provider, task },
      };
    }
    validated = retryParsed.data;
  }

  // 6. Return
  return {
    ok: true,
    meta: {
      provider,
      task,
      tokenEstimate: totalTokens,
      dsWarnings: dsNormalised.warnings,
      requirementSource: requirementDoc.source,
      entityCounts: {
        forms: dsNormalised.forms.length,
        reports: dsNormalised.reports.length,
        workflows: dsNormalised.workflows.length,
        pages: dsNormalised.pages.length,
      },
    },
    result: validated,
  };
}

module.exports = {
  analyzeDsAgainstRequirement,
  _internal: { buildSystemPrompt, buildUserPrompt, estimateTokens },
};
