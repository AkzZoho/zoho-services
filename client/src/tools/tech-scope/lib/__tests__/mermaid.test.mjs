/**
 * Mermaid syntax-validation tests.
 *
 * The existing `template.test.mjs` only checks that certain substrings appear
 * in the generated Mermaid source.  That kind of assertion let a real bug
 * slip through: the custom-function node was being emitted as `[\"…"\]` —
 * a shape that does NOT exist in Mermaid's grammar (the closest valid shapes
 * are `[/text\]` trapezoid and `[\text/]` trapezoid-alt).  As a result, any
 * scope that contained at least one custom function caused the entire flow
 * diagram in the Tech Scope tool to fail to render with a parse error.
 *
 * These tests guard against that whole class of regressions by validating
 * the structural shape of every emitted node.  They run under plain
 * `node --test` — no DOM, no jsdom required.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlowchart, buildErDiagram } from '../mermaid.js';
import { emptyScope, stamp } from '../scope.js';

/* -------------------------------------------------------------------------- */
/*  A lightweight Mermaid-flowchart linter                                    */
/* -------------------------------------------------------------------------- */

/**
 * Extracts every "node-shape" segment from a flowchart line.  We don't try to
 * reproduce Mermaid's full grammar — we just isolate the bracketed/parenthesised
 * payload that follows an identifier and assert it uses one of the legal
 * shape forms.
 *
 * Legal opener → closer pairs supported by Mermaid v11:
 *   [text]            rectangle
 *   (text)            rounded
 *   ([text])          stadium
 *   [[text]]          subroutine
 *   [(text)]          cylinder
 *   ((text))          circle
 *   >text]            asymmetric / flag
 *   {text}            rhombus
 *   {{text}}          hexagon
 *   [/text/]          parallelogram
 *   [\text\]          parallelogram-alt
 *   [/text\]          trapezoid
 *   [\text/]          trapezoid-alt
 *   (((text)))        double-circle
 */
const VALID_SHAPE_PATTERNS = [
  /^\[\[.*\]\]$/s,          // [[ ]]
  /^\[\(.*\)\]$/s,          // [( )]
  /^\(\(\(.*\)\)\)$/s,      // ((( )))
  /^\(\(.*\)\)$/s,          // (( ))
  /^\(\[.*\]\)$/s,          // ([ ])
  /^\(.*\)$/s,              // ( )
  /^\[\/.*\/\]$/s,          // [/ /]
  /^\[\\.*\\\]$/s,          // [\ \]
  /^\[\/.*\\\]$/s,          // [/ \]
  /^\[\\.*\/\]$/s,          // [\ /]
  /^\{\{.*\}\}$/s,          // {{ }}
  /^\{.*\}$/s,              // { }
  /^\[.*\]$/s,              // [ ]
  /^>.*\]$/s,               // > ]
];

/**
 * Walks the source line by line and validates each node declaration.
 * Returns an array of human-readable error strings (empty = all good).
 */
