/**
 * Zoho Creator .ds parser — v0.2
 *
 * Real Creator `.ds` exports are a text-based Deluge-like DSL, not ZIP/XML.
 * This parser walks the file with a lightweight tokeniser + brace-aware
 * scanner and extracts the sections a PM / consultant actually cares about:
 *
 *   - application  { name, dateFormat, timeZone, timeFormat }
 *   - forms[]      { name, displayName, fields[], actions{}, workflowCount }
 *   - reports[]    { name, displayName, type, baseForm, columnCount,
 *                    filters[], customActions[] }
 *   - pages[]      { name, displayName, section, hasScript, size,
 *                    embeddedForms[], embeddedReports[] }
 *   - workflows[]  { name, type, form, event, actionKinds[] }
 *   - customFunctions[] { name, namespace, returnType, params[], scriptSize }
 *   - roles[]      { name, description }
 *   - shareSettings[] { name, type, description }
 *
 * Legacy ZIP / XML / JSON paths are kept as a graceful fallback so that any
 * third-party "manifest" style export continues to work.
 *
 * Deliberately NOT implemented (tracked in rules/ds-parser-rules.md):
 *   - Full Deluge parsing. We only need structural counts + names; deep
 *     script bodies are measured by length and left opaque.
 *   - Multi-environment (stage/dev) diffing. We keep the *first* top-level
 *     block and ignore duplicates further down the file.
 *
 * The parser is intentionally defensive: malformed / partial files yield
 * warnings on the result object rather than exceptions.
 */

const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');
const { ApiError } = require('../utils/errors');

const MAX_ENTRY_BYTES = 5 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/*  Public entry point                                                         */
/* -------------------------------------------------------------------------- */

/**
 * @param {Buffer} buffer
 * @param {string} fileName
 * @returns {Promise<object>}
 */
async function parseDs(buffer, fileName = 'app.ds') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ApiError(400, 'Empty .ds file');
  }

  const format = sniff(buffer);
  const result = normaliseSkeleton();
  result._raw.format = format;
  result._raw.fileName = fileName;
  result._raw.sizeBytes = buffer.length;

  try {
    if (format === 'dsl') {
      parseDslText(buffer.toString('utf8'), result);
    } else if (format === 'zip') {
      parseZip(buffer, result);
    } else if (format === 'xml' || format === 'json') {
      parseTextDocument(buffer.toString('utf8'), format, result);
    } else {
      result.warnings.push(
        'Unknown .ds format — could not identify DSL / ZIP / XML / JSON signature.'
      );
    }
  } catch (err) {
    // Never let a single parse error nuke the whole response — surface it.
    result.warnings.push(`Parser error: ${err.message}`);
  }

  return result;
}

module.exports = {
  parseDs,
  _internal: { sniff, parseDslText, scanBlocks, extractTopLevelBlocks, safeEntryName },
};

/* -------------------------------------------------------------------------- */
/*  Format sniffing                                                            */
/* -------------------------------------------------------------------------- */

function sniff(buffer) {
  if (!buffer || buffer.length < 4) return 'unknown';
  const sig = buffer.slice(0, 4);
  if (sig[0] === 0x50 && sig[1] === 0x4b) return 'zip'; // PK\x03\x04

  const head = buffer.slice(0, 2048).toString('utf8');

  if (/^\s*<\?xml|^\s*</.test(head)) return 'xml';
  if (/^\s*[{[]/.test(head)) return 'json';

  // Real Creator `.ds` exports always start with a `/* ... */` header
  // followed by `application "Name"`. Detect either marker.
  if (/application\s+"/.test(head)) return 'dsl';
  if (/^\s*\/\*/.test(head) && /application/.test(head)) return 'dsl';

  return 'unknown';
}

/* -------------------------------------------------------------------------- */
/*  Normalised shape                                                           */
/* -------------------------------------------------------------------------- */

function normaliseSkeleton() {
  return {
    application: { name: '', namespace: '', version: '', dateFormat: '', timeZone: '', timeFormat: '' },
    forms: [],
    reports: [],
    pages: [],
    workflows: [],
    connections: [],
    roles: [],
    shareSettings: [],
    customFunctions: [],
    _raw: { entries: [] },
    warnings: [],
  };
}

/* -------------------------------------------------------------------------- */
/*  Legacy XML / JSON paths (kept for back-compat)                             */
/* -------------------------------------------------------------------------- */

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: true,
  trimValues: true,
});

function parseTextDocument(text, format, result) {
  try {
    if (format === 'json') {
      normaliseFromObject(JSON.parse(text), result);
    } else if (format === 'xml') {
      normaliseFromObject(xmlParser.parse(text), result);
    }
  } catch (err) {
    result.warnings.push(`Failed to parse ${format}: ${err.message}`);
  }
}

/**
 * Strips path-traversal sequences from a ZIP entry name.
 * `../../etc/passwd` → `etc/passwd`
 * `/abs/path`       → `abs/path`
 */
function safeEntryName(entryName) {
  return entryName.replace(/\.\.[/\\]/g, '').replace(/^[/\\]+/, '');
}

function parseZip(buffer, result) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (err) {
    throw new ApiError(400, `Invalid ZIP archive: ${err.message}`);
  }
  zip.getEntries().forEach((entry) => {
    if (entry.isDirectory) return;
    const name = safeEntryName(entry.entryName);
    const size = entry.header.size || 0;
    result._raw.entries.push({ name, size });
    if (size > MAX_ENTRY_BYTES) {
      result.warnings.push(`Skipped large entry: ${name} (${size} bytes)`);
      return;
    }
    if (/\.(xml|json)$/i.test(name)) {
      const text = entry.getData().toString('utf8');
      parseTextDocument(text, name.endsWith('.json') ? 'json' : 'xml', result);
    } else if (/\.ds$/i.test(name)) {
      parseDslText(entry.getData().toString('utf8'), result);
    }
  });
}

