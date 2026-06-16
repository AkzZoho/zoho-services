# Technical Scope Creator — Learning Log

> A living journal of design decisions, parsing heuristics, prompt-DSL rules
> and gotchas for the **Technical Scope Creator** tool. Append your own
> observations as you use it — the assistant will consult this file before
> making changes so context survives across sessions.

---

## 1. Tool intent

Generate a **Zoho Creator Technical Scope Document** from an uploaded BRD /
requirement file, in **5 reviewable steps**, with a **deterministic prompt
DSL** to adjust each step **without any AI API keys**. Output is a **packed
PDF** (markdown content + embedded flowchart) plus per-step markdown.

The output vocabulary mirrors what the **DS Analyser** produces from a
real `.ds` file, so a future round-trip — _BRD → Tech Scope → built `.ds` →
DS Analyser → diff_ — stays diffable.

## 2. Tech stack (locked)

| Layer | Choice | Reason |
|---|---|---|
| UI | React + Vite + Tailwind (existing shell) | Reuse |
| Routing | `react-router-dom` (existing) | `/tech-scope/*` |
| BRD parsing | `pdfjs-dist` (PDF) · `mammoth` (DOCX) · native (TXT/MD) | Offline |
| Flowchart | `mermaid` (already installed) | Offline render to SVG |
| PDF export | `jspdf` + `html2canvas` | Client-side, packed |
| Markdown render | `react-markdown` (existing) → HTML for PDF | Reuse |
| Storage | `localStorage` (drafts) | No backend needed |
| Adjustments | Deterministic mini-DSL (no LLM) | No API keys |

## 3. The 5 steps (Creator vocabulary)

| # | Step | Creator entities surfaced |
|---|---|---|
| 1 | **Application Flow** | Forms · Reports · Pages (sections) · Workflows |
| 2 | **Data Model** | Form fields with canonical Creator types · Lookups |
| 3 | **Roles & Profiles** | Org hierarchy · `share_settings` profiles · Page Access |
| 4 | **Functions, Connections & APIs** | Deluge custom functions · Connections · Schedules · Public REST APIs |
| 5 | **NFRs & Assumptions** | Edition · governance limits · Out-of-Scope |

Each step is a **markdown section** edited through:
- The **prompt DSL** (recommended for structural changes)
- A **free-text editor** (always available)
- "Looks good → Next step" button

## 4. Canonical field-type labels

Field-type strings emitted by the heuristic parser **and** by the
`asCreatorField()` mapper in the prompt DSL come from
`client/src/tools/ds-analyser/lib/fieldTypes.js` (single source of truth):

| Generic word in BRD | Canonical Creator label |
|---|---|
| `text`, `string` | **Single Line** |
| `longtext`, `multiline` | **Multi Line** |
| `number`, `int`, `integer` | **Number** |
| `decimal`, `float`, `double` | **Decimal** |
| `currency`, `money`, `usd` | **Currency** |
| `percent` | **Percent** |
| `date`, `datetime`, `time` | **Date** / **Date-Time** / **Time** |
| `email`, `phone`, `url` | **Email** / **Phone** / **URL** |
| `boolean`, `bool` | **Decision Box** |
| `enum`, `select`, `dropdown` | **Dropdown** |
| `multiselect` | **Multi-Select** |
| `uuid`, `auto` | **Auto Number** |
| `fk:Form` | **Single Select Lookup** (`Form.ID`) |
| `fk:Form` + `multi` | **Multi-Select Lookup** |
| `subform` | **Subform** |
| `file`, `image` | **File Upload** / **Image** |

## 4b. Creator Constructs Reference

| Construct | What it is | When to use |
|---|---|---|
| **Form** | Data entity + UI form + table | Every business entity |
| **Report** | View over form data (9 types) | Every "list", "view", "kanban", etc. |
| **Page** | Dashboard / composite screen | Home, dashboards, operational screens |
| **Workflow** | Single-event automation | On submit, on edit, validation, send email |
| **Approval Workflow** | Multi-level human approval | Manager → Finance → Director approvals |
| **Blueprint** | State-machine / process flow | Multi-stage record lifecycle (Draft→Approved→Shipped) |
| **Batch Workflow** | Bulk record processor | "Process all pending", "Monthly update all accounts" |
| **Schedule** | Time-triggered Deluge | Daily reports, nightly sync, weekly alerts |
| **Custom Function** | Reusable Deluge function | Shared logic, API calls, calculations |
| **Connection** | OAuth/API key to 3rd party | Zoho CRM, Stripe, Twilio, etc. |
| **Public API** | REST endpoint from Creator | External system integration |

