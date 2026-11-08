// Mirror of src/lib/element-sheets.ts for the local mode, without zod (the MCP
// server has no dependency but the SDK). Same fields, bounds and merge rules;
// src/lib/element-sheets.test.ts runs the same cases through both.
// the 2026-11 field feedback sprint, lots B and C.

export const HEALTHS = ['green', 'amber', 'red'];
export const MILESTONE_STATUSES = ['planned', 'done', 'late'];
export const KPI_FREQUENCIES = ['monthly', 'quarterly'];
export const MAX_MILESTONES = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** A trimmed string of 1..max characters, or an error message. */
function text(value, max, name) {
  if (typeof value !== 'string') return { error: `${name} must be a string` };
  const v = value.trim();
  if (v.length < 1 || v.length > max) return { error: `${name} must be 1 to ${max} characters` };
  return { value: v };
}

function strictKeys(obj, allowed, name) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return `${name} must be an object`;
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  return extra.length ? `${name}: unknown field ${extra[0]}` : null;
}

const TEXT_FIELDS = { sponsor: 100, why: 2000, expectedResult: 1000, healthNote: 500, blockers: 2000, resources: 1000 };
const SHEET_KEYS = ['sponsor', 'why', 'expectedResult', 'measuredBy', 'milestones', 'nextAction', 'health', 'healthNote', 'blockers', 'resources'];
const KPI_TEXT = { formula: 1000, sourceSystem: 100, sourceRef: 500, dataOwner: 100 };
const KPI_KEYS = [...Object.keys(KPI_TEXT), 'frequency'];

function optionalDay(value, name) {
  if (value === undefined || value === null) return { value };
  return isCalendarDate(value) ? { value } : { error: `${name} must be a date, YYYY-MM-DD` };
}

function sheetField(key, value) {
  if (key in TEXT_FIELDS) return text(value, TEXT_FIELDS[key], key);
  if (key === 'measuredBy') return typeof value === 'string' && UUID.test(value) ? { value } : { error: 'measuredBy must be a UUID' };
  if (key === 'health') return HEALTHS.includes(value) ? { value } : { error: `health must be one of ${HEALTHS.join(', ')}` };
  if (key === 'milestones') {
    if (!Array.isArray(value) || value.length > MAX_MILESTONES) return { error: `milestones must be a list of at most ${MAX_MILESTONES}` };
    const out = [];
    for (const m of value) {
      const bad = strictKeys(m, ['title', 'date', 'status'], 'milestone');
      if (bad) return { error: bad };
      const title = text(m.title, 200, 'milestone title');
      if (title.error) return title;
      const date = optionalDay(m.date, 'milestone date');
      if (date.error) return date;
      if (!MILESTONE_STATUSES.includes(m.status)) return { error: `milestone status must be one of ${MILESTONE_STATUSES.join(', ')}` };
      out.push({ title: title.value, ...(date.value !== undefined && { date: date.value }), status: m.status });
    }
    return { value: out };
  }
  if (key === 'nextAction') {
    const bad = strictKeys(value, ['title', 'owner', 'due'], 'nextAction');
    if (bad) return { error: bad };
    const title = text(value.title, 300, 'nextAction title');
    if (title.error) return title;
    let owner;
    if (value.owner !== undefined && value.owner !== null) {
      const o = text(value.owner, 100, 'nextAction owner');
      if (o.error) return o;
      owner = o.value;
    } else owner = value.owner;
    const due = optionalDay(value.due, 'nextAction due');
    if (due.error) return due;
    return { value: { title: title.value, ...(owner !== undefined && { owner }), ...(due.value !== undefined && { due: due.value }) } };
  }
  return { error: `unknown field ${key}` };
}

/** Same result shape as mergeSheet in src/lib/element-sheets.ts: { ok, value } or { ok: false, code, message }. */
export function mergeSheet(current, patch, now = new Date()) {
  const bad = strictKeys(patch, SHEET_KEYS, 'sheet');
  if (bad) return { ok: false, code: 'VALIDATION_ERROR', message: bad };
  const next = { ...(current || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) { delete next[k]; continue; }
    const r = sheetField(k, v);
    if (r.error) return { ok: false, code: 'VALIDATION_ERROR', message: r.error };
    next[k] = r.value;
  }
  if (patch.healthNote === null && patch.health !== null && (current || {}).health) {
    return { ok: false, code: 'HEALTH_NOTE_REQUIRED', message: 'A health keeps its sentence: change it, or clear the health with it.' };
  }
  if (patch.health && !patch.healthNote) {
    return { ok: false, code: 'HEALTH_NOTE_REQUIRED', message: 'A new health (weather) needs healthNote: one sentence that justifies it.' };
  }
  if (patch.health === null) {
    delete next.healthNote;
    delete next.healthAt;
  }
  if (patch.healthNote && !next.health) {
    return { ok: false, code: 'HEALTH_NOTE_REQUIRED', message: 'healthNote justifies a health (green, amber or red): set both.' };
  }
  if (patch.health || patch.healthNote) next.healthAt = now.toISOString();
  return { ok: true, value: next };
}

export function mergeKpiDefinition(current, patch) {
  const bad = strictKeys(patch, KPI_KEYS, 'kpi_definition');
  if (bad) return { ok: false, code: 'VALIDATION_ERROR', message: bad };
  const next = { ...(current || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) { delete next[k]; continue; }
    if (k === 'frequency') {
      if (!KPI_FREQUENCIES.includes(v)) return { ok: false, code: 'VALIDATION_ERROR', message: `frequency must be one of ${KPI_FREQUENCIES.join(', ')}` };
      next[k] = v;
      continue;
    }
    const r = text(v, KPI_TEXT[k], k);
    if (r.error) return { ok: false, code: 'VALIDATION_ERROR', message: r.error };
    next[k] = r.value;
  }
  return { ok: true, value: next };
}
