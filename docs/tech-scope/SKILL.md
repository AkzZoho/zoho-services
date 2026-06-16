---
name: tech-scope
title: Tech Scope Creator — BRD → Zoho Creator Technical Scope
version: 0.2.0
status: active
owner: Zoho Services Tools
tags: [zoho-creator, brd, technical-scope, prompt-dsl, offline-first, ai-optional]
---

# Skill: Tech Scope Creator

> A **client-side-first** skill that turns an uploaded **BRD / requirement
> document** (`.txt`, `.md`, `.pdf`, `.docx`) into a **Zoho Creator
> Technical Scope Document** across **5 reviewable steps**, editable through
> a deterministic **prompt-DSL** and exportable to a **packed PDF**. It runs
> **fully offline** after install; optional server-side LLM routes only
> *enhance* extraction and prompt translation, and always **fall back** to
> the deterministic engine.

---

## 1. When to use this skill

Use Tech Scope when you start from a **requirement document** and need a
structured, Creator-flavoured scope you can review and refine:

- "Turn this BRD into a Creator app scope — forms, reports, pages, workflows."
- "What lookups / data model does this requirement imply?"
- "Draft roles, profiles, functions, connections, schedules and public APIs."
- "Adjust the scope structurally without writing JSON" (the prompt-DSL).
- "Export the agreed scope as a PDF with an embedded flowchart."

**Do not use it for:** inspecting an existing Creator `.ds` export — that is
the **DS Analyser** skill ([`../ds-analyser/SKILL.md`](../ds-analyser/SKILL.md)).

| You want… | Use |
|-----------|-----|
| BRD → reviewable Creator scope (5 steps) + PDF | **This skill** (client-side wizard) |
| Adjust a step structurally, no JSON | prompt-DSL (`parsePrompt` → `applyCommands`) |
| Better-than-heuristic first draft | optional `POST /api/extract-scope` |
| Natural-language edit → DSL commands | optional `POST /api/apply-prompt` |
| Inspect a built `.ds` (the round-trip back half) | DS Analyser skill |

---

## 2. Inputs

| Input | Type | Required | Notes |
|-------|------|----------|-------|
| BRD file | `.txt` · `.md`/`.markdown` · `.pdf` · `.docx` | ✔ (or start blank) | Parsed **in-browser** by `parseBRD()`. Unknown extensions are rejected; extracted text must be ≥ 20 chars. |
| Title | string | — | Optional app title; defaults to source filename. |
| Use AI | boolean | — | When on, tries the server extractor first, then falls back to local heuristics. |

**Constraints**

- PDF text via `pdfjs-dist`; DOCX via `mammoth.extractRawText` (**text only** —
  embedded images are dropped).
- For the optional AI extract route, `brdText` is capped at **1,000,000 bytes**.
- Large PDFs (> ~5 MB) are slow — pdf.js text extraction is single-threaded.

---

## 3. How to invoke

### 3.1 Primary interface — the in-app wizard (client-side)

The canonical entry point is the React tool at route `/tech-scope/*`
(`TechScopeApp.jsx`). Flow:

```
Upload BRD (or "Start blank")
   → parseBRD(file)                 # extract text in-browser
   → deriveScope(text)              # deterministic heuristic skeleton
       (or POST /api/extract-scope  # optional AI first draft, falls back)
   → 5-step wizard (review + edit via prompt-DSL or free text)
   → export packed PDF
```

Drafts **auto-save to `localStorage`** keyed by a file slug
(`slotIdFromFile`), and **v1 drafts are auto-migrated** to schema v2 via
`migrateScope()` on load — no data loss.

### 3.2 Optional server routes (AI enhancement only)

Both routes are **opt-in** and return `501 { useFallback: true }` when no LLM
provider is configured, so the tool keeps working offline.

```
POST /api/extract-scope
Content-Type: application/json
{ "brdText": "<raw BRD text>", "title": "My App", "sourceFile": "brd.pdf" }
→ { "provider": "...", "scope": {...}, "warnings": [...] }
→ 501 { "useFallback": true, "reason": "..." }   # no provider → use heuristics

POST /api/apply-prompt
Content-Type: application/json
{ "instruction": "add a Refunds form with amount and reason", "stepId": "step1", "scope": {...} }
→ { "provider": "...", "commands": ["add form: Refunds ..."], "explanation": "...", "confidence": 0.9 }
→ 501 { "useFallback": true, "reason": "..." }   # no provider → use raw DSL
```

`stepId` must be one of `step1…step5`; `instruction` is capped at 5000 chars.
The client (`aiDsl.js`) routes returned `commands` back through the **same
deterministic DSL reducer** — the AI only *suggests* commands; the
deterministic engine *applies* them.

