# Zoho Services Tools — Client

React + Vite SPA hosting all tools in the suite.

## Stack
- **Frontend:** React 18 + Vite 5 + Tailwind 3
- **Router:** react-router-dom v6
- **Tools:** ds-analyser, tech-scope

## Structure
```
src/
├── auth/             # admin gate + tool-visibility hook
├── components/       # shared UI primitives (icons, toast)
├── shell/            # layout, landing, login, admin panel
├── theme/            # dark/light theme provider
└── tools/
    ├── ds-analyser/
    └── tech-scope/
```

## Local dev
```bash
npm install
npm run dev          # → http://localhost:8080
```

The dev server proxies `/api` and `/health` to `http://localhost:3001` (the
Node API in `functions/ds-analyzer/`). Run that in a second terminal:

```bash
npm --prefix ../functions/ds-analyzer run dev
```

…or from the repo root use `./start-local.sh` to boot both at once.

## Build
```bash
npm run build        # → dist/
npm run preview      # serve the build for a quick smoke test
```

## Env vars (build-time, Vite)
See [`.env.example`](.env.example) for the full list:
- `VITE_API_BASE` — only when SPA and API are on different origins
- `VITE_ADMIN_PASSWORD` — admin UI gate
- `VITE_PUBLIC_TOOLS` — comma-separated tool IDs visible to non-admin visitors

## Admin Panel — persisting tool visibility to `.env`

Each toggle in the Admin Panel does **two** things in sequence:

1. Writes a per-device override in `localStorage` so the change is visible
   in this browser immediately.
2. Calls `POST /api/admin/tool-visibility` on the API. The server rewrites
   the `VITE_PUBLIC_TOOLS` line inside `client/.env` in-place, preserving
   every other line, comment, and trailing newline.

The API authenticates using the `x-admin-password` header (same value as
`VITE_ADMIN_PASSWORD` on the client). The server-side variable is
`ADMIN_PASSWORD` in `functions/ds-analyzer/.env`. **The two must match** —
when they don't, the API returns `401 Invalid admin password.` and the
toggle remains local-only with a toast warning the admin.

After a successful save the response includes `restartRequired: true`. In
local dev you need to restart the Vite dev server for the new baseline to
take effect for fresh visitors. The localStorage override keeps the toggle
in sync until restart.

For production, rebuild (`npm run build`) and redeploy `client/dist/`.

### API reference

```http
POST /api/admin/tool-visibility
Content-Type: application/json
x-admin-password: <ADMIN_PASSWORD>

{ "publicIds": ["tech-scope", "ds-analyser"] }
```

Allowed tool IDs: `ds-analyser`, `tech-scope`. Unknown / non-string entries
are rejected with `400`. Empty array is valid and sets admin-only mode.

Response:
```json
{
  "ok": true,
  "key": "VITE_PUBLIC_TOOLS",
  "value": "tech-scope,ds-analyser",
  "publicIds": ["tech-scope", "ds-analyser"],
  "path": "/abs/path/to/client/.env",
  "restartRequired": true,
  "message": "Saved to client/.env. Restart the Vite dev server …"
}
```

Error codes:
- `400` invalid body (non-array, unknown ID)
- `401` missing or wrong `x-admin-password`
- `503` server has no `ADMIN_PASSWORD` configured
