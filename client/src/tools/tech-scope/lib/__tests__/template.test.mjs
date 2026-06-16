/**
 * Unit tests for markdown templates and Mermaid generators (Creator format).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderStep1,
  renderStep2,
  renderStep3,
  renderStep4,
  renderStep5,
  renderFullDocument,
} from '../template.js';
import { buildFlowchart, buildErDiagram } from '../mermaid.js';
import { emptyScope, stamp } from '../scope.js';

/**
 * A representative Creator-shaped fixture mirroring what
 * `buildTechnicalScope` in the DS Analyser produces.
 */
function fixture() {
  const s = stamp(emptyScope());
  s.meta.title = 'ACME Portal';
  s.application.name = 'ACME_Portal';
  s.application.timeZone = 'Asia/Kolkata';
  s.application.edition = 'professional';

  s.forms = [
    {
      name: 'Customer',
      displayName: 'Customer Master',
      purpose: 'Stores customer profiles',
      fields: [
        { name: 'Name', displayName: 'Name', type: 'Single Line', required: true, unique: false },
        { name: 'Email', displayName: 'Email', type: 'Email', required: true, unique: true },
      ],
      actionEvents: ['on add', 'on edit'],
    },
    {
      name: 'Invoice',
      displayName: 'Invoice',
      purpose: '',
      fields: [
        { name: 'Amount', displayName: 'Amount', type: 'Currency', required: true },
        { name: 'Customer_ref', displayName: 'Customer', type: 'Single Select Lookup', lookup: 'Customer.ID' },
      ],
      actionEvents: ['on add', 'on edit'],
    },
  ];

  s.reports = [
    { name: 'All_Customers', displayName: 'All Customers', type: 'list', baseForm: 'Customer', columns: ['Name', 'Email'], customActions: ['Send Welcome'], hidden: false },
    { name: 'Pipeline', displayName: 'Pipeline', type: 'kanban', baseForm: 'Invoice', columns: [], customActions: [], hidden: false },
  ];

  s.pages = [
    { name: 'Home', displayName: 'Home', section: 'Default', embeddedForms: [], embeddedReports: ['All_Customers'], hasScript: false },
    { name: 'Sales_Home', displayName: 'Sales Home', section: 'Sales', embeddedForms: ['Invoice'], embeddedReports: ['Pipeline'], hasScript: true },
  ];

  s.workflows = [
    { name: 'Approve_Invoice', displayName: 'Approve Invoice', scope: 'form', type: 'workflow', form: 'Invoice', event: 'on add', actionKinds: ['email', 'updateField'], description: '' },
  ];

  s.lookups = [
    { from: 'Invoice', field: 'Customer_ref', to: 'Customer', kind: 'single' },
  ];

  s.roles = [{ name: 'Sales Manager', description: 'Manages reps', parent: 'Director' }];

  s.profiles = [
    {
      name: 'Sales_Rep',
      description: 'Standard sales-rep permissions',
      type: 'standard',
      modulePermissions: [
        {
          form: 'Customer',
          enabled: ['Tab', 'Viewall', 'Create', 'Modifyall'],
          allFieldsVisible: true,
          reportPermissions: [{ report: 'All_Customers', actions: ['View'] }],
        },
      ],
    },
  ];

  s.customFunctions = [
    { name: 'calcInvoiceTotal', namespace: '', returnType: 'decimal', params: [{ name: 'inv', type: 'Invoice' }], purpose: 'Sums line items', language: 'Deluge' },
  ];

  s.connections = [{ service: 'Stripe', authType: 'apikey', purpose: 'Process card payments' }];

  s.schedules = [{ name: 'nightly_cleanup', frequency: 'daily', cron: null, calls: 'cleanup' }];

  s.publicAPIs = [{ method: 'GET', path: '/api/customers', baseForm: 'Customer', auth: 'apikey', purpose: 'List customers' }];

  s.nfrs = [{ category: 'Performance', statement: 'p95 < 500ms' }];
  s.assumptions = ['English-only UI for v1'];
  s.outOfScope = ['Mobile app'];

  return s;
}

/* -------------------------------------------------------------------------- */
/*  Step renderers                                                             */
/* -------------------------------------------------------------------------- */

