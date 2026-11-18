// GENERATED from src/lib/kpi-board.ts by scripts/generate-xmatrix-svg-mirror.cjs: do not edit.
// The local mode (json-store.js) builds the indicator board with it.

// The indicator board (docs/sprint-tableau-indicateurs.md): the KPIs of a matrix as
// one table, a row per indicator and a column per month, grouped by the annual
// objective each one measures. What lean practitioners call a bowler chart, read
// from the matrix instead of being kept beside it.
//
// Three things a plain dashboard does not do:
//  - the grouping comes from the links of the matrix (objective → project → KPI),
//    so an objective nothing measures and a KPI tied to no objective both show;
//  - a reading that is due and missing is a cell of its own, not a blank;
//  - a verdict is given only when it can be: the indicator must say which way is
//    better (kpiDefinition.direction), and the reading it is judged on must be one
//    the table shows. Otherwise the row says why there is none (noVerdict).
// There is one target per indicator (the year's), not one per month: per-period
// targets are the frozen `kpi-alerts` capability.
// Pure and dependency-light (kpi-period only). Tested in kpi-board.test.ts; the
// local mode of the MCP server runs a generated mirror (mcp-server/lib/kpi-board.js).
import { comparePeriods, parsePeriod, readingStatus } from './kpi-period.js';
/** Why a row has no verdict. */
export const NO_VERDICT_REASONS = ['no_reading', 'stale', 'no_direction', 'no_target', 'not_a_number'];
const STRENGTH = { strong: 3, medium: 2, weak: 1 };
/**
 * "1,4", "16.5", "1 250", "-20", "68 %", "1,250,000", "1.250,5" → a number.
 * No number rather than a wrong one: "1,250" may be 1.25 or 1250 depending on who
 * typed it, so it is not read; nor is anything with a unit or a sign like "≥".
 */
