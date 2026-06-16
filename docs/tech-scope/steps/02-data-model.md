# Step 2 — Data Model

> **Goal:** detail every field on every form, with **canonical Creator
> field types**, and surface every **Lookup** (Creator's relationship
> mechanism). The ER diagram is rendered live from this data.

## Why no "entities" section?

In Zoho Creator a **Form _is_ the entity**. There is no separate table
declaration. The generic "entity" concept from earlier scope tools maps
1:1 onto a Creator form. Older drafts that used `entities` are auto-
migrated to forms by `migrateScope()`.

## Per-form field table — the columns

| Column | Meaning |
|---|---|
| `Field` | Identifier (no spaces). |
| `Display Name` | Label shown on the form. |
| `Type` | Canonical Creator label (see table below). |
| `Required` | ✓ if non-null on submit. |
| `Unique` | ✓ if a uniqueness constraint applies. |
| `Reference` | For lookups: `TargetForm.ID`. For dropdowns: the choice list. For Formula: the expression. |

## Canonical Creator field types

The single source of truth is
`client/src/tools/ds-analyser/lib/fieldTypes.js`. The Tech Scope tool
maps any generic BRD type onto these labels:

| Category | Labels |
|---|---|
| Text | Single Line · Multi Line · Rich Text |
| Numeric | Number · Decimal · Currency · Percent |
| Choice | Dropdown · Radio · Multi-Select · CheckBox · Decision Box |
| Date / Time | Date · Date-Time · Time |
| Web | Email · Phone · URL |
| Identity | Auto Number · Users · Name · Address |
| File | File Upload · Image · Audio · Video · Signature |
| Lookup | **Single Select Lookup** · **Multi-Select Lookup** · **Subform** |
| Computed | Formula · Prediction · OCR |
| Other | Notes · Add Notes · Section |

## Lookups — the Creator way

A **Lookup** is a field on Form **A** whose value is a record from Form
**B**. Three flavours:

| `kind` | Cardinality | Generated as |
|---|---|---|
| `single` | one-to-one or many-to-one | **Single Select Lookup** field |
| `multi` | many-to-many | **Multi-Select Lookup** field |
| `subform` | one-to-many (inline) | **Subform** field |

In `.ds`, a lookup is encoded as:

```text
customer_id (
    type = picklist
    values = Customers.ID            ← the lookup reference
)
```

The DS Analyser's `formatFieldType()` upgrades `picklist + values=Form.Field`
to `Single Select Lookup`, and `list + values=Form.Field` to
`Multi-Select Lookup`. We mirror that here.

## Editing this step via the prompt DSL

```text
add lookup: Invoice.customer_id -> Customer as single
add lookup: Order.line_items     -> Product  as subform
add lookup: Project.team_members -> Employee as multi

# Legacy syntax (still works, alias of `add lookup`)
add relationship: Customer <-> Invoice as customer_id (1-N)
```

## ER diagram conventions

| Symbol | Cardinality |
|---|---|
| `\|\|--\|\|` | one-to-one |
| `\}o--\|\|` | many-to-one (Single-Select Lookup) |
| `\|\|--o\{` | one-to-many (Subform) |
| `\}o--o\{` | many-to-many (Multi-Select Lookup) |
