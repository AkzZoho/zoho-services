# DS Analyser — Persistent Learnings (Workflow Classification & Change-Suggestion Rules)

> **This file is injected into the system prompt of the DS Analyser's
> `suggestChanges` LLM call. It captures hard-won, project-specific
> learnings that the model MUST respect before proposing any change to a
> `.ds` file. Edit freely — no redeploy needed (rules are hot-loaded from
> disk per warm function lifetime).**

---

## 1. Workflow Classification in `.ds` Files — MANDATORY

When a workflow / action / function is found in a `.ds` file, classify it
into **exactly one** of these categories before describing it to the user.
Misclassification is the #1 source of broken change suggestions.

| Category | Lives Inside | Trigger / Purpose | `target.scope` |
|----------|--------------|-------------------|----------------|
| **Form Workflow**        | `form { ... }` block | On Add / On Edit / On Submit / On Validate / On Load / On User Input | `form` |
| **Report Workflow**      | `report { ... }` block | Custom Actions, Bulk Actions, per-record buttons (Download / Approve / Reject), `for each record` actions | `report` |
| **Schedule Workflow**    | Standalone scheduled block | Time-based (daily / weekly / on a date field) | `schedule` |
| **Global / Custom Function** | Standalone function block | Reusable, callable from anywhere | `global` |
| **Page Button Workflow** | `page { ... }` button handler | UI-triggered from a page widget | `form` *(page-bound)* |
| **Approval Workflow**    | Approval block | Approve / Reject record flow | `form` |

### Detection rules

1. **Always inspect the ENCLOSING block**, not the form name referenced
   inside the workflow body. A Report Workflow regularly references the
   underlying form's fields — that does NOT make it a Form Workflow.
2. A workflow appearing under a `report` block ⇒ **Report Workflow**,
   even though its data source is a form.
3. A workflow appearing under a `form` block with an event keyword
   (`on add`, `on edit`, `on submit`, `on validate`, `on load`,
   `on user input`) ⇒ **Form Workflow**.
4. Functions defined outside any form/report/page context ⇒
   **Global/Custom Function**.
5. The digest provided to you contains a `WORKFLOWS` section where each
   workflow lists its `form:`, `event:`, and `scope:` verbatim. **Copy
   those values into `target.parentEntity`, `target.parentName`,
   `target.trigger`, and `target.scope` exactly — do NOT invent.**

### Verified classifications (do NOT re-derive these incorrectly)

| Workflow / Action | App / File | Correct Type | Parent | Notes |
|-------------------|------------|--------------|--------|-------|
| `Download_Complaint` | `UltraTech_CMS.ds` | **Report Workflow** | Report of the `Complaint` form | "For each record" download button on the report. Previously mis-identified as a Form Workflow — do **not** repeat that error. |

---

## 2. Common Pitfalls — DO NOT REPEAT

1. **Form name ≠ parent context.** A Report Workflow regularly references
   the underlying form's fields. The parent is the **report**, not the
   form.
2. **Comments are cosmetic.** Author / username strings inside
   `/* Author : ... */` headers or sample-URL comments are not
   runtime-relevant. A rename inside a comment is **risk: low,
   dataImpact: no-data-loss**.
3. **`zoho.appuri` vs hard-coded usernames.** Live code uses `zoho.appuri`
   for portability. Hard-coded usernames (e.g.
   `shriniwash.yadav_adityabirla`) typically appear only in comments or
   sample URLs. Flag any hard-coded username found in **executable code**
   as `risk: medium` — it likely breaks portability when the app is
   re-owned.
4. **Always state the workflow category explicitly** (Form / Report /
   Schedule / Function / Page / Approval) in `target.scope` and the
   `action` sentence.
5. **Label each line-edit occurrence** as either *comment / metadata* or
   *executable code* so the developer can judge runtime impact.

---

## 3. Standard Answer Template — when asked "which workflow / which form?"

> **HARD RULE:** When the consultant prompt mentions a SPECIFIC workflow
> by name (e.g. "in the Download_Complaint workflow"), you MUST emit at
> least one `changes[]` entry of `kind: "modify_workflow"` that classifies
> the workflow — even if the actual edit is a pure rename handled by
> `lineEditHints`. The change card is what tells the developer **WHAT KIND
> of workflow it is and WHERE to find it in the Creator builder**. A
> response with `changes: []` and only `lineEditHints[]` is INSUFFICIENT
> when the user named a workflow — they explicitly want to know its
> classification.

