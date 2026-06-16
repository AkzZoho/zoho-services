/**
 * Unit tests for the deterministic findUsages scanner.
 *
 * Covers:
 *   - exact identifier hits across workflows / functions / pages
 *   - wholeWord behaviour with dotted identifiers (real-world example:
 *     "shriniwash.yadav_adityabirla")
 *   - case-sensitivity toggle
 *   - regex mode
 *   - replacement preview
 *   - per-entity and global occurrence caps
 *   - graceful handling of missing/empty inputs
 */

const {
  findUsages,
  getEnclosingScope,
  _internal: { buildScopeIndex, cleanScopeHeader },
} = require('../src/ds-analyser/analyzer/findUsages');

/* Helper — build a minimal overview shaped like the /api/inspect response. */
function makeOverview({ workflows = [], customFunctions = [], pages = [] } = {}) {
  return { workflows, customFunctions, pages };
}

describe('findUsages — basic correctness', () => {
  test('finds an identifier inside a workflow with the correct line + column', () => {
    const overview = makeOverview({
      workflows: [
        {
          name: 'OnAdd_Order',
          displayName: 'On add Order',
          sourceCode:
            'form Order {\n' +
            '  on add {\n' +
            '    actions {\n' +
            '      sendmail {\n' +
            '        to = "shriniwash.yadav_adityabirla@example.com"\n' +
            '      }\n' +
            '    }\n' +
            '  }\n' +
            '}',
        },
      ],
    });

    const result = findUsages(overview, 'shriniwash.yadav_adityabirla', {
      wholeWord: true,
    });

    expect(result.totals.occurrences).toBe(1);
    expect(result.occurrences[0]).toMatchObject({
      entityKind: 'workflow',
      entityName: 'OnAdd_Order',
      line: 5,
      matchText: 'shriniwash.yadav_adityabirla',
    });
    // The matched line must contain the original text (or a clipped form of it).
    expect(result.occurrences[0].lineText).toContain('shriniwash.yadav_adityabirla');
  });

  test('finds identifiers inside custom functions and pages too', () => {
    const overview = makeOverview({
      customFunctions: [
        {
          name: 'send_alert',
          namespace: 'utils',
          sourceCode:
            'void utils.send_alert(string body) {\n' +
            '  sendmail to: "shriniwash.yadav_adityabirla@x.com";\n' +
            '}',
        },
      ],
      pages: [
        {
          name: 'Home',
          displayName: 'Home',
          sourceCode:
            'page Home {\n' +
            '  script {\n' +
            '    owner = "shriniwash.yadav_adityabirla";\n' +
            '  }\n' +
            '}',
        },
      ],
    });

    const result = findUsages(overview, 'shriniwash.yadav_adityabirla');
    expect(result.totals.occurrences).toBe(2);
    const kinds = result.occurrences.map((o) => o.entityKind).sort();
    expect(kinds).toEqual(['function', 'page']);
  });

  test('groups results by entity', () => {
    const overview = makeOverview({
      workflows: [
        {
          name: 'A',
          sourceCode: 'form A {\n  x = "foo";\n  y = "foo";\n}',
        },
        {
          name: 'B',
          sourceCode: 'form B {\n  z = "foo";\n}',
        },
      ],
    });

    const result = findUsages(overview, 'foo');
    expect(result.groupedByEntity).toHaveLength(2);
    expect(result.groupedByEntity[0].matches).toHaveLength(2);
    expect(result.groupedByEntity[1].matches).toHaveLength(1);
  });
});

