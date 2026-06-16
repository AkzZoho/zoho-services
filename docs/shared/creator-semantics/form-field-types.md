# Form Field Type Naming (Display Labels)

> **Why this matters.** When a `.ds` file is inspected, every form field
> carries an internal type token (lowercase / identifier-style). For all
> **user-facing output** — reports, UI labels, analysis summaries,
> generated docs, CSV/JSON exports meant for humans — the assistant MUST
> translate the internal token to the canonical **Type Name** below.
> Every Type Name is written with its **first letter capitalised** (and
> each word capitalised for multi-word names).

> **Single source of truth in code.**
> [`client/src/tools/ds-analyser/lib/fieldTypes.js`](../../client/src/tools/ds-analyser/lib/fieldTypes.js)
> — `formatFieldType()`. Anything that displays a field type goes
> through that helper. The Tech Scope Creator’s `asCreatorField()`
> mapper points at the same module.

---

## 1. Standard field types

| Internal token (in `.ds`) | Canonical Type Name (use this) |
|---------------------------|--------------------------------|
| `text`                    | **Single Line**                |
| `picklist`                | **Dropdown**                   |
| `radiobuttons`            | **Radio**                      |
| `list`                    | **Multi-Select**               |
| `checkboxes`              | **CheckBox**                   |
| `checkbox`                | **Decision Box**               |
| `USD`                     | **Currency**                   |
| `grid`                    | **Subform**                    |

> ⚠️ Note the two distinct tokens `checkboxes` (plural → **CheckBox**)
> vs `checkbox` (singular → **Decision Box**). These are **different
> field types** in Creator and must never be collapsed into one.

## 2. Lookup fields (cardinality matters)

If a field is a **Lookup** (i.e. it references another Form/record),
the Type Name depends on cardinality. In Creator `.ds`, a lookup is
expressed as a base field type (`picklist` or `list`) **plus** a
`values = OtherForm.Field` reference inside the field block — there is
**no** dedicated `type = lookup` token. Detection rule:

| `.ds` shape                                      | Canonical Type Name      |
|--------------------------------------------------|--------------------------|
| `type = picklist` **+** `values = Form.Field`    | **Single Select Lookup** |
| `type = list`     **+** `values = Form.Field`    | **Multi-Select Lookup**  |

> ⚠️ **Subform exception.** `type = grid` fields also carry a
> `values = Form.Field` reference (the embedded subform target), but
> they are **Subforms, not Lookups**. Always resolve `grid` →
> **Subform** *before* applying the lookup upgrade rule.

> Without a `values = Form.Field` reference, `picklist` stays
> **Dropdown** and `list` stays **Multi-Select**.

## 3. Generic-word → Creator label (Tech Scope Creator BRD parser)

When a BRD uses generic English words instead of `.ds` tokens, the
Tech Scope Creator’s heuristic parser uses this expanded mapping:

| Generic word in BRD                  | Canonical Creator label                    |
|--------------------------------------|--------------------------------------------|
| `text`, `string`                     | **Single Line**                            |
| `longtext`, `multiline`              | **Multi Line**                             |
| `number`, `int`, `integer`           | **Number**                                 |
| `decimal`, `float`, `double`         | **Decimal**                                |
| `currency`, `money`, `usd`           | **Currency**                               |
| `percent`                            | **Percent**                                |
| `date`, `datetime`, `time`           | **Date** / **Date-Time** / **Time**        |
| `email`, `phone`, `url`              | **Email** / **Phone** / **URL**            |
| `boolean`, `bool`                    | **Decision Box**                           |
| `enum`, `select`, `dropdown`         | **Dropdown**                               |
| `multiselect`                        | **Multi-Select**                           |
| `uuid`, `auto`                       | **Auto Number**                            |
| `fk:Form`                            | **Single Select Lookup** (`Form.ID`)       |
| `fk:Form` + `multi`                  | **Multi-Select Lookup**                    |
| `subform`                            | **Subform**                                |
| `file`, `image`                      | **File Upload** / **Image**                |

## 4. Where to apply this

**Applicable when** producing any human-readable output that names a
form field’s type — inspection reports, diffs, summaries, rule
violations, generated documentation, UI chips/badges, CSV/JSON exports
meant for humans.

**Not applicable when** writing back into the `.ds` file itself, or
emitting machine-to-machine payloads that must preserve the original
lowercase internal token (e.g. round-tripping). In those cases keep the
original token verbatim.

## 5. Conventions

- Capitalise the **first letter of every word** in the Type Name
  (e.g. `Single Line`, not `single line`; `Multi-Select`, not
  `multi-select`).
- Preserve the hyphen in `Multi-Select` / `Multi-Select Lookup`.
- Preserve the internal casing of `CheckBox` (capital B) — it is the
  Creator-standard label, not `Checkbox`.
- If an unknown token is encountered, **do not guess**. Fall back to
  the raw token, surface it as an unknown type, and extend this file
  before shipping the fix.

## 6. UI behaviour

In `AppOverview.jsx` the Fields table shows the canonical label and
keeps the raw internal token as a hover tooltip for debuggability.
Other tables and exports must do the same.
