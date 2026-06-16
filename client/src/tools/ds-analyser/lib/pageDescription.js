/**
 * pageDescription.js — deterministic, plain-English summary of a Creator Page.
 *
 * A Creator `.ds` page is a stew of three languages:
 *   • Deluge   — data fetch + server-side logic inside `<%{ … %>`
 *   • HTML     — layout, embedded forms / reports, static markup
 *   • CSS + JS — presentation + optional client-side behaviour
 *
 * Users reviewing a large app (50+ pages) don't want to read 20 KB of raw
 * page source; they want a short, skimmable description of *what the page
 * is and what it does*. This module produces that description from the
 * parser output (`page` entry from `technicalScope`) using only static
 * analysis — no DOM, no LLM. Because it's pure, it's trivially unit-testable
 * and the exact same summary appears in every render.
 *
 * Output shape — kept narrow on purpose:
 *
 *   {
 *     headline   : string        // one-line role summary, e.g. "View-only report page"
 *     composition: string[]      // bulleted list of structural elements
 *     behaviour  : string[]      // what the Deluge / script does (side-effects, fetches, etc.)
 *     externals  : string[]      // cross-app / external refs ("calls master_database.EHS.*")
 *     notes      : string[]      // caveats / hints ("Hidden from navigation", "PDF-enabled")
 *     sizeLine   : string        // "~X lines · Y bytes"
 *   }
 *
 * The UI renders this as a card; each field is optional (empty arrays are
 * simply skipped).
 */

/* -------------------------------------------------------------------------- */
/*  Entry point                                                                */
/* -------------------------------------------------------------------------- */

