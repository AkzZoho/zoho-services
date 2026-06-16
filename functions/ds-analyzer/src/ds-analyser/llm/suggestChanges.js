/**
 * suggestChanges — LLM-powered change-plan generator for live Creator apps.
 *
 * Given a parsed .ds overview + a free-text user instruction, ask the LLM
 * to return a STRUCTURED change plan that the consultant can review before
 * touching production. See `prompts/suggestChanges.js` for the contract.
 *
 * Returns:
 *   { provider, plan }                       on success
 *   { useFallback: true, reason }            when no LLM is configured
 *
 * Throws on bad shape (route returns 502; client shows the message).
 */

const router = require('../../shared/llm/router');
const {
  SYSTEM,
  buildUserPrompt,
  buildDigest,
  AUDIT_INSTRUCTION,
  CHANGE_KINDS,
  ENTITY_KINDS,
} = require('./prompts/suggestChanges');

const MAX_INSTRUCTION_CHARS = 4_000;
const MAX_CHANGES = 12;
const MAX_STR = 600; // generic clamp for action / rationale / steps
const MAX_LIST = 8;

const RISK_VALUES = new Set(['low', 'medium', 'high']);
const DATA_IMPACT_VALUES = new Set(['no-data-loss', 'backfill-needed', 'destructive']);
const KIND_SET = new Set(CHANGE_KINDS);
const ENTITY_SET = new Set(ENTITY_KINDS);

const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isArr = Array.isArray;

function clip(s, n = MAX_STR) {
  if (!isStr(s)) return '';
  const trimmed = s.trim();
  return trimmed.length > n ? `${trimmed.slice(0, n - 1)}…` : trimmed;
}

function clipList(arr, max = MAX_LIST, itemMax = MAX_STR) {
  if (!isArr(arr)) return [];
  return arr.filter(isStr).slice(0, max).map((s) => clip(s, itemMax)).filter(Boolean);
}

/**
 * Validate one change entry. Returns a normalised object or null to drop it.
 * We are strict on enums (kind / risk / dataImpact) because the UI keys off
 * them for colour coding — invalid values would render incorrectly.
 */
function validateChange(c, idx) {
  if (!c || typeof c !== 'object') return null;

  const kind = isStr(c.kind) && KIND_SET.has(c.kind) ? c.kind : 'other';
  const risk = isStr(c.risk) && RISK_VALUES.has(c.risk.toLowerCase()) ? c.risk.toLowerCase() : 'medium';
  const dataImpact =
    isStr(c.dataImpact) && DATA_IMPACT_VALUES.has(c.dataImpact)
      ? c.dataImpact
      : 'no-data-loss';

  const target = c.target && typeof c.target === 'object' ? c.target : {};
  const targetEntity =
    isStr(target.entity) && ENTITY_SET.has(target.entity) ? target.entity : 'Other';

  // Parent context — the entity that OWNS the target. e.g. a Workflow lives
  // on a Form (parentEntity='Form', parentName='PurchaseOrder'); a Field
  // lives on a Form; a Report custom-action lives on a Report. Strictly
  // optional — older LLM responses omit it and the deterministic enrichment
  // step in changeRequest.js will fill it in when possible.
  const parentEntity =
    isStr(target.parentEntity) && ENTITY_SET.has(target.parentEntity)
      ? target.parentEntity
      : null;
  const parentName = clip(target.parentName, 120);

  // Workflow / function trigger metadata so the dev knows WHEN it fires.
  // Free-form short strings — we don't pin an enum because Creator has many
  // (onCreate, onEdit, onDelete, onLoad, onUserInput, button, scheduled,
  // form-action, report-action, etc.).
  const trigger = clip(target.trigger, 80);
  const scope = clip(target.scope, 80);

  const action = clip(c.action, 280);
  if (!action) return null; // every change MUST have an action sentence

  // Build target with optional fields stripped so the JSON stays clean.
  const targetOut = {
    entity: targetEntity,
    name: clip(target.name, 120) || '(unspecified)',
  };
  if (parentEntity) targetOut.parentEntity = parentEntity;
  if (parentName) targetOut.parentName = parentName;
  if (trigger) targetOut.trigger = trigger;
  if (scope) targetOut.scope = scope;

  return {
    id: isStr(c.id) ? clip(c.id, 16) : `c${idx + 1}`,
    kind,
    target: targetOut,
    action,
    rationale: clip(c.rationale, 500),
    risk,
    dataImpact,
    manualSteps: clipList(c.manualSteps, 8, 280),
    relatedEntities: clipList(c.relatedEntities, 8, 120),
  };
}

