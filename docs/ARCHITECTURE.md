# Architecture

## Request Flow

```
Browser (React SPA)
  │  POST /api/analyze  (multipart: ds + requirement | requirementUrl)
  ▼
Catalyst Advanced I/O Function  (ds-analyzer)
  │
  ├─ multer       → in-memory buffers (no disk write)
  ├─ dsParser     → normalised JSON { forms, reports, workflows, ... }
  ├─ reqParser    → plain text (PDF / DOCX / URL → CSV/HTML/PDF)
  │
  ├─ loadRules()  → /rules/*.md  (injected into system prompt)
  │
  ├─ llm/router.js
  │     ├─ openai     (best JSON)
  │     ├─ anthropic  (longest context)
  │     ├─ zoho       (Catalyst AI / Zia)
  │     └─ stub       (always available fallback)
  │
  ├─ zod schema validation (retry once on failure)
  │
  ▼
JSON response → React dual-view renderer
```

## Why this shape?

- **Stateless functions** → Catalyst can cold-start cheaply; no file-system state.
- **Rules as MD** → PMs/architects can tweak parsing + LLM behaviour without redeploy.
- **Router pattern** → swap/disable any LLM provider via env vars; stub guarantees the app works locally.
- **Zod schema + retry** → LLMs occasionally drift; we validate + re-prompt, not crash.

## Security posture (v0.1)

| Concern | Mitigation |
|---|---|
| Arbitrary file upload | MIME + extension allowlist, size cap via `MAX_UPLOAD_MB` |
| Zip bomb / path traversal | Per-entry size cap, `safeEntryName()` sanitiser |
| SSRF via requirementUrl | Protocol allowlist, private-IP hostname blocklist, redirect limit |
| Prompt injection leaking secrets | Deluge scripts truncated, tokens/credentials stripped before prompt |
| Rate abuse | `express-rate-limit` 10 req/min/IP on `/api/analyze` |
| Error disclosure | Stack traces only in non-prod; central error handler |
| Secrets in client | All LLM keys server-side; frontend never sees them |

## Future hardening

- Catalyst Auth (JWT) gating `/api/analyze`
- Catalyst Data Store — persist analysis history per project
- Virus scan (ClamAV function) before parsing uploads
- Output signing so PMs can verify the report wasn't altered
