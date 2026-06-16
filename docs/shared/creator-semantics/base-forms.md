# Base Forms — System-Level (Present in Every Application)

> **These three forms MUST exist in every Zoho Creator application
> produced from a BRD, regardless of domain.** They are injected
> automatically by the Tech Scope Creator and are protected from
> removal via the prompt DSL.

> **Companion file.** Universal design rules that apply to *every*
> form (not just these three) live in
> [`05-universal-form-design-rules.md`](./05-universal-form-design-rules.md).

---

## 1. The three required base forms

| Form | Purpose |
|---|---|
| **Users** | Application user records — who can log in and act on data |
| **User_Roles** | Role definitions — which roles exist and what they represent |
| **Email_Templates** | Reusable email content for notifications, approvals, alerts |

---

## 2. Canonical field schemas

### `Users`

| Field name | Display Name | Type                  | Required | Unique | Notes                        |
|------------|--------------|-----------------------|----------|--------|------------------------------|
| `name`     | Name         | Single Line           | ✅       | ❌     | Full name                    |
| `email`    | Email        | Email                 | ✅       | ✅     | Login identifier             |
| `phone`    | Phone        | Phone                 | ❌       | ❌     |                              |
| `role`     | Role         | Single Select Lookup  | ✅       | ❌     | → `User_Roles.ID`            |
| `status`   | Status       | Dropdown              | ✅       | ❌     | `Active`, `Inactive`, `Pending` |

> ⛔ **Do NOT add** `last_login`, `created_time`, `modified_time`, or any
> system-timestamp fields. See
> [`05-universal-form-design-rules.md`](./05-universal-form-design-rules.md)
> for the full rationale — this rule applies to **all** forms in every
> application.

### `User_Roles`

| Field name      | Display Name | Type          | Required | Unique | Notes                                                    |
|-----------------|--------------|---------------|----------|--------|----------------------------------------------------------|
| `role_name`     | Role Name    | Single Line   | ✅       | ✅     |                                                          |
| `description`   | Description  | Multi Line    | ❌       | ❌     |                                                          |
| `permissions`   | Permissions  | Multi-Select  | ❌       | ❌     | `Create`, `Read`, `Update`, `Delete`, `Approve`, `Export` |
| `status`        | Status       | Dropdown      | ✅       | ❌     | `Active`, `Inactive`                                     |

> **Seed roles** auto-created on app setup: `Admin`, `Manager`, `User`.
> The `Admin` and `User` roles carry `is_system_role` semantics
> (protected from deletion) but this is **not** a separate field —
> enforce it in workflow / Deluge logic instead.

### `Email_Templates`

| Field name      | Display Name | Type        | Required | Unique | Notes                                                    |
|-----------------|--------------|-------------|----------|--------|----------------------------------------------------------|
| `template_name` | Template Name| Single Line | ✅       | ✅     |                                                          |
| `subject`       | Subject      | Single Line | ✅       | ❌     | Supports `${placeholder}` syntax                         |
| `body`          | Body         | Rich Text   | ✅       | ❌     | Supports `${placeholder}` syntax                         |
| `category`      | Category     | Dropdown    | ✅       | ❌     | `Notification`, `Approval`, `Alert`, `Welcome`, `Other`  |
| `status`        | Status       | Dropdown    | ✅       | ❌     | `Active`, `Inactive`                                     |

> ⛔ **Do NOT use `is_active` / `Is_Active` (CheckBox / Decision Box) as
> a visibility toggle on any form.** All forms are UI-visible to users;
> a checkbox labelled "Is Active" is poor UX. Use a **Dropdown** named
> `status` with values `Active` / `Inactive` instead. Same rationale as
> the timestamp rule —
> see [`05-universal-form-design-rules.md`](./05-universal-form-design-rules.md).

---

## 3. Injection & protection rules (DSL enforcement)

1. **Auto-injection.** When a BRD is parsed, if `Users`, `User_Roles`,
   or `Email_Templates` are absent from the extracted `forms[]`, they
   are merged in automatically using the schemas above.
2. **Merge, don’t duplicate.** If the BRD already mentions one of these
   forms, BRD-defined fields win on conflict; system base fields are
   added only if missing.
3. **DSL protection.** `remove form: Users`, `remove form: User_Roles`,
   and `remove form: Email_Templates` are rejected with:
   `"<Name> is a required system base form and cannot be removed."`
   Renaming is allowed.
4. **Cross-app replication.** In Creator each application has its own
   database. These forms are **replicated per application** — they are
   not a shared auth layer. Surface this as an info note in the UI.

---

## 4. Visual treatment in Step 1 (Tech Scope Creator — Architecture View)

- Base forms appear in a **pinned card** at the top of Step 1 with a
  🔧 icon and the subtitle *"System base forms — present in every
  application"*.
- They appear **before** BRD-derived subject areas.
- They cannot be reordered below domain forms.

---

## 5. Source

This learning was distilled from the Tech Scope Creator design work and
is mirrored in
[`../../tech-scope/overview.md`](../../tech-scope/overview.md)
(§9). Keep both in sync; this file is the canonical version for
top-level reference.
