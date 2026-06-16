# DS Analyser — Learnings & Reference Notes

> This file captures persistent knowledge for analysing Zoho Creator `.ds` (deluge script) files.
> The DS Analyser **must consult this file before suggesting changes** to any `.ds` file.

---

## 1. Workflow Classification in `.ds` Files

When a workflow / action is found inside a `.ds` file, it can belong to one of the following categories. **Always identify the correct category before describing it to the user.**

| Category | Where it lives | Trigger / Purpose |
|----------|----------------|-------------------|
| **Form Workflow** | Defined on a form | On Add / On Edit / On Submit / On Validate / On Load / On User Input |
| **Report Workflow** | Defined on a report (a view of a form) | Custom Actions, Bulk Actions, Per-record buttons (e.g. Download buttons, Approve/Reject buttons) |
| **Schedule Workflow** | Standalone scheduled job | Time-based execution (daily / weekly / on a date field) |
| **Global / Custom Function** | Standalone function block | Reusable function callable from anywhere |
| **Button Workflow (Page)** | Defined on a page/widget button | UI-triggered from a page |
| **Approval Workflow** | Defined under approvals | Approve / Reject record flow |

### How to detect the category in a `.ds` file
- Look at the **enclosing block / parent context** of the workflow definition, NOT just the form name referenced inside the code.
- A workflow appearing under a `report` block ⇒ **Report Workflow**, even if the underlying data source is a form.
- A workflow appearing under a `form` block with an event keyword (`on add`, `on edit`, etc.) ⇒ **Form Workflow**.
- Functions defined outside any form/report context ⇒ **Global/Custom Function**.

### ✅ Known correct classifications (verified)
| Workflow / Action name | File | Correct Type | Parent | Notes |
|------------------------|------|--------------|--------|-------|
| `Download_Complaint` | `UltraTech_CMS.ds` | **Report Workflow** | Report of `Complaint` form | "For each record" download button on the report. Earlier mis-identified as a Form workflow — do **not** repeat that mistake. |

---

## 2. Common Pitfalls to Avoid

1. **Do not confuse form name with parent context.** A Report Workflow often references a form's fields inside its code — that does NOT make it a Form Workflow.
2. **Author / username strings in comments are cosmetic.** Strings like `shriniwash.yadav_adityabirla` appearing in `/* Author : ... */` or sample-URL comments are not runtime-relevant. Replacing them (e.g. with `utcl_cms`) is safe.
3. **`zoho.appuri` vs hard-coded usernames.** Live code typically uses `zoho.appuri` so the app is portable across owners. Hard-coded usernames usually appear only in comments / sample URLs.
4. **Always state the workflow category explicitly** (Form / Report / Schedule / Function / Page button / Approval) when answering the user.
5. **Quote line numbers** for every occurrence found, and label each occurrence as either "comment / metadata" or "executable code".

---

## 3. Reference Files

| File | Purpose | Last verified |
|------|---------|---------------|
| `/tmp/ai_uploads/01c47584-4e79-43c3-86dc-0738c7e77744/UltraTech_CMS.ds` | UltraTech CMS Creator application export | Session reference |

---

## 4. Standard Answer Template (when user asks "which workflow / which form?")

Always respond with:
1. **Workflow name** (exact identifier)
2. **Workflow type** — Form / **Report** / Schedule / Function / Page / Approval
3. **Parent container** — form name *or* report name *or* "standalone"
4. **Execution mode** — on add / on edit / for each record / bulk / scheduled / etc.
5. **Line numbers** of all occurrences, each labelled (comment vs executable)
6. **Impact of the proposed change** — cosmetic (comment-only) vs runtime-affecting

---

## 5. Change Log of Learnings

| Date | Learning |
|------|----------|
| Initial | `Download_Complaint` in `UltraTech_CMS.ds` is a **Report Workflow**, not a Form Workflow. Parent: a Report of the `Complaint` form. |
| Initial | Always inspect the enclosing block (`form { ... }` vs `report { ... }`) when classifying a workflow in `.ds` files. |
| Initial | Username strings inside `.ds` files are usually in comments only; live code uses `zoho.appuri`. |
