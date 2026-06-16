---
name: ds-analyser
title: DS Analyser — Zoho Creator .ds Inspector
version: 0.3.0
status: active
owner: Zoho Services Tools
tags: [zoho-creator, ds-export, static-analysis, performance-audit, schema, no-llm]
---

# Skill: DS Analyser

> A deterministic skill that parses a **Zoho Creator application export
> (`.ds` file)** and returns a complete, machine-readable breakdown of the
> application — forms, reports, pages, workflows, permission sets, a schema
> relationship graph, and a rule-based performance audit — in a **single
> HTTP call**, with **no LLM required** for the core flow.

---

## 1. When to use this skill

Use DS Analyser whenever you have a `.ds` export and need to answer questions
such as:

- "What forms, reports, pages, and workflows exist in this app, and how do
  they relate?"
- "Show me the Deluge source of a workflow and explain what it does."
- "Which forms link to which via lookup fields?" (schema graph)
- "What performance / schema anti-patterns does this app contain?"
- "Who can do what?" (permission-set matrix)

**Do not use it for:** generating change suggestions against a requirement
document (that was the deprecated `/api/analyze` two-step flow), or for
parsing anything other than a Creator `.ds` export.

| You want… | Use |
|-----------|-----|
| A full structural + performance breakdown of a `.ds` | **This skill** (`/api/inspect`) |
| Find every place an entity/field name is used | `find-usages` (`/api/find-usages`) |
| A developer change sheet from a plain-English prompt | `change-request` (`/api/change-request`) |
| BRD → technical scope | Tech Scope tool (separate skill) |

---

## 2. Inputs

| Input | Type | Required | Notes |
|-------|------|----------|-------|
| `ds` | file (multipart field) | ✔ | A Zoho Creator `.ds` export. Filename **must** match `^[A-Za-z0-9._ \-()]+\.ds$` (extension allowlist + traversal/control-char rejection). |

**Constraints**

- Max size: `MAX_UPLOAD_MB` (default **25 MB**); exactly **one** file per call.
- File is buffered in memory only — never written to disk.
- ZIP-wrapped `.ds` is supported; per-entry cap is 5 MB (ZIP-bomb guard).

---

## 3. How to invoke

### 3.1 HTTP (the canonical interface)

```
POST /api/inspect
Content-Type: multipart/form-data
Body: ds=<file>.ds
```

**cURL**

```bash
curl -X POST http://localhost:3001/api/inspect \
  -F "ds=@./MyApp.ds"
```

**fetch (browser / client)**

```js
const form = new FormData();
form.append('ds', file); // file is a .ds File/Blob
const res = await fetch('/api/inspect', { method: 'POST', body: form });
const result = await res.json();
```

### 3.2 Liveness check

```bash
curl http://localhost:3001/health   # → { "status": "ok" }
```

---

## 4. Outputs

A single JSON object containing **all views** (abridged):

```jsonc
{
  "ok": true,
  "meta":  { "provider": "deterministic|stub|openai|...", "fileName": "..." },
  "app":   { "name": "", "namespace": "", "version": "" },
  "stats": { "entityCounts": {}, "fields": {} },

  "forms": [ /* fields, related reports/pages/workflows */ ],
  "reports": [...],
  "pages": [...],
  "workflows": [ /* incl. Deluge source */ ],
  "customFunctions": [...],
  "roles": [...],

  "technicalScope": {
    "forms": [{ "...": "...", "workflows": [...] }],
    "relationships": [...],
    "edgesByEntity": {}
  },

  "performance": {
    "summary":  { "total": 0, "critical": 0, "warning": 0, "info": 0, "highImpact": 0 },
    "byCategory": {}, "byRule": {},
    "findings": [...], "topImpact": [...], "volumeTiers": [...]
  },

  "overview": {
    "headline": "...", "purpose": "...",
    "keyEntities": [...], "automation": "...", "risks": [...]
  }
}
```

**Three consumer views** map onto this payload:

| View | Source field(s) | Audience |
|------|-----------------|----------|
| 🗂 Application Breakdown | `forms`, `reports`, `pages`, `workflows`, `roles` | Everyone |
| 🧩 Schema graph | `technicalScope.relationships`, `edgesByEntity` | Developers / Architects |
| ⚡ Performance Report | `performance.*` | Developers / Architects |

**Error shape** (uniform):

```json
{ "error": "human message", "code": "MACHINE_CODE" }
```

---

## 5. Pipeline (what happens internally)

