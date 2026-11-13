// GENERATED from src/lib/agenda.ts by scripts/generate-agenda-mirror.cjs: do not edit.
// The local mode (index-local.js) computes the agenda with it; agenda.test.ts holds
// the two to the same output. Everything is in UTC, by calendar day; `dueSince` is
// the moment an item became due, so an agent polling with `since` sees it once.

/** In the order the agenda lists them: what blocks the next review first. */
export const AGENDA_KINDS = [
    'review_unrecorded',
    'review_upcoming',
    'review_unscheduled',
    'kpi_reading_missing',
    'initiative_stale',
    'action_overdue',
    'roadmap_assessment_due',
    'roadmap_item_unlinked',
    'roadmap_link_closed',
    'roadmap_score_unproven',
];
const ROADMAP_KIND = {
    assessment_due: 'roadmap_assessment_due',
    item_below_target_unlinked: 'roadmap_item_unlinked',
    item_link_closed: 'roadmap_link_closed',
    score_without_evidence: 'roadmap_score_unproven',
};
const DAY = 86_400_000;
const NOTES_MAX = 500;
const ymd = (d) => d.toISOString().slice(0, 10);
const atDay = (s) => new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
const addDays = (s, n) => ymd(new Date(atDay(s).getTime() + n * DAY));
const iso = (d) => d.toISOString();
const later = (a, b) => (a > b ? a : b);
function addMonths(s, n) {
    const d = atDay(s);
    const day = d.getUTCDate();
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, last));
    return ymd(target);
}
/** The next review after `date` for a frequency. */
export function nextAfter(date, frequency) {
    switch (frequency) {
        case 'daily':
            return addDays(date, 1);
        case 'weekly':
            return addDays(date, 7);
        case 'monthly':
            return addMonths(date, 1);
        case 'yearly':
            return addMonths(date, 12);
        default:
            return addMonths(date, 3); // quarterly, and anything unknown
    }
}
/** How long before a review its preparation is due. */
const prepDays = (frequency) => (frequency === 'daily' || frequency === 'weekly' ? 1 : 7);
const FAST = new Set(['monthly', 'weekly', 'daily']);
/** Month index (year*12 + month, 1-based month) a period ends in. */
function periodEnd(period) {
    const m = /^(20\d\d|2100)-(Q[1-4]|0[1-9]|1[0-2])$/.exec(period);
    if (!m)
        return null;
    const year = Number(m[1]);
    const part = m[2];
    return year * 12 + (part.startsWith('Q') ? Number(part.slice(1)) * 3 : Number(part));
}
/** The last closed period before `today`, and the day the current one started. */
function lastClosed(today, monthly) {
    const d = atDay(today);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth(); // 0-based
    if (monthly) {
        const prev = new Date(Date.UTC(y, m - 1, 1));
        return {
            period: `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`,
            currentStart: ymd(new Date(Date.UTC(y, m, 1))),
        };
    }
    const q = Math.floor(m / 3); // 0-based current quarter
    const prevQ = q === 0 ? 4 : q;
    const prevY = q === 0 ? y - 1 : y;
    return { period: `${prevY}-Q${prevQ}`, currentStart: ymd(new Date(Date.UTC(y, q * 3, 1))) };
}
/** Days after which an initiative with no update is stale, from the fastest cadence reviewing initiatives. */
function staleAfter(cadences) {
    let days = 0;
    for (const c of cadences) {
        if (!c.trackedQuadrants.includes('south'))
            continue;
        const d = c.frequency === 'daily' || c.frequency === 'weekly' ? 7 : c.frequency === 'monthly' ? 31 : 92;
        days = days === 0 ? d : Math.min(days, d);
    }
    return days || 31;
}
export function computeAgenda(input, opts) {
    const now = opts.now;
    const today = ymd(now);
    const horizonDays = opts.horizonDays ?? 30;
    const horizonEnd = addDays(today, horizonDays);
    // Normalized so a date ("2026-11-07") and a datetime compare the same way.
    const since = opts.since ? iso(new Date(opts.since)) : null;
    const cadenceById = new Map(input.cadences.map((c) => [c.id, c]));
    const items = [];
    const calendar = [];
    const base = { cadenceId: null, reviewId: null, elementId: null, matrixId: null, period: null, date: null };
    // Reviews: unrecorded, upcoming, and each cadence's next one.
    for (const r of input.reviews) {
        const c = cadenceById.get(r.cadenceId);
        if (!c || r.status !== 'scheduled')
            continue;
        if (r.scheduledDate < today) {
            items.push({
                ...base,
                key: `review_unrecorded:${r.id}`,
                kind: 'review_unrecorded',
                // A review entered after the fact is due from the moment it was entered.
                dueSince: later(iso(atDay(addDays(r.scheduledDate, 1))), r.createdAt),
                subject: c.name,
                summary: `${c.name} of ${r.scheduledDate} is still open: record its notes and decisions, or cancel it.`,
                date: r.scheduledDate,
                cadenceId: c.id,
                reviewId: r.id,
                matrixId: r.matrixId,
            });
            continue;
        }
        if (r.scheduledDate <= horizonEnd) {
            calendar.push({ date: r.scheduledDate, cadenceId: c.id, cadenceName: c.name, cadenceType: c.type, reviewId: r.id, status: 'scheduled' });
        }
        const prepFrom = addDays(r.scheduledDate, -prepDays(c.frequency));
        if (prepFrom <= today) {
            items.push({
                ...base,
                key: `review_upcoming:${r.id}`,
                kind: 'review_upcoming',
                dueSince: later(iso(atDay(prepFrom)), r.createdAt),
                subject: c.name,
                summary: `${c.name} on ${r.scheduledDate}: prepare it.`,
                date: r.scheduledDate,
                cadenceId: c.id,
                reviewId: r.id,
                matrixId: r.matrixId,
            });
        }
    }
    for (const c of input.cadences) {
        const own = input.reviews.filter((r) => r.cadenceId === c.id && r.status !== 'cancelled');
        if (own.some((r) => r.status === 'scheduled' && r.scheduledDate >= today))
            continue;
        const held = own.map((r) => r.actualDate ?? r.scheduledDate).sort();
        const last = held[held.length - 1];
        const expected = last ? nextAfter(last, c.frequency) : null;
        if (expected && expected <= horizonEnd) {
            calendar.push({ date: expected < today ? today : expected, cadenceId: c.id, cadenceName: c.name, cadenceType: c.type, reviewId: null, status: 'expected' });
        }
        const dueFrom = expected ? addDays(expected, -prepDays(c.frequency)) : null;
        if (expected === null || dueFrom <= today) {
            items.push({
                ...base,
                key: `review_unscheduled:${c.id}:${expected ?? 'never'}`,
                kind: 'review_unscheduled',
                dueSince: expected === null ? c.createdAt : later(iso(atDay(dueFrom)), c.createdAt),
                subject: c.name,
                summary: expected
                    ? `${c.name} (${c.frequency}) has no review scheduled; the next one is expected on ${expected}.`
                    : `${c.name} (${c.frequency}) has never had a review scheduled.`,
                date: expected,
                cadenceId: c.id,
            });
        }
    }
    // KPIs: a reading covering the last closed period.
    const monthlyKpis = new Set();
    let westMonthly = false;
    for (const c of input.cadences) {
        if (!FAST.has(c.frequency))
            continue;
        if (c.trackedQuadrants.includes('west'))
            westMonthly = true;
        for (const id of c.trackedKpis)
            monthlyKpis.add(id);
    }
    for (const k of input.kpis) {
        const monthly = westMonthly || monthlyKpis.has(k.id);
        const { period, currentStart } = lastClosed(today, monthly);
        if (k.createdAt.slice(0, 10) >= currentStart)
            continue; // created this period: nothing to measure yet
        const latest = k.latestPeriod ? periodEnd(k.latestPeriod) : null;
        if (latest !== null && latest >= periodEnd(period))
            continue;
        items.push({
            ...base,
            key: `kpi_reading_missing:${k.id}:${period}`,
            kind: 'kpi_reading_missing',
            dueSince: iso(atDay(currentStart)),
            subject: k.title,
            summary: `"${k.title}" has no reading for ${period}${k.latestPeriod ? ` (latest: ${k.latestPeriod})` : ''}.`,
            elementId: k.id,
            matrixId: k.matrixId,
            period,
        });
    }
    // Initiatives: an update within the review rhythm.
    const stale = staleAfter(input.cadences);
    for (const i of input.initiatives) {
        if ((i.progress ?? 0) >= 100)
            continue; // done, awaiting its status change: nothing to report
        const ref = (i.lastUpdateAt ?? i.createdAt).slice(0, 10);
        const dueFrom = addDays(ref, stale);
        if (dueFrom > today)
            continue;
        items.push({
            ...base,
            key: `initiative_stale:${i.id}:${ref}`,
            kind: 'initiative_stale',
            dueSince: iso(atDay(dueFrom)),
            subject: i.title,
            summary: i.lastUpdateAt
                ? `"${i.title}" has had no progress update since ${ref}.`
                : `"${i.title}" has never had a progress update.`,
            date: ref,
            elementId: i.id,
            matrixId: i.matrixId,
        });
    }
    for (const a of input.actions) {
        if ((a.status !== 'todo' && a.status !== 'in_progress') || a.dueDate >= today)
            continue;
        items.push({
            ...base,
            key: `action_overdue:${a.id}`,
            kind: 'action_overdue',
            dueSince: iso(atDay(addDays(a.dueDate, 1))),
            subject: a.title,
            summary: `Action "${a.title}" was due on ${a.dueDate}.`,
            date: a.dueDate,
            elementId: a.elementId,
        });
    }
    // Excellence roadmap: a site due for an assessment, an item under its target
    // with no initiative or a closed one, a score with no evidence.
    for (const f of input.roadmap ?? []) {
        items.push({
            ...base,
            key: `roadmap:${f.key}`,
            kind: ROADMAP_KIND[f.kind],
            dueSince: iso(atDay(f.since)),
            subject: f.subject,
            summary: f.summary,
            date: f.since,
            matrixId: f.matrixId,
        });
    }
    items.sort((x, y) => AGENDA_KINDS.indexOf(x.kind) - AGENDA_KINDS.indexOf(y.kind) || (x.date ?? '').localeCompare(y.date ?? '') || x.key.localeCompare(y.key));
    calendar.sort((x, y) => x.date.localeCompare(y.date) || x.cadenceName.localeCompare(y.cadenceName));
    const recentReviews = input.reviews
        .filter((r) => r.status === 'completed' && cadenceById.has(r.cadenceId))
        .map((r) => ({ r, date: r.actualDate ?? r.scheduledDate }))
        .sort((x, y) => y.date.localeCompare(x.date))
        .slice(0, 3)
        .map(({ r, date }) => ({
        id: r.id,
        cadenceId: r.cadenceId,
        cadenceName: cadenceById.get(r.cadenceId).name,
        date,
        notes: r.notes && r.notes.length > NOTES_MAX ? `${r.notes.slice(0, NOTES_MAX)}…` : r.notes,
        decisions: r.decisions ?? null,
    }));
    const visible = since ? items.filter((i) => i.dueSince > since) : items;
    const month = today.slice(0, 7);
    return {
        now: { datetime: iso(now), date: today, quarter: `${today.slice(0, 4)}-Q${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1}`, month, timezone: 'UTC' },
        horizonDays,
        since,
        openCount: items.length,
        items: visible,
        calendar,
        recentReviews,
    };
}
