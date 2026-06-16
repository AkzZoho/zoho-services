/**
 * changeSheetMarkdown — serialise a /api/change-request plan into a
 * developer-friendly Markdown document, suitable for pasting into a Jira
 * ticket, a Slack thread, or a code review.
 *
 * The Markdown layout matches the on-screen Developer Change Sheet so
 * developers see the same structure whether they read it in the browser
 * or in a downloaded .md file.
 *
 * Pure function — no DOM access, no fetch, no side effects. Safe to call
 * from React render paths and unit-testable in isolation.
 *
 * Sections (in order — same as the UI):
 *   1. Header (intent, summary, confidence, provenance)
 *   2. Precise line edits (rename hits with file/line/column + diff)
 *   3. Structural / behavioural changes (LLM-proposed)
 *   4. Out-of-scope notes (Q3 honesty requirement)
 *   5. Warnings
 *   6. Open questions
 */

const PROVIDER_LABEL = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  zoho: 'Zoho Zia',
  stub: 'stub (no AI configured)',
};

const RISK_EMOJI = { low: '🟢', medium: '🟡', high: '🔴' };
const DATA_IMPACT_LABEL = {
  'no-data-loss': 'no data loss',
  'backfill-needed': 'backfill needed',
  destructive: 'destructive',
};

/**
 * Escape a string for safe inclusion in a Markdown fenced code block — i.e.
 * make sure it does not contain a ``` sequence that would close the fence
 * early. Stray backticks within the body are fine.
 */
function escapeForFence(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/```/g, '`\u200b``'); // zero-width space breaks the fence
}

/**
 * Render the full plan to Markdown.
 *
 * @param {object} plan       Server response's `plan` field.
 * @param {object} [opts]
 * @param {string} [opts.provider]    Provider name ("openai" | "stub" | ...).
 * @param {boolean}[opts.llmAvailable]
 * @param {string} [opts.instruction] The original consultant prompt.
 * @param {string} [opts.appName]
 * @returns {string} Markdown
 */
