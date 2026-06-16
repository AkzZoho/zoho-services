# Deployment & Debugging Learnings

> **Purpose:** A living reference of every non-obvious issue encountered while
> building and deploying this project on Catalyst. Read this **before every
> commit**, before deploying, and especially before debugging a production
> issue. Saves hours.
>
> **Scope:** Deployment, build pipeline, environment variables, CORS, Catalyst
> Slate vs. Advanced I/O Functions, and production debugging. For sample-driven
> development rules, see `LEARNING.md`.

---

## Table of Contents

1. [The Golden Pre-Commit Checklist](#the-golden-pre-commit-checklist)
2. [Architecture Recap (read this first)](#architecture-recap)
3. [Lesson 1 — Vite env vars are BUILD-TIME, not runtime](#lesson-1--vite-env-vars-are-build-time-not-runtime)
4. [Lesson 2 — Slate (static) and Catalyst Function live on different origins](#lesson-2--slate-static-and-catalyst-function-live-on-different-origins)
5. [Lesson 3 — Always include `https://` in URL env vars](#lesson-3--always-include-https-in-url-env-vars)
6. [Lesson 4 — CORS must be explicit for cross-origin SPA → Function](#lesson-4--cors-must-be-explicit-for-cross-origin-spa--function)
7. [Lesson 5 — `client/dist/` is committed; rebuild before pushing](#lesson-5--clientdist-is-committed-rebuild-before-pushing)
8. [Lesson 6 — Catalyst deployment gotchas](#lesson-6--catalyst-deployment-gotchas)
9. [Lesson 7 — Debugging a 404 on a deployed SPA](#lesson-7--debugging-a-404-on-a-deployed-spa)
10. [Lesson 8 — Testing discipline](#lesson-8--testing-discipline)
11. [**Lesson 9 — `git push` ≠ Catalyst deploy (biggest gotcha)**](#lesson-9--git-push--catalyst-deploy-biggest-gotcha)
12. [**Lesson 10 — Verify the function domain actually resolves before building**](#lesson-10--verify-the-function-domain-actually-resolves-before-building)
13. [**Lesson 11 — `catalyst.json` client ≠ Slate; they are two different services**](#lesson-11--catalystjson-client--slate-they-are-two-different-services)
14. [**Lesson 12 — `http.js` Slate-origin guard: never silently fallback on `*.onslate.in`**](#lesson-12--httpjs-slate-origin-guard-never-silently-fallback-on-onslatein)
15. [Environment Variables Reference](#environment-variables-reference)
16. [Common Commands Cheatsheet](#common-commands-cheatsheet)

---

## The Golden Pre-Commit Checklist

Run through this every time before `git commit && git push`:

- [ ] Did I change anything under `client/src/`? → **`cd client && npm run build`** and commit the new `client/dist/` in the same commit.
- [ ] Did I change a `VITE_*` env var? → **Rebuild** `client/` (env vars are baked in at build time).
- [ ] Is `VITE_API_BASE` set to the **real function URL from Catalyst Console**? → Verify with `curl -sI <url>/health` returns `200` before building.
- [ ] Did I add a new environment variable? → Document it in the [Environment Variables Reference](#environment-variables-reference) below.
- [ ] Did I change function code? → Run `cd functions/ds-analyzer && npm test`. All tests green?
- [ ] Did I change anything security-sensitive (SSRF, path traversal, auth, CORS)? → Re-read [Lesson 4](#lesson-4--cors-must-be-explicit-for-cross-origin-spa--function) and verify guards still hold.
- [ ] Does my commit message describe **what + why** (not just "fix")?
- [ ] **After git push — did I also run `catalyst deploy slate` and `catalyst deploy --only functions:ds-analyzer`?** ([Lesson 9](#lesson-9--git-push--catalyst-deploy-biggest-gotcha))

---

## Architecture Recap

```
┌──────────────────────────────────────────┐        ┌────────────────────────────────────────────────┐
│  Catalyst SLATE (static CDN)             │        │  Catalyst ADVANCED I/O FUNCTION                 │
│  https://ds-analyser-hhpiionw.onslate.in │───────▶│  https://<project>.catalystapps.com            │
│                                          │ HTTPS  │         /server/ds-analyzer                     │
│  Deployed via: catalyst deploy slate     │ CORS   │                                                 │
│  Serves: client/dist/* (static files)   │        │  Deployed via: catalyst deploy --only functions │
│  DOES NOT run npm build                  │        │  Express app in functions/ds-analyzer/src/      │
└──────────────────────────────────────────┘        └────────────────────────────────────────────────┘
        ▲                                                        ▲
        │                                                        │
   git push has                                            git push has
   NO effect here                                         NO effect here
   (must run CLI)                                         (must run CLI)
```

**Critical facts:**
1. The SPA and the function are on **two different origins** — CORS is mandatory.
2. **`git push` does NOT deploy to Slate or Functions.** You must run `catalyst deploy` from an authenticated CLI.
3. **Slate does NOT proxy `/server/*`** — the full absolute function URL is required.
4. **`catalyst.json` `client.source` is for web-client hosting** — it is NOT the same as Catalyst Slate.
5. **The function domain is `*.catalystapps.com`** (not `*.catalystserverless.com` as previously believed — confirm in Console).

---

## Lesson 1 — Vite env vars are BUILD-TIME, not runtime

### What bit us

We set `VITE_API_BASE` in the Catalyst Slate deployment configuration and
expected it to change the API URL the SPA calls. It did nothing. The deployed
SPA kept calling the wrong URL and returned 404.

### Why

Vite performs **static text replacement** of `import.meta.env.VITE_*` at
`npm run build` time. Once `dist/assets/index-*.js` is generated, those values
are **hard-coded strings in the bundle**. No runtime environment can change
them.

```js
// Source code:
const API_BASE = import.meta.env.VITE_API_BASE;

// After `npm run build` with VITE_API_BASE unset:
const API_BASE = "";        // ← literally empty string in the shipped JS

// After `npm run build` with VITE_API_BASE="https://foo.com":
const API_BASE = "https://foo.com";   // ← literal string, frozen forever
```

### Rule

**To change a `VITE_*` variable, you MUST rebuild the client and commit the
new `dist/`.** Setting it in the hosting provider's dashboard is meaningless
for static builds.

### How to do it correctly

```bash
# 1. Edit client/.env (gitignored, holds the value locally)
echo 'VITE_API_BASE=https://ds-analyser.catalystserverless.com/server/ds-analyzer' > client/.env

# 2. Rebuild
cd client && npm run build

# 3. Verify the URL is actually baked in
grep -o "catalystserverless[^\"']*" dist/assets/index-*.js

# 4. Commit the rebuilt dist/
git add dist/ && git commit -m "Rebuild client with production API base URL"
```

---

## Lesson 2 — Slate (static) and Catalyst Function live on different origins

### What bit us

After fixing the env var, requests still 404'd. Root cause: `VITE_API_BASE`
was set to a **relative path** (`/server/ds-analyzer`) instead of an absolute
URL. The browser resolved it against the Slate origin (`onslate.in`), which
has no function there — 404.

### Why

Slate is a static CDN. It serves files from `client/dist/`. It does **not**
proxy, route, or forward `/server/*` to anywhere. Every API request must go
to the **full absolute URL** of the function domain.

### Rule

`VITE_API_BASE` must always be an **absolute URL with scheme**:

| Value                                                              | Result         |
|--------------------------------------------------------------------|----------------|
| ✅ `https://ds-analyser.catalystserverless.com/server/ds-analyzer` | Works           |
| ❌ `ds-analyser.catalystserverless.com/server/ds-analyzer`         | Treated as relative path → 404 |
| ❌ `/server/ds-analyzer`                                           | Resolves against Slate origin → 404 |

### Defensive guard

`client/src/lib/http.js` auto-prepends `https://` if the scheme is missing, so
a misconfigured env var fails gracefully instead of silently 404'ing. Still —
**set the value correctly; don't rely on the guard**.

---

## Lesson 3 — Always include `https://` in URL env vars

This is a specific instance of Lesson 2 but deserves its own callout because
it's the single most common copy-paste mistake.

When you copy a URL from Catalyst Console → Function Details, it often
displays as:

```
ds-analyser.catalystserverless.com/server/ds-analyzer
```

**Never paste that directly into an env var.** Always prepend `https://`:

```
https://ds-analyser.catalystserverless.com/server/ds-analyzer
```

---

## Lesson 4 — CORS must be explicit for cross-origin SPA → Function

### What bit us

Early debugging showed `blocked by CORS policy` errors in the browser console
after we fixed the URL. A default `cors()` middleware was not enough.

### Why

Under cross-origin requests with non-simple methods (`POST` with
`Content-Type: application/json`), the browser sends a **preflight `OPTIONS`**
request which must receive:

- `Access-Control-Allow-Origin: <the-slate-origin>`
- `Access-Control-Allow-Methods: POST, GET, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization`

### Rule

The function's CORS config must be **explicit**:

```js
// functions/ds-analyzer/src/app.js
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors());  // handle preflight
```

Set `CORS_ALLOWED_ORIGINS` in the function's Catalyst env config to lock down
origins in production:

```
CORS_ALLOWED_ORIGINS=https://ds-analyser-hhpiionw.onslate.in
```

---

## Lesson 5 — `client/dist/` is committed; rebuild before pushing

### What bit us

Changes to `client/src/` appeared in git but the deployed site was unchanged.
The commit didn't include the rebuilt `dist/`.

### Why

`.gitignore` intentionally tracks `client/dist/` because **Catalyst Slate
deploys whatever is in `dist/` — it does NOT run `npm run build`**. If
`dist/` is stale, the deployed site is stale.

### Rule

**Source changes in `client/src/` are invisible to production until
`client/dist/` is rebuilt and committed.**

### The single command to remember

```bash
cd client && npm run build && cd .. && git add client/dist client/src && git status
```

If `git status` shows changes in `client/dist/`, **commit them in the same
commit as the source change** — never separately. This keeps source and build
in lockstep.

---

## Lesson 6 — Catalyst deployment gotchas

- **Slate env vars only affect the build if Slate runs the build** — and it
  doesn't. It serves `dist/` as-is. Setting `VITE_*` vars in the Slate
  dashboard is a no-op.
- **Function env vars DO work at runtime** — because the function is a real
  Node.js process on Catalyst's servers. Use function env vars for secrets,
  CORS origins, feature flags, etc.
- **Advanced I/O functions use `/server/<function-name>` as the base path** —
  not `/api/` or root. Every route in `app.js` is automatically prefixed with
  this by Catalyst.
- **Function URL format:** `https://<project-slug>.catalystserverless.com/server/<function-name>`.
  Get the exact value from **Catalyst Console → Functions → (select) →
  Function URL**. Copy it into `client/.env`, prepending `https://` if missing.
- **Catalyst takes ~30–60 seconds to propagate a deployment.** Don't panic
  and redeploy if the old behavior persists for a minute. Hard-refresh
  (Ctrl+Shift+R) to bypass browser cache.

---

## Lesson 7 — Debugging a 404 on a deployed SPA

When the SPA's API calls return 404 in production, follow this **exact
diagnostic order**:

### Step 1 — Open browser DevTools → Network tab → reproduce the call

Look at the **Request URL**. Ask: *"Does this URL match the function's
Function URL from Catalyst Console?"*

- If it's `https://<slate-domain>/server/...` → `VITE_API_BASE` wasn't baked
  in → [Lesson 1](#lesson-1--vite-env-vars-are-build-time-not-runtime).
- If it's `https://<slate-domain>/api/...` → same issue.
- If it's the correct domain but still 404 → function route path is wrong,
  or function isn't deployed.

### Step 2 — Confirm what's actually in the deployed bundle

```bash
grep -o "https://[^\"']*catalystserverless[^\"']*" client/dist/assets/index-*.js
```

No output? The URL wasn't baked in. Rebuild
([Lesson 1](#lesson-1--vite-env-vars-are-build-time-not-runtime)).

### Step 3 — Hit the function directly with curl

```bash
curl -i https://ds-analyser.catalystserverless.com/server/ds-analyzer/api/health
```

- `200` → function is fine; problem is in the client.
- `404` → function route doesn't exist or function isn't deployed.
- `403` / CORS error → [Lesson 4](#lesson-4--cors-must-be-explicit-for-cross-origin-spa--function).

### Step 4 — Check CORS with a preflight

```bash
curl -i -X OPTIONS https://ds-analyser.catalystserverless.com/server/ds-analyzer/api/inspect \
  -H "Origin: https://ds-analyser-hhpiionw.onslate.in" \
  -H "Access-Control-Request-Method: POST"
```

Response must include `Access-Control-Allow-Origin` matching the Slate origin.

---

## Lesson 8 — Testing discipline

- **72 tests. Keep it green.** Every function change requires
  `cd functions/ds-analyzer && npm test` before commit.
- **Security-sensitive tests must never be skipped** — SSRF guards, path
  traversal guards, auth checks. Each exists because a real vulnerability was
  found and patched.
- **When fixing a bug, add a regression test.** No exceptions.

---

## Environment Variables Reference

### Client (build-time, baked into `dist/`)

| Variable        | Required | Example                                                              | Notes |
|-----------------|----------|----------------------------------------------------------------------|-------|
| `VITE_API_BASE` | Yes      | `https://ds-analyser.catalystserverless.com/server/ds-analyzer`      | Absolute URL with `https://`. Set in `client/.env`. **Rebuild after changing.** |

### Function (runtime, set in Catalyst Console)

| Variable                | Required      | Example                                      | Notes |
|-------------------------|---------------|----------------------------------------------|-------|
| `CORS_ALLOWED_ORIGINS`  | No (prod: yes) | `https://ds-analyser-hhpiionw.onslate.in`   | Comma-separated. If unset, allows all (dev only). |

---

## Common Commands Cheatsheet

```bash
# ── STEP 0: Before building — verify the real function URL from Catalyst Console ──
FUNC_URL="https://<your-project>.catalystapps.com/server/ds-analyzer"
curl -sI "$FUNC_URL/health"   # Must be HTTP 200. If not, don't build yet.

# ── STEP 1: Build client with real URL baked in ──
echo "VITE_API_BASE=$FUNC_URL" > client/.env
cd client && npm run build && cd ..

# Verify the URL is actually in the bundle
grep -oE "https?://[^\"' ]+" client/dist/assets/index-*.js | sort -u

# ── STEP 2: Test function ──
cd functions/ds-analyzer && npm test && cd ../..

# ── STEP 3: Commit ──
git add client/dist client/src docs/
git commit -m "<describe what and why>"
git push

# ── STEP 4: DEPLOY (required — git push alone does nothing on Catalyst) ──
catalyst login                                          # one-time, opens browser
catalyst deploy --only functions:ds-analyzer            # deploy the function
catalyst deploy slate -m "<describe what changed>"      # deploy the SPA to Slate

# ── STEP 5: Smoke test after deploy ──
curl -sI "https://ds-analyser-hhpiionw.onslate.in/index.html"   # Must be 200
curl -sI "$FUNC_URL/health"                                       # Must be 200

# ── Debugging ──
# See what URL the deployed bundle calls
grep -oE "https?://[^\"' ]+" client/dist/assets/index-*.js | sort -u

# CORS preflight check
SLATE="https://ds-analyser-hhpiionw.onslate.in"
curl -i -X OPTIONS "$FUNC_URL/api/inspect" \
  -H "Origin: $SLATE" \
  -H "Access-Control-Request-Method: POST"

# Is Slate actually serving files? (ZGS 404 = no content deployed, not an app error)
curl -sI "https://ds-analyser-hhpiionw.onslate.in/index.html"
# HTTP 200 → Slate has content. HTTP 404 → run catalyst deploy slate.
```

---

---

## Lesson 9 — `git push` ≠ Catalyst deploy (biggest gotcha)

### What bit us

After fixing the bundle URL, pushing to GitHub and waiting — the Slate app
still returned 404 on **every path including `/index.html`**. It looked like
the deploy hadn't taken. It hadn't.

### Why

Pushing to GitHub updates **GitHub only**. Catalyst Slate and Catalyst
Functions are **separate services** that the Catalyst CLI deploys to directly.
Unless you have a GitHub Actions CI/CD pipeline wired up, **nothing is
deployed to Catalyst when you `git push`**.

The ZGS (Zoho Gateway Server) returns its own branded 404 page when a Slate
app has no deployed content — it does not say "no deployment found", it just
says 404, making it look like an app error.

### How to confirm the root cause

```bash
# If EVEN /index.html is 404, there's no content at all on Slate
curl -sI https://ds-analyser-hhpiionw.onslate.in/index.html
# → HTTP/2 404  ← Slate has zero deployed files
```

### Rule

**After every `git push`, you must also run `catalyst deploy` from an
authenticated local terminal to push changes to Catalyst.**

### The deploy commands

```bash
# 1. Log in (one-time setup, opens browser)
catalyst login

# 2. Deploy the function
catalyst deploy --only functions:ds-analyzer

# 3. Deploy the Slate app  
catalyst deploy slate -m "describe what changed"
```

### Permanent fix — set up GitHub CI/CD

Go to **Catalyst Console → your project → CI/CD → connect GitHub repo**.
This wires a GitHub Actions workflow so every push to `main` auto-deploys.
Until that is set up, the manual `catalyst deploy` is mandatory.

---

## Lesson 10 — Verify the function domain actually resolves before building

### What bit us

`client/.env` had `VITE_API_BASE=https://ds-analyser.catalystserverless.com/server/ds-analyzer`.
The bundle was built with that URL baked in. Then we discovered:

```bash
curl https://ds-analyser.catalystserverless.com/server/ds-analyzer/health
→ "The domain is not found."
```

The domain `ds-analyser.catalystserverless.com` **does not exist**. The
correct function URL was never confirmed from the Catalyst Console.

### Why

The URL was guessed from the project name + `catalystserverless.com`. But
Catalyst function URLs depend on the project's actual slug, the DC region,
and can be `*.catalystapps.com` — not always `*.catalystserverless.com`.

### Rule

**Always get the function URL from Catalyst Console → Functions → (select
function) → Function URL.** Never guess it.

### How to verify before building

```bash
# Replace with the URL from Console
curl -sI https://<your-project>.catalystapps.com/server/ds-analyzer/health
# Must return HTTP 200. If 404 → function not deployed yet.
# If "domain not found" → wrong URL.
```

Only once this returns `200`, set the URL in `client/.env` and rebuild.

---

## Lesson 11 — `catalyst.json` client ≠ Slate; they are two different services

### What bit us

`catalyst.json` has `"client": { "source": "client/dist" }`. We assumed this
was enough to serve the SPA on Slate. It is not.

### Why

`catalyst.json` `client.source` points to the **Catalyst Web Client Hosting**
service, which serves the SPA on `*.catalystapps.com` (same origin as the
function). **Catalyst Slate** is a **completely separate service** on
`*.onslate.in` — it needs its own deployment command and its own config.

| Service                  | URL Pattern                    | Deployed via                  |
|--------------------------|--------------------------------|-------------------------------|
| Catalyst Web Client      | `*.catalystapps.com/app/`      | `catalyst deploy --only client` |
| Catalyst Slate           | `*.onslate.in`                 | `catalyst deploy slate`        |
| Catalyst Functions       | `*.catalystapps.com/server/*`  | `catalyst deploy --only functions` |

If the SPA lives on Slate, `catalyst.json` client config is irrelevant for
Slate — only `catalyst deploy slate` matters.

---

## Lesson 12 — `http.js` Slate-origin guard: never silently fallback on `*.onslate.in`

### What bit us

`http.js` had a runtime fallback: *"if not localhost, use `/server/ds-analyzer`
(same-origin Catalyst path)."* On Slate, this resolves against
`*.onslate.in/server/ds-analyzer` — which doesn't exist — and fails silently
with 404. No useful error in the console.

### Why

The same-origin `/server/ds-analyzer` path only works when the SPA is on
**Catalyst Web Client Hosting** (same origin as the function). On **Slate**
(different origin), `VITE_API_BASE` MUST be set at build time. The runtime
fallback cannot work across origins.

### What was fixed

`http.js` now explicitly detects `*.onslate.in` hostnames and:
1. Logs a loud `console.error` telling the developer exactly what to fix.
2. Returns `''` (empty) instead of the wrong path, making the failure
   immediately obvious in the Network tab.

```js
if (hostname.endsWith('.onslate.in')) {
  console.error(
    '[http.js] Running on Catalyst Slate but VITE_API_BASE was not set at ' +
    'build time. API calls will fail. Rebuild the client with ' +
    'VITE_API_BASE=<your-function-url>.'
  );
  return '';
}
```

### Rule

On Slate, `VITE_API_BASE` must be set at build time — **no runtime fallback
is possible across origins**. The guard just makes the failure diagnosable
instead of cryptic.

---

## When in doubt

1. Read [The Golden Pre-Commit Checklist](#the-golden-pre-commit-checklist).
2. If it's a production issue: walk through
   [Lesson 7 — Debugging a 404](#lesson-7--debugging-a-404-on-a-deployed-spa)
   step by step.
3. Add any new learning to this file **in the same PR that fixes the issue**.
   Future-you will thank present-you.
