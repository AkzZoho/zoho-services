# Zoho Creator — Forms

> **Source:** Official Zoho Creator documentation + verified `.ds` corpus.
> This file is the authoritative reference for Form constructs used by the Tech Scope tool.

---

## What is a Form?

A **Form** in Zoho Creator is simultaneously:
- The **data-entry UI** (the screen users see)
- The **database table** (every form submission = one record row)
- The **trigger anchor** for all workflows and blueprints

There is no separate "table" concept — the form IS the table. Field names = column names.

---

## Form Creation Methods

| Method | When to use |
|---|---|
| Create from scratch | New data model |
| Upload a file (XLSX, CSV) | Import existing data + auto-generate form |
| From a data source | Connect to external DB |
| Duplicate an existing form | Similar structure needed |

---

## Field Types (Canonical Creator Labels)

These are the exact names used in the Creator UI and in `.ds` files.

### Basic Input Fields

| Field Type | Deluge Data Type | Notes |
|---|---|---|
| **Single Line** | TEXT | Max 255 chars by default, configurable |
| **Multi Line** | TEXT | Up to 64 KB plain text |
| **Rich Text** | TEXT | HTML-formatted text, WYSIWYG editor |
| **Number** | NUMBER | Integer; configurable max digits |
| **Decimal** | DECIMAL | Decimal precision configurable |
| **Currency** | DECIMAL | Shows currency symbol; decimal precision |
| **Percent** | DECIMAL | Stored as decimal, shown as % |
| **Date** | DATE-TIME | Time part ignored |
| **Date-Time** | DATE-TIME | Full timestamp |
| **Time** | TIME | Time only |
| **Email** | TEXT | Validates email format |
| **Phone** | TEXT | Country code optional |
| **URL** | TEXT | Validates URL format |
| **Decision Box** | BOOLEAN | True/False toggle |

### Choice Fields

| Field Type | Deluge Data Type | Notes |
|---|---|---|
| **Dropdown** | TEXT | Single choice from list |
| **Radio** | TEXT | Single choice, radio buttons |
| **Multi-Select** | LIST | Multiple choices, stored as list |
| **CheckBox** | LIST | Multiple choices, checkbox UI |

### Relationship Fields

| Field Type | Deluge Data Type | Notes |
|---|---|---|
| **Single Select Lookup** | NUMBER | Stores record ID of linked form; display type: Dropdown or Radio |
| **Multi-Select Lookup** | LIST | Stores multiple record IDs; display type: Multi-Select or CheckBox |
| **Subform** | COLLECTION | Embedded child table; each row = one child record |

### Media / File Fields

| Field Type | Deluge Data Type | Notes |
|---|---|---|
| **Image** | TEXT (URL) | Stores image; can link or upload |
| **File Upload** | FILE UPLOAD | One or more file attachments |
| **Audio** | AUDIO | Audio recording or upload |
| **Video** | VIDEO | Video upload |
| **Signature** | TEXT | Digital signature capture |

### System / Computed Fields

| Field Type | Deluge Data Type | Notes |
|---|---|---|
| **Auto Number** | NUMBER | Auto-incrementing; e.g. `REQ-{SEQNUMBER}` |
| **Formula** | Computed | Read-only; computes from other fields |
| **Address** | Sub-fields | Structured: Line1, Line2, City, State, Postal, Country, Lat, Long |
| **Name** | Sub-fields | Structured: Prefix, First, Last, Suffix |
| **Users** | TEXT | Username of a Creator user |
| **Add Notes** | TEXT | Inline note field |
| **Section** | UI only | Visual grouping; not a data field |

### AI Fields (Creator AI Plan)

| Field Type | Notes |
|---|---|
| **Prediction** | AI-predicted value from a trained model |
| **OCR** | Extracts text from uploaded images |

---

## System Fields (Auto-generated, read-only)

Every form automatically has these — no need to add them:

| System Field | Deluge Variable | Description |
|---|---|---|
| `ID` | `record.ID` | Unique record identifier (NUMBER) |
| `Added_Time` | `record.Added_Time` | Timestamp when record was created |
| `Added_User` | `record.Added_User` | Username who created the record |
| `Modified_Time` | `record.Modified_Time` | Last edit timestamp |
| `Modified_User` | `record.Modified_User` | Username who last edited |
| `Added_IP_Address` | `record.Added_IP_Address` | IP address at creation |

---

## Form Workflow Events

Every form can trigger Deluge scripts at these points:

| Event | When it fires | Can cancel? | Scope |
|---|---|---|---|
| `on load` | Form opens in browser (before user sees it) | No | UI |
| `on user input` | User changes a specific field value | No | UI |
| `on validate` | User clicks Submit — runs BEFORE save | Yes (`cancel submit`) | UI + Server |
| `on success` | Record saved successfully — runs AFTER save | No | Server |
| `on add` | Record Created | — | Triggers context |
| `on edit` | Record Edited | — | Triggers context |
| `on add or edit` | Created OR Edited | — | Triggers context |
| `on delete` (validate) | Before deletion | Yes | Server |
| `on delete` (success) | After deletion confirmed | No | Server |
| `subform on add row` | User adds a subform row | No | UI |
| `subform on delete row` | User removes a subform row | No | UI |

**Execution order (on submit):**
```
on validate → [if passes] → record saved → on success
```

---

## Field Properties

Each field can have:
- **Display Name** — label shown in UI
- **Mandatory** — prevents save if empty
- **Unique** — no duplicate values allowed
- **Read-only / Disable** — can be conditional via field rules
- **Default value** — initial value on form load
- **Tooltip / Help text**
- **Field permissions** — show to: Everyone, Admin only, Specific profiles

---

## Deluge Field Access Syntax

```deluge
// Inside a workflow (input.* = current form being submitted)
input.Field_Name          // value user entered
input.Lookup_Field        // record ID of the selected lookup record
input.Lookup_Field.Field  // field from the looked-up record

// Inside a for-each loop
for each rec in My_Form [criteria]
{
    info rec.Field_Name;
    info rec.ID;
}

// Fetch single record
rec = My_Form[ID == someId];
val = rec.Field_Name;

// Fetch field across multiple records as list
emails = My_Form[Status == "Active"].Email.getAll();
```

---

## Subform Access in Deluge

```deluge
// Get all subform rows from a fetched record
rec = Parent_Form[ID == input.ID];
rows = rec.Subform_Field;

for each row in rows
{
    info row.Item_Name;
    info row.Quantity;
}

// Insert rows into a subform dynamically
row1 = Parent_Form.Subform_Field();
row1.Item_Name = "Laptop";
row1.Quantity = 1;

rows_col = Collection();
rows_col.insert(row1);
input.Subform_Field.insert(rows_col);
```

---

## Form Link Name

Creator auto-generates a **link name** (API name) from the form display name:
- Spaces → underscores
- Special chars removed
- Used in Deluge: `insert into My_Form_Link_Name [...]`
- Used in API: `GET /creator/v2.1/.../{form_link_name}`

---

## Best Practices for Tech Scope

- Every major **business entity** = one Form
- Use **Lookup fields** to connect forms (not redundant text fields)
- Use **Subforms** for child collections (e.g. Order Items inside an Order)
- Add `Auto Number` for human-readable IDs (e.g. `ORD-0001`)
- Put **status/stage fields** as Dropdown — they drive workflows and blueprints
- Always identify which events need Deluge (`on add`, `on edit`, `on validate`)
