/**
 * aiDsl.js — AI-powered natural-language → DSL bridge for the wizard prompt box.
 *
 * Calls POST /api/apply-prompt with the user's free-text instruction and the
 * current scope snapshot. The server uses an LLM (Anthropic-first) to translate
 * the instruction into deterministic DSL commands, which are then executed
 * locally by the existing parsePrompt + applyCommands pipeline.
 *
 * The AI never writes scope state directly — it only emits DSL commands.
 * This means:
 *   • Scope integrity is guaranteed by the deterministic reducer (same as manual entry).
 *   • Fallback to pure DSL parsing is trivially safe (no state to roll back).
 *   • Tests for parsePrompt / applyCommands remain valid for both paths.
 *
 * Return shape:
 *   { usedAi: true,  scope, summary }   — AI path succeeded
 *   { usedAi: false }                   — server returned useFallback / 501
 *   throws Error                         — network / 502 (caller falls back)
 */

import { apiFetch } from '../../ds-analyser/lib/http.js';
import { parsePrompt, applyCommands } from './dsl.js';

/**
 * Minimum confidence threshold below which we still apply the commands but
 * annotate the summary so the wizard can show a "low confidence" notice.
 */
const LOW_CONFIDENCE_THRESHOLD = 0.4;

/**
 * Translate a free-text user instruction into DSL commands via the AI endpoint,
 * then apply those commands to the given scope.
 *
 * @param {string} instruction   — the raw user text from PromptBox
 * @param {string} stepId        — 'step1'..'step5'
 * @param {object} scope         — current wizard scope (sent as context snapshot)
 * @returns {Promise<{ usedAi: boolean, scope?: object, summary?: object }>}
 */
export async function applyAiPrompt(instruction, stepId, scope) {
  if (!instruction || !instruction.trim()) return { usedAi: false };

  // Build a trimmed scope snapshot to send — strip large non-essential arrays
  // (notes, templates) that add size without helping the LLM.
  const scopeSnapshot = buildSnapshot(scope);

  let res;
  try {
    res = await apiFetch('/api/apply-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: instruction.trim(),
        stepId,
        scope: scopeSnapshot,
      }),
    });
  } catch (err) {
    // Network / parse error — let caller fall back to DSL.
    throw err;
  }

  // Server says no LLM configured — caller uses local DSL parser silently.
  if (res && res.useFallback) return { usedAi: false };

  // Validate the response has at least some commands.
  const commands = Array.isArray(res?.commands) ? res.commands.filter(Boolean) : [];
  if (commands.length === 0) {
    // LLM couldn't express the instruction — fall back to DSL.
    // Surface the explanation as a note to the user if caller wants it.
    return {
      usedAi: false,
      explanation: res?.explanation || '',
    };
  }

  // Feed the AI-generated commands through the deterministic DSL pipeline.
  const commandText = commands.join('\n');
  const parsed = parsePrompt(commandText, stepId);
  const { scope: nextScope, summary } = applyCommands(scope, parsed);

  // Annotate summary with AI metadata so PromptBox can show it.
  summary.aiExplanation = res.explanation || '';
  summary.aiConfidence = res.confidence ?? 1;
  summary.aiProvider = res.provider || 'ai';
  summary.aiCommands = commands;
  summary.lowConfidence = (res.confidence ?? 1) < LOW_CONFIDENCE_THRESHOLD;

  return { usedAi: true, scope: nextScope, summary };
}

/**
 * Build a compact scope snapshot for the API payload.
 * Keeps only what the LLM needs for context; drops heavy audit/template fields.
 */
function buildSnapshot(scope) {
  if (!scope) return null;
  return {
    meta: scope.meta ? { title: scope.meta.title } : undefined,
    application: scope.application ? { name: scope.application.name } : undefined,
    forms: (scope.forms || []).map((f) => ({
      name: f.name,
      displayName: f.displayName,
      fields: (f.fields || []).map((fd) => ({
        name: fd.name,
        displayName: fd.displayName,
        type: fd.type,
        required: fd.required,
        lookup: fd.lookup,
      })),
    })),
    reports: (scope.reports || []).map((r) => ({ name: r.name, type: r.type, baseForm: r.baseForm })),
    pages: (scope.pages || []).map((p) => ({ name: p.name, section: p.section })),
    workflows: (scope.workflows || []).map((w) => ({ name: w.name, form: w.form, event: w.event })),
    lookups: scope.lookups || [],
    roles: (scope.roles || []).map((r) => ({ name: r.name, parent: r.parent })),
    profiles: (scope.profiles || []).map((p) => ({ name: p.name })),
    customFunctions: (scope.customFunctions || []).map((c) => ({ name: c.name })),
    connections: (scope.connections || []).map((c) => ({ service: c.service, authType: c.authType })),
    blueprints: (scope.blueprints || []).map((b) => ({
      name: b.name,
      form: b.form,
      stages: (b.stages || []).map((s) => s.name),
    })),
    batchWorkflows: (scope.batchWorkflows || []).map((b) => ({ name: b.name, form: b.form })),
    schedules: (scope.schedules || []).map((s) => ({ name: s.name })),
    publicAPIs: (scope.publicAPIs || []).map((a) => ({ method: a.method, path: a.path })),
    nfrs: (scope.nfrs || []).map((n) => ({ category: n.category })),
    assumptions: scope.assumptions || [],
    outOfScope: scope.outOfScope || [],
  };
}
