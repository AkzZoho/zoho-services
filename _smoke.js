/* eslint-disable */
const fs = require('fs');
const path = require('path');
const { parseDs, _internal } = require('./functions/ds-analyzer/src/parsers/dsParser');

function slice(text, openIdx) {
  const open = text[openIdx];
  const close = open === '{' ? '}' : ')';
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); if (e === -1) return null; i = e + 2; continue; }
    if (ch === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i + 2); i = nl === -1 ? text.length : nl + 1; continue; }
    if (ch === '"' || ch === "'") { const q = ch; i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; } i++; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return { inner: text.slice(openIdx + 1, i), end: i + 1 }; }
    i++;
  }
  return null;
}

(async () => {
  const samples = process.argv.slice(2);
  for (const rel of samples) {
    const buf = fs.readFileSync(rel);
    const text = buf.toString('utf8').replace(/\r\n?/g, '\n');
    const m = text.match(/application\s+"([^"]+)"\s*\{/);
    const sliced = slice(text, m.index + m[0].length - 1);
    const blocks = _internal.extractTopLevelBlocks(sliced.inner);
    console.log('='.repeat(80));
    console.log(rel, '| body=', sliced.inner.length, '| top-blocks=', blocks.length);
    for (const b of blocks.slice(0, 20)) {
      console.log('  ', JSON.stringify({ kw: b.keyword, head: b.head, innerLen: b.inner.length }));
    }
    // Also the full parse
    const r = await parseDs(buf, rel);
    console.log('  → forms:', r.forms.length, 'reports:', r.reports.length, 'pages:', r.pages.length,
      'workflows:', r.workflows.length, 'functions:', r.customFunctions.length,
      'roles:', r.roles.length, 'profiles:', r.shareSettings.length);
    if (r.forms[0]) {
      const f = r.forms[0];
      console.log('  first form:', f.name, '(' + f.fields.length + ' fields)',
        '→', f.fields.slice(0, 3).map(x => `${x.name}:${x.type}${x.required ? '*' : ''}`).join(', '));
    }
    if (r.reports[0]) {
      const rep = r.reports[0];
      console.log('  first report:', rep.name, '→', rep.type, 'from', rep.baseForm, '('+rep.columnCount+' cols,', rep.customActions.length, 'custom actions)');
    }
    if (r.workflows[0]) {
      console.log('  first workflow:', JSON.stringify(r.workflows[0]));
    }
    if (r.customFunctions[0]) {
      const fn = r.customFunctions[0];
      console.log('  first fn:', `${fn.returnType} ${fn.namespace ? fn.namespace+'.' : ''}${fn.name}(${fn.paramCount})`, 'body=', fn.scriptSize, 'chars');
    }
    if (r.pages[0]) {
      const p = r.pages[0];
      console.log('  first page:', p.name, '('+(p.contentSize||0)+' chars, script='+p.hasScript+', section='+p.section+')');
    }
    if (r.warnings.length) console.log('  warnings:', r.warnings.slice(0, 3));
  }
})();
