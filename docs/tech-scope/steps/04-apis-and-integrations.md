# Step 4 — Functions, Connections & APIs

> **Goal:** capture every **non-form** moving part of the Creator app:
> Deluge custom functions, third-party Connections, time-based Schedules,
> and any **public REST endpoints** the app exposes.

## What this step contains

| Section | Creator construct | `.ds` block |
|---|---|---|
| λ **Custom Functions** | Reusable Deluge code. | `functions { Deluge { void ns.foo() { … } } }` |
| 🔌 **Connections** | OAuth / API-key bindings to a third-party service. | (Stored separately — referenced from Deluge as `invokeurl … connection: "X"`.) |
| ⏰ **Schedules** | Time-based triggers that fire a Deluge function. | `workflow { schedule { Daily_Cleanup { … } } }` |
| 🌐 **Public REST APIs** | Records exposed for external systems via Creator's "Publish as REST" feature. | (Configured per-report; we capture intent only.) |

## Custom Functions (Deluge)

| Field | Notes |
|---|---|
| `name` | Identifier — must match a `void` / `string` / etc. signature in `functions { Deluge { … } }`. |
| `namespace` | Optional `ns.` prefix the function lives under. |
| `returnType` | `void` · `string` · `number` · `decimal` · `map` · `list` · `boolean` · `<FormName>` (record) |
| `params` | Array of `{ name, type }`. |
| `purpose` | One-line BRD-derived description. |

## Connections — third-party services

The heuristic parser auto-detects mentions of a curated list of services
(see `KNOWN_SERVICES` in `heuristics.js`):

> Zoho CRM · Zoho Books · Zoho Desk · Zoho People · Zoho Inventory ·
> Zoho Projects · Zoho Analytics · Zoho Mail · Zoho Sign ·
> Zoho WorkDrive · Salesforce · HubSpot · Slack · Microsoft Teams ·
> Office 365 · OneDrive · Google Drive · Google Calendar · Gmail ·
> Stripe · PayPal · Razorpay · Twilio · SendGrid · Mailchimp · AWS S3 ·
> Dropbox · DocuSign · QuickBooks · Xero · SAP · Oracle ·
> ServiceDesk Plus · ServiceNow · Jira · GitHub · GitLab · Bitbucket

Each Connection has:

| Field | Values |
|---|---|
| `service` | Name of the SaaS. |
| `authType` | `oauth2` · `apikey` · `basic` |
| `purpose` | Free text. |

## Schedules

| Field | Notes |
|---|---|
| `name` | Identifier. |
| `frequency` | `hourly` · `daily` · `weekly` · `monthly` · `cron` |
| `cron` | If `frequency = cron`, the cron expression. |
| `calls` | Name of the Custom Function (or named Workflow) the schedule invokes. |

## Public REST APIs

These are **outbound** endpoints from the Creator app — not Deluge calls
to Zoho's backend. They map to "Publish as REST" on a Report or Form.

| Field | Notes |
|---|---|
| `method` | `GET` · `POST` · `PUT` · `PATCH` · `DELETE` |
| `path` | The relative path. |
| `baseForm` | Which Form's records the endpoint reads/writes. |
| `auth` | `none` · `apikey` · `oauth2` |
| `purpose` | Free text. |

## Editing this step via the prompt DSL

```text
add function: calcInvoiceTotal returns decimal — Sums all line items
add function: dispatchEmail returns void

add connection: Stripe via apikey — Process card payments
add connection: Slack via oauth2 — Post alerts to #ops

add schedule: nightly_cleanup runs daily calls cleanupTempRecords
add schedule: weekly_digest   runs weekly calls sendDigestEmail

add api: GET  /api/customers from Customer returns Customer[]
add api: POST /api/orders    from Order

# Legacy aliases (still work)
add integration: HubSpot via OAuth
```

## A worked example

```text
add form: Invoice
add function: calcInvoiceTotal returns decimal — Sums all line items
add connection: Stripe via apikey — Process card payments
add schedule: hourly_invoice_sync runs hourly calls syncFromStripe
add api: POST /api/invoices/webhook from Invoice
```

Produces, in the rendered Tech Scope:

| Function | Returns | Purpose |
|---|---|---|
| `calcInvoiceTotal` | decimal | Sums all line items |

| Service | Auth | Purpose |
|---|---|---|
| Stripe | apikey | Process card payments |

| Schedule | Frequency | Calls |
|---|---|---|
| `hourly_invoice_sync` | hourly | `syncFromStripe` |

| Method | Path | Base Form | Auth |
|---|---|---|---|
| `POST` | `/api/invoices/webhook` | `Invoice` | apikey |
