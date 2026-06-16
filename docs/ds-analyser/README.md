# 🗂 Creator DS Analyser — Docs

> **Tool 1 of 2** in this repository. Parses a Zoho Creator `.ds` export
> and produces three views — Application Breakdown, Schema graph, and
> Performance audit — without any LLM dependency for the core flow.

This folder holds **only** the docs that are specific to this tool.
Cross-cutting material (Creator semantics, Deluge, deployment, operating
principles) lives in [`../shared/`](../shared/README.md) so it isn’t
duplicated between tools.

---

## Files

| File | Read it for |
|---|---|
| [`SKILL.md`](./SKILL.md) | Agent-facing capability guide — when to use the skill, inputs/outputs, exact invocation (`POST /api/inspect`), config, and troubleshooting. **Start here to *use* the tool.** |
| [`application.md`](./application.md) | The full application documentation — what the tool does, why, architecture, modules, API contract, security posture, change-log. **Start here for any code change in this tool.** |
| [`architecture.md`](./architecture.md) | Higher-level request-flow diagram + design rationale (router pattern, rules-as-MD, etc.). |
| [`flowchart.md`](./flowchart.md) | Functional flow chart, sequence diagrams (Mermaid), error/fallback paths, frontend state machine. |

## Where the source lives

| Layer | Path |
|---|---|
| Frontend | [`client/src/tools/ds-analyser/`](../../client/src/tools/ds-analyser/) |
| Backend (Catalyst Function) | [`functions/ds-analyzer/`](../../functions/ds-analyzer/) |
| Editable runtime rules | [`rules/`](../../rules/) — `ds-parser-rules.md`, `Performance_Matrix.md`, `llm-prompt-rules.md` |

## Shared docs you’ll likely also need

- [`../shared/creator-semantics/form-field-types.md`](../shared/creator-semantics/form-field-types.md)
  — canonical Creator field-type display names used by the parser.
- [`../shared/deluge-reference.md`](../shared/deluge-reference.md)
  — Deluge statement → English mapping used by the workflow code-walker.
- [`../shared/deployment-learnings.md`](../shared/deployment-learnings.md)
  — every deploy / CORS / build-time gotcha. Read **before** committing.
- [`../shared/creator-kb/`](../shared/creator-kb/)
  — Creator construct reference (forms, reports, pages, workflows, …).
