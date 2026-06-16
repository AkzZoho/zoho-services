# Creator Semantics — Distilled Domain Learnings

> The rules our tools (DS Analyser **and** Tech Scope Creator) must
> obey whenever they emit or interpret Zoho Creator artifacts. These
> were originally extracted from the now-removed `samples/*.ds` corpus
> and are the canonical record of what we learnt.

| File | What it locks down |
|---|---|
| [`form-field-types.md`](./form-field-types.md) | Canonical field-type display names · Lookup detection rule · Subform exception · BRD-word → Creator-type mapping. |
| [`base-forms.md`](./base-forms.md) | The three system-level base forms (`Users`, `User_Roles`, `Email_Templates`) every Creator app must have, with locked schemas + DSL protection rules. |
| [`universal-form-design-rules.md`](./universal-form-design-rules.md) | Universal design rules: no system timestamps, status over boolean, visible-first design, lookup over raw ID. |

## When to read this folder

- ✏️ **DS Analyser** — when changing the parser, schema view, or any
  code that classifies fields. The display-name vocabulary lives here.
- 🧱 **Tech Scope Creator** — when changing how Step 2 (Data Model)
  emits forms / fields / lookups, or when authoring base-form
  scaffolding. The form-design rules live here.

## When this folder wins over `creator-kb/`

`creator-kb/` is **factual reference** about Creator itself. This folder
is **applied project policy**. When they ever conflict (rare),
**`creator-semantics/` is authoritative** because it captures decisions
specific to how *our* tools must behave.
