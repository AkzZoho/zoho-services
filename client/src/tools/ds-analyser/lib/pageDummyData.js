/**
 * pageDummyData.js — deterministic dummy-data generator + page-shape
 * classifier used by the Pages preview.
 *
 * Why it exists
 * -------------
 * A Creator page's raw `.ds` source is opaque (Deluge + HTML + CSS) and
 * loading live data is impossible in the inspector UI. But when an analyst
 * is skimming 50+ pages they really want a *visual* sense of "what will
 * this page actually look like to an end user?".
 *
 * This module provides the building blocks for that visualisation:
 *
 *   classifyPage(page)              → {kind, reason}
 *   makeDummyRecord(form)           → { [fieldName]: value }
 *   makeDummyRows(form, count)      → array of records
 *   sampleSubsetOfFields(form, n)   → first-n fields to use as columns
 *   formatDummyValue(field, value)  → short human string
 *
 * Everything is pure, deterministic (seeded by the form's name), and uses
 * no I/O — so the UI stays predictable and snapshot-friendly.
 */

/* -------------------------------------------------------------------------- */
/*  Page classifier                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Decide which preview variant a page should render.
 *
 * Possible `kind` values:
 *   - 'form'    — page embeds at least one form → render a filled-in form
 *   - 'report'  — page embeds at least one report → render a grid of rows
 *   - 'mixed'   — both a form and a report → render form on top, grid below
 *   - 'html'    — raw HTML / Deluge-driven page → render a skeleton layout
 *   - 'static'  — none of the above; render a minimal placeholder
 */
export function classifyPage(page) {
  const forms = page?.embeddedForms || [];
  const reports = page?.embeddedReports || [];
  if (forms.length && reports.length) {
    return { kind: 'mixed', reason: 'Embeds both a form and a report' };
  }
  if (forms.length) {
    return { kind: 'form', reason: `Embeds form: ${forms[0]}` };
  }
  if (reports.length) {
    return { kind: 'report', reason: `Embeds report: ${reports[0]}` };
  }
  if (page?.hasScript || (page?.sourceCode && page.sourceCode.length > 200)) {
    return { kind: 'html', reason: 'Custom HTML / Deluge page' };
  }
  return { kind: 'static', reason: 'Layout / navigation page' };
}

/* -------------------------------------------------------------------------- */
/*  Deterministic RNG — seeded by a string so previews are stable             */
/* -------------------------------------------------------------------------- */

function seedFrom(str) {
  let h = 2166136261;
  const s = String(str || 'seed');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  'Alice', 'Bob', 'Carla', 'Devan', 'Esha', 'Farid', 'Gita', 'Hiro',
  'Ines', 'Jon', 'Kira', 'Luca', 'Maya', 'Noor', 'Omar', 'Priya',
];
const LAST_NAMES = [
  'Rao', 'Khan', 'Singh', 'Chen', 'Patel', 'Gomez', 'Silva', 'Kapoor',
  'Iyer', 'Fernandes', 'Das', 'Sato', 'Tan', 'Reddy', 'Sharma',
];
const CITIES = [
  'Chennai', 'Bangalore', 'Mumbai', 'Pune', 'Hyderabad', 'Delhi',
  'Singapore', 'Dubai', 'Austin', 'Berlin', 'London',
];
const COMPANIES = [
  'Acme Corp', 'Globex', 'Initech', 'Umbrella', 'Stark Industries',
  'Wayne Enterprises', 'Wonka LLC', 'Hooli',
];
const STATUSES = ['Pending', 'Approved', 'Rejected', 'In Review', 'Closed', 'Open'];

/* -------------------------------------------------------------------------- */
/*  Per-field value generator                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Generate a single dummy value for one form field. `rng` is a seeded
 * random function (0..1) so the output is stable across renders.
 */