function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function normaliseFromObject(obj, result) {
  if (!obj || typeof obj !== 'object') return result;

  // Application metadata lives under an `application`, `app`, or `creator` key,
  // OR is inlined at root level.
  const appMeta = obj.application || obj.app || obj.creator || obj;
  if (appMeta.name) result.application.name = String(appMeta.name);
  if (appMeta['@_name']) result.application.name = String(appMeta['@_name']);

  // Top-level collections live on `obj` itself (common in test fixtures / flat JSON)
  // OR inside the app-meta node. Prefer `obj` first, fall back to `appMeta`.
  const container = obj;

  // `forms` may be:
  //   • a flat array of form objects  [{ name, fields }, ...]   (synthetic / test fixtures)
  //   • a nested XML/legacy object     { form: [...] }
  //   • a single object                { name, fields }
  const rawForms =
    container.forms?.form ??
    container.form ??
    (Array.isArray(container.forms) ? container.forms : null) ??
    appMeta.forms?.form ??
    appMeta.form ??
    appMeta.forms;
  toArray(rawForms).forEach((f) => {
    if (!f || typeof f !== 'object') return;
    // flat array: fields is already an array; legacy path: f.fields.field or f.field
    const rawFields = Array.isArray(f.fields) ? f.fields : (f.fields?.field ?? f.field ?? f.fields);
    const fields = toArray(rawFields);
    result.forms.push({
      name: f.name || f['@_name'] || 'Unnamed Form',
      displayName: f.displayName || f.label || f.name || '',
      fields: fields.map((fd) => ({
        name: fd?.name || fd?.['@_name'] || 'unnamed',
        type: fd?.type || fd?.['@_type'] || 'unknown',
        required: Boolean(fd?.required || fd?.['@_required']),
        unique: Boolean(fd?.unique),
        maxLength: fd?.maxLength ?? null,
        lookup: fd?.lookup ?? null,
      })),
      actions: { events: [] },
    });
  });

  // Workflows — flat array: [{ name, trigger, target, script }]
  const rawWorkflows = Array.isArray(container.workflows)
    ? container.workflows
    : Array.isArray(appMeta.workflows)
    ? appMeta.workflows
    : [];
  rawWorkflows.forEach((w) => {
    if (!w || typeof w !== 'object') return;
    result.workflows.push({
      name: w.name || 'unnamed',
      displayName: w.displayName || '',
      scope: w.scope || 'form',
      type: w.type || '',
      form: w.target || w.form || '',
      event: w.trigger || w.event || '',
      actionKinds: w.actionKinds || [],
      sourceCode: w.script
        ? `form ${w.target || w.name} {\n${w.script}\n}`
        : '',
    });
  });

  return result;
}

/* -------------------------------------------------------------------------- */
/*  DSL parser                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Top-level scan:
 *   1. Strip header comment(s).
 *   2. Locate the `application "Name" { ... }` block.
 *   3. Walk its children and hand off to section-specific extractors.
 */
