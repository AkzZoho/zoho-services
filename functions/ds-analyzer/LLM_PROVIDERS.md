# LLM Provider Configuration

The DS Analyzer backend supports a **pluggable LLM router** (`src/shared/llm/router.js`). You can run the tool in one of three practical modes:

| Mode | What you set in `.env` | What happens |
|---|---|---|
| **OpenAI (ChatGPT)** | `OPENAI_API_KEY=sk-…` (leave Anthropic blank) | Every LLM-backed task is routed to OpenAI (`gpt-4o-mini` by default). |
| **Anthropic (Claude)** | `ANTHROPIC_API_KEY=sk-ant-…` (leave OpenAI blank) | Tasks are routed to Claude. |
| **No-AI (stub)** | Leave **both** keys blank | Router falls through to the built-in `stub` provider, which returns deterministic placeholder JSON. The UI renders normally; no network call leaves the box. Useful for offline demos, CI, and unit tests. |

When BOTH keys are set, the router uses the per-task preference list defined in `router.js` (Anthropic-first for long-doc tasks, OpenAI-first for structured-JSON tasks).

---

## Quick setup

```bash
cd functions/ds-analyzer
cp .env.example .env
# then edit .env and paste your key into OPENAI_API_KEY= or ANTHROPIC_API_KEY=
npm run dev
```

On startup the server prints which mode is active:

```
🚀 DS Analyzer API listening on http://localhost:3001
   LLM preference: openai,anthropic,stub
   Active LLM providers: openai, stub
```

If you see `Active LLM mode: 🛈 NO-AI (stub)` instead, no provider key was loaded — double-check `.env` is in `functions/ds-analyzer/` (not the repo root) and that the value isn't blank or quoted.

---

## How the router decides

`src/shared/llm/router.js` defines a per-task preference list, e.g.

```js
suggestChanges: ['anthropic', 'openai', 'stub']
```

The list is then filtered to **only providers whose `isAvailable()` returns `true`**. A provider is available iff:

- Its SDK is installed (`openai`, `@anthropic-ai/sdk`), **and**
- Its API key env var is set and non-empty after trimming whitespace.

So with only `OPENAI_API_KEY` set, the effective candidate list for every task collapses to `['openai', 'stub']` — OpenAI is tried first, stub is the final safety net if the OpenAI call throws.

If you want OpenAI to be tried **before** Anthropic globally, edit the `suggestChanges`/`extractScope`/`applyPrompt` arrays in `router.js`.

---

## Switching to no-AI mode

Just blank out the keys:

```env
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

Restart the server. All endpoints continue to work — the response will have `"provider": "stub"` so the frontend (or your tests) can tell it's not real model output.

---

## Security checklist

- ✅ `.env` is gitignored.
- ✅ `.env.example` is whitelisted and safe to commit.
- ✅ No keys are hard-coded anywhere in the source tree.
- ⚠️ The key in your local `.env` is **only** local. Don't paste it into Slack, PRs, or screenshots.
- 🔁 If you ever expose a key by accident: revoke it in the provider's dashboard immediately and rotate.
