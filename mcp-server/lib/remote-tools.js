// Logic of the remote transport (index-streamable-http.js; the stdio bridge index-stdio.js
// shared it until 4.0.0 retired it). Each caller passes `api(endpoint, options)`, its own callAPI bound
// to the caller's credentials, so the behaviour cannot drift between them.

import { viewPayload } from './matrix-view.js';
import { asPng } from './png.js';

/**
 * An API error an agent can act on: HTTP status, stable code, message, and the
 * fields a validation error points at. Before, only the bare message (or the
 * code alone) came through: "VALIDATION_ERROR" said nothing about which field.
 */
export function apiErrorMessage(status, body) {
  const code = body && typeof body.error === 'string' ? body.error : null;
  const message = body && typeof body.message === 'string' ? body.message : null;
  const issues = Array.isArray(body?.issues)
    ? body.issues
        .slice(0, 5)
        .map((i) => `${Array.isArray(i.path) && i.path.length ? i.path.join('.') : '(body)'}: ${i.message}`)
        .join('; ')
    : '';
  const head = [`HTTP ${status}`, code].filter(Boolean).join(' ');
  return [head, message, issues && `Invalid fields: ${issues}`].filter(Boolean).join(' — ');
}

/** The organization's matrices, default first, with what an agent needs to pick one. */
export async function listMatrices(api, { includeArchived = false } = {}) {
  const query = includeArchived ? '?limit=100' : '?isActive=true&limit=100';
  const result = await api(`/api/matrices${query}`);
  const rows = Array.isArray(result.matrices) ? result.matrices : [];
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    isDefault: m.isDefault === true,
    isActive: m.isActive !== false,
    parentMatrixId: m.parentMatrixId ?? null,
    periodType: m.periodType ?? null,
    elementCount: m.elementsCount ?? null,
  }));
}

/**
 * The matrix that holds an element. Element ids are unique across the org, so
 * an agent holding one (from list_objectives, get_matrix_data…) should not have
 * to also name its matrix: without this, writing to an element of a site
 * matrix fell back to the default matrix and failed with "Element not found".
 */
/**
 * The one rule every tool uses to pick a matrix: the one named, else the default
 * matrix of the organization if it is active, else the first active one. The API
 * sorts lists that way (active, default, recent), so it is also "the first row".
 */
export function pickMatrix(matrices, matrixId) {
  const rows = (matrices || []).filter(Boolean);
  if (matrixId) return rows.find((m) => m.id === matrixId) ?? null;
  const active = rows.filter((m) => m.isActive !== false);
  return active.find((m) => m.isDefault) ?? active[0] ?? null;
}

export async function findElement(api, elementId) {
  const result = await api('/api/exports/matrices?include=elements');
  const matrices = Array.isArray(result.data) ? result.data : [result.data];
  for (const matrix of matrices) {
    if (!matrix?.elements) continue;
    for (const quadrant of ['north', 'east', 'south', 'west']) {
      const element = (matrix.elements[quadrant] || []).find((el) => el.id === elementId);
      if (element) return { matrixId: matrix.id, matrixName: matrix.name, quadrant, element };
    }
  }
  return null;
}

/** Body of POST/PUT /api/matrices/:id/elements from upsert_element arguments. */
export function elementBody(args) {
  const body = {};
  const map = {
    quadrant: 'quadrant',
    title: 'title',
    description: 'description',
    status: 'status',
    target_value: 'targetValue',
    current_value: 'currentValue',
    unit: 'unit',
    indicator_type: 'indicatorType',
    owner_id: 'ownerId',
    due_date: 'dueDate',
    visibility: 'visibility',
  };
  for (const [arg, field] of Object.entries(map)) {
    if (args[arg] !== undefined) body[field] = args[arg];
  }
  if (args.external_ref !== undefined) body.externalRef = args.external_ref || null;
  if (args.links !== undefined) body.links = args.links;
  if (args.parent_element_id !== undefined) body.parentElementId = args.parent_element_id || null;
  if (args.owner_id === '') body.ownerId = null;
  if (args.due_date === '') body.dueDate = null;
  return body;
}

/** The quarter a date falls in, in UTC (mirror of src/lib/kpi-period.ts currentQuarter). */
export function currentQuarter(at = new Date()) {
  return `${at.getUTCFullYear()}-Q${Math.floor(at.getUTCMonth() / 3) + 1}`;
}

