# Documentation — Master Index

> **One repository, two tools.** This `docs/` folder is split by audience so
> you can quickly find docs for the tool you’re working on without wading
> through the other one.

```
docs/
├── shared/        # Knowledge that applies to BOTH tools
├── ds-analyser/   # 🗂  Tool 1: Creator DS Analyser
└── tech-scope/    # 📐  Tool 2: Tech Scope Creator
```

---

## 🗂 Tool 1 — Creator DS Analyser

> Parses a `.ds` export and produces Application Breakdown, Schema graph,
> and Performance audit. Server-rendered (Catalyst Function + React SPA).

| Doc | What’s in it |
|---|---|
| [`ds-analyser/README.md`](./ds-analyser/README.md) | Tool index — start here. |
| [`ds-analyser/application.md`](./ds-analyser/application.md) | End-to-end application documentation: purpose, architecture, modules, API, security. |
| [`ds-analyser/architecture.md`](./ds-analyser/architecture.md) | Higher-level architecture diagrams + rationale. |
| [`ds-analyser/flowchart.md`](./ds-analyser/flowchart.md) | Functional flow + sequence diagrams (Mermaid). |

---

## 📐 Tool 2 — Tech Scope Creator

> Generates a Zoho Creator Technical Scope Document from a BRD in 5
> reviewable steps with a deterministic prompt-DSL. Client-only (React SPA).

| Doc | What’s in it |
|---|---|
| [`tech-scope/README.md`](./tech-scope/README.md) | Tool index — start here. |
| [`tech-scope/overview.md`](./tech-scope/overview.md) | Tool intent, tech stack, prompt-DSL, BRD-parser heuristics, gotchas. |
| [`tech-scope/forms-and-lookups.md`](./tech-scope/forms-and-lookups.md) | Non-negotiable rules for the Forms / Lookups output (Step 2). |
| [`tech-scope/steps/`](./tech-scope/steps/) | One file per wizard step (Application Flow, Data Model, Modules & Roles, APIs, NFRs). |

---

## 🌐 Shared (used by both tools)

> Domain knowledge, deployment, and assistant operating rules that aren’t
> specific to either tool.

| Doc | What’s in it |
|---|---|
| [`shared/README.md`](./shared/README.md) | Shared-docs index. |
| [`shared/operating-principles.md`](./shared/operating-principles.md) | How the AI assistant must reason and act on this project. |
| [`shared/project-layout.md`](./shared/project-layout.md) | Top-level repo layout — where each kind of artifact lives. |
| [`shared/deployment-learnings.md`](./shared/deployment-learnings.md) | Catalyst deploy / CORS / build-time env-var gotchas (12 hard-won lessons). |
| [`shared/deluge-reference.md`](./shared/deluge-reference.md) | Deluge language reference used by the code-description engine. |
| [`shared/creator-kb/`](./shared/creator-kb/) | Zoho Creator construct reference — forms, reports, pages, workflows, schedules, blueprints, batch workflows, functions, Deluge cheat-sheet. |
| [`shared/creator-semantics/`](./shared/creator-semantics/) | Distilled domain learnings — field-type vocabulary, base forms, universal form-design rules. |
| [`shared/CHANGELOG.md`](./shared/CHANGELOG.md) | Version history of the docs reorganisation + learnings updates. |

---

## How to use this folder

1. **Working on a tool?** Start at `ds-analyser/README.md` or
   `tech-scope/README.md`. Each one links only to the docs for that tool
   plus the few shared docs you need.
2. **Touching Creator semantics?** (field types, base forms, design rules)
   Read [`shared/creator-semantics/`](./shared/creator-semantics/) first —
   those rules apply to **both** tools and override anything tool-specific.
3. **Deploying or debugging a 404?** Read
   [`shared/deployment-learnings.md`](./shared/deployment-learnings.md) —
   most production bugs we’ve hit are already captured there.
4. **Adding a new learning?** Put it in the **most specific** folder; if
   no file fits, create a new one and link it from the relevant
   `README.md`. Bump
   [`shared/CHANGELOG.md`](./shared/CHANGELOG.md) in the same commit.