function planToMarkdown(plan, opts = {}) {
  if (!plan || typeof plan !== 'object') {
    return '# Developer Change Sheet\n\n_(empty plan)_\n';
  }

  const lines = [];
  const {
    provider,
    llmAvailable,
    instruction,
    appName,
  } = opts;

  // ----------------------- Header -----------------------
  lines.push('# Developer Change Sheet');
  lines.push('');
  const meta = [];
  if (appName) meta.push(`**App:** ${appName}`);
  meta.push(`**Generated:** ${new Date().toISOString()}`);
  if (provider) {
    const label = PROVIDER_LABEL[provider] || provider;
    meta.push(`**AI provider:** ${label}${llmAvailable === false ? ' _(no AI — deterministic only)_' : ''}`);
  }
  if (typeof plan.confidence === 'number') {
    meta.push(`**Confidence:** ${Math.round(plan.confidence * 100)}%`);
  }
  lines.push(meta.join(' · '));
  lines.push('');

  if (instruction) {
    lines.push('## Original request');
    lines.push('');
    lines.push('> ' + instruction.split('\n').join('\n> '));
    lines.push('');
  }

  if (plan.intent) {
    lines.push('## Interpreted goal');
    lines.push('');
    lines.push(plan.intent);
    lines.push('');
  }

  if (plan.summary) {
    lines.push('## Summary');
    lines.push('');
    lines.push(plan.summary);
    lines.push('');
  }

  // ----------------------- Precise line edits -----------------------
  const lineEdits = Array.isArray(plan.lineEdits) ? plan.lineEdits : [];
  if (lineEdits.length > 0) {
    lines.push('## Precise line edits');
    lines.push('');
    lines.push(
      '_These come from a deterministic scan of every workflow / function / page source in the parsed `.ds`. ' +
        'Line numbers are exact — apply each edit manually in Creator and keep the diff for review._'
    );
    lines.push('');

    for (const edit of lineEdits) {
      const hits = edit.totals?.occurrences ?? 0;
      lines.push(`### \`${edit.oldValue}\` → \`${edit.newValue || '(remove)'}\``);
      lines.push('');
      const tags = [];
      tags.push(`**Source:** ${edit.source}`);
      tags.push(`**Hits:** ${hits}`);
      if (edit.totals?.entitiesWithMatches) {
        tags.push(`**Locations:** ${edit.totals.entitiesWithMatches}`);
      }
      if (edit.totals?.truncated) tags.push('⚠️ _results truncated by safety cap_');
      lines.push(tags.join(' · '));
      if (edit.note) {
        lines.push('');
        lines.push(`_${edit.note}_`);
      }
      lines.push('');

      if (hits === 0) {
        lines.push(`_No occurrences of \`${edit.oldValue}\` found in any workflow, function or page._`);
        lines.push('');
        continue;
      }

      for (const group of edit.groupedByEntity || []) {
        const kindLabel = capitalise(group.entityKind);
        lines.push(`#### ${kindLabel}: \`${group.displayName || group.entityName}\``);
        lines.push('');
        for (const match of group.matches || []) {
          const scope = match.enclosingScope ||
            (Array.isArray(match.scopePath) ? match.scopePath.join(' → ') : '');
          const scopeNote = scope ? ` _(in \`${scope}\`)_` : '';
          lines.push(`- **Line ${match.line}, col ${match.column}**${scopeNote}`);
          lines.push('  ```');
          lines.push('  - ' + escapeForFence(match.lineText));
          if (match.replacement !== undefined) {
            lines.push('  + ' + escapeForFence(match.replacement));
          }
          lines.push('  ```');
        }
        lines.push('');
      }
    }
  }

  // ----------------------- Structural changes -----------------------
  const changes = Array.isArray(plan.changes) ? plan.changes : [];
  if (changes.length > 0) {
    lines.push('## Structural / behavioural changes');
    lines.push('');

    for (let i = 0; i < changes.length; i += 1) {
      const c = changes[i];
      const riskMark = RISK_EMOJI[c.risk] || '⚪';
      lines.push(`### ${i + 1}. ${c.action}`);
      lines.push('');
      const meta2 = [];
      meta2.push(`**Kind:** ${c.kind}`);
      if (c.target?.entity && c.target?.name) {
        meta2.push(`**Target:** ${c.target.entity} \`${c.target.name}\``);
      }
      // Parent context — answers "where does the developer find this in the
      // Creator builder?". We surface it as its own bullet so it can't be
      // missed in a scan.
      if (c.target?.parentName) {
        const parentKind = c.target.parentEntity || 'Entity';
        meta2.push(`**On ${parentKind}:** \`${c.target.parentName}\``);
      }
      if (c.target?.trigger) {
        meta2.push(`**Trigger:** \`${c.target.trigger}\``);
      }
      if (
        c.target?.scope &&
        c.target.entity !== 'Form' &&
        c.target.entity !== 'Report' &&
        c.target.entity !== 'Page'
      ) {
        meta2.push(`**Scope:** ${c.target.scope}`);
      }
      meta2.push(`**Risk:** ${riskMark} ${c.risk}`);
      meta2.push(`**Data impact:** ${DATA_IMPACT_LABEL[c.dataImpact] || c.dataImpact}`);
      lines.push(meta2.join(' · '));
      lines.push('');

      if (c.rationale) {
        lines.push('**Why:** ' + c.rationale);
        lines.push('');
      }

      if (Array.isArray(c.manualSteps) && c.manualSteps.length > 0) {
        lines.push('**Manual steps in Creator:**');
        lines.push('');
        for (const step of c.manualSteps) lines.push(`1. ${step}`);
        lines.push('');
      }

      if (Array.isArray(c.relatedEntities) && c.relatedEntities.length > 0) {
        lines.push(
          '**Also revisit:** ' +
            c.relatedEntities.map((r) => `\`${r}\``).join(', ')
        );
        lines.push('');
      }
    }
  }

  // ----------------------- Out of scope -----------------------
  const outOfScope = Array.isArray(plan.outOfScope) ? plan.outOfScope : [];
  if (outOfScope.length > 0) {
    lines.push('## ⚠️ Out of scope for this `.ds`');
    lines.push('');
    lines.push(
      '_These parts of the request cannot be represented in the `.ds` export — handle them in Creator or another system directly._'
    );
    lines.push('');
    for (const o of outOfScope) {
      lines.push(`- **${o.request}**`);
      lines.push(`  - Reason: ${o.reason}`);
      if (o.where) lines.push(`  - Where: ${o.where}`);
    }
    lines.push('');
  }

  // ----------------------- Warnings -----------------------
  const warnings = Array.isArray(plan.warnings) ? plan.warnings : [];
  if (warnings.length > 0) {
    lines.push('## Cross-cutting warnings');
    lines.push('');
    for (const w of warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  // ----------------------- Open questions -----------------------
  const openQuestions = Array.isArray(plan.openQuestions) ? plan.openQuestions : [];
  if (openQuestions.length > 0) {
    lines.push('## Open questions to clarify before proceeding');
    lines.push('');
    for (const q of openQuestions) lines.push(`- ${q}`);
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

function capitalise(s) {
  if (typeof s !== 'string' || !s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

/**
 * Render a multi-turn conversation as a single Markdown document.
 *
 * Each turn is wrapped in its own `## Turn N — <kind>` section so a reader
 * can see how the change sheet evolved prompt-by-prompt. Internally we
 * reuse `planToMarkdown` per turn and demote its `# Developer Change Sheet`
 * header so the combined document has a single H1 at the top.
 *
 * @param {Array<{ instruction: string, plan: object, provider?: string,
 *                  llmAvailable?: boolean, kind?: 'request' | 'audit',
 *                  ts?: number }>} turns
 * @param {object} [opts]
 * @param {string} [opts.appName]
 * @returns {string} Markdown
 */
function combinedPlanToMarkdown(turns, opts = {}) {
  if (!Array.isArray(turns) || turns.length === 0) {
    return '# Developer Change Sheet (combined)\n\n_(no turns yet)_\n';
  }

  const { appName } = opts;
  const out = [];
  out.push('# Developer Change Sheet (combined)');
  out.push('');
  const meta = [];
  if (appName) meta.push(`**App:** ${appName}`);
  meta.push(`**Generated:** ${new Date().toISOString()}`);
  meta.push(`**Turns:** ${turns.length}`);
  out.push(meta.join(' · '));
  out.push('');

  for (let i = 0; i < turns.length; i += 1) {
    const t = turns[i];
    const kindLabel = t.kind === 'audit' ? 'audit' : 'change request';
    out.push(`## Turn ${i + 1} — ${kindLabel}`);
    out.push('');
    const turnMd = planToMarkdown(t.plan, {
      provider: t.provider,
      llmAvailable: t.llmAvailable,
      instruction: t.instruction,
      appName, // intentionally repeated so each turn is self-contained
    });
    // Demote the per-turn H1 ("# Developer Change Sheet") and every other
    // heading by one level, so the combined doc has a single H1 at the top.
    const demoted = turnMd.replace(/^(#{1,5}) /gm, '#$1 ');
    out.push(demoted.trimEnd());
    out.push('');
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

/**
 * Build a filename-safe slug for the downloaded .md file.
 */
function downloadFilename(appName) {
  const safe = String(appName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  // If we have a usable slug, prefix with it; otherwise fall back to a
  // generic "change-sheet-<timestamp>.md" — never double-prefix.
  return safe
    ? `change-sheet-${safe}-${ts}.md`
    : `change-sheet-${ts}.md`;
}

export { planToMarkdown, combinedPlanToMarkdown, downloadFilename };
export default planToMarkdown;