function parseDslText(raw, result) {
  const text = raw.replace(/\r\n?/g, '\n');

  // Application name + app-level settings
  const appMatch = text.match(/application\s+"([^"]+)"\s*\{/);
  if (!appMatch) {
    result.warnings.push('No `application "..." { ... }` block found.');
    return;
  }
  result.application.name = appMatch[1];

  const appBodyStart = appMatch.index + appMatch[0].length;
  const appBody = sliceBalanced(text, appBodyStart - 1); // start at the `{`
  if (appBody == null) {
    result.warnings.push('Unbalanced braces on the application block.');
    return;
  }
  const body = appBody.inner;

  // App-level scalar settings (only care about a few)
  result.application.dateFormat = matchValue(body, /^\s*date\s+format\s*=\s*"([^"]*)"/m) || '';
  result.application.timeZone = matchValue(body, /^\s*time\s+zone\s*=\s*"([^"]*)"/m) || '';
  result.application.timeFormat = matchValue(body, /^\s*time\s+format\s*=\s*"([^"]*)"/m) || '';

  // Walk top-level blocks (forms / reports / pages / section / workflow / functions / roles / share_settings)
  const topBlocks = extractTopLevelBlocks(body);
  for (const blk of topBlocks) {
    switch (blk.keyword) {
      case 'forms':
        parseForms(blk.inner, result);
        break;
      case 'reports':
        parseReports(blk.inner, result);
        break;
      case 'pages':
        parsePages(blk.inner, result, null);
        break;
      case 'section':
        // Itron-style: section ACTS as a page container
        parsePagesSection(blk, result);
        break;
      case 'workflow':
        parseWorkflows(blk.inner, result);
        break;
      case 'functions':
        parseFunctions(blk.inner, result);
        break;
      case 'share_settings':
        parseShareSettings(blk.inner, result);
        break;
      // silently ignore 'web', 'mobile', 'ai', 'environment', ...
      default:
        break;
    }
  }

  // Dedup — real files contain the same app repeated once per environment.
  dedupByName(result.forms);
  dedupByName(result.reports);
  dedupByName(result.pages);
  dedupByName(result.workflows);
  dedupByName(result.customFunctions);
  dedupByName(result.roles);
  dedupByName(result.shareSettings);
}

function dedupByName(arr) {
  const seen = new Set();
  for (let i = arr.length - 1; i >= 0; i--) {
    const key = arr[i].name;
    if (seen.has(key)) arr.splice(i, 1);
    else seen.add(key);
  }
  arr.reverse(); // keep original order
  arr.reverse();
}

/* -------------------------------------------------------------------------- */
/*  Brace-aware scanner                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Given the full text and the offset of an opening brace (`{` or `(`),
 * return { inner, end } where `end` is the index AFTER the matching brace.
 * Skips over strings (single & double-quoted) and /* block comments * /.
 *
 * Returns null if no matching brace is found.
 */
function sliceBalanced(text, openIdx) {
  const open = text[openIdx];
  const close = open === '{' ? '}' : open === '(' ? ')' : null;
  if (!close) return null;

  let depth = 0;
  let i = openIdx;
  const N = text.length;

  while (i < N) {
    const ch = text[i];

    // block comment
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return null;
      i = end + 2;
      continue;
    }
    // line comment
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i + 2);
      i = nl === -1 ? N : nl + 1;
      continue;
    }
    // string literals
    if (ch === '"' || ch === "'") {
      i = skipString(text, i);
      continue;
    }

    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        return { inner: text.slice(openIdx + 1, i), end: i + 1 };
      }
    }
    i++;
  }
  return null;
}

function skipString(text, i) {
  const quote = text[i];
  i++;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return i;
}

/**
 * Find every top-level block at the current scope, where a block is a span of
 * text starting with `keyword [rest-of-head-line]` (optionally across several
 * lines with nothing but whitespace / a parameter list) and then `{ ... }`.
 *
 * Uses a forward walking scanner instead of regex so it handles the real
 * Creator layout where `{` sits on its own line below the keyword.
 *
 * Returns [{ keyword, head, params, inner, startIdx, endIdx }].
 */
