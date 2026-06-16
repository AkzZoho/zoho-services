/**
 * parseBRD.js — extract plain text from an uploaded BRD/requirement file.
 *
 * Supports: .txt, .md, .pdf, .docx
 * Strategy: client-side only (no API keys, no backend).
 *   - .txt / .md  →  File.text()
 *   - .pdf        →  pdfjs-dist (text content per page, joined)
 *   - .docx       →  mammoth (extractRawText)
 */

const ACCEPTED = new Set(['txt', 'md', 'markdown', 'pdf', 'docx']);

/** @returns {{ ok: true, text, ext, name } | { ok: false, error }} */
export async function parseBRD(file) {
  if (!file) return { ok: false, error: 'No file provided.' };
  const name = file.name || 'document';
  const ext = (name.split('.').pop() || '').toLowerCase();

  if (!ACCEPTED.has(ext)) {
    return {
      ok: false,
      error: `Unsupported file type ".${ext}". Allowed: .txt, .md, .pdf, .docx`,
    };
  }

  try {
    let text = '';
    if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
      text = await file.text();
    } else if (ext === 'pdf') {
      text = await extractPdfText(file);
    } else if (ext === 'docx') {
      text = await extractDocxText(file);
    }
    text = normaliseWhitespace(text);
    if (!text || text.length < 20) {
      return {
        ok: false,
        error: 'The file appears to contain no extractable text.',
      };
    }
    return { ok: true, text, ext, name };
  } catch (err) {
    return { ok: false, error: `Could not read file: ${err.message || err}` };
  }
}

/* -------------------------------------------------------------------------- */
/*  PDF                                                                        */
/* -------------------------------------------------------------------------- */

async function extractPdfText(file) {
  // Lazy-import so Vite code-splits this away from the main bundle.
  // If the optional dependency `pdfjs-dist` is not installed, surface a clear,
  // user-facing error instead of crashing the whole tool at load-time.
  let pdfjs;
  let workerSrc;
  try {
    pdfjs = await import('pdfjs-dist/build/pdf.mjs');
    workerSrc = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
  } catch (err) {
    throw new Error(
      'PDF support is not available (pdfjs-dist not installed). ' +
        'Run `npm install` inside the client folder, or upload the BRD as .txt / .md / .docx instead. ' +
        `Original error: ${err?.message || err}`,
    );
  }
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;

  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const lineMap = new Map();
    for (const item of tc.items) {
      // pdf.js gives us transform [a,b,c,d,e,f]; e is X, f is Y baseline.
      const y = Math.round(item.transform?.[5] ?? 0);
      const x = item.transform?.[4] ?? 0;
      const arr = lineMap.get(y) || [];
      arr.push({ x, str: item.str });
      lineMap.set(y, arr);
    }
    const ys = Array.from(lineMap.keys()).sort((a, b) => b - a);
    for (const y of ys) {
      const parts = lineMap.get(y).sort((a, b) => a.x - b.x).map((p) => p.str);
      out += parts.join(' ') + '\n';
    }
    out += '\n';
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  DOCX                                                                       */
/* -------------------------------------------------------------------------- */

async function extractDocxText(file) {
  let mammoth;
  try {
    mammoth = await import('mammoth/mammoth.browser.js');
  } catch (err) {
    throw new Error(
      'DOCX support is not available (mammoth not installed). ' +
        'Run `npm install` inside the client folder, or upload the BRD as .txt / .md / .pdf instead. ' +
        `Original error: ${err?.message || err}`,
    );
  }
  const buf = await file.arrayBuffer();
  const res = await mammoth.extractRawText({ arrayBuffer: buf });
  return res.value || '';
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function normaliseWhitespace(s) {
  return String(s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export { ACCEPTED as ACCEPTED_BRD_EXTENSIONS };
