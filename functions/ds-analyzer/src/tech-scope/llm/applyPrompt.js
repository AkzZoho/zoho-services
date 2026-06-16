/**
 * applyPrompt — LLM-powered natural-language → DSL command translator.
 *
 * Given a free-text user instruction (e.g. "split Vendor into Vendor and
 * Vendor Contact") and the current scope snapshot, the LLM emits an array
 * of deterministic DSL commands that the client's `parsePrompt` + `applyCommands`
 * pipeline can execute. The AI never mutates scope directly — it only speaks DSL.
 *
 * Flow:
 *   1. Build a compact scope summary (not the full JSON — too large).
 *   2. Call the router (Anthropic-first for prompt quality).
 *   3. Validate the response shape.
 *   4. Return { commands, explanation, confidence, provider }.
 *      On stub → { useFallback: true }.
 *      On bad JSON / empty commands → throw (route returns 502; client falls back to DSL).
 */

const router = require('../../shared/llm/router');
const { SYSTEM, buildUserPrompt, buildScopeSummary } = require('./prompts/applyPrompt');

const MAX_INSTRUCTION_CHARS = 2_000;

function isStr(v) { return typeof v === 'string'; }
function isArr(v) { return Array.isArray(v); }
function isNum(v) { return typeof v === 'number' && isFinite(v); }

/**
 * Validate and normalise the LLM response.
 * Returns { commands, explanation, confidence }.
 * Throws if the shape is too broken to be useful.
 */
function validateResponse(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('applyPrompt: response is not an object');

  const commands = isArr(raw.commands)
    ? raw.commands.filter(isStr).map((s) => s.trim()).filter(Boolean)
    : [];

  const explanation = isStr(raw.explanation)
    ? raw.explanation.slice(0, 500)
    : '';

  const confidence = isNum(raw.confidence)
    ? Math.max(0, Math.min(1, raw.confidence))
    : 0.5;

  return { commands, explanation, confidence };
}

/**
 * @param {{ instruction: string, stepId: string, scope: object }} args
 * @returns {Promise<
 *   { provider, commands, explanation, confidence } |
 *   { useFallback: true, reason: string }
 * >}
 */
async function applyPrompt({ instruction, stepId, scope }) {
  if (!isStr(instruction) || instruction.trim().length === 0) {
    throw new Error('applyPrompt: instruction is required');
  }

  const trimmedInstruction = instruction.length > MAX_INSTRUCTION_CHARS
    ? instruction.slice(0, MAX_INSTRUCTION_CHARS) + '…'
    : instruction;

  const scopeSummary = buildScopeSummary(scope);

  const { provider, data } = await router.run('applyPrompt', {
    system: SYSTEM,
    user: buildUserPrompt({
      instruction: trimmedInstruction,
      stepId: stepId || 'step1',
      scopeSummary,
    }),
  });

  // Stub sentinel.
  if (data && data.__stub) {
    return { useFallback: true, reason: data.reason || 'no LLM provider configured' };
  }

  const { commands, explanation, confidence } = validateResponse(data);
  return { provider, commands, explanation, confidence };
}

module.exports = { applyPrompt, _internal: { validateResponse, buildScopeSummary: require('./prompts/applyPrompt').buildScopeSummary } };