export const PERIOD_PATTERN = /^(20\d\d|2100)-(Q[1-4]|0[1-9]|1[0-2])$/;

/** Sort key of a period, mirror of src/lib/kpi-period.ts: a quarter just after the month that closes it. */
function periodKey(period) {
  const m = PERIOD_PATTERN.exec(period);
  if (!m) return -1;
  const quarter = m[2].startsWith('Q');
  const end = quarter ? Number(m[2].slice(1)) * 3 : Number(m[2]);
  return (Number(m[1]) * 12 + end) * 2 + (quarter ? 1 : 0);
}

export const comparePeriods = (a, b) => periodKey(a) - periodKey(b);

/** Mirror of src/lib/kpi-period.ts readingStatus: provisional while the period runs, final once it ended (UTC). */
export function readingStatus(period, now = new Date()) {
  const m = PERIOD_PATTERN.exec(period);
  if (!m) return 'provisional';
  const endMonth = m[2].startsWith('Q') ? Number(m[2].slice(1)) * 3 : Number(m[2]);
  return now.getTime() >= Date.UTC(Number(m[1]), endMonth, 1) ? 'final' : 'provisional';
}

/** The reading of the latest period, or null (a malformed period never counts). */
export function latestReading(rows) {
  let best = null;
  for (const r of rows) {
    if (periodKey(r.period) < 0) continue;
    if (!best || comparePeriods(r.period, best.period) > 0) best = r;
  }
  return best;
}

/**
 * Where a KPI value was read (lot B of the 2026-11 field feedback sprint):
 * the tool, a reference in it, the extraction time. Only with a reading; same caps
 * as the API (recordMeasurementBody). Returns { error } or { origin } (null if none given).
 */
export function readingOrigin({ origin_tool, origin_ref, extracted_at } = {}, { isKpi, hasValue }, now = Date.now()) {
  const given = origin_tool !== undefined || origin_ref !== undefined || extracted_at !== undefined;
  if (!given) return { origin: null };
  if (!isKpi || !hasValue) return { error: 'origin_tool, origin_ref and extracted_at describe a KPI reading: pass them with current_value on a KPI' };
  const tool = typeof origin_tool === 'string' ? origin_tool.trim() : '';
  const ref = typeof origin_ref === 'string' ? origin_ref.trim() : '';
  if (origin_tool !== undefined && (!tool || tool.length > 100)) return { error: 'origin_tool must be 1 to 100 characters' };
  if (origin_ref !== undefined && (!ref || ref.length > 500)) return { error: 'origin_ref must be 1 to 500 characters' };
  if (extracted_at !== undefined) {
    const at = typeof extracted_at === 'string' && extracted_at.length <= 40 ? Date.parse(extracted_at) : NaN;
    if (Number.isNaN(at)) return { error: 'extracted_at must be a date (YYYY-MM-DD) or an ISO datetime' };
    if (at > now + 5 * 60 * 1000) return { error: 'extracted_at is in the future' };
  }
  return {
    origin: {
      originTool: tool || null,
      originRef: ref || null,
      extractedAt: extracted_at !== undefined ? new Date(Date.parse(extracted_at)).toISOString() : null,
    },
  };
}

/**
 * update_element_status for the two remote transports. A KPI's value is a
 * reading for a period (PUT …/measurements), so the quarters stay; progress and
 * notes go to the element's update log (POST …/updates), with author and date,
 * instead of overwriting current_value and growing the description.
 */