function extractTopLevelBlocks(scopeText) {
  const blocks = [];
  const N = scopeText.length;
  let i = 0;

  while (i < N) {
    // Skip whitespace
    while (i < N && /[\s]/.test(scopeText[i])) i++;
    if (i >= N) break;

    // Skip comments
    if (scopeText[i] === '/' && scopeText[i + 1] === '*') {
      const e = scopeText.indexOf('*/', i + 2);
      i = e === -1 ? N : e + 2;
      continue;
    }
    if (scopeText[i] === '/' && scopeText[i + 1] === '/') {
      const nl = scopeText.indexOf('\n', i + 2);
      i = nl === -1 ? N : nl + 1;
      continue;
    }

    const lineStart = i;
    // Accept identifier OR quoted string as the start of a header
    //   (share_settings / roles use quoted profile names as heads)
    if (!/[A-Za-z_"']/.test(scopeText[i])) {
      while (i < N && scopeText[i] !== '\n') i++;
      continue;
    }

    // Grab the header up to the first `{` (balanced) or the first `=`, `;`, or EOF.
    // The header can span multiple lines if it only contains whitespace & (...).
    let j = i;
    let headEnd = -1; // index of `{`
    let sawEquals = false;
    let parenDepth = 0;

    while (j < N) {
      const ch = scopeText[j];
      // comment interruptions
      if (ch === '/' && scopeText[j + 1] === '*') {
        const e = scopeText.indexOf('*/', j + 2);
        j = e === -1 ? N : e + 2;
        continue;
      }
      if (ch === '/' && scopeText[j + 1] === '/') {
        const nl = scopeText.indexOf('\n', j + 2);
        j = nl === -1 ? N : nl + 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        j = skipString(scopeText, j);
        continue;
      }
      if (ch === '(') { parenDepth++; j++; continue; }
      if (ch === ')') { parenDepth--; j++; continue; }
      if (parenDepth > 0) { j++; continue; }

      if (ch === '{') { headEnd = j; break; }
      if (ch === '=' || ch === ';') { sawEquals = true; break; }
      j++;
    }

    if (headEnd === -1) {
      // No block brace found on this header → treat as a scalar / assignment.
      // Skip to the end of the logical statement (next `\n` at depth 0).
      if (sawEquals) {
        // consume the RHS, which may be `{ ... }` literal list. Skip until newline
        // at depth 0 (balanced braces/brackets).
        let d = 0;
        while (j < N) {
          const ch = scopeText[j];
          if (ch === '"' || ch === "'") { j = skipString(scopeText, j); continue; }
          if (ch === '{' || ch === '[' || ch === '(') d++;
          else if (ch === '}' || ch === ']' || ch === ')') d--;
          if (d <= 0 && ch === '\n') break;
          j++;
        }
        i = j + 1;
        continue;
      }
      // otherwise, just advance one line
      const nl = scopeText.indexOf('\n', i);
      i = nl === -1 ? N : nl + 1;
      continue;
    }

    const rawHead = scopeText.slice(lineStart, headEnd).trim();
    // Split the head into keyword / rest
    // Examples:
    //   "forms"
    //   "form Employee"
    //   "default list All_Products"
    //   "section Audit_Review"
    //   "page Home(string page)"
    //   "\"Read\""   (share_settings profiles use a quoted head)
    let keyword, head, params = '';
    if (rawHead.startsWith('"') || rawHead.startsWith("'")) {
      keyword = rawHead; // treat the quoted label as its own "keyword" for share_settings
      head = '';
    } else {
      const mParen = rawHead.match(/\(([\s\S]*?)\)\s*$/);
      if (mParen) {
        params = mParen[1].trim();
      }
      const noParen = rawHead.replace(/\(([\s\S]*?)\)\s*$/, '').trim();
      const firstSpace = noParen.search(/\s/);
      if (firstSpace === -1) {
        keyword = noParen;
        head = '';
      } else {
        keyword = noParen.slice(0, firstSpace);
        head = noParen.slice(firstSpace + 1).trim();
      }
    }

    const sliced = sliceBalanced(scopeText, headEnd);
    if (!sliced) break;

    blocks.push({
      keyword,
      head,
      params,
      inner: sliced.inner,
      startIdx: lineStart,
      endIdx: sliced.end,
    });
    i = sliced.end;
  }

  return blocks;
}

/**
 * A looser child-block scanner that accepts `name(args...)` heads too
 * (used for fields like `Products(...)`). Returns
 * [{ name, kind, head, inner, bracket }] where bracket is '{' or '('.
 */
function scanBlocks(scopeText, { allowParen = true } = {}) {
  const blocks = [];
  const N = scopeText.length;
  let i = 0;

  while (i < N) {
    const ch = scopeText[i];

    // Skip comments
    if (ch === '/' && scopeText[i + 1] === '*') {
      const e = scopeText.indexOf('*/', i + 2);
      i = e === -1 ? N : e + 2;
      continue;
    }
    if (ch === '/' && scopeText[i + 1] === '/') {
      const nl = scopeText.indexOf('\n', i + 2);
      i = nl === -1 ? N : nl + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(scopeText, i);
      continue;
    }

    // Look for an identifier head followed (eventually) by `{` or `(`
    if (/[A-Za-z_]/.test(ch)) {
      const headStart = i;
      while (i < N && /[A-Za-z0-9_\- \t]/.test(scopeText[i])) i++;
      const headText = scopeText.slice(headStart, i).trim();
      // Skip whitespace + optional (...) signature
      while (i < N && /[ \t\n]/.test(scopeText[i])) i++;

      // optional parameter list e.g. `page Foo(int x)`
      let params = '';
      if (allowParen && scopeText[i] === '(') {
        const p = sliceBalanced(scopeText, i);
        if (!p) break;
        params = p.inner;
        i = p.end;
        while (i < N && /[ \t\n]/.test(scopeText[i])) i++;
      }

      if (scopeText[i] === '{' || (allowParen && scopeText[i] === '(')) {
        const bracket = scopeText[i];
        const sliced = sliceBalanced(scopeText, i);
        if (!sliced) break;
        blocks.push({
          name: headText,
          kind: bracket === '{' ? 'block' : 'tuple',
          bracket,
          head: headText,
          params,
          inner: sliced.inner,
        });
        i = sliced.end;
        continue;
      }
      // not a block after all — move on
      continue;
    }
    i++;
  }
  return blocks;
}

function matchValue(text, re) {
  const m = re.exec(text);
  return m ? m[1] : null;
}

/* -------------------------------------------------------------------------- */
/*  Section extractors                                                         */
/* -------------------------------------------------------------------------- */

function parseForms(body, result) {
  const formBlocks = extractTopLevelBlocks(body).filter((b) => b.keyword === 'form');
  for (const fb of formBlocks) {
    const name = fb.head.trim();
    if (!name) continue;
    result.forms.push({
      name,
      displayName:
        matchValue(fb.inner, /^\s*displayname\s*=\s*"([^"]*)"/m) || name.replace(/_/g, ' '),
      successMessage: matchValue(fb.inner, /^\s*success\s+message\s*=\s*"([^"]*)"/m) || '',
      fields: extractFields(fb.inner),
      actions: extractFormActions(fb.inner),
    });
  }
}