export function parseBoardNumber(raw) {
    if (typeof raw !== 'string')
        return null;
    const s = raw.replace(/[\s  ]/g, '').replace(/%$/, '').replace(/^−/, '-').replace(/^\+/, '');
    let plain = null;
    const one = /^(-?\d+)[.,](\d+)$/.exec(s);
    if (/^-?\d+$/.test(s))
        plain = s;
    else if (one) {
        // Three digits after a single separator: a thousands group for some, decimals for others.
        const whole = one[1].replace('-', '');
        const ambiguous = one[2].length === 3 && whole !== '0' && whole.length <= 3;
        plain = ambiguous ? null : `${one[1]}.${one[2]}`;
    }
    else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s))
        plain = s.replace(/,/g, '');
    else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s))
        plain = s.replace(/\./g, '').replace(',', '.');
    if (plain === null)
        return null;
    const n = Number(plain);
    return Number.isFinite(n) ? n : null;
}
const monthOf = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
/** First instant of a period, in UTC. */
const startOf = (p) => Date.UTC(p.year, p.kind === 'quarter' ? (p.index - 1) * 3 : p.index - 1, 1);
/** The `count` months ending with the last closed one, oldest first. */
function closedMonths(now, count) {
    const out = [];
    for (let back = count; back >= 1; back--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
        out.push(monthOf(d.getUTCFullYear(), d.getUTCMonth() + 1));
    }
    return out;
}
/** The quarter a month closes, or null: 2026-09 → 2026-Q3, 2026-08 → null. */
function quarterClosedBy(month) {
    const p = parsePeriod(month);
    if (!p || p.kind !== 'month' || p.index % 3 !== 0)
        return null;
    return `${p.year}-Q${p.index / 3}`;
}
function trendOf(previous, last, direction) {
    if (last === previous)
        return 'flat';
    const rising = last > previous;
    if (!direction)
        return rising ? 'up' : 'down';
    return rising === (direction === 'up') ? 'improving' : 'worsening';
}
export function buildKpiBoard(input, opts = {}) {
    const now = opts.now ?? new Date();
    const asked = typeof opts.months === 'number' && Number.isFinite(opts.months) ? Math.trunc(opts.months) : 6;
    const span = Math.min(12, Math.max(3, asked));
    // --- which objective each indicator measures, through the projects
    const projects = new Set(input.projectIds);
    const kpiIds = new Set(input.kpis.map((k) => k.id));
    const objectiveIds = new Set(input.objectives.map((o) => o.id));
    // project → objective → strength, project → kpi → strength
    const toObjective = new Map();
    const toKpi = new Map();
    for (const { a, b, strength } of input.links) {
        const s = STRENGTH[strength] ?? 0;
        if (s === 0)
            continue;
        for (const [x, y] of [[a, b], [b, a]]) {
            if (!projects.has(x))
                continue;
            const side = objectiveIds.has(y) ? toObjective : kpiIds.has(y) ? toKpi : null;
            if (!side)
                continue;
            if (!side.has(x))
                side.set(x, new Map());
            side.get(x).set(y, Math.max(side.get(x).get(y) ?? 0, s));
        }
    }
    /**
     * kpi → objective → weight of the best chain. A chain is as strong as its weaker link;
     * between two chains of equal weaker link, the stronger other link decides (a strong
     * and a medium link beat two medium ones). Without that second term "jobs delivered on
     * time" sat under the safety objective, ahead of the objective it literally measures.
     */
    const chains = new Map();
    for (const [project, kpis] of toKpi) {
        const objectives = toObjective.get(project);
        if (!objectives)
            continue;
        for (const [kpi, sk] of kpis) {
            for (const [objective, so] of objectives) {
                if (!chains.has(kpi))
                    chains.set(kpi, new Map());
                const best = chains.get(kpi);
                best.set(objective, Math.max(best.get(objective) ?? 0, Math.min(sk, so) * 10 + sk + so));
            }
        }
    }
    const objectiveOrder = new Map(input.objectives.map((o, i) => [o.id, i]));
    const titleOf = new Map(input.objectives.map((o) => [o.id, o.title]));
    // --- the months shown: from the first month that holds a reading, the last closed one included
    const closed = closedMonths(now, span);
    const current = monthOf(now.getUTCFullYear(), now.getUTCMonth() + 1);
    const lastClosed = closed[closed.length - 1];
    /**
     * The column a reading sits in: its month; for a quarter, the month that closes it, or the
     * running month while the quarter runs. Null for a period that has not begun (a typo): such a
     * reading is left out, it would otherwise be "the latest" and judge the indicator.
     */
    const columnOf = (period) => {
        const p = parsePeriod(period);
        if (!p || startOf(p) > now.getTime())
            return null;
        const column = p.kind === 'month' ? period : monthOf(p.year, p.index * 3);
        return column > current ? current : column;
    };
    const held = new Set();
    for (const k of input.kpis) {
        for (const r of k.readings) {
            const column = columnOf(r.period);
            if (column)
                held.add(column);
        }
    }
    const firstHeld = closed.findIndex((m) => held.has(m));
    const from = Math.min(firstHeld === -1 ? closed.length - 3 : firstHeld, closed.length - 3);
    const periods = closed.slice(Math.max(0, from));
    if (held.has(current))
        periods.push(current);
    const shown = new Set(periods);
    /** The last closed month that closes a quarter: where a quarterly reading is due. Always among the months shown. */
    const lastQuarterEnd = [...closed].reverse().find((m) => quarterClosedBy(m) !== null) ?? null;
    // --- rows
    const rowOf = (k) => {
        const readings = k.readings.filter((r) => columnOf(r.period) !== null).sort((a, b) => comparePeriods(a.period, b.period));
        const kindOf = (r) => parsePeriod(r.period).kind;
        const hasMonth = readings.some((r) => kindOf(r) === 'month');
        const hasQuarter = readings.some((r) => kindOf(r) === 'quarter');
        // The rhythm: what the definition says, else what the readings show (an agent's default period is the quarter).
        const rhythm = k.frequency ?? (hasQuarter && !hasMonth ? 'quarterly' : 'monthly');
        const wanted = rhythm === 'quarterly' ? 'quarter' : 'month';
        // The series the trend and the verdict are read on: one kind of period, never a month against a quarter.
        const seriesKind = readings.some((r) => kindOf(r) === wanted) ? wanted : wanted === 'quarter' ? 'month' : 'quarter';
        const series = readings.filter((r) => kindOf(r) === seriesKind);
        const latest = series[series.length - 1] ?? null;
        // What each column shows: the series first, readings of the other kind where it left a blank.
        const byColumn = new Map();
        for (const r of readings)
            if (kindOf(r) !== seriesKind)
                byColumn.set(columnOf(r.period), r);
        for (const r of series)
            byColumn.set(columnOf(r.period), r);
        // Due and missing: the last closed period of the rhythm, for an active indicator that existed before it began.
        const dueColumn = rhythm === 'quarterly' ? lastQuarterEnd : lastClosed;
        const duePeriod = dueColumn ? parsePeriod(rhythm === 'quarterly' ? quarterClosedBy(dueColumn) : dueColumn) : null;
        const created = k.createdAt ? new Date(k.createdAt).getTime() : null;
        const asksReading = k.active !== false && duePeriod !== null && (created === null || Number.isNaN(created) || created < startOf(duePeriod));
        const cells = periods.map((period) => {
            const r = byColumn.get(period);
            if (r)
                return { period, value: r.value, state: readingStatus(r.period, now), fromQuarter: kindOf(r) === 'quarter', isLatest: r.period === latest?.period };
            return { period, value: null, state: period === dueColumn && asksReading ? 'missing' : 'none', fromQuarter: false, isLatest: false };
        });
        // Trend and verdict rest on the latest reading, and only if the table shows it.
        const latestShown = latest !== null && shown.has(columnOf(latest.period));
        const last = latest ? parseBoardNumber(latest.value) : null;
        const previous = series.length >= 2 ? parseBoardNumber(series[series.length - 2].value) : null;
        const target = parseBoardNumber(k.target);
        const noVerdict = !latest
            ? 'no_reading'
            : !latestShown
                ? 'stale'
                : !k.direction
                    ? 'no_direction'
                    : k.target === null || k.target.trim() === ''
                        ? 'no_target'
                        : target === null || last === null
                            ? 'not_a_number'
                            : null;
        const onTarget = noVerdict === null ? (k.direction === 'up' ? last >= target : last <= target) : null;
        const measured = [...(chains.get(k.id)?.entries() ?? [])].sort((x, y) => y[1] - x[1] || objectiveOrder.get(x[0]) - objectiveOrder.get(y[0]));
        return {
            id: k.id,
            title: k.title,
            unit: k.unit,
            target: k.target,
            ownerName: k.ownerName,
            indicatorType: k.indicatorType,
            direction: k.direction,
            frequency: k.frequency,
            cells,
            latest: latest ? { period: latest.period, value: latest.value } : null,
            trend: latestShown && last !== null && previous !== null ? trendOf(previous, last, k.direction) : 'unknown',
            onTarget,
            noVerdict,
            alsoMeasures: measured.slice(1).map(([id]) => titleOf.get(id)),
        };
    };
    // --- groups: each indicator under the objective its strongest chain leads to
    const groups = input.objectives.map((objective) => ({ objective, rows: [] }));
    const unlinked = { objective: null, rows: [] };
    for (const k of input.kpis) {
        const measured = [...(chains.get(k.id)?.entries() ?? [])].sort((x, y) => y[1] - x[1] || objectiveOrder.get(x[0]) - objectiveOrder.get(y[0]));
        const home = measured[0] ? groups[objectiveOrder.get(measured[0][0])] : unlinked;
        home.rows.push(rowOf(k));
    }
    if (unlinked.rows.length > 0)
        groups.push(unlinked);
    const rows = groups.flatMap((g) => g.rows);
    return {
        periods,
        groups,
        summary: {
            kpis: rows.length,
            onTarget: rows.filter((r) => r.onTarget === true).length,
            offTarget: rows.filter((r) => r.onTarget === false).length,
            noVerdict: rows.filter((r) => r.onTarget === null).length,
            improving: rows.filter((r) => r.trend === 'improving').length,
            worsening: rows.filter((r) => r.trend === 'worsening').length,
            missing: rows.filter((r) => r.cells.some((c) => c.state === 'missing')).length,
        },
    };
}