export function dummyValueForField(field, rng) {
  const type = String(field?.type || '').toLowerCase();
  const name = String(field?.name || field?.displayName || '').toLowerCase();
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  // --- name-based heuristics (overrides) ----------------------------------
  if (/email/.test(name)) {
    return `${pick(FIRST_NAMES).toLowerCase()}.${pick(LAST_NAMES).toLowerCase()}@example.com`;
  }
  if (/phone|mobile|contact/.test(name)) {
    return `+91 ${Math.floor(60000 + rng() * 39999)} ${Math.floor(10000 + rng() * 89999)}`;
  }
  if (/city/.test(name)) return pick(CITIES);
  if (/company|organi[sz]ation|vendor/.test(name)) return pick(COMPANIES);
  if (/status|state\b/.test(name)) return pick(STATUSES);
  if (/first.?name/.test(name)) return pick(FIRST_NAMES);
  if (/last.?name|surname/.test(name)) return pick(LAST_NAMES);
  if (/full.?name|^name$|employee.?name|customer.?name/.test(name)) {
    return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
  }
  if (/country/.test(name)) return pick(['India', 'USA', 'UAE', 'UK', 'Germany']);
  if (/amount|total|price|cost|fee/.test(name)) {
    return Math.round(500 + rng() * 49500);
  }
  if (/qty|quantity|count/.test(name)) return Math.floor(1 + rng() * 50);
  if (/url|website|link/.test(name)) return `https://example.com/${Math.floor(rng() * 9999)}`;
  if (/id\b|number|code/.test(name) && !/paid/.test(name)) {
    return `ID-${Math.floor(1000 + rng() * 8999)}`;
  }

  // --- type-based fallbacks -----------------------------------------------
  switch (type) {
    case 'text':
    case 'bigtext':
    case 'richtext':
      return pick(['Sample entry', 'Lorem ipsum dolor sit', 'Notes for record', 'Draft content']);
    case 'number':
    case 'integer':
    case 'decimal':
    case 'percent':
    case 'percentage':
      return Math.round(rng() * 1000) / 10;
    case 'usd':
    case 'currency':
      return `$${(rng() * 10000).toFixed(2)}`;
    case 'date':
      return formatDate(randomDate(rng));
    case 'datetime':
    case 'timestamp':
      return `${formatDate(randomDate(rng))} ${padTwo(Math.floor(rng() * 24))}:${padTwo(Math.floor(rng() * 60))}`;
    case 'time':
      return `${padTwo(Math.floor(rng() * 24))}:${padTwo(Math.floor(rng() * 60))}`;
    case 'email':
      return `${pick(FIRST_NAMES).toLowerCase()}@example.com`;
    case 'phone':
    case 'phonenumber':
      return `+91 ${Math.floor(60000 + rng() * 39999)} ${Math.floor(10000 + rng() * 89999)}`;
    case 'url':
      return 'https://example.com';
    case 'boolean':
    case 'checkbox':
      return rng() > 0.5 ? 'Yes' : 'No';
    case 'picklist':
    case 'radiobuttons':
    case 'dropdown':
      if (hasLookupRef(field)) return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)} (lookup)`;
      return pick(['Option A', 'Option B', 'Option C']);
    case 'list':
    case 'checkboxes':
    case 'multiselect':
      if (hasLookupRef(field)) {
        return [`${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`, `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`];
      }
      return ['Option A', 'Option C'];
    case 'grid':
    case 'subform':
      return '— 3 child rows —';
    case 'fileupload':
    case 'file':
    case 'image':
      return 'attachment.pdf';
    case 'signature':
      return '✎ signed';
    case 'address':
      return `${Math.floor(1 + rng() * 200)}, ${pick(CITIES)}`;
    case 'formula':
      return `= ${Math.round(rng() * 500)}`;
    default:
      return pick(['Sample', '—', 'N/A', 'Value']);
  }
}

function hasLookupRef(field) {
  const lk = field?.lookup;
  if (!lk) return false;
  if (typeof lk === 'string') return lk.trim().length > 0;
  if (typeof lk === 'object') return !!(lk.form || lk.target || lk.formName);
  return false;
}

function randomDate(rng) {
  const year = 2023 + Math.floor(rng() * 3);
  const month = 1 + Math.floor(rng() * 12);
  const day = 1 + Math.floor(rng() * 28);
  return { year, month, day };
}

function formatDate({ year, month, day }) {
  return `${padTwo(day)}-${padTwo(month)}-${year}`;
}

function padTwo(n) {
  return String(n).padStart(2, '0');
}

/* -------------------------------------------------------------------------- */
/*  Record & row builders                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Build ONE synthetic record for a form — a `{ fieldName: value }` object
 * populated with dummy values. Seed is derived from the form name so
 * re-renders don't reshuffle the data.
 */
export function makeDummyRecord(form, salt = '') {
  const rng = mulberry32(seedFrom((form?.name || 'form') + '::' + salt));
  const out = {};
  for (const f of form?.fields || []) {
    out[f.name] = dummyValueForField(f, rng);
  }
  return out;
}

/**
 * Build N synthetic rows for a form — useful for simulating a report's
 * table contents.
 */
export function makeDummyRows(form, count = 4) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(makeDummyRecord(form, `row-${i}`));
  }
  return rows;
}

/**
 * Choose a compact subset of columns for a report-style preview. Prefers
 * meaningful fields (name/ID/status/date) and caps at `n`.
 */
export function pickPreviewColumns(form, n = 5) {
  const fields = (form?.fields || []).filter((f) => String(f.type).toLowerCase() !== 'grid');
  if (fields.length <= n) return fields;

  const priority = (f) => {
    const nm = String(f.name || '').toLowerCase();
    if (/name|title/.test(nm)) return 0;
    if (/id\b|number|code/.test(nm)) return 1;
    if (/status|state/.test(nm)) return 2;
    if (/date|time/.test(nm)) return 3;
    if (/email|phone/.test(nm)) return 4;
    if (/amount|total|qty/.test(nm)) return 5;
    return 10;
  };
  return [...fields].sort((a, b) => priority(a) - priority(b)).slice(0, n);
}

/**
 * Convert any generated value into a short human-readable string suitable
 * for rendering inside a <td> or an <input value="…" />.
 */
export function formatDummyValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}