export async function updateElementStatus(api, args) {
  const { element_id, status, progress, current_value, notes, external_ref, period } = args;
  if (!element_id) return { error: 'element_id is required' };
  if (!status && progress === undefined && current_value === undefined && !notes && external_ref === undefined) {
    return { error: 'At least one of status, progress, current_value, notes, or external_ref must be provided' };
  }
  if (period !== undefined && !PERIOD_PATTERN.test(period)) {
    return { error: 'period must be a quarter (YYYY-Qn, e.g. 2026-Q3) or a month (YYYY-MM)' };
  }

  const found = await findElement(api, element_id);
  if (!found) return { error: `Element with id "${element_id}" not found in any matrix` };
  const { matrixId, element: current } = found;
  const isKpi = found.quadrant === 'west';
  if (progress !== undefined && isKpi) {
    return { error: 'This element is a KPI: pass its measured value as current_value (with an optional period), not progress' };
  }
  if (period !== undefined && !isKpi) {
    return { error: 'period is for a KPI reading; an objective or initiative takes progress and notes' };
  }
  // Checked before any write: the API caps these, and a refusal after the status
  // was already changed would leave the element half updated.
  if (current_value !== undefined && String(current_value).trim().length > 100) {
    return { error: 'current_value is limited to 100 characters' };
  }
  if (notes && notes.length > (isKpi && current_value ? 2000 : 5000)) {
    return { error: `notes are limited to ${isKpi && current_value ? 2000 : 5000} characters` };
  }
  const { origin, error: originError } = readingOrigin(args, { isKpi, hasValue: current_value !== undefined && current_value !== '' });
  if (originError) return { error: originError };
  const base = `/api/matrices/${matrixId}/elements/${element_id}`;
  const changes = {};
  let element = null;

  const fields = {};
  if (status) fields.status = status;
  if (external_ref !== undefined) fields.externalRef = external_ref || null;
  // Clearing a KPI's value by hand stays possible; any other value is a reading.
  if (current_value === '') fields.currentValue = null;
  if (current_value !== undefined && current_value !== '' && !isKpi) fields.currentValue = String(current_value);
  if (Object.keys(fields).length > 0) {
    element = await api(base, { method: 'PUT', body: JSON.stringify(fields) });
    if (status) changes.status = { from: current.status, to: status };
    if (external_ref !== undefined) changes.externalRef = external_ref;
    if ('currentValue' in fields) changes.currentValue = { from: current.currentValue ?? null, to: fields.currentValue };
  }

  let noteLogged = false;
  if (isKpi && current_value !== undefined && current_value !== '') {
    const at = period ?? currentQuarter();
    const saved = await api(`${base}/measurements`, {
      method: 'PUT',
      body: JSON.stringify({ period: at, value: String(current_value).trim(), ...(notes ? { note: notes } : {}), ...(origin ?? {}) }),
    });
    noteLogged = !!notes;
    changes.reading = { period: at, value: String(current_value).trim(), previousCurrentValue: current.currentValue ?? null };
    changes.currentValue = { from: current.currentValue ?? null, to: saved.currentValue ?? null };
  }

  if (progress !== undefined || (notes && !noteLogged)) {
    const logged = await api(`${base}/updates`, {
      method: 'POST',
      body: JSON.stringify({
        ...(progress !== undefined ? { progress } : {}),
        ...(notes && !noteLogged ? { comment: notes } : {}),
      }),
    });
    if (progress !== undefined) changes.progress = { from: current.progress ?? null, to: logged.progress ?? progress };
    if (notes && !noteLogged) changes.noteLogged = notes;
  } else if (noteLogged) {
    changes.noteLogged = notes;
  }

  return {
    success: true,
    message: `Element "${current.title}" updated`,
    ...(element ? { element } : {}),
    changes,
  };
}

/** Body of PUT /api/ideas/:id from update_idea arguments. */
export function ideaUpdateBody(args) {
  const body = {};
  if (args.status !== undefined) body.status = args.status;
  if (args.priority !== undefined) body.priority = args.priority;
  if (args.linked_element_id !== undefined) body.linkedElementId = args.linked_element_id || null;
  if (args.title !== undefined) body.title = args.title;
  if (args.description !== undefined) body.description = args.description;
  if (args.links !== undefined) body.links = args.links;
  return body;
}

// ---------------------------------------------------------------------------
// Cadences and strategic themes (get_management_architecture,
// diagnose_theme_deployment, suggest_meeting_for_topic). One implementation for
// both remote transports since 2026-11-06: stdio had drifted to shorter
// suggestions, no reasons and no aiContext. The transport adds its own fields
// (the streamable one adds `organization`).

const QUADRANTS = ['north', 'east', 'south', 'west'];
const LEVELS = ['strategic', 'tactical', 'operational_mgmt', 'team_mgmt', 'execution'];
const THEME_LEVEL_LABELS = {
  strategic: 'Strategic (Annual/Multi-year)',
  tactical: 'Tactical (Quarterly)',
  operational_mgmt: 'Operational Management (Monthly)',
  team_mgmt: 'Team Management (Weekly)',
  execution: 'Operational Execution (Daily)',
};
const MEETING_LEVEL_LABELS = { ...THEME_LEVEL_LABELS, tactical: 'Tactical (Quarterly/QBR)' };
const QUADRANT_LABELS = { north: 'Vision (North)', east: 'Annual Objectives (East)', south: 'Initiatives (South)', west: 'KPIs (West)' };