describe('findUsages — wholeWord with dotted identifiers', () => {
  /**
   * \b in JS regex treats '.' as a word boundary, so a naive \b implementation
   * would incorrectly match the suffix "yadav_adityabirla" inside a longer
   * identifier. Our custom lookaround must avoid that.
   */
  test('wholeWord:true does NOT match a longer dotted identifier as a partial', () => {
    const overview = makeOverview({
      workflows: [
        {
          name: 'WF',
          sourceCode:
            'form X {\n' +
            '  owner1 = "shriniwash.yadav_adityabirla";\n' +
            '  owner2 = "shriniwash.yadav_adityabirla.extended";\n' +
            '}',
        },
      ],
    });

    const result = findUsages(overview, 'shriniwash.yadav_adityabirla', {
      wholeWord: true,
    });

    // Only the first owner is an exact whole-identifier match.
    // The "extended" suffix on line 3 means it's a longer identifier — must be skipped.
    expect(result.totals.occurrences).toBe(1);
    expect(result.occurrences[0].line).toBe(2);
  });

  test('wholeWord:false matches the prefix anyway (substring mode)', () => {
    const overview = makeOverview({
      workflows: [
        {
          name: 'WF',
          sourceCode:
            'form X {\n' +
            '  owner1 = "shriniwash.yadav_adityabirla";\n' +
            '  owner2 = "shriniwash.yadav_adityabirla.extended";\n' +
            '}',
        },
      ],
    });

    const result = findUsages(overview, 'shriniwash.yadav_adityabirla', {
      wholeWord: false,
    });
    expect(result.totals.occurrences).toBe(2);
  });
});

describe('findUsages — case sensitivity', () => {
  test('default is case-insensitive', () => {
    const overview = makeOverview({
      workflows: [{ name: 'WF', sourceCode: 'x = "AdminUser";' }],
    });
    const result = findUsages(overview, 'adminuser');
    expect(result.totals.occurrences).toBe(1);
  });

  test('matchCase:true respects exact casing', () => {
    const overview = makeOverview({
      workflows: [{ name: 'WF', sourceCode: 'x = "AdminUser";\ny = "adminuser";' }],
    });
    const result = findUsages(overview, 'adminuser', { matchCase: true });
    expect(result.totals.occurrences).toBe(1);
    expect(result.occurrences[0].line).toBe(2);
  });
});

describe('findUsages — regex mode', () => {
  test('useRegExp:true treats oldValue as a regular expression', () => {
    const overview = makeOverview({
      workflows: [{ name: 'WF', sourceCode: 'a = 1;\nb = 22;\nc = 333;' }],
    });
    const result = findUsages(overview, '\\d{2,}', { useRegExp: true });
    expect(result.totals.occurrences).toBe(2);
    expect(result.occurrences[0].matchText).toBe('22');
    expect(result.occurrences[1].matchText).toBe('333');
  });

  test('invalid regex returns a clean error result instead of throwing', () => {
    const overview = makeOverview({
      workflows: [{ name: 'WF', sourceCode: 'x = 1;' }],
    });
    const result = findUsages(overview, '(', { useRegExp: true });
    expect(result.error).toBeDefined();
    expect(result.totals.occurrences).toBe(0);
  });
});

describe('findUsages — replacement preview', () => {
  test('produces a replaced-line preview when newValue is supplied', () => {
    const overview = makeOverview({
      workflows: [
        {
          name: 'WF',
          sourceCode: 'form X {\n  owner = "shriniwash.yadav_adityabirla";\n}',
        },
      ],
    });
    const result = findUsages(overview, 'shriniwash.yadav_adityabirla', {
      wholeWord: true,
      newValue: 'utcl_cms',
    });
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0].replacement).toContain('utcl_cms');
    expect(result.occurrences[0].replacement).not.toContain('shriniwash');
  });

  test('replaces all matches on a single line', () => {
    const overview = makeOverview({
      workflows: [{ name: 'WF', sourceCode: 'x = foo + foo + foo;' }],
    });
    const result = findUsages(overview, 'foo', { newValue: 'bar' });
    // Three matches all on line 1.
    expect(result.occurrences).toHaveLength(3);
    // Each replacement preview should show all three replaced.
    expect(result.occurrences[0].replacement).toBe('x = bar + bar + bar;');
  });
});

describe('findUsages — caps and limits', () => {
  test('respects maxOccurrencesPerEntity', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `  v${i} = "foo";`).join('\n');
    const overview = makeOverview({
      workflows: [{ name: 'WF', sourceCode: `form X {\n${lines}\n}` }],
    });
    const result = findUsages(overview, 'foo', { maxOccurrencesPerEntity: 5 });
    expect(result.occurrences).toHaveLength(5);
    expect(result.totals.truncated).toBe(true);
  });

  test('respects maxTotalOccurrences across entities', () => {
    const overview = makeOverview({
      workflows: [
        { name: 'A', sourceCode: 'x = "foo";\ny = "foo";' },
        { name: 'B', sourceCode: 'x = "foo";\ny = "foo";' },
      ],
    });
    const result = findUsages(overview, 'foo', { maxTotalOccurrences: 3 });
    expect(result.occurrences).toHaveLength(3);
    expect(result.totals.truncated).toBe(true);
  });
});

