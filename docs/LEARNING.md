# Learning & Rules — Sample-Driven Development

> This file is the **single source of truth** for how the assistant must reason
> and act on the `Creator - DS Analyser` project. It exists so we do NOT have
> to re-read the large `.ds` sample files on every interaction (they consume
> too many tokens). All future analyses must consult this file first.

---

## 1. Governing Rules (User-Defined)

These rules are **non-negotiable**. They override any default assistant
behavior.

1. **Sample-only scope.** Do not do anything that is not represented in the
   sample `.ds` files inside `samples/`. If a requested change has no
   precedent or pattern in the samples, it must NOT be implemented.
2. **Sample-driven changes.** Every change the user asks for must be
   justified by (and modeled after) a pattern that already exists in the
   samples.
3. **Learning file allowed.** A learning MD file (this file) may be created
   and updated to capture distilled knowledge about the samples. This is the
   **only** artifact permitted to be written outside of strict sample-backed
   changes.
4. **Think & suggest freely — but don’t act outside learning.** The
   assistant may reason, analyze, and suggest ideas that go beyond the
   samples, but must not make code/file changes for anything that isn’t
   backed by the samples. Suggestions are advisory only.
5. **Don’t re-read the samples repeatedly.** The `.ds` files are very large.
   Do not open them on every task. Instead, consult this learning file. Only
   re-read a specific sample when:
   - This learning file lacks the necessary detail, AND
   - The user explicitly asks for a deeper analysis, OR
   - A suggested change requires verifying a specific pattern.
6. **No extras.** Do not add features, utilities, abstractions, files, or
   behavior that are not present in the samples.

---

## 2. Operating Procedure (How the assistant will work)

For every user request the assistant will:

1. **Consult this file first** to decide whether the request is in-scope.
2. **Classify the request**:
   - **In-scope** → A matching pattern is documented below → proceed.
   - **Unknown** → No matching pattern documented → read the *minimum
     necessary slice* of the relevant sample(s), update this file with the
     new learning, then proceed.
   - **Out-of-scope** → Contradicts the samples or has no precedent →
     refuse to implement; offer a suggestion only.
3. **Prefer targeted reads** (symbol lookup, line ranges, grep) over full
   file reads when a sample must be consulted.
4. **Record new learnings** in §4 below whenever a sample is inspected, so
   the next task doesn’t need to re-read it.
5. **Report** what was done, what was skipped, and why (with reference to
   the rule number above).

---

## 3. Known Project Layout

Captured from directory listing only (no `.ds` file contents read yet).

- `samples/` — Reference `.ds` files. **Treat as read-only ground truth.**
  - `Help_-_IOWA.ds`
  - `Itron Access Manager.ds`
  - `Procurement BSL.ds` *(very large — ~4.8 MB)*
  - `Property_Management.ds` *(large — ~3.3 MB)*
  - `SCPH_ERP.ds` *(large — ~2.5 MB)*
  - `St Joseph School ERP.ds`
  - `test.ds` *(tiny, likely placeholder)*
  - `README.md`
- `client/` — Front-end code.
- `functions/` — Catalyst functions / back-end handlers.
- `rules/` — Rule definitions (to be analyzed on demand).
- `docs/` — Architecture and this learning file.
- `catalyst.json`, `package.json` — Project manifests.

> ⚠️ Because of the size of the `.ds` samples, always prefer `grep` /
> targeted line-range reads instead of loading whole files.

---

## 4. Sample Pattern Catalog *(to be filled as we learn)*

This section grows over time. Each entry should record:

- **Pattern name**
- **Where it appears** (sample file + approximate line range)
- **Shape / signature** (minimal skeleton)
- **When to use it**
- **When NOT to use it**

### 4.1 Patterns Learned So Far

#### Form Field Type Naming (Display Labels)
- Source(s): User-defined rule (v2, captured from Creator Form field vocabulary)
- Summary: When a Form (or Subform) is inspected inside a `.ds` file, each
  field carries an internal type token (lowercase / identifier-style). For
  **all user-facing output** — reports, UI labels, analysis summaries,
  generated docs — the assistant MUST translate the internal token to the
  canonical **Type Name** below. Every Type Name is written with its **first
  letter capitalised** (and each word capitalised for multi-word names).