```
multipart upload
   → multer (in-memory buffer, .ds allowlist)
   → dsParser            (DSL tokenise → normalised JSON; ZIP/JSON/XML fallback)
   → analyzer/inspect    (stats + digests + technicalScope + optional LLM summary)
   → analyzer/performance(deterministic rule audit, 25+ rules)
   → one JSON response
```

- **Deterministic by default.** Parsing rules live in
  `functions/ds-analyzer/src/ds-analyser/rules/ds-parser-rules.md`; audit
  rules live in `rules/Performance_Matrix.md`. Both are editable Markdown —
  behaviour changes **without** a redeploy.
- The Deluge **code-walker** (`describeWorkflow`) turns each workflow's
  source into plain-English steps. The statement→English mapping is in
  [`../shared/deluge-reference.md`](../shared/deluge-reference.md) and must
  stay in sync with `describeStatement`.

---

## 6. Configuration

Copy `.env.example` → `.env` in `functions/ds-analyzer/`.

| Variable | Purpose | Default |
|----------|---------|---------|
| `MAX_UPLOAD_MB` | Upload size cap | `25` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated CORS allowlist | all origins |
| `OPENAI_API_KEY` | Enables LLM narrative summary (OpenAI) | — |
| `ANTHROPIC_API_KEY` | Enables LLM narrative summary (Anthropic) | — |
| `ZOHO_ZIA_KEY` | Enables LLM narrative summary (Zoho Zia) | — |

> **No keys needed.** With no provider key set, the `overview` narrative
> falls back to a deterministic rule-based summary — the skill is fully
> functional offline.

---

## 7. Running locally

```bash
# Install everything (root + client + function)
npm run install:all

# Backend API (port 3001)
npm run dev:server

# Frontend SPA (port 5173, proxies /api → 3001)
npm run dev:client

# Backend tests
npm test
```

Source locations:

| Layer | Path |
|-------|------|
| Backend route | `functions/ds-analyzer/src/ds-analyser/routes/inspect.js` |
| Parser | `functions/ds-analyzer/src/ds-analyser/parsers/dsParser.js` |
| Analyzer | `functions/ds-analyzer/src/ds-analyser/analyzer/inspect.js` |
| Performance | `functions/ds-analyzer/src/ds-analyser/analyzer/performance.js` |
| Frontend | `client/src/tools/ds-analyser/` |
| Runtime rules | `functions/ds-analyzer/src/ds-analyser/rules/` |

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `400 Unsupported file type: only .ds files are allowed` | Filename doesn't end in `.ds`, or contains control chars / a path like `../x.ds` | Rename to a clean `<name>.ds`; the basename must match `^[A-Za-z0-9._ \-()]+\.ds$`. |
| `400 Missing required file: ds` | Multipart field not named `ds`, or sent as JSON | Send `multipart/form-data` with the field literally named `ds`. |
| `413` / file rejected by size | File exceeds `MAX_UPLOAD_MB` | Raise `MAX_UPLOAD_MB`, or split/trim the export. |
| Workflow source present but "What this code does" is sparse / "+N more not shown" | Statement not yet recognised by `describeStatement` | Add the pattern to the code-walker **and** the row in `deluge-reference.md`. |
| `overview` reads generic / templated | No LLM provider key set | Expected — that's the deterministic fallback. Set a provider key for richer prose. |
| CORS error in browser | Origin not in allowlist | Add it to `CORS_ALLOWED_ORIGINS`, or unset the var to allow all. |
| `429 Too many requests` | Rate limit (10 req/min/IP) tripped | Wait a minute; the limiter is disabled under `NODE_ENV=test`. |
| Empty / partial entity lists | `.ds` uses a construct the parser doesn't yet cover | Check `meta`/parser warnings; extend `ds-parser-rules.md` + `dsParser.js`. |

---

## 9. Guarantees & boundaries

- **Read-only.** The skill never mutates the uploaded `.ds` or any file.
- **No secrets to the client.** All LLM keys are server-side only.
- **Deterministic core.** Forms/reports/pages/workflows/schema/performance
  are produced without any model; only the optional `overview` narrative may
  use an LLM.
- **Out of scope:** Creator domain vocabulary (see
  [`../shared/creator-semantics/`](../shared/creator-semantics/)),
  requirement-driven change planning (deprecated `/api/analyze`), and
  speculative change suggestions.

---

## 10. Related docs

- [`application.md`](./application.md) — full application documentation.
- [`architecture.md`](./architecture.md) — request flow + design rationale.
- [`flowchart.md`](./flowchart.md) — Mermaid sequence/flow diagrams.
- [`find-usages.md`](./find-usages.md) — the companion find-usages skill.
- [`../shared/deluge-reference.md`](../shared/deluge-reference.md) — Deluge → English mapping.
