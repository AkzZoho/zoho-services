# 🌐 Shared Docs

> Knowledge that applies to **both** tools (DS Analyser and Tech Scope
> Creator). Anything that lives here is referenced from one or both
> tool-specific folders so it isn’t duplicated.

---

## Files

### Top-level

| File | Read it for |
|---|---|
| [`operating-principles.md`](./operating-principles.md) | How the AI assistant must reason and act on this project. **Read before any task.** |
| [`project-layout.md`](./project-layout.md) | Top-level repo layout and where each kind of artifact lives. |
| [`deployment-learnings.md`](./deployment-learnings.md) | 12 hard-won Catalyst deployment / CORS / build-time gotchas. **Read before every deploy.** |
| [`deluge-reference.md`](./deluge-reference.md) | Deluge language reference used by the DS Analyser code-walker and by Tech Scope’s Step 4 generator. |
| [`CHANGELOG.md`](./CHANGELOG.md) | Version history of the docs reorganisation + learnings updates. |

### Subfolders

| Folder | What’s in it |
|---|---|
| [`creator-kb/`](./creator-kb/) | **Zoho Creator construct reference** — one file per construct (forms, reports, pages, workflows, schedules, blueprints, batch workflows, functions, Deluge cheat-sheet). The factual “what is X in Creator” doc set. |
| [`creator-semantics/`](./creator-semantics/) | **Distilled domain learnings** — the rules our tools must obey when emitting or interpreting Creator artifacts. |

## `creator-semantics/` at a glance

| File | What it locks down |
|---|---|
| [`creator-semantics/form-field-types.md`](./creator-semantics/form-field-types.md) | Canonical field-type display names · Lookup detection rule · Subform exception · BRD-word → Creator-type mapping. |
| [`creator-semantics/base-forms.md`](./creator-semantics/base-forms.md) | The three system-level base forms (`Users`, `User_Roles`, `Email_Templates`) every Creator app must have, with locked schemas + DSL protection rules. |
| [`creator-semantics/universal-form-design-rules.md`](./creator-semantics/universal-form-design-rules.md) | Universal rules: no system timestamps, status over boolean, visible-first design, lookup over raw ID. |

## `creator-kb/` at a glance

| File | Construct |
|---|---|
| [`creator-kb/01-forms.md`](./creator-kb/01-forms.md) | Forms |
| [`creator-kb/02-reports.md`](./creator-kb/02-reports.md) | Reports |
| [`creator-kb/03-pages.md`](./creator-kb/03-pages.md) | Pages |
| [`creator-kb/04-workflows.md`](./creator-kb/04-workflows.md) | Workflows |
| [`creator-kb/05-schedules.md`](./creator-kb/05-schedules.md) | Schedules |
| [`creator-kb/06-blueprints.md`](./creator-kb/06-blueprints.md) | Blueprints |
| [`creator-kb/07-batch-workflows.md`](./creator-kb/07-batch-workflows.md) | Batch workflows |
| [`creator-kb/08-functions.md`](./creator-kb/08-functions.md) | Custom functions |
| [`creator-kb/09-deluge-cheatsheet.md`](./creator-kb/09-deluge-cheatsheet.md) | Deluge cheat-sheet |

---

## How `creator-kb/` differs from `creator-semantics/`

- **`creator-kb/`** — *factual reference*. “What is a Form? What field
  types exist? What are the 9 report types?” Use it to refresh memory
  about Creator itself.
- **`creator-semantics/`** — *project rules*. “How **must** our tools
  represent forms?” Use it whenever code emits or interprets Creator
  artifacts.

When the two ever conflict, **`creator-semantics/` wins** — because it
is the project’s applied policy, not an external reference.
