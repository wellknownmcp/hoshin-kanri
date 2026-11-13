#!/usr/bin/env node
/**
 * Hoshin Kanri MCP Server - Local JSON mode (stdio)
 *
 * Zero-infrastructure mode: reads/writes local JSON files, no database or HTTP server needed.
 *
 * Configure in claude_desktop_config.json:
 * {
 *   "mcpServers": {
 *     "hoshin-kanri": {
 *       "command": "node",
 *       "args": ["/path/to/hoshin-kanri/mcp-server/index-local.js"],
 *       "env": {
 *         "HOSHIN_DATA_DIR": "/path/to/my-data"
 *       }
 *     }
 *   }
 * }
 *
 * If HOSHIN_DATA_DIR is not set, defaults to ~/hoshin-data/
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { Server } from '@modelcontextprotocol/server';
import { homedir } from 'node:os';
import path from 'node:path';

import { tools, getQuadrantLabel } from './lib/tool-definitions.js';
import { promptsList, getPromptMessages } from './lib/prompt-definitions.js';
import { elementBody, ideaUpdateBody, currentQuarter, comparePeriods, PERIOD_PATTERN, deletionConfirmed, readingOrigin, IMAGE_NOTE, sheetBody, kpiDefinitionBody, cadenceBody, readingStatus } from './lib/remote-tools.js';
import { renderInitiativeSheetSvg, renderXMatrixSvg } from './lib/xmatrix-svg.js';
import { externalMatrix } from './lib/external-view.js';
import { toolResult, viewPayload } from './lib/matrix-view.js';
import { asPng } from './lib/png.js';
import { computeCompleteness } from './lib/completeness.js';
import { createJsonStore } from './lib/json-store.js';
import { computeAgenda } from './lib/agenda.js';
import { VERSION } from './lib/version.js';
import { registerAgendaResource } from './lib/agenda-resource.js';
import { SERVER_INSTRUCTIONS, getHelp, localCapabilityReport } from './lib/help.js';

// ============================================
// CONFIGURATION
// ============================================

const dataDir = process.env.HOSHIN_DATA_DIR || path.join(homedir(), 'hoshin-data');
const store = createJsonStore({ dataDir });

// ============================================
// TOOL HANDLERS
// ============================================

/**
 * Matrices with the default first. Reads used to take matrices[0] in file
 * order while writes used the configured default: "show my matrix" and
 * "score my matrix" could land on two different matrices.
 */
