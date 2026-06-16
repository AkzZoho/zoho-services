# DS Parser Rules

> This file tells the parser how to interpret a Zoho Creator `.ds` export.
> **Edit this file as you discover new structure in real `.ds` files — no code change or redeploy needed.**
> The parser loads this file at runtime. Canonical display-name learnings
> live in [`docs/shared/creator-semantics/form-field-types.md`](../docs/shared/creator-semantics/form-field-types.md).

---

## 1. File Format Assumptions

_Confirmed against real `.ds` exports during analysis work; revisit if
Creator changes the export format._

- [ ] `.ds` is a **ZIP archive** — set `format: "zip"`
- [ ] `.ds` is a **single XML document** — set `format: "xml"`
- [ ] `.ds` is a **single JSON document** — set `format: "json"`
- [ ] `.ds` is **proprietary / binary** — set `format: "binary"` and document signature bytes

Current assumption: **`zip` containing XML/JSON manifest** (most common Creator export).

## 2. Entities to Extract

The parser should produce a normalised structure:

```json
{
  "application": { "name": "", "namespace": "", "version": "" },
  "forms": [
    {
      "name": "",
      "displayName": "",
      "fields": [
        { "name": "", "type": "", "required": false, "unique": false, "default": "", "lookup": null }
      ],
      "validations": [],
      "workflows": []
    }
  ],
  "reports": [
    { "name": "", "type": "list|summary|calendar|kanban", "baseForm": "", "columns": [], "filters": [] }
  ],
  "pages": [
    { "name": "", "components": [] }
  ],
  "workflows": [
    { "name": "", "trigger": "onCreate|onEdit|onDelete|scheduled|button", "target": "", "script": "" }
  ],
  "connections": [],
  "roles": [],
  "customFunctions": []
}
```

## 3. Known XML/JSON Key Mappings

_Fill in after inspecting a sample._

| DS key/element | Normalised entity | Notes |
|---|---|---|
| `<form>` or `"form"` | `forms[]` | TBD |
| `<field type="...">` | `forms[].fields[]` | TBD |
| `<view>` / `<report>` | `reports[]` | TBD |
| `<workflow>` | `workflows[]` | TBD |
| `<deluge>` | `workflows[].script` | Script body |

## 4. Field Type Mapping

Map Creator's internal type codes to human-readable types:

| Internal code | Human type |
|---|---|
| `SINGLE_LINE` | Single Line |
| `MULTI_LINE` | Multi Line |
| `EMAIL` | Email |
| `PHONE` | Phone |
| `NUMBER` | Number |
| `DECIMAL` | Decimal |
| `DATE` | Date |
| `DATE_TIME` | Date-Time |
| `DROPDOWN` | Dropdown |
| `LOOKUP` | Lookup |
| `FILE_UPLOAD` | File Upload |

_Extend as new types are encountered. The canonical display-name mapping
lives in [`docs/shared/creator-semantics/form-field-types.md`](../docs/shared/creator-semantics/form-field-types.md);
keep both files in sync._

## 5. Safe Parsing Rules

- Always sanitise file names before extracting ZIP entries (prevent path traversal).
- Reject files > `MAX_UPLOAD_MB`.
- Strip any embedded Deluge scripts longer than 50 KB before sending to LLM; summarise instead.
- Redact any OAuth tokens, secrets, or connection credentials found in the DS before logging.

## 6. Parse Failure Behaviour

If a section cannot be parsed:
- Emit a `warnings[]` entry with the section path.
- Continue parsing other sections.
- Never fail the whole request for one bad form.
