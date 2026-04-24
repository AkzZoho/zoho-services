# DS Analyzer

AI-powered dataset analyzer built on Zoho Catalyst.

## Stack
- **Frontend:** React + Vite (Catalyst Web Client Hosting)
- **Backend:** Node.js 18 + Express (Catalyst Advanced I/O Function)
- **Deploy:** GitHub → Catalyst auto-deploy on push to `main`

## Structure
- `client/` — React + Vite frontend
- `functions/ds-analyzer/` — Express Advanced I/O function

## Local dev
```bash
npm install --prefix functions/ds-analyzer
npm install --prefix client
catalyst serve
```

## Env vars (set in Catalyst Console → Function → Environment)
- `OPENAI_API_KEY`
- `MAX_UPLOAD_MB` (default 25)
- `NODE_ENV=production`

## Deploy
Push to `main` → Catalyst auto-deploys.
Manual: `catalyst deploy`
