# Performance Matrix — Zoho Creator `.ds` Audit

> **Purpose:** This document is the canonical rulebook used whenever a `.ds`
> (Zoho Creator Deluge Script / application export) file is uploaded to the
> audit tool. It defines **what** is inspected, **how** severity is assigned,
> **how** the impact score is computed, and **what** the output summary report
> must contain.
>
> Reverse-engineered from the reference audit of `Master_Database.ds`
> (report generated `2026-03-25 12:10:12`, 106 issues across 23 forms).

---

## 1. Audit Scope

The tool parses a `.ds` file and inspects the following component types:

| Component | Keyword(s) in `.ds` | What is audited |
|---|---|---|
| **Form** | `form <Name> { ... }` | Fields, types, mandatory syntax, choices syntax, lookups, displayformat, duplicate names, system fields |
| **Report** | `default list / list / summary / kanban` | Columns vs. layout fields (quickview / detailview), custom actions, layouts |
| **Function** | `functions { Deluge { ... } }` | Fetch/DB/loop/integration patterns, unused functions, hardcoded IDs, null-checks |
| **Form Workflow** | `workflow { form { ... } }` — `on add / on edit / on validate / on success / on load / field rules / on user input` | Same Deluge checks + concurrency checks (multi-writer forms, long locks) |
| **Scheduled Workflow** | `workflow { schedule { ... } }` | Deluge checks + long-running/locking patterns |
| **Batch Workflow** | `workflow { batchworkflow { ... } }` | Deluge checks on per-record code |
| **Custom Actions** | `workflow { functions { ... } }` | Deluge checks on button/action scripts |
| **Variables** | `variables { ... }` | Unused variables, hardcoded IDs |
| **Connections** | `connections { ... }` | Referenced from integration checks |

---

## 2. Severity Model

Every finding maps to exactly one severity:

| Severity | Color | Meaning | Action |
|---|---|---|---|
| 🔴 **Critical** | Red | Causes correctness bugs, schema failures, or guaranteed scale breakage | Must fix before release |
| 🟡 **Warning** | Amber | Performance / concurrency / reliability degradation under load | Fix in current sprint |
| 🔵 **Info** | Blue | Best-practice / maintainability suggestion | Fix when touching the area |

---

## 3. Rule Categories

Rules are grouped into 8 functional categories. The tool MUST tag every
issue with one category.

| Category ID | Display Name | # of Rules |
|---|---|---|
| `FETCH_RECORDS` | Fetch Records | 8 |
| `LOOP` | Loop Performance | 3 |
| `DATABASE_OPERATIONS` | Database Operations | 3 |
| `INTEGRATION` | Integration | 2 |
| `SUBFORM` | Subform Operations | 2 |
| `VARIABLE` | Variable Usage | 2 |
| `GENERAL` | General Best Practices | 4 |
| `SCHEMA` | Schema Validation | 7 |
| `CONCURRENCY` | Concurrency & Locking | 4 |

**Total: 35 rules (11 Critical · 18 Warning · 6 Info).**

---

## 4. Full Rule Catalogue

> Each rule has a stable ID (`<CAT>-<NNN>`), a severity, a one-line
> description, a recommended fix, and an impact statement.
> The tool uses the **ID** in the report — never rename or re-number.

### 4.1 Fetch Records (`FETCH-*`)