/**
 * Field blocks look like:
 *   FieldName
 *   (
 *       type = text
 *       displayname = "..."
 *       ...
 *   )
 *
 *   Optional `must have` prefix marks it required.
 *   Nested `(...)` for grid sub-fields; we only count the outer one.
 *   Field-like wrappers `Section`, `actions` are skipped by name.
 */
const NON_FIELD_NAMES = new Set(['actions', 'validations', 'on', 'form']);

/**
 * Walk a form body and extract its field tuples.
 *
 * A field in Creator DSL is either:
 *   [must have] Name
 *   (
 *       type = ...
 *       ...
 *   )
 *
 * or a nested brace block for `actions { ... }`. Sections are also tuples
 * (`type = section`) and are filtered out.
 */
function extractFields(body) {
  const fields = [];
  const N = body.length;
  let i = 0;

  while (i < N) {
    // skip whitespace / comments
    const ch = body[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && body[i + 1] === '*') { const e = body.indexOf('*/', i + 2); i = e === -1 ? N : e + 2; continue; }
    if (ch === '/' && body[i + 1] === '/') { const nl = body.indexOf('\n', i + 2); i = nl === -1 ? N : nl + 1; continue; }
    if (ch === '"' || ch === "'") { i = skipString(body, i); continue; }

    if (!/[A-Za-z_]/.test(ch)) { i++; continue; }

    // Capture the identifier-heavy head up to the first `(` or `{` or `=`.
    const start = i;
    let j = i;
    let gotOpen = null;
    while (j < N) {
      const c = body[j];
      if (c === '/' && body[j + 1] === '*') { const e = body.indexOf('*/', j + 2); j = e === -1 ? N : e + 2; continue; }
      if (c === '/' && body[j + 1] === '/') { const nl = body.indexOf('\n', j + 2); j = nl === -1 ? N : nl + 1; continue; }
      if (c === '"' || c === "'") { j = skipString(body, j); continue; }
      if (c === '(' || c === '{') { gotOpen = c; break; }
      if (c === '=' || c === ';') { gotOpen = 'scalar'; break; }
      j++;
    }
    if (!gotOpen) break;

    const rawHead = body.slice(start, j).trim();

    if (gotOpen === 'scalar') {
      // e.g. `displayname = "..."` or `success message = "..."` — scalar config.
      // Skip to the newline at depth 0
      let d = 0;
      while (j < N) {
        const c = body[j];
        if (c === '"' || c === "'") { j = skipString(body, j); continue; }
        if (c === '{' || c === '[' || c === '(') d++;
        else if (c === '}' || c === ']' || c === ')') d--;
        if (d <= 0 && c === '\n') break;
        j++;
      }
      i = j + 1;
      continue;
    }

    const sliced = sliceBalanced(body, j);
    if (!sliced) break;

    // parse the head — strip leading `must have` / `unique` modifiers
    let required = false;
    let uniqueFlag = false;
    let headName = rawHead;
    while (true) {
      if (/^must\s+have\s+/i.test(headName)) {
        required = true;
        headName = headName.replace(/^must\s+have\s+/i, '').trim();
        continue;
      }
      if (/^unique\s+/i.test(headName)) {
        uniqueFlag = true;
        headName = headName.replace(/^unique\s+/i, '').trim();
        continue;
      }
      break;
    }

    if (gotOpen === '{') {
      // nested brace block (e.g. `actions { ... }`)
      i = sliced.end;
      continue;
    }

    // gotOpen === '('   → field tuple
    if (!headName || NON_FIELD_NAMES.has(headName.toLowerCase())) {
      i = sliced.end;
      continue;
    }

    const inner = sliced.inner;
    const type = (matchValue(inner, /^\s*type\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/m) || 'unknown').trim();

    if (type === 'section') {
      i = sliced.end;
      continue;
    }

    const displayName = matchValue(inner, /^\s*displayname\s*=\s*"([^"]*)"/m) || headName.replace(/_/g, ' ');
    const maxchar = matchValue(inner, /^\s*maxchar\s*=\s*(\d+)/m);
    const unique = uniqueFlag || /^\s*unique\s*=\s*true/m.test(inner);
    const lookup = matchValue(inner, /^\s*values\s*=\s*([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)/m);

    fields.push({
      name: headName,
      displayName,
      type,
      required,
      unique,
      maxLength: maxchar ? Number(maxchar) : null,
      lookup: lookup || null,
    });
    i = sliced.end;
  }

  return fields;
}