async function orderedMatrices() {
  const [matrices, def] = await Promise.all([store.listMatrices(), store.getDefaultMatrix()]);
  const defaultId = def ? def.id : null;
  return matrices
    .map(m => ({ matrix: m, isDefault: m.id === defaultId }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

async function handleListMatrices(args) {
  const rows = (await orderedMatrices()).filter(
    ({ matrix: m }) => args.include_archived === true || m.isActive !== false
  );
  const matrices = rows.map(({ matrix: m, isDefault }) => ({
    id: m.id,
    name: m.name,
    isDefault,
    isActive: m.isActive !== false,
    parentMatrixId: m.parentMatrixId ?? null,
    periodType: m.periodType ?? null,
    elementCount: ['north', 'east', 'south', 'west'].reduce((n, q) => n + (m.elements?.[q]?.length || 0), 0)
  }));
  return { count: matrices.length, matrices };
}

async function handleUpdateIdea(args) {
  const { idea_id } = args;
  if (!idea_id) return { error: 'idea_id is required — find it with search_ideas' };
  const body = ideaUpdateBody(args);
  if (Object.keys(body).length === 0) {
    return { error: 'Nothing to update: pass status, priority, linked_element_id, title, description or links' };
  }
  if (body.linkedElementId && !(await store.findElementMatrix(body.linkedElementId))) {
    return { error: `Element "${body.linkedElementId}" not found in any matrix` };
  }
  try {
    const idea = await store.updateIdea(idea_id, body);
    return { success: true, message: `Idea "${idea.title}" updated`, idea };
  } catch (error) {
    return { error: error.message };
  }
}

async function handleAddIdea(args) {
  const { title, description, priority = 'medium', source = 'conversation', tags = [], linked_element_id, links } = args;

  if (!title || title.trim().length === 0) {
    return { error: 'Title is required' };
  }

  if (linked_element_id && !(await store.findElementMatrix(linked_element_id))) {
    return { error: `Element "${linked_element_id}" not found in any matrix` };
  }
  let idea;
  try {
    idea = await store.createIdea({ title, description, priority, source, tags, linkedElementId: linked_element_id, links });
  } catch (error) {
    return { error: error.message };
  }

  return {
    success: true,
    message: `Idea "${title}" added to inbox`,
    idea
  };
}

async function handleListObjectives(args) {
  const { quadrant = 'all', status = 'all', matrix_id } = args;

  const all = (await orderedMatrices()).map(r => r.matrix);
  const matrices = matrix_id ? all.filter(m => m.id === matrix_id) : all;
  if (matrix_id && matrices.length === 0) {
    return { error: `Matrix "${matrix_id}" not found — list_matrices gives the ids` };
  }

  if (matrices.length === 0) {
    return { message: 'No matrices found', objectives: [] };
  }

  const objectives = [];

  for (const matrix of matrices) {
    if (!matrix.elements) continue;

    const quadrants = quadrant === 'all'
      ? ['north', 'east', 'south', 'west']
      : [quadrant];

    for (const q of quadrants) {
      const elements = matrix.elements[q] || [];
      for (const el of elements) {
        if (status === 'all' || el.status === status) {
          objectives.push({
            ...el,
            quadrant: q,
            quadrantLabel: getQuadrantLabel(q),
            matrixId: matrix.id,
            matrixName: matrix.name
          });
        }
      }
    }
  }

  return { count: objectives.length, objectives };
}

async function handleGetMatrixSummary(args) {
  const { matrix_id, include_correlations = true } = args;

  const matrices = (await orderedMatrices()).map(r => r.matrix);
  const summary = await store.getSummary();
  const matrix = matrix_id
    ? matrices.find(m => m && m.id === matrix_id)
    : matrices[0];

  if (!matrix) {
    if (matrix_id) return { error: `Matrix "${matrix_id}" not found` };
    return {
      message: 'No X-Matrix found. Create your first matrix to get started.',
      ideasOverview: summary.overview
    };
  }

  const result = {
    matrixId: matrix.id,
    matrixName: matrix.name,
    year: matrix.year,
    status: matrix.status,
    owner: matrix.owner,
    elementCounts: {
      north: matrix.elements?.north?.length || 0,
      east: matrix.elements?.east?.length || 0,
      south: matrix.elements?.south?.length || 0,
      west: matrix.elements?.west?.length || 0
    },
    correlationsCount: matrix.correlations?.length || 0,
    ideasOverview: summary.overview,
    aiContext: summary.aiPromptContext
  };

  if (include_correlations && matrix.correlations) {
    result.keyCorrelations = matrix.correlations.slice(0, 5).map(c => ({
      from: c.fromTitle || c.from?.title || c.fromElementId,
      to: c.toTitle || c.to?.title || c.toElementId,
      strength: c.strength
    }));
  }

  return result;
}

async function handleGetMatrixData(args) {
  const { matrix_id, audience = 'internal' } = args;
  if (!['internal', 'external'].includes(audience)) return { error: 'audience must be "internal" or "external"' };

  const matrices = (await orderedMatrices()).map(r => r.matrix);
  const matrix = matrix_id
    ? matrices.find(m => m && m.id === matrix_id)
    : matrices[0];

  if (!matrix) {
    return { error: matrix_id ? `Matrix "${matrix_id}" not found` : 'No X-Matrix found. Create your first matrix to get started.' };
  }

  let completeness = null;
  try {
    completeness = await store.getCompleteness(matrix.id);
  } catch {
    // completeness is optional context — the full dataset is still useful without it
  }

  const full = {
    matrix: {
      id: matrix.id,
      name: matrix.name,
      year: matrix.year,
      status: matrix.status,
      owner: matrix.owner,
      parentMatrixId: matrix.parentMatrixId ?? null
    },
    quadrantLabels: {
      north: getQuadrantLabel('north'),
      east: getQuadrantLabel('east'),
      south: getQuadrantLabel('south'),
      west: getQuadrantLabel('west')
    },
    // Same history window as the hosted export: a KPI's last 8 readings, oldest
    // first, and each element's last 3 updates, newest first.
    elements: Object.fromEntries(
      ['north', 'east', 'south', 'west'].map((q) => [
        q,
        (matrix.elements?.[q] ?? []).map(({ measurements = [], updates = [], ...el }) => ({
          ...el,
          progress: el.progress ?? null,
          ...(q === 'south' && { sheet: el.sheet ?? {} }),
          ...(q === 'west' && { kpiDefinition: el.kpiDefinition ?? {} }),
          ...(q === 'west'
            ? {
                measurements: [...measurements]
                  .sort((a, b) => comparePeriods(a.period, b.period))
                  .slice(-8)
                  .map((m) => ({ period: m.period, value: m.value, status: readingStatus(m.period), originTool: m.originTool ?? null, extractedAt: m.extractedAt ?? null })),
              }
            : {}),
          updates: updates.slice(-3).reverse(),
        })),
      ]),
    ),
    correlations: matrix.correlations || [],
    completeness,
    audience
  };
  if (audience !== 'external') return full;
  // Same filter as the hosted export (lib/external-view.js, generated from the app's).
  const view = externalMatrix({ elements: full.elements, correlations: full.correlations }, (c) => [c.from_element_id, c.to_element_id]);
  return {
    ...full,
    matrix: { ...full.matrix, owner: null },
    elements: view.elements,
    correlations: view.correlations,
    hiddenElements: view.hiddenElements,
    completeness: computeCompleteness({ ...matrix, elements: view.elements, correlations: view.correlations }),
  };
}

async function handleCreateMatrix(args) {
  const { name, description, period_type, period_start, period_end, is_default, parent_matrix_id } = args;

  if (!name || name.trim().length === 0) {
    return { error: 'name is required' };
  }

  let matrix;
  try {
    matrix = await store.createMatrix({
      name: name.trim(),
      description: description ?? null,
      periodType: period_type ?? 'annual',
      periodStart: period_start ?? null,
      periodEnd: period_end ?? null,
      isDefault: is_default === true,
      parentMatrixId: parent_matrix_id || null,
    });
  } catch (error) {
    return { error: error.message };
  }

  return {
    success: true,
    message: `Matrix "${matrix.name}" created. Add elements with upsert_element, then wire them with set_correlation.`,
    matrix: { id: matrix.id, name: matrix.name, periodType: matrix.periodType, parentMatrixId: matrix.parentMatrixId },
  };
}

/** Resolve the matrix to write into: the one given, or the default. */
async function resolveMatrixId(matrixId) {
  if (matrixId) return matrixId;
  const matrix = await store.getDefaultMatrix();
  return matrix ? matrix.id : null;
}

async function handleUpsertElement(args) {
  const { matrix_id, element_id, quadrant, title } = args;

  if (!element_id && (!quadrant || !title)) {
    return { error: 'quadrant and title are required to create an element (or pass element_id to update one)' };
  }

  // Updating an element: it lives in its own matrix, which may not be the default one.
  let matrixId = matrix_id;
  if (!matrixId && element_id) {
    const found = await store.findElementMatrix(element_id);
    if (!found) return { error: `Element "${element_id}" not found in any matrix` };
    matrixId = found.matrix.id;
  }
  matrixId = await resolveMatrixId(matrixId);
  if (!matrixId) return { error: 'No matrix found. Create one first with create_matrix.' };

  const patch = elementBody(args);

  try {
    const { element, created } = await store.upsertElement(matrixId, element_id ?? null, patch);
    return {
      success: true,
      created,
      message: created
        ? `Element "${element.title}" created in ${getQuadrantLabel(element.quadrant)}`
        : `Element "${element.title}" updated`,
      element,
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function handleGetCascade(args) {
  const matrixId = await resolveMatrixId(args.matrix_id);
  if (!matrixId) return { error: 'No matrix found. Create one first with create_matrix.' };
  try {
    return await store.getCascade(matrixId);
  } catch (error) {
    return { error: error.message };
  }
}

async function handleSetMatrixParent(args) {
  const { matrix_id, parent_matrix_id } = args;
  if (!matrix_id) return { error: 'matrix_id is required' };
  try {
    const matrix = await store.setMatrixParent(matrix_id, parent_matrix_id || null);
    return {
      success: true,
      message: matrix.parentMatrixId ? `Matrix "${matrix.name}" attached under its parent` : `Matrix "${matrix.name}" detached`,
      matrix: { id: matrix.id, name: matrix.name, parentMatrixId: matrix.parentMatrixId },
    };
  } catch (error) {
    return { error: error.message };
  }
}

// the 2026-11 field feedback sprint, lot A: same answers as the hosted tools.
async function handleArchiveMatrix(args) {
  const { matrix_id, archived = true } = args;
  if (!matrix_id) return { error: 'matrix_id is required — find it with list_matrices (include_archived to see archived ones)' };
  try {
    const m = await store.archiveMatrix(matrix_id, archived !== false);
    return {
      success: true,
      message: archived === false ? `Matrix "${m.name}" is active again` : `Matrix "${m.name}" archived: its data is kept, list_matrices with include_archived shows it`,
      matrix: { id: m.id, name: m.name, isActive: m.isActive !== false },
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function handleDeleteMatrix(args) {
  const { matrix_id, confirm_name } = args;
  if (!matrix_id) return { error: 'matrix_id is required — find it with list_matrices' };
  if (typeof confirm_name !== 'string' || !confirm_name.trim()) {
    return { error: 'confirm_name is required: the exact name of the matrix. Deleting cannot be undone; archive_matrix keeps the data.' };
  }
  const matrix = await store.getMatrix(matrix_id);
  if (!matrix) return { error: `Matrix ${matrix_id} not found` };
  if (!deletionConfirmed(matrix.name, confirm_name)) {
    return { error: `CONFIRMATION_MISMATCH — confirm_name must be the exact name of the matrix, "${matrix.name}". Nothing was deleted.` };
  }
  try {
    const deleted = await store.deleteMatrix(matrix_id);
    return {
      success: true,
      message: `Matrix "${deleted.name}" deleted with its elements, correlations, readings and updates. Matrices below it are detached.`,
      deleted,
    };
  } catch (error) {
    return { error: error.message };
  }
}

async function handleDeleteElement(args) {
  const { element_id } = args;
  if (!element_id) return { error: 'element_id is required' };
  const found = await store.findElementMatrix(element_id);
  if (!found) return { error: `Element with id "${element_id}" not found in any matrix` };
  try {
    const deleted = await store.deleteElement(found.matrix.id, element_id);
    return {
      success: true,
      message: `Element "${deleted.title}" deleted from ${deleted.quadrant}, with its correlations, readings and updates`,
      deleted: { ...deleted, matrixName: found.matrix.name },
    };
  } catch (error) {
    return { error: error.message };
  }
}

// Lot D: the same picture as the hosted API, the same filter for "external"
// as lib/share-view.ts (no internal element nor its links, no figure).
async function handleExportMatrixImage(args) {
  const { matrix_id, audience = 'internal', lang = 'en', layout = 'matrix', orientation = 'bottom', format = 'svg' } = args;
  if (!['bottom', 'top'].includes(orientation)) return { error: 'orientation must be "bottom" or "top"' };
  if (!['svg', 'png'].includes(format)) return { error: 'format must be "svg" or "png"' };
  if (format === 'png') return asPng(await handleExportMatrixImage({ ...args, format: 'svg' }));
  if (!['internal', 'external'].includes(audience)) return { error: 'audience must be "internal" or "external"' };
  if (!['matrix', 'initiatives'].includes(layout)) return { error: 'layout must be "matrix" or "initiatives"' };
  if (!['en', 'fr'].includes(lang)) return { error: 'lang must be "en" or "fr"' };
  const matrix = matrix_id ? await store.getMatrix(matrix_id) : await store.getDefaultMatrix();
  if (!matrix) return { error: matrix_id ? `Matrix "${matrix_id}" not found` : 'No matrix found. Create a matrix first.' };
  const external = audience === 'external';
  const all = ['north', 'east', 'south', 'west'].flatMap((q) => (matrix.elements?.[q] ?? []).map((e) => ({ ...e, quadrant: q })));
  const shown = external ? all.filter((e) => e.visibility !== 'internal') : all;
  const ids = new Set(shown.map((e) => e.id));
  const links = (matrix.correlations || []).filter((c) => ids.has(c.from_element_id) && ids.has(c.to_element_id));
  const drawn = external ? shown.map((e) => ({ ...e, currentValue: null, targetValue: null, unit: null })) : shown;
  const base = String(matrix.name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x-matrix';
  const suffix = external ? '-external' : '';
  if (layout === 'initiatives') {
    const byId = new Map(drawn.map((e) => [e.id, e]));
    const pages = drawn
      .filter((e) => e.quadrant === 'south')
      .map((e, i) => {
        const sheet = e.sheet || {};
        const kpi = sheet.measuredBy ? byId.get(sheet.measuredBy) : null;
        return {
          elementId: e.id,
          title: e.title,
          filename: `${base}-${String(i + 1).padStart(2, '0')}${suffix}.svg`,
          svg: renderInitiativeSheetSvg({
            matrixTitle: matrix.name,
            lang,
            external,
            initiative: { id: e.id, title: e.title, ownerName: e.owner ?? null, progress: e.progress ?? null, sheet, measuredBy: kpi && kpi.quadrant === 'west' ? kpi : null },
          }),
        };
      });
    return { matrixId: matrix.id, mediaType: 'image/svg+xml', filename: `${base}-initiatives${suffix}.svg`, audience, layout, orientation, hiddenElements: all.length - shown.length, svg: null, pages, note: IMAGE_NOTE };
  }
  const byQuadrant = { north: [], east: [], south: [], west: [] };
  for (const e of drawn) byQuadrant[e.quadrant].push(e);
  const { score } = computeCompleteness({ ...matrix, elements: byQuadrant, correlations: links });
  const svg = renderXMatrixSvg({
    title: matrix.name,
    subtitle: null,
    elements: drawn,
    correlations: links.map((c) => ({ a: c.from_element_id, b: c.to_element_id, strength: c.strength })),
    showFigures: !external,
    lang,
    score,
    orientation,
  });
  return {
    matrixId: matrix.id,
    mediaType: 'image/svg+xml',
    filename: `${base}${suffix}.svg`,
    audience,
    layout,
    orientation,
    hiddenElements: all.length - shown.length,
    svg,
    note: IMAGE_NOTE,
  };
}

/** show_matrix in local mode: the same view, from the files (docs/sprint-pages-de-repli.md, lot C). */
async function handleShowMatrix(args) {
  const { matrix_id, audience = 'internal', orientation = 'bottom', lang = 'en' } = args;
  const image = await handleExportMatrixImage({ matrix_id, audience, orientation, lang });
  if (image.error) return image;
  const data = await handleGetMatrixData({ matrix_id: image.matrixId, audience });
  if (data.error) return data;
  const view = viewPayload({
    matrix: data.matrix,
    svg: image.svg,
    elements: data.elements,
    score: data.completeness?.score,
    lang,
    audience,
    hiddenElements: data.hiddenElements ?? image.hiddenElements ?? 0,
  });
  return {
    view,
    summary: { shown: true, note: 'Displayed to the person as the X-Matrix view where the host supports MCP Apps. Initiatives below; get_matrix_data has everything.' },
  };
}

async function handleSetCorrelation(args) {
  const { matrix_id, from_element_id, to_element_id, strength } = args;

  if (!from_element_id || !to_element_id) {
    return { error: 'from_element_id and to_element_id are required' };
  }
  if (!strength) {
    return { error: 'strength is required (none | weak | medium | strong)' };
  }

  let matrixId = matrix_id;
  if (!matrixId) {
    const found = await store.findElementMatrix(from_element_id);
    if (!found) return { error: `Element "${from_element_id}" not found in any matrix` };
    matrixId = found.matrix.id;
  }

  try {
    const { correlation, removed } = await store.setCorrelation(
      matrixId,
      from_element_id,
      to_element_id,
      strength,
    );
    return {
      success: true,
      removed,
      message: removed ? 'Correlation removed' : `Correlation set to ${correlation.strength}`,
      correlation,
    };
  } catch (error) {
    return { error: error.message };
  }
}

// Same behaviour as the remote transports (lib/remote-tools.js
// updateElementStatus), on the local store: a KPI value is a reading for a
// period, progress and notes go to the element's update log.
async function handleUpdateElementStatus(args) {
  const { element_id, status, progress, current_value, notes, external_ref, period } = args;

  if (!element_id) {
    return { error: 'element_id is required' };
  }
  if (!status && progress === undefined && current_value === undefined && !notes && external_ref === undefined) {
    return { error: 'At least one of status, progress, current_value, notes, or external_ref must be provided' };
  }
  if (period !== undefined && !PERIOD_PATTERN.test(period)) {
    return { error: 'period must be a quarter (YYYY-Qn, e.g. 2026-Q3) or a month (YYYY-MM)' };
  }

  const found = await store.findElementMatrix(element_id);
  if (!found) {
    return { error: `Element with id "${element_id}" not found in any matrix` };
  }
  const { matrix, element: current } = found;
  const isKpi = found.quadrant === 'west';
  if (progress !== undefined && isKpi) {
    return { error: 'This element is a KPI: pass its measured value as current_value (with an optional period), not progress' };
  }
  if (period !== undefined && !isKpi) {
    return { error: 'period is for a KPI reading; an objective or initiative takes progress and notes' };
  }
  // Checked before any write, as in lib/remote-tools.js: same caps as the API.
  if (current_value !== undefined && String(current_value).trim().length > 100) {
    return { error: 'current_value is limited to 100 characters' };
  }
  if (notes && notes.length > (isKpi && current_value ? 2000 : 5000)) {
    return { error: `notes are limited to ${isKpi && current_value ? 2000 : 5000} characters` };
  }
  const { origin, error: originError } = readingOrigin(args, { isKpi, hasValue: current_value !== undefined && current_value !== '' });
  if (originError) return { error: originError };

  const changes = {};
  let element = null;
  const fields = {};
  if (status) fields.status = status;
  if (external_ref !== undefined) fields.externalRef = external_ref || null;
  if (current_value === '') fields.currentValue = null;
  if (current_value !== undefined && current_value !== '' && !isKpi) fields.currentValue = String(current_value);
  if (Object.keys(fields).length > 0) {
    element = await store.updateElement(matrix.id, element_id, fields);
    if (status) changes.status = { from: current.status, to: status };
    if (external_ref !== undefined) changes.externalRef = external_ref;
    if ('currentValue' in fields) changes.currentValue = { from: current.currentValue ?? null, to: fields.currentValue };
  }

  let noteLogged = false;
  if (isKpi && current_value !== undefined && current_value !== '') {
    const at = period ?? currentQuarter();
    const saved = await store.recordMeasurement(matrix.id, element_id, {
      period: at,
      value: String(current_value).trim(),
      ...(notes ? { note: notes } : {}),
      origin,
    });
    noteLogged = !!notes;
    changes.reading = { period: at, value: String(current_value).trim(), previousCurrentValue: current.currentValue ?? null };
    changes.currentValue = { from: current.currentValue ?? null, to: saved.currentValue ?? null };
  }

  if (progress !== undefined || (notes && !noteLogged)) {
    const logged = await store.addElementUpdate(matrix.id, element_id, {
      ...(progress !== undefined ? { progress } : {}),
      ...(notes && !noteLogged ? { comment: notes } : {}),
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

async function handleSearchIdeas(args) {
  const { query, status = 'all', priority = 'all', tags = [], limit = 20 } = args;

  const result = await store.listIdeas({ status, search: query, priority, tags, limit });

  return {
    count: result.ideas.length,
    query: query || null,
    filters: { status, priority, tags },
    ideas: result.ideas
  };
}

async function handleGetMatrixCompleteness(args) {
  const { matrix_id } = args;
  return await store.getCompleteness(matrix_id);
}

async function handleGetManagementArchitecture() {
  return await store.getArchitecture();
}

async function handleDiagnoseThemeDeployment(args) {
  const { theme_id, theme_name } = args;

  // 1. Get all themes
  const themes = await store.listThemes();

  let theme = null;
  if (theme_id) {
    theme = themes.find(t => t.id === theme_id);
  } else if (theme_name) {
    const nameLower = theme_name.toLowerCase();
    theme = themes.find(t => t.name.toLowerCase().includes(nameLower));
  }

  if (!theme) {
    return {
      error: theme_id
        ? `Theme with id "${theme_id}" not found`
        : theme_name
          ? `No theme matching "${theme_name}" found`
          : 'Either theme_id or theme_name is required',
      availableThemes: themes.map(t => ({ id: t.id, name: t.name }))
    };
  }

  // 2. Get full theme details (with resolved elements)
  const themeDetail = await store.getTheme(theme.id);

  // 3. Get cadences architecture
  const architecture = await store.getArchitecture();
  const cadencesByLevel = architecture.byLevel || {};

  // 4. Analyze X-Matrix presence
  const deployment = {
    north: { present: (themeDetail.elements?.north?.length || 0) > 0, elements: themeDetail.elements?.north?.length || 0 },
    east: { present: (themeDetail.elements?.east?.length || 0) > 0, elements: themeDetail.elements?.east?.length || 0 },
    south: { present: (themeDetail.elements?.south?.length || 0) > 0, elements: themeDetail.elements?.south?.length || 0 },
    west: { present: (themeDetail.elements?.west?.length || 0) > 0, elements: themeDetail.elements?.west?.length || 0 }
  };

  const quadrantsPresent = Object.values(deployment).filter(d => d.present).length;

  // 5. Analyze operational coverage per level
  const levelOrder = ['strategic', 'tactical', 'operational_mgmt', 'team_mgmt', 'execution'];
  const levelLabels = {
    strategic: 'Strategic (Annual/Multi-year)',
    tactical: 'Tactical (Quarterly)',
    operational_mgmt: 'Operational Management (Monthly)',
    team_mgmt: 'Team Management (Weekly)',
    execution: 'Operational Execution (Daily)'
  };

  const operationalCoverage = [];
  let coveredLevels = 0;

  for (const level of levelOrder) {
    const cadences = cadencesByLevel[level] || [];
    if (cadences.length === 0) {
      operationalCoverage.push({
        level,
        levelLabel: levelLabels[level],
        coverage: 0,
        meetings: [],
        status: 'missing'
      });
      continue;
    }

    const meetingCoverage = cadences.map(c => {
      const trackedQuadrants = c.trackedQuadrants || [];
      const primaryQuadrant = c.primaryQuadrant;
      const allQuadrants = primaryQuadrant ? [primaryQuadrant, ...trackedQuadrants] : trackedQuadrants;
      const uniqueQuadrants = [...new Set(allQuadrants)];
      const relevantQuadrants = uniqueQuadrants.filter(q => deployment[q]?.present);
      const coverageRatio = uniqueQuadrants.length > 0
        ? relevantQuadrants.length / Math.max(Object.values(deployment).filter(d => d.present).length, 1)
        : 0;

      return { name: c.name, frequency: c.frequency, teamScope: c.teamScope, trackedQuadrants: uniqueQuadrants, relevantQuadrants, coverageRatio };
    });

    const bestCoverage = Math.max(...meetingCoverage.map(m => m.coverageRatio), 0);
    let status = 'critical';
    if (bestCoverage >= 0.75) { status = 'ok'; coveredLevels++; }
    else if (bestCoverage >= 0.25) { status = 'warning'; coveredLevels += 0.5; }

    operationalCoverage.push({ level, levelLabel: levelLabels[level], coverage: Math.round(bestCoverage * 100) / 100, meetings: meetingCoverage, status });
  }

  const matrixPresenceScore = (quadrantsPresent / 4) * 40;
  const operationalScore = (coveredLevels / levelOrder.length) * 60;
  const score = Math.round(matrixPresenceScore + operationalScore);

  const suggestions = [];
  for (const quadrant of ['north', 'east', 'south', 'west']) {
    if (!deployment[quadrant].present) {
      const labels = { north: 'Vision (North)', east: 'Annual Objectives (East)', south: 'Initiatives (South)', west: 'KPIs (West)' };
      suggestions.push(`Add ${labels[quadrant]} elements for theme "${themeDetail.name}"`);
    }
  }
  for (const oc of operationalCoverage) {
    if (oc.status === 'critical') {
      suggestions.push(`No meetings at ${oc.levelLabel} level cover theme "${themeDetail.name}"`);
    } else if (oc.status === 'warning') {
      suggestions.push(`Partial coverage at ${oc.levelLabel} level`);
    }
  }

  return { theme: themeDetail.name, themeId: themeDetail.id, score, deployment, operationalCoverage, suggestions };
}

async function handleSuggestMeetingForTopic(args) {
  const { topic, element_id } = args;

  if (!topic || topic.trim().length === 0) {
    return { error: 'topic is required' };
  }

  let elementQuadrant = null;
  let elementInfo = null;

  if (element_id) {
    const found = await store.findElementMatrix(element_id);
    if (found) {
      elementQuadrant = found.quadrant;
      elementInfo = { id: found.element.id, title: found.element.title, quadrant: found.quadrant };
    }
  }

  const architecture = await store.getArchitecture();
  const cadencesByLevel = architecture.byLevel || {};

  const levelLabels = {
    strategic: 'Strategic (Annual/Multi-year)',
    tactical: 'Tactical (Quarterly/QBR)',
    operational_mgmt: 'Operational Management (Monthly)',
    team_mgmt: 'Team Management (Weekly)',
    execution: 'Operational Execution (Daily)'
  };

  const quadrantToLevel = {
    north: { recommended: ['strategic'], acceptable: ['tactical'], notRecommended: ['operational_mgmt', 'team_mgmt', 'execution'] },
    east: { recommended: ['tactical', 'operational_mgmt'], acceptable: ['strategic'], notRecommended: ['team_mgmt', 'execution'] },
    south: { recommended: ['tactical', 'operational_mgmt'], acceptable: ['team_mgmt'], notRecommended: ['strategic', 'execution'] },
    west: { recommended: ['operational_mgmt', 'team_mgmt'], acceptable: ['execution'], notRecommended: ['strategic', 'tactical'] }
  };

  const recommended = [];
  const notRecommended = [];

  if (elementQuadrant && quadrantToLevel[elementQuadrant]) {
    const mapping = quadrantToLevel[elementQuadrant];
    for (const level of mapping.recommended) {
      const cadences = cadencesByLevel[level] || [];
      recommended.push({ level, levelLabel: levelLabels[level], priority: 'recommended', cadences: cadences.map(c => ({ id: c.id, name: c.name, frequency: c.frequency })) });
    }
    for (const level of mapping.acceptable) {
      const cadences = cadencesByLevel[level] || [];
      recommended.push({ level, levelLabel: levelLabels[level], priority: 'acceptable', cadences: cadences.map(c => ({ id: c.id, name: c.name, frequency: c.frequency })) });
    }
    for (const level of mapping.notRecommended) {
      notRecommended.push({ level, levelLabel: levelLabels[level], reason: level === 'execution' || level === 'team_mgmt' ? 'Too operational for this topic' : 'Too high-level for this topic' });
    }
  } else {
    const topicLower = topic.toLowerCase();
    let detectedLevel = 'operational_mgmt';
    if (topicLower.match(/vision|strat[ée]gi|long.?term|3.?5\s*ans|pluriannuel/)) detectedLevel = 'strategic';
    else if (topicLower.match(/trimestr|quarter|qbr|initiative|projet|program/)) detectedLevel = 'tactical';
    else if (topicLower.match(/mensuel|monthly|kpi|indicat|m[ée]trique|review/)) detectedLevel = 'operational_mgmt';
    else if (topicLower.match(/hebdo|weekly|[ée]quipe|team|sprint/)) detectedLevel = 'team_mgmt';
    else if (topicLower.match(/daily|quotidien|standup|stand.?up|jour/)) detectedLevel = 'execution';

    const allLevels = ['strategic', 'tactical', 'operational_mgmt', 'team_mgmt', 'execution'];
    const levelIndex = allLevels.indexOf(detectedLevel);
    for (let i = 0; i < allLevels.length; i++) {
      const level = allLevels[i];
      const cadences = cadencesByLevel[level] || [];
      const distance = Math.abs(i - levelIndex);
      if (distance === 0) recommended.push({ level, levelLabel: levelLabels[level], priority: 'recommended', cadences: cadences.map(c => ({ id: c.id, name: c.name, frequency: c.frequency })) });
      else if (distance === 1) recommended.push({ level, levelLabel: levelLabels[level], priority: 'acceptable', cadences: cadences.map(c => ({ id: c.id, name: c.name, frequency: c.frequency })) });
      else notRecommended.push({ level, levelLabel: levelLabels[level], reason: i < levelIndex ? 'Too high-level for this topic' : 'Too operational for this topic' });
    }
  }

  return { topic, element: elementInfo, recommended, notRecommended };
}

// ============================================
// MAIN
// ============================================

// One factory for both protocol revisions (docs/sprint-mcp-2026-07-28.md): serveStdio
// pins one instance per connection, in the era the client opened with.
function buildServer({ era = 'legacy' } = {}) {
  const server = new Server(
    {
      name: 'hoshin-kanri-local',
      version: VERSION
    },
    {
      capabilities: {
        tools: {},
        resources: { subscribe: true },
        prompts: {}
      },
      instructions: SERVER_INSTRUCTIONS
    }
  );

  // List tools
  server.setRequestHandler('tools/list', async () => ({ tools }));

  // Handle tool calls
  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result;

      switch (name) {
        case 'update_idea':
          result = await handleUpdateIdea(args || {});
          break;
        case 'list_matrices':
          result = await handleListMatrices(args || {});
          break;
        case 'add_idea':
          result = await handleAddIdea(args || {});
          break;
        case 'list_objectives':
          result = await handleListObjectives(args || {});
          break;
        case 'get_matrix_data':
          result = await handleGetMatrixData(args || {});
          break;
        case 'share_matrix':
        case 'list_matrix_shares':
        case 'revoke_matrix_share':
          // Sovereign mode: data lives only on this machine, there is no cloud
          // page to publish to — and that is the point of local mode.
          result = {
            error: 'Public links (share_matrix, list_matrix_shares, revoke_matrix_share) are not available in local JSON mode: your data never leaves this machine (sovereignty by design). To share the matrix, generate a snapshot artifact with the matrix_artifact prompt and send it — a deliberate, one-shot publication you fully control.'
          };
          break;
        case 'get_matrix_summary':
          result = await handleGetMatrixSummary(args || {});
          break;
        case 'create_matrix':
          result = await handleCreateMatrix(args || {});
          break;
        case 'upsert_element':
          result = await handleUpsertElement(args || {});
          break;
        case 'get_cascade':
          result = await handleGetCascade(args || {});
          break;
        case 'set_matrix_parent':
          result = await handleSetMatrixParent(args || {});
          break;
        case 'set_correlation':
          result = await handleSetCorrelation(args || {});
          break;
        case 'update_element_status':
          result = await handleUpdateElementStatus(args || {});
          break;
        case 'search_ideas':
          result = await handleSearchIdeas(args || {});
          break;
        case 'get_matrix_completeness':
          result = await handleGetMatrixCompleteness(args || {});
          break;
        case 'get_management_architecture':
          result = await handleGetManagementArchitecture();
          break;
        case 'diagnose_theme_deployment':
          result = await handleDiagnoseThemeDeployment(args || {});
          break;
        case 'suggest_meeting_for_topic':
          result = await handleSuggestMeetingForTopic(args || {});
          break;
        case 'get_agenda': {
          const { since, horizon_days, matrix_id } = args || {};
          result = computeAgenda(await store.getAgendaInput(matrix_id), { now: new Date(), since, horizonDays: horizon_days });
          break;
        }
        case 'schedule_review':
          result = await store.scheduleReview({ cadenceId: args?.cadence_id, date: args?.date, matrixId: args?.matrix_id });
          break;
        case 'whoami':
          result = {
            mode: 'local',
            dataDir,
            connection: { kind: 'local', canWrite: true },
            notes: ['Local mode: the matrix is in JSON files on this machine and nothing is sent anywhere. Rights and plans do not apply.'],
            matrices: (await store.listMatrices()).map((m) => ({ id: m.id, name: m.name, canEdit: true })),
          };
          break;
        case 'get_help':
          result = getHelp(args || {});
          break;
        case 'archive_matrix':
          result = await handleArchiveMatrix(args || {});
          break;
        case 'delete_matrix':
          result = await handleDeleteMatrix(args || {});
          break;
        case 'delete_element':
          result = await handleDeleteElement(args || {});
          break;
        case 'export_matrix_image':
          result = await handleExportMatrixImage(args || {});
          break;
        case 'get_review':
          result = args?.review_id ? await store.getReview(args.review_id) : { error: 'review_id is required' };
          break;
        case 'upsert_initiative_sheet':
          result = args?.element_id ? await store.setElementSheet(args.element_id, 'sheet', sheetBody(args)) : { error: 'element_id is required' };
          break;
        case 'set_kpi_definition':
          result = args?.element_id ? await store.setElementSheet(args.element_id, 'kpiDefinition', kpiDefinitionBody(args)) : { error: 'element_id is required' };
          break;
        case 'upsert_cadence':
          result = await store.upsertCadence(args?.cadence_id, cadenceBody(args || {}));
          break;
        case 'show_matrix':
          result = await handleShowMatrix(args || {});
          break;
        case 'get_excellence_roadmap':
        case 'assess_roadmap_item':
        case 'get_roadmap_translation':
        case 'translate_roadmap':
        case 'show_roadmap':
        case 'show_site_comparison':
          // Local mode keeps the X-Matrix in files; the excellence roadmap lives in the hosted app.
          result = { error: 'The excellence roadmap is not available in local mode: it lives in the hosted app (https://hoshin.app/roadmap).' };
          break;
        case 'list_members':
          // Local mode: one person, the one at the keyboard; owners are named in the files.
          result = { members: [], note: 'Local mode has no members: owners are free text in the files.' };
          break;
        case 'report_missing_capability':
          // Sovereign mode: nothing leaves the machine, not even this.
          result = localCapabilityReport(args || {});
          break;
        case 'record_review':
          result = await store.recordReview(args?.review_id, { notes: args?.notes, decisions: args?.decisions, discussedElementIds: args?.discussed_element_ids, actualDate: args?.held_on });
          break;
        default:
          result = { error: `Unknown tool: ${name}` };
      }

      // A tool that answers { error } failed: isError says so. show_matrix carries structuredContent.
      return toolResult(result);
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
        isError: true
      };
    }
  });

  // Resources (empty)
  // 2025: resources/subscribe starts the watch. 2026: the connection is the listen channel.
  registerAgendaResource(server, async () => computeAgenda(await store.getAgendaInput(), { now: new Date() }), { watch: era === 'modern' ? 'always' : 'subscribe' });

  // Prompts
  server.setRequestHandler('prompts/list', async () => ({ prompts: promptsList }));

  server.setRequestHandler('prompts/get', async (request) => {
    return getPromptMessages(request.params.name, request.params.arguments || {});
  });

  return server;
}

async function main() {
  // Initialize store (creates directories and empty files)
  await store.initialize();
  serveStdio((ctx) => buildServer(ctx), { onerror: (error) => console.error('MCP stdio error:', error.message) });

  console.error(`
╔═══════════════════════════════════════════════════════════╗
║         Hoshin Kanri MCP Server (Local JSON)             ║
╠═══════════════════════════════════════════════════════════╣
║  Transport: stdio                                        ║
║  Storage:   ${dataDir.padEnd(43)}║
║  Mode:      Zero-infrastructure (local JSON files)       ║
╠═══════════════════════════════════════════════════════════╣
║  Tools: ${String(tools.length).padEnd(2)} tools available                               ║
║  Prompts: ${String(promptsList.length).padEnd(2)} prompts available                            ║
╚═══════════════════════════════════════════════════════════╝
  `);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