/** The cadence architecture of the organization, by level. */
export async function managementArchitecture(api) {
  return api('/api/cadences/architecture');
}

/**
 * How far a strategic theme is deployed: in which quadrants of the X-Matrix it has
 * elements (40 % of the score), and which cadence levels review those quadrants (60 %).
 */
export async function diagnoseThemeDeployment(api, { theme_id, theme_name } = {}) {
  const themes = (await api('/api/themes')).themes || [];
  let theme = null;
  if (theme_id) theme = themes.find((t) => t.id === theme_id);
  else if (theme_name) {
    const nameLower = theme_name.toLowerCase();
    theme = themes.find((t) => t.name.toLowerCase().includes(nameLower));
  }
  if (!theme) {
    return {
      error: theme_id
        ? `Theme with id "${theme_id}" not found`
        : theme_name
          ? `No theme matching "${theme_name}" found`
          : 'Either theme_id or theme_name is required',
      availableThemes: themes.map((t) => ({ id: t.id, name: t.name })),
    };
  }

  const themeDetail = await api(`/api/themes/${theme.id}`);
  const cadencesByLevel = (await api('/api/cadences/architecture')).byLevel || {};

  const deployment = {};
  for (const q of QUADRANTS) {
    const count = themeDetail.elements?.[q]?.length || 0;
    deployment[q] = { present: count > 0, elements: count };
  }
  const quadrantsPresent = QUADRANTS.filter((q) => deployment[q].present).length;

  const operationalCoverage = [];
  let coveredLevels = 0;
  for (const level of LEVELS) {
    const cadences = cadencesByLevel[level] || [];
    if (cadences.length === 0) {
      operationalCoverage.push({
        level,
        levelLabel: THEME_LEVEL_LABELS[level],
        coverage: 0,
        meetings: [],
        status: 'missing',
        message: `No cadences defined at ${THEME_LEVEL_LABELS[level]} level`,
      });
      continue;
    }
    // A cadence covers the theme through the quadrants it tracks where the theme has elements.
    const meetings = cadences.map((c) => {
      const tracked = [...new Set(c.primaryQuadrant ? [c.primaryQuadrant, ...(c.trackedQuadrants || [])] : c.trackedQuadrants || [])];
      const relevantQuadrants = tracked.filter((q) => deployment[q]?.present);
      const coverageRatio = tracked.length > 0 ? relevantQuadrants.length / Math.max(quadrantsPresent, 1) : 0;
      return { name: c.name, frequency: c.frequency, teamScope: c.teamScope, trackedQuadrants: tracked, relevantQuadrants, coverageRatio };
    });
    const best = Math.max(...meetings.map((m) => m.coverageRatio), 0);
    let status = 'critical';
    if (best >= 0.75) {
      status = 'ok';
      coveredLevels += 1;
    } else if (best >= 0.25) {
      status = 'warning';
      coveredLevels += 0.5;
    }
    operationalCoverage.push({ level, levelLabel: THEME_LEVEL_LABELS[level], coverage: Math.round(best * 100) / 100, meetings, status });
  }

  const score = Math.round((quadrantsPresent / 4) * 40 + (coveredLevels / LEVELS.length) * 60);
  const suggestions = [];
  for (const q of QUADRANTS) {
    if (!deployment[q].present) suggestions.push(`Add ${QUADRANT_LABELS[q]} elements for theme "${themeDetail.name}"`);
  }
  for (const oc of operationalCoverage) {
    if (oc.status === 'critical') {
      suggestions.push(`No meetings at ${oc.levelLabel} level cover theme "${themeDetail.name}" - consider creating one or linking existing cadences`);
    } else if (oc.status === 'warning') {
      suggestions.push(`Partial coverage at ${oc.levelLabel} level - review tracked quadrants in meetings`);
    }
  }

  return {
    theme: themeDetail.name,
    themeId: themeDetail.id,
    score,
    deployment,
    operationalCoverage,
    suggestions,
    aiContext: `Theme "${themeDetail.name}" deployment score ${score}/100. Present in ${quadrantsPresent}/4 quadrants. ${coveredLevels}/${LEVELS.length} hierarchy levels have adequate coverage.`,
  };
}

