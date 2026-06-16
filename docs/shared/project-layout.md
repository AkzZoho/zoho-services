# Project Layout

> Captured from the directory listing. Update this file when top-level
> structure changes.

```
Creator - DS Analyser/
├── client/                      # React + Vite + Tailwind frontend (BOTH tools live here)
│   ├── src/
│   │   ├── auth/                # Admin auth provider, protected routes
│   │   ├── shell/               # Landing page, login, layout (chooses the tool)
│   │   ├── theme/               # Light/dark mode provider
│   │   ├── components/          # Cross-tool UI primitives (Toast, Icons)
│   │   └── tools/
│   │       ├── ds-analyser/     # 🗂  Tool 1 — DS Analyser SPA
│   │       └── tech-scope/      # 📐  Tool 2 — Tech Scope Creator SPA
│   └── dist/                    # Built bundle — committed; Slate serves this as-is
│
├── functions/
│   └── ds-analyzer/             # Catalyst Advanced I/O function (Node.js / Express)
│       │                         #     ⮕ used ONLY by the DS Analyser tool
│       ├── src/
│       │   ├── parsers/         # .ds, pdf, docx, zoho-sheet parsers
│       │   ├── llm/             # Multi-provider LLM router + prompt modules
│       │   ├── analyzer/        # Inspection + performance audit
│       │   └── routes/          # Express routes (health, inspect, suggest-changes, …)
│       └── tests/               # Unit + integration tests (jest)
│
├── rules/                       # Editable MD rules consumed by the DS Analyser
│   │                              backend at runtime (no redeploy needed)
│   ├── ds-parser-rules.md
│   ├── llm-prompt-rules.md
│   └── Performance_Matrix.md
│
├── docs/                        # ⮕ Tool-segregated documentation (this folder)
│   ├── README.md                #    Master index — start here
│   ├── shared/                  #    Knowledge used by BOTH tools
│   │   ├── operating-principles.md
│   │   ├── project-layout.md    #    ← THIS file
│   │   ├── deployment-learnings.md
│   │   ├── deluge-reference.md
│   │   ├── CHANGELOG.md
│   │   ├── creator-kb/          #    Creator construct reference (9 files)
│   │   └── creator-semantics/   #    Distilled domain learnings (3 files)
│   ├── ds-analyser/             #    🗂  DS Analyser-only docs
│   │   ├── application.md
│   │   ├── architecture.md
│   │   └── flowchart.md
│   └── tech-scope/              #    📐  Tech Scope Creator-only docs
│       ├── overview.md
│       ├── forms-and-lookups.md
│       └── steps/               #    One file per wizard step
│
├── catalyst.json
├── package.json
├── README.md
└── start-local.sh
```

## Notes

- **Two tools, one repo.** `client/src/tools/ds-analyser/` and
  `client/src/tools/tech-scope/` are the only tool-specific source
  trees. Everything outside `client/src/tools/` is shared (auth,
  shell, theme) or DS-Analyser-specific backend (`functions/`,
  `rules/`).
- **`samples/`** previously held reference `.ds` exports. It has been
  removed. The learnings extracted from it are preserved across
  [`creator-semantics/`](./creator-semantics/) and the
  [`tech-scope/`](../tech-scope/) folder.
- **`client/dist/`** is intentionally **not** in `.gitignore` — Catalyst
  Slate serves whatever is committed there. See
  [`deployment-learnings.md`](./deployment-learnings.md) (Lesson 5).
- **`rules/*.md`** files are read at runtime by the DS Analyser
  function — editing a rule changes behaviour without a redeploy.
  These rules are **DS-Analyser-only**; the Tech Scope Creator does
  not consult them.
