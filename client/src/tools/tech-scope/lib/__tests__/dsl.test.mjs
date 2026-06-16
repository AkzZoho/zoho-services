/**
 * Unit tests for the prompt DSL (Zoho Creator vocabulary).
 *   node --test client/src/tools/tech-scope/lib/__tests__/dsl.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrompt, applyCommands, __test__ } from '../dsl.js';
import { emptyScope, stamp } from '../scope.js';

const { matchLine, parseFieldDescriptor, parseFieldList, parseActionList, asCreatorField, toIdent } = __test__;

/* -------------------------------------------------------------------------- */
/*  Grammar                                                                    */
/* -------------------------------------------------------------------------- */

test('matchLine: addForm with fields', () => {
  const a = matchLine('add form: Customer with fields: id, name, email');
  assert.equal(a.kind, 'addForm');
  assert.equal(a.name, 'Customer');
  assert.deepEqual(a.fields.map((f) => f.name), ['id', 'name', 'email']);
});

test('matchLine: addReport with type and base form', () => {
  const a = matchLine('add report: All_Customers type list from Customer');
  assert.equal(a.kind, 'addReport');
  assert.equal(a.name, 'All_Customers');
  assert.equal(a.type, 'list');
  assert.equal(a.baseForm, 'Customer');
});

test('matchLine: addReport with kanban type via "as"', () => {
  const a = matchLine('add report: Pipeline as kanban from Lead');
  assert.equal(a.type, 'kanban');
  assert.equal(a.baseForm, 'Lead');
});

test('matchLine: addPage with section and embeds', () => {
  const a = matchLine('add page: Sales_Home in section Sales embeds Form: Lead, Report: Hot_Leads');
  assert.equal(a.kind, 'addPage');
  assert.equal(a.name, 'Sales_Home');
  assert.equal(a.section, 'Sales');
  assert.equal(a.embeds.length, 2);
  assert.deepEqual(a.embeds[0], { kind: 'form', name: 'Lead' });
  assert.deepEqual(a.embeds[1], { kind: 'report', name: 'Hot_Leads' });
});

test('matchLine: addWorkflow with trigger normalises Creator event', () => {
  const a = matchLine('add workflow: Invoice Approval triggered by Invoice.create');
  assert.equal(a.kind, 'addWorkflow');
  assert.equal(a.name, 'Invoice Approval');
  assert.equal(a.trigger.form, 'Invoice');
  assert.equal(a.trigger.event, 'on add'); // 'create' → 'on add'
});

test('matchLine: addWorkflow without trigger', () => {
  const a = matchLine('add workflow: Customer Onboarding');
  assert.equal(a.kind, 'addWorkflow');
  assert.equal(a.trigger, null);
});

test('matchLine: addLookup', () => {
  const a = matchLine('add lookup: Invoice.customer_id -> Customer as single');
  assert.equal(a.kind, 'addLookup');
  assert.equal(a.from, 'Invoice');
  assert.equal(a.field, 'customer_id');
  assert.equal(a.to, 'Customer');
  assert.equal(a.lookupKind, 'single');
});

test('matchLine: addCustomFunction', () => {
  const a = matchLine('add function: calcInvoiceTotal returns decimal — Sums all line items');
  assert.equal(a.kind, 'addCustomFunction');
  assert.equal(a.name, 'calcInvoiceTotal');
  assert.equal(a.returnType, 'decimal');
  assert.match(a.purpose, /Sums all line items/);
});

test('matchLine: addConnection with auth', () => {
  const a = matchLine('add connection: Stripe via apikey — Process card payments');
  assert.equal(a.kind, 'addConnection');
  assert.equal(a.service, 'Stripe');
  assert.equal(a.authType, 'apikey');
});

test('matchLine: addSchedule with frequency and call', () => {
  const a = matchLine('add schedule: nightly_reminders runs daily calls sendReminders');
  assert.equal(a.kind, 'addSchedule');
  assert.equal(a.name, 'nightly_reminders');
  assert.equal(a.frequency, 'daily');
  assert.equal(a.calls, 'sendReminders');
});

test('matchLine: addRole with parent', () => {
  const a = matchLine('add role: Sales Manager reports to Director — Manages sales reps');
  assert.equal(a.kind, 'addRole');
  assert.equal(a.name, 'Sales Manager');
  assert.equal(a.parent, 'Director');
});

test('matchLine: addProfile with actions on forms', () => {
  const a = matchLine('add profile: Sales Rep can read, write on Lead, Customer');
  assert.equal(a.kind, 'addProfile');
  assert.equal(a.name, 'Sales Rep');
  assert.deepEqual(a.actions.sort(), ['read', 'write']);
  assert.deepEqual(a.forms, ['Lead', 'Customer']);
});

