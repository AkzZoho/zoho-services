/**
 * pageDownload.js — export the entire inspection result (the three
 * rendered sections: AppOverview + SchemaView + PerformanceView) as a
 * single, self-contained HTML file.
 *
 * Strategy
 * --------
 * Rather than reconstruct the report from the raw data (as the old
 * `reportDownload.js` did), we snapshot what the user is *actually*
 * looking at. This keeps the exported file in perfect sync with the UI.
 *
 * Steps:
 *   1. Clone the DOM subtree under `rootEl`.
 *   2. Replace every <canvas> in the clone with an <img> whose src is a
 *      PNG data-URL of the live canvas (so the force-directed graph
 *      shows up in the exported file).
 *   3. Inline all loaded CSS (both <link rel="stylesheet"> and
 *      <style> blocks) so the file renders identically offline.
 *   4. Strip interactivity that doesn't survive offline (file inputs,
 *      script tags, contenteditable, aria-expanded toggles stay visual).
 *   5. Wrap in a minimal HTML shell with a light/dark auto theme.
 */

/** Entry point used by App.jsx */
export async function downloadPageAsHtml({ rootEl, appName = 'application' }) {
  if (!rootEl) throw new Error('No content element to export.');

  /* 1. Map live canvases to PNG data URLs BEFORE cloning so we pick up
        whatever the user currently has on screen (zoom, pan, selection). */
  const canvasMap = snapshotCanvases(rootEl);

  /* 2. Deep-clone the node tree */
  const clone = rootEl.cloneNode(true);

  /* 3. Swap canvas elements in the clone with their snapshot images */
  replaceCanvasesWithImages(clone, canvasMap);

  /* 4. Gather CSS from the live document */
  const css = await collectDocumentCss();

  /* 5. Sanitise clone — remove things that don't belong in static HTML */
  sanitiseClone(clone);

  /* 6. Assemble final HTML */
  const darkActive = document.documentElement.classList.contains('dark');
  const html = wrapAsDocument({
    appName,
    bodyHtml: clone.outerHTML,
    css,
    darkActive,
  });

  /* 7. Trigger download */
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = buildFileName(appName);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* -------------------------------------------------------------------------- */
/*  Canvas snapshotting                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Walk every <canvas> in the live DOM and capture its pixel contents as a
 * PNG data-URL. We key by a stable marker we'll also apply to the cloned
 * tree so the replacement step can pair them up.
 */
function snapshotCanvases(root) {
  const map = new Map();
  const canvases = root.querySelectorAll('canvas');
  canvases.forEach((canvas, i) => {
    const token = `__dsa_canvas_${i}__`;
    canvas.dataset.dsaSnapshot = token;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const rect = canvas.getBoundingClientRect();
      map.set(token, {
        dataUrl,
        width:  rect.width,
        height: rect.height,
      });
    } catch (err) {
      // Tainted canvas or unsupported environment — skip silently.
      console.warn('Could not snapshot canvas', err);
    }
  });
  return map;
}

function replaceCanvasesWithImages(clone, canvasMap) {
  clone.querySelectorAll('canvas').forEach((canvas) => {
    const token = canvas.dataset.dsaSnapshot;
    const snap  = canvasMap.get(token);
    if (!snap) return;
    const img = document.createElement('img');
    img.src = snap.dataUrl;
    img.alt = 'Graph snapshot';
    img.style.width = `${snap.width}px`;
    img.style.height = `${snap.height}px`;
    img.style.maxWidth = '100%';
    img.style.display = 'block';
    canvas.replaceWith(img);
  });
  /* Clean up the marker on the live DOM so repeated downloads stay clean */
  document.querySelectorAll('canvas[data-dsa-snapshot]').forEach((c) => {
    delete c.dataset.dsaSnapshot;
  });
}

/* -------------------------------------------------------------------------- */
/*  CSS collection                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Reads every stylesheet attached to the live document and returns the
 * concatenated CSS text. Handles:
 *   - inline <style> blocks (trivial)
 *   - <link rel="stylesheet"> that the browser has already parsed and
 *     exposes via `document.styleSheets[].cssRules`
 *   - cross-origin stylesheets whose `cssRules` throws — we fetch the
 *     href via `fetch()` as a fallback.
 */