describe('findUsages — input validation', () => {
  test('empty oldValue returns an error result', () => {
    const result = findUsages(makeOverview(), '');
    expect(result.error).toMatch(/required/i);
  });

  test('missing overview is treated as zero entities', () => {
    const result = findUsages(undefined, 'foo');
    expect(result.totals.occurrences).toBe(0);
    expect(result.totals.entitiesScanned).toBe(0);
  });

  test('overview with no sourceCode-bearing entities returns zero matches', () => {
    const result = findUsages(
      makeOverview({ workflows: [{ name: 'WF' /* no sourceCode */ }] }),
      'foo'
    );
    expect(result.totals.occurrences).toBe(0);
  });
});

describe('findUsages — long-line clipping', () => {
  test('clips very long lines around the match position', () => {
    const filler = 'a'.repeat(800);
    const overview = makeOverview({
      workflows: [{ name: 'WF', sourceCode: `${filler}NEEDLE${filler}` }],
    });
    const result = findUsages(overview, 'NEEDLE');
    expect(result.totals.occurrences).toBe(1);
    expect(result.occurrences[0].lineText.length).toBeLessThan(500);
    expect(result.occurrences[0].lineText).toContain('NEEDLE');
    expect(result.occurrences[0].lineText).toMatch(/…/);
  });
});

/* -------------------------------------------------------------------------- */
/*  Enclosing-scope breadcrumbs                                                */
/* -------------------------------------------------------------------------- */