| ID | Severity | Rule | Detection Pattern | Suggested Fix |
|---|---|---|---|---|
| `FETCH-001` | 🟡 Warning | Fetch Records Inside Loop | `FormName[criteria]` inside `for each` block | Move fetch before the loop; build a `Map` for in-memory lookup |
| `FETCH-002` | 🔴 Critical | Fetch Without Criteria | `FormName[ID != 0]` or empty criteria | Add specific criteria **and** `range from 0 to N` |
| `FETCH-003` | 🔴 Critical | Case-Sensitive Comparison in Fetch | `==` on free-text (non-email/name) where casing varies | Use `equalsIgnoreCase()` |
| `FETCH-004` | 🟡 Warning | Contains Operator in Fetch Criteria | `contains` on single-value fields | Use `==` or `equalsIgnoreCase()` for exact match |
| `FETCH-005` | 🟡 Warning | Equal To Operator in Fetch Criteria | `==` on text/textarea fields (e-mail, name, etc.) | Use `equalsIgnoreCase()` |
| `FETCH-006` | 🔵 Info | Index Suggestion for Fetch Criteria | Any non-lookup field used in `[...]` filter | Mark field as indexed (Setup → Form → Properties → Index this field) |
| `FETCH-007` | 🟡 Warning | OR Condition with Lookup Fields in Fetch | `\|\|` used together with `Lookup.ID` / `Lookup.Field` | Split into two fetches, merge with `.distinct()` |
| `FETCH-008` | 🟡 Warning | getAll Without Criteria | `.getAll()` / `.getall()` called on unfiltered fetch | Add criteria and/or `range` before `.getAll()` |

### 4.2 Loop Performance (`LOOP-*`)

| ID | Severity | Rule | Suggested Fix |
|---|---|---|---|
| `LOOP-001` | 🔴 Critical | Nested Loops Detected — O(n²) or worse | Replace inner loop with `Map`/`Set` lookup |
| `LOOP-002` | 🟡 Warning | String Concatenation in Loop | Collect into `List` → `joinlist(...)` or use StringBuilder pattern |
| `LOOP-003` | 🔴 Critical | Subform Operation in Loop | Fetch the whole subform once, iterate in memory |

### 4.3 Database Operations (`DB-*`)

| ID | Severity | Rule | Suggested Fix |
|---|---|---|---|
| `DB-001` | 🟡 Warning | Update Operations in Loop (`Record.Field = ...` inside `for each`) | Collect IDs → single bulk `updateRecord`/`bulk_update_records` call |
| `DB-002` | 🔴 Critical | Delete Operations in Loop | Use `delete from Form[criteria]` — a single atomic operation |
| `DB-003` | 🟡 Warning | Insert Operations in Loop (`insert into Form`) | Use bulk insert, or re-evaluate the logic |

### 4.4 Integration (`INTEG-*`)

| ID | Severity | Rule | Suggested Fix |
|---|---|---|---|
| `INTEG-001` | 🔴 Critical | Integration Call in Loop (`invokeurl` / `invokeUrl` inside `for each` — excluding `sendmail`) | Batch, or call once after the loop with collected payload |
| `INTEG-002` | 🟡 Warning | Unbatched API Calls (multiple `invokeurl` close together) | Combine into one batched request |

### 4.5 Subform Operations (`SUBF-*`)

| ID | Severity | Rule | Suggested Fix |
|---|---|---|---|
| `SUBF-001` | 🟡 Warning | Fetching All Subform Rows | Add criteria or limit |
| `SUBF-002` | 🟡 Warning | Subform Access Without Limit | Limit rows if not all are needed |

### 4.6 Variable Usage (`VAR-*`)

| ID | Severity | Rule | Suggested Fix |
|---|---|---|---|
| `VAR-001` | 🟡 Warning | Inefficient List Operations (`List.contains()` in loop) | Convert list to `Set` before the loop |
| `VAR-002` | 🔵 Info | Unused Variables | Remove the assignment |

### 4.7 General Best Practices (`GEN-*`)

| ID | Severity | Rule | Suggested Fix |
|---|---|---|---|
| `GEN-001` | 🔵 Info | Hardcoded IDs (long numeric literals assigned to lookup/record vars, e.g. `6687000000081003`) | Use variables / app-variables / lookups |
| `GEN-002` | 🔵 Info | Missing Null Check after a fetch | Wrap access with `if(var != null)` or `if(var.count() > 0)` |
| `GEN-003` | 🔵 Info | Infinite Loop Risk (`while(true)` without visible `break`/`return`) | Ensure a clear exit condition |
| `GEN-004` | 🔵 Info | Unused Function (defined but never referenced) | Remove or document as externally-called |