const QUADRANT_TO_LEVEL = {
  north: {
    recommended: ['strategic'],
    acceptable: ['tactical'],
    notRecommended: ['operational_mgmt', 'team_mgmt', 'execution'],
    reason: 'Vision/strategic objectives (North quadrant, 3-5 year horizon) should be discussed at strategic level meetings (annual reviews, strategic planning)',
  },
  east: {
    recommended: ['tactical', 'operational_mgmt'],
    acceptable: ['strategic'],
    notRecommended: ['team_mgmt', 'execution'],
    reason: 'Annual objectives (East quadrant) should be reviewed at tactical level (QBR) or monthly operations reviews',
  },
  south: {
    recommended: ['tactical', 'operational_mgmt'],
    acceptable: ['team_mgmt'],
    notRecommended: ['strategic', 'execution'],
    reason: 'Initiatives and projects (South quadrant) should be tracked at QBR (quarterly) or monthly reviews, with weekly check-ins as needed',
  },
  west: {
    recommended: ['operational_mgmt', 'team_mgmt'],
    acceptable: ['execution'],
    notRecommended: ['strategic', 'tactical'],
    reason: 'KPIs and metrics (West quadrant) should be tracked at monthly reviews and weekly team meetings, with derived KPIs in daily stand-ups',
  },
};

// Topic keywords → level, first match wins; monthly review by default.
const TOPIC_LEVELS = [
  [/vision|strat[ée]gi|long.?term|3.?5\s*ans|pluriannuel/, 'strategic', 'Topic mentions strategic/vision/long-term concepts'],
  [/trimestr|quarter|qbr|initiative|projet|program/, 'tactical', 'Topic mentions quarterly/initiative/project concepts'],
  [/mensuel|monthly|kpi|indicat|m[ée]trique|review/, 'operational_mgmt', 'Topic mentions monthly/KPI/metrics concepts'],
  [/hebdo|weekly|[ée]quipe|team|sprint/, 'team_mgmt', 'Topic mentions weekly/team/sprint concepts'],
  [/daily|quotidien|standup|stand.?up|jour/, 'execution', 'Topic mentions daily/stand-up concepts'],
];
const TOPIC_DEFAULT = [null, 'operational_mgmt', 'General topic - defaulting to monthly review level'];

/**
 * Which cadence level should discuss a topic: from the quadrant of `element_id`
 * when given, otherwise from keywords of the topic.
 */
export async function suggestMeetingForTopic(api, { topic, element_id } = {}) {
  if (!topic || topic.trim().length === 0) return { error: 'topic is required' };

  let element = null;
  if (element_id) {
    const found = await findElement(api, element_id);
    if (found) element = { id: found.element.id, title: found.element.title, quadrant: found.quadrant };
  }
  const cadencesByLevel = (await api('/api/cadences/architecture')).byLevel || {};
  const cadencesAt = (level) =>
    (cadencesByLevel[level] || []).map((c) => ({ id: c.id, name: c.name, frequency: c.frequency, teamScope: c.teamScope }));

  const recommended = [];
  const notRecommended = [];
  const mapping = element ? QUADRANT_TO_LEVEL[element.quadrant] : null;
  if (mapping) {
    for (const level of mapping.recommended) {
      recommended.push({ level, levelLabel: MEETING_LEVEL_LABELS[level], priority: 'recommended', cadences: cadencesAt(level), reason: mapping.reason });
    }
    for (const level of mapping.acceptable) {
      recommended.push({
        level,
        levelLabel: MEETING_LEVEL_LABELS[level],
        priority: 'acceptable',
        cadences: cadencesAt(level),
        reason: 'Acceptable if the topic requires attention at this level',
      });
    }
    for (const level of mapping.notRecommended) {
      notRecommended.push({
        level,
        levelLabel: MEETING_LEVEL_LABELS[level],
        reason:
          level === 'execution' || level === 'team_mgmt'
            ? 'Too operational - this topic has a longer time horizon than daily/weekly discussions'
            : 'Too high-level - this topic is more operational and does not require strategic-level discussion',
      });
    }
  } else {
    const topicLower = topic.toLowerCase();
    const [, detectedLevel, detectedReason] = TOPIC_LEVELS.find(([re]) => re.test(topicLower)) ?? TOPIC_DEFAULT;
    const levelIndex = LEVELS.indexOf(detectedLevel);
    LEVELS.forEach((level, i) => {
      const distance = Math.abs(i - levelIndex);
      if (distance === 0) {
        recommended.push({ level, levelLabel: MEETING_LEVEL_LABELS[level], priority: 'recommended', cadences: cadencesAt(level), reason: detectedReason });
      } else if (distance === 1) {
        recommended.push({
          level,
          levelLabel: MEETING_LEVEL_LABELS[level],
          priority: 'acceptable',
          cadences: cadencesAt(level),
          reason: 'Adjacent level - acceptable if context requires',
        });
      } else {
        notRecommended.push({ level, levelLabel: MEETING_LEVEL_LABELS[level], reason: i < levelIndex ? 'Too high-level for this topic' : 'Too operational for this topic' });
      }
    });
  }

  return { topic, element, recommended, notRecommended };
}

