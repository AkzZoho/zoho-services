# DS Parser Rules

> This file tells the parser how to interpret a Zoho Creator `.ds` export.
> **Edit this file as you discover structure in sample `.ds` files — no code change or redeploy needed.**
> The parser loads this file at runtime.

---

## 1. File Format Assumptions

_Update these once a real sample is inspected._

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

_Extend as new types are encountered in samples._

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
