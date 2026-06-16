# 📐 Tech Scope Creator — Docs

> **Tool 2 of 2** in this repository. Generates a Zoho Creator
> **Technical Scope Document** from an uploaded BRD in **5 reviewable
> steps**, with a deterministic **prompt-DSL** so each step can be
> adjusted without any LLM API key.

This folder holds **only** the docs that are specific to this tool.
Cross-cutting material (Creator semantics, deployment, operating
principles) lives in [`../shared/`](../shared/README.md) so it isn’t
duplicated between tools.

---

## Files

| File | Read it for |
|---|---|
| [`SKILL.md`](./SKILL.md) | **Agent-facing capability guide** — when to use this skill, inputs, how to invoke (wizard + optional AI routes), the prompt-DSL, outputs, troubleshooting. **Start here to *use* the tool.** |
| [`overview.md`](./overview.md) | Tool intent · locked tech stack · prompt-DSL grammar · BRD-parser heuristics · gotchas · round-trip plan with DS Analyser. **Start here for any code change in this tool.** |
| [`forms-and-lookups.md`](./forms-and-lookups.md) | Non-negotiable rules for how Forms and Lookups must appear in the generated scope (every dropdown is its own form, etc.). |
| [`steps/`](./steps/) | One file per wizard step. Each step file documents the entities surfaced, the prompt-DSL ops that target it, and the on-screen rendering. |

## The 5 steps

| # | Step | File |
|---|---|---|
| 1 | Application Flow (Forms · Reports · Pages · Workflows) | [`steps/01-application-flow.md`](./steps/01-application-flow.md) |
| 2 | Data Model (Forms with canonical Creator field types · Lookups) | [`steps/02-data-model.md`](./steps/02-data-model.md) |
| 3 | Modules & Roles (Org hierarchy · `share_settings` · Page Access) | [`steps/03-modules-and-roles.md`](./steps/03-modules-and-roles.md) |
| 4 | APIs & Integrations (Custom functions · Connections · Schedules · REST) | [`steps/04-apis-and-integrations.md`](./steps/04-apis-and-integrations.md) |
| 5 | NFRs & Assumptions (Edition · governance limits · Out-of-Scope) | [`steps/05-nfrs-and-assumptions.md`](./steps/05-nfrs-and-assumptions.md) |

## Where the source lives

| Layer | Path |
|---|---|
| Frontend | [`client/src/tools/tech-scope/`](../../client/src/tools/tech-scope/) |
| Backend | _None — this tool is fully client-side, by design (no API keys required)._ |

## Shared docs you’ll likely also need

- [`../shared/creator-semantics/form-field-types.md`](../shared/creator-semantics/form-field-types.md)
  — canonical Creator field-type display names. The Tech Scope output
  vocabulary mirrors this so a future BRD → Tech Scope → built `.ds`
  → DS Analyser round-trip stays diffable.
- [`../shared/creator-semantics/base-forms.md`](../shared/creator-semantics/base-forms.md)
  — the three system-level forms (`Users`, `User_Roles`,
  `Email_Templates`) that **every** generated scope must include.
- [`../shared/creator-semantics/universal-form-design-rules.md`](../shared/creator-semantics/universal-form-design-rules.md)
  — universal rules every generated form must obey.
- [`../shared/creator-kb/`](../shared/creator-kb/)
  — Creator construct reference (used to validate generated scopes).
- [`../shared/deluge-reference.md`](../shared/deluge-reference.md)
  — Deluge syntax used inside Step 4 (custom functions).
