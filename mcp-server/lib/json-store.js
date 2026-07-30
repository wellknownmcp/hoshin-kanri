/**
 * JSON File Store for Hoshin Kanri local mode
 *
 * Provides CRUD operations backed by local JSON files.
 * No database, no server - just files on disk.
 */

import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { computeCompleteness } from './completeness.js';

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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.ideas.push(idea);
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

  async function getMatrix(matrixId) {
    const filePath = path.join(matricesDir, `${matrixId}.json`);
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
    const now = new Date().toISOString();
    const matrix = {
      id: randomUUID(),
      name: data.name,
      description: data.description ?? null,
      periodType: data.periodType ?? 'annual',
      periodStart: data.periodStart ?? null,
      periodEnd: data.periodEnd ?? null,
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
    return withLock(`matrix:${matrixId}`, async () => {
      const matrix = await getMatrix(matrixId);
      if (!matrix) throw new Error(`Matrix ${matrixId} not found`);
      matrix.elements ??= { north: [], east: [], south: [], west: [] };

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
        externalRef: data.externalRef ?? null,
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

  async function saveMatrix(matrix) {
    const filePath = path.join(matricesDir, `${matrix.id}.json`);
    return withLock(`matrix:${matrix.id}`, async () => {
      await writeJSON(filePath, matrix);
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
          found = el;
          break;
        }
      }

      if (!found) throw new Error(`Element ${elementId} not found in matrix ${matrixId}`);

      await saveMatrix(matrix);
      return found;
    });
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
  // PUBLIC API
  // ============================================

  return {
    initialize,

    // Ideas
    createIdea,
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

    // Completeness
    getCompleteness,

    // Summary
    getSummary,

    // Themes
    listThemes,
    getTheme,

    // Cadences
    getArchitecture,

    // Paths (for debugging)
    paths: { dataDir, matricesDir, ideasPath, themesPath, cadencesPath, configPath }
  };
}
