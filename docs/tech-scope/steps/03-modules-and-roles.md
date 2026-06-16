# Step 3 — Roles & Profiles

> **Goal:** capture **who can do what** in the Creator app. In Creator,
> permissions live in the `share_settings { … }` block and split into two
> orthogonal concepts:
>
> 1. **Roles** — the org hierarchy (who reports to whom)
> 2. **Profiles** — the actual permission bundles (one per "persona")

## What this step contains

| Section | Maps to `.ds` |
|---|---|
| 👥 **Roles** | `share_settings { roles { "<Name>" { description = … } } }` |
| 🛡️ **Permission Profiles** | `share_settings { "<ProfileName>" { ModulePermissions { … } } }` |
| 🖥️ **Page Access** | Inferred from the embedded forms/reports' profile permissions |

## Roles (the hierarchy)

A **Role** has just three properties — the system uses them only to build
the org tree for record-sharing inheritance.

| Field | Meaning |
|---|---|
| `name` | "CEO", "Sales Manager", "Sales Rep" |
| `parent` (Reports To) | Another role's name, or `null` for the top of the tree. |
| `description` | Free-text. |

## Profiles (the permission bundles)

A **Profile** assigns permissions per Form (and per Report inside that
form). The Creator vocabulary for `enabled` is fixed:

| Flag | Effect |
|---|---|
| `Tab` | Profile members see the Form's tab in the menu. |
| `Create` | They can submit new records. |
| `Viewall` | They can view every record (not just own). |
| `Modifyall` | They can edit/delete every record. |
| `Import` | They can bulk-import records. |
| `Export` | They can bulk-export records. |

`allFieldsVisible: true` means no field-level masking. Set to `false`
and add a per-field allow-list when working with PII.

`reportPermissions` is a list of `{ report, actions }` where `actions` is
some subset of `["View", "Edit", "Delete", "Export"]`.

## Page Access

Pages don't carry their own permissions in Creator — access flows through
the embedded forms and reports. The Tech Scope tool surfaces this so you
can sanity-check that no page is "open to all" by accident.

## Editing this step via the prompt DSL

```text
# Hierarchy
add role: CEO
add role: Sales Director reports to CEO
add role: Sales Manager  reports to Sales Director
add role: Sales Rep      reports to Sales Manager

# Profiles
add profile: Admin    can read, write, delete, export, import on all forms
add profile: Sales_Rep can read, write on Lead, Customer, Order
add profile: Auditor   can read, export on all forms

# Legacy syntax (alias of addPage, kept for backward compat)
add module: Sales — Customer-facing screens
```

## A worked example

```text
add form: Lead
add form: Customer
add form: Order

add role: Sales Director
add role: Sales Manager reports to Sales Director
add role: Sales Rep     reports to Sales Manager

add profile: Sales_Rep can read, write on Lead, Customer, Order
add profile: Sales_Manager can read, write, delete on Lead, Customer, Order
```

Produces a `Sales_Rep` profile with `Tab + Viewall + Create + Modifyall`
on each of Lead, Customer, Order — and a `Sales_Manager` profile that
adds delete (also expressed as Modifyall in `.ds`).