test('renderStep1: lists Forms · Reports · Pages · Workflows + Mermaid block', () => {
  const md = renderStep1(fixture());
  assert.match(md, /## Step 1 — Application Flow/);
  assert.match(md, /\*\*Application:\*\* `ACME_Portal`/);
  // Forms section uses canonical Creator labels
  assert.match(md, /### 📝 Forms/);
  assert.match(md, /\| `Customer` \| Customer Master \|/);
  // Reports
  assert.match(md, /### 📊 Reports/);
  assert.match(md, /\| `All_Customers` \| list \| `Customer` \|/);
  assert.match(md, /\| `Pipeline` \| kanban \|/);
  // Pages grouped by section
  assert.match(md, /\*\*Section: Sales\*\*/);
  assert.match(md, /Sales Home/);
  // Workflows
  assert.match(md, /\| `Approve_Invoice` \| form \| `Invoice` \| on add \|/);
  // Diagram
  assert.match(md, /```mermaid\nflowchart TD/);
});

test('renderStep2: per-form field tables + Lookups + ER diagram', () => {
  const md = renderStep2(fixture());
  assert.match(md, /## Step 2 — Data Model/);
  // Per-form heading
  assert.match(md, /#### `Customer` — Customer Master/);
  // Field type column shows canonical Creator labels
  assert.match(md, /Single Line/);
  assert.match(md, /Email/);
  assert.match(md, /Currency/);
  assert.match(md, /Single Select Lookup/);
  // Lookups table
  assert.match(md, /### Lookups & Relationships/);
  assert.match(md, /\| `Invoice` \| `Customer_ref` \| `Customer` \| single \|/);
  // ER diagram
  assert.match(md, /```mermaid\nerDiagram/);
});

test('renderStep3: Roles + Profiles + Page Access', () => {
  const md = renderStep3(fixture());
  assert.match(md, /### 👥 Roles/);
  assert.match(md, /\| Sales Manager \| Director \|/);
  assert.match(md, /### 🛡️ Permission Profiles/);
  assert.match(md, /#### Sales_Rep/);
  // module permissions table
  assert.match(md, /\| `Customer` \| Tab, Viewall, Create, Modifyall \|/);
  assert.match(md, /### 🖥️ Page Access/);
});

test('renderStep4: Custom Functions, Connections, Schedules, Public APIs', () => {
  const md = renderStep4(fixture());
  assert.match(md, /### λ Custom Functions/);
  assert.match(md, /`calcInvoiceTotal`/);
  assert.match(md, /Sums line items/);
  assert.match(md, /### 🔌 Connections/);
  assert.match(md, /Stripe \| apikey/);
  assert.match(md, /### ⏰ Schedules/);
  assert.match(md, /`nightly_cleanup` \| daily/);
  assert.match(md, /### 🌐 Public REST APIs/);
  assert.match(md, /`GET` \| `\/api\/customers`/);
});

test('renderStep5: NFRs, Assumptions, Out-of-Scope, Edition assumption', () => {
  const md = renderStep5(fixture());
  assert.match(md, /\*\*Edition:\*\* professional/);
  assert.match(md, /\*\*Performance\*\*/);
  assert.match(md, /p95 < 500ms/);
  assert.match(md, /English-only UI for v1/);
  assert.match(md, /Mobile app/);
});

test('renderFullDocument: contains all 5 steps + Creator-format heading', () => {
  const md = renderFullDocument(fixture());
  assert.match(md, /# Technical Scope — ACME_Portal/);
  assert.match(md, /Output format: \*\*Zoho Creator\*\*/);
  assert.match(md, /Table of Contents/);
  for (const n of [1, 2, 3, 4, 5]) {
    assert.match(md, new RegExp(`## Step ${n} —`));
  }
});

test('renderFullDocument: empty scope still renders without throwing', () => {
  const md = renderFullDocument(stamp(emptyScope()));
  assert.match(md, /Untitled Creator App/);
  assert.match(md, /No forms detected/);
});

/* -------------------------------------------------------------------------- */
/*  Mermaid generators                                                         */
/* -------------------------------------------------------------------------- */

test('buildFlowchart: produces Creator-flavoured nodes (Form / Report / Page / Workflow)', () => {
  const src = buildFlowchart(fixture());
  assert.match(src, /^flowchart TD/);
  // Forms (rectangles)
  assert.match(src, /form_Customer\["📝 Customer Master"\]/);
  // Reports (parallelogram)
  assert.match(src, /rpt_All_Customers\[\/.*All Customers/);
  // Pages (hexagon) inside section subgraphs
  assert.match(src, /subgraph sec_Sales/);
  assert.match(src, /page_Sales_Home\{\{"🖥️ Sales Home"\}\}/);
  // Workflow (diamond) with edge labelled by event
  assert.match(src, /wf_Approve_Invoice\{"⚙️ Approve Invoice"\}/);
  assert.match(src, /-->\|on add\|/);
  // Schedule + Custom Function nodes
  assert.match(src, /sch_nightly_cleanup/);
  assert.match(src, /fn_calcInvoiceTotal/);
});

test('buildFlowchart: empty scope yields placeholder', () => {
  const src = buildFlowchart(stamp(emptyScope()));
  assert.match(src, /No forms, reports, pages or workflows defined yet/);
});

test('buildErDiagram: types mapped, lookups draw the relationship', () => {
  const src = buildErDiagram(fixture());
  assert.match(src, /^erDiagram/);
  assert.match(src, /Customer \{/);
  // Single-select lookup ⇒ "}o--||"
  assert.match(src, /\}o--\|\|/);
});

test('buildErDiagram: safeId guards against problematic names', () => {
  const s = stamp(emptyScope());
  s.forms = [
    { name: '2 Stage Approval', displayName: '2 Stage Approval', fields: [{ name: 'id', type: 'Auto Number' }] },
  ];
  const src = buildErDiagram(s);
  assert.match(src, /_2_Stage_Approval/);
});

test('renderStep3: notes appended via fallback show up', () => {
  const s = fixture();
  s.notes.step3 = ['Approval committee meets monthly'];
  const md = renderStep3(s);
  assert.match(md, /### 📝 Notes/);
  assert.match(md, /Approval committee meets monthly/);
});
