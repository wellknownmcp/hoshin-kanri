// GENERATED from src/lib/kpi-period.ts by scripts/generate-xmatrix-svg-mirror.cjs: do not edit.
// The indicator board of the local mode (kpi-board.js) reads periods with it.

// Periods of a KPI reading: a quarter (2026-Q3) or a month (2026-09). Pure,
// shared by the routes, the app and the MCP server's mirror
// (mcp-server/lib/remote-tools.js, currentQuarter). Tested in kpi-period.test.ts.
/** Years 2000 to 2100. A regex, not a refinement: it is published as is in the OpenAPI pattern. */
export const PERIOD_PATTERN = /^(20\d\d|2100)-(Q[1-4]|0[1-9]|1[0-2])$/;
export function parsePeriod(raw) {
    const m = PERIOD_PATTERN.exec(raw);
    if (!m)
        return null;
    const year = Number(m[1]);
    const part = m[2];
    return part.startsWith('Q')
        ? { year, kind: 'quarter', index: Number(part.slice(1)) }
        : { year, kind: 'month', index: Number(part) };
}
export const isPeriod = (raw) => parsePeriod(raw) !== null;
/** The quarter a date falls in, in UTC: what a reading defaults to. */
export function currentQuarter(at = new Date()) {
    return `${at.getUTCFullYear()}-Q${Math.floor(at.getUTCMonth() / 3) + 1}`;
}
/**
 * Sort key: the month the period ends in, a quarter just after the month that
 * closes it (2026-03 < 2026-Q1 < 2026-04), so a quarterly reading taken at the
 * end of March is the latest one of March.
 */
function key(p) {
    const endMonth = p.kind === 'quarter' ? p.index * 3 : p.index;
    return (p.year * 12 + endMonth) * 2 + (p.kind === 'quarter' ? 1 : 0);
}
/** Oldest first; an unparseable period sorts first and never counts as latest. */
export function comparePeriods(a, b) {
    const pa = parsePeriod(a);
    const pb = parsePeriod(b);
    return (pa ? key(pa) : -1) - (pb ? key(pb) : -1);
}
export function latestPeriod(rows) {
    let best = null;
    for (const r of rows) {
        if (!isPeriod(r.period))
            continue;
        if (!best || comparePeriods(r.period, best.period) > 0)
            best = r;
    }
    return best;
}
export const READING_STATUSES = ['provisional', 'final'];
/** First instant after the period, in UTC: 2026-Q1 ends at 2026-04-01T00:00Z, 2026-09 at 2026-10-01. */
export function periodEnd(raw) {
    const p = parsePeriod(raw);
    if (!p)
        return null;
    const endMonth = p.kind === 'quarter' ? p.index * 3 : p.index; // 1-based month that closes it
    return new Date(Date.UTC(p.year, endMonth, 1));
}
/**
 * A reading is provisional while its period runs and final once it has ended
 * (docs/sprint-retours-usage-france-care.md, lot D). Derived, never stored: a
 * correction after the end stays possible (late data), and the snapshot of the
 * review keeps what the committee saw.
 */
export function readingStatus(raw, now = new Date()) {
    const end = periodEnd(raw);
    return end && now.getTime() >= end.getTime() ? 'final' : 'provisional';
}