For every workflow-related change, the response MUST cover:

1. **Workflow name** — exact identifier from the digest.
2. **Workflow type** — Form / **Report** / Schedule / Function / Page / Approval.
3. **Parent container** — form name OR report name OR `(standalone)`.
4. **Execution mode** — `onCreate`, `onEdit`, `for each record`, `bulk`,
   `scheduled:daily`, `button:<ButtonName>`, etc.
5. **Line numbers** (where applicable, via `lineEditHints`) — each
   occurrence labelled *comment* vs *executable*.
6. **Impact** of the proposed change — cosmetic vs runtime-affecting.

These map directly to the JSON contract:
`target.name`, `target.entity`, `target.parentEntity`, `target.parentName`,
`target.trigger`, `target.scope`, `lineEditHints[]`, `risk`, `dataImpact`.

### 3a. How to read the digest's `WORKFLOWS` line for classification

The digest emits each workflow as:
```
  • <displayName> (<name>) [form:<X> | event:<E> | scope:<S> | actions:<A>]
```

Reconcile the fields like this:

| Digest reads | Means | Set on `target` |
|--------------|-------|------------------|
| `scope: form`         | Form Workflow (event handler on a form) | `parentEntity: 'Form'`, `parentName: <form>`, `trigger: <event>`, `scope: 'form'` |
| `scope: report`       | Report Workflow                          | `parentEntity: 'Report'`, `parentName: <report>`, `trigger: 'report-action'` (or button name), `scope: 'report'` |
| `scope: schedule`     | Schedule                                 | leave `parentEntity` empty, `trigger: 'scheduled:<cadence>'`, `scope: 'schedule'` |
| `scope: functions` AND `execution type = for each record` appears in source | **Report Workflow / per-record custom action** — the workflow is technically registered as a "function" but is wired as a report custom action. The digest's `form:` field is the *base form of the report* (the workflow's data context), NOT the parent container. | `parentEntity: 'Report'`, `parentName: <base form name>` (with note: "custom action on the <name> report"), `trigger: 'for each record'`, `scope: 'report'` |
| `scope: functions` standalone, no `execution type = for each record` | Global / custom function | `parentEntity` omitted, `scope: 'global'` |

The `Download_Complaint` workflow in `UltraTech_CMS.ds` is the canonical
example of row 4 above (`scope: functions` + `execution type = for each
record` + `form: Complaint`) → **Report Workflow on the Complaint report**.

### 3b. Comment vs executable rename classification

For every `lineEditHints[]` entry the model proposes, ALSO emit a
companion `changes[]` card that tells the developer whether the matches
are inside comments / sample URLs (cosmetic, `risk: low`,
`dataImpact: no-data-loss`) or inside live Deluge expressions (likely
`risk: medium`).

Heuristics — a match is **cosmetic** when its `lineText` (visible in the
find-usages output the server attaches) contains:

  - `//`, `/*`, `*/` (a comment marker before the match)
  - a sample URL string (`https://creatorapp.zoho`...)
  - `Author :` / `@author` / `sample :` / `e.g.` headers

A match is **executable** when it appears inside:

  - an assignment (`= "..."`), function call, or condition expression
  - a `zoho.appuri` substitution
  - a hard-coded record URL used at runtime (no `//` before it)

---

## 4. Reference Files Known to the Project

| File | Purpose |
|------|---------|
| `UltraTech_CMS.ds` | UltraTech CMS Creator application export. Source of the `Download_Complaint` Report-Workflow learning above. |

---

## 5. Change Log of Learnings

| Entry | Learning |
|-------|----------|
| L-001 | `Download_Complaint` in `UltraTech_CMS.ds` is a **Report Workflow** (parent: Report of `Complaint`), NOT a Form Workflow. |
| L-002 | Always inspect the enclosing block (`form { ... }` vs `report { ... }` vs standalone) when classifying a workflow. Never infer from the form name used inside the workflow body. |
| L-003 | Username strings in `.ds` are usually inside comments; live code uses `zoho.appuri`. Treat comment-only renames as low risk; flag username strings in executable code as medium risk. |
| L-004 | Every workflow change MUST include `target.parentEntity`, `target.parentName`, `target.trigger`, and `target.scope` copied verbatim from the digest's `WORKFLOWS` section. |
