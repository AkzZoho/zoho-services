describe('llmRouter', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test('falls back to stub when nothing configured', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const router = require('../src/shared/llm/router');
    const out = await router.run('extractChanges', { system: 's', user: 'u' });
    expect(out.provider).toBe('stub');
    expect(out.data.summary.pmHeadline).toMatch(/STUB/);
  });

  test('pickForTask respects task preference', () => {
    const router = require('../src/shared/llm/router');
    const list = router._internal.pickForTask('extractChanges');
    // At minimum stub should always be present.
    expect(list.some((x) => x.key === 'stub')).toBe(true);
  });
});