/**
 * Validate one lineEditHint entry (LLM-supplied literal rename pair).
 * Returns a normalised object or null to drop it. Both old & new must be
 * non-empty strings; the server scanner will then locate them in source.
 */
function validateLineEditHint(h) {
  if (!h || typeof h !== 'object') return null;
  const oldValue = clip(h.oldValue, 500);
  const newValue = isStr(h.newValue) ? clip(h.newValue, 500) : '';
  if (!oldValue) return null;
  return {
    oldValue,
    // newValue may be intentionally empty (e.g. "remove all references to X"),
    // so we allow '' here — the deterministic scanner treats undefined newValue
    // as "find-only" and a string (incl. '') as "replace with this".
    newValue,
    note: clip(h.note, 280),
  };
}

/**
 * Validate one outOfScope entry. These are honest "this isn't in the .ds"
 * notes for the developer — every field is required, otherwise the entry
 * is dropped.
 */
function validateOutOfScope(o) {
  if (!o || typeof o !== 'object') return null;
  const request = clip(o.request, 400);
  const reason = clip(o.reason, 400);
  const where = clip(o.where, 280);
  if (!request || !reason) return null;
  return { request, reason, where };
}

function validateResponse(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('suggestChanges: response is not an object');
  }

  const changes = isArr(raw.changes)
    ? raw.changes
        .slice(0, MAX_CHANGES)
        .map((c, i) => validateChange(c, i))
        .filter(Boolean)
    : [];

  const lineEditHints = isArr(raw.lineEditHints)
    ? raw.lineEditHints
        .slice(0, MAX_CHANGES) // same cap as changes — 12 is plenty
        .map(validateLineEditHint)
        .filter(Boolean)
    : [];

  const outOfScope = isArr(raw.outOfScope)
    ? raw.outOfScope.slice(0, MAX_LIST).map(validateOutOfScope).filter(Boolean)
    : [];

  return {
    summary: clip(raw.summary, 500),
    intent: clip(raw.intent, 500),
    changes,
    lineEditHints,
    outOfScope,
    warnings: clipList(raw.warnings, 10, 400),
    openQuestions: clipList(raw.openQuestions, 10, 400),
    confidence: isNum(raw.confidence) ? Math.max(0, Math.min(1, raw.confidence)) : 0.5,
  };
}

/**
 * @param {{ instruction?: string, overview: object, mode?: 'request'|'audit' }} args
 *   instruction — free-text user request. Optional when mode === 'audit',
 *                 in which case a fixed audit instruction is used to ask the
 *                 LLM to proactively propose improvements based on the .ds.
 *   overview    — full response from /api/inspect (the digest is built here)
 *   mode        — 'request' (default) or 'audit'
 */
async function suggestChanges({ instruction, overview, mode = 'request' }) {
  if (!overview || typeof overview !== 'object') {
    throw new Error('suggestChanges: overview is required');
  }

  const effectiveInstruction =
    mode === 'audit'
      ? AUDIT_INSTRUCTION
      : (isStr(instruction) && instruction.trim() ? instruction : '');

  if (!effectiveInstruction) {
    throw new Error('suggestChanges: instruction is required');
  }

  const trimmedInstruction =
    effectiveInstruction.length > MAX_INSTRUCTION_CHARS
      ? effectiveInstruction.slice(0, MAX_INSTRUCTION_CHARS) + '…'
      : effectiveInstruction;

  const digest = buildDigest(overview);
  const appName = overview.app?.name || overview.meta?.fileName || '';

  const { provider, data } = await router.run('suggestChanges', {
    system: SYSTEM,
    user: buildUserPrompt({
      instruction: trimmedInstruction.trim(),
      appName,
      digest,
    }),
  });

  // Stub sentinel — no LLM provider is configured.
  if (data && data.__stub) {
    return { useFallback: true, reason: data.reason || 'no LLM provider configured' };
  }

  const plan = validateResponse(data);
  // A plan is "useful" if it contains at least one of: a change, a line-edit
  // hint, an out-of-scope explanation, or an open question. Only if ALL of
  // those are empty do we treat it as the LLM silently giving up.
  const hasAnyContent =
    plan.changes.length ||
    plan.lineEditHints.length ||
    plan.outOfScope.length ||
    plan.openQuestions.length;
  if (!hasAnyContent) {
    throw new Error(
      'The model returned an empty plan. Please rephrase the request with more detail.'
    );
  }
  return { provider, plan };
}

module.exports = {
  suggestChanges,
  _internal: { validateResponse, validateChange, validateLineEditHint, validateOutOfScope, buildDigest },
};