function extractFormActions(body) {
  // actions { on add { submit ( ... ) reset ( ... ) } on edit { ... } }
  const actionsBlock = extractTopLevelBlocks(body).find((b) => b.keyword === 'actions');
  if (!actionsBlock) return { events: [] };
  const events = [];
  for (const evt of extractTopLevelBlocks(actionsBlock.inner)) {
    if (evt.keyword !== 'on') continue;
    events.push({ event: evt.head.trim(), buttons: [] }); // detailed button parsing not needed
  }
  return { events };
}

/* ------------------------- reports ------------------------------------- */

const REPORT_KINDS = new Set([
  'list',
  'summary',
  'grid',
  'kanban',
  'calendar',
  'timeline',
  'spreadsheet',
  'pivot',
  'chart',
  'map',
]);

function parseReports(body, result) {
  // report blocks look like:
  //   [default] <kind> <Name> { ... }         e.g.  "default list All_Products"
  //   <kind> <Name> { ... }                   e.g.  "list openLDAP_Users"
  const blocks = extractTopLevelBlocks(body);
  for (const b of blocks) {
    let type = b.keyword;
    let headName = b.head.trim();

    if (type === 'default') {
      // keyword is `default`, head starts with e.g. `list All_Products`
      const m = headName.match(/^([a-z]+)\s+([A-Za-z_][A-Za-z0-9_]*)$/);
      if (!m) continue;
      type = m[1];
      headName = m[2];
    }
    if (!REPORT_KINDS.has(type)) continue;

    const name = headName;
    if (!name) continue;

    const displayName =
      matchValue(b.inner, /^\s*displayName\s*=\s*"([^"]*)"/m) || name.replace(/_/g, ' ');
    const hide = /^\s*hide\s*=\s*true/m.test(b.inner);

    // base form:   show all rows from <Form>  [filter]  ( col1 col2 ... )
    const fromMatch = b.inner.match(/show\s+all\s+rows\s+from\s+([A-Za-z_][A-Za-z0-9_]*)/);
    const baseForm = fromMatch ? fromMatch[1] : '';

    let columnCount = 0;
    let customActions = [];
    if (fromMatch) {
      const colParen = b.inner.indexOf('(', fromMatch.index + fromMatch[0].length);
      if (colParen !== -1) {
        const colsSlice = sliceBalanced(b.inner, colParen);
        if (colsSlice) {
          customActions = Array.from(
            colsSlice.inner.matchAll(/custom\s+action\s+"([^"]+)"/g)
          ).map((mm) => mm[1]);
          columnCount = countColumns(colsSlice.inner);
        }
      }
    }

    result.reports.push({
      name,
      displayName,
      type,
      baseForm,
      hidden: hide,
      columnCount,
      customActions,
    });
  }
}

function countColumns(text) {
  // strip sub-tuples (column format configs)
  let depth = 0;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  const lines = out
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^custom\s+action/i.test(l));
  // column entries look like `Name` or `Name as "Label"`
  return lines.filter((l) => /^[A-Za-z_][A-Za-z0-9_]*(\s+as\s+".+")?$/.test(l)).length;
}

/* ------------------------- pages & sections ---------------------------- */

function parsePages(body, result, sectionName) {
  for (const b of extractTopLevelBlocks(body)) {
    if (b.keyword !== 'page') continue;
    addPage(result, b, b.head.trim(), sectionName);
  }
}

function parsePagesSection(sectionBlock, result) {
  // A section can hold pages, forms, reports and/or workflows
  //   section <Name> {
  //       displayname = "..."
  //       page Foo { ... }
  //       form Bar { ... }
  //       list Baz { ... }
  //       workflow { ... }
  //   }
  const sectionName = sectionBlock.head || '(section)';
  for (const b of extractTopLevelBlocks(sectionBlock.inner)) {
    switch (b.keyword) {
      case 'page':
        addPage(result, b, b.head.trim(), sectionName);
        break;
      case 'form': {
        const name = b.head.trim();
        if (!name) break;
        result.forms.push({
          name,
          displayName:
            matchValue(b.inner, /^\s*displayname\s*=\s*"([^"]*)"/m) || name.replace(/_/g, ' '),
          successMessage: matchValue(b.inner, /^\s*success\s+message\s*=\s*"([^"]*)"/m) || '',
          fields: extractFields(b.inner),
          actions: extractFormActions(b.inner),
          section: sectionName,
        });
        break;
      }
      case 'workflow':
        parseWorkflows(b.inner, result);
        break;
      case 'default':
      default:
        if (REPORT_KINDS.has(b.keyword) || b.keyword === 'default') {
          // A single report block — re-run the report parser over just this slice.
          parseReports(sectionBlock.inner.slice(b.startIdx, b.endIdx), result);
        }
        break;
    }
  }
}

