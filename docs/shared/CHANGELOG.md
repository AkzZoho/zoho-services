# Docs — Changelog

> Append a new entry every time a doc is added, materially changed, or
> moved. Newest entry on top.

---

## v5 — Admin Panel persists tool visibility to `.env`

The Admin Panel's tool-visibility toggles no longer stop at `localStorage`.
Each toggle (and the reset action) now also calls a new server endpoint that
rewrites `client/.env` so the new `VITE_PUBLIC_TOOLS` baseline survives across
browsers, incognito sessions, and deployments.

### Added

- `POST /api/admin/tool-visibility` — admin-only endpoint, gated by the
  `x-admin-password` header against the server-side `ADMIN_PASSWORD` env var.
  Validates allowed tool IDs, rewrites the `VITE_PUBLIC_TOOLS=` line inside
  `client/.env` in-place (preserving comments and other keys), and returns
  `{ ok, value, publicIds, restartRequired }`.
- `client/src/auth/adminApi.js` — thin wrapper invoked by the panel on each
  toggle. Failures fall back to local-only behaviour with an explanatory
  toast — they never roll back the optimistic UI change.
- `ADMIN_PASSWORD` env var documented in:
  - `functions/ds-analyzer/.env.example`
  - root `.env.example`
- `functions/ds-analyzer/tests/adminToolVisibility.test.js` — 14 unit + route
  tests covering auth, validation, in-place rewrite, and append behaviour.

### Behaviour notes

- The Vite dev server inlines `VITE_*` env vars at startup. A restart is
  therefore required for the new baseline to reach fresh visitors. The
  response carries `restartRequired: true` so the UI can surface this hint.
- `localStorage` overrides remain the user-visible contract: they apply
  instantly and persist independently of the server call. A failed save (no
  server, no ADMIN_PASSWORD, etc.) shows a `warn` toast without rolling back.

### Removed (not part of this change but worth flagging)

- `client/.env` previously contained Catalyst hosting notes. The
  `VITE_API_BASE` line is now commented out for local-dev clarity (the Vite
  proxy handles `/api` → `:3001`).

---

## v4 — Creator Automation + mcp-creator removed

Trimmed the suite back to the two stable tools (DS Analyser, Tech Scope
Creator). The in-progress Creator Automation tool and the standalone
`mcp-creator` MCP server were deleted along with their Playwright
dependencies and end-to-end tests.

### Removed

- `mcp-creator/` workspace package (entire folder).
- `client/src/tools/creator-automation/` (React SPA).
- `functions/ds-analyzer/src/creator-automation/` (Express routes,
  browser session, document/requirement storage).
- `functions/ds-analyzer/tests/creatorAutomation*.test.js`.
- `docs/creator-automation/` and `docs/mcp-creator/`.
- Root `tests/e2e/` Playwright suite and `playwright.config.js`.
- Dependencies: `@playwright/test` (root), `playwright`
  (functions/ds-analyzer).
- Workspace scripts: `mcp:*`, `test:e2e`, `test:e2e:install`.

### Updated

- Root `package.json` — workspaces reduced to `client` and
  `functions/ds-analyzer`; version bumped to `0.3.0`.
- `functions/ds-analyzer/src/app.js` — dropped the
  `/api/creator-automation` route mount.
- `client/src/main.jsx`, `shell/LandingPage.jsx`, `shell/AdminPanel.jsx`,
  `auth/useToolVisibility.js` — registry trimmed to two tools.
- `README.md` (root + client) and `docs/README.md` — references to the
  removed tools and MCP server cleaned up.
- `.env.example` files — `GITHUB_TOKEN` and
  `CREATOR_AUTOMATION_DATA_DIR` removed.

---

## v3 — mcp-creator scaffold

Added a third workspace package, `mcp-creator/`, plus its docs folder
`docs/mcp-creator/`. The package is a Playwright-backed **MCP server**
that exposes 5 generic browser-automation tools (`browser.open`,
`browser.screenshot`, `browser.click`, `browser.fill`, `browser.read`)
over stdio. It is **not** a third tool inside the React shell — it's a
standalone Node process spawned by an MCP-compatible LLM client
(Claude Desktop, Cursor, …).

### Added

- `mcp-creator/` workspace package — server, tools, browser session
  singleton, login script, local REPL inspector, smoke tests.
- `docs/mcp-creator/README.md` — docs index for the new package.
- `docs/mcp-creator/architecture.md` — session lifecycle, transport
  rationale, screenshot/log conventions, tool contract.

### Updated

- Root `package.json` — added `mcp-creator` to `workspaces`, plus four
  new scripts: `mcp:start`, `mcp:login`, `mcp:inspect`, `mcp:test`.
- `docs/README.md` — added the new package to the folder tree and a
  dedicated section linking to its docs + runnable README.
- `docs/shared/operating-principles.md` §3 — added a row mapping
  MCP/Playwright concerns to `docs/mcp-creator/`.

