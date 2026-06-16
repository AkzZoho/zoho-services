/**
 * Integration tests for POST /api/change-request.
 *
 * Focus areas:
 *   - Input validation (400s)
 *   - Stub-mode fallback still produces deterministic line edits when the
 *     prompt contains a "change X to Y" pattern.
 *   - Stub-mode fallback with NO rename in the prompt — should still 200
 *     with `llmAvailable: false` and a clear warning (no 500/502).
 *   - Pure rename prompt against a real overview produces correct
 *     groupedByEntity hits.
 *   - mergeRenames helper dedupe & source-tagging logic.
 *
 * We intentionally do NOT test the happy path with a real LLM — the
 * existing suggestChanges tests cover that; here we focus on the
 * orchestrator's responsibilities (merging, fallback, validation).
 */

const request = require('supertest');
const app = require('../src/app');
const { _internal } = require('../src/ds-analyser/routes/changeRequest');

function overviewWithWorkflowSource(src) {
  return {
    app: { name: 'Demo' },
    forms: [],
    reports: [],
    pages: [],
    workflows: [{ name: 'WF', displayName: 'WF', sourceCode: src }],
    customFunctions: [],
    roles: [],
    profiles: [],
  };
}

describe('POST /api/change-request — input validation', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  test('rejects empty instruction with 400', async () => {
    const res = await request(app)
      .post('/api/change-request')
      .send({ instruction: '', overview: { forms: [] } });
    expect(res.status).toBe(400);
  });

  test('rejects missing overview with 400', async () => {
    const res = await request(app)
      .post('/api/change-request')
      .send({ instruction: 'do something' });
    expect(res.status).toBe(400);
  });

  test('rejects array overview with 400 (must be object)', async () => {
    const res = await request(app)
      .post('/api/change-request')
      .send({ instruction: 'do something', overview: [] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/change-request — stub fallback path', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  test('rename prompt + stub LLM → 200 with deterministic line edits', async () => {
    const overview = overviewWithWorkflowSource(
      'form X {\n  on add {\n    owner = "shriniwash.yadav_adityabirla";\n  }\n}'
    );
    const res = await request(app)
      .post('/api/change-request')
      .send({
        instruction: 'Change shriniwash.yadav_adityabirla to utcl_cms',
        overview,
      });

    expect(res.status).toBe(200);
    expect(res.body.llmAvailable).toBe(false);
    expect(res.body.provider).toBe('stub');
    expect(res.body.plan.lineEdits).toHaveLength(1);

    const edit = res.body.plan.lineEdits[0];
    expect(edit.oldValue).toBe('shriniwash.yadav_adityabirla');
    expect(edit.newValue).toBe('utcl_cms');
    expect(edit.source).toBe('prompt');
    expect(edit.totals.occurrences).toBe(1);
    expect(edit.groupedByEntity).toHaveLength(1);
    expect(edit.groupedByEntity[0].matches[0]).toMatchObject({
      entityKind: 'workflow',
      entityName: 'WF',
      line: 3,
    });

    // And the plan summary should explain that AI was skipped.
    expect(res.body.plan.warnings.join(' ')).toMatch(/No AI provider configured/i);
    // No fake LLM changes should appear.
    expect(res.body.plan.changes).toEqual([]);
  });

  test('non-rename prompt + stub LLM → 200 with helpful empty plan (no 502)', async () => {
    const res = await request(app)
      .post('/api/change-request')
      .send({
        instruction: 'Add a status field to the Customers form',
        overview: overviewWithWorkflowSource('// nothing'),
      });

    expect(res.status).toBe(200);
    expect(res.body.llmAvailable).toBe(false);
    expect(res.body.plan.lineEdits).toEqual([]);
    expect(res.body.plan.changes).toEqual([]);
    // Warning must explain that AI is missing.
    expect(res.body.plan.warnings.join(' ')).toMatch(/No AI provider configured/i);
  });
});

describe('mergeRenames helper', () => {
  const { mergeRenames } = _internal;

  test('combines prompt + llm sources, deduping', () => {
    const prompt = [
      { oldValue: 'a', newValue: 'b', source: 'prompt' },
      { oldValue: 'c', newValue: 'd', source: 'prompt' },
    ];
    const llm = [
      { oldValue: 'a', newValue: 'b', note: 'rename A→B' }, // duplicate
      { oldValue: 'e', newValue: 'f', note: 'rename E→F' },
    ];
    const merged = mergeRenames(prompt, llm);
    expect(merged).toHaveLength(3);
    const a = merged.find((m) => m.oldValue === 'a');
    expect(a).toMatchObject({ source: 'both', note: 'rename A→B' });
    expect(merged.find((m) => m.oldValue === 'c').source).toBe('prompt');
    expect(merged.find((m) => m.oldValue === 'e').source).toBe('llm');
  });

  test('handles empty inputs gracefully', () => {
    expect(_internal.mergeRenames([], [])).toEqual([]);
    expect(_internal.mergeRenames(null, undefined)).toEqual([]);
  });

  test('caps at MAX_RENAMES (12) to protect the find-usages scanner', () => {
    const prompt = Array.from({ length: 50 }, (_, i) => ({
      oldValue: `o${i}`,
      newValue: `n${i}`,
      source: 'prompt',
    }));
    const merged = mergeRenames(prompt, []);
    expect(merged.length).toBeLessThanOrEqual(12);
  });
});

/* -------------------------------------------------------------------------- */
/*  enrichChangeTargets — auto-fills parent / trigger / scope on Workflow,    */
/*  Field, and Function changes when the LLM omits them. This is what makes   */
/*  the developer-facing change cards say                                     */
/*    "Workflow: NotifyManager — on Form: PurchaseOrder — onCreate"           */
/*  instead of the old useless                                                */
/*    "Workflow: NotifyManager"                                               */
/* -------------------------------------------------------------------------- */

describe('enrichChangeTargets helper', () => {
  const { enrichChangeTargets } = _internal;

  function overviewWithWorkflows() {
    return {
      forms: [
        { name: 'PurchaseOrder', fields: [{ name: 'VendorId', type: 'lookup' }] },
        { name: 'Customer', fields: [{ name: 'Email', type: 'email' }, { name: 'VendorId', type: 'lookup' }] },
      ],
      workflows: [
        { name: 'NotifyManager', form: 'PurchaseOrder', event: 'onCreate', scope: 'form' },
        { name: 'DailyDigest', form: '', event: 'scheduled:daily', scope: 'schedule' },
      ],
    };
  }

  test('back-fills parentEntity / parentName / trigger / scope for a Workflow', () => {
    const plan = {
      changes: [
        {
          kind: 'modify_workflow',
          target: { entity: 'Workflow', name: 'NotifyManager' },
          action: 'Add VAT to the email body',
        },
      ],
    };
    enrichChangeTargets(plan, overviewWithWorkflows());
    expect(plan.changes[0].target).toMatchObject({
      entity: 'Workflow',
      name: 'NotifyManager',
      parentEntity: 'Form',
      parentName: 'PurchaseOrder',
      trigger: 'onCreate',
      scope: 'form',
    });
  });

  test('back-fills scope+trigger but NOT parentEntity for a schedule (no form)', () => {
    const plan = {
      changes: [
        {
          kind: 'modify_workflow',
          target: { entity: 'Workflow', name: 'DailyDigest' },
          action: 'Run at 2am instead of midnight',
        },
      ],
    };
    enrichChangeTargets(plan, overviewWithWorkflows());
    const t = plan.changes[0].target;
    // The parser had form:'' for schedules, so we should NOT invent a parent.
    expect(t.parentEntity).toBeUndefined();
    expect(t.parentName).toBeUndefined();
    expect(t.trigger).toBe('scheduled:daily');
    expect(t.scope).toBe('schedule');
  });

  test('does not overwrite values the LLM already provided', () => {
    const plan = {
      changes: [
        {
          kind: 'modify_workflow',
          target: {
            entity: 'Workflow',
            name: 'NotifyManager',
            parentName: 'CustomLLMOverride', // LLM was more specific
            trigger: 'onEdit',
          },
          action: 'x',
        },
      ],
    };
    enrichChangeTargets(plan, overviewWithWorkflows());
    expect(plan.changes[0].target.parentName).toBe('CustomLLMOverride');
    expect(plan.changes[0].target.trigger).toBe('onEdit');
    // Scope is missing, so we still fill it from the digest.
    expect(plan.changes[0].target.scope).toBe('form');
  });

  test('resolves a unique bare field name to its parent form', () => {
    const plan = {
      changes: [
        {
          kind: 'modify_field',
          target: { entity: 'Field', name: 'Email' }, // unique → resolves
          action: 'Make required',
        },
      ],
    };
    enrichChangeTargets(plan, overviewWithWorkflows());
    expect(plan.changes[0].target).toMatchObject({
      parentEntity: 'Form',
      parentName: 'Customer',
    });
  });

  test('leaves ambiguous bare field names alone (rather than guessing)', () => {
    const plan = {
      changes: [
        {
          kind: 'modify_field',
          target: { entity: 'Field', name: 'VendorId' }, // on BOTH forms
          action: 'Convert to text',
        },
      ],
    };
    enrichChangeTargets(plan, overviewWithWorkflows());
    expect(plan.changes[0].target.parentName).toBeUndefined();
  });

  test('parses "Form.Field" dotted notation and sets parent', () => {
    const plan = {
      changes: [
        {
          kind: 'modify_field',
          target: { entity: 'Field', name: 'PurchaseOrder.VendorId' },
          action: 'Make required',
        },
      ],
    };
    enrichChangeTargets(plan, overviewWithWorkflows());
    expect(plan.changes[0].target).toMatchObject({
      parentEntity: 'Form',
      parentName: 'PurchaseOrder',
    });
  });

  test('is a no-op when plan has no changes or unknown workflow', () => {
    const plan = {
      changes: [
        {
          kind: 'modify_workflow',
          target: { entity: 'Workflow', name: 'UnknownWf' },
          action: 'x',
        },
      ],
    };
    enrichChangeTargets(plan, overviewWithWorkflows());
    expect(plan.changes[0].target.parentName).toBeUndefined();
    // and an empty plan must not throw
    expect(() => enrichChangeTargets({}, overviewWithWorkflows())).not.toThrow();
    expect(() => enrichChangeTargets({ changes: [] }, overviewWithWorkflows())).not.toThrow();
  });
});