test('matchLine: addPublicAPI', () => {
  const a = matchLine('add api: GET /api/customers from Customer returns Customer[]');
  assert.equal(a.kind, 'addPublicAPI');
  assert.equal(a.method, 'GET');
  assert.equal(a.path, '/api/customers');
  assert.equal(a.baseForm, 'Customer');
});

test('matchLine: addNfr', () => {
  const a = matchLine('add nfr: Performance — p95 under 500ms');
  assert.equal(a.kind, 'addNfr');
  assert.equal(a.category, 'Performance');
  assert.equal(a.statement, 'p95 under 500ms');
});

test('matchLine: setEdition / setApplication / setTimezone', () => {
  assert.equal(matchLine('set edition: flex').kind, 'setEdition');
  assert.equal(matchLine('set application: ACME Sales Portal').kind, 'setApplication');
  assert.equal(matchLine('set timezone: America/New_York').kind, 'setTimezone');
});

test('matchLine: legacy addEntity routes to addForm (alias)', () => {
  const a = matchLine('add entity: Order with fields: id, total');
  assert.equal(a.kind, 'addForm');
  assert.equal(a.name, 'Order');
});

test('matchLine: legacy addRelationship routes to addLookup (alias)', () => {
  const a = matchLine('add relationship: Customer <-> Invoice as customer_id (1-N)');
  assert.equal(a.kind, 'addLookup');
  assert.equal(a.from, 'Customer');
  assert.equal(a.to, 'Invoice');
  assert.equal(a.field, 'customer_id');
});

test('matchLine: legacy addModule routes to addPage (alias)', () => {
  const a = matchLine('add module: Sales — Customer-facing screens');
  assert.equal(a.kind, 'addPage');
  assert.equal(a.name, 'Sales');
});

test('matchLine: legacy addIntegration routes to addConnection (alias)', () => {
  const a = matchLine('add integration: HubSpot via OAuth');
  assert.equal(a.kind, 'addConnection');
  assert.equal(a.authType, 'oauth2');
});

test('matchLine: unknown returns null', () => {
  assert.equal(matchLine('please make it faster'), null);
});

/* -------------------------------------------------------------------------- */
/*  Field descriptor parsing                                                   */
/* -------------------------------------------------------------------------- */

test('parseFieldDescriptor: bare name → text/non-required', () => {
  const f = parseFieldDescriptor('email');
  assert.equal(f.name, 'email');
  assert.equal(f.type, 'text');
  assert.equal(f.required, false);
});

test('parseFieldDescriptor: with type and required', () => {
  const f = parseFieldDescriptor('age', 'number, required');
  assert.equal(f.type, 'number');
  assert.equal(f.required, true);
});

test('parseFieldDescriptor: fk preserves case', () => {
  const f = parseFieldDescriptor('customer_id', 'uuid, fk:Customer');
  assert.equal(f.fk, 'Customer');
});

test('parseFieldDescriptor: inline parens "name (type, req)"', () => {
  const f = parseFieldDescriptor('amount (decimal, required)');
  assert.equal(f.name, 'amount');
  assert.equal(f.type, 'decimal');
  assert.equal(f.required, true);
});

test('parseFieldList: comma list with parens', () => {
  const fs = parseFieldList('id, name, email (text, required)');
  assert.equal(fs.length, 3);
  assert.equal(fs[2].required, true);
});

test('parseActionList: crud and "all"', () => {
  assert.ok(parseActionList('crud').includes('crud'));
  assert.ok(parseActionList('all').includes('all'));
});

test('parseActionList: comma-separated', () => {
  assert.deepEqual(parseActionList('read, write, approve').sort(), ['approve', 'read', 'write']);
});

/* -------------------------------------------------------------------------- */
/*  asCreatorField — type label mapping                                        */
/* -------------------------------------------------------------------------- */

test('asCreatorField: maps generic types to canonical Creator labels', () => {
  assert.equal(asCreatorField({ name: 'a', type: 'text' }).type, 'Single Line');
  assert.equal(asCreatorField({ name: 'a', type: 'number' }).type, 'Number');
  assert.equal(asCreatorField({ name: 'a', type: 'decimal' }).type, 'Decimal');
  assert.equal(asCreatorField({ name: 'a', type: 'currency' }).type, 'Currency');
  assert.equal(asCreatorField({ name: 'a', type: 'datetime' }).type, 'Date-Time');
  assert.equal(asCreatorField({ name: 'a', type: 'boolean' }).type, 'Decision Box');
  assert.equal(asCreatorField({ name: 'a', type: 'enum' }).type, 'Dropdown');
});

test('asCreatorField: fk upgrades type to Single Select Lookup', () => {
  const f = asCreatorField({ name: 'cust', type: 'uuid', fk: 'Customer' });
  assert.equal(f.type, 'Single Select Lookup');
  assert.equal(f.lookup, 'Customer.ID');
});

