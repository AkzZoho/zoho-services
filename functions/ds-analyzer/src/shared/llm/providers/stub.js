/**
 * Deterministic stub provider. Always available. Used for local dev + as a last-resort fallback.
 * Returns shape-compatible output so the frontend always renders.
 */
function isAvailable() {
  return true;
}

async function run(task, { user }) {
  if (task === 'applyPrompt') {
    return { __stub: true, reason: 'no LLM provider configured' };
  }
  if (task === 'suggestChanges') {
    // DS Analyser Step 2 — change planning against a live Creator app.
    // The route converts this sentinel into a 501 + useFallback so the
    // UI shows a friendly "configure an LLM provider" message instead of
    // surfacing the stub's placeholder text as a real plan.
    return { __stub: true, reason: 'no LLM provider configured' };
  }
  if (task === 'extractScope') {
    // No LLM configured. Return a sentinel that the route handler
    // converts into a 501-style payload so the client falls back to
    // its own local heuristic extractor (deriveScope in heuristics.js).
    // We deliberately do NOT try to re-implement the heuristics server-side
    // — keeping that logic on the client lets it run fully offline when
    // the user opts out of AI.
    return { __stub: true, reason: 'no LLM provider configured' };
  }
  if (task === 'extractChanges') {
    return {
      summary: {
        pmHeadline:
          '[STUB] No LLM configured. Configure OPENAI_API_KEY or ANTHROPIC_API_KEY to get real analysis.',
        estimatedEffort: 'S',
        risk: 'low',
        confidence: 0,
      },
      changes: [
        {
          id: 'CHG-STUB-001',
          type: 'OTHER',
          target: { entity: 'app', name: 'Stub' },
          pmSummary: 'This is placeholder output. Connect an LLM provider to see real changes.',
          devDetails: {
            what: 'Stub change',
            how: 'Set LLM env vars and redeploy / restart.',
            delugeSnippet: null,
            affectedEntities: [],
            validations: [],
          },
          impact: { breaking: false, affectsData: false, affectsUsers: [] },
          requirementSource: (user || '').slice(0, 200),
          confidence: 0,
        },
      ],
      openQuestions: ['Which LLM provider would you like to enable first?'],
      warnings: ['Running on stub provider — outputs are not meaningful.'],
    };
  }
  return '[stub] ' + String(user || '').slice(0, 120);
}

module.exports = { isAvailable, run };
