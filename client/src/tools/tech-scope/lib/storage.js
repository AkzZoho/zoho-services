/**
 * storage.js — persist scope drafts to localStorage so users don't lose work.
 *
 * Keyed by a stable id derived from the source filename. Falls back to a
 * single "default" slot for typed-in (no upload) drafts.
 */

const PREFIX = 'tech-scope:';
const INDEX_KEY = `${PREFIX}__index__`;
const DEFAULT_SLOT = 'default';

export function slotIdFromFile(file) {
  if (!file || !file.name) return DEFAULT_SLOT;
  // Simple, deterministic, no crypto needed.
  const name = file.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return name || DEFAULT_SLOT;
}

function safeStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveDraft(slot, scope) {
  const ls = safeStorage();
  if (!ls) return false;
  try {
    ls.setItem(PREFIX + slot, JSON.stringify(scope));
    const idx = listSlots();
    if (!idx.find((x) => x.slot === slot)) {
      idx.push({ slot, title: scope?.meta?.title || slot, updatedAt: scope?.meta?.updatedAt });
    } else {
      const existing = idx.find((x) => x.slot === slot);
      existing.title = scope?.meta?.title || slot;
      existing.updatedAt = scope?.meta?.updatedAt;
    }
    ls.setItem(INDEX_KEY, JSON.stringify(idx));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(slot) {
  const ls = safeStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(PREFIX + slot);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function deleteDraft(slot) {
  const ls = safeStorage();
  if (!ls) return false;
  try {
    ls.removeItem(PREFIX + slot);
    const idx = listSlots().filter((x) => x.slot !== slot);
    ls.setItem(INDEX_KEY, JSON.stringify(idx));
    return true;
  } catch {
    return false;
  }
}

export function listSlots() {
  const ls = safeStorage();
  if (!ls) return [];
  try {
    return JSON.parse(ls.getItem(INDEX_KEY) || '[]');
  } catch {
    return [];
  }
}

export const DEFAULT_SLOT_ID = DEFAULT_SLOT;
