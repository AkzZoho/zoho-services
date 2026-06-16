/**
 * findUsages — deterministic scanner for token occurrences inside a parsed
 * Creator application.
 *
 * Use case:
 *   The consultant types "Change shriniwash.yadav_adityabirla to utcl_cms".
 *   They need to know EXACTLY where that identifier appears so they can apply
 *   the rename safely. An LLM cannot answer this reliably (it does not see
 *   the raw source line-by-line and will invent line numbers). So we do the
 *   search ourselves and feed the LLM only structural context if it is
 *   needed later.
 *
 * Inputs:
 *   overview  — the response from /api/inspect (must contain `workflows`,
 *               `pages`, `customFunctions` with their `sourceCode` strings).
 *   oldValue  — the string or regex source to search for. REQUIRED.
 *   options   — { matchCase?:boolean, wholeWord?:boolean, useRegExp?:boolean,
 *                 maxOccurrencesPerEntity?:number, maxTotalOccurrences?:number }
 *
 * Output:
 *   {
 *     query: { oldValue, newValue, matchCase, wholeWord, useRegExp },
 *     totals: { entitiesScanned, entitiesWithMatches, occurrences, truncated },
 *     occurrences: Occurrence[],
 *     groupedByEntity: { entityKey, entityKind, entityName, displayName,
 *                        matches: Occurrence[] }[]
 *   }
 *
 *   Occurrence = {
 *     entityKind:      'workflow' | 'function' | 'page',
 *     entityName:      string,              // API name
 *     displayName:     string,              // human label (workflow.displayName, etc.)
 *     line:            number,              // 1-based line number within the entity source
 *     column:          number,              // 1-based column where match starts
 *     lineText:        string,              // the full line, trimmed to <= 320 chars
 *     matchText:       string,              // the substring that matched (post-regex)
 *     enclosingScope:  string,              // breadcrumb of enclosing Deluge blocks
 *                                           // (e.g. "on add → actions → submit"). '' at top level.
 *     scopePath:       string[],            // raw scope segments (for UI grouping / sorting)
 *     replacement?:    string,              // suggested replacement line (if newValue provided)
 *   }
 *
 * Hard limits (DoS guard — the .ds can carry megabytes of Deluge):
 *   - per-entity occurrence cap:  default 50, max 200
 *   - global occurrence cap:      default 500, max 2000
 *   - per-line text clipping:     320 chars (mid-truncates around the match)
 */

const MAX_OCCURRENCES_PER_ENTITY = 200;
const MAX_TOTAL_OCCURRENCES = 2_000;
const DEFAULT_PER_ENTITY = 50;
const DEFAULT_TOTAL = 500;
const MAX_LINE_LENGTH = 320;
const MAX_OLD_VALUE_LENGTH = 500;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the RegExp used to scan source. Always anchored with `g` so we can
 * iterate every match. Returns null if the inputs cannot produce a safe regex.
 */
function buildSearchRegExp(oldValue, { matchCase, wholeWord, useRegExp }) {
  if (typeof oldValue !== 'string' || oldValue.length === 0) return null;
  if (oldValue.length > MAX_OLD_VALUE_LENGTH) return null;

  let pattern;
  if (useRegExp) {
    // Caller-supplied regex: validate by attempting construction.
    pattern = oldValue;
  } else {
    pattern = escapeRegExp(oldValue);
    if (wholeWord) {
      // Use lookarounds rather than \b so identifiers containing '.' or '_'
      // (e.g. shriniwash.yadav_adityabirla) match cleanly — \b treats the '.'
      // as a word boundary, which would incorrectly match substrings.
      pattern = `(?<![A-Za-z0-9_.])${pattern}(?![A-Za-z0-9_.])`;
    }
  }

  try {
    return new RegExp(pattern, matchCase ? 'g' : 'gi');
  } catch (_err) {
    return null;
  }
}

/**
 * Clip a long source line to MAX_LINE_LENGTH around the match position so
 * the UI doesn't have to render a 4000-char Deluge line. Adds ellipses on
 * either side when truncated.
 */
