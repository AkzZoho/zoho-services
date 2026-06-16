/**
 * exportPdf.js — render the full Technical Scope Document to a packed PDF.
 *
 * Pipeline:
 *   1. Build full markdown via template.renderFullDocument
 *   2. Convert markdown → styled HTML via `marked`
 *   3. Render every `mermaid` code-block to inline SVG (offline)
 *   4. Drop the resulting HTML into an off-screen container
 *   5. Use html2canvas to rasterise; jsPDF stitches pages together
 *
 * Everything client-side, no API keys.
 */

import { renderFullDocument } from './template.js';

/* -------------------------------------------------------------------------- */
/*  Public                                                                     */
/* -------------------------------------------------------------------------- */

export async function exportScopeToPdf(scope, { fileName } = {}) {
  const [{ default: jsPDF }, html2canvas, marked, mermaid] = await Promise.all([
    import('jspdf'),
    import('html2canvas').then((m) => m.default),
    import('marked').then((m) => m.marked),
    import('mermaid').then((m) => m.default),
  ]);

  // Configure mermaid (idempotent — safe to call repeatedly)
  mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });

  // 1. Build markdown
  const md = renderFullDocument(scope);

  // 2. Markdown → HTML, but keep mermaid blocks as <div class="mermaid">
  marked.use({
    renderer: {
      code(rawCode, infostring) {
        // marked v13 passes the token object; v9 passes (code, infostring).
        const code = typeof rawCode === 'object' ? rawCode.text : rawCode;
        const lang = typeof rawCode === 'object' ? rawCode.lang : infostring;
        if ((lang || '').trim() === 'mermaid') {
          return `<div class="mermaid">${escapeHtml(code)}</div>`;
        }
        return false; // fall through to default
      },
    },
  });

  const html = marked.parse(md);

  // 3. Off-screen render container
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-99999px';
  host.style.top = '0';
  host.style.width = '794px'; // A4 @ 96dpi
  host.style.background = '#ffffff';
  host.style.color = '#0f172a';
  host.style.padding = '40px 48px';
  host.style.fontFamily = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  host.style.fontSize = '13px';
  host.style.lineHeight = '1.55';
  host.innerHTML = `<style>${PDF_CSS}</style>${html}`;
  document.body.appendChild(host);

  try {
    // 4. Render mermaid blocks → SVG
    const blocks = host.querySelectorAll('.mermaid');
    let i = 0;
    for (const el of blocks) {
      const src = el.textContent || '';
      try {
        const { svg } = await mermaid.render(`tsc-mermaid-${Date.now()}-${i++}`, src);
        el.innerHTML = svg;
        // Make sure SVG sizes itself properly inside the page
        const svgEl = el.querySelector('svg');
        if (svgEl) {
          svgEl.style.maxWidth = '100%';
          svgEl.style.height = 'auto';
        }
      } catch (err) {
        el.innerHTML = `<pre class="mermaid-error">Diagram failed to render:\n${escapeHtml(String(err.message || err))}\n\nSource:\n${escapeHtml(src)}</pre>`;
      }
    }

    // Wait one frame so layout settles
    await new Promise((r) => requestAnimationFrame(r));

    // 5. Rasterise → multi-page PDF
    const canvas = await html2canvas(host, {
      backgroundColor: '#ffffff',
      scale: 2,           // sharper text
      useCORS: true,
      logging: false,
      windowWidth: host.scrollWidth,
      windowHeight: host.scrollHeight,
    });

    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pageWpt = pdf.internal.pageSize.getWidth();
    const pageHpt = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const usableW = pageWpt - margin * 2;
    const ratio = usableW / canvas.width;
    const sliceHpx = Math.floor((pageHpt - margin * 2) / ratio);

    let yPx = 0;
    let pageNum = 0;
    while (yPx < canvas.height) {
      const hPx = Math.min(sliceHpx, canvas.height - yPx);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = hPx;
      const ctx = slice.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, yPx, canvas.width, hPx, 0, 0, canvas.width, hPx);
      const data = slice.toDataURL('image/jpeg', 0.92);
      if (pageNum > 0) pdf.addPage();
      pdf.addImage(data, 'JPEG', margin, margin, usableW, hPx * ratio);
      yPx += hPx;
      pageNum++;
    }

    const safeName = (fileName || `${scope?.meta?.title || 'technical-scope'}.pdf`)
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/-+/g, '-');
    pdf.save(safeName);
    return { ok: true, pages: pageNum, fileName: safeName };
  } finally {
    document.body.removeChild(host);
  }
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PDF_CSS = `
  * { box-sizing: border-box; }
  h1, h2, h3, h4 { color: #0f172a; margin: 1.4em 0 0.6em; line-height: 1.25; }
  h1 { font-size: 22px; border-bottom: 2px solid #2563eb; padding-bottom: 6px; }
  h2 { font-size: 18px; color: #1e3a8a; margin-top: 1.6em; }
  h3 { font-size: 14px; color: #334155; }
  h4 { font-size: 13px; color: #475569; }
  p, li { font-size: 12.5px; }
  ul, ol { padding-left: 22px; }
  li { margin-bottom: 3px; }
  code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 11.5px; color: #0f172a; }
  pre { background: #f8fafc; padding: 10px 12px; border-radius: 6px; border: 1px solid #e2e8f0; overflow-x: auto; font-size: 11px; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 11.5px; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; }
  th { background: #f1f5f9; }
  blockquote { border-left: 3px solid #94a3b8; padding: 4px 12px; color: #475569; background: #f8fafc; margin: 8px 0; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 18px 0; }
  .mermaid { background: #ffffff; padding: 8px 0; text-align: center; }
  .mermaid svg { display: inline-block; max-width: 100%; height: auto; }
  .mermaid-error { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; padding: 8px; border-radius: 4px; font-size: 11px; }
  a { color: #2563eb; text-decoration: none; }
`;
