// GENERATED from src/lib/external-view.ts by scripts/generate-xmatrix-svg-mirror.cjs: do not edit.
// The local mode (index-local.js) filters an external reading with it.

// What may leave the organization, for any reading meant for people outside it
// (docs/sprint-pages-de-repli.md, lot A): an agent preparing a deck for a board,
// the shared page of an initiative. Pure and dependency-free:
// mcp-server/lib/external-view.js is generated from this file
// (node scripts/generate-xmatrix-svg-mirror.cjs) so the local mode filters the same.
//
// Left out: elements marked internal and every correlation touching one; values,
// targets, units, execution links and free links; names (owner, sponsor, who does
// the next action); KPI readings, progress updates and KPI definitions; in a sheet,
// the blockers, the sentence behind the health and the resources. Kept: what each
// element is, its status and progress, and in a sheet why, the expected result,
// milestones, the next action (title, due date) and the health.
/** The part of an initiative sheet that may be shown outside; measuredBy only if that KPI is shown. */
export function externalSheet(sheet, shown) {
    if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet))
        return {};
    const s = sheet;
    const out = {};
    if (typeof s.why === 'string')
        out.why = s.why;
    if (typeof s.expectedResult === 'string')
        out.expectedResult = s.expectedResult;
    if (typeof s.measuredBy === 'string' && shown(s.measuredBy))
        out.measuredBy = s.measuredBy;
    if (Array.isArray(s.milestones))
        out.milestones = s.milestones.map((m) => ({ title: m.title, date: m.date ?? null, status: m.status }));
    if (s.nextAction && typeof s.nextAction === 'object' && typeof s.nextAction.title === 'string') {
        out.nextAction = { title: s.nextAction.title, due: s.nextAction.due ?? null };
    }
    if (typeof s.health === 'string')
        out.health = s.health;
    return out;
}
// parentElementId: the element above may be internal to the parent matrix; outside, the cascade is not shown.
const NULLED = ['targetValue', 'currentValue', 'unit', 'externalRef', 'owner', 'ownerId', 'ownerName', 'parentElementId'];
const DROPPED = ['measurements', 'kpiDefinition'];
/** One element as it may be shown outside. Keeps the shape: fields are nulled or emptied, not invented. */
export function externalElement(e, shown) {
    const out = { ...e };
    for (const k of NULLED)
        if (k in out)
            out[k] = null;
    for (const k of DROPPED)
        delete out[k];
    if ('links' in out)
        out.links = [];
    if ('updates' in out)
        out.updates = [];
    if ('sheet' in out)
        out.sheet = externalSheet(out.sheet, shown);
    return out;
}
/**
 * A matrix (export shape or local shape) as it may be shown outside. `endsOf`
 * gives the two element ids of a correlation, whatever its shape.
 */
export function externalMatrix(matrix, endsOf) {
    const quadrants = ['north', 'east', 'south', 'west'];
    const all = quadrants.flatMap((q) => matrix.elements?.[q] ?? []);
    const visible = new Set(all.filter((e) => e.visibility !== 'internal').map((e) => e.id));
    const shown = (id) => visible.has(id);
    const out = { ...matrix, hiddenElements: all.length - visible.size };
    if ('owner' in out)
        out.owner = null;
    if (matrix.elements) {
        const elements = {};
        for (const q of quadrants) {
            const list = matrix.elements[q];
            if (list)
                elements[q] = list.filter((e) => shown(e.id)).map((e) => externalElement(e, shown));
        }
        out.elements = elements;
    }
    if (matrix.correlations) {
        out.correlations = matrix.correlations.filter((c) => {
            const [a, b] = endsOf(c);
            return shown(a) && shown(b);
        });
    }
    return out;
}
