/**
 * Form-field type → canonical Display Name.
 *
 * Single source of truth for rendering the "Type" column of a Form's fields.
 * Kept intentionally narrow in scope:
 *   - Only form-field `type` tokens are translated here.
 *   - Report `type` (list / summary / grid / kanban ...) is a DIFFERENT namespace
 *     and MUST NOT be routed through this helper.
 *
 * Canonical labels (per governance doc `docs/LEARNING.md` §4.1):
 *   text           → Single Line
 *   picklist       → Dropdown
 *   radiobuttons   → Radio
 *   list           → Multi-Select
 *   checkboxes     → CheckBox
 *   checkbox       → Decision Box          (singular — distinct from `checkboxes`)
 *   USD            → Currency
 *   grid           → Subform
 *
 * Lookup fields in Creator `.ds` are expressed as a base field type
 * (`picklist` or `list`) PLUS a `values = OtherForm.Field` reference. The
 * presence of the lookup reference upgrades the label to the lookup variant:
 *   picklist + lookup → Single Select Lookup
 *   list     + lookup → Multi-Select Lookup
 *
 * Note: `grid` fields also carry a `values = ...` reference but are Subforms,
 * NOT lookups — so `grid` is matched BEFORE the lookup upgrade.
 */

// Exact-match table. Keys are compared case-sensitively first, then
// case-insensitively as a fallback so `USD` and `usd` both map correctly.
const EXACT = Object.freeze({
  text: 'Single Line',
  picklist: 'Dropdown',
  radiobuttons: 'Radio',
  list: 'Multi-Select',
  checkboxes: 'CheckBox',
  checkbox: 'Decision Box',
  USD: 'Currency',
  grid: 'Subform',
});

// Case-insensitive lookup map, built once.
const EXACT_CI = Object.freeze(
  Object.fromEntries(Object.entries(EXACT).map(([k, v]) => [k.toLowerCase(), v])),
);

/**
 * Title-case a raw token when we don't have a canonical label for it.
 * Keeps all-caps acronyms (≤ 4 letters) upper-cased ("URL", "USD"); otherwise
 * capitalises the first letter of each word separated by `_`, `-`, or space.
 *
 * @param {string} raw
 * @returns {string}
 */
function prettifyUnknown(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'Unknown';
  // Preserve short all-uppercase acronyms as-is (URL, USD, API, ID, etc.).
  if (/^[A-Z]{2,4}$/.test(s)) return s;
  return s
    .split(/[\s_\-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Returns true when `field` represents a lookup reference to another form.
 * In Creator `.ds`, the parser captures this as a non-empty `lookup` string
 * (e.g. "Customers.ID") or object.
 *
 * @param {{ lookup?: unknown }} field
 */
function hasLookupReference(field) {
  const lk = field && field.lookup;
  if (!lk) return false;
  if (typeof lk === 'string') return lk.trim().length > 0;
  if (typeof lk === 'object') {
    return Boolean(lk.form || lk.target || lk.formName);
  }
  return false;
}

/**
 * Translate a form-field definition into its canonical display label.
 *
 * @param {{ type?: string, lookup?: unknown }} field
 * @returns {string}
 */
export function formatFieldType(field) {
  const raw = (field && field.type) || '';
  const token = String(raw).trim();
  if (!token) return 'Unknown';

  const lower = token.toLowerCase();

  // Subform detection BEFORE lookup upgrade — grid+values is a subform,
  // not a lookup, in Creator semantics.
  if (lower === 'grid') return EXACT.grid;

  // Lookup upgrade for picklist / list when a `values` reference exists.
  if (hasLookupReference(field)) {
    if (lower === 'picklist') return 'Single Select Lookup';
    if (lower === 'list') return 'Multi-Select Lookup';
    // Other types carrying a `values` reference (unusual) fall through to
    // their standard label below — we don't invent a new category.
  }

  // Exact canonical label.
  if (Object.prototype.hasOwnProperty.call(EXACT, token)) return EXACT[token];
  if (Object.prototype.hasOwnProperty.call(EXACT_CI, lower)) return EXACT_CI[lower];

  // Graceful fallback for unspecified tokens (number, email, date, richtext, ...).
  return prettifyUnknown(token);
}

// Exposed for tests / debugging; not part of the public render path.
export const __internals = { EXACT, prettifyUnknown, hasLookupReference };