### 4.8 Schema Validation (`SCHEMA-*`)

| ID | Severity | Rule | Suggested Fix |
|---|---|---|---|
| `SCHEMA-001` | 🔴 Critical | System Field Declared as Form Field (`Added_User`, `Added_Time`, `Modified_User`, `Modified_Time`, `ID`, `Added_IP`) | Remove the declaration — system fields are auto-managed |
| `SCHEMA-002` | 🔴 Critical | Invalid Field Type | Use only valid types: `text, email, number, decimal, date, datetime, textarea, picklist, radiobuttons, checkbox, checkboxes, richtext, plaintext, upload, url, image, time, video, percentage, section, button, submit, cancel, reset, list, grid, help_text, name, address, phonenumber, autonumber` or a currency code |
| `SCHEMA-003` | 🔴 Critical | Duplicate Field Name in Form | Rename one of the fields (e.g. `Product_LU_1`, `Product_LU_2`) |
| `SCHEMA-004` | 🟡 Warning | Incorrect Mandatory Syntax (`mandatory = true`) | Use `must have <FieldName> ( ... )` prefix |
| `SCHEMA-005` | 🟡 Warning | Incorrect Choices Syntax (`choices = "..."`) | Use `values = {"Choice 1","Choice 2"}` |
| `SCHEMA-006` | 🟡 Warning | Lookup Field Missing Display Format | Add `displayformat = [FieldName]` |
| `SCHEMA-007` | 🟡 Warning | Layout Field Not in Report Definition | Add field to the report's `show all rows from ...( )` column list |

### 4.9 Concurrency & Locking (`CONC-*`)

| ID | Severity | Rule | Suggested Fix |
|---|---|---|---|
| `CONC-001` | 🔴 Critical | Bulk Update on High-Fan-In Form (loop-update on a form referenced by ≥4 other forms) | Batch into single `updateRecords`, or denormalise shared data |
| `CONC-002` | 🟡 Warning | Multiple Workflows Writing Same Form (≥3 distinct writers) | Consolidate, or queue via schedules / batch / async workflows |
| `CONC-003` | 🟡 Warning | Long-Running Operation Holding Record Lock (integration call between fetch and update) | Re-order: fetch → call → re-fetch → update |
| `CONC-004` | 🔴 Critical | Integration + Update Loop on Shared Form | Collect API results first, batch-update outside the loop |

---

## 5. Volume Tier & Impact Score

Every **form** is assigned a Volume Tier from schema signals. Issues on
higher-tier forms receive higher **Impact Scores** (shown as 🔥 NN in the
report). This makes the prioritisation realistic.

### 5.1 Form Volume Tier Signals

A form's Volume Tier is derived from:

| Signal | Contribution |
|---|---|
| **Fan-Out** | # of lookup/picklist/list fields this form has pointing to other forms |
| **Fan-In** | # of other forms referencing this form (writer hotspot indicator) |
| **Date / DateTime fields** | Indicates transactional/time-series data → higher volume |
| **Field count** | Richer forms typically see more traffic |
| **Fetches** | How many fetch operations across all code target this form |
| **Workflows touching this form** | More surface area → higher volume |
| **Writers** | Distinct workflows/functions that write to this form |
| **Concurrency issues detected** | Increases risk class |

### 5.2 Tier Levels

| Tier | Icon | Typical Signal Profile |
|---|---|---|
| **Very High** | 🔥 | Users/people/transaction forms; high fan-in, multiple writers, fetches, date fields |
| **High** | ⚠️ | Role/config forms with many lookups and workflows |
| **Medium** | — | Moderate fan-in and fields |
| **Low** | — | Small reference / master tables |

### 5.3 Risk Classification (per form)

Combines fan-in + writer count + detected concurrency patterns:

