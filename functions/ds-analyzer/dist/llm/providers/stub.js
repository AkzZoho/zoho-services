/**
 * Deterministic stub provider. Always available. Used for local dev + as a last-resort fallback.
 * Returns shape-compatible output so the frontend always renders.
 */
function isAvailable() {
  return true;
}

async function run(task, { user }) {
  if (task === 'extractChanges') {
    return {
      summary: {
        pmHeadline:
          '[STUB] No LLM configured. Configure OPENAI_API_KEY / ANTHROPIC_API_KEY / ZOHO_CATALYST_AI_TOKEN to get real analysis.',
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