##### Canonical mapping — standard field types

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

> ⚠️ Note the two distinct tokens `checkboxes` (plural → **CheckBox**) vs
> `checkbox` (singular → **Decision Box**). These are **different field
> types** in Creator and must never be collapsed into one.

##### Canonical mapping — Lookup fields

If a field is a **Lookup** (i.e. it references another Form/record), the
Type Name depends on cardinality. In Creator `.ds`, a lookup is expressed
as a base field type (`picklist` or `list`) **plus** a `values =
OtherForm.Field` reference inside the field block — there is no dedicated
`type = lookup` token. Detection rule:

| `.ds` shape                                          | Canonical Type Name      |
|------------------------------------------------------|--------------------------|
| `type = picklist` **+** `values = Form.Field`        | **Single Select Lookup** |
| `type = list`     **+** `values = Form.Field`        | **Multi-Select Lookup**  |

> ⚠️ **Subform exception.** `type = grid` fields also carry a `values =
> Form.Field` reference (the embedded subform target), but they are
> **Subforms, not Lookups**. Always resolve `grid` → **Subform** *before*
> applying the lookup upgrade rule.

> Without a `values = Form.Field` reference, `picklist` stays **Dropdown**
> and `list` stays **Multi-Select**.

- Applicable when: Producing any human-readable output that names a Form
  field's type — inspection reports, diffs, summaries, rule violations,
  generated documentation, UI chips/badges, CSV/JSON exports meant for
  humans.
- Not applicable when: Writing back into the `.ds` file itself, or emitting
  machine-to-machine payloads that must preserve the original lowercase
  internal token (e.g. round-tripping). In those cases keep the original
  token verbatim.
- Notes / gotchas:
  - Always capitalise the **first letter of every word** in the Type Name
    (e.g. `Single Line`, not `single line`; `Multi-Select`, not
    `multi-select`).
  - Preserve the hyphen in `Multi-Select` / `Multi-Select Lookup`.
  - Preserve the internal casing of `CheckBox` (capital B) — it is the
    Creator-standard label, not `Checkbox`.
  - If the assistant encounters a token **not listed above**, do not guess.
    Fall back to the raw token and flag it as an unknown type so this
    section can be extended.

### 4.2 Template for New Entries

```
#### <Pattern Name>
- Source(s): <sample file> @ lines <a>-<b>
- Summary: <1–2 line description>
- Skeleton:
    <minimal DS snippet copied/adapted from the sample>
- Applicable when: <criteria>
- Not applicable when: <criteria>
- Notes / gotchas: <any>
```

---

## 5. Out-of-Scope Ideas (Suggestions Only — Do NOT Implement)

Use this section to park ideas that *might* be useful but are **not** backed
by the samples. These remain suggestions unless the user explicitly approves
and a sample pattern is later found or added.

_(empty)_

---

## 6. Change Log for this File

- **v1** — Initial creation. Captured governing rules, operating procedure,
  and project layout. No sample contents read yet.
- **v2** — Added §4.1 "Form Field Type Naming (Display Labels)": canonical
  mapping from `.ds` internal field tokens (`text`, `picklist`,
  `radiobuttons`, `list`, `checkboxes`, `checkbox`, `USD`, `grid`) to
  capitalised Type Names (`Single Line`, `Dropdown`, `Radio`,
  `Multi-Select`, `CheckBox`, `Decision Box`, `Currency`, `Subform`), plus
  Lookup variants (`Single Select Lookup`, `Multi-Select Lookup`). All
  future Form/Subform inspections must use these Type Names in
  human-readable output.
- **v3** — Sharpened §4.1 Lookup detection after verifying against sample
  `.ds` files: a lookup is `type = picklist|list` **plus** a
  `values = OtherForm.Field` reference (there is no `type = lookup` token
  in Creator). Documented the Subform exception (`type = grid` also carries
  `values = ...` but must resolve to **Subform**, not a Lookup). Wired the
  mapping into the UI via a new helper module
  `client/src/lib/fieldTypes.js` (`formatFieldType`) consumed by the
  Fields table in `AppOverview.jsx`; the raw internal token is preserved
  as a hover tooltip for debuggability.