---

## 4. Outputs

The in-memory artifact is a versioned **`scope` object** (`schemaVersion: 2`,
see `emptyScope()`):

```jsonc
{
  "schemaVersion": 2,
  "meta": { "title": "...", "sourceFile": "...", "createdAt": "...", "updatedAt": "...",
            "provenance": { "source": "heuristic|ai", "provider": null, "warnings": [] } },
  "application": { "name": "", "dateFormat": "dd-MMM-yyyy", "timeZone": "Asia/Kolkata",
                   "timeFormat": "24-hr", "edition": "professional" },

  "forms": [ /* fields w/ canonical Creator types, lookups, actionEvents */ ],
  "reports": [...], "pages": [...], "workflows": [...], "lookups": [...],
  "roles": [...], "profiles": [...],
  "customFunctions": [...], "connections": [...],
  "blueprints": [...], "batchWorkflows": [...], "schedules": [...], "publicAPIs": [...],

  "nfrs": [...], "assumptions": [...], "outOfScope": [...],
  "notes": { "step1": [], "step2": [], "step3": [], "step4": [], "step5": [] }
}
```

**The 5 steps** map onto this object:

| # | Step | `scope` fields surfaced |
|---|------|-------------------------|
| 1 | Application Flow | `forms`, `reports`, `pages`, `workflows` |
| 2 | Data Model | `forms[].fields`, `lookups` |
| 3 | Roles & Profiles | `roles`, `profiles`, page access |
| 4 | Functions, Connections & Schedules | `customFunctions`, `connections`, `blueprints`, `batchWorkflows`, `schedules`, `publicAPIs` |
| 5 | NFRs & Assumptions | `application.edition`, `nfrs`, `assumptions`, `outOfScope` |

**Final deliverable:** a **packed PDF** (markdown content + rasterised Mermaid
flowchart, via `jspdf` + `html2canvas`) plus per-step markdown.

**System base forms (always present):** `Users`, `User_Roles`,
`Email_Templates` are auto-injected (`injectBaseForms`) and **protected from
DSL removal** (renaming allowed). See
[`../shared/creator-semantics/base-forms.md`](../shared/creator-semantics/base-forms.md).

---

## 5. The prompt-DSL (the deterministic edit interface)

Line-based; one command per line; **unknown lines are appended verbatim**
under a *Notes* sub-heading so the user is never blocked. Highlights:

```text
add form: <Name> [with fields: f1, f2, ...]
add field to form <Name>: <field> [(type, required)]
add report: <Name> [type list|grid|kanban|calendar|timeline|map|pivot|summary] [from <Form>]
add page: <Name> [in section <Sec>] [embeds Form: <F>, Report: <R>]
add workflow: <Name> [triggered by <Form>.<event>]
add lookup: <Form>.<field> -> <TargetForm> [as single|multi|subform]
add role|profile: <Name> ...
add function|connection|schedule|api: ...
add blueprint: <Name> on <Form> [stages: A, B, C]
add batch: <Name> on <Form> [runs daily|weekly|monthly|on_demand]
add nfr|assumption|out of scope: ...
set application|timezone|date format|edition: <value>
```

- Canonical field-type labels come from a single source of truth,
  `client/src/tools/ds-analyser/lib/fieldTypes.js`, so the vocabulary matches
  what DS Analyser emits (round-trip diffability).
- Legacy v1 commands (`add entity`, `add module`, `add integration`, …) are
  aliased to their v2 equivalents.
- Full grammar + reducer semantics: `lib/dsl.js` (`parsePrompt`,
  `applyCommands`) and [`overview.md`](./overview.md) §5.

---

## 6. Pipeline (what happens internally)

```
file → parseBRD()                       # txt/md native · pdf(pdfjs) · docx(mammoth)
     → deriveScope() [heuristics.js]     # liberal BRD → scope skeleton
        └─(optional) /api/extract-scope  # LLM first draft, 501→fallback
     → injectBaseForms()                 # Users/User_Roles/Email_Templates
     → wizard edits:
          prompt-DSL  → parsePrompt → applyCommands   (deterministic)
          free text   → direct markdown
          NL prompt   → /api/apply-prompt → commands → same DSL reducer
     → migrateScope() on load (v1 → v2)
     → exportPdf()  [jspdf + html2canvas + mermaid SVG]
```

- **Deterministic by design.** The heuristic parser is intentionally
  *liberal* (false positives are easy to delete via the DSL); every AI path
  degrades gracefully to the offline engine.
- Heuristic rule table + Blueprint/Batch/Schedule disambiguation:
  [`overview.md`](./overview.md) §6 and §4b.