function addPage(result, block, name, sectionName) {
  const displayName = matchValue(block.inner, /^\s*displayname\s*=\s*"([^"]*)"/m) || name.replace(/_/g, ' ');
  const hide = /^\s*hide\s*=\s*true/m.test(block.inner);
  const content = matchValue(block.inner, /Content\s*=\s*"([\s\S]*?)"\s*(?=\n|$)/);
  const contentSize = content ? content.length : 0;
  const hasScript = /\bscript\s*\{/.test(block.inner);

  // Embedded component references inside the HTML snippet
  const embeddedForms = Array.from(
    (content || '').matchAll(/formLinkName\s*=\s*['"&a-z;]*([A-Za-z_][A-Za-z0-9_]*)/g)
  ).map((m) => m[1]);
  const embeddedReports = Array.from(
    (content || '').matchAll(/viewLinkName\s*=\s*['"&a-z;]*([A-Za-z_][A-Za-z0-9_]*)/g)
  ).map((m) => m[1]);

  // Preserve the full page source so the UI can show the whole `.ds` block
  // when the user clicks a page row.
  const paramPart = block.params ? `(${block.params})` : '';
  const sourceCode = `page ${name}${paramPart} {${block.inner}}`;

  result.pages.push({
    name,
    displayName,
    section: sectionName || null,
    hidden: hide,
    contentSize,
    hasScript,
    embeddedForms: Array.from(new Set(embeddedForms)),
    embeddedReports: Array.from(new Set(embeddedReports)),
    params: block.params || '',
    sourceCode,
  });
}

/* ------------------------- workflows ----------------------------------- */

function parseWorkflows(body, result) {
  // workflow { form { <Name> { type=..., form=..., record event=..., on success { actions { ... } } } } }
  // Scopes: form | report | schedule | button | custom_actions | ...
  for (const outer of extractTopLevelBlocks(body)) {
    const scope = outer.keyword;
    if (!scope) continue;
    for (const wf of extractTopLevelBlocks(outer.inner)) {
      // wf.keyword / wf.head  →  raw header was e.g. `Add_Incident_to_SDP as "Add Incident to SDP"`
      // My tokeniser puts the first identifier in `keyword` and the rest in `head`.
      const name = wf.keyword;
      const aliasMatch = (wf.head || '').match(/^as\s+"([^"]+)"$/);
      const displayName = aliasMatch ? aliasMatch[1] : '';

      const type =
        matchValue(wf.inner, /^\s*type\s*=\s*([A-Za-z_]+)/m) || scope;
      const form =
        matchValue(wf.inner, /^\s*form\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/m) || '';
      const event =
        matchValue(wf.inner, /^\s*record\s+event\s*=\s*([^\n]+)$/m) || '';

      const actionKinds = [];
      for (const inner of extractTopLevelBlocks(wf.inner)) {
        if (inner.keyword !== 'on') continue;
        for (const act of extractTopLevelBlocks(inner.inner)) {
          if (act.keyword !== 'actions') continue;
          for (const kind of extractTopLevelBlocks(act.inner)) {
            actionKinds.push(kind.keyword);
          }
        }
      }

      // Preserve the entire raw `.ds` block (outer brace-to-brace) so the UI
      // can display the exact source for a workflow when the user clicks it.
      // We reconstruct a user-readable header ("<scope> <name> [as \"Display\"]")
      // and wrap the already-extracted `inner` body in braces.
      const headLine = aliasMatch
        ? `${scope} ${name} as "${displayName}"`
        : `${scope} ${name}`;
      const sourceCode = `${headLine} {${wf.inner}}`;

      result.workflows.push({
        name,
        displayName,
        scope,
        type: (type || '').trim(),
        form,
        event: event.trim(),
        actionKinds: Array.from(new Set(actionKinds)),
        sourceCode,
      });
    }
  }
}

/* ------------------------- custom functions ---------------------------- */

function parseFunctions(body, result) {
  // functions { Deluge { void ns.foo() { ... } string bar() { ... } } }
  for (const lang of extractTopLevelBlocks(body)) {
    const langName = lang.keyword || 'Deluge';
    // Function signatures are free-floating — scan with a regex for safety
    const sigRe = /(?:^|\n)\s*([A-Za-z_][A-Za-z0-9_<>]*)\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\(([^)]*)\)\s*\{/g;
    let m;
    while ((m = sigRe.exec(lang.inner)) !== null) {
      const [full, returnType, fullName, paramStr] = m;
      // Find the matching end brace to measure script size
      const braceIdx = m.index + full.length - 1;
      const sliced = sliceBalanced(lang.inner, braceIdx);
      const size = sliced ? sliced.inner.length : 0;
      const [namespace, bareName] = fullName.includes('.')
        ? fullName.split('.').slice(-2)
        : ['', fullName];
      const params = paramStr
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const parts = p.split(/\s+/);
          return parts.length === 2 ? { type: parts[0], name: parts[1] } : { type: 'any', name: parts[0] };
        });

      result.customFunctions.push({
        name: bareName,
        namespace,
        returnType,
        params,
        scriptSize: size,
        language: langName,
      });
      if (sliced) sigRe.lastIndex = braceIdx + (sliced.end - braceIdx);
    }
  }
}

/* ------------------------- roles & share_settings --------------------- */

function parseShareSettings(body, result) {
  // share_settings {
  //    "Read" {
  //       name = ...
  //       type = ...
  //       permissions = {Chat:false, Predefined:true, ApiAccess:true, PIIAccess:true, ePHIAccess:true}
  //       description = "..."
  //       ModulePermissions {
  //          <FormName> {
  //              enabled = Create, Viewall, Modifyall, Import, Export, Tab
  //              allFieldsVisible = true
  //              ReportPermissions { <ReportName> = {"View","Edit","Delete"} }
  //          }
  //       }
  //    }
  //    roles { "CEO" { description = ... } }
  // }
  for (const b of extractTopLevelBlocks(body)) {
    if (b.keyword === 'roles') {
      for (const r of extractTopLevelBlocks(b.inner)) {
        const name = r.keyword.replace(/^["']|["']$/g, '');
        const description = matchValue(r.inner, /^\s*description\s*=\s*"([^"]*)"/m) || '';
        result.roles.push({ name, description });
      }
      continue;
    }
    const name = b.keyword.replace(/^["']|["']$/g, '');
    if (!name) continue;
    const type = matchValue(b.inner, /^\s*type\s*=\s*([A-Za-z_]+)/m) || '';
    const description = matchValue(b.inner, /^\s*description\s*=\s*"([^"]*)"/m) || '';
    const permissions = parsePermissionsMap(b.inner);
    const modulePermissions = parseModulePermissions(b.inner);
    result.shareSettings.push({
      name,
      type,
      description,
      permissions,
      modulePermissions,
    });
  }
}

/**
 * Parse a single-line inline map literal like:
 *   permissions = {Chat:false, Predefined:true, ApiAccess:true, PIIAccess:true, ePHIAccess:true}
 *
 * Returns a plain object with boolean/string values. Unknown / malformed
 * entries are skipped silently (we never throw on parse of profile metadata).
 */
function parsePermissionsMap(body) {
  const m = body.match(/^\s*permissions\s*=\s*\{([^}]*)\}/m);
  if (!m) return null;
  const out = {};
  m[1].split(',').forEach((pair) => {
    const kv = pair.split(':');
    if (kv.length !== 2) return;
    const k = kv[0].trim();
    const v = kv[1].trim();
    if (!k) return;
    if (v === 'true' || v === 'false') out[k] = v === 'true';
    else out[k] = v.replace(/^["']|["']$/g, '');
  });
  return out;
}

/**
 * Parse a `ModulePermissions { FormName { enabled = A,B,C ... } ... }` block
 * into [{ form, enabled: string[], allFieldsVisible: boolean,
 *         reportPermissions: { [report]: string[] } }].
 *
 * Only the top couple of knobs are extracted — enough for an architect
 * to see "Profile X can Create+View on Form Y" without pulling the full
 * grid. Deeper introspection is deliberately deferred (rules/ds-parser-rules).
 */
function parseModulePermissions(body) {
  const mpBlock = extractTopLevelBlocks(body).find(
    (b) => b.keyword === 'ModulePermissions'
  );
  if (!mpBlock) return [];
  const entries = [];
  for (const m of extractTopLevelBlocks(mpBlock.inner)) {
    const form = m.keyword;
    if (!form) continue;
    const enabledRaw = matchValue(m.inner, /^\s*enabled\s*=\s*([^\n]+)$/m) || '';
    const enabled = enabledRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const allFieldsVisible = /^\s*allFieldsVisible\s*=\s*true/m.test(m.inner);
    const rpBlock = extractTopLevelBlocks(m.inner).find(
      (b) => b.keyword === 'ReportPermissions'
    );
    const reportPermissions = {};
    if (rpBlock) {
      // Lines inside look like:   Report_Name={"View","Edit","Delete"}
      const re = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{([^}]*)\}/g;
      let match;
      while ((match = re.exec(rpBlock.inner)) !== null) {
        const rname = match[1];
        const ops = Array.from(match[2].matchAll(/"([^"]+)"/g)).map((mm) => mm[1]);
        reportPermissions[rname] = ops;
      }
    }
    entries.push({ form, enabled, allFieldsVisible, reportPermissions });
  }
  return entries;
}