function lintMermaidFlowchart(src) {
  const errors = [];
  const lines = src.split('\n');

  // Match an identifier followed by its shape payload.  We use a lazy capture
  // so we stop at the first balanced closing pair.
  // Examples that should match:
  //     fn_x[\"λ x"\]
  //     form_Vendors["📝 Vendors"]
  //     user(["👤 User"])
  //     wf_Notify{"⚙️ Notify"}
  // Lines that begin with edges (-->), classDef, class, subgraph, end, comments,
  // or `flowchart` headers are skipped.
  const skip = /^\s*(flowchart|graph|classDef|class\s|subgraph|end\b|%%|$)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (skip.test(line)) continue;
    // strip trailing edge-target if this line declares an edge: keep only
    // the first "node[shape]" before any --> or |label| segment.
    const decl = line.trim().split(/\s-->|\s-\.->|\s==>/)[0].trim();
    if (!decl) continue;

    // capture: <id><opener>...<closer>
    // we look for the first character that opens a shape: [ ( { >
    const m = decl.match(/^([A-Za-z_][\w]*)\s*([\[(>{].*)$/s);
    if (!m) continue;          // not a node decl (probably an edge label only)
    const shape = m[2];

    const ok = VALID_SHAPE_PATTERNS.some((re) => re.test(shape));
    if (!ok) {
      errors.push(`L${i + 1}: invalid Mermaid node shape \`${shape}\` for id \`${m[1]}\``);
    }

    // additional guard: balanced brackets inside the payload
    const opens = (shape.match(/[\[({]/g) || []).length;
    const closes = (shape.match(/[\])}]/g) || []).length;
    if (opens !== closes) {
      errors.push(`L${i + 1}: unbalanced brackets in node \`${m[1]}\` → \`${shape}\``);
    }
  }
  return errors;
}

/* -------------------------------------------------------------------------- */
/*  Fixture                                                                   */
/* -------------------------------------------------------------------------- */

function fullScope() {
  const s = stamp(emptyScope());
  s.meta.title = 'Lint Fixture';

  s.forms = [
    { name: 'Vendors', displayName: 'Vendors', fields: [{ name: 'Name', type: 'Single Line', required: true }] },
    { name: 'Purchase_Orders', displayName: 'Purchase Orders', fields: [{ name: 'Total', type: 'Currency' }] },
  ];
  s.reports = [
    { name: 'All_POs', displayName: 'All POs', type: 'list', baseForm: 'Purchase_Orders' },
  ];
  s.pages = [
    { name: 'Home', displayName: 'Home', section: 'Default', embeddedForms: ['Vendors'], embeddedReports: ['All_POs'] },
    { name: 'Admin', displayName: 'Admin', section: 'Backoffice', embeddedForms: [], embeddedReports: [] },
  ];
  s.workflows = [
    { name: 'Notify', displayName: 'Notify', scope: 'form', form: 'Purchase_Orders', event: 'on add' },
    { name: 'NightlyCleanup', displayName: 'Nightly Cleanup', scope: 'schedule' },
  ];
  s.schedules = [
    { name: 'nightly', frequency: 'daily', calls: 'cleanup' },
  ];
  s.customFunctions = [
    { name: 'calcTax', returnType: 'decimal', params: [], language: 'Deluge' },
    { name: 'cleanup', returnType: 'void', params: [], language: 'Deluge' },
  ];
  s.connections = [
    { service: 'Stripe', authType: 'apikey' },
  ];
  s.lookups = [
    { from: 'Purchase_Orders', field: 'Vendor', to: 'Vendors', kind: 'single' },
  ];
  return s;
}

/* -------------------------------------------------------------------------- */
/*  Tests                                                                     */
/* -------------------------------------------------------------------------- */

test('buildFlowchart: emits only valid Mermaid node shapes (regression)', () => {
  const src = buildFlowchart(fullScope());
  const errs = lintMermaidFlowchart(src);
  assert.deepEqual(
    errs,
    [],
    `Mermaid output contains invalid shape syntax:\n${errs.join('\n')}\n\n--- source ---\n${src}\n---`,
  );
});

test('buildFlowchart: customFunctions render as the trapezoid-alt shape [\\..../]', () => {
  const s = stamp(emptyScope());
  s.forms = [{ name: 'F', fields: [] }];
  s.customFunctions = [{ name: 'doThing', returnType: 'void', params: [], language: 'Deluge' }];
  const src = buildFlowchart(s);
  // Must contain `[\"λ doThing"/]`, must NOT contain the broken `[\"…"\]`.
  assert.match(src, /fn_doThing\[\\"λ doThing"\/\]/, 'expected trapezoid-alt for custom fn');
  assert.doesNotMatch(src, /fn_doThing\[\\".*"\\\]/, 'must not emit the legacy broken shape');
});

test('buildFlowchart: schedule label has no parentheses inside the quoted text', () => {
  const s = stamp(emptyScope());
  s.forms = [{ name: 'F', fields: [] }];
  s.schedules = [{ name: 'nightly', frequency: 'daily' }];
  const src = buildFlowchart(s);
  // The legacy form was `(["⏰ nightly (daily)"])` — the inner "(daily)"
  // is risky for older mermaid renderers; we now use an em-dash separator.
  const m = src.match(/sch_nightly\(\["([^"]*)"\]\)/);
  assert.ok(m, `schedule node missing or malformed:\n${src}`);
  assert.doesNotMatch(m[1], /\(/, 'label should not contain "(" anymore');
});

test('buildFlowchart: every line is bracket-balanced (no truncated shapes)', () => {
  const src = buildFlowchart(fullScope());
  const errs = lintMermaidFlowchart(src).filter((e) => /unbalanced/.test(e));
  assert.deepEqual(errs, [], `unbalanced brackets detected:\n${errs.join('\n')}`);
});

test('buildErDiagram: emits the erDiagram header and balanced entity braces', () => {
  const src = buildErDiagram(fullScope());
  assert.match(src, /^erDiagram/);
  // Mermaid ER relationship lines use `}o--||` / `||--o{` cardinality symbols
  // which contain { and } that are NOT entity delimiters.  We count only the
  // braces that sit at the start/end of entity blocks (preceded by whitespace
  // + identifier, or alone on a line) rather than counting all braces.
  const entityOpens  = (src.match(/^\s+\w[\w]*\s*\{/gm) || []).length;
  const entityCloses = (src.match(/^\s+\}/gm) || []).length;
  assert.equal(
    entityOpens,
    entityCloses,
    `ER entity braces are unbalanced (${entityOpens} opens vs ${entityCloses} closes):\n${src}`,
  );
});

test('buildFlowchart: empty scope still validates clean', () => {
  const src = buildFlowchart(stamp(emptyScope()));
  const errs = lintMermaidFlowchart(src);
  assert.deepEqual(errs, [], `empty-scope output has invalid syntax:\n${errs.join('\n')}\n${src}`);
});

/* -------------------------------------------------------------------------- */
/*  Self-check: confirm the linter actually catches genuinely broken shapes.  */
/*  This guards the linter itself — if someone weakens the regex, this test   */
/*  starts failing and signals the safety net is broken.                      */
/* -------------------------------------------------------------------------- */

test('linter self-check: rejects a genuinely malformed shape (mismatched brackets)', () => {
  // A node whose shape opener and closer don't form any valid pair.
  // e.g.  fn_x[("mixed")  — opens with [( but that must close with )]
  // We use a shape that opens with { but closes with ] which is not a valid pairing.
  const broken = [
    'flowchart TD',
    '  fn_x{"broken]',
  ].join('\n');
  const errs = lintMermaidFlowchart(broken);
  assert.ok(
    errs.some((e) => /unbalanced/.test(e) || /invalid Mermaid node shape/.test(e)),
    `linter failed to catch a malformed shape; got:\n${errs.join('\n')}`,
  );
});

test('linter self-check: accepts the canonical shapes', () => {
  const ok = [
    'flowchart TD',
    '  a["rect"]',
    '  b(["stadium"])',
    '  c{"diamond"}',
    '  d{{"hex"}}',
    '  e[/"parallelogram"/]',
    '  f[\\"trap-alt"/]',
    '  g[/"trap"\\]',
    '  h(("circle"))',
    '  i[("cyl")]',
  ].join('\n');
  assert.deepEqual(lintMermaidFlowchart(ok), []);
});