---

## 7. Configuration

The tool needs **no configuration** to run. The optional AI routes live in the
shared backend (`functions/ds-analyzer/`); copy its `.env.example` → `.env`.

| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENAI_API_KEY` | Enables AI scope extraction / prompt translation (OpenAI) | — |
| `ANTHROPIC_API_KEY` | Same, via Anthropic | — |
| `ZOHO_ZIA_KEY` | Same, via Zoho Zia | — |
| `CORS_ALLOWED_ORIGINS` | Comma-separated CORS allowlist for the API | all origins |

> **No keys needed.** With no provider set, both `/api/extract-scope` and
> `/api/apply-prompt` return `501 { useFallback: true }` and the client uses
> the local heuristic extractor and raw DSL parser respectively.

---

## 8. Running locally

```bash
# Install everything (root + client + function)
npm run install:all

# Frontend SPA (port 5173) — the tool itself
npm run dev:client

# Backend API (port 3001) — ONLY needed for the optional AI routes
npm run dev:server

# Tests
npm test                       # backend (incl. extract-scope / apply-prompt)
# client lib tests live under client/src/tools/tech-scope/lib/__tests__/*.mjs
```

Source locations:

| Layer | Path |
|-------|------|
| Frontend app | `client/src/tools/tech-scope/TechScopeApp.jsx` |
| BRD parser | `client/src/tools/tech-scope/lib/parseBRD.js` |
| Heuristic extractor | `client/src/tools/tech-scope/lib/heuristics.js` |
| Scope schema + migration | `client/src/tools/tech-scope/lib/scope.js` |
| Prompt-DSL | `client/src/tools/tech-scope/lib/dsl.js` |
| AI bridge (client) | `client/src/tools/tech-scope/lib/aiDsl.js` |
| Draft storage | `client/src/tools/tech-scope/lib/storage.js` |
| PDF export | `client/src/tools/tech-scope/lib/exportPdf.js` |
| Optional AI routes | `functions/ds-analyzer/src/tech-scope/routes/{extractScope,applyPrompt}.js` |

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Unsupported file type ".xyz"` | Extension not in `txt/md/markdown/pdf/docx` | Convert the BRD to a supported format. |
| `The file appears to contain no extractable text.` | Scanned/image-only PDF, or DOCX with only images | Provide a text-based document; OCR is not performed. |
| AI toggle on but draft is heuristic | No provider key → route returned `501 useFallback` | Expected offline behaviour; set a provider key for AI drafts. |
| `413 brdText exceeds 1000000 bytes` | BRD text too large for the AI route | Trim the BRD, or rely on the client-side heuristic path (no size cap). |
| `400 stepId must be one of: step1…step5` | Invalid `stepId` to `/api/apply-prompt` | Send a valid step id. |
| DSL line "ignored" but shows under *Notes* | Command didn't match the grammar | Check the pattern table in `lib/dsl.js` / [`overview.md`](./overview.md) §5. |
| `remove form: Users` rejected | `Users`/`User_Roles`/`Email_Templates` are protected base forms | Rename instead of removing. |
| Emoji renders as `□` in the PDF | jsPDF default font is Helvetica | Cosmetic — the in-app preview renders correctly. |
| Old draft loads with missing fields | v1 draft auto-migrated | Expected — `migrateScope()` fills v2 defaults; review and adjust. |

---

## 10. Guarantees & boundaries

- **Offline-first.** Full extraction, editing and PDF export work with **no
  backend and no API keys**.
- **AI is additive, never required.** Every AI path degrades to the
  deterministic engine; the AI only *suggests* DSL commands which the
  deterministic reducer applies.
- **Liberal extraction.** Over-generation is intentional — prune via the DSL.
- **Base forms enforced.** `Users` / `User_Roles` / `Email_Templates` are
  always injected and protected.
- **Round-trip aligned.** Output vocabulary mirrors DS Analyser so a future
  *BRD → Tech Scope → `.ds` → DS Analyser → diff* loop stays diffable
  ([`overview.md`](./overview.md) §8).

---

## 11. Related docs

- [`overview.md`](./overview.md) — design log · full DSL grammar · heuristics · gotchas. **Start here for code changes.**
- [`forms-and-lookups.md`](./forms-and-lookups.md) — non-negotiable Forms/Lookups rules.
- [`steps/`](./steps/) — one doc per wizard step.
- [`../ds-analyser/SKILL.md`](../ds-analyser/SKILL.md) — the companion DS Analyser skill (round-trip back half).
- [`../shared/creator-semantics/`](../shared/creator-semantics/) — canonical Creator vocabulary.
