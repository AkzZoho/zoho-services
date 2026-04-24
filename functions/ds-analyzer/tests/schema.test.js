const { AnalysisResult } = require('../src/analyzer/schema');

describe('AnalysisResult schema', () => {
  test('accepts minimal valid payload', () => {
    const payload = {
      summary: { pmHeadline: 'hi', estimatedEffort: 'M', risk: 'low', confidence: 0.9 },
      changes: [],
      openQuestions: [],
      warnings: [],
    };
    expect(AnalysisResult.safeParse(payload).success).toBe(true);
  });

  test('rejects bad changeType', () => {
    const bad = {
      summary: { pmHeadline: 'hi' },
      changes: [
        {
          id: 'x',
          type: 'NOT_A_TYPE',
          target: { entity: 'form', name: 'X' },
          pmSummary: 'y',
          devDetails: { what: 'a', how: 'b' },
          impact: {},
        },
      ],
    };
    expect(AnalysisResult.safeParse(bad).success).toBe(false);
  });
});
