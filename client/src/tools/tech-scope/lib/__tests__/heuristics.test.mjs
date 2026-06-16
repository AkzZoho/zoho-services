/**
 * Unit tests for the BRD heuristic extractor (Zoho Creator vocabulary).
 *   node --test client/src/tools/tech-scope/lib/__tests__/heuristics.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveScope } from '../heuristics.js';

/* -------------------------------------------------------------------------- */
/*  Forms                                                                      */
/* -------------------------------------------------------------------------- */

test('deriveScope: extracts forms from "Form: X" lines', () => {
  const text = `
ACME Portal Requirements

Form: Customer
Form: Invoice
Form: Vendor
`;
  const s = deriveScope(text);
  const names = s.forms.map((f) => f.name).sort();
  assert.deepEqual(names, ['Customer', 'Invoice', 'Vendor']);
  // Every form has Creator-default action events
  for (const f of s.forms) {
    assert.deepEqual(f.actionEvents, ['on add', 'on edit']);
    assert.equal(typeof f.displayName, 'string');
  }
});

test('deriveScope: picks up bullet list under "Forms:" heading', () => {
  const text = `
# Master Forms
- Customer
- Invoice
- Product Catalog
`;
  const s = deriveScope(text);
  const names = s.forms.map((f) => f.name);
  assert.ok(names.includes('Customer'));
  assert.ok(names.includes('Invoice'));
  // Multi-word bullets are coerced to a Creator identifier (no spaces)
  assert.ok(names.includes('Product_Catalog'));
});

/* -------------------------------------------------------------------------- */
/*  Reports                                                                    */
/* -------------------------------------------------------------------------- */

test('deriveScope: derives reports from "Report: X" labels', () => {
  const text = `
Form: Lead

Report: All_Leads
Report: Hot_Leads
`;
  const s = deriveScope(text);
  const names = s.reports.map((r) => r.name);
  assert.ok(names.includes('All_Leads'));
  assert.ok(names.includes('Hot_Leads'));
});

test('deriveScope: derives a report from "list of <X>" phrasing', () => {
  const text = `Form: Customer\n\nThe app shows a list of Customers on the home page.`;
  const s = deriveScope(text);
  assert.ok(s.reports.some((r) => /Customers/i.test(r.name)));
});

test('deriveScope: detects kanban view hint', () => {
  const text = `Form: Task\n\nManagers will use a Task kanban view to triage open work.`;
  const s = deriveScope(text);
  assert.ok(s.reports.some((r) => r.type === 'kanban'));
});

/* -------------------------------------------------------------------------- */
/*  Pages                                                                      */
/* -------------------------------------------------------------------------- */

test('deriveScope: extracts pages from "Page:" labels and "X dashboard" phrases', () => {
  const text = `
Page: Home
Dashboard: Sales

Sales Dashboard shows year-to-date numbers.
`;
  const s = deriveScope(text);
  assert.ok(s.pages.length >= 2);
  const names = s.pages.map((p) => p.name);
  assert.ok(names.some((n) => /Home/i.test(n)));
  assert.ok(names.some((n) => /Sales/i.test(n)));
});

/* -------------------------------------------------------------------------- */
/*  Workflows                                                                  */
/* -------------------------------------------------------------------------- */

test('deriveScope: workflows from "approve <X>" sentences with event guess', () => {
  const text = `
On submit, the system must allow managers to approve Purchase Orders before they are sent to vendors.
The system shall notify Customers when invoice is created.
`;
  const s = deriveScope(text);
  assert.ok(s.workflows.length >= 1);
  const approve = s.workflows.find((w) => /approve/i.test(w.name));
  assert.ok(approve);
  // Default Creator event is "on add"
  assert.match(approve.event, /^on /);
});

/* -------------------------------------------------------------------------- */
/*  Custom Functions / Connections / Schedules / Public APIs                   */
/* -------------------------------------------------------------------------- */

test('deriveScope: APIs from method+path lines', () => {
  const text = `
The backend should expose:
GET /api/customers
POST /api/invoices
DELETE /api/invoices/:id
`;
  const s = deriveScope(text);
  assert.equal(s.publicAPIs.length, 3);
  assert.ok(s.publicAPIs.find((a) => a.method === 'POST' && a.path === '/api/invoices'));
  for (const a of s.publicAPIs) assert.equal(a.auth, 'apikey');
});