function clipLineAroundMatch(line, matchStart, matchLen) {
  if (line.length <= MAX_LINE_LENGTH) return { lineText: line, columnOffset: 0 };

  const halfBudget = Math.max(40, Math.floor((MAX_LINE_LENGTH - matchLen) / 2));
  let start = Math.max(0, matchStart - halfBudget);
  let end = Math.min(line.length, matchStart + matchLen + halfBudget);

  // Snap start/end to the nearest whitespace for readability — but only nudge
  // a BOUNDED number of characters. On a line with no whitespace near the
  // budget edge (e.g. a single 1600-char minified statement) an unbounded
  // snap would walk all the way to the line ends and defeat the clipping
  // entirely, so we cap the nudge distance.
  const SNAP_LIMIT = 32;
  let snapped = 0;
  while (start > 0 && /\S/.test(line[start]) && snapped < SNAP_LIMIT) {
    start -= 1;
    snapped += 1;
  }
  snapped = 0;
  while (end < line.length && /\S/.test(line[end]) && snapped < SNAP_LIMIT) {
    end += 1;
    snapped += 1;
  }

  const prefix = start > 0 ? '… ' : '';
  const suffix = end < line.length ? ' …' : '';
  return {
    lineText: prefix + line.slice(start, end) + suffix,
    columnOffset: start - prefix.length,
  };
}

/**
 * Build a line-indexed map of enclosing Deluge scopes for a given source.
 *
 * A "scope" is any brace block whose opening `{` is preceded by a recognisable
 * header on the same logical statement — e.g.
 *
 *   on validate {                ← scope: "on validate"
 *     actions {                  ← nested: "actions"
 *       submit (                 (parenthesised — ignored for scope naming)
 *         "Save"
 *       ) {                      ← nested: 'submit ("Save")'
 *         info "hi";             ← lookup here returns "on validate → actions → submit (\"Save\")"
 *       }
 *     }
 *   }
 *
 * The walker is comment- and string-aware (re-using the same skipping logic
 * as `dsParser.js`) so braces inside strings or block comments are ignored.
 *
 * Returns:
 *   {
 *     scopeFor(lineIdx0Based): string[]   // stack from outermost → innermost,
 *                                         // EXCLUDING the synthetic wrapper
 *                                         // that the parser added (form X / page Y / ...).
 *                                         // Empty array means "top-level inside the entity".
 *   }
 *
 * Implementation notes:
 *   - We track the scope stack as we scan and snapshot a copy at the END of
 *     each line. Snapshots are kept on a per-line array; `scopeFor(i)` returns
 *     the snapshot that was active WHILE that line was being scanned, which
 *     means we record the stack at the moment we encountered the line's FIRST
 *     non-whitespace character (more intuitive than "end of line" when a `{`
 *     opens at column N — the rest of that line counts as inside the new scope).
 *   - The header for a `{` is the trailing text since the last statement
 *     terminator (`{`, `}`, `;`, or start of file), stripped of comments/
 *     strings/parenthesised expressions and trimmed. We clip overlong headers
 *     to 80 chars to keep the UI tidy.
 *   - Headers that are clearly noise (empty, an operator, a closing brace
 *     artefact) become "block" so the breadcrumb still shows nesting depth.
 */
