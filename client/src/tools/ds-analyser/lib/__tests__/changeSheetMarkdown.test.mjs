/**
 * Unit tests for the changeSheetMarkdown serialiser.
 *
 * The serialiser is the only formatter shared between the on-screen "Copy
 * as Markdown" button and the "Download .md" file, so its output IS the
 * developer-facing contract. We pin:
 *
 *   - every plan section produces its header when populated
 *   - empty/absent sections are omitted (no `## Warnings` with nothing under it)
 *   - line edits render the diff in a fenced code block with `-`/`+` markers
 *   - line edits with zero hits still produce a section saying so
 *   - structural changes include risk, target, rationale, manual steps
 *   - out-of-scope notes render with reason + where
 *   - download filename slugifies the app name correctly
 *
 * Run with: node --test --experimental-vm-modules (Vitest also works)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planToMarkdown,
  combinedPlanToMarkdown,
  downloadFilename,
} from '../changeSheetMarkdown.js';

/* --------------------------- helpers ------------------------------------ */

function tinyPlan(overrides = {}) {
  return {
    summary: 'Rename owner identifier across all workflows.',
    intent: 'Rename a stale owner email.',
    confidence: 0.85,
    changes: [],
    lineEdits: [],
    outOfScope: [],
    warnings: [],
    openQuestions: [],
    ...overrides,
  };
}

/* --------------------------- header section ----------------------------- */

