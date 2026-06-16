/**
 * useToolVisibility — reactive hook returning per-tool visibility state.
 *
 * ── Two-layer model ────────────────────────────────────────────────────────
 *   Layer 1 (base / shared):
 *     `VITE_PUBLIC_TOOLS` env var — comma-separated tool IDs, baked at build
 *     time. This is the canonical source of truth across all browsers and
 *     devices. Format: `VITE_PUBLIC_TOOLS=tech-scope,ds-analyser`.
 *
 *   Layer 2 (override / per-admin-device):
 *     `localStorage` key `zst.tool_visibility_overrides`, written by the
 *     Admin Panel toggles. Holds a `{ toolId: boolean }` map. Any tool
 *     present here overrides the env-var base; tools absent fall through.
 *
 *   Effective visibility = override (if set) ?? env-var base ?? false.
 *
 * ── Why both? ──────────────────────────────────────────────────────────────
 *   • Toggles in the UI are a strong UX expectation for an admin panel.
 *   • The env var stays as the deploy-time default so a fresh visitor on a
 *     fresh browser sees a sensible state — no admin action required.
 *   • Overrides are localStorage-scoped, so the AdminPanel calls them out
 *     clearly as "this device only". For a true cross-device publish, the
 *     admin still updates the env var (documented in AdminPanel).
 *
 * ── Reactivity ─────────────────────────────────────────────────────────────
 *   A tiny pub/sub broadcasts changes to every mounted hook instance, so
 *   toggling in the AdminPanel updates the LandingPage in the same tab
 *   instantly. We also listen to the native `storage` event so changes in
 *   another tab on the same origin propagate too.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_TOOL_IDS = ['ds-analyser', 'tech-scope'];
const OVERRIDES_KEY = 'zst.tool_visibility_overrides';

// ---------------------------------------------------------------------------
// Env-var base (parsed once at module load)
// ---------------------------------------------------------------------------

function parsePublicTools(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const ENV_PUBLIC_IDS = Object.freeze(parsePublicTools(import.meta.env.VITE_PUBLIC_TOOLS));
const ENV_PUBLIC_SET = new Set(ENV_PUBLIC_IDS);

const ENV_BASE = Object.freeze(
  ALL_TOOL_IDS.reduce((acc, id) => {
    acc[id] = ENV_PUBLIC_SET.has(id);
    return acc;
  }, {})
);

// ---------------------------------------------------------------------------
// Override store (localStorage + in-memory cache + pub/sub)
// ---------------------------------------------------------------------------

function readOverrides() {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    // Sanitise: only keep known tool IDs with boolean values
    const clean = {};
    for (const id of ALL_TOOL_IDS) {
      if (typeof parsed[id] === 'boolean') clean[id] = parsed[id];
    }
    return clean;
  } catch {
    return {};
  }
}

function writeOverrides(overrides) {
  try {
    if (!overrides || Object.keys(overrides).length === 0) {
      localStorage.removeItem(OVERRIDES_KEY);
    } else {
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
    }
  } catch {
    /* localStorage may be blocked (private mode) — silently ignore */
  }
}

// In-memory cache shared across all hook instances in the tab.
let _overrides = readOverrides();
const _listeners = new Set();

function notify() {
  for (const fn of _listeners) {
    try { fn(); } catch { /* swallow listener errors */ }
  }
}

function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// Cross-tab sync: when another tab writes to localStorage, refresh & notify.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === OVERRIDES_KEY) {
      _overrides = readOverrides();
      notify();
    }
  });
}

// ---------------------------------------------------------------------------
// Effective visibility computation
// ---------------------------------------------------------------------------

function computeVisibility(overrides) {
  const out = {};
  for (const id of ALL_TOOL_IDS) {
    out[id] = Object.prototype.hasOwnProperty.call(overrides, id)
      ? overrides[id]
      : ENV_BASE[id];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mutators (exported for the AdminPanel)
// ---------------------------------------------------------------------------

/** Set a single tool's visibility (override). Persists + broadcasts. */
export function setToolVisibility(toolId, isPublic) {
  if (!ALL_TOOL_IDS.includes(toolId)) return;
  const next = { ..._overrides, [toolId]: !!isPublic };
  _overrides = next;
  writeOverrides(next);
  notify();
}

/** Toggle a tool's visibility. Returns the new value. */
export function toggleToolVisibility(toolId) {
  const current = computeVisibility(_overrides)[toolId] ?? false;
  setToolVisibility(toolId, !current);
  return !current;
}

/** Drop all overrides — visibility reverts to the env-var base. */
export function resetToolVisibility() {
  _overrides = {};
  writeOverrides({});
  notify();
}

/** True when at least one tool is currently overridden vs. the env base. */
export function hasOverrides() {
  return Object.keys(_overrides).length > 0;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * @returns {{
 *   visibility: Record<string, boolean>,
 *   isPublic: (toolId: string) => boolean,
 *   publicIds: string[],
 *   publicCount: number,
 *   loading: false,
 *   envBase: Readonly<Record<string, boolean>>,
 *   envPublicIds: ReadonlyArray<string>,
 *   overrides: Record<string, boolean>,
 *   hasOverrides: boolean,
 *   setToolVisibility: (toolId: string, isPublic: boolean) => void,
 *   toggleToolVisibility: (toolId: string) => boolean,
 *   resetToolVisibility: () => void,
 * }}
 */
export function useToolVisibility() {
  // Re-render trigger — increment on any change broadcast.
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = subscribe(() => setTick((n) => n + 1));
    return unsub;
  }, []);

  const visibility = useMemo(() => computeVisibility(_overrides), [_overrides]); // eslint-disable-line react-hooks/exhaustive-deps
  const publicIds = useMemo(
    () => ALL_TOOL_IDS.filter((id) => visibility[id]),
    [visibility]
  );

  const isPublic = useCallback((toolId) => visibility[toolId] === true, [visibility]);

  return {
    visibility,
    isPublic,
    publicIds,
    publicCount: publicIds.length,
    loading: false,

    // Diagnostic / admin-only fields
    envBase: ENV_BASE,
    envPublicIds: ENV_PUBLIC_IDS,
    overrides: { ..._overrides },
    hasOverrides: Object.keys(_overrides).length > 0,

    // Mutators (also re-exported as named exports)
    setToolVisibility,
    toggleToolVisibility,
    resetToolVisibility,
  };
}
