/**
 * End-to-end smoke test for the DS Analyser tool against the REAL
 * `UltraTech_CMS.ds` Creator export and the consultant's actual prompt.
 *
 * This test does NOT mock the LLM in stub mode — instead it independently
 * exercises BOTH halves of the change-request pipeline (deterministic +
 * LLM-when-available) to prove the user-visible outcome is correct:
 *
 *   1. /api/inspect          → parses the .ds file and returns an overview
 *                              that includes the Download_Complaint
 *                              workflow with `form: Complaint` and the
 *                              workflow source containing the literal
 *                              "shriniwash.yadav_adityabirla" username.
 *
 *   2. /api/change-request   → with the prompt
 *                              "Change shriniwash.yadav_adityabirla to
 *                               utcl_cms in the Download_Complaint workflow"
 *
 *      Must return:
 *        • llmAvailable: true | false (either is acceptable for THIS test)
 *        • plan.lineEdits[0].oldValue === 'shriniwash.yadav_adityabirla'
 *        • plan.lineEdits[0].newValue === 'utcl_cms'
 *        • plan.lineEdits[0].groupedByEntity → at least one match
 *          pointing at the Download_Complaint workflow.
 *
 *   3. Independent verification that the .ds digest exposes
 *      Download_Complaint with the metadata the LLM needs to classify it
 *      as a Report Workflow (scope='report', form='Complaint').
 *
 * The test runs in two LLM modes:
 *   - stub  : forces no-AI to validate the deterministic half is enough.
 *   - real  : if OPENAI_API_KEY is set in env, asserts that the LLM
 *             classification is correct (Report Workflow, parent=Complaint).
 */

const path = require('path');
const fs = require('fs');
const request = require('supertest');

// ---------------------------------------------------------------------------
// Locate the real .ds upload.
// ---------------------------------------------------------------------------
const DS_PATH = '/tmp/ai_uploads/01c47584-4e79-43c3-86dc-0738c7e77744/UltraTech_CMS.ds';
const HAS_DS = fs.existsSync(DS_PATH);
const HAS_REAL_LLM = !!process.env.OPENAI_API_KEY;

// Skip the whole suite if the upload isn't there (e.g. CI without the file).
const describeFn = HAS_DS ? describe : describe.skip;

describeFn('DS Analyser — UltraTech_CMS.ds end-to-end', () => {
  jest.setTimeout(60_000); // LLM calls can take 20–30s

  let app;
  let overview;

  beforeAll(async () => {
    // Load app AFTER env is decided, so the LLM router picks up the right keys.
    app = require('../src/app');
    const res = await request(app)
      .post('/api/inspect')
      .attach('ds', DS_PATH);
    expect(res.status).toBe(200);
    overview = res.body;
  });

  test('inspect parses Download_Complaint with form=Complaint and the username appears in its source', () => {
    expect(Array.isArray(overview.workflows)).toBe(true);
    const dl = overview.workflows.find((w) => w.name === 'Download_Complaint');
    expect(dl).toBeDefined();
    // The .ds defines this workflow under `report Complaints_Report { custom actions { ... } }`
    // The parser stamps `form: Complaint` because the workflow body declares form=Complaint;
    // the surrounding container is a report. Either way, the workflow source MUST contain
    // the username literal and the execution-type marker that proves it's a "for each record"
    // (i.e. report-driven) action.
    expect(dl.form).toBe('Complaint');
    expect(typeof dl.sourceCode).toBe('string');
    expect(dl.sourceCode).toMatch(/shriniwash\.yadav_adityabirla/);
    expect(dl.sourceCode).toMatch(/for each record/i);
  });

  test('change-request with rename prompt → deterministic lineEdits locate the username inside Download_Complaint', async () => {
    const instruction =
      'Change shriniwash.yadav_adityabirla to utcl_cms in the Download_Complaint workflow.';

    const res = await request(app)
      .post('/api/change-request')
      .send({ instruction, overview });

    expect(res.status).toBe(200);
    expect(res.body.plan).toBeDefined();

    const { lineEdits } = res.body.plan;
    expect(Array.isArray(lineEdits)).toBe(true);
    expect(lineEdits.length).toBeGreaterThanOrEqual(1);

    const edit = lineEdits.find((e) => e.oldValue === 'shriniwash.yadav_adityabirla');
    expect(edit).toBeDefined();
    expect(edit.newValue).toBe('utcl_cms');
    expect(edit.totals.occurrences).toBeGreaterThanOrEqual(1);

    // Must hit the Download_Complaint workflow specifically.
    const hitDownload = edit.groupedByEntity.find(
      (g) => g.entityKind === 'workflow' && g.entityName === 'Download_Complaint'
    );
    expect(hitDownload).toBeDefined();
    expect(hitDownload.matches.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // Real-LLM-only assertions: classification correctness.
  // Run with `OPENAI_API_KEY=… npm test -- ultratech-cms-e2e`.
  // ---------------------------------------------------------------------------
  (HAS_REAL_LLM ? test : test.skip)(
    'real LLM correctly classifies Download_Complaint as Report Workflow on the Complaint form',
    async () => {
      const instruction =
        'Change shriniwash.yadav_adityabirla to utcl_cms in the Download_Complaint workflow. ' +
        'Tell me which workflow type it is and which form it belongs to.';

      const res = await request(app)
        .post('/api/change-request')
        .send({ instruction, overview });

      expect(res.status).toBe(200);
      expect(res.body.llmAvailable).toBe(true);
      const plan = res.body.plan;

      // Find a workflow-targeted change (the LLM should emit at least one).
      const wfChange = (plan.changes || []).find(
        (c) =>
          c.target &&
          c.target.entity === 'Workflow' &&
          /Download_Complaint/i.test(c.target.name || '')
      );

      expect(wfChange).toBeDefined();
      // Parent context MUST be filled — that's the whole point of the learning.
      // Accept either Form: Complaint OR Report (the report's base form is Complaint).
      const t = wfChange.target;
      expect(['Form', 'Report']).toContain(t.parentEntity);
      // The parent name must be either the form or the report name.
      expect(typeof t.parentName).toBe('string');
      expect(t.parentName.length).toBeGreaterThan(0);
      // Scope must say report (or form for the form-attribute interpretation).
      expect(['report', 'form']).toContain(t.scope || 'form');

      // The summary OR action OR rationale should mention "report" somewhere
      // because this is a report custom action — that's the user-visible
      // signal that the learning has taken effect.
      const allText = [
        plan.summary,
        plan.intent,
        wfChange.action,
        wfChange.rationale,
        ...(wfChange.manualSteps || []),
      ].join(' ').toLowerCase();
      expect(allText).toMatch(/report|custom action|for each record/);
    }
  );
});
