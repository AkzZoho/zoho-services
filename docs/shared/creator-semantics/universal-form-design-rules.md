# Universal Form Design Rules

> **Scope.** These rules apply to **every form in every application** —
> not just system base forms. They were derived while designing the
> base forms ([`04-base-forms.md`](./04-base-forms.md)) but are
> universal.

---

## The four rules

| Rule                       | Correct pattern                                  | Anti-pattern to avoid                                       |
|----------------------------|--------------------------------------------------|-------------------------------------------------------------|
| **No system timestamps**   | Omit `created_time`, `modified_time`, `last_login`. Creator already tracks these internally. | Adding any auto-timestamp field to a user-facing form.       |
| **Status over Boolean**    | `status` Dropdown with values like `Active` / `Inactive`. | `is_active` Decision Box / CheckBox as a visibility toggle. |
| **Visible-first design**   | Assume every field will be shown on the form page. | Hiding fields behind system flags or "internal only" markers. |
| **Lookup, not raw ID**     | `Single Select Lookup → User_Roles.ID`           | A free-text field storing a role name or numeric foreign key. |

---

## Rationale

### Why no system timestamps on user-facing fields

All Creator forms render their fields on a UI page that end users
see. System-managed timestamps (`created_time`, `last_login`,
`modified_time`) clutter that page, leak implementation detail, and
confuse non-technical users. Creator already tracks these values
internally and exposes them through report criteria and Deluge
(`zoho.currenttime`, `input.Created_Time`) — there is no need to put
them on the form.

### Why a Status dropdown beats an `Is_Active` boolean

Two reasons:

1. **UX** — a dropdown labelled *Status* with options `Active` /
   `Inactive` is more readable than a checkbox labelled *Is Active*.
2. **Extensibility** — many real workflows need a third state
   (`Pending`, `Suspended`, `Archived`). A dropdown grows to fit;
   a boolean has to be migrated.

### Why visible-first design

Trying to "hide" a field via permissions or workflow logic is fragile.
If a field exists on a form, assume a user will see it; design its
label, help text, and value space accordingly. If something must truly
be system-only, store it on a different form (or as a Deluge variable),
not on the user-facing form.

### Why lookups beat raw IDs

A `Single Select Lookup` enforces referential integrity, gives the
user a search-friendly picker UI, and lets reports/queries traverse
the relationship without manual joins. Storing a raw role name or
foreign-key integer breaks all of that.

---

## Where these rules are enforced

- **Tech Scope Creator** — the BRD parser and prompt DSL refuse to add
  `created_time` / `modified_time` / `is_active` fields, and rewrite
  any `boolean` status field into a `status` Dropdown with
  `Active` / `Inactive`.
- **DS Analyser performance audit** — flags forms that violate any of
  the four rules above. Tune the audit in
  [`../../rules/Performance_Matrix.md`](../../rules/Performance_Matrix.md).
- **Generated documentation** — schema tables produced by either tool
  must respect this vocabulary.

---

## Worked example

`Email_Templates` is the canonical example because it tempts every
designer to add `is_active`. The correct schema (see
[`04-base-forms.md`](./04-base-forms.md)) uses `status: Dropdown` with
values `Active` / `Inactive` and omits all timestamp fields.

The same pattern governs every master form in every application —
customers, vendors, products, employees, locations, projects, etc.