- **Critical** — ≥1 `CONC-001` or `CONC-004` finding, or fan-in ≥ 6 with multi-writer
- **Moderate** — Any `CONC-00x` finding, or multi-writer with shared schedule
- **—** (none) — No concurrency issues detected

### 5.4 Impact Score (per issue)

```
impact_score = base_severity_weight × volume_tier_multiplier
```

| Severity | Base Weight |
|---|---|
| Critical | 8 |
| Warning | 4 |
| Info | 1 |

| Volume Tier | Multiplier |
|---|---|
| Very High | 3.0 |
| High | 2.0 |
| Medium | 1.5 |
| Low | 1.0 |

**High-Impact** = any issue with impact_score ≥ 12 (surfaced as its own KPI).

---

## 6. Required Output — Simple Report Format

Whenever a `.ds` file is uploaded, the tool MUST produce a concise summary.
The recommended shape (Markdown) is below. Optional: also emit the rich HTML
dashboard shown in the reference report.

```markdown
# Performance Audit Report — <file_name>.ds
_Generated: <YYYY-MM-DD HH:MM:SS>_

## 1. Summary KPIs
| Metric | Count |
|---|---|
| Total Issues | N |
| 🔴 Critical | N |
| 🟡 Warnings | N |
| 🔵 Info | N |
| 🔥 High Impact (score ≥ 12) | N |

## 2. Issue Distribution by Category
| Category | Count |
|---|---|
| Fetch Records | N |
| Loop Performance | N |
| Database Operations | N |
| Integration | N |
| Subform Operations | N |
| Variable Usage | N |
| General Best Practices | N |
| Schema Validation | N |
| Concurrency & Locking | N |

## 3. Top 10 Highest-Impact Issues
| # | Severity | Rule | Form | Component | Line | Impact |
|---|---|---|---|---|---|---|
| 1 | 🔴 Critical | CONC-001 | Users | Form Workflow | 4210 | 🔥 24 |
| ... |

## 4. Form Volume Tier Table
| Form | Tier | Risk | Issues | Fan-In | Writers | Conc. |
|---|---|---|---|---|---|---|
| Users | 🔥 Very High | Critical | 23 | −2 | 10 (+5) | 3 |
| ... |

## 5. Detailed Findings (grouped by function / workflow)
### <Component path, e.g. "Function > EQS.returnEmailList">
- 🟡 **FETCH-001** · _Fetch Records Inside Loop_ · Line 3931 · 🔥 24
  > `IsActive = Users[ID == fetchEmail.Users && User_Status == "Active"];`
  💡 Move the fetch before the loop and filter in memory, or use a single bulk fetch.

## 6. Recommended Next Steps
1. Fix all Critical findings first (correctness / schema / scale risk).
2. Address High-Impact Warnings on Very-High-tier forms.
3. Create a follow-up ticket for Info-level maintainability items.
```

---

## 7. Reference Benchmark — `Master_Database.ds`

The following numbers (from the `2026-03-25` reference audit) serve as a
sanity check that the tool produces comparable output:

| Metric | Expected Value |
|---|---|
| Total Issues | **106** |
| Critical | **2** (both `CONC-001`) |
| Warnings | **55** |
| Info | **49** |
| High Impact | **81** |
| Highest-risk form | **Users** (Very High, Critical risk, 23 issues) |
| Other Very-High forms | Company, Users_ZD, Module_and_Roles, Company_Department_Details, Department |
| Top rule by count | `FETCH-008` (23) → `FETCH-006` (22) → `GEN-001` (19) |

### 7.1 Issue counts by rule (reference)

| Rule | Count |
|---|---|
| CONC-001 | 2 |
| CONC-002 | 4 |
| CONC-003 | 5 |
| DB-003 | 5 |
| FETCH-001 | 5 |
| FETCH-005 | 9 |
| FETCH-006 | 22 |
| FETCH-007 | 3 |
| FETCH-008 | 23 |
| GEN-001 | 19 |
| GEN-004 | 7 |
| INTEG-002 | 1 |
| VAR-002 | 1 |