async function collectDocumentCss() {
  const chunks = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = null;
    try { rules = sheet.cssRules; } catch { /* cross-origin */ }
    if (rules) {
      chunks.push(Array.from(rules).map((r) => r.cssText).join('\n'));
      continue;
    }
    /* Fallback: fetch the stylesheet URL */
    if (sheet.href) {
      try {
        const res = await fetch(sheet.href);
        if (res.ok) {
          const txt = await res.text();
          chunks.push(`/* ${sheet.href} */\n${txt}`);
        }
      } catch {
        /* ignore */
      }
    }
  }
  return chunks.join('\n\n');
}

/* -------------------------------------------------------------------------- */
/*  Clone sanitiser                                                            */
/* -------------------------------------------------------------------------- */

function sanitiseClone(clone) {
  /* Drop any <script> that may have snuck in */
  clone.querySelectorAll('script').forEach((n) => n.remove());
  /* Inputs lose their React handlers — render them as read-only snapshots */
  clone.querySelectorAll('input, textarea, select, button').forEach((el) => {
    if (el.tagName === 'INPUT' && el.type === 'file') {
      el.remove();
      return;
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.setAttribute('readonly', 'true');
      el.setAttribute('disabled', 'true');
    }
    if (el.tagName === 'BUTTON') {
      /* Buttons remain for visual consistency but can't do anything */
      el.setAttribute('disabled', 'true');
      el.removeAttribute('onclick');
    }
  });
  /* Remove pointer-event overlays like the interactive tooltip + controls
     that only make sense in the live app */
  clone.querySelectorAll('[data-export-strip]').forEach((n) => n.remove());
}

/* -------------------------------------------------------------------------- */
/*  Document wrapper                                                           */
/* -------------------------------------------------------------------------- */

function wrapAsDocument({ appName, bodyHtml, css, darkActive }) {
  const title  = `${escapeHtml(appName)} — Inspection Report`;
  const stamp  = new Date().toLocaleString();
  const themeClass = darkActive ? 'dark' : '';
  return `<!DOCTYPE html>
<html lang="en" class="${themeClass}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<style>
  /* Minimal baseline so the exported file looks correct even before the
     inlined Tailwind utilities kick in. */
  html, body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f8fafc;
    color: #0f172a;
  }
  html.dark, html.dark body { background: #0f172a; color: #f1f5f9; }
  .dsa-doc-header {
    padding: 20px 32px;
    border-bottom: 1px solid #e2e8f0;
    background: #ffffff;
  }
  html.dark .dsa-doc-header {
    border-color: #1e293b;
    background: #0b1220;
  }
  .dsa-doc-header h1 {
    margin: 0 0 4px; font-size: 20px; font-weight: 600;
  }
  .dsa-doc-header p {
    margin: 0; font-size: 12px; color: #64748b;
  }
  html.dark .dsa-doc-header p { color: #94a3b8; }
  .dsa-doc-body {
    max-width: 1100px; margin: 0 auto; padding: 24px;
  }
  /* Make disabled inputs look cleanly inert, not "broken" */
  input[disabled], textarea[disabled], select[disabled] {
    opacity: 1;
    cursor: default;
    background: transparent;
  }
  button[disabled] {
    cursor: default;
    opacity: 0.85;
  }
  @media print {
    .dsa-doc-header { position: static; }
    .card { break-inside: avoid; page-break-inside: avoid; }
    @page { size: A4; margin: 14mm; }
  }
</style>
<style>
/* ──────── Inlined application CSS ──────── */
${css}
</style>
</head>
<body>
<header class="dsa-doc-header">
  <h1>${title}</h1>
  <p>Generated ${escapeHtml(stamp)} · Creator DS Analyser</p>
</header>
<main class="dsa-doc-body">
${bodyHtml}
</main>
</body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/*  Utilities                                                                  */
/* -------------------------------------------------------------------------- */

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildFileName(appName) {
  const safe = String(appName || 'application')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 60);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${safe}-inspection-${ts}.html`;
}