// ---------------------------------------------------------------------------
// Agenda and reviews (docs/sprint-cadencement-agent.md): get_agenda, schedule_review,
// record_review. The API computes the agenda; these only map arguments.
// ---------------------------------------------------------------------------

export async function getAgenda(api, { since, horizon_days, matrix_id } = {}) {
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  if (horizon_days !== undefined) params.set('horizonDays', String(horizon_days));
  if (matrix_id) params.set('matrixId', matrix_id);
  const qs = params.toString();
  return api(`/api/agenda${qs ? `?${qs}` : ''}`);
}

export async function scheduleReview(api, { cadence_id, date, matrix_id } = {}) {
  if (!cadence_id || !date) return { error: 'cadence_id and date are required' };
  return api('/api/meetings', {
    method: 'POST',
    body: JSON.stringify({ cadenceId: cadence_id, scheduledDate: date, ...(matrix_id && { matrixId: matrix_id }) }),
  });
}

export function reviewRecordBody(args) {
  const body = {};
  if (args.notes !== undefined) body.notes = args.notes;
  if (args.decisions !== undefined) body.decisions = args.decisions;
  if (args.discussed_element_ids !== undefined) body.discussedElementIds = args.discussed_element_ids;
  if (args.held_on) body.actualDate = args.held_on;
  return body;
}

export async function recordReview(api, args = {}) {
  if (!args.review_id) return { error: 'review_id is required' };
  return api(`/api/meetings/${args.review_id}/complete`, { method: 'PATCH', body: JSON.stringify(reviewRecordBody(args)) });
}

// Identity and help (docs/sprint-identite-agent-et-plans.md): whoami, report_missing_capability.
export async function whoami(api) {
  return api('/api/whoami');
}

export function capabilityRequestBody(args = {}) {
  const body = { capability: typeof args.capability === 'string' ? args.capability.trim() : '' };
  if (args.use_case) body.useCase = args.use_case;
  if (args.feature) body.feature = args.feature;
  return body;
}

export async function reportMissingCapability(api, args = {}) {
  const body = capabilityRequestBody(args);
  if (body.capability.length < 3) return { error: 'capability is required: what is missing, in one sentence' };
  return api('/api/capability-requests', { method: 'POST', body: JSON.stringify(body) });
}

// the 2026-11 field feedback sprint, lot A: an agent repairs what it built.

/** archive_matrix: archive (or bring back) a matrix; its data stays, list_matrices hides it. */
export async function archiveMatrix(api, { matrix_id, archived = true } = {}) {
  if (!matrix_id) return { error: 'matrix_id is required — find it with list_matrices (include_archived to see archived ones)' };
  const updated = await api(`/api/matrices/${matrix_id}`, { method: 'PUT', body: JSON.stringify({ isActive: archived === false }) });
  return {
    success: true,
    message: archived === false ? `Matrix "${updated.name}" is active again` : `Matrix "${updated.name}" archived: its data is kept, list_matrices with include_archived shows it`,
    matrix: { id: updated.id, name: updated.name, isActive: updated.isActive, isDefault: updated.isDefault },
  };
}

/** The exact-name check of delete_matrix, the same one the app asks of a person. */
export function deletionConfirmed(name, confirmName) {
  return typeof confirmName === 'string' && typeof name === 'string' && confirmName.trim() === name.trim();
}