### 7.2 Issue counts by component (reference)

| Component | Count |
|---|---|
| Function (stand-alone Deluge functions) | 69 |
| Form Workflow (on add / on edit / on success / field rules / etc.) | 36 |
| Report | 1 |

---

## 8. Parsing Cheat-Sheet (how each rule maps to the `.ds` grammar)

| Grammar Token | Rule(s) Triggered |
|---|---|
| `for each X in FormName[...]` containing a nested `FormName[...]` | FETCH-001 |
| `FormName[ID != 0]` / `FormName[ID != null]` with no further filter | FETCH-002, FETCH-008 |
| `==` on `text` / `email` field in a fetch criterion | FETCH-005 (FETCH-003 if casing varies) |
| `contains` in a fetch criterion on a non-multiselect field | FETCH-004 |
| Any non-lookup field used inside `[ ... ]` | FETCH-006 |
| `\|\|` combined with `Lookup.Field` inside `[...]` | FETCH-007 |
| `.getAll()` / `.getall()` on unfiltered fetch | FETCH-008 |
| Nested `for each` | LOOP-001 |
| String `+=` or `+ ""` accumulation inside `for each` | LOOP-002 |
| Subform access `Record.SubformField` inside `for each` | LOOP-003 / SUBF-002 |
| `Record.Field = value` inside `for each` | DB-001 |
| `delete from Form[...]` inside `for each` | DB-002 |
| `insert into Form[...]` inside `for each` | DB-003 |
| `invokeurl [...]` inside `for each` (except `sendmail`) | INTEG-001 |
| Multiple `invokeurl` within ~5 statements | INTEG-002 |
| `subform.getAll()` without criteria | SUBF-001 |
| `List.contains(x)` inside `for each` | VAR-001 |
| Variable assigned but never referenced afterward | VAR-002 |
| Numeric literal ≥ 10 digits assigned to a lookup field or used as a record ID | GEN-001 |
| Fetch result immediately dereferenced without `!= null` or `.count() > 0` | GEN-002 |
| `while(true)` / `while(1 == 1)` without visible `break` / `return` | GEN-003 |
| `void FuncName(...)` / `list FuncName(...)` never invoked anywhere | GEN-004 |
| Field named `Added_User / Added_Time / Modified_User / Modified_Time / ID / Added_IP` declared inside `form` | SCHEMA-001 |
| `type = <unknown>` in a field block | SCHEMA-002 |
| Two field blocks with the same name inside one `form` | SCHEMA-003 |
| `mandatory = true` instead of `must have` prefix | SCHEMA-004 |
| `choices = "..."` instead of `values = { }` | SCHEMA-005 |
| `type = picklist / list` with `values = Form.ID` but no `displayformat = [...]` | SCHEMA-006 |
| Field referenced in `quickview`/`detailview` but absent from `show all rows from <Form>( ... )` | SCHEMA-007 |
| Loop updating a form whose fan-in ≥ 4 | CONC-001 |
| ≥ 3 distinct workflows/functions writing the same form | CONC-002 |
| `invokeurl` between a fetch and a subsequent field-update on the fetched record | CONC-003 |
| `invokeurl` + update on the same shared form inside a loop | CONC-004 |

---

## 9. Usage Checklist (for the tool operator)

When a new `.ds` is uploaded:

1. Parse the file; build the form/field/workflow/function inventory.
2. Compute Volume Tier for each form (§5.1).
3. Run each rule in §4 against the inventory; tag findings with
   `{severity, category, rule_id, form, component, line, snippet}`.
4. Compute Impact Score per finding (§5.4).
5. Emit the Simple Report in §6 (Markdown) and, optionally, the rich HTML.
6. Cross-check KPIs against §7 for known files; unexpected deltas
   indicate a rule-engine regression.

---

_Last updated: synced with `Master_report-1.html` reference run._