test('deriveScope: derives custom functions from "calculate X" wording', () => {
  const text = `Form: Invoice\n\nThe system shall calculate total_amount automatically when line items change.`;
  const s = deriveScope(text);
  assert.ok(s.customFunctions.length >= 1);
  assert.match(s.customFunctions[0].name, /calc_/);
});

test('deriveScope: detects known SaaS connections', () => {
  const text = `Payment is processed via Stripe. Notifications go through Slack and Twilio.`;
  const s = deriveScope(text);
  const names = s.connections.map((c) => c.service);
  assert.ok(names.includes('Stripe'));
  assert.ok(names.includes('Slack'));
  assert.ok(names.includes('Twilio'));
});

test('deriveScope: detects daily schedule', () => {
  const text = `Form: Reminder\n\nA daily job will send reminder emails to overdue customers.`;
  const s = deriveScope(text);
  assert.ok(s.schedules.length >= 1);
  assert.equal(s.schedules[0].frequency, 'daily');
});

/* -------------------------------------------------------------------------- */
/*  Roles & Profiles                                                           */
/* -------------------------------------------------------------------------- */

test('deriveScope: roles deduplicated and a default Standard profile is built', () => {
  const text = `
Form: Order

Admins can do everything. The Admin user manages all settings.
Managers approve invoices. A Manager also reviews onboarding.
Customers place orders.
`;
  const s = deriveScope(text);
  const lower = s.roles.map((r) => r.name.toLowerCase());
  assert.equal(new Set(lower).size, lower.length);
  assert.ok(lower.includes('admin') || lower.includes('administrator'));

  // Default profile bundling Tab + Viewall on every form
  assert.ok(s.profiles.length >= 1);
  const std = s.profiles.find((p) => p.name === 'Standard');
  assert.ok(std);
  assert.ok(std.modulePermissions.every((m) => m.enabled.includes('Tab') && m.enabled.includes('Viewall')));
});

/* -------------------------------------------------------------------------- */
/*  NFRs / Out-of-scope                                                        */
/* -------------------------------------------------------------------------- */

test('deriveScope: NFRs categorised', () => {
  const text = `
Performance: All list endpoints must respond within 500ms at p95.
Security: All PII must be encrypted at rest using AES-256.
The system should be available 99.9% of the time per month.
`;
  const s = deriveScope(text);
  const cats = s.nfrs.map((n) => n.category);
  assert.ok(cats.includes('Performance'));
  assert.ok(cats.includes('Security'));
  assert.ok(cats.includes('Availability'));
});

test('deriveScope: out-of-scope sentences captured', () => {
  const text = `
The mobile app is out of scope for v1.
Reporting dashboards will not be included in the first release.
`;
  const s = deriveScope(text);
  assert.equal(s.outOfScope.length, 2);
});

/* -------------------------------------------------------------------------- */
/*  Application meta                                                           */
/* -------------------------------------------------------------------------- */

test('deriveScope: handles empty text gracefully', () => {
  const s = deriveScope('');
  assert.equal(s.forms.length, 0);
  assert.equal(s.workflows.length, 0);
  assert.equal(s.reports.length, 0);
  assert.equal(s.pages.length, 0);
  assert.equal(s.meta.title, 'Untitled Creator App');
});

test('deriveScope: title falls back to first non-empty line', () => {
  const text = `ACME Procurement Portal\n\nThis is the BRD for...\n`;
  const s = deriveScope(text);
  assert.equal(s.meta.title, 'ACME Procurement Portal');
  assert.equal(s.application.name, 'ACME Procurement Portal');
});

test('deriveScope: respects opts.title', () => {
  const s = deriveScope('Some content', { title: 'Override Title', sourceFile: 'brd.pdf' });
  assert.equal(s.meta.title, 'Override Title');
  assert.equal(s.meta.sourceFile, 'brd.pdf');
});

test('deriveScope: detects Creator edition hint', () => {
  const s = deriveScope('We will use the Flex edition of Zoho Creator for this app.');
  assert.equal(s.application.edition, 'flex');
});

test('deriveScope: detects timezone hint', () => {
  const s = deriveScope('Time zone: America/New_York for all users.');
  assert.equal(s.application.timeZone, 'America/New_York');
});
