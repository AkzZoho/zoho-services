/**
 * Unit tests for pageDescription.js — run with:
 *
 *   node --test client/src/lib/__tests__/pageDescription.test.mjs
 *
 * No test framework dependency — uses the built-in `node:test` runner so
 * the client workspace doesn't have to take on jest/vitest just for this.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describePage, __test__ } from '../pageDescription.js';

const {
  decodeEmbeddedDeluge,
  countLayoutElements,
  countDspElements,
  countDelugeDataReads,
  collectExternalRefs,
  hasClientScript,
  hasInlineCss,
} = __test__;

/* -------------------------------------------------------------------------- */

test('describePage: empty / missing page returns safe shell', () => {
  const d = describePage(null);
  assert.equal(typeof d.headline, 'string');
  assert.deepEqual(d.composition, []);
  assert.deepEqual(d.behaviour, []);
  assert.deepEqual(d.externals, []);
  assert.match(d.sizeLine, /0 lines/);
});

test('describePage: form-embedding page headline', () => {
  const page = {
    name: 'New_Customer',
    displayName: 'New Customer',
    embeddedForms: ['Customer'],
    embeddedReports: [],
    sourceCode: `page New_Customer { displayname="New Customer"\n<layout><row><column><dsp elementName='Form'>Customer</dsp></column></row></layout> }`,
  };
  const d = describePage(page);
  assert.match(d.headline, /Form-embedding page/);
  assert.ok(d.composition.some((l) => /Embeds form/.test(l)));
});

test('describePage: report-embedding page', () => {
  const page = {
    name: 'Dashboard',
    displayName: 'Dashboard',
    embeddedForms: [],
    embeddedReports: ['All_Leads', 'Won_Deals'],
    sourceCode: `page Dashboard { Content="<layout><row><column><dsp elementName='Report'>All_Leads</dsp></column></row></layout>" }`,
  };
  const d = describePage(page);
  assert.match(d.headline, /Report-embedding page/);
  const embedLine = d.composition.find((l) => /Embeds report/.test(l));
  assert.ok(embedLine);
  assert.match(embedLine, /All_Leads, Won_Deals/);
});

test('describePage: custom HTML page with Deluge detects data fetches', () => {
  const src = `page View_Policy(int policy_id) {
    displayname="View Policy"
    Content="<zml isPdfEnabled='true'><layout><row><column>
    <dsp id='html_snippet' elementName='HTML Snippet'>
      <![CDATA[htmlpage html_snippet()
      content
      &lt;%{
        fetchPolicy = Policy[ID == input.policy_id];
        otherRecords = Customer[Status == &quot;Active&quot;];
        info &quot;loaded&quot;;
      %&gt;
      ]]>
    </dsp></column></row></layout>"
  }`;
  const d = describePage({
    name: 'View_Policy',
    displayName: 'View Policy',
    params: 'int policy_id',
    embeddedForms: [],
    embeddedReports: [],
    sourceCode: src,
  });
  assert.match(d.headline, /Custom data-driven HTML page/);
  assert.ok(d.behaviour.some((b) => /Deluge inside the HTML snippet/.test(b)));
  assert.ok(d.behaviour.some((b) => /Fetches records from 2 forms/.test(b)));
  assert.ok(d.behaviour.some((b) => /Reads page parameter/.test(b) && /policy_id/.test(b)));
  assert.ok(d.notes.some((n) => /Print \/ PDF export enabled/.test(n)));
  assert.ok(d.notes.some((n) => /Accepts parameters/.test(n)));
});

test('describePage: external references detected', () => {
  const src = `Content="<dsp elementName='HTML Snippet'><![CDATA[htmlpage s()
  content
  &lt;%{
    Role = master_database.LIVE.LoginUserProfile(&quot;EHS&quot;);
    Logo = thisapp.Settings.PublicKey(&quot;Company_Logo&quot;);
    User = zoho.loginuserid;
  %&gt;
  ]]></dsp>"`;
  const d = describePage({ name: 'P', sourceCode: src });
  assert.ok(d.externals.some((e) => /master_database/.test(e)));
  assert.ok(d.externals.some((e) => /thisapp\.Settings\.PublicKey/.test(e)));
  assert.ok(d.externals.some((e) => /Zoho user context/.test(e)));
});

test('describePage: hidden + section notes', () => {
  const d = describePage({
    name: 'X',
    hidden: true,
    section: 'Admin',
    sourceCode: '',
    embeddedForms: [],
    embeddedReports: [],
  });
  assert.ok(d.notes.some((n) => /Hidden from navigation/.test(n)));
  assert.ok(d.notes.some((n) => /In section "Admin"/.test(n)));
  assert.match(d.headline, /\(hidden\)/);
});

/* -------------------------------------------------------------------------- */
/*  Helper-function tests                                                      */
/* -------------------------------------------------------------------------- */

test('decodeEmbeddedDeluge: extracts + decodes entities', () => {
  const src = `...<![CDATA[htmlpage x()
content
&lt;%{ x = &quot;hi&quot;; %&gt;
]]>...`;
  const out = decodeEmbeddedDeluge(src);
  assert.match(out, /<%\{/);
  assert.match(out, /"hi"/);
});

test('countLayoutElements: rows + columns', () => {
  const { rows, columns } = countLayoutElements('<layout><row><column/><column/></row><row><column/></row></layout>');
  assert.equal(rows, 2);
  assert.equal(columns, 3);
});

test('countDspElements: tallies every elementName', () => {
  const src = `<dsp elementName='HTML Snippet'/><dsp elementName='Form'/><dsp elementName='Form'/><dsp elementName='Button'/>`;
  const counts = countDspElements(src);
  assert.equal(counts['HTML Snippet'], 1);
  assert.equal(counts['Form'], 2);
  assert.equal(counts['Button'], 1);
});

test('countDelugeDataReads: dedupes + skips numeric indices', () => {
  const deluge = `
    x = Customer[Status == "A"];
    y = Customer[Status == "A"];
    z = Order[Amount > 100];
    arr[0];   // numeric index, must be ignored
    arr[5];
  `;
  const reads = countDelugeDataReads(deluge);
  const forms = reads.map((r) => r.form).sort();
  assert.deepEqual(forms, ['Customer', 'Order']);
});

test('hasClientScript / hasInlineCss', () => {
  assert.ok(hasClientScript('<script>alert(1)</script>'));
  assert.ok(hasClientScript('script { const a = 1; }'));
  assert.ok(!hasClientScript('<p>no script here</p>'));
  assert.ok(hasInlineCss('<style>.a{color:red}</style>'));
  assert.ok(!hasInlineCss('<p>no style</p>'));
});

test('collectExternalRefs: caps at 6, de-dupes', () => {
  const deluge = Array.from({ length: 10 }, (_, i) => `res = app${i}.Form.fn();`).join('\n');
  const refs = collectExternalRefs(deluge);
  assert.ok(refs.length <= 6);
});