/** delete_matrix: irreversible, so the agent repeats the matrix's exact name first. */
export async function deleteMatrix(api, { matrix_id, confirm_name } = {}) {
  if (!matrix_id) return { error: 'matrix_id is required — find it with list_matrices' };
  if (typeof confirm_name !== 'string' || !confirm_name.trim()) {
    return { error: 'confirm_name is required: the exact name of the matrix. Deleting cannot be undone; archive_matrix keeps the data.' };
  }
  const matrix = await api(`/api/matrices/${matrix_id}?elements=false`);
  if (!deletionConfirmed(matrix.name, confirm_name)) {
    return { error: `CONFIRMATION_MISMATCH — confirm_name must be the exact name of the matrix, "${matrix.name}". Nothing was deleted.` };
  }
  await api(`/api/matrices/${matrix_id}`, { method: 'DELETE' });
  return {
    success: true,
    message: `Matrix "${matrix.name}" deleted with its elements, correlations, readings, updates and share links. Matrices below it are detached.`,
    deleted: { id: matrix.id, name: matrix.name },
  };
}

/** delete_element: an element and its correlations; elements below that deployed it let go. */
export async function deleteElement(api, { element_id } = {}) {
  if (!element_id) return { error: 'element_id is required' };
  const found = await findElement(api, element_id);
  if (!found) return { error: `Element with id "${element_id}" not found in any matrix` };
  await api(`/api/matrices/${found.matrixId}/elements/${element_id}`, { method: 'DELETE' });
  return {
    success: true,
    message: `Element "${found.element.title}" deleted from ${found.quadrant}, with its correlations, readings and updates`,
    deleted: { id: element_id, title: found.element.title, quadrant: found.quadrant, matrixId: found.matrixId, matrixName: found.matrixName },
  };
}

// Lot D: the X-Matrix as an SVG picture for a deck.
export const IMAGE_NOTE =
  'Save svg as a .svg file (layout "initiatives": one file per page): PowerPoint and Keynote insert it as is. For Google Slides, call again with format "png". audience "external" leaves out internal elements and every figure.';

export async function exportMatrixImage(api, { matrix_id, audience = 'internal', lang, layout = 'matrix', orientation = 'bottom', format = 'svg' } = {}) {
  if (!['bottom', 'top'].includes(orientation)) return { error: 'orientation must be "bottom" or "top"' };
  if (!['svg', 'png'].includes(format)) return { error: 'format must be "svg" or "png"' };
  if (!['internal', 'external'].includes(audience)) return { error: 'audience must be "internal" or "external"' };
  if (!['matrix', 'initiatives'].includes(layout)) return { error: 'layout must be "matrix" or "initiatives"' };
  if (lang !== undefined && !['en', 'fr'].includes(lang)) return { error: 'lang must be "en" or "fr"' };
  let id = matrix_id;
  if (!id) {
    const matrices = await listMatrices(api);
    id = pickMatrix(matrices)?.id;
    if (!id) return { error: 'No matrix found. Create a matrix first.' };
  }
  const query = new URLSearchParams({ audience, layout, orientation, ...(lang ? { lang } : {}) });
  const image = await api(`/api/matrices/${id}/image?${query}`);
  const result = { matrixId: id, ...image, note: IMAGE_NOTE };
  return format === 'png' ? asPng(result) : result;
}

// ---------------------------------------------------------------------------
// the 2026-11 field feedback sprint: review snapshot, initiative sheet,
// KPI definition, cadences, directory.
// ---------------------------------------------------------------------------

export async function getReview(api, { review_id } = {}) {
  if (!review_id) return { error: 'review_id is required' };
  return api(`/api/meetings/${review_id}/snapshot`);
}

/** snake_case tool arguments to the camelCase body, keeping only what was given (null included). */
function pick(args, map) {
  const body = {};
  for (const [from, to] of Object.entries(map)) if (args[from] !== undefined) body[to] = args[from];
  return body;
}

export const SHEET_ARGS = {
  sponsor: 'sponsor',
  why: 'why',
  expected_result: 'expectedResult',
  measured_by: 'measuredBy',
  milestones: 'milestones',
  next_action: 'nextAction',
  health: 'health',
  health_note: 'healthNote',
  blockers: 'blockers',
  resources: 'resources',
};

