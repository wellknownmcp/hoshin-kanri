// GENERATED from src/lib/xmatrix-svg.ts by scripts/generate-xmatrix-svg-mirror.cjs: do not edit.
// The local mode (index-local.js) draws the X-Matrix picture with it.

// The X-Matrix as a standalone SVG picture, for a deck or a report
// (the 2026-11 field feedback sprint, lot D). Pure and dependency-free:
// mcp-server/lib/xmatrix-svg.js is generated from this file
// (node scripts/generate-xmatrix-svg-mirror.cjs) so the local mode draws the same.
//
// The layout is the one of the share canvas: North and South elements are rows,
// West and East elements are columns, and each corner grid carries a mark where
// a row meets a column they are correlated with. Every text is escaped, and
// characters XML forbids are dropped, so any title yields a valid file.
export const XMATRIX_SVG_LABELS = {
    en: {
        north: 'Long-term vision (3-5 years)',
        east: 'Annual objectives',
        south: 'Initiatives',
        west: 'Indicators',
        strong: 'strong',
        medium: 'medium',
        weak: 'weak',
        score: 'Completeness',
    },
    fr: {
        north: 'Vision à long terme (3-5 ans)',
        east: 'Objectifs annuels',
        south: 'Chantiers',
        west: 'Indicateurs',
        strong: 'fort',
        medium: 'moyen',
        weak: 'faible',
        score: 'Complétude',
    },
};
const CELL = 30;
const PAD = 24;
const HEADER = 58;
const LEGEND = 34;
const CENTER_W = 460;
const CENTER_H = 300;
const ROW_CHARS = 66;
const COL_CHARS = 42;
const FONT = 'Helvetica, Arial, sans-serif';
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#cbd5e1';
const BRAND = '#0f4c5c';
const MARK = '#b45309';
const TINT = {
    north: '#eef6f8',
    east: '#f4f1fb',
    south: '#f0f7f1',
    west: '#fdf6ec',
};
/** XML-safe text: escaped, and stripped of the characters XML 1.0 forbids. */
export function escapeXml(value) {
    return value
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
function clip(value, max) {
    const flat = value.replace(/\s+/g, ' ').trim();
    const chars = Array.from(flat);
    return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : flat;
}
/**
 * Up to `lines` lines of at most `max` characters, cut between words; the last
 * line is clipped with an ellipsis when the text does not fit. A word longer
 * than a line is cut.
 */
export function wrap(value, max, lines) {
    const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const out = [];
    let current = '';
    let i = 0;
    while (i < words.length && out.length < lines) {
        const word = words[i];
        const candidate = current ? `${current} ${word}` : word;
        if (Array.from(candidate).length <= max) {
            current = candidate;
            i++;
            continue;
        }
        if (!current) {
            // A word longer than a line: cut it.
            const chars = Array.from(word);
            out.push(chars.slice(0, max).join(''));
            words[i] = chars.slice(max).join('');
            continue;
        }
        out.push(current);
        current = '';
    }
    if (current && out.length < lines)
        out.push(current);
    if (i < words.length && out.length > 0) {
        const rest = [out[out.length - 1], ...words.slice(i)].join(' ');
        out[out.length - 1] = clip(rest, max);
    }
    return out;
}
function figures(e) {
    const unit = e.unit ? ` ${e.unit}` : '';
    if (e.currentValue && e.targetValue)
        return `${e.currentValue} / ${e.targetValue}${unit}`;
    if (e.currentValue)
        return `${e.currentValue}${unit}`;
    if (e.targetValue)
        return `→ ${e.targetValue}${unit}`;
    return '';
}
function mark(cx, cy, strength) {
    if (strength === 'strong')
        return `<circle cx="${cx}" cy="${cy}" r="7" fill="${MARK}"/>`;
    if (strength === 'medium')
        return `<circle cx="${cx}" cy="${cy}" r="6.5" fill="none" stroke="${MARK}" stroke-width="2.2"/>`;
    if (strength === 'weak') {
        return `<path d="M${cx} ${cy - 7} L${cx + 7} ${cy + 5} L${cx - 7} ${cy + 5} Z" fill="none" stroke="${MARK}" stroke-width="1.8"/>`;
    }
    return '';
}
function text(x, y, value, attrs = '') {
    return `<text x="${x}" y="${y}" font-family="${FONT}" ${attrs}>${escapeXml(value)}</text>`;
}
export function renderXMatrixSvg(input) {
    const labels = XMATRIX_SVG_LABELS[input.lang === 'en' ? 'en' : 'fr'];
    const by = { north: [], east: [], south: [], west: [] };
    for (const e of input.elements) {
        if (e.quadrant === 'north' || e.quadrant === 'east' || e.quadrant === 'south' || e.quadrant === 'west')
            by[e.quadrant].push(e);
    }
    const strength = new Map();
    for (const c of input.correlations) {
        if (c.strength === 'none')
            continue;
        strength.set(`${c.a}|${c.b}`, c.strength);
        strength.set(`${c.b}|${c.a}`, c.strength);
    }
    // Which quadrant sits where. "top" is the app's layout (vision on top, KPIs on
    // the left); "bottom" is the same matrix turned half a turn, as most templates
    // draw it (vision at the bottom, annual objectives on the left, initiatives on
    // top, KPIs on the right): lib/activation/orientation.ts, same names.
    const turned = input.orientation === 'bottom';
    const T = turned ? 'south' : 'north';
    const B = turned ? 'north' : 'south';
    const Lq = turned ? 'east' : 'west';
    const Rq = turned ? 'west' : 'east';
    const nN = Math.max(by[T].length, 1);
    const nS = Math.max(by[B].length, 1);
    const nW = Math.max(by[Lq].length, 1);
    const nE = Math.max(by[Rq].length, 1);
    const width = PAD * 2 + nW * CELL + CENTER_W + nE * CELL;
    const height = PAD * 2 + HEADER + nN * CELL + CENTER_H + nS * CELL + LEGEND;
    const x0 = PAD;
    const cx0 = x0 + nW * CELL; // center, left edge
    const cx1 = cx0 + CENTER_W; // center, right edge
    const y0 = PAD + HEADER;
    const cy0 = y0 + nN * CELL; // center, top edge
    const cy1 = cy0 + CENTER_H; // center, bottom edge
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`, `<rect width="${width}" height="${height}" fill="#ffffff"/>`);
    // Header: name, subtitle, score.
    out.push(text(PAD, PAD + 22, clip(input.title, 90), `font-size="22" font-weight="700" fill="${BRAND}"`));
    if (input.subtitle)
        out.push(text(PAD, PAD + 44, clip(input.subtitle, 120), `font-size="13" fill="${MUTED}"`));
    if (typeof input.score === 'number') {
        out.push(text(width - PAD, PAD + 22, `${labels.score} ${Math.round(input.score)}/100`, `font-size="15" font-weight="700" fill="${BRAND}" text-anchor="end"`));
    }
    // Bands.
    out.push(`<rect x="${cx0}" y="${y0}" width="${CENTER_W}" height="${nN * CELL}" fill="${TINT[T]}"/>`, `<rect x="${cx0}" y="${cy1}" width="${CENTER_W}" height="${nS * CELL}" fill="${TINT[B]}"/>`, `<rect x="${x0}" y="${cy0}" width="${nW * CELL}" height="${CENTER_H}" fill="${TINT[Lq]}"/>`, `<rect x="${cx1}" y="${cy0}" width="${nE * CELL}" height="${CENTER_H}" fill="${TINT[Rq]}"/>`);
    // Rows: the top band from the top down, the bottom one from the center down. A title that does
    // not fit on one line takes two, in a smaller size, before it is clipped.
    const row = (list, top) => {
        list.forEach((e, i) => {
            const y = top + i * CELL;
            out.push(`<line x1="${cx0}" y1="${y + CELL}" x2="${cx1}" y2="${y + CELL}" stroke="${LINE}"/>`);
            const lines = wrap(e.title, ROW_CHARS, 2);
            if (lines.length <= 1)
                out.push(text(cx0 + 8, y + CELL / 2 + 4, lines[0] ?? '', `font-size="12" fill="${INK}"`));
            else
                lines.forEach((l, k) => out.push(text(cx0 + 8, y + 12 + k * 12, l, `font-size="11" fill="${INK}"`)));
        });
    };
    row(by[T], y0);
    row(by[B], cy1);
    // Columns: left and right bands, text read bottom to top; figures on the KPIs only.
    const column = (list, left, withFigures) => {
        list.forEach((e, i) => {
            const x = left + i * CELL;
            out.push(`<line x1="${x + CELL}" y1="${cy0}" x2="${x + CELL}" y2="${cy1}" stroke="${LINE}"/>`);
            const extra = withFigures ? figures(e) : '';
            const ty = cy1 - 8;
            const oneLine = extra ? `${e.title} — ${extra}` : e.title;
            if (Array.from(oneLine.replace(/\s+/g, ' ').trim()).length <= COL_CHARS) {
                const tx = x + CELL / 2 + 4;
                out.push(text(tx, ty, oneLine, `font-size="12" fill="${INK}" transform="rotate(-90 ${tx} ${ty})"`));
            }
            else {
                // Two lines; the figures end the second one and are never clipped away.
                const tail = extra ? ` — ${extra}` : '';
                const [first = '', ...rest] = wrap(e.title, COL_CHARS, 2);
                const second = rest.length ? clip(rest.join(' '), Math.max(COL_CHARS - Array.from(tail).length, 8)) + tail : tail.replace(/^ — /, '');
                [first, second].filter(Boolean).forEach((l, k) => {
                    const tx = x + 12 + k * 12;
                    out.push(text(tx, ty, l, `font-size="11" fill="${INK}" transform="rotate(-90 ${tx} ${ty})"`));
                });
            }
        });
    };
    column(by[Lq], x0, input.showFigures && Lq === 'west');
    column(by[Rq], cx1, input.showFigures && Rq === 'west');
    // Corner grids, with a mark where a row and a column are correlated.
    const corner = (rows, rowTop, cols, colLeft, nRows, nCols) => {
        out.push(`<rect x="${colLeft}" y="${rowTop}" width="${nCols * CELL}" height="${nRows * CELL}" fill="#f8fafc" stroke="${LINE}"/>`);
        for (let i = 1; i < nRows; i++)
            out.push(`<line x1="${colLeft}" y1="${rowTop + i * CELL}" x2="${colLeft + nCols * CELL}" y2="${rowTop + i * CELL}" stroke="${LINE}"/>`);
        for (let j = 1; j < nCols; j++)
            out.push(`<line x1="${colLeft + j * CELL}" y1="${rowTop}" x2="${colLeft + j * CELL}" y2="${rowTop + nRows * CELL}" stroke="${LINE}"/>`);
        rows.forEach((r, i) => {
            cols.forEach((c, j) => {
                const s = strength.get(`${r.id}|${c.id}`);
                if (s)
                    out.push(mark(colLeft + j * CELL + CELL / 2, rowTop + i * CELL + CELL / 2, s));
            });
        });
    };
    corner(by[T], y0, by[Lq], x0, nN, nW);
    corner(by[T], y0, by[Rq], cx1, nN, nE);
    corner(by[B], cy1, by[Lq], x0, nS, nW);
    corner(by[B], cy1, by[Rq], cx1, nS, nE);
    // Center: the X and the four roles.
    out.push(`<rect x="${cx0}" y="${cy0}" width="${CENTER_W}" height="${CENTER_H}" fill="#ffffff" stroke="${INK}" stroke-width="1.5"/>`, `<line x1="${cx0}" y1="${cy0}" x2="${cx1}" y2="${cy1}" stroke="${INK}" stroke-width="1.5"/>`, `<line x1="${cx1}" y1="${cy0}" x2="${cx0}" y2="${cy1}" stroke="${INK}" stroke-width="1.5"/>`);
    const mx = (cx0 + cx1) / 2;
    const my = (cy0 + cy1) / 2;
    const role = (x, y, value) => text(x, y, value, `font-size="13" font-weight="700" fill="${BRAND}" text-anchor="middle"`);
    out.push(role(mx, cy0 + 40, labels[T]), role(mx, cy1 - 30, labels[B]), role(cx0 + 92, my + 5, labels[Lq]), role(cx1 - 92, my + 5, labels[Rq]));
    // Outer frame of the four bands.
    out.push(`<rect x="${x0}" y="${y0}" width="${width - PAD * 2}" height="${nN * CELL + CENTER_H + nS * CELL}" fill="none" stroke="${INK}" stroke-width="1.5"/>`);
    // Legend.
    const ly = height - PAD - 8;
    let lx = PAD;
    for (const s of ['strong', 'medium', 'weak']) {
        out.push(mark(lx + 7, ly - 4, s));
        out.push(text(lx + 20, ly, labels[s], `font-size="12" fill="${MUTED}"`));
        lx += 90;
    }
    out.push('</svg>');
    return out.join('\n');
}
export const SHEET_SVG_LABELS = {
    en: {
        owner: 'Owner',
        sponsor: 'Sponsor',
        progress: 'Progress',
        why: 'Why',
        expectedResult: 'Expected result',
        measuredBy: 'Measured by',
        milestones: 'Milestones',
        nextAction: 'Next action',
        blockers: 'Blockers and decisions needed',
        resources: 'Resources',
        health: { green: 'On track', amber: 'At risk', red: 'Off track' },
        status: { planned: 'planned', done: 'done', late: 'late' },
        none: 'Not filled in',
    },
    fr: {
        owner: 'Porteur',
        sponsor: 'Sponsor',
        progress: 'Avancement',
        why: 'Pourquoi',
        expectedResult: 'Résultat attendu',
        measuredBy: 'Mesuré par',
        milestones: 'Jalons',
        nextAction: 'Prochaine action',
        blockers: 'Blocages et arbitrages',
        resources: 'Ressources',
        health: { green: 'En bonne voie', amber: 'À surveiller', red: 'En difficulté' },
        status: { planned: 'prévu', done: 'atteint', late: 'en retard' },
        none: 'Non renseigné',
    },
};
const HEALTH_COLOR = { green: '#15803d', amber: '#b45309', red: '#b91c1c' };
const SHEET_W = 960;
const SHEET_H = 540;
export function renderInitiativeSheetSvg(input) {
    const L = SHEET_SVG_LABELS[input.lang === 'en' ? 'en' : 'fr'];
    const { initiative: it, external } = input;
    const sh = it.sheet;
    const out = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}" height="${SHEET_H}" viewBox="0 0 ${SHEET_W} ${SHEET_H}">`,
        `<rect width="${SHEET_W}" height="${SHEET_H}" fill="#ffffff"/>`,
        `<rect width="${SHEET_W}" height="6" fill="${BRAND}"/>`,
    ];
    out.push(text(PAD, 34, clip(input.matrixTitle, 110), `font-size="12" fill="${MUTED}"`));
    // Narrower when the weather and its sentence sit on the right of the title.
    const titleLines = wrap(it.title, sh.health ? 50 : 70, 2);
    titleLines.forEach((l, k) => out.push(text(PAD, 62 + k * 26, l, `font-size="22" font-weight="700" fill="${BRAND}"`)));
    let y = 62 + titleLines.length * 26;
    // Who, and how far.
    const people = [
        it.ownerName && !external ? `${L.owner} : ${it.ownerName}` : null,
        sh.sponsor && !external ? `${L.sponsor} : ${sh.sponsor}` : null,
        typeof it.progress === 'number' ? `${L.progress} : ${it.progress} %` : null,
    ].filter(Boolean);
    if (input.lang === 'en')
        for (let k = 0; k < people.length; k++)
            people[k] = people[k].replace(' : ', ': ').replace(' %', '%');
    if (people.length)
        out.push(text(PAD, y, clip(people.join('   ·   '), 120), `font-size="13" fill="${INK}"`));
    // Weather, top right.
    if (sh.health && HEALTH_COLOR[sh.health]) {
        const color = HEALTH_COLOR[sh.health];
        const label = L.health[sh.health];
        out.push(`<circle cx="${SHEET_W - PAD - 8}" cy="38" r="9" fill="${color}"/>`);
        out.push(text(SHEET_W - PAD - 24, 43, label, `font-size="14" font-weight="700" fill="${color}" text-anchor="end"`));
        wrap(external ? '' : sh.healthNote ?? '', 46, 3).forEach((l, k) => out.push(text(SHEET_W - PAD, 64 + k * 16, l, `font-size="12" fill="${INK}" text-anchor="end"`)));
    }
    y += 22;
    out.push(`<line x1="${PAD}" y1="${y}" x2="${SHEET_W - PAD}" y2="${y}" stroke="${LINE}"/>`);
    const top = y + 24;
    const colW = (SHEET_W - PAD * 3) / 2;
    const leftX = PAD;
    const rightX = PAD * 2 + colW;
    const chars = Math.floor(colW / 6.6);
    const block = (x, at, heading, body, maxLines) => {
        out.push(text(x, at, heading.toUpperCase(), `font-size="11" font-weight="700" fill="${BRAND}" letter-spacing="0.5"`));
        const lines = body ? wrap(body, chars, maxLines) : [L.none];
        lines.forEach((l, k) => out.push(text(x, at + 18 + k * 16, l, `font-size="13" fill="${body ? INK : MUTED}"`)));
        return at + 18 + lines.length * 16 + 14;
    };
    // Left: why, expected result (and its KPI), blockers, resources.
    let ly = block(leftX, top, L.why, sh.why ?? null, 4);
    const kpi = it.measuredBy;
    const kpiFigures = kpi && !external ? figures(kpi) : '';
    const result = [sh.expectedResult, kpi ? `${L.measuredBy} : ${kpi.title}${kpiFigures ? ` (${kpiFigures})` : ''}` : null].filter(Boolean).join(' — ');
    ly = block(leftX, ly, L.expectedResult, result || null, 4);
    if (!external) {
        ly = block(leftX, ly, L.blockers, sh.blockers ?? null, 4);
        block(leftX, ly, L.resources, sh.resources ?? null, 2);
    }
    // Right: milestones, next action.
    out.push(text(rightX, top, L.milestones.toUpperCase(), `font-size="11" font-weight="700" fill="${BRAND}" letter-spacing="0.5"`));
    let ry = top + 18;
    const milestones = sh.milestones ?? [];
    if (!milestones.length) {
        out.push(text(rightX, ry, L.none, `font-size="13" fill="${MUTED}"`));
        ry += 16;
    }
    for (const m of milestones) {
        const color = m.status === 'done' ? HEALTH_COLOR.green : m.status === 'late' ? HEALTH_COLOR.red : MUTED;
        out.push(m.status === 'done'
            ? `<circle cx="${rightX + 5}" cy="${ry - 4}" r="5" fill="${color}"/>`
            : `<circle cx="${rightX + 5}" cy="${ry - 4}" r="4.5" fill="none" stroke="${color}" stroke-width="1.6"/>`);
        const status = L.status[m.status] ?? m.status;
        const head = [m.date, status].filter(Boolean).join(' · ');
        out.push(text(rightX + 16, ry, clip(m.title, chars - 18), `font-size="13" fill="${INK}"`));
        out.push(text(rightX + colW, ry, head, `font-size="11" fill="${color}" text-anchor="end"`));
        ry += 20;
    }
    ry += 10;
    const na = sh.nextAction;
    const action = na ? [na.title, external ? null : na.owner, na.due].filter(Boolean).join(' — ') : null;
    block(rightX, ry, L.nextAction, action, 3);
    out.push('</svg>');
    return out.join('\n');
}