test('header includes app name, provider, confidence', () => {
  const md = planToMarkdown(tinyPlan(), {
    provider: 'openai',
    llmAvailable: true,
    appName: 'My App',
  });
  assert.match(md, /# Developer Change Sheet/);
  assert.match(md, /My App/);
  assert.match(md, /OpenAI/);
  assert.match(md, /Confidence:\*\* 85%/);
});

test('original instruction is rendered as a blockquote', () => {
  const md = planToMarkdown(tinyPlan(), {
    instruction: 'Change foo to bar.\nAlso update the report.',
  });
  // Multiline blockquote — every line of the instruction prefixed with "> "
  assert.match(md, /## Original request\n\n> Change foo to bar\.\n> Also update the report\./);
});

test('stub-mode (llmAvailable: false) annotation appears next to provider', () => {
  const md = planToMarkdown(tinyPlan(), { provider: 'stub', llmAvailable: false });
  assert.match(md, /stub \(no AI configured\)/);
  assert.match(md, /no AI — deterministic only/);
});

/* --------------------------- line edits --------------------------------- */

test('line edits render a fenced diff with -/+ markers', () => {
  const plan = tinyPlan({
    lineEdits: [
      {
        oldValue: 'shriniwash.yadav_adityabirla',
        newValue: 'utcl_cms',
        source: 'prompt',
        note: '',
        totals: { occurrences: 1, entitiesWithMatches: 1, truncated: false },
        groupedByEntity: [
          {
            entityKey: 'workflow:WF',
            entityKind: 'workflow',
            entityName: 'WF',
            displayName: 'On Add Order',
            matches: [
              {
                line: 5,
                column: 13,
                lineText: '    owner = "shriniwash.yadav_adityabirla";',
                replacement: '    owner = "utcl_cms";',
                matchText: 'shriniwash.yadav_adityabirla',
              },
            ],
          },
        ],
      },
    ],
  });
  const md = planToMarkdown(plan);

  assert.match(md, /## Precise line edits/);
  assert.match(md, /shriniwash\.yadav_adityabirla.*utcl_cms/);
  assert.match(md, /Workflow: `On Add Order`/);
  assert.match(md, /\*\*Line 5, col 13\*\*/);
  // Fence with -/+ diff markers. The serialiser prefixes each line of the
  // captured source with "- " (or "+ ") and KEEPS the source's own
  // indentation, so we just check the marker + owner substring is present.
  assert.match(md, /-\s+owner = "shriniwash\.yadav_adityabirla";/);
  assert.match(md, /\+\s+owner = "utcl_cms";/);
});

test('line edit with zero hits states so explicitly', () => {
  const plan = tinyPlan({
    lineEdits: [
      {
        oldValue: 'missing.identifier',
        newValue: 'replacement',
        source: 'prompt',
        totals: { occurrences: 0, entitiesWithMatches: 0, truncated: false },
        groupedByEntity: [],
      },
    ],
  });
  const md = planToMarkdown(plan);
  assert.match(md, /No occurrences of `missing\.identifier` found/);
});

test('truncation flag surfaces a warning in the section', () => {
  const plan = tinyPlan({
    lineEdits: [
      {
        oldValue: 'x',
        newValue: 'y',
        source: 'prompt',
        totals: { occurrences: 500, entitiesWithMatches: 30, truncated: true },
        groupedByEntity: [],
      },
    ],
  });
  const md = planToMarkdown(plan);
  assert.match(md, /results truncated by safety cap/);
});

/* --------------------------- structural changes ------------------------- */

test('structural change renders risk, target, manual steps', () => {
  const plan = tinyPlan({
    changes: [
      {
        id: 'c1',
        kind: 'add_field',
        target: { entity: 'Form', name: 'Customers' },
        action: 'Add a required Status field to Customers.',
        rationale: 'No status tracking exists today.',
        risk: 'medium',
        dataImpact: 'backfill-needed',
        manualSteps: [
          'Open form Customers',
          'Add field Status of type Picklist',
          'Backfill existing rows to Status=Active',
        ],
        relatedEntities: ['CustomerReport'],
      },
    ],
  });
  const md = planToMarkdown(plan);
  assert.match(md, /## Structural \/ behavioural changes/);
  assert.match(md, /Add a required Status field to Customers/);
  assert.match(md, /Risk:\*\* 🟡 medium/);
  assert.match(md, /Target:\*\* Form `Customers`/);
  assert.match(md, /backfill needed/);
  // Manual steps numbered as a list
  assert.match(md, /1\. Open form Customers/);
  assert.match(md, /Also revisit:\*\* `CustomerReport`/);
});

/* --------------------------- out of scope ------------------------------- */

test('out-of-scope notes render with reason + where', () => {
  const plan = tinyPlan({
    outOfScope: [
      {
        request: 'Change the company logo on the login page',
        reason: 'Login-page branding is not stored in the .ds export.',
        where: 'Creator → Settings → Branding',
      },
    ],
  });
  const md = planToMarkdown(plan);
  assert.match(md, /Out of scope for this `\.ds`/);
  assert.match(md, /Change the company logo on the login page/);
  assert.match(md, /Reason: Login-page branding is not stored/);
  assert.match(md, /Where: Creator → Settings → Branding/);
});

/* --------------------------- empty plan -------------------------------- */

test('empty plan still produces a valid header-only document', () => {
  const md = planToMarkdown({}, {});
  assert.match(md, /# Developer Change Sheet/);
  // No empty section headers should appear
  assert.doesNotMatch(md, /## Cross-cutting warnings/);
  assert.doesNotMatch(md, /## Open questions/);
  assert.doesNotMatch(md, /## Precise line edits/);
});

test('null/undefined plan returns a graceful fallback', () => {
  assert.match(planToMarkdown(null), /empty plan/);
  assert.match(planToMarkdown(undefined), /empty plan/);
});

/* --------------------------- filename slug ----------------------------- */

test('downloadFilename slugifies the app name and includes a timestamp', () => {
  const name = downloadFilename('My Demo App!');
  assert.match(name, /^change-sheet-my-demo-app-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.md$/);
});

test('downloadFilename falls back to a generic name when appName is empty', () => {
  const name = downloadFilename('');
  // Just "change-sheet-<timestamp>.md" — no double slug.
  assert.match(name, /^change-sheet-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.md$/);
});

/* --------------------------- combined (multi-turn) markdown --------------- */

test('combinedPlanToMarkdown emits one H1 plus one section per turn', () => {
  const turns = [
    {
      instruction: 'Change foo to bar.',
      plan: tinyPlan({ summary: 'Rename foo → bar.' }),
      provider: 'openai',
      llmAvailable: true,
      kind: 'request',
      ts: 1,
    },
    {
      instruction: 'Also make Email required.',
      plan: tinyPlan({ summary: 'Add required validation to Email.' }),
      provider: 'openai',
      llmAvailable: true,
      kind: 'request',
      ts: 2,
    },
  ];
  const md = combinedPlanToMarkdown(turns, { appName: 'My App' });

  // Single top-level H1
  const h1Count = (md.match(/^# (?!#)/gm) || []).length;
  assert.equal(h1Count, 1, 'combined doc should have exactly one H1');

  assert.match(md, /# Developer Change Sheet \(combined\)/);
  assert.match(md, /\*\*App:\*\* My App/);
  assert.match(md, /\*\*Turns:\*\* 2/);
  assert.match(md, /## Turn 1 — change request/);
  assert.match(md, /## Turn 2 — change request/);
  // Per-turn content (prompts + summaries) is preserved
  assert.match(md, /Change foo to bar\./);
  assert.match(md, /Also make Email required\./);
  assert.match(md, /Rename foo → bar\./);
  assert.match(md, /Add required validation to Email\./);
});

test('combinedPlanToMarkdown handles an empty turn list gracefully', () => {
  const md = combinedPlanToMarkdown([]);
  assert.match(md, /# Developer Change Sheet \(combined\)/);
  assert.match(md, /no turns yet/);
});

test('combinedPlanToMarkdown labels audit turns distinctly', () => {
  const turns = [
    {
      instruction: 'Audit this application for the highest-value improvements.',
      plan: tinyPlan(),
      provider: 'openai',
      llmAvailable: true,
      kind: 'audit',
      ts: 1,
    },
  ];
  const md = combinedPlanToMarkdown(turns);
  assert.match(md, /## Turn 1 — audit/);
});