export function describePage(page) {
  const src = String(page?.sourceCode || '');
  const deluge = decodeEmbeddedDeluge(src);

  const composition = [];
  const behaviour = [];
  const externals = [];
  const notes = [];

  /* --- composition ------------------------------------------------------- */
  const layout = countLayoutElements(src);
  if (layout.rows || layout.columns) {
    composition.push(
      `${layout.rows || 0} row${layout.rows === 1 ? '' : 's'} × ` +
        `${layout.columns || 0} column${layout.columns === 1 ? '' : 's'} layout`,
    );
  }
  const elements = countDspElements(src);
  const htmlSnippets = elements['HTML Snippet'] || 0;
  delete elements['HTML Snippet'];
  if (htmlSnippets) {
    composition.push(
      `${htmlSnippets} HTML snippet${htmlSnippets === 1 ? '' : 's'} ` +
        `(rendered markup + inline Deluge)`,
    );
  }
  for (const [name, n] of Object.entries(elements)) {
    composition.push(`${n} ${name}${n === 1 ? '' : 's'}`);
  }

  if ((page?.embeddedForms || []).length) {
    composition.push(
      `Embeds form${page.embeddedForms.length === 1 ? '' : 's'}: ${page.embeddedForms.join(', ')}`,
    );
  }
  if ((page?.embeddedReports || []).length) {
    composition.push(
      `Embeds report${page.embeddedReports.length === 1 ? '' : 's'}: ${page.embeddedReports.join(', ')}`,
    );
  }

  /* --- behaviour (Deluge + JS) ------------------------------------------ */
  if (deluge) {
    const lines = deluge.split('\n').length;
    behaviour.push(`~${lines} lines of Deluge inside the HTML snippet`);

    if (/\binput\.\w+/.test(deluge)) {
      const params = Array.from(new Set(Array.from(deluge.matchAll(/\binput\.(\w+)/g)).map((m) => m[1]))).slice(0, 6);
      if (params.length) {
        behaviour.push(`Reads page parameter${params.length === 1 ? '' : 's'}: ${params.join(', ')}`);
      }
    }
    const dataReads = countDelugeDataReads(deluge);
    if (dataReads.length) {
      const top = dataReads.slice(0, 4).map((r) => `${r.form}${r.criterion ? ' (filtered)' : ''}`);
      behaviour.push(
        `Fetches records from ${dataReads.length} form${dataReads.length === 1 ? '' : 's'}: ${top.join(', ')}${
          dataReads.length > top.length ? '…' : ''
        }`,
      );
    }
    if (/\bopenurl\s*\(/i.test(deluge)) behaviour.push('Opens external URLs (openUrl)');
    if (/\bsendmail\b/i.test(deluge)) behaviour.push('Sends email (sendmail)');
    if (/\binvokeurl\b/i.test(deluge)) behaviour.push('Calls external APIs (invokeurl)');
    if (/\binfo\s+/.test(deluge) || /\balert\s*\(/i.test(deluge)) {
      behaviour.push('Shows inline messages to the user');
    }
    if (/\bif\s*\(/.test(deluge)) behaviour.push('Contains conditional branches');
    if (/\bfor\s+each\b/i.test(deluge) || /\bwhile\s*\(/i.test(deluge)) {
      behaviour.push('Iterates over collections');
    }
  }

  if (hasClientScript(src)) {
    behaviour.push('Contains client-side JavaScript (`<script>` block)');
  }
  if (hasInlineCss(src)) {
    behaviour.push('Contains inline CSS (`<style>` block)');
  }

  /* --- external references ---------------------------------------------- */
  if (deluge) {
    const refs = collectExternalRefs(deluge);
    for (const r of refs) externals.push(r);
  }

  /* --- notes / flags ---------------------------------------------------- */
  if (page?.hidden) notes.push('Hidden from navigation');
  if (page?.section) notes.push(`In section "${page.section}"`);
  if (page?.params) notes.push(`Accepts parameters: ${page.params}`);
  if (/isPdfEnabled\s*=\s*['"]true['"]/i.test(src)) notes.push('Print / PDF export enabled');
  if (/isPrintEnabled\s*=\s*['"]true['"]/i.test(src)) notes.push('Printable');

  /* --- headline --------------------------------------------------------- */
  const headline = buildHeadline(page, {
    hasEmbeddedForm: (page?.embeddedForms || []).length > 0,
    hasEmbeddedReport: (page?.embeddedReports || []).length > 0,
    hasDeluge: !!deluge,
    dataReadCount: deluge ? countDelugeDataReads(deluge).length : 0,
    htmlSnippets,
  });

  /* --- size line -------------------------------------------------------- */
  const lineCount = src ? src.split('\n').length : 0;
  const byteLen = src ? src.length : 0;
  const sizeLine = `${lineCount.toLocaleString()} lines · ${formatBytes(byteLen)}`;

  return { headline, composition, behaviour, externals, notes, sizeLine };
}

/* -------------------------------------------------------------------------- */
/*  Static-analysis helpers                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Extract the Deluge source buried inside the page's `<![CDATA[htmlpage …
 * content <%{ … %> … ]]>` wrapper. The parser stores the page body verbatim,
 * so the Deluge is HTML-entity-encoded inside a CDATA section inside the
 * `Content=` attribute. We need to decode a handful of entities to make it
 * readable by our pattern detectors.
 */
function decodeEmbeddedDeluge(src) {
  if (!src) return '';
  // Walk every htmlpage CDATA block — a page may have several snippets.
  const blocks = Array.from(src.matchAll(/htmlpage\s+[\w]+\s*\([^)]*\)\s*content\s*([\s\S]*?)(?=\]\]>|$)/g));
  if (blocks.length === 0) return '';
  const raw = blocks.map((m) => m[1]).join('\n');
  return decodeEntities(raw);
}

function decodeEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Count `<row>` and `<column>` tags — Creator's layout primitives. */
function countLayoutElements(src) {
  const rows = (src.match(/<row\b/g) || []).length;
  const columns = (src.match(/<column\b/g) || []).length;
  return { rows, columns };
}

/**
 * Count every `<dsp … elementName='X'>` entry. The `dsp` tag wraps every
 * drag-and-drop widget Creator's page builder supports: HTML Snippet,
 * Form, Report, Button, Image, Panel, Iframe, etc.
 */
function countDspElements(src) {
  const counts = {};
  for (const m of src.matchAll(/elementName\s*=\s*['"]([^'"]+)['"]/g)) {
    const name = m[1];
    counts[name] = (counts[name] || 0) + 1;
  }
  return counts;
}

/** Detect `<script>` blocks inside the page markup. */
function hasClientScript(src) {
  // The `script { … }` Creator DSL block is a page-level client script;
  // `<script>` tags can also live inside an HTML Snippet.
  return /\bscript\s*\{/.test(src) || /<script\b/i.test(src);
}

function hasInlineCss(src) {
  return /<style\b/i.test(src);
}

/**
 * Detect Deluge data-fetch expressions:
 *
 *   FormName[CriterionExpr]            // collection
 *   FormName[CriterionExpr][0]         // first record
 *
 * Returns a deduped list of `{ form, criterion }` records.
 */
function countDelugeDataReads(deluge) {
  const reads = new Map();
  // Match identifier [ ... ] — bracket-balanced lightweight scan
  const re = /\b([A-Z][A-Za-z0-9_]{2,})\s*\[([^\[\]]{1,200})\]/g;
  let m;
  while ((m = re.exec(deluge)) !== null) {
    const form = m[1];
    const criterion = m[2].trim();
    // Skip obvious false-positives: array indexing, getJSON keys
    if (/^\d+$/.test(criterion)) continue;
    if (form === 'If' || form === 'For' || form === 'While') continue;
    const key = `${form}|${criterion}`;
    if (!reads.has(key)) reads.set(key, { form, criterion });
  }
  return Array.from(reads.values());
}

/**
 * Collect cross-application references like:
 *
 *   master_database.EHS.returnImage(...)
 *   thisapp.Settings.PublicKey(...)
 *   zoho.loginuserid / zoho.adminuserid
 *
 * Returns user-friendly strings (deduped, capped at 6 entries).
 */
function collectExternalRefs(deluge) {
  const found = new Set();
  // External app calls: app_name.ReportOrForm.function(...)
  for (const m of deluge.matchAll(/\b([a-z][a-z0-9_]+)\s*\.\s*([A-Z][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_]\w*)\s*\(/g)) {
    const app = m[1];
    if (app === 'input' || app === 'zoho' || app === 'thisapp') continue;
    found.add(`Calls \`${app}.${m[2]}.${m[3]}(…)\` (cross-app)`);
  }
  // thisapp.Resource.function(...)
  for (const m of deluge.matchAll(/\bthisapp\s*\.\s*([A-Z][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_]\w*)\s*\(/g)) {
    found.add(`Calls \`thisapp.${m[1]}.${m[2]}(…)\``);
  }
  // zoho.* user context
  if (/\bzoho\.loginuser(id|name|email)?\b/.test(deluge)) {
    found.add('Uses current Zoho user context (`zoho.loginuser…`)');
  }
  if (/\bzoho\.adminuser(id)?\b/.test(deluge)) {
    found.add('Uses admin user context (`zoho.adminuserid`)');
  }
  return Array.from(found).slice(0, 6);
}

/* -------------------------------------------------------------------------- */
/*  Headline builder                                                           */
/* -------------------------------------------------------------------------- */

function buildHeadline(page, flags) {
  const name = page?.displayName || page?.name || 'Page';
  const bits = [];

  if (flags.hasEmbeddedForm && flags.hasEmbeddedReport) {
    bits.push('Data-entry + reporting page');
  } else if (flags.hasEmbeddedForm) {
    bits.push('Form-embedding page');
  } else if (flags.hasEmbeddedReport) {
    bits.push('Report-embedding page');
  } else if (flags.hasDeluge) {
    if (flags.dataReadCount > 0) bits.push('Custom data-driven HTML page');
    else bits.push('Custom HTML page with Deluge logic');
  } else if (flags.htmlSnippets > 0) {
    bits.push('Static HTML page');
  } else {
    bits.push('Layout / navigation page');
  }

  if (page?.hidden) bits.push('(hidden)');
  return `${name} — ${bits.join(' ')}`;
}

/* -------------------------------------------------------------------------- */
/*  Tiny utilities                                                             */
/* -------------------------------------------------------------------------- */

function formatBytes(n) {
  if (!n || n < 1024) return `${n || 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/* Exposed for tests only. */
export const __test__ = {
  decodeEmbeddedDeluge,
  countLayoutElements,
  countDspElements,
  countDelugeDataReads,
  collectExternalRefs,
  hasClientScript,
  hasInlineCss,
};
