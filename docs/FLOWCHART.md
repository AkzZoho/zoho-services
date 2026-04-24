# Creator DS Analyser — Functional Flow Chart

> Companion to [`APPLICATION.md`](./APPLICATION.md).
> This file focuses purely on the **functional flow** — the sequence of
> user actions, backend stages, decision points, and outputs.
> Open it in any Markdown renderer that supports Mermaid (GitHub, VS Code
> with the Markdown preview, Zoho Code IDE, etc.).

---

## 1. Top-level functional flow

High-level view of what the application *does* from the moment a user
opens the SPA to the moment they see results.

```mermaid
flowchart TD
    Start([User opens Creator DS Analyser]) --> Upload[UploadPanel\npick a .ds file]
    Upload --> Inspect[POST /api/inspect]
    Inspect --> Parse[dsParser\n.ds → normalised JSON]
    Parse --> Digest[analyzer/inspect\nstats · digest · technicalScope]
    Digest --> Perf[analysePerformance\ndeterministic rule audit]
    Perf --> Response[[Single JSON response]]

    Response --> A[AppOverview\nForms · Reports · Pages · Workflows]
    Response --> B[SchemaView\nunified field table + JSON export]
    Response --> C[PerformanceView\nfindings · tiers · fix guidance]

    A --> Done([User explores / resets])
    B --> Done
    C --> Done
```

---

## 2. Decision points, in plain English

| # | Question | If YES | If NO |
|---|----------|--------|-------|
| 1 | Did the `.ds` parse cleanly? | Return full digest | Surface `warnings[]`; still return partial digest |
| 2 | Is any LLM provider key configured? | Include LLM `overview` (headline, purpose, risks) | Use deterministic rule-based overview (no API call) |
| 3 | Did `analysePerformance` succeed? | Attach full `performance` object | Attach error stub with `{ error: "..." }` |

The app never blocks on an LLM call — it is fully functional with zero
API keys configured.

---

## 3. Per-stage responsibility chart

```mermaid
flowchart LR
    subgraph FE [client/src]
      U1[UploadPanel.jsx]
      U2[AppOverview.jsx]
      U3[SchemaView.jsx]
      U4[PerformanceView.jsx]
      U5[App.jsx]
    end

    subgraph API [functions/ds-analyzer/src]
      R1[routes/inspect.js]
      P1[parsers/dsParser.js]
      A1[analyzer/inspect.js]
      A2[analyzer/performance.js]
      L1[llm/router.js]
      L2[llm/providers/*]
      X2[middleware/errorHandler.js]
    end

    subgraph CFG [config & data]
      C1[rules/ds-parser-rules.md]
      C2[rules/Performance_Matrix.md]
    end

    U1 -->|POST /api/inspect| R1
    R1 --> P1 --> A1
    A1 -->|LLM summary best-effort| L1 --> L2
    A1 --> A2
    A2 -.reads rules.-> C2
    P1 -.reads rules.-> C1
    A1 --> U2
    A1 --> U3
    A2 --> U4
    R1 --> X2
```

---

## 4. Sequence — happy path (no LLM key)

```mermaid
sequenceDiagram
    autonumber
    participant U  as User
    participant FE as React SPA
    participant API as Catalyst Fn
    participant DS as dsParser
    participant AI as analyzer/inspect
    participant PF as analysePerformance

    U->>FE: Drop .ds file
    FE->>API: POST /api/inspect (multipart)
    API->>DS: parseDs(buffer, name)
    DS-->>API: { forms, reports, workflows, pages, ... }
    API->>AI: inspectDs({ buffer, name })
    AI->>AI: computeStats + buildDigests + buildTechnicalScope
    AI->>PF: analysePerformance(ds)
    PF-->>AI: { summary, findings, volumeTiers, ... }
    AI-->>API: full digest object
    API-->>FE: 200 JSON (ok:true, technicalScope, performance, ...)
    FE-->>U: Render AppOverview + SchemaView + PerformanceView
```

---

## 5. Sequence — happy path (with LLM key)