describe('findUsages — enclosing scope (function/handler context)', () => {
  /**
   * A real-shape Creator workflow: `form X { on validate { actions { ... } } }`.
   * A match inside the `actions` block should report a breadcrumb that
   * begins with the FIRST scope INSIDE the entity (i.e. excluding the
   * synthetic `form X` wrapper).
   */
  test('reports the enclosing event + actions block for a match in a workflow', () => {
    const source = [
      'form Order {',                       // line 1 — entity wrapper (excluded)
      '  on validate {',                    // line 2
      '    actions {',                      // line 3
      '      info "owner: shriniwash.yadav_adityabirla";', // line 4 ← match
      '    }',
      '  }',
      '}',
    ].join('\n');

    const result = findUsages(
      makeOverview({ workflows: [{ name: 'OrderWF', sourceCode: source }] }),
      'shriniwash.yadav_adityabirla',
      { wholeWord: true }
    );

    expect(result.totals.occurrences).toBe(1);
    const occ = result.occurrences[0];
    expect(occ.line).toBe(4);
    expect(occ.scopePath).toEqual(['on validate', 'actions']);
    expect(occ.enclosingScope).toBe('on validate → actions');
  });

  test('top-level matches inside the entity have an empty scope', () => {
    const source = [
      'form X {',
      '  owner = "shriniwash.yadav_adityabirla";', // directly inside the wrapper
      '}',
    ].join('\n');
    const result = findUsages(
      makeOverview({ workflows: [{ name: 'WF', sourceCode: source }] }),
      'shriniwash.yadav_adityabirla',
      { wholeWord: true }
    );
    expect(result.occurrences[0].scopePath).toEqual([]);
    expect(result.occurrences[0].enclosingScope).toBe('');
  });

  test('captures nested helper-function scope inside a custom function', () => {
    const source = [
      'void utils.send_alert(string body) {',  // wrapper (excluded)
      '  void inner(string msg) {',            // line 2
      '    info "owner: shriniwash.yadav_adityabirla";', // line 3 ← match
      '  }',
      '  inner(body);',
      '}',
    ].join('\n');
    const result = findUsages(
      makeOverview({
        customFunctions: [
          { namespace: 'utils', name: 'send_alert', sourceCode: source },
        ],
      }),
      'shriniwash.yadav_adityabirla',
      { wholeWord: true }
    );
    expect(result.totals.occurrences).toBe(1);
    expect(result.occurrences[0].scopePath).toEqual(['void inner(string msg)']);
    expect(result.occurrences[0].enclosingScope).toBe('void inner(string msg)');
  });

  test('braces inside strings and comments do not affect the scope', () => {
    const source = [
      'form X {',
      '  on add {',
      '    /* fake { brace } in a comment */',
      '    info "another { brace } inside a string";',
      '    owner = "shriniwash.yadav_adityabirla";', // line 5
      '  }',
      '}',
    ].join('\n');
    const result = findUsages(
      makeOverview({ workflows: [{ name: 'WF', sourceCode: source }] }),
      'shriniwash.yadav_adityabirla',
      { wholeWord: true }
    );
    expect(result.occurrences[0].line).toBe(5);
    expect(result.occurrences[0].scopePath).toEqual(['on add']);
  });

  test('header captured for `{` preserves the function signature with params', () => {
    const source = [
      'void mynamespace.send_invoice(int orderId, string email) {',
      '  send_alert(email);',
      '}',
    ].join('\n');
    const { scope, scopePath } = getEnclosingScope(source, 2);
    // The outermost wrapper IS the function itself; getEnclosingScope returns
    // the path INSIDE the wrapper, so a match on line 2 sits at top-level
    // (scope is empty). This documents the contract.
    expect(scopePath).toEqual([]);
    expect(scope).toBe('');
  });

  test('getEnclosingScope returns the breadcrumb for an inner scope', () => {
    const source = [
      'form Order {',
      '  on edit {',
      '    actions {',
      '      submit ("Save") {',
      '        info "x";',
      '      }',
      '    }',
      '  }',
      '}',
    ].join('\n');
    const { scope, scopePath } = getEnclosingScope(source, 5);
    expect(scopePath).toEqual(['on edit', 'actions', 'submit ("Save")']);
    expect(scope).toBe('on edit → actions → submit ("Save")');
  });

  test('returns empty path for missing/invalid input', () => {
    expect(getEnclosingScope('', 1)).toEqual({ scopePath: [], scope: '' });
    expect(getEnclosingScope(null, 1)).toEqual({ scopePath: [], scope: '' });
  });

  test('cleanScopeHeader collapses whitespace and clips long headers', () => {
    // placeholder — preserved below.
    expect(true).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  Commented-out lines must be excluded                                       */
/* -------------------------------------------------------------------------- */

describe('findUsages — commented code is ignored', () => {
  test('skips a match that is entirely inside a `//` line comment', () => {
    const source = [
      'form X {',
      '  // owner = "shriniwash.yadav_adityabirla";  // legacy',
      '  owner = "shriniwash.yadav_adityabirla";',
      '}',
    ].join('\n');
    const result = findUsages(
      makeOverview({ workflows: [{ name: 'WF', sourceCode: source }] }),
      'shriniwash.yadav_adityabirla',
      { wholeWord: true }
    );
    // Only the active line counts.
    expect(result.totals.occurrences).toBe(1);
    expect(result.occurrences[0].line).toBe(3);
  });

  test('keeps a match that appears BEFORE a `//` on the same line', () => {
    const source = [
      'form X {',
      '  owner = "shriniwash.yadav_adityabirla"; // trailing note about shriniwash.yadav_adityabirla',
      '}',
    ].join('\n');
    const result = findUsages(
      makeOverview({ workflows: [{ name: 'WF', sourceCode: source }] }),
      'shriniwash.yadav_adityabirla',
      { wholeWord: true }
    );
    // The first occurrence (before `//`) survives; the one inside the
    // trailing comment is dropped.
    expect(result.totals.occurrences).toBe(1);
    expect(result.occurrences[0].column).toBeLessThan(40);
  });

  test('skips a match inside a single-line `/* ... */` block comment', () => {
    const source = [
      'form X {',
      '  /* owner = "shriniwash.yadav_adityabirla"; */',
      '  owner = "shriniwash.yadav_adityabirla";',
      '}',
    ].join('\n');
    const result = findUsages(
      makeOverview({ workflows: [{ name: 'WF', sourceCode: source }] }),
      'shriniwash.yadav_adityabirla',
      { wholeWord: true }
    );
    expect(result.totals.occurrences).toBe(1);
    expect(result.occurrences[0].line).toBe(3);
  });

  test('skips matches across all lines of a multi-line `/* ... */` block', () => {
    const source = [
      'form X {',
      '  /*',
      '    owner1 = "shriniwash.yadav_adityabirla";',
      '    owner2 = "shriniwash.yadav_adityabirla";',
      '  */',
      '  owner = "shriniwash.yadav_adityabirla";',
      '}',
    ].join('\n');
    const result = findUsages(
      makeOverview({ workflows: [{ name: 'WF', sourceCode: source }] }),
      'shriniwash.yadav_adityabirla',
      { wholeWord: true }
    );
    expect(result.totals.occurrences).toBe(1);
    expect(result.occurrences[0].line).toBe(6);
  });

  test('keeps code that appears AFTER `*/` on the same closing line', () => {
    const source = [
      'form X {',
      '  /* dead = "shriniwash.yadav_adityabirla"; */ owner = "shriniwash.yadav_adityabirla";',
      '}',
    ].join('\n');
    const result = findUsages(
      makeOverview({ workflows: [{ name: 'WF', sourceCode: source }] }),
      'shriniwash.yadav_adityabirla',
      { wholeWord: true }
    );
    // Only the post-`*/` occurrence remains.
    expect(result.totals.occurrences).toBe(1);
    expect(result.occurrences[0].matchText).toBe('shriniwash.yadav_adityabirla');
    expect(result.occurrences[0].column).toBeGreaterThan(40);
  });

  test('an identifier inside a STRING literal is still reported (strings are not comments)', () => {
    const source = [
      'form X {',
      '  msg = "owner is shriniwash.yadav_adityabirla today";',
      '}',
    ].join('\n');
    const result = findUsages(
      makeOverview({ workflows: [{ name: 'WF', sourceCode: source }] }),
      'shriniwash.yadav_adityabirla',
      { wholeWord: true }
    );
    expect(result.totals.occurrences).toBe(1);
  });

  test('unterminated `/*` comment suppresses every following line', () => {
    const source = [
      'form X {',
      '  /* runaway comment never closes',
      '  owner = "shriniwash.yadav_adityabirla";',
      '  owner2 = "shriniwash.yadav_adityabirla";',
    ].join('\n');
    const result = findUsages(
      makeOverview({ workflows: [{ name: 'WF', sourceCode: source }] }),
      'shriniwash.yadav_adityabirla',
      { wholeWord: true }
    );
    expect(result.totals.occurrences).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/*  Legacy block (preserve original cleanScopeHeader assertion)                */
/* -------------------------------------------------------------------------- */

describe('findUsages — cleanScopeHeader behaviour (continued)', () => {
  test('cleanScopeHeader collapses whitespace and clips long headers (legacy)', () => {
    expect(cleanScopeHeader('  on   add  ')).toBe('on add');
    expect(cleanScopeHeader('')).toBe('');
    const long = 'really_long_header_'.repeat(20);
    expect(cleanScopeHeader(long).length).toBeLessThanOrEqual(80);
    expect(cleanScopeHeader(long).endsWith('…')).toBe(true);
  });

  test('buildScopeIndex tracks pushes and pops correctly across many lines', () => {
    const source = [
      'a {',          // line 1: open "a"
      '  b {',        // line 2: open "b"
      '    leaf;',    // line 3: inside a → b
      '  }',          // line 4: close "b"
      '  sibling;',   // line 5: inside a
      '}',            // line 6: close "a"
      'top;',         // line 7: top level
    ].join('\n');
    const idx = buildScopeIndex(source);
    // Note: scopeFor returns the path EXCLUDING the outermost entry, which
    // matches what the public API exposes — "a" is treated as the wrapper.
    // The snapshot for a line reflects the stack AT THE END of that line, so
    // a `{` opened on line N counts as in-scope for matches on line N.
    expect(idx.scopeFor(0)).toEqual([]);       // line 1 — wrapper opens; we're now inside 'a'
                                               //          (the wrapper) — public view = top-level.
    expect(idx.scopeFor(1)).toEqual(['b']);    // line 2 — 'b' opens; matches on this line are inside 'b'.
    expect(idx.scopeFor(2)).toEqual(['b']);    // line 3 — still inside a → b.
    expect(idx.scopeFor(4)).toEqual([]);       // line 5 — back to just 'a' (public = top-level).
    expect(idx.scopeFor(6)).toEqual([]);       // line 7 — fully top level.
  });
});
