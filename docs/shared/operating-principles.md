# Operating Principles

> **Scope.** How the assistant must reason and act on this repository.
> These principles override default assistant behaviour and apply to
> **every tool** inside the repo (DS Analyser, Tech Scope Creator,
> future tools).

---

## 1. Governing rules

1. **Docs-first reasoning.** Before making any change, consult the
   relevant docs under [`docs/`](../README.md). The folder is split by
   tool — start at [`docs/README.md`](../README.md) and jump to the
   tool-specific or shared folder.
2. **Document new findings.** Any non-obvious finding produced while
   working on a task must be added to the most specific doc (or a new
   one if none fits). Bump [`CHANGELOG.md`](./CHANGELOG.md) in the same
   commit.
3. **Suggest freely, change carefully.** The assistant may reason,
   analyse, and suggest ideas that go beyond the documented rules, but
   must clearly mark such ideas as **suggestions**. Suggestions become
   commitments only after the user approves and the new rule is
   captured in the appropriate doc.
4. **No silent extras.** Do not add features, utilities, abstractions,
   files, or behaviour that were not requested or that contradict an
   existing rule.
5. **Targeted reads.** Prefer symbol lookup, line-range reads, and grep
   over full-file reads. Don’t reload a file you’ve already seen in the
   same session.
6. **Verify with diagnostics, not re-reads.** After editing a file,
   confirm correctness with the language-server diagnostics rather than
   re-reading the file.
7. **Respect the tool boundary.** The two tools share `client/` shell
   code, but their domain logic lives under separate
   `client/src/tools/<tool>/` folders and separate `docs/<tool>/`
   folders. A change for one tool must not touch the other’s files
   unless explicitly asked.

---

## 2. Operating procedure

For every user request the assistant will:

1. **Identify which tool(s) the request touches** (DS Analyser, Tech
   Scope Creator, both, or neither).
2. **Consult the relevant docs**:
   - Start at [`docs/README.md`](../README.md).
   - Jump to the tool folder ([`ds-analyser/`](../ds-analyser/) or
     [`tech-scope/`](../tech-scope/)).
   - If the change touches Creator semantics, also read
     [`creator-semantics/`](./creator-semantics/).
3. **Classify the request**:
   - **In-scope** → A matching rule / doc exists → proceed.
   - **Unknown** → No matching doc → gather the *minimum necessary
     context*, do the work, then record the new finding before closing
     the task.
   - **Out-of-scope** → Contradicts an existing rule → refuse to
     implement; offer a suggestion only and surface the conflicting rule
     so the user can decide.
4. **Plan, then act.** Break the task into ordered steps; gather context
   before modifying code; validate with diagnostics; report status and
   next actionable steps at the end.
5. **Record new findings** in the appropriate doc so the next task
   doesn’t re-derive them.
6. **Report** what was done, what was skipped, and why — referencing the
   relevant rule numbers above.

---

## 3. Folder taxonomy at a glance

| If the change is about… | Read… |
|---|---|
| Creator field types, base forms, form-design rules (either tool) | [`creator-semantics/`](./creator-semantics/) |
| What a Creator construct *is* (forms, reports, workflows…) | [`creator-kb/`](./creator-kb/) |
| Deluge syntax / code-walker mapping (either tool) | [`deluge-reference.md`](./deluge-reference.md) |
| Catalyst deploy / CORS / build-time env vars | [`deployment-learnings.md`](./deployment-learnings.md) |
| DS Analyser app, parser, performance audit, schema view | [`../ds-analyser/`](../ds-analyser/) |
| Tech Scope Creator wizard, prompt-DSL, BRD parser, exporter | [`../tech-scope/`](../tech-scope/) |

---

## 4. What changed from the original learning charter

Earlier versions of this document required every change to be backed by
a pattern present in `samples/*.ds`. That folder has been removed. The
distilled learnings extracted from those samples (field-type
vocabulary, base-form schemas, design rules) are now captured under
[`creator-semantics/`](./creator-semantics/) and remain authoritative.

If a future change needs a real `.ds` file as a reference, the user
should attach one in the conversation; it should not be committed to
the repository.