export const KPI_DEFINITION_ARGS = {
  formula: 'formula',
  source_system: 'sourceSystem',
  source_ref: 'sourceRef',
  data_owner: 'dataOwner',
  frequency: 'frequency',
};

export const sheetBody = (args = {}) => pick(args, SHEET_ARGS);
export const kpiDefinitionBody = (args = {}) => pick(args, KPI_DEFINITION_ARGS);

async function putOnElement(api, args, quadrant, body) {
  if (!args.element_id) return { error: 'element_id is required' };
  if (Object.keys(body).length === 0) return { error: 'Nothing to change: give at least one field' };
  const found = await findElement(api, args.element_id);
  if (!found) return { error: `Element with id "${args.element_id}" not found in any matrix` };
  if (found.quadrant !== quadrant) {
    return quadrant === 'south'
      ? { error: `NOT_AN_INITIATIVE: "${found.element.title}" is in ${found.quadrant}; a sheet is for an initiative (south)` }
      : { error: `NOT_A_KPI: "${found.element.title}" is in ${found.quadrant}; a definition is for a KPI (west)` };
  }
  // Literal paths: the contract test reads them to check every route the server calls is published.
  const init = { method: 'PUT', body: JSON.stringify(body) };
  const saved = quadrant === 'south'
    ? await api(`/api/matrices/${found.matrixId}/elements/${args.element_id}/sheet`, init)
    : await api(`/api/matrices/${found.matrixId}/elements/${args.element_id}/kpi-definition`, init);
  return { ...saved, title: found.element.title, matrixId: found.matrixId, matrixName: found.matrixName };
}

export async function upsertInitiativeSheet(api, args = {}) {
  return putOnElement(api, args, 'south', sheetBody(args));
}

export async function setKpiDefinition(api, args = {}) {
  return putOnElement(api, args, 'west', kpiDefinitionBody(args));
}

export const CADENCE_ARGS = {
  name: 'name',
  type: 'type',
  frequency: 'frequency',
  operational_level: 'operationalLevel',
  primary_quadrant: 'primaryQuadrant',
  tracked_quadrants: 'trackedQuadrants',
  duration_minutes: 'durationMinutes',
  scope_description: 'scopeDescription',
  parent_cadence_id: 'parentCadenceId',
};

export const cadenceBody = (args = {}) => pick(args, CADENCE_ARGS);

export async function upsertCadence(api, args = {}) {
  const body = cadenceBody(args);
  if (args.cadence_id) {
    if (Object.keys(body).length === 0) return { error: 'Nothing to change: give at least one field' };
    return api(`/api/cadences/${args.cadence_id}`, { method: 'PATCH', body: JSON.stringify(body) });
  }
  const missing = ['name', 'type', 'frequency', 'operational_level'].filter((k) => args[k] === undefined);
  if (missing.length) return { error: `To create a cadence, give ${missing.join(', ')}` };
  return api('/api/cadences', { method: 'POST', body: JSON.stringify(body) });
}

export async function listMembers(api) {
  return api('/api/members');
}

// show_matrix (docs/sprint-pages-de-repli.md, lot C): the plain view, as an MCP App.
export async function showMatrix(api, { matrix_id, audience = 'internal', orientation = 'bottom', lang } = {}) {
  const image = await exportMatrixImage(api, { matrix_id, audience, orientation, lang });
  if (image.error) return image;
  const id = image.matrixId;
  const external = audience === 'external';
  const exported = await api(`/api/exports/matrices?id=${id}&include=elements${external ? '&audience=external' : ''}`);
  const matrix = Array.isArray(exported.data) ? exported.data[0] : exported.data;
  if (!matrix) return { error: `Matrix "${id}" not found` };
  const completeness = await api(`/api/matrices/${id}/completeness${external ? '?audience=external' : ''}`).catch(() => null);
  const view = viewPayload({
    matrix,
    svg: image.svg,
    elements: matrix.elements,
    score: completeness?.score,
    lang: lang ?? image.lang,
    audience,
    hiddenElements: matrix.hiddenElements ?? image.hiddenElements ?? 0,
  });
  return {
    view,
    summary: {
      shown: true,
      note: 'Displayed to the person as the X-Matrix view where the host supports MCP Apps. Initiatives below; get_matrix_data has everything.',
    },
  };
}