function buildScopeIndex(source) {
  const lines = source.split('\n');
  const N = source.length;

  // Per-line snapshot of the scope stack ACTIVE while scanning that line.
  // Index 0 = before any character has been read; we copy this into each
  // line slot as we cross newlines so a match anywhere on the line resolves
  // correctly even if a `{` opens later on the same line.
  const perLine = new Array(lines.length);
  const stack = [];
  let currentLine = 0;
  perLine[0] = stack.slice();

  // Per-line array of [startCol, endCol) ranges (0-based, end exclusive)
  // that are inside a `//` line comment or `/* ... */` block comment.
  // A match whose start column falls into any of these ranges is treated as
  // commented-out and excluded from the results — commented code does not
  // affect behaviour, so it must not appear in the developer handover.
  // Strings are handled separately above (they are skipped without recording
  // a range), so an identifier inside a string literal is NOT suppressed.
  const commentRanges = new Array(lines.length);
  for (let k = 0; k < lines.length; k += 1) commentRanges[k] = [];

  // Precompute the absolute offset where each line starts so we can convert
  // an index into the source string into a 0-based column on its line.
  const lineStartOffsets = new Array(lines.length);
  {
    let off = 0;
    for (let k = 0; k < lines.length; k += 1) {
      lineStartOffsets[k] = off;
      off += lines[k].length + 1; // +1 for the '\n' that was split out
    }
  }
  function colOf(absIdx, lineIdx0) {
    return absIdx - lineStartOffsets[lineIdx0];
  }
  function markCommentRange(lineIdx0, startCol, endCol) {
    if (lineIdx0 < 0 || lineIdx0 >= lines.length) return;
    const s = Math.max(0, startCol);
    const e = Math.max(s, Math.min(endCol, lines[lineIdx0].length));
    if (e > s) commentRanges[lineIdx0].push([s, e]);
  }

  // Header capture: the bytes since the last statement boundary, NOT
  // including string/comment content. We rebuild this as we go.
  let headerBuf = '';

  // Helper: commit the current line's snapshot (call when we move to the
  // next line OR right after pushing/popping the stack on the same line).
  function snapshot() {
    perLine[currentLine] = stack.slice();
  }

  function resetHeader() {
    headerBuf = '';
  }

  function pushScope(rawHeader, openLine) {
    const label = cleanScopeHeader(rawHeader);
    stack.push({ label: label || 'block', openLine });
    // Mutate current line's snapshot so a match LATER on this line sees
    // itself as inside the new scope. Earlier matches on the line already
    // captured the pre-push snapshot.
    snapshot();
  }

  function popScope() {
    if (stack.length) stack.pop();
    snapshot();
  }

  let i = 0;
  while (i < N) {
    const ch = source[i];

    // Newline → commit snapshot for the NEW line and continue.
    if (ch === '\n') {
      currentLine += 1;
      if (currentLine < lines.length) perLine[currentLine] = stack.slice();
      i += 1;
      continue;
    }

    // Block comment
    if (ch === '/' && source[i + 1] === '*') {
      const openLine = currentLine;
      const openCol = colOf(i, openLine);
      const end = source.indexOf('*/', i + 2);
      if (end === -1) {
        // Unterminated — consume the rest as a comment AND mark every
        // remaining line (from the opener to EOF) as fully commented.
        markCommentRange(openLine, openCol, lines[openLine].length);
        for (let k = i; k < N; k += 1) {
          if (source[k] === '\n') {
            currentLine += 1;
            if (currentLine < lines.length) {
              perLine[currentLine] = stack.slice();
              markCommentRange(currentLine, 0, lines[currentLine].length);
            }
          }
        }
        i = N;
        continue;
      }
      // Terminated `/* ... */`. Record the commented span on each line
      // that the comment crosses: opener line from openCol to EOL, every
      // interior line in full, and the closing line up to and including `*/`.
      if (openLine === currentLine) {
        // Opener and closer might end up on different lines after we walk
        // newlines below — but at this point currentLine still == openLine.
      }
      // Walk through the comment body so we both advance line tracking and
      // know which line the `*/` lands on.
      // First mark the opener line up to its EOL (if the comment spans
      // multiple lines) — we'll trim back to the actual close col if it
      // turns out the whole comment fits on the opener line.
      let crossedLines = false;
      for (let k = i; k < end + 2; k += 1) {
        if (source[k] === '\n') {
          if (!crossedLines) {
            // First newline encountered — finalise the opener line span.
            markCommentRange(currentLine, openCol, lines[currentLine].length);
            crossedLines = true;
          } else {
            // Interior line — entirely inside the comment.
            markCommentRange(currentLine, 0, lines[currentLine].length);
          }
          currentLine += 1;
          if (currentLine < lines.length) perLine[currentLine] = stack.slice();
        }
      }
      // Closer line: from col 0 (if we crossed lines) or from openCol (if
      // the whole comment fits on one line) up to the col AFTER the `*/`.
      const closeColEnd = colOf(end + 2, currentLine);
      markCommentRange(currentLine, crossedLines ? 0 : openCol, closeColEnd);
      i = end + 2;
      continue;
    }

    // Line comment
    if (ch === '/' && source[i + 1] === '/') {
      const startCol = colOf(i, currentLine);
      const nl = source.indexOf('\n', i + 2);
      if (nl === -1) {
        markCommentRange(currentLine, startCol, lines[currentLine].length);
        i = N;
        continue;
      }
      // Mark from `//` to end-of-line (exclusive of '\n').
      markCommentRange(currentLine, startCol, lines[currentLine].length);
      // Skip the comment body but DON'T consume the newline — the main loop
      // will handle it and advance currentLine.
      i = nl;
      continue;
    }

    // String literal — skip without considering its contents for headers.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let k = i + 1;
      while (k < N) {
        const c = source[k];
        if (c === '\\') { k += 2; continue; }
        if (c === '\n') {
          // Unterminated string — bail but keep line tracking correct.
          break;
        }
        if (c === quote) { k += 1; break; }
        k += 1;
      }
      // Whatever the string contained, the header buffer treats it as a
      // single opaque token so trailing context like `submit ("Save")`
      // still reads naturally.
      headerBuf += ' "" ';
      i = k;
      continue;
    }

    // Parenthesised expression — preserve in the header (so we can show
    // function signatures like `void utils.foo(string x)`) but skip brace
    // bookkeeping for content inside, because Deluge does not nest `{` in
    // `(...)` for scope-bearing constructs.
    if (ch === '(') {
      // Walk balanced parens, copying text verbatim into the header buffer.
      let depth = 0;
      let k = i;
      while (k < N) {
        const c = source[k];
        if (c === '"' || c === "'") {
          const q = c;
          k += 1;
          while (k < N) {
            if (source[k] === '\\') { k += 2; continue; }
            if (source[k] === q) { k += 1; break; }
            if (source[k] === '\n') break;
            k += 1;
          }
          continue;
        }
        if (c === '(') depth += 1;
        else if (c === ')') {
          depth -= 1;
          if (depth === 0) { k += 1; break; }
        } else if (c === '\n') {
          currentLine += 1;
          if (currentLine < lines.length) perLine[currentLine] = stack.slice();
        }
        k += 1;
      }
      headerBuf += source.slice(i, k);
      i = k;
      continue;
    }

    if (ch === '{') {
      pushScope(headerBuf, currentLine);
      resetHeader();
      i += 1;
      continue;
    }

    if (ch === '}') {
      popScope();
      resetHeader();
      i += 1;
      continue;
    }

    // Statement terminator — reset the header so we don't accidentally
    // attribute a leading `x = 1; foo {` to "x = 1; foo".
    if (ch === ';') {
      resetHeader();
      i += 1;
      continue;
    }

    headerBuf += ch;
    i += 1;
  }

  // Fill any unset slots (defensive — shouldn't happen but cheap insurance).
  for (let k = 0; k < perLine.length; k += 1) {
    if (!perLine[k]) perLine[k] = [];
  }

  // The outermost scope is always the synthetic wrapper added by the parser
  // (e.g. `form X`, `page Y`, `void utils.foo(...)`) — the entity itself.
  // We drop it because the consumer already knows the entity name and the
  // breadcrumb should describe what's INSIDE.
  function scopeFor(lineIdx) {
    const snap = perLine[lineIdx] || [];
    if (snap.length === 0) return [];
    return snap.slice(1).map((s) => s.label);
  }

  /**
   * Returns true when the given 0-based (lineIdx, col) lies inside a
   * `//` or `/* ... *\/` comment. The caller passes a 0-based column —
   * the column where the match STARTS — and we check inclusion against
   * the per-line ranges recorded during the walk above.
   */
  function isCommented(lineIdx, col) {
    const ranges = commentRanges[lineIdx];
    if (!ranges || ranges.length === 0) return false;
    for (let k = 0; k < ranges.length; k += 1) {
      const [s, e] = ranges[k];
      if (col >= s && col < e) return true;
    }
    return false;
  }

  return { scopeFor, isCommented };
}