### Blueprint vs Workflow disambiguation

- **Blueprint** → BRD says: "stages", "transitions", "moves to", "lifecycle", "approval flow with multiple steps", "process flow", "track current phase"
- **Workflow** → BRD says: "when submitted", "send email on add", "validate before save", "single-event automation"
- **Batch Workflow** → BRD says: "process all", "bulk update", "for all records where", "mass email", "nightly batch"
- **Schedule** → BRD says: "daily at", "every week", "monthly job", "time-based", "nightly" (without specific form context)

## 5. Prompt-DSL grammar (v2 — Creator)

The DSL is line-based. Each line is one command. Unknown lines are appended
verbatim under a **"Notes"** sub-heading so the user is never blocked.

```text
# ── Step 1: Application Flow ───────────────────────────────────────────────
add form: <Name> [with fields: f1, f2, ...]
remove form: <Name>
rename form: <Old> to <New>
add field to form <Name>: <field> [(type, required)]

add report: <Name> [type list|grid|kanban|calendar|timeline|map|pivot|summary] [from <Form>]
remove report: <Name>

add page: <Name> [in section <Sec>] [embeds Form: <F>, Report: <R>, ...]
remove page: <Name>

add workflow: <Name> [triggered by <Form>.<event>]
remove workflow: <Name>
rename workflow: <Old> to <New>

# ── Step 2: Data Model ─────────────────────────────────────────────────────
add lookup: <Form>.<field> -> <TargetForm> [as single|multi|subform]

# ── Step 3: Roles & Profiles ───────────────────────────────────────────────
add role: <Name> [reports to <Parent>] [— description]
add profile: <Name> [can read, write, ...] [on <Form1>, <Form2>]
remove role|profile: <Name>

# ── Step 4: Functions, Connections, Schedules, APIs ────────────────────────
add function: <Name> [returns <type>] [— purpose]
add connection: <Service> [via oauth2|apikey|basic] [— purpose]
add schedule: <Name> [runs daily|weekly|monthly|hourly] [calls <Function>]
add api: <METHOD> <path> [from <Form>] [returns <type>]

# ── Blueprints ──────────────────────────────────────────────────────────────
add blueprint: <Name> on <Form> [stages: Stage1, Stage2, Stage3, Stage4]
add stage: <StageName> to blueprint <BlueprintName>
add transition: <Name> in <Blueprint> from <FromStage> to <ToStage> [by <Role/User>]
remove blueprint: <Name>

# ── Batch Workflows ──────────────────────────────────────────────────────────
add batch: <Name> on <Form> [runs daily|weekly|monthly|on_demand] [where <criteria>]
remove batch: <Name>

# ── Step 5: NFRs & Assumptions ─────────────────────────────────────────────
add nfr: <Category> — <statement>
add assumption: <statement>
add out of scope: <statement>

# ── Application meta ───────────────────────────────────────────────────────
set application: <Name>
set timezone: Area/City
set date format: dd-MMM-yyyy
set edition: standard|professional|flex
```

### Backward-compat aliases (legacy commands still work)

| Legacy command | Routes to |
|---|---|
| `add entity: X` | `addForm` |
| `add field to entity X: …` | `addFieldToForm` |
| `add relationship: A <-> B (1-N)` | `addLookup` |
| `add module: X` | `addPage` |
| `add integration: X via Y` | `addConnection` |

> See `client/src/tools/tech-scope/lib/dsl.js` for the full pattern table
> and `applyCommands()` for reducer semantics.

## 6. Heuristic BRD parser rules

The parser turns raw BRD text into a **draft Creator scope skeleton**:

