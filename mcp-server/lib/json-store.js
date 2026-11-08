/**
 * JSON File Store for Hoshin Kanri local mode
 *
 * Provides CRUD operations backed by local JSON files.
 * No database, no server - just files on disk.
 */

import { readFile, writeFile, rename, mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { computeCompleteness } from './completeness.js';
import { analyzeCascade, ancestorsOf, parentLinkError } from './cascade.js';
import { latestReading, readingStatus } from './remote-tools.js';
import { mergeKpiDefinition, mergeSheet } from './element-sheets.js';

const PARENT_LINK_MESSAGES = {
  SELF_PARENT: 'A matrix cannot be its own parent',
  PARENT_NOT_FOUND: 'Parent matrix not found',
  CASCADE_CYCLE: 'The parent matrix already sits below this one in the cascade',
  CASCADE_TOO_DEEP: 'A cascade has at most 4 levels (group, BU, site, workshop)',
};

const QUADRANT_KEYS = ['north', 'east', 'south', 'west'];

// Taken before any `matrix:<id>` lock by every write that checks or changes a
// cascade link, so a check and its write never interleave with another one.
const CASCADE_LOCK = 'cascade';

/**
 * Links to third-party tools on an element or an idea: a free label and a free reference,
 * 20 at most. Same limits as the hosted API (src/lib/external-links.ts).
 */
export function cleanLinks(value) {
  if (!Array.isArray(value)) throw new Error('links must be an array of { label, ref }');
  if (value.length > 20) throw new Error('links: 20 at most');
  return value.map((link, i) => {
    const label = typeof link?.label === 'string' ? link.label.trim() : '';
    const ref = typeof link?.ref === 'string' ? link.ref.trim() : '';
    if (!label || label.length > 80) throw new Error('links[' + i + '].label: 1 to 80 characters');
    if (!ref || ref.length > 500) throw new Error('links[' + i + '].ref: 1 to 500 characters');
    return { label, ref };
  });
}

/** A stored matrix as the cascade functions read it: one flat element list. */
function cascadeView(matrix) {
  return {
    id: matrix.id,
    name: matrix.name,
    parentMatrixId: matrix.parentMatrixId ?? null,
    elements: QUADRANT_KEYS.flatMap((q) =>
      (matrix.elements?.[q] ?? []).map((e) => ({
        id: e.id,
        quadrant: q,
        title: e.title,
        status: e.status ?? 'active',
        parentElementId: e.parentElementId ?? null,
      })),
    ),
  };
}

// In-process mutex serialising writes to the same file.
//
// Re-entrant on purpose: a locked section legitimately calls another helper that
// locks the same key (read-modify-write around saveMatrix). With a plain
// non-reentrant mutex the inner call waits for a lock its own caller holds and
// hangs forever — which is exactly what update_element_status did in local mode.
// AsyncLocalStorage carries the set of keys held by the current async context,
// so a nested acquisition of a key we already hold runs straight through.
const locks = new Map();
const heldKeys = new AsyncLocalStorage();

async function withLock(key, fn) {
  const held = heldKeys.getStore();
  if (held?.has(key)) return await fn();

  while (locks.get(key)) {
    await new Promise(r => setTimeout(r, 10));
  }
  locks.set(key, true);
  const next = new Set(held ?? []);
  next.add(key);
  try {
    return await heldKeys.run(next, fn);
  } finally {
    locks.delete(key);
  }
}

async function readJSON(filePath) {
  try {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeJSON(filePath, data) {
  const tmp = filePath + '.tmp';
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmp, filePath);
}

/**
 * Create a JSON store backed by a data directory.
 *
 * @param {Object} config
 * @param {string} config.dataDir - Path to the data directory
 * @returns {Object} store methods
 */
export function createJsonStore(config) {
  const dataDir = config.dataDir;
  const matricesDir = path.join(dataDir, 'matrices');

  const ideasPath = path.join(dataDir, 'ideas.json');
  const themesPath = path.join(dataDir, 'themes.json');
  const cadencesPath = path.join(dataDir, 'cadences.json');
  const meetingsPath = path.join(dataDir, 'meetings.json');
  const configPath = path.join(dataDir, 'config.json');

  // ============================================
  // INITIALIZATION
  // ============================================

  async function initialize() {
    // Create directories
    if (!existsSync(dataDir)) {
      await mkdir(dataDir, { recursive: true });
    }
    if (!existsSync(matricesDir)) {
      await mkdir(matricesDir, { recursive: true });
    }

    // Create default files if missing
    if (!existsSync(configPath)) {
      await writeJSON(configPath, {
        organizationName: 'Local Hoshin',
        defaultMatrixId: null,
        version: '1.0.0'
      });
    }
    if (!existsSync(ideasPath)) {
      await writeJSON(ideasPath, { ideas: [] });
    }
    if (!existsSync(themesPath)) {
      await writeJSON(themesPath, { themes: [] });
    }
    if (!existsSync(cadencesPath)) {
      await writeJSON(cadencesPath, { cadences: [] });
    }

    const cfg = await readJSON(configPath);
    console.error(`[json-store] Initialized: ${dataDir} (org: ${cfg.organizationName})`);
    return cfg;
  }

  // ============================================
  // IDEAS
  // ============================================

  async function createIdea(data) {
    return withLock('ideas', async () => {
      const store = await readJSON(ideasPath);
      const idea = {
        id: randomUUID(),
        title: data.title,
        description: data.description || null,
        priority: data.priority || 'medium',
        source: data.source || 'conversation',
        status: 'inbox',
        tags: data.tags || [],
        linkedElementId: data.linkedElementId || null,
        links: data.links !== undefined ? cleanLinks(data.links) : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.ideas.push(idea);
      await writeJSON(ideasPath, store);
      return idea;
    });
  }

  const IDEA_FIELDS = ['title', 'description', 'status', 'priority', 'linkedElementId', 'links'];
  // Same values the hosted API accepts (src/lib/enums.ts): local mode must not
  // store a status the kanban and the filters will never show.
  const IDEA_STATUSES = ['inbox', 'reviewing', 'accepted', 'rejected', 'implemented'];
  const IDEA_PRIORITIES = ['low', 'medium', 'high', 'critical'];

  /** Partial update of an idea (triage: status, priority, link to an element). */
  async function updateIdea(ideaId, data) {
    if (data.status !== undefined && !IDEA_STATUSES.includes(data.status)) {
      throw new Error(`Invalid status "${data.status}" (expected ${IDEA_STATUSES.join(' | ')})`);
    }
    if (data.priority !== undefined && !IDEA_PRIORITIES.includes(data.priority)) {
      throw new Error(`Invalid priority "${data.priority}" (expected ${IDEA_PRIORITIES.join(' | ')})`);
    }
    if (data.title !== undefined && String(data.title).trim() === '') {
      throw new Error('title cannot be empty');
    }
    if (data.links !== undefined) data = { ...data, links: cleanLinks(data.links) };
    return withLock('ideas', async () => {
      const store = await readJSON(ideasPath);
      const idea = (store.ideas || []).find(i => i.id === ideaId);
      if (!idea) throw new Error(`Idea ${ideaId} not found`);
      for (const key of IDEA_FIELDS) {
        if (data[key] !== undefined) idea[key] = data[key];
      }
      idea.updatedAt = new Date().toISOString();
      await writeJSON(ideasPath, store);
      return idea;
    });
  }

  async function listIdeas(filters = {}) {
    const store = await readJSON(ideasPath);
    let ideas = store.ideas || [];

    if (filters.status && filters.status !== 'all') {
      ideas = ideas.filter(i => i.status === filters.status);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      ideas = ideas.filter(i =>
        (i.title || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q)
      );
    }
    if (filters.priority && filters.priority !== 'all') {
      ideas = ideas.filter(i => i.priority === filters.priority);
    }
    if (filters.tags && filters.tags.length > 0) {
      ideas = ideas.filter(i => i.tags?.some(t => filters.tags.includes(t)));
    }

    const limit = filters.limit || 50;
    return { ideas: ideas.slice(0, limit), total: ideas.length };
  }

  // ============================================
  // MATRICES
  // ============================================

  async function listMatrices() {
    const files = existsSync(matricesDir) ? await readdir(matricesDir) : [];
    const matrices = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const matrix = await readJSON(path.join(matricesDir, file));
      if (matrix) matrices.push(matrix);
    }

    return matrices;
  }

  // A matrix id names a file under matricesDir: a model-supplied '../x' would
  // otherwise read (or, through saveMatrix, write) any *.json the user can reach.
  const isSafeMatrixId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
  function matrixPath(matrixId) {
    if (!isSafeMatrixId(matrixId)) throw new Error(`Invalid matrix id: ${String(matrixId).slice(0, 40)}`);
    return path.join(matricesDir, `${matrixId}.json`);
  }

  async function getMatrix(matrixId) {
    if (!isSafeMatrixId(matrixId)) return null; // same answer as an unknown id
    const filePath = matrixPath(matrixId);
    return await readJSON(filePath);
  }

  async function getDefaultMatrix() {
    const cfg = await readJSON(configPath);

    // If a default is set, try to load it
    if (cfg.defaultMatrixId) {
      const matrix = await getMatrix(cfg.defaultMatrixId);
      if (matrix) return matrix;
    }

    // Otherwise, return the first matrix found
    const matrices = await listMatrices();
    if (matrices.length > 0) {
      // Update config with this as default
      cfg.defaultMatrixId = matrices[0].id;
      await writeJSON(configPath, cfg);
      return matrices[0];
    }

    return null;
  }

  /** Create a matrix file and make it the default if it is the first one. */
  async function createMatrix(data) {
    if (data.parentMatrixId) return withLock(CASCADE_LOCK, () => createMatrixUnlocked(data));
    return createMatrixUnlocked(data);
  }

  async function createMatrixUnlocked(data) {
    if (data.parentMatrixId) {
      const nodes = (await listMatrices()).map(cascadeView);
      const err = parentLinkError([...nodes, { id: '__new__', parentMatrixId: null }], '__new__', data.parentMatrixId);
      if (err) throw new Error(PARENT_LINK_MESSAGES[err]);
    }
    const now = new Date().toISOString();
    const matrix = {
      id: randomUUID(),
      name: data.name,
      description: data.description ?? null,
      periodType: data.periodType ?? 'annual',
      periodStart: data.periodStart ?? null,
      periodEnd: data.periodEnd ?? null,
      parentMatrixId: data.parentMatrixId ?? null,
      status: 'active',
      elements: { north: [], east: [], south: [], west: [] },
      correlations: [],
      createdAt: now,
      updatedAt: now,
    };

    await saveMatrix(matrix);

    const cfg = (await readJSON(configPath)) ?? {};
    const existing = await listMatrices();
    if (data.isDefault || existing.length === 1 || !cfg.defaultMatrixId) {
      cfg.defaultMatrixId = matrix.id;
      await writeJSON(configPath, cfg);
    }

    return matrix;
  }

  /** Create an element, or patch it when elementId is given. */
  async function upsertElement(matrixId, elementId, data) {
    if (data.links !== undefined) data = { ...data, links: cleanLinks(data.links) };
    if (data.parentElementId) {
      return withLock(CASCADE_LOCK, () => upsertElementUnlocked(matrixId, elementId, data));
    }
    return upsertElementUnlocked(matrixId, elementId, data);
  }

  async function upsertElementUnlocked(matrixId, elementId, data) {
    return withLock(`matrix:${matrixId}`, async () => {
      const matrix = await getMatrix(matrixId);
      if (!matrix) throw new Error(`Matrix ${matrixId} not found`);
      matrix.elements ??= { north: [], east: [], south: [], west: [] };
      await assertParentElement(matrix, data.parentElementId);

      if (elementId) {
        const updated = await updateElement(matrixId, elementId, data);
        return { element: updated, created: false };
      }

      if (!data.quadrant) throw new Error('quadrant is required to create an element');
      if (!data.title) throw new Error('title is required to create an element');

      const bucket = (matrix.elements[data.quadrant] ??= []);
      const now = new Date().toISOString();
      const element = {
        id: randomUUID(),
        quadrant: data.quadrant,
        position: data.position ?? bucket.length,
        title: data.title,
        description: data.description ?? null,
        status: data.status ?? 'active',
        targetValue: data.targetValue ?? null,
        currentValue: data.currentValue ?? null,
        unit: data.unit ?? null,
        indicatorType: data.indicatorType ?? null,
        ownerId: data.ownerId ?? null,
        dueDate: data.dueDate ?? null,
        externalRef: data.externalRef ?? null,
        links: data.links ?? [],
        parentElementId: data.parentElementId ?? null,
        visibility: data.visibility ?? 'shared',
        createdAt: now,
        updatedAt: now,
      };
      bucket.push(element);
      matrix.updatedAt = now;
      await saveMatrix(matrix);
      return { element, created: true };
    });
  }

  /**
   * Set (or remove, with strength 'none') the correlation between two elements.
   * Stored with the same snake_case keys the score engine reads, and canonicalised
   * so a pair cannot end up recorded twice in opposite directions.
   */
  async function setCorrelation(matrixId, fromElementId, toElementId, strength) {
    return withLock(`matrix:${matrixId}`, async () => {
      const matrix = await getMatrix(matrixId);
      if (!matrix) throw new Error(`Matrix ${matrixId} not found`);
      matrix.correlations ??= [];

      const locate = (id) => {
        for (const quadrant of ['north', 'east', 'south', 'west']) {
          const found = (matrix.elements?.[quadrant] ?? []).find((e) => e.id === id);
          if (found) return { element: found, quadrant };
        }
        return null;
      };

      const a = locate(fromElementId);
      const b = locate(toElementId);
      if (!a) throw new Error(`Element ${fromElementId} not found in matrix ${matrixId}`);
      if (!b) throw new Error(`Element ${toElementId} not found in matrix ${matrixId}`);
      if (fromElementId === toElementId) throw new Error('A correlation needs two different elements');
      // Same rule as the hosted API (NOT_ADJACENT): only adjacent quadrants
      // correlate. Removal stays allowed, to clean up a pair stored before.
      const ADJACENT = { north: ['east', 'west'], east: ['north', 'south'], south: ['east', 'west'], west: ['south', 'north'] };
      if (strength && strength !== 'none' && !ADJACENT[a.quadrant].includes(b.quadrant)) {
        throw new Error('Correlations link adjacent quadrants only: north-east, east-south, south-west, west-north');
      }

      const samePair = (c) => {
        const ids = [c.from_element_id ?? c.fromElementId, c.to_element_id ?? c.toElementId];
        return ids.includes(fromElementId) && ids.includes(toElementId);
      };

      matrix.correlations = matrix.correlations.filter((c) => !samePair(c));

      let correlation = null;
      if (strength && strength !== 'none') {
        const [first, second] =
          fromElementId < toElementId ? [a, b] : [b, a];
        const [firstId, secondId] =
          fromElementId < toElementId ? [fromElementId, toElementId] : [toElementId, fromElementId];
        correlation = {
          from_element_id: firstId,
          to_element_id: secondId,
          from_quadrant: first.quadrant,
          to_quadrant: second.quadrant,
          strength,
        };
        matrix.correlations.push(correlation);
      }

      matrix.updatedAt = new Date().toISOString();
      await saveMatrix(matrix);
      return { correlation, removed: !correlation };
    });
  }

  function locateElement(matrix, elementId) {
    for (const quadrant of QUADRANT_KEYS) {
      const el = (matrix.elements?.[quadrant] ?? []).find((e) => e.id === elementId);
      if (el) return { el, quadrant };
    }
    return null;
  }

  /**
   * A KPI reading for a period, as the hosted API keeps it (kpi_measurements):
   * one per period, a second reading of the same period corrects it, and the
   * element's currentValue follows its latest period.
   */
  async function recordMeasurement(matrixId, elementId, { period, value, note, origin }) {
    return withLock(`matrix:${matrixId}`, async () => {
      const matrix = await getMatrix(matrixId);
      if (!matrix) throw new Error(`Matrix ${matrixId} not found`);
      const found = locateElement(matrix, elementId);
      if (!found) throw new Error(`Element ${elementId} not found in matrix ${matrixId}`);
      if (found.quadrant !== 'west') throw new Error('Readings are for KPIs');
      const now = new Date().toISOString();
      const rows = (found.el.measurements ??= []);
      const existing = rows.find((m) => m.period === period);
      // Same rule as the hosted route: the origin is replaced as a whole, and a new
      // value given without one was not read where the old one was.
      const originFields = origin ?? { originTool: null, originRef: null, extractedAt: null };
      const keepOrigin = !origin && existing?.value === value;
      if (existing) Object.assign(existing, { value, ...(note !== undefined ? { note } : {}), ...(keepOrigin ? {} : originFields), updatedAt: now });
      else rows.push({ period, value, note: note ?? null, ...originFields, createdAt: now, updatedAt: now });
      found.el.currentValue = latestReading(rows)?.value ?? found.el.currentValue ?? null;
      found.el.updatedAt = now;
      matrix.updatedAt = now;
      await saveMatrix(matrix);
      return { measurement: existing ?? rows[rows.length - 1], currentValue: found.el.currentValue };
    });
  }

  /**
   * The sheet of an initiative (south) or the definition of a KPI (west), changed
   * field by field (null clears): the 2026-11 field feedback sprint, lots B, C.
   */
  async function setElementSheet(elementId, kind, patch) {
    const where = await findElementMatrix(elementId);
    if (!where) throw new Error(`Element ${elementId} not found`);
    const matrixId = where.matrix.id;
    return withLock(`matrix:${matrixId}`, async () => {
      const matrix = await getMatrix(matrixId);
      const found = matrix && locateElement(matrix, elementId);
      if (!found) throw new Error(`Element ${elementId} not found`);
      if (kind === 'sheet' && found.quadrant !== 'south') throw new Error('NOT_AN_INITIATIVE: a sheet is for an initiative (south quadrant)');
      if (kind === 'kpiDefinition' && found.quadrant !== 'west') throw new Error('NOT_A_KPI: a definition is for a KPI (west quadrant)');
      if (kind === 'sheet' && patch.measuredBy && !(matrix.elements?.west || []).some((e) => e.id === patch.measuredBy)) {
        throw new Error('MEASURE_NOT_A_KPI: measuredBy must be a KPI (west element) of the same matrix');
      }
      const merged = kind === 'sheet' ? mergeSheet(found.el.sheet || {}, patch) : mergeKpiDefinition(found.el.kpiDefinition || {}, patch);
      if (!merged.ok) throw new Error(`${merged.code}: ${merged.message}`);
      found.el[kind] = merged.value;
      const now = new Date().toISOString();
      found.el.updatedAt = now;
      matrix.updatedAt = now;
      await saveMatrix(matrix);
      return { elementId, [kind]: merged.value };
    });
  }

  /** A progress update (percentage, comment or both), newest last in the file. */
  async function addElementUpdate(matrixId, elementId, { progress, comment }) {
    return withLock(`matrix:${matrixId}`, async () => {
      const matrix = await getMatrix(matrixId);
      if (!matrix) throw new Error(`Matrix ${matrixId} not found`);
      const found = locateElement(matrix, elementId);
      if (!found) throw new Error(`Element ${elementId} not found in matrix ${matrixId}`);
      if (progress !== undefined && found.quadrant === 'west') throw new Error('A KPI takes a reading, not a progress');
      const now = new Date().toISOString();
      const update = { progress: progress ?? null, comment: comment ?? null, createdAt: now };
      (found.el.updates ??= []).push(update);
      if (progress !== undefined) found.el.progress = progress;
      found.el.updatedAt = now;
      matrix.updatedAt = now;
      await saveMatrix(matrix);
      return { update, progress: found.el.progress ?? null };
    });
  }

  async function saveMatrix(matrix) {
    const filePath = matrixPath(matrix.id);
    return withLock(`matrix:${matrix.id}`, async () => {
      await writeJSON(filePath, matrix);
    });
  }

  /** The matrix that becomes the default when `formerId` stops being it: the oldest active root. */
  async function promoteDefault(formerId) {
    const cfg = (await readJSON(configPath)) ?? {};
    if (cfg.defaultMatrixId && cfg.defaultMatrixId !== formerId) return;
    const next = (await listMatrices())
      .filter((m) => m.id !== formerId && m.isActive !== false && !m.parentMatrixId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
    cfg.defaultMatrixId = next ? next.id : null;
    await writeJSON(configPath, cfg);
  }

  /** Archive (or bring back) a matrix, as PUT isActive does on the hosted API. */
  async function archiveMatrix(matrixId, archived) {
    const matrix = await withLock(`matrix:${matrixId}`, async () => {
      const m = await getMatrix(matrixId);
      if (!m) throw new Error(`Matrix ${matrixId} not found`);
      m.isActive = !archived;
      m.status = archived ? 'archived' : 'active';
      m.updatedAt = new Date().toISOString();
      await saveMatrix(m);
      return m;
    });
    if (archived) await promoteDefault(matrixId);
    return matrix;
  }

  /**
   * Delete a matrix file. What pointed at it lets go, as the hosted foreign keys do
   * (SET NULL): child matrices lose their parent, their elements the link to its elements.
   */
  async function deleteMatrix(matrixId) {
    return withLock(CASCADE_LOCK, async () => {
      const matrix = await getMatrix(matrixId);
      if (!matrix) throw new Error(`Matrix ${matrixId} not found`);
      for (const child of await listMatrices()) {
        if (child.parentMatrixId !== matrixId) continue;
        await withLock(`matrix:${child.id}`, async () => {
          const fresh = await getMatrix(child.id);
          fresh.parentMatrixId = null;
          for (const q of QUADRANT_KEYS) for (const el of fresh.elements?.[q] ?? []) el.parentElementId = null;
          await saveMatrix(fresh);
        });
      }
      await withLock(`matrix:${matrixId}`, () => unlink(matrixPath(matrixId)));
      await promoteDefault(matrixId);
      return { id: matrix.id, name: matrix.name };
    });
  }

  /** Delete an element with its correlations; elements below that deployed it let go. */
  async function deleteElement(matrixId, elementId) {
    return withLock(CASCADE_LOCK, async () => {
      const removed = await withLock(`matrix:${matrixId}`, async () => {
        const matrix = await getMatrix(matrixId);
        if (!matrix) throw new Error(`Matrix ${matrixId} not found`);
        const found = locateElement(matrix, elementId);
        if (!found) throw new Error(`Element ${elementId} not found in matrix ${matrixId}`);
        matrix.elements[found.quadrant] = matrix.elements[found.quadrant].filter((e) => e.id !== elementId);
        matrix.correlations = (matrix.correlations || []).filter(
          (c) => c.from_element_id !== elementId && c.to_element_id !== elementId,
        );
        matrix.updatedAt = new Date().toISOString();
        await saveMatrix(matrix);
        return { id: elementId, title: found.el.title, quadrant: found.quadrant, matrixId };
      });
      for (const child of await listMatrices()) {
        if (child.parentMatrixId !== matrixId) continue;
        await withLock(`matrix:${child.id}`, async () => {
          const fresh = await getMatrix(child.id);
          let changed = false;
          for (const q of QUADRANT_KEYS) {
            for (const el of fresh.elements?.[q] ?? []) {
              if (el.parentElementId === elementId) { el.parentElementId = null; changed = true; }
            }
          }
          if (changed) await saveMatrix(fresh);
        });
      }
      return removed;
    });
  }

  async function updateElement(matrixId, elementId, updates) {
    return withLock(`matrix:${matrixId}`, async () => {
      const matrix = await getMatrix(matrixId);
      if (!matrix) throw new Error(`Matrix ${matrixId} not found`);

      let found = null;
      for (const quadrant of ['north', 'east', 'south', 'west']) {
        const elements = matrix.elements?.[quadrant] || [];
        const el = elements.find(e => e.id === elementId);
        if (el) {
          Object.assign(el, updates, { updatedAt: new Date().toISOString() });
          // The bucket is the quadrant everything else reads (score, cascade):
          // a changed quadrant field alone would leave the element where it was.
          if (updates.quadrant && updates.quadrant !== quadrant && QUADRANT_KEYS.includes(updates.quadrant)) {
            matrix.elements[quadrant] = elements.filter(e => e.id !== elementId);
            (matrix.elements[updates.quadrant] ??= []).push(el);
            // Same rule as the hosted move (lib/element-move.ts): its links follow it,
            // those no longer adjacent go. The score filters on these quadrant fields.
            const NEIGHBOURS = { north: ['east', 'west'], east: ['north', 'south'], south: ['east', 'west'], west: ['north', 'south'] };
            matrix.correlations = (matrix.correlations || []).flatMap((c) => {
              const next = { ...c };
              if (c.from_element_id === elementId) next.from_quadrant = updates.quadrant;
              if (c.to_element_id === elementId) next.to_quadrant = updates.quadrant;
              const touched = c.from_element_id === elementId || c.to_element_id === elementId;
              return touched && !NEIGHBOURS[next.from_quadrant]?.includes(next.to_quadrant) ? [] : [next];
            });
          }
          found = el;
          break;
        }
      }

      if (!found) throw new Error(`Element ${elementId} not found in matrix ${matrixId}`);

      await saveMatrix(matrix);
      return found;
    });
  }

  /** The element an element deploys must sit in the parent matrix of its own matrix. */
  async function assertParentElement(matrix, parentElementId) {
    if (!parentElementId) return;
    if (!matrix.parentMatrixId) {
      throw new Error('This matrix has no parent matrix: set one before linking elements to it');
    }
    const parent = await getMatrix(matrix.parentMatrixId);
    const found = parent && cascadeView(parent).elements.some((e) => e.id === parentElementId);
    if (!found) throw new Error('Parent element not found in the parent matrix');
  }

  /** Attach a matrix under another, or detach it with a null parent. */
  async function setMatrixParent(matrixId, parentMatrixId) {
    return withLock(CASCADE_LOCK, () => setMatrixParentUnlocked(matrixId, parentMatrixId));
  }

  async function setMatrixParentUnlocked(matrixId, parentMatrixId) {
    if (parentMatrixId) {
      const nodes = (await listMatrices()).map(cascadeView);
      if (!nodes.some((m) => m.id === matrixId)) throw new Error(`Matrix ${matrixId} not found`);
      const err = parentLinkError(nodes, matrixId, parentMatrixId);
      if (err) throw new Error(PARENT_LINK_MESSAGES[err]);
    }
    const parent = parentMatrixId ? await getMatrix(parentMatrixId) : null;
    const parentIds = new Set(parent ? cascadeView(parent).elements.map((e) => e.id) : []);
    return withLock(`matrix:${matrixId}`, async () => {
      const matrix = await getMatrix(matrixId);
      if (!matrix) throw new Error(`Matrix ${matrixId} not found`);
      matrix.parentMatrixId = parentMatrixId ?? null;
      // Links to the old parent's elements no longer mean anything.
      for (const q of QUADRANT_KEYS) {
        for (const e of matrix.elements?.[q] ?? []) {
          if (e.parentElementId && !parentIds.has(e.parentElementId)) e.parentElementId = null;
        }
      }
      matrix.updatedAt = new Date().toISOString();
      await saveMatrix(matrix);
      return matrix;
    });
  }

  /** The cascade below a matrix, plus the matrices above it. */
  async function getCascade(matrixId) {
    const views = (await listMatrices()).map(cascadeView);
    const analysis = analyzeCascade(views, matrixId);
    if (!analysis) throw new Error(`Matrix ${matrixId} not found`);
    const names = new Map(views.map((m) => [m.id, m.name]));
    const ancestors = ancestorsOf(views, matrixId).map((id) => ({ id, name: names.get(id) ?? '' }));
    return { ...analysis, ancestors };
  }

  async function findElementMatrix(elementId) {
    const matrices = await listMatrices();
    for (const matrix of matrices) {
      for (const quadrant of ['north', 'east', 'south', 'west']) {
        const elements = matrix.elements?.[quadrant] || [];
        const found = elements.find(e => e.id === elementId);
        if (found) {
          return { matrix, element: found, quadrant };
        }
      }
    }
    return null;
  }

  // ============================================
  // COMPLETENESS
  // ============================================

  async function getCompleteness(matrixId) {
    let matrix;
    if (matrixId) {
      matrix = await getMatrix(matrixId);
    } else {
      matrix = await getDefaultMatrix();
    }

    if (!matrix) {
      throw new Error('No matrix found. Create a matrix first.');
    }

    return computeCompleteness(matrix);
  }

  // ============================================
  // SUMMARY (exports-like)
  // ============================================

  async function getSummary() {
    const matrices = await listMatrices();
    const ideasStore = await readJSON(ideasPath);
    const ideas = ideasStore.ideas || [];

    const ideasByStatus = {};
    for (const idea of ideas) {
      ideasByStatus[idea.status] = (ideasByStatus[idea.status] || 0) + 1;
    }

    return {
      overview: {
        totalMatrices: matrices.length,
        totalIdeas: ideas.length,
        ideasByStatus
      },
      aiPromptContext: `${matrices.length} matrice(s), ${ideas.length} idée(s) dans l'inbox.`
    };
  }

  // ============================================
  // THEMES
  // ============================================

  async function listThemes() {
    const store = await readJSON(themesPath);
    return store.themes || [];
  }

  async function getTheme(themeId) {
    const store = await readJSON(themesPath);
    const theme = (store.themes || []).find(t => t.id === themeId);
    if (!theme) return null;

    // Resolve element UUIDs to actual element data
    const matrices = await listMatrices();
    const elementMap = new Map();
    for (const matrix of matrices) {
      for (const quadrant of ['north', 'east', 'south', 'west']) {
        for (const el of (matrix.elements?.[quadrant] || [])) {
          elementMap.set(el.id, { ...el, quadrant });
        }
      }
    }

    const resolved = { north: [], east: [], south: [], west: [] };
    for (const link of (theme.elementLinks || [])) {
      const el = elementMap.get(link.elementId);
      if (el) {
        const q = link.quadrant || el.quadrant;
        if (resolved[q]) resolved[q].push(el);
      }
    }

    return { ...theme, elements: resolved };
  }

  // ============================================
  // CADENCES / ARCHITECTURE
  // ============================================

  async function getArchitecture() {
    const store = await readJSON(cadencesPath);
    const cadences = store.cadences || [];

    const levelOrder = ['strategic', 'tactical', 'operational_mgmt', 'team_mgmt', 'execution'];
    const byLevel = {};

    for (const level of levelOrder) {
      byLevel[level] = cadences.filter(c => c.level === level);
    }

    return {
      total: cadences.length,
      levelsCovered: levelOrder.filter(l => byLevel[l].length > 0).length,
      totalLevels: levelOrder.length,
      byLevel
    };
  }

  // ============================================
  // REVIEWS AND AGENDA (docs/sprint-cadencement-agent.md)
  // ============================================

  /** A real calendar day, YYYY-MM-DD (2026-02-31 is not one): what the API's z.string().date() accepts. */
  function isCalendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }

  async function readMeetings() {
    if (!existsSync(meetingsPath)) return [];
    return (await readJSON(meetingsPath)).meetings || [];
  }

  async function scheduleReview({ cadenceId, date, matrixId }) {
    if (!isCalendarDate(date)) throw new Error('date must be a calendar date, YYYY-MM-DD');
    const cadences = (await readJSON(cadencesPath)).cadences || [];
    if (!cadences.some((c) => c.id === cadenceId)) throw new Error('Cadence not found');
    if (matrixId && !(await listMatrices()).some((m) => m.id === matrixId)) throw new Error('Matrix not found');
    return withLock('meetings', async () => {
      const meetings = await readMeetings();
      const twin = meetings.find((m) => m.cadenceId === cadenceId && m.scheduledDate === date && m.status === 'scheduled');
      if (twin) throw new Error(`MEETING_ALREADY_SCHEDULED: this cadence already has a review scheduled on ${date} (${twin.id})`);
      const review = {
        id: randomUUID(),
        cadenceId,
        scheduledDate: date,
        actualDate: null,
        status: 'scheduled',
        matrixId: matrixId || null,
        notes: null,
        decisions: null,
        discussedElements: [],
        createdAt: new Date().toISOString(),
      };
      meetings.push(review);
      await writeJSON(meetingsPath, { meetings });
      return review;
    });
  }

  /** The state of a matrix a review saw (mirror of src/lib/review-snapshot.ts). */
  async function snapshotOf(matrixId, takenAt) {
    const matrix = matrixId ? await getMatrix(matrixId) : await getDefaultMatrix();
    if (!matrix) return null;
    const elements = [];
    for (const quadrant of ['north', 'east', 'south', 'west']) {
      for (const el of matrix.elements?.[quadrant] || []) {
        const reading = quadrant === 'west' ? latestReading(el.measurements || []) : null;
        const sheet = quadrant === 'south' ? el.sheet || {} : {};
        elements.push({
          id: el.id,
          quadrant,
          title: el.title,
          status: el.status || 'active',
          visibility: el.visibility === 'internal' ? 'internal' : 'shared',
          targetValue: el.targetValue ?? null,
          currentValue: el.currentValue ?? null,
          unit: el.unit ?? null,
          progress: el.progress ?? null,
          health: sheet.health ?? null,
          healthNote: sheet.healthNote ?? null,
          reading: reading ? { period: reading.period, value: reading.value, status: readingStatus(reading.period, takenAt) } : null,
        });
      }
    }
    return {
      version: 1,
      takenAt: takenAt.toISOString(),
      matrix: { id: matrix.id, name: matrix.name },
      score: computeCompleteness(matrix).score,
      // Same count as the hosted snapshot: links whose two ends are in the matrix.
      correlations: (matrix.correlations || []).filter((c) => elements.some((e) => e.id === c.from_element_id) && elements.some((e) => e.id === c.to_element_id)).length,
      elements,
    };
  }

  async function getReview(reviewId) {
    const review = (await readMeetings()).find((m) => m.id === reviewId);
    if (!review) throw new Error('Meeting not found');
    const { matrixSnapshot, ...rest } = review;
    return { review: { ...rest, hasSnapshot: matrixSnapshot != null }, snapshot: matrixSnapshot ?? null };
  }

  // Same values as the API's cadenceFields (src/lib/api-contract/schemas.ts).
  const CADENCE_ENUMS = {
    type: ['strategic', 'annual', 'qbr', 'monthly', 'weekly', 'daily', 'catchball'],
    frequency: ['yearly', 'quarterly', 'monthly', 'weekly', 'daily'],
    operationalLevel: ['strategic', 'tactical', 'operational_mgmt', 'team_mgmt', 'execution'],
  };
  const QUADRANT_NAMES = ['north', 'east', 'south', 'west'];

  function cadenceError(fields) {
    for (const [k, allowed] of Object.entries(CADENCE_ENUMS)) {
      if (fields[k] !== undefined && !allowed.includes(fields[k])) return `${k} must be one of ${allowed.join(', ')}`;
    }
    if (fields.name !== undefined && (typeof fields.name !== 'string' || !fields.name.trim() || fields.name.trim().length > 100)) return 'name must be 1 to 100 characters';
    if (fields.primaryQuadrant != null && !QUADRANT_NAMES.includes(fields.primaryQuadrant)) return 'primary_quadrant must be a quadrant';
    if (fields.trackedQuadrants !== undefined && (!Array.isArray(fields.trackedQuadrants) || fields.trackedQuadrants.some((q) => !QUADRANT_NAMES.includes(q)))) return 'tracked_quadrants must be quadrants';
    if (fields.durationMinutes !== undefined && !(Number.isInteger(fields.durationMinutes) && fields.durationMinutes >= 1 && fields.durationMinutes <= 1440)) return 'duration_minutes must be 1 to 1440';
    if (fields.scopeDescription != null && (typeof fields.scopeDescription !== 'string' || fields.scopeDescription.length > 10000)) return 'scope_description is too long';
    return null;
  }

  /** Create a cadence, or change the one named by `id`. Same fields and bounds as the API. */
  async function upsertCadence(id, fields) {
    const invalid = cadenceError(fields);
    if (invalid) throw new Error(`VALIDATION_ERROR: ${invalid}`);
    if (typeof fields.name === 'string') fields = { ...fields, name: fields.name.trim() };
    return withLock('cadences', async () => {
      const store = await readJSON(cadencesPath);
      const cadences = store.cadences || [];
      if (fields.parentCadenceId) {
        if (fields.parentCadenceId === id) throw new Error('SELF_PARENT: a cadence cannot be its own parent');
        if (!cadences.some((c) => c.id === fields.parentCadenceId)) throw new Error('PARENT_NOT_FOUND: parent cadence not found');
        const parentOf = new Map(cadences.map((c) => [c.id, c.parentCadenceId || null]));
        for (let at = fields.parentCadenceId, n = 0; at && n <= cadences.length; at = parentOf.get(at), n++) {
          if (at === id) throw new Error('CADENCE_CYCLE: the parent cadence already sits below this one');
        }
      }
      const now = new Date().toISOString();
      let cadence;
      if (id) {
        cadence = cadences.find((c) => c.id === id);
        if (!cadence) throw new Error('Cadence not found');
        Object.assign(cadence, fields, { updatedAt: now });
      } else {
        for (const k of ['name', 'type', 'frequency', 'operationalLevel']) if (!fields[k]) throw new Error(`${k} is required`);
        cadence = { id: randomUUID(), trackedQuadrants: [], durationMinutes: 60, ...fields, createdAt: now, updatedAt: now };
        cadences.push(cadence);
      }
      // getArchitecture groups by `level`, the field of the first local files.
      if (cadence.operationalLevel) cadence.level = cadence.operationalLevel;
      await writeJSON(cadencesPath, { ...store, cadences });
      return cadence;
    });
  }

  async function recordReview(reviewId, { notes, decisions, discussedElementIds, actualDate }) {
    const today = new Date().toISOString().slice(0, 10);
    if (actualDate !== undefined && actualDate !== null && actualDate !== '' && !isCalendarDate(actualDate)) {
      throw new Error('held_on must be a calendar date, YYYY-MM-DD');
    }
    if (actualDate && actualDate > today) throw new Error('DATE_IN_FUTURE: a review cannot be recorded as held in the future');
    return withLock('meetings', async () => {
      const meetings = await readMeetings();
      const review = meetings.find((m) => m.id === reviewId);
      if (!review) throw new Error('Meeting not found');
      if (review.status === 'completed') throw new Error('MEETING_ALREADY_COMPLETED: this meeting is already completed');
      if (review.status === 'cancelled') throw new Error('MEETING_CANCELLED: this meeting was cancelled');
      Object.assign(review, {
        status: 'completed',
        actualDate: actualDate || today,
        ...(notes !== undefined && { notes }),
        ...(decisions !== undefined && { decisions }),
        ...(discussedElementIds?.length && { discussedElements: [...new Set(discussedElementIds)] }),
      });
      review.matrixSnapshot = await snapshotOf(review.matrixId, new Date());
      await writeJSON(meetingsPath, { meetings });
      const { matrixSnapshot, ...rest } = review;
      return { ...rest, hasSnapshot: matrixSnapshot != null };
    });
  }

  /** What computeAgenda (lib/agenda.js) needs, from the files. No action items in the local mode. */
  async function getAgendaInput(matrixId) {
    const rawCadences = (await readJSON(cadencesPath)).cadences || [];
    const cadences = rawCadences
      .filter((c) => c.id && c.name)
      .map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type || c.frequency || 'monthly',
        frequency: c.frequency || 'monthly',
        operationalLevel: c.operationalLevel || c.level || 'tactical',
        parentCadenceId: c.parentCadenceId || null,
        trackedQuadrants: c.trackedQuadrants || (c.primaryQuadrant ? [c.primaryQuadrant] : []),
        trackedKpis: c.trackedKpis || [],
        createdAt: c.createdAt || '1970-01-01T00:00:00.000Z',
      }));
    const reviews = (await readMeetings()).map((m) => ({
      id: m.id,
      cadenceId: m.cadenceId,
      scheduledDate: m.scheduledDate,
      actualDate: m.actualDate || null,
      status: m.status,
      matrixId: m.matrixId || null,
      notes: m.notes ?? null,
      decisions: m.decisions ?? null,
      createdAt: m.createdAt || '1970-01-01T00:00:00.000Z',
    }));
    const kpis = [];
    const initiatives = [];
    for (const matrix of await listMatrices()) {
      if (matrix.isActive === false || (matrixId && matrix.id !== matrixId)) continue;
      const active = (q) => (matrix.elements?.[q] || []).filter((el) => (el.status || 'active') === 'active');
      const base = (el) => ({ id: el.id, title: el.title, matrixId: matrix.id, matrixName: matrix.name, createdAt: el.createdAt || matrix.createdAt || '1970-01-01T00:00:00.000Z' });
      for (const el of active('west')) kpis.push({ ...base(el), latestPeriod: latestReading(el.measurements || [])?.period ?? null });
      for (const el of active('south')) {
        const updates = el.updates || [];
        initiatives.push({ ...base(el), progress: el.progress ?? null, lastUpdateAt: updates.length ? updates[updates.length - 1].createdAt : null });
      }
    }
    return { cadences, reviews, kpis, initiatives, actions: [] };
  }

  // ============================================
  // PUBLIC API
  // ============================================

  return {
    initialize,

    // Ideas
    createIdea,
    updateIdea,
    listIdeas,

    // Matrices
    listMatrices,
    getMatrix,
    getDefaultMatrix,
    saveMatrix,
    createMatrix,
    upsertElement,
    setCorrelation,
    updateElement,
    findElementMatrix,
    recordMeasurement,
    addElementUpdate,
    setElementSheet,
    setMatrixParent,
    archiveMatrix,
    deleteMatrix,
    deleteElement,
    getCascade,

    // Completeness
    getCompleteness,

    // Summary
    getSummary,

    // Themes
    listThemes,
    getTheme,

    // Cadences
    getArchitecture,
    upsertCadence,

    // Reviews and agenda
    scheduleReview,
    recordReview,
    getReview,
    getAgendaInput,

    // Paths (for debugging)
    paths: { dataDir, matricesDir, ideasPath, themesPath, cadencesPath, meetingsPath, configPath }
  };
}