/**
 * Normalise a raw header string captured from the source into a tidy,
 * human-readable scope label.
 */
function cleanScopeHeader(raw) {
  if (!raw) return '';
  // Collapse whitespace.
  let s = raw.replace(/\s+/g, ' ').trim();
  // Drop leading punctuation artefacts.
  s = s.replace(/^[,=:|&]+/, '').trim();
  // The synthetic empty-string placeholder from string literals isn't useful
  // as a label by itself — collapse runs of it.
  s = s.replace(/(?:""\s*)+/g, '"…" ').trim();
  if (s.length > 80) s = s.slice(0, 79) + '…';
  return s;
}

/**
 * Public form of the scope index: given a source string and a 1-based line
 * number, return the enclosing scope breadcrumb (innermost last) as both
 * an array and a formatted string.
 */
function getEnclosingScope(source, lineNumber1Based) {
  if (typeof source !== 'string' || !source.length) return { scopePath: [], scope: '' };
  const idx = buildScopeIndex(source);
  const lineIdx0 = Math.max(0, (lineNumber1Based | 0) - 1);
  const scopePath = idx.scopeFor(lineIdx0);
  return { scopePath, scope: scopePath.join(' → ') };
}

/**
 * Scan one source-bearing entity (workflow / function / page) and return
 * every occurrence of `regex` with line/column metadata.
 */
