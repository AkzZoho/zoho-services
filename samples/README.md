# Samples

Drop sample inputs here as you collect them:

- `*.ds` — Zoho Creator application exports
- `*.pdf`, `*.docx` — Requirement documents
- `*.json`, `*.xml` — Extracted fragments for parser tuning

Once a real `.ds` is here, we will:
1. Inspect its structure.
2. Update `/rules/ds-parser-rules.md` with exact key mappings.
3. Add a fixture-based test in `functions/ds-analyzer/tests/` that parses the sample.