```mermaid
sequenceDiagram
    autonumber
    participant U  as User
    participant FE as React SPA
    participant API as Catalyst Fn
    participant DS as dsParser
    participant AI as analyzer/inspect
    participant LR as llm/router
    participant LLM as Provider (e.g. OpenAI)
    participant PF as analysePerformance

    U->>FE: Drop .ds file
    FE->>API: POST /api/inspect (multipart)
    API->>DS: parseDs(buffer, name)
    DS-->>API: normalised JSON
    API->>AI: inspectDs({ buffer, name })
    AI->>AI: computeStats + buildDigests + buildTechnicalScope
    AI->>LR: run('pmRewrite', { system, user })
    LR->>LLM: completion request
    LLM-->>LR: { headline, purpose, keyEntities, automation, risks }
    LR-->>AI: { provider, data: overview }
    AI->>PF: analysePerformance(ds)
    PF-->>AI: performance object
    AI-->>API: full digest + LLM overview
    API-->>FE: 200 JSON
    FE-->>U: Render all three sections
```

---

## 6. Error & fallback paths

```mermaid
flowchart TD
    Req[/Incoming request/] --> Guard{Rate limit\n& payload OK?}
    Guard -- No --> E1[429 / 413\nJSON error]
    Guard -- Yes --> Parse{dsParser\nsucceeded?}
    Parse -- No, fatal --> E2[400 BAD_REQUEST]
    Parse -- Partial --> Warn[partial digest +\nwarnings array]
    Parse -- Yes --> LLM{LLM key\navailable?}
    LLM -- No --> Det[deterministic\noverview]
    LLM -- Yes --> Call[call provider]
    Call -- error --> Det
    Det --> Audit[analysePerformance]
    Warn --> Audit
    Call -- ok --> Audit
    Audit -- throws --> AuditFallback[empty performance\n+ error field]
    Audit -- ok --> Ok[[200 OK\nfull digest]]
    AuditFallback --> Ok

    E1 --> Banner[(Frontend error banner)]
    E2 --> Banner
```

Key guarantees:

- **No key, no problem** — the app is fully functional without any LLM keys.
- **Parser errors are soft** — the `.ds` tokeniser surfaces issues in
  `warnings[]` rather than throwing, so a partially-parseable file still
  returns a useful (if incomplete) response.
- **Performance audit errors are soft** — if `analysePerformance` throws,
  `inspectDs` catches it and returns an error stub so the other two views
  still render correctly.
- **Uniform error shape** — every failure flows through
  `middleware/errorHandler` and comes out as
  `{ "error": "...", "code": "..." }`.

---

## 7. State machine — frontend (`App.jsx`)

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Inspecting : user drops .ds file
    Inspecting --> InspectError : parse / network error
    Inspecting --> Inspected : digest received
    InspectError --> Idle : user resets
    Inspected --> Idle : user resets / drops new file
```

The frontend state machine is intentionally minimal — there is only one
server call (`POST /api/inspect`) and one result state (`Inspected`).

---

## 8. AppOverview — internal tab navigation

```mermaid
flowchart LR
    AO[AppOverview] --> T1[Forms tab]
    AO --> T2[Reports tab]
    AO --> T3[Pages tab]
    AO --> T4[Workflows tab]

    T1 --> F1[Form card\nfield table]
    F1 --> F2[Related reports\npurple pills]
    F1 --> F3[Related workflows\nblue pills]
    F1 --> F4[Related pages\nemerald pills]

    T3 --> P1[Page row\nexpand → source viewer]
    T4 --> W1[Workflow row\nexpand → source viewer]
```

---

## 9. How to read / update this chart

- The chart is **intentionally functional** — modules and deployment
  concerns live in [`APPLICATION.md`](./APPLICATION.md) and
  [`ARCHITECTURE.md`](./ARCHITECTURE.md).
- When you add/remove a route, step, or decision point:
  1. Update the relevant diagram above.
  2. Update the **Decision points** table in §2.
  3. If the change is user-visible, reflect it in the
     **State machine** (§7) as well.
- Keep diagrams small — if one gets unwieldy, split it into a new
  sub-section rather than cramming more nodes.

---

## 10. Change log

| Version | Summary |
|---------|---------|
| **v1** | Initial chart (two-step LLM flow with `ResultView`). |
| **v2** | Rewritten for v0.3 single-step architecture: `ResultView` → removed; `SchemaView` + `PerformanceView` added; `AppOverview` enhanced; state machine simplified to one server call. |