function scanEntity({ source, entityKind, entityName, displayName, regex, perEntityCap, newValue }) {
  const out = [];
  if (!source || typeof source !== 'string') return out;

  const scopeIndex = buildScopeIndex(source);
  const lines = source.split('\n');
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    if (out.length >= perEntityCap) break;
    const rawLine = lines[lineIdx];
    // Reset lastIndex per-line — we instantiated regex with `g`.
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(rawLine)) !== null) {
      if (out.length >= perEntityCap) break;
      const matchText = m[0];
      const matchStart = m.index;

      // Skip matches that fall inside a `//` line comment or a `/* ... */`
      // block comment. Commented-out code has no runtime effect, so it
      // would be noise in the developer handover. Note: matchStart is a
      // 0-based column on the raw source line, which is exactly what
      // isCommented() expects.
      if (scopeIndex.isCommented(lineIdx, matchStart)) {
        if (m.index === regex.lastIndex) regex.lastIndex += 1;
        continue;
      }

      const clipped = clipLineAroundMatch(rawLine, matchStart, matchText.length);
      const column = matchStart - clipped.columnOffset + 1;

      // Suggested replacement line: only computed when caller provided a newValue.
      // We re-run the same regex over the original line and substitute every
      // occurrence so a multi-hit line previews correctly.
      let replacement;
      if (typeof newValue === 'string') {
        const replaceRe = new RegExp(regex.source, regex.flags);
        const replacedLine = rawLine.replace(replaceRe, newValue);
        const clippedReplacement = clipLineAroundMatch(
          replacedLine,
          matchStart,
          newValue.length
        );
        replacement = clippedReplacement.lineText;
      }

      const scopePath = scopeIndex.scopeFor(lineIdx);
      out.push({
        entityKind,
        entityName,
        displayName: displayName || entityName,
        line: lineIdx + 1,
        column,
        lineText: clipped.lineText,
        matchText,
        scopePath,
        enclosingScope: scopePath.join(' → '),
        ...(replacement !== undefined ? { replacement } : {}),
      });

      // Guard against zero-width regex matches (e.g. `(?=)`) which would
      // otherwise loop forever.
      if (m.index === regex.lastIndex) regex.lastIndex += 1;
    }
  }
  return out;
}

/**
 * Run a find-usages scan across all source-bearing entities in `overview`.
 */