### Scope clarification

This is **scaffold only**. No Creator-aware tools (`creator.openApp`,
`creator.createForm`, …) exist yet. Those will be added in a follow-up
phase once the user specifies which Creator actions to automate.

---

## v2 — Tool-segregated docs taxonomy

Restructured `docs/` so the two tools in this repo have visually
distinct doc folders:

```
docs/
├── README.md          ← new master index
├── shared/            ← used by BOTH tools
│   ├── creator-kb/
│   └── creator-semantics/
├── ds-analyser/       ← 🗂  Tool 1 only
└── tech-scope/        ← 📐  Tool 2 only
    └── steps/
```

### Moved (history-preserving where possible)

| From | To |
|---|---|
| `docs/APPLICATION.md` | `docs/ds-analyser/application.md` |
| `docs/ARCHITECTURE.md` | `docs/ds-analyser/architecture.md` |
| `docs/FLOWCHART.md` | `docs/ds-analyser/flowchart.md` |
| `docs/DEPLOYMENT_LEARNINGS.md` | `docs/shared/deployment-learnings.md` |
| `docs/DELUGE_REFERENCE.md` | `docs/shared/deluge-reference.md` |
| `docs/learnings/01-operating-principles.md` | `docs/shared/operating-principles.md` |
| `docs/learnings/02-project-layout.md` | `docs/shared/project-layout.md` |
| `docs/learnings/03-form-field-types.md` | `docs/shared/creator-semantics/form-field-types.md` |
| `docs/learnings/04-base-forms.md` | `docs/shared/creator-semantics/base-forms.md` |
| `docs/learnings/05-universal-form-design-rules.md` | `docs/shared/creator-semantics/universal-form-design-rules.md` |
| `docs/learnings/CHANGELOG.md` | `docs/shared/CHANGELOG.md` (this file, extended) |
| `docs/creator-kb/*` | `docs/shared/creator-kb/*` |
| `docs/techscope/TechScope_Learning.md` | `docs/tech-scope/overview.md` |
| `docs/techscope/FormsAndLookups.md` | `docs/tech-scope/forms-and-lookups.md` |
| `docs/techscope/Step1_ApplicationFlow.md` | `docs/tech-scope/steps/01-application-flow.md` |
| `docs/techscope/Step2_DataModel.md` | `docs/tech-scope/steps/02-data-model.md` |
| `docs/techscope/Step3_ModulesAndRoles.md` | `docs/tech-scope/steps/03-modules-and-roles.md` |
| `docs/techscope/Step4_APIsAndIntegrations.md` | `docs/tech-scope/steps/04-apis-and-integrations.md` |
| `docs/techscope/Step5_NFRsAndAssumptions.md` | `docs/tech-scope/steps/05-nfrs-and-assumptions.md` |

### Added

- `docs/README.md` — master index (entry point).
- `docs/shared/README.md` — shared-docs index.
- `docs/shared/creator-semantics/README.md` — sub-index for the three
  domain-rule files, plus a clear contrast with `creator-kb/`.
- `docs/ds-analyser/README.md` — DS Analyser tool index.
- `docs/tech-scope/README.md` — Tech Scope Creator tool index.
- `docs/tech-scope/steps/README.md` — wizard-step index.

### Removed

- `docs/LEARNING.md` (was a stub; superseded by `docs/README.md`).
- `docs/learnings/` (empty after split).
- `docs/creator-kb/` (moved into `docs/shared/`).
- `docs/techscope/` (moved into `docs/tech-scope/` with renamed files).

### Cross-reference fixes

Updated link paths in:

- `docs/ds-analyser/application.md`
- `docs/ds-analyser/flowchart.md`
- `docs/shared/deluge-reference.md`
- `docs/shared/operating-principles.md`
- `docs/shared/project-layout.md`
- `docs/shared/creator-semantics/base-forms.md`
- root `README.md`
- `rules/ds-parser-rules.md`
- `client/src/tools/ds-analyser/lib/fieldTypes.js` (comment ref)
- `client/src/tools/ds-analyser/components/AppOverview.jsx` (comment ref)

### Operating-principles update

Rule 1 (“Learnings-first reasoning”) now points at `docs/README.md`
instead of `docs/learnings/`. A new Rule 7 (“Respect the tool
boundary”) was added so the assistant doesn’t cross-edit between the
two tools without an explicit ask.

---

## v1 — Folder bootstrap (pre-restructure)

- Removed the `samples/*.ds` corpus from the repository.
- Replaced the monolithic `docs/LEARNING.md` with a multi-file
  `docs/learnings/` folder. _(Subsequently superseded by the v2
  tool-segregated layout above.)_
- Created focused files for operating principles, project layout, form
  field types, base forms, and universal form design rules.
- Updated cross-references in `README.md`, `docs/APPLICATION.md`,
  `docs/DELUGE_REFERENCE.md`, and `rules/ds-parser-rules.md` to remove
  the `samples/` folder.
