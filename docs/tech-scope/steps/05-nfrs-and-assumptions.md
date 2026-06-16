# Step 5 — NFRs & Assumptions

> **Goal:** capture **non-functional** constraints, **Creator-platform
> assumptions** (edition, locale, governance limits), and explicitly call
> out what's **out of scope** so consultants and customers stay aligned.

## What this step contains

| Section | Notes |
|---|---|
| 🏗️ **Creator Platform Assumptions** | Locked-in app-level settings: edition, date format, time zone, governance defaults. |
| 📐 **Non-Functional Requirements** | Performance, Security, Scalability, Availability, Accessibility, Compliance. |
| 📋 **Assumptions** | Free-text BRD-derived `must` / `shall` / `should` sentences. |
| 🚫 **Out of Scope** | Sentences explicitly marked "out of scope" / "not in scope" / "will not be included". |

## Creator-platform assumptions (locked at app level)

These four settings appear at the top of every Creator `.ds` and shape how
records are stored and rendered. They live in `scope.application` and are
also exposed via the prompt DSL.

| Setting | Default | Purpose |
|---|---|---|
| `edition` | `professional` | One of `standard` · `professional` · `flex`. Drives governance limits, function counts, and licensing. |
| `dateFormat` | `dd-MMM-yyyy` | App-wide. Individual Date fields can override. |
| `timeZone` | `Asia/Kolkata` | App-wide. Schedules and time-based workflows respect this TZ. |
| `timeFormat` | `24-hr` | Or `12-hr`. |

### Edition cheat-sheet (governance defaults)

| Edition | Notes |
|---|---|
| **Standard** | Per-form record cap and lower function-execution quota. Best for departmental tools. |
| **Professional** | Higher record caps, more concurrent users, unlimited custom functions in most plans. The tool's default. |
| **Flex** | Pay-as-you-go consumption model — quote-based, used for high-volume / multi-tenant deployments. |

> The Tech Scope tool does **not** enumerate exact Creator quotas (these
> change). Use the placeholder line _"Default storage and compute
> governance limits per Creator edition apply."_ and link to the latest
> Zoho Creator pricing page in the customer-facing copy.

## NFR categories

The heuristic parser tags BRD sentences into one of these buckets:

| Category | Trigger words |
|---|---|
| **Performance** | `latency`, `response time`, `throughput`, `p95`, `SLA`, `seconds to respond` |
| **Security** | `encrypt`, `GDPR`, `HIPAA`, `PII`, `OAuth`, `JWT`, `TLS`, `SSL`, `RBAC` |
| **Scalability** | `scal*`, `concurrent users`, `throughput`, `records`, `volume`, `growth` |
| **Availability** | `uptime`, `99.x %`, `24x7`, `available* … of the time` |
| **Accessibility** | `WCAG`, `ARIA`, `screen reader` |
| **Compliance** | `audit`, `SOX`, `ISO 27001`, `SOC 2` |

Anything that contains a `must` / `shall` / `should` but doesn't match a
category becomes an **Assumption**. Anything mentioning "out of scope" /
"not in scope" / "will not be included" goes into the **Out of Scope**
list and is skipped from the other lists.

## Editing this step via the prompt DSL

```text
add nfr: Performance   — All list endpoints must respond within 500ms at p95.
add nfr: Security      — All PII must be encrypted at rest with AES-256.
add nfr: Availability  — Uptime target is 99.5% measured monthly.

add assumption: Single-tenant deployment in the customer's Zoho org.
add assumption: English-only UI for v1.

add out of scope: Native iOS / Android apps for v1.
add out of scope: SSO via SAML — OAuth-only for v1.

# Application-level meta
set application: ACME Procurement Portal
set timezone: America/New_York
set date format: MM/dd/yyyy
set edition: flex
```

## Worked example

```text
set edition: professional
set timezone: Asia/Kolkata

add nfr: Performance — Lead-list page renders in < 2 seconds with 50k records.
add nfr: Security — All e-signature uploads are stored in WorkDrive with AES-256.
add nfr: Compliance — Annual SOC 2 Type II audit logs must be exportable.

add assumption: Customer already owns Zoho One Professional licenses.
add assumption: Single time zone — Asia/Kolkata — for all users.

add out of scope: Mobile-app distribution via private MDM in v1.
add out of scope: Integration with the legacy SAP HANA data warehouse.
```

Produces a `Step 5` section that lists the four platform assumptions, then
three NFRs grouped by category, two free-text assumptions, and two clearly
labelled out-of-scope items.