function findUsages(overview, oldValue, options = {}) {
  const opts = {
    matchCase: !!options.matchCase,
    wholeWord: !!options.wholeWord,
    useRegExp: !!options.useRegExp,
    maxOccurrencesPerEntity: clamp(
      options.maxOccurrencesPerEntity ?? DEFAULT_PER_ENTITY,
      1,
      MAX_OCCURRENCES_PER_ENTITY
    ),
    maxTotalOccurrences: clamp(
      options.maxTotalOccurrences ?? DEFAULT_TOTAL,
      1,
      MAX_TOTAL_OCCURRENCES
    ),
  };

  const regex = buildSearchRegExp(oldValue, opts);
  if (!regex) {
    const reason =
      typeof oldValue !== 'string' || !oldValue.length
        ? 'oldValue is required'
        : oldValue.length > MAX_OLD_VALUE_LENGTH
        ? `oldValue too long (max ${MAX_OLD_VALUE_LENGTH} chars)`
        : opts.useRegExp
        ? 'Invalid regular expression'
        : 'Could not build search pattern';
    return {
      query: { oldValue, newValue: options.newValue ?? null, ...opts },
      totals: { entitiesScanned: 0, entitiesWithMatches: 0, occurrences: 0, truncated: false },
      occurrences: [],
      groupedByEntity: [],
      error: reason,
    };
  }

  const newValue = typeof options.newValue === 'string' ? options.newValue : undefined;

  // Collect every (kind, name, source) tuple to scan. Pages are included
  // because page scripts can also reference Deluge identifiers.
  const entities = [];
  for (const wf of overview?.workflows || []) {
    if (wf?.sourceCode) {
      entities.push({
        entityKind: 'workflow',
        entityName: wf.name,
        displayName: wf.displayName || wf.name,
        source: wf.sourceCode,
      });
    }
  }
  for (const fn of overview?.customFunctions || []) {
    if (fn?.sourceCode) {
      const fullName = fn.namespace ? `${fn.namespace}.${fn.name}` : fn.name;
      entities.push({
        entityKind: 'function',
        entityName: fullName,
        displayName: fullName,
        source: fn.sourceCode,
      });
    }
  }
  for (const pg of overview?.pages || []) {
    if (pg?.sourceCode) {
      entities.push({
        entityKind: 'page',
        entityName: pg.name,
        displayName: pg.displayName || pg.name,
        source: pg.sourceCode,
      });
    }
  }

  const occurrences = [];
  const groupedByEntity = [];
  let truncated = false;

  for (const ent of entities) {
    if (occurrences.length >= opts.maxTotalOccurrences) {
      truncated = true;
      break;
    }
    const remaining = opts.maxTotalOccurrences - occurrences.length;
    // The effective cap for this entity is the smaller of the per-entity
    // limit and whatever global budget is left. When an entity fills this
    // cap, more matches may exist that we didn't collect — i.e. the result
    // is truncated (handled below after the scan).
    const perEntityCap = Math.min(opts.maxOccurrencesPerEntity, remaining);
    const matches = scanEntity({
      source: ent.source,
      entityKind: ent.entityKind,
      entityName: ent.entityName,
      displayName: ent.displayName,
      regex,
      perEntityCap,
      newValue,
    });
    if (matches.length) {
      occurrences.push(...matches);
      groupedByEntity.push({
        entityKey: `${ent.entityKind}:${ent.entityName}`,
        entityKind: ent.entityKind,
        entityName: ent.entityName,
        displayName: ent.displayName,
        matches,
      });
      // Flag truncation when this entity filled its effective cap — whether
      // that cap came from the per-entity limit or from the remaining global
      // budget. In both cases additional matches may exist that we skipped.
      if (matches.length >= perEntityCap) truncated = true;
    }
  }

  return {
    query: { oldValue, newValue: newValue ?? null, ...opts },
    totals: {
      entitiesScanned: entities.length,
      entitiesWithMatches: groupedByEntity.length,
      occurrences: occurrences.length,
      truncated,
    },
    occurrences,
    groupedByEntity,
  };
}

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(x)));
}

module.exports = {
  findUsages,
  getEnclosingScope,
  _internal: { buildSearchRegExp, scanEntity, clipLineAroundMatch, buildScopeIndex, cleanScopeHeader },
  _limits: {
    MAX_OCCURRENCES_PER_ENTITY,
    MAX_TOTAL_OCCURRENCES,
    DEFAULT_PER_ENTITY,
    DEFAULT_TOTAL,
    MAX_LINE_LENGTH,
    MAX_OLD_VALUE_LENGTH,
  },
};
