# Step 1 — Application Flow

> **Goal:** capture every runtime entity the Creator app exposes —
> **Forms · Reports · Pages · Workflows** — and the trigger graph that
> links them together. The on-screen flowchart is rendered live from the
> same data structure.

## What this step contains

| Section | Creator entity | `.ds` block it maps to |
|---|---|---|
| 📝 **Forms** | The data tables. Hold raw records and validation rules. | `forms { form X { … } }` |
| 📊 **Reports** | Views over forms (list, grid, kanban, calendar, …). | `reports { list X from Y { … } }` |
| 🖥️ **Pages** | HTML/widget composites that embed forms & reports, grouped into **Sections**. | `pages { page X { … } }` / `section { … }` |
| ⚙️ **Workflows** | Automation rules. Triggered by a record event, schedule, or button. | `workflow { form { X { record event = on add … } } }` |

## Form table — the columns

| Field | Notes |
|---|---|
| `Form` | Identifier — used in workflows, lookups, reports. |
| `Display Name` | What the user sees on the tab. |
| `Fields` | Count only at this step; details belong to Step 2. |
| `Action Events` | Any of `on add`, `on edit`, `on delete`, `on validate`, `on user input`. Defaults to `on add, on edit`. |
| `Purpose` | One-line BRD-derived purpose. Edit as needed. |

## Report types (canonical Creator vocabulary)

| Type | When to use |
|---|---|
| `list` | Default tabular listing. |
| `grid` | Editable spreadsheet-style table. |
| `kanban` | Pipeline / stages. |
| `calendar` | Date-based views. |
| `timeline` | Gantt-like horizontal timeline. |
| `map` | Geo-tagged records. |
| `pivot` | Cross-tab summaries. |
| `summary` | Roll-up groupings. |
| `spreadsheet` | Raw cell editing. |

## Workflow `event` values

| Event | Fires when |
|---|---|
| `on add` | A record is submitted for the first time. |
| `on edit` | An existing record is modified. |
| `on delete` | A record is deleted. |
| `on validate` | Pre-save validation pass. |
| `on user input` | Any field-level change in the form. |

For schedule- and button-triggered workflows, set `scope` to `schedule` or
`button` and leave `event` blank.

## Editing this step via the prompt DSL

```text
add form: Customer with fields: id, name, email (text, required)
add field to form Customer: phone (phone, required)
rename form: Customer to Client

add report: All_Customers type list from Customer
add report: Pipeline as kanban from Lead

add page: Sales_Home in section Sales embeds Form: Lead, Report: Pipeline

add workflow: Approve_Invoice triggered by Invoice.create
remove workflow: Old_Workflow
```

## Diagram conventions

The auto-generated Mermaid flowchart uses these shapes:

| Shape | Meaning |
|---|---|
| `[..]` rectangle | 📝 Form |
| `[/.../]` parallelogram | 📊 Report |
| `{{..}}` hexagon (inside a section sub-graph) | 🖥️ Page |
| `{..}` diamond | ⚙️ Workflow |
| `([..])` stadium | ⏰ Schedule |
| `((..))` cloud | 🔌 Connection |
| `[\..\]` reverse-trapezoid | λ Custom Function |

Edges are labelled with the trigger event (`on add`, `on edit`, etc.).