| Heuristic | Effect |
|---|---|
| `Form: X` / `Master: X` | Add Form `X` |
| Bullet list under `# Forms` heading | Add each bullet as a Form |
| `Report: X` / `View: X` | Add list-type Report |
| `list of <X>` / `view all <X>` | Add `All_<X>` list report |
| `<X> kanban view` etc. | Set Report `type` |
| `Page: X` / `<X> Dashboard` | Add Page (default section) |
| `approve`, `notify`, `escalate` … near a verb | Add Workflow with guessed event |
| `on submit`, `when created` etc. | Set workflow `event` to `on add` |
| `<A> belongs to <B>` / `<A> has many <B>` | Add Lookup |
| `admin`, `manager`, `clerk`, etc. | Add Role |
| `calculate <X>` / `compute <X>` | Add `calc_<x>` custom function |
| Mention of `Stripe`, `Slack`, `Twilio`, `Zoho CRM`, etc. | Add Connection |
| `daily job` / `every week` … | Add Schedule |
| `GET /...`, `POST /...` | Add Public API |
| `must`, `should`, `shall` | Assumption |
| `out of scope` | Append to Out-of-Scope |
| `stages`, `transitions`, `lifecycle`, `process flow`, `multi-stage` | Add Blueprint |
| `bulk update`, `batch process`, `mass email`, `for all records`, `bulk send` | Add Batch Workflow |

The parser is **liberal** — false positives are easier to delete via the
DSL than missing items are to add manually.

## 7. Things to remember

- ✅ Tool runs **fully offline** after `npm install`.
- ✅ Drafts auto-save to `localStorage` keyed by file slug.
- ✅ Mermaid renders client-side; rasterised via `html2canvas` for PDF.
- ✅ Old v1 drafts (entities/modules/apis) are auto-migrated to the v2
  Creator schema by `migrateScope()` on load — no data loss.
- ⚠️ Large BRDs (> 5 MB PDF) may be slow — pdf.js text extraction is single-threaded.
- ⚠️ DOCX with embedded images: only text is extracted (`mammoth.extractRawText`).
- ⚠️ jsPDF default font is Helvetica — emoji glyphs in tables may render as `□`
  in the PDF (still readable in the in-app preview).

## 8. Round-trip with DS Analyser

The output of this tool (a `scope` object) is structured to match the digest
that `buildTechnicalScope()` in
`functions/ds-analyzer/src/analyzer/inspect.js` emits when it inspects an
existing `.ds`. Long-term roadmap:

```text
   BRD ──┬──► Tech Scope tool ──► scope.json ──► .ds emitter ──► .ds
          │                                                       │
          └─────────────────► DS Analyser ◄──────────────────────┘
                                    │
                                    ▼
                            scope_actual.json
                                    │
                                    ▼
                       diff(scope, scope_actual)
```

When the `.ds` emitter ships, the in-app **"Verify in DS Analyser"** button
will close the loop.

## 9. Base Forms — System-Level (Present in Every Application)

> **These three forms MUST exist in every Zoho Creator application produced
> from a BRD, regardless of domain. They are injected automatically and are
> protected from removal via the DSL.**

---

### 9.1 The Three Required Base Forms

| Form | Purpose |
|---|---|
| **Users** | Application user records — who can log in and act on data |
| **User_Roles** | Role definitions — which roles exist and what they represent |
| **Email_Templates** | Reusable email content for notifications, approvals, alerts |

---

### 9.2 Canonical Field Schemas

#### `Users`

| Field name | Display Name | Type | Required | Unique | Notes |
|---|---|---|---|---|---|
| `name` | Name | Single Line | ✅ | ❌ | Full name |
| `email` | Email | Email | ✅ | ✅ | Login identifier |
| `phone` | Phone | Phone | ❌ | ❌ | |
| `role` | Role | Single Select Lookup | ✅ | ❌ | → `User_Roles.ID` |
| `status` | Status | Dropdown | ✅ | ❌ | `Active`, `Inactive`, `Pending` |

> ⛔ **Do NOT add** `last_login`, `created_time`, `modified_time`, or any
> system-timestamp fields. All forms in a Creator application are visible
> to users — system-managed timestamps clutter the UI and confuse end users.
> This rule applies to ALL forms in ALL applications, not just base forms.

---

#### `User_Roles`