/* -------------------------------------------------------------------------- */
/*  Apply: Forms, Reports, Pages, Workflows                                    */
/* -------------------------------------------------------------------------- */

test('applyCommands: addForm → field types are converted to Creator labels', () => {
  let s = stamp(emptyScope());
  s = applyCommands(s, parsePrompt('add form: Customer with fields: id (uuid), email (email), age (number)')).scope;
  assert.equal(s.forms.length, 1);
  const f = s.forms[0];
  assert.equal(f.name, 'Customer');
  assert.equal(f.fields[0].type, 'Auto Number');
  assert.equal(f.fields[1].type, 'Email');
  assert.equal(f.fields[2].type, 'Number');
});

test('applyCommands: addForm + addField + remove', () => {
  let s = stamp(emptyScope());
  const r1 = applyCommands(s, parsePrompt('add form: Customer with fields: id, name'));
  assert.equal(r1.scope.forms.length, 1);
  assert.equal(r1.scope.forms[0].fields.length, 2);
  assert.equal(r1.summary.applied.length, 1);

  const r2 = applyCommands(r1.scope, parsePrompt('add field to form Customer: email (text, required)'));
  assert.equal(r2.scope.forms[0].fields.length, 3);
  const email = r2.scope.forms[0].fields.find((f) => f.name === 'email');
  assert.equal(email.required, true);
  assert.equal(email.type, 'Single Line');

  const r3 = applyCommands(r2.scope, parsePrompt('remove form: Customer'));
  assert.equal(r3.scope.forms.length, 0);
});

test('applyCommands: rename form updates name AND displayName', () => {
  let s = stamp(emptyScope());
  s = applyCommands(s, parsePrompt('add form: Customer')).scope;
  s = applyCommands(s, parsePrompt('rename form: Customer to Client')).scope;
  assert.equal(s.forms[0].name, 'Client');
  assert.equal(s.forms[0].displayName, 'Client');
});

test('applyCommands: addReport binds baseForm to existing form', () => {
  let s = stamp(emptyScope());
  s = applyCommands(s, parsePrompt('add form: Customer')).scope;
  s = applyCommands(s, parsePrompt('add report: All_Customers from Customer')).scope;
  assert.equal(s.reports.length, 1);
  assert.equal(s.reports[0].baseForm, 'Customer');
});

test('applyCommands: addPage embeds existing forms and reports', () => {
  let s = stamp(emptyScope());
  s = applyCommands(s, parsePrompt('add form: Lead\nadd report: Hot_Leads from Lead')).scope;
  s = applyCommands(s, parsePrompt('add page: Sales_Home in section Sales embeds Form: Lead, Report: Hot_Leads')).scope;
  const p = s.pages[0];
  assert.deepEqual(p.embeddedForms, ['Lead']);
  assert.deepEqual(p.embeddedReports, ['Hot_Leads']);
  assert.equal(p.section, 'Sales');
});

test('applyCommands: duplicate add is a no-op (skipped)', () => {
  let s = stamp(emptyScope());
  s = applyCommands(s, parsePrompt('add form: Customer')).scope;
  const r2 = applyCommands(s, parsePrompt('add form: Customer'));
  assert.equal(r2.scope.forms.length, 1);
  assert.equal(r2.summary.skipped.length, 1);
});

test('applyCommands: unknown line becomes a fallback note on the right step', () => {
  const s = stamp(emptyScope());
  const r = applyCommands(s, parsePrompt('please add a really nice landing page', 'step3'));
  assert.equal(r.summary.fallbacks, 1);
  assert.equal(r.scope.notes.step3.length, 1);
  assert.match(r.scope.notes.step3[0], /landing page/);
});

/* -------------------------------------------------------------------------- */
/*  Apply: Lookups                                                             */
/* -------------------------------------------------------------------------- */

test('applyCommands: addLookup mirrors onto source form as a Lookup field', () => {
  let s = stamp(emptyScope());
  s = applyCommands(s, parsePrompt('add form: Customer\nadd form: Invoice')).scope;
  s = applyCommands(s, parsePrompt('add lookup: Invoice.customer_id -> Customer as single')).scope;
  assert.equal(s.lookups.length, 1);
  const inv = s.forms.find((f) => f.name === 'Invoice');
  const fld = inv.fields.find((x) => x.name === 'customer_id');
  assert.equal(fld.type, 'Single Select Lookup');
  assert.equal(fld.lookup, 'Customer.ID');
});

test('applyCommands: addLookup is rejected when target form is missing', () => {
  let s = stamp(emptyScope());
  s = applyCommands(s, parsePrompt('add form: Invoice')).scope;
  const r = applyCommands(s, parsePrompt('add lookup: Invoice.cust -> Customer as single'));
  assert.equal(r.scope.lookups.length, 0);
  assert.equal(r.summary.skipped.length, 1);
});

