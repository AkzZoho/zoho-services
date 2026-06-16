# Find & Replace (find-usages)

A deterministic "where is this identifier used?" search across a parsed `.ds`
file. Lives inside **Step 2 — Suggest changes** of the DS Analyser, but
unlike the audit / suggest features it **does not call an LLM**. That is a
deliberate design choice: an LLM cannot reliably tell you that a token
appears at "line 47, column 19" of a 600-line workflow — it does not see the
source line-by-line and will invent numbers. The deterministic scanner does.

## What it searches

Every `sourceCode` field on the parsed `overview`:

| Entity kind | Source field | Where it comes from in the parser |
| ----------- | ------------ | --------------------------------- |
| `workflow`  | `overview.workflows[].sourceCode`        | The full `form X { on Y { actions { … } } }` block. |
| `function`  | `overview.customFunctions[].sourceCode`  | The full `<returnType> <ns>.<name>(<params>) { … }` block. |
| `page`      | `overview.pages[].sourceCode`            | The full `page X { … }` block (incl. embedded `script {}`). |

Form / field / report **metadata** is not searched — that's structural, not
source. Use Step 1's Schema view to find a form / field by name.

## API contract

`POST /api/find-usages`

```jsonc
{
  "oldValue": "shriniwash.yadav_adityabirla",   // required, 1–500 chars
  "newValue": "utcl_cms",                        // optional — enables replacement preview
  "overview": { /* full /api/inspect response */ },
  "options": {
    "matchCase":  false,                         // default false
    "wholeWord":  true,                          // default true (route override)
    "useRegExp":  false,                         // default false
    "maxOccurrencesPerEntity": 50,               // 1–200
    "maxTotalOccurrences":     500               // 1–2000
  }
}
```

Response:

```jsonc
{
  "query":       { /* echoed back with defaults filled in */ },
  "totals":      {
    "entitiesScanned":      37,
    "entitiesWithMatches":   3,
    "occurrences":           8,
    "truncated":         false   // true if any cap was hit
  },
  "occurrences": [
    {
      "entityKind":  "workflow",
      "entityName":  "OnAdd_Order",
      "displayName": "On add Order",
      "line":        47,
      "column":      19,
      "lineText":    "        to = \"shriniwash.yadav_adityabirla@x.com\";",
      "matchText":   "shriniwash.yadav_adityabirla",
      "replacement": "        to = \"utcl_cms@x.com\";"
    }
    // …
  ],
  "groupedByEntity": [
    {
      "entityKey":   "workflow:OnAdd_Order",
      "entityKind":  "workflow",
      "entityName":  "OnAdd_Order",
      "displayName": "On add Order",
      "matches":     [ /* same Occurrence objects */ ]
    }
  ]
}
```

## `wholeWord` semantics

By default `wholeWord` is **true** because most `Change X → Y` requests are
identifier renames where partial substring matches are noise. The match is
anchored with custom lookarounds:

```
(?<![A-Za-z0-9_.])<escaped-oldValue>(?![A-Za-z0-9_.])
```

This is **not** `\b`. JS `\b` treats `.` and `_` as word boundaries, so on
input `shriniwash.yadav_adityabirla.extended` it would wrongly accept the
prefix `shriniwash.yadav_adityabirla` as a whole-word match. The custom
class includes `.` and `_` so dotted/underscored identifiers are matched as
a single unit.

Toggle `wholeWord: false` (UI: untick "Whole identifier") for free-text
renames, e.g. searching for `TODO` inside Deluge comments.

## Limits

| Limit | Default | Max | Purpose |
| ----- | ------- | --- | ------- |
| `oldValue` length             | —    | 500 chars | Prevent regex pathologies. |
| `newValue` length             | —    | 500 chars | Same. |
| Per-entity occurrence cap     | 50   | 200       | Stop one runaway workflow from filling the response. |
| Total occurrence cap          | 500  | 2 000     | Cap response size for a global search. |
| Line clipping                 | —    | 320 chars | The UI receives lines clipped around the match with `…` markers. |
| Overview payload              | —    | 6 MB      | Same envelope as `/api/suggest-changes`. |

When any cap is hit, `totals.truncated` is `true` and the UI displays
"results truncated by safety cap".

## Why this exists alongside Audit / Suggest

| Tool | When to use | What it's good at |
| ---- | ----------- | ----------------- |
| **Find & Replace**       | "Change X to Y" — you know the exact token. | Precise file/line/column, deterministic, free. |
| **Audit my app**         | "I don't know what to change — tell me."   | High-level improvements ranked by impact. |
| **Suggest changes** (LLM) | "Add a status field and a workflow for it." | Translates business intent to a Creator change plan. |

They compose — run Find & Replace first to scope the work, then Suggest
changes to plan the structural follow-ups.

## Testing

`functions/ds-analyzer/tests/findUsages.test.js` covers:

- Exact identifier hits across workflows / functions / pages
- `wholeWord` correctness on dotted/underscored identifiers (the tricky case)
- Case sensitivity toggle
- Regex mode (including graceful handling of invalid regex)
- Replacement preview with multi-hit lines
- Per-entity and global occurrence caps
- Missing / empty inputs
- Long-line clipping (`…` markers)

Run with:

```bash
cd functions/ds-analyzer
npx jest tests/findUsages.test.js
```
