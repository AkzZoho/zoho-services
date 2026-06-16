import { useState } from 'react';
import UploadStep from './components/UploadStep.jsx';
import StepWizard from './components/StepWizard.jsx';
import { parseBRD } from './lib/parseBRD.js';
import { deriveScope } from './lib/heuristics.js';
import { emptyScope, stamp, migrateScope } from './lib/scope.js';
import { slotIdFromFile, DEFAULT_SLOT_ID, saveDraft, loadDraft } from './lib/storage.js';
import { apiFetch } from '../ds-analyser/lib/http.js';

/**
 * Technical Scope Creator — top-level container.
 *
 * Owns the high-level "phase" state:
 *   · 'upload'  — initial upload screen
 *   · 'wizard'  — five-step review/edit/export flow
 *
 * Everything is fully offline once the bundle is loaded — no API keys.
 */
export default function TechScopeApp() {
  const [phase, setPhase] = useState('upload');
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState(null); // 'parsing' | 'ai' | 'heuristic'
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null); // non-fatal info banner ("Used heuristics — AI fallback")
  const [scope, setScope] = useState(null);
  const [slot, setSlot] = useState(null);
  // Provenance — recorded on the scope draft so the wizard can show a badge.
  // null means the user opened an existing draft (provenance unknown).

  /**
   * Try server-side AI extraction. Returns:
   *   { scope, provider, warnings }            — success
   *   { fallback: true, reason }               — server says no LLM configured
   *   throws on network/parse errors           — caller falls back
   */
  async function tryAiExtract({ brdText, title, sourceFile }) {
    const res = await apiFetch('/api/extract-scope', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brdText, title, sourceFile }),
    });
    if (res && res.useFallback) return { fallback: true, reason: res.reason };
    if (!res || !res.scope) throw new Error('extract-scope: empty response');
    return { scope: res.scope, provider: res.provider, warnings: res.warnings || [] };
  }

  async function handleParse({ file, title, useAi }) {
    setBusy(true);
    setBusyStage('parsing');
    setError(null);
    setNotice(null);
    try {
      const res = await parseBRD(file);
      if (!res.ok) {
        setError(res.error);
        return;
      }

      const slotId = slotIdFromFile(file);
      const existing = loadDraft(slotId);
      if (existing) {
        // Re-open an existing draft as-is (preserves edits).
        const draft = migrateScope(existing);
        saveDraft(slotId, draft);
        setScope(draft);
        setSlot(slotId);
        setPhase('wizard');
        return;
      }

      let draft = null;
      let provenance = { source: 'heuristic', provider: null, warnings: [] };

      if (useAi) {
        setBusyStage('ai');
        try {
          const aiRes = await tryAiExtract({
            brdText: res.text,
            title: title || null,
            sourceFile: res.name,
          });
          if (aiRes.fallback) {
            // Server explicitly says "no LLM configured" — silent fallback.
            setBusyStage('heuristic');
            draft = deriveScope(res.text, { title, sourceFile: res.name });
            provenance = { source: 'heuristic', provider: null, warnings: [], reason: aiRes.reason };
            setNotice(`No AI provider configured on the server (${aiRes.reason}). Used local extractor.`);
          } else {
            draft = aiRes.scope;
            provenance = { source: 'ai', provider: aiRes.provider, warnings: aiRes.warnings };
            if (aiRes.warnings && aiRes.warnings.length) {
              setNotice(`AI extracted draft. ${aiRes.warnings.length} warning(s) — see Step 1 banner.`);
            }
          }
        } catch (aiErr) {
          // Network / 502 / validation error — fall back transparently.
          setBusyStage('heuristic');
          draft = deriveScope(res.text, { title, sourceFile: res.name });
          provenance = { source: 'heuristic', provider: null, warnings: [], reason: aiErr.message };
          setNotice(`AI extraction failed (${aiErr.message}). Used local extractor instead.`);
        }
      } else {
        setBusyStage('heuristic');
        draft = deriveScope(res.text, { title, sourceFile: res.name });
      }

      // Stamp provenance on the meta block so the wizard can render a badge.
      draft.meta = { ...draft.meta, provenance };

      saveDraft(slotId, draft);
      setScope(draft);
      setSlot(slotId);
      setPhase('wizard');
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
      setBusyStage(null);
    }
  }

  function handleBlank() {
    const blank = stamp(emptyScope());
    saveDraft(DEFAULT_SLOT_ID, blank);
    setScope(blank);
    setSlot(DEFAULT_SLOT_ID);
    setError(null);
    setPhase('wizard');
  }

  function handleRestart() {
    setScope(null);
    setSlot(null);
    setError(null);
    setPhase('upload');
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {phase === 'upload' && (
        <UploadStep
          onParse={handleParse}
          onBlank={handleBlank}
          busy={busy}
          busyStage={busyStage}
          error={error}
          notice={notice}
        />
      )}
      {phase === 'wizard' && scope && (
        <StepWizard scope={scope} slot={slot} onRestart={handleRestart} />
      )}
    </div>
  );
}