/* -------------------------------------------------------------------------- */
/*  Apply: Roles & Profiles                                                    */
/* -------------------------------------------------------------------------- */

test('applyCommands: addRole defaults parent to null', () => {
  let s = stamp(emptyScope());
  s = applyCommands(s, parsePrompt('add role: Viewer')).scope;
  assert.equal(s.roles.length, 1);
  assert.equal(s.roles[0].name, 'Viewer');
  assert.equal(s.roles[0].parent, null);
});

test('applyCommands: addProfile maps actions to Creator-enabled flags', () => {
  let s = stamp(emptyScope());
  s = applyCommands(s, parsePrompt('add form: Lead\nadd form: Customer')).scope;
  s = applyCommands(s, parsePrompt('add profile: Sales_Rep can read, write on Lead, Customer')).scope;
  const p = s.profiles[0];
  assert.equal(p.name, 'Sales_Rep');
  assert.equal(p.modulePermissions.length, 2);
  for (const m of p.modulePermissions) {
    assert.ok(m.enabled.includes('Tab'));
    assert.ok(m.enabled.includes('Viewall'));
    assert.ok(m.enabled.includes('Create'));
    assert.ok(m.enabled.includes('Modifyall'));
  }
});

/* -------------------------------------------------------------------------- */
/*  Apply: Custom Functions / Connections / Schedules / Public APIs            */
/* -------------------------------------------------------------------------- */

test('applyCommands: addCustomFunction', () => {
  let s = stamp(emptyScope());
  s = applyCommands(s, parsePrompt('add function: calcTotal returns decimal — Sums line items')).scope;
  assert.equal(s.customFunctions.length, 1);
  assert.equal(s.customFunctions[0].name, 'calcTotal');
  assert.equal(s.customFunctions[0].returnType, 'decimal');
  assert.equal(s.customFunctions[0].language, 'Deluge');
});

test('applyCommands: addConnection / addSchedule / addPublicAPI', () => {
  let s = stamp(emptyScope());
  s = applyCommands(
    s,
    parsePrompt(
      [
        'add connection: Stripe via apikey',
        'add schedule: nightly runs daily calls cleanup',
        'add api: GET /api/orders returns Order[]',
      ].join('\n')
    )
  ).scope;
  assert.equal(s.connections[0].service, 'Stripe');
  assert.equal(s.connections[0].authType, 'apikey');
  assert.equal(s.schedules[0].frequency, 'daily');
  assert.equal(s.schedules[0].calls, 'cleanup');
  assert.equal(s.publicAPIs[0].method, 'GET');
});

/* -------------------------------------------------------------------------- */
/*  Apply: NFRs / Application meta                                             */
/* -------------------------------------------------------------------------- */

test('applyCommands: addNfr / addAssumption / addOutOfScope', () => {
  let s = stamp(emptyScope());
  s = applyCommands(
    s,
    parsePrompt(
      [
        'add nfr: Performance — p95 < 500ms',
        'add nfr: Security — encrypt PII at rest',
        'add assumption: Single-tenant deployment',
        'add out of scope: Mobile app for v1',
      ].join('\n')
    )
  ).scope;
  assert.equal(s.nfrs.length, 2);
  assert.equal(s.assumptions.length, 1);
  assert.equal(s.outOfScope.length, 1);
});

test('applyCommands: setApplication / setTimezone / setEdition', () => {
  let s = stamp(emptyScope());
  s = applyCommands(s, parsePrompt('set application: ACME Sales')).scope;
  s = applyCommands(s, parsePrompt('set timezone: America/New_York')).scope;
  s = applyCommands(s, parsePrompt('set edition: flex')).scope;
  assert.equal(s.application.name, 'ACME Sales');
  assert.equal(s.meta.title, 'ACME Sales');
  assert.equal(s.application.timeZone, 'America/New_York');
  assert.equal(s.application.edition, 'flex');
});

test('parsePrompt: skips blanks and comment lines', () => {
  const r = parsePrompt(`
# header comment
// another comment

add form: Customer
   add form: Vendor
  `);
  assert.equal(r.actions.length, 2);
  assert.equal(r.fallbacks.length, 0);
});

/* -------------------------------------------------------------------------- */
/*  toIdent helper                                                             */
/* -------------------------------------------------------------------------- */

test('toIdent: converts "Sales Lead" → Sales_Lead', () => {
  assert.equal(toIdent('Sales Lead'), 'Sales_Lead');
  assert.equal(toIdent('Customer-Master'), 'CustomerMaster');
  assert.equal(toIdent('  weird  spaces  '), 'weird_spaces');
});
