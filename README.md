# Zoho Services Tools

A growing collection of internal tools for the Zoho Services team. The suite is
a plain **Node + Express + Vite** monorepo — runs locally, deploys to any host
(VPS, Render, Railway, Fly, Vercel, Cloudflare, your own box).

## 🧰 Tools

| ID | Name | Status | Description |
|---|---|---|---|
| `ds-analyser` | **Creator DS Analyser** | Stable | Upload a Zoho Creator `.ds` export → instant schema breakdown, performance audit, AI-powered change planning. |
| `tech-scope` | **Technical Scope Creator** | Beta | Upload a BRD (PDF/DOCX/MD/TXT) → 5-step reviewable technical scope, exported as a packed PDF with embedded flowchart. |

## 🏗️ Architecture

```
Zoho_Services/                    # workspace root
├── client/                       # React + Vite + Tailwind frontend (all tools)
│   └── src/tools/
│       ├── ds-analyser/          # Tool 1 — DS Analyser SPA
│       └── tech-scope/           # Tool 2 — Tech Scope Creator SPA
├── functions/
│   └── ds-analyzer/              # Node + Express API (all tools)
│       ├── src/
│       │   ├── ds-analyser/      # routes + parsers + analyser
│       │   ├── tech-scope/       # routes
│       │   ├── shared/llm/       # multi-provider LLM router
│       │   ├── app.js            # Express app
│       │   └── server.js         # entrypoint
│       └── tests/                # Jest unit + integration tests
├── docs/                         # Tool-segregated documentation
└── start-local.sh                # one-shot dev launcher
```

## 🧠 LLM Router

Automatically picks the best provider per task:

| Task | Provider preference |
|---|---|
| Long-doc comprehension | Anthropic → OpenAI → stub |
| Structured JSON extraction | OpenAI → Anthropic → stub |
| Fallback (no keys) | Local stub (deterministic placeholder JSON) |

See [`functions/ds-analyzer/LLM_PROVIDERS.md`](functions/ds-analyzer/LLM_PROVIDERS.md).

## 🚀 Quick Start

```bash
# 1. Install everything
npm run install:all

# 2. Copy env templates
cp .env.example .env
cp client/.env.example client/.env
cp functions/ds-analyzer/.env.example functions/ds-analyzer/.env

# 3. Start API + client together
./start-local.sh
```

- API → http://localhost:3001/health
- Client → http://localhost:8080

## 🧪 Testing

```bash
# Backend unit + integration (Jest)
npm test
```

## 📤 Deployment (generic Node host)

1. `npm run build` → produces `client/dist/` (static SPA).
2. Run `node functions/ds-analyzer/src/server.js` on your host (or `pm2 start`,
   Docker, systemd, whatever).
3. Reverse-proxy `/api/*` and `/health` to the Node process; serve
   everything else from `client/dist/`.
4. Set env vars on the host: `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`),
   `PORT`, `CORS_ALLOWED_ORIGINS`, and the `VITE_*` build-time vars before
   running `npm run build`.

If the SPA and the API end up on different origins, set `VITE_API_BASE` to
the absolute API URL at build time and add the SPA origin to
`CORS_ALLOWED_ORIGINS` on the API.

## 📝 Status

**v0.3 — Active**. Suite trimmed to DS Analyser + Tech Scope Creator only.