| Field name | Display Name | Type | Required | Unique | Notes |
|---|---|---|---|---|---|
| `role_name` | Role Name | Single Line | ✅ | ✅ | |
| `description` | Description | Multi Line | ❌ | ❌ | |
| `permissions` | Permissions | Multi-Select | ❌ | ❌ | `Create`, `Read`, `Update`, `Delete`, `Approve`, `Export` |
| `status` | Status | Dropdown | ✅ | ❌ | `Active`, `Inactive` |

> **Seed roles** auto-created on app setup: `Admin`, `Manager`, `User`.
> The `Admin` and `User` roles carry `is_system_role` semantics (protected
> from deletion) but this is **not** a separate field — enforce it in
> workflow/Deluge logic instead.

---

#### `Email_Templates`

| Field name | Display Name | Type | Required | Unique | Notes |
|---|---|---|---|---|---|
| `template_name` | Template Name | Single Line | ✅ | ✅ | |
| `subject` | Subject | Single Line | ✅ | ❌ | Supports `${placeholder}` syntax |
| `body` | Body | Rich Text | ✅ | ❌ | Supports `${placeholder}` syntax |
| `category` | Category | Dropdown | ✅ | ❌ | `Notification`, `Approval`, `Alert`, `Welcome`, `Other` |
| `status` | Status | Dropdown | ✅ | ❌ | `Active`, `Inactive` |

> ⛔ **Do NOT use `is_active` / `Is_Active` (Checkbox / Decision Box) as
> a visibility toggle on any form.** All forms are UI-visible to users;
> a checkbox labelled "Is Active" is poor UX. Use a **Dropdown** named
> `status` with values `Active` / `Inactive` instead. This rule applies
> universally — `Email_Templates` is the canonical example, but the same
> pattern governs every master form in every application.

---

### 9.3 Design Rules That Apply to ALL Forms (Not Just Base Forms)

These rules were decided while designing the base forms but are **universal**
and must be applied every time a form is designed or reviewed:

| Rule | Correct pattern | Anti-pattern to avoid |
|---|---|---|
| **No system timestamps** | Omit `created_time`, `modified_time`, `last_login` | Adding any auto-timestamp field to a user-facing form |
| **Status over Boolean** | `status` Dropdown (`Active`/`Inactive`) | `is_active` Decision Box / CheckBox |
| **Visible-first design** | Assume every field will be shown on the form page | Hiding fields behind system flags |
| **Lookup, not raw ID** | `Single Select Lookup → User_Roles.ID` | Free-text field storing a role name |

---

### 9.4 Injection & Protection Rules (DSL Enforcement)

1. **Auto-injection**: When a BRD is parsed, if `Users`, `User_Roles`, or
   `Email_Templates` are absent from the extracted `forms[]`, they are
   merged in automatically using the schemas above.
2. **Merge, don't duplicate**: If the BRD already mentions a `Users` form,
   BRD-defined fields win on conflict; system base fields are added if
   missing.
3. **DSL protection**: `remove form: Users`, `remove form: User_Roles`, and
   `remove form: Email_Templates` are rejected with:
   `"Users is a required system base form and cannot be removed."`.
   Renaming is allowed.
4. **Cross-app replication**: In Creator each application has its own
   database. These forms are **replicated per application** — they are not
   a shared auth layer. Surface this as an info note in the UI.

---

### 9.5 Visual Treatment in Step 1 (Architecture View)

- Base forms are shown in a **pinned card** at the top of Step 1 with a
  🔧 icon and the subtitle *"System base forms — present in every
  application"*.
- They appear **before** BRD-derived subject areas.
- They cannot be reordered below domain forms.

---

## 10. User Notes

> _Append your own learnings below. Each entry should be dated._

- _2025-XX-XX — Initial Creator-format release (schemaVersion 2)._
- _2025-XX-XX — §9 added: Three universal base forms (`Users`, `User_Roles`,
  `Email_Templates`) with locked field schemas. Key decisions: (1) No
  system-timestamp fields (`last_login`, `created_time`) on any form —
  all forms are UI-visible. (2) Use `status` Dropdown (`Active`/`Inactive`)
  instead of `is_active` Decision Box on every form — better UX. Both rules
  apply globally, not just to base forms._
