# Creator DS Analyser

A tool to analyse Zoho Creator `.ds` exports against a requirement document (PDF / DOCX / Zoho Sheet link) and produce a **dual-view change report**:

- 🧑‍💼 **PM View** — plain-English summary of what will change
- 👨‍💻 **Developer View** — exact forms, fields, workflows, Deluge scripts to add/modify

Hosted on **Zoho Catalyst**.

---

## 🏗️ Architecture

```
Creator - DS Analyser/
├── client/                 # React + Vite + Tailwind frontend
├── functions/
│   └── ds-analyzer/        # Catalyst Advanced I/O function (Node.js/Express)
│       ├── src/
│       │   ├── parsers/    # .ds, pdf, docx, zoho-sheet parsers
│       │   ├── llm/        # Multi-provider LLM router
│       │   ├── analyzer/   # Change-detection orchestration
│       │   └── routes/     # Express routes
│       └── tests/          # Unit + integration tests
├── rules/                  # Editable MD rules for parser + LLM
│   ├── ds-parser-rules.md
│   └── llm-prompt-rules.md
├── samples/                # Place sample .ds + requirement docs here
└── catalyst.json
```

## 🧠 LLM Router

Automatically picks the best provider per task:

| Task | Provider |
|---|---|
| Long-doc comprehension | Anthropic Claude |
| Structured JSON extraction | OpenAI GPT-4o |
| PM-friendly summaries | Zoho Zia (Catalyst AI) |
| Fallback (no keys) | Local stub |

## 🚀 Quick Start

```bash
# Install dependencies
npm run install:all

# Run backend locally (Catalyst function emulator)
npm run dev:server

# Run frontend
npm run dev:client
```

See `.env.example` for required environment variables.

## 📤 Deployment

```bash
catalyst deploy
```

> ⚠️ **Before every commit**, read [`docs/DEPLOYMENT_LEARNINGS.md`](docs/DEPLOYMENT_LEARNINGS.md).
> It covers the Golden Pre-Commit Checklist, Vite build-time env var gotchas,
> `client/dist/` rebuild rules, CORS setup, and a step-by-step production 404
> debugging playbook. **Most deployment bugs we've hit are already documented there.**

## 📝 Status

**v0.1 — Scaffolding**. Awaiting sample `.ds` files to finalise the parser rules.
