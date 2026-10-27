/**
 * Cascade group → BU → site: pure functions, no database.
 *
 * A matrix names its parent matrix (the level above); an element names the
 * element of that parent matrix it deploys. What the group decided to do this
 * year (its East and South) is what the level below has to take up.
 *
 * Mirror of src/lib/cascade.ts in the app; the parity test there runs both on
 * the same fixtures. Change one, change the other.
 */

/** Levels, root included: group → BU → site → workshop. */
export const MAX_CASCADE_DEPTH = 4;
export const DEPLOYABLE_QUADRANTS = ['east', 'south'];
export const ANCHORED_QUADRANTS = ['north', 'east'];

const INACTIVE = new Set(['cancelled', 'completed']);

function childrenMap(matrices) {
  const map = new Map();
  for (const m of matrices) {
    if (!m.parentMatrixId) continue;
    const list = map.get(m.parentMatrixId) ?? [];
    list.push(m.id);
    map.set(m.parentMatrixId, list);
  }
  return map;
}

/** Matrices above `id`, nearest first. Stops on a cycle instead of looping. */
export function ancestorsOf(matrices, id) {
  const byId = new Map(matrices.map((m) => [m.id, m]));
  const out = [];
  const seen = new Set([id]);
  let cur = byId.get(id)?.parentMatrixId ?? null;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = byId.get(cur)?.parentMatrixId ?? null;
  }
  return out;
}

function subtreeHeight(children, id, seen = new Set()) {
  if (seen.has(id)) return 0;
  seen.add(id);
  let max = 0;
  for (const c of children.get(id) ?? []) max = Math.max(max, subtreeHeight(children, c, seen));
  return 1 + max;
}

/** Why `childId` may not take `parentId` as parent, or null when it may. */
export function parentLinkError(matrices, childId, parentId) {
  if (childId === parentId) return 'SELF_PARENT';
  if (!matrices.some((m) => m.id === parentId)) return 'PARENT_NOT_FOUND';
  if (ancestorsOf(matrices, parentId).includes(childId)) return 'CASCADE_CYCLE';
  const others = matrices.map((m) => (m.id === childId ? { id: m.id, parentMatrixId: null } : m));
  const levelsAbove = 1 + ancestorsOf(others, parentId).length;
  const height = subtreeHeight(childrenMap(others), childId);
  if (levelsAbove + height > MAX_CASCADE_DEPTH) return 'CASCADE_TOO_DEEP';
  return null;
}

const ref = (e) => ({ id: e.id, title: e.title, quadrant: e.quadrant });
const isActive = (e) => !INACTIVE.has(e.status);
const pct = (num, den) => (den === 0 ? null : Math.round((num / den) * 100));

/** Analyse the subtree rooted at `rootId`. Returns null when the root is unknown. */
export function analyzeCascade(matrices, rootId) {
  const byId = new Map(matrices.map((m) => [m.id, m]));
  const root = byId.get(rootId);
  if (!root) return null;
  const children = childrenMap(matrices);

  const order = [];
  const seen = new Set();
  const queue = [{ m: root, depth: 0 }];
  while (queue.length) {
    const item = queue.shift();
    if (seen.has(item.m.id)) continue;
    seen.add(item.m.id);
    order.push(item);
    for (const cid of children.get(item.m.id) ?? []) {
      const c = byId.get(cid);
      if (c) queue.push({ m: c, depth: item.depth + 1 });
    }
  }

  const edges = [];
  let deployedTotal = 0;
  let deployableTotal = 0;
  for (const { m } of order) {
    const kids = (children.get(m.id) ?? []).map((id) => byId.get(id)).filter(Boolean);
    if (kids.length === 0) continue;
    const deployable = m.elements.filter((e) => isActive(e) && DEPLOYABLE_QUADRANTS.includes(e.quadrant));
    const deployed = [];
    const notDeployed = [];
    for (const p of deployable) {
      const takenUpBy = [];
      for (const k of kids) {
        for (const e of k.elements) {
          if (e.parentElementId === p.id && isActive(e)) {
            takenUpBy.push({ matrixId: k.id, matrixName: k.name, elementId: e.id, title: e.title, quadrant: e.quadrant });
          }
        }
      }
      if (takenUpBy.length) deployed.push({ ...ref(p), takenUpBy });
      else notDeployed.push(ref(p));
    }
    deployedTotal += deployed.length;
    deployableTotal += deployable.length;
    edges.push({
      parentId: m.id,
      parentName: m.name,
      children: kids.map((k) => ({ id: k.id, name: k.name })),
      coverage: pct(deployed.length, deployable.length),
      deployed,
      notDeployed,
    });
  }

  const unanchored = [];
  for (const { m } of order) {
    if (!m.parentMatrixId) continue;
    const parentIds = new Set((byId.get(m.parentMatrixId)?.elements ?? []).map((e) => e.id));
    const loose = m.elements.filter(
      (e) =>
        isActive(e) &&
        ANCHORED_QUADRANTS.includes(e.quadrant) &&
        !(e.parentElementId && parentIds.has(e.parentElementId)),
    );
    if (loose.length) unanchored.push({ matrixId: m.id, matrixName: m.name, elements: loose.map(ref) });
  }

  return {
    rootId,
    matrices: order.map(({ m, depth }) => ({ id: m.id, name: m.name, parentMatrixId: m.parentMatrixId, depth })),
    edges,
    unanchored,
    coverage: pct(deployedTotal, deployableTotal),
  };
}
