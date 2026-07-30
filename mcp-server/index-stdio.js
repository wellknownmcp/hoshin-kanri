#!/usr/bin/env node
/**
 * Hoshin Kanri MCP Server - stdio transport
 *
 * For local Claude Desktop usage via stdio.
 * Configure in claude_desktop_config.json:
 * {
 *   "mcpServers": {
 *     "hoshin-kanri": {
 *       "command": "node",
 *       "args": ["/path/to/hoshin-kanri/mcp-server/index-stdio.js"],
 *       "env": {
 *         "API_BASE_URL": "https://hoshin.app",
 *         "AUTH_TOKEN": "your-token"
 *       }
 *     }
 *   }
 * }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { tools, getQuadrantLabel } from './lib/tool-definitions.js';
import { promptsList, getPromptMessages } from './lib/prompt-definitions.js';
import { VERSION } from './lib/version.js';

// Configuration
const API_BASE = process.env.API_BASE_URL || 'https://hoshin.app';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

// Tool definitions are shared across all transports in lib/tool-definitions.js.

// ============================================
// API HELPERS
// ============================================

async function callAPI(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (AUTH_TOKEN) {
    // v2 API accepts Bearer credentials (hk_* tokens or OAuth JWTs) on every route.
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.message || error.error || `API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    throw new Error(`API call failed: ${error.message}`);
  }
}

// ============================================
// TOOL HANDLERS
// ============================================

async function handleAddIdea(args) {
  const { title, description, priority = 'medium', source = 'conversation', tags = [] } = args;

  if (!title || title.trim().length === 0) {
    return { error: 'Title is required' };
  }

  const result = await callAPI('/api/ideas', {
    method: 'POST',
    body: JSON.stringify({ title, description, priority, source, tags })
  });

  return {
    success: true,
    message: `Idea "${title}" added to inbox`,
    idea: result
  };
}

async function handleListObjectives(args) {
  const { quadrant = 'all', status = 'all' } = args;

  const result = await callAPI('/api/exports/matrices?include=elements');

  if (!result.data || result.data.length === 0) {
    return { message: 'No matrices found', objectives: [] };
  }

  const objectives = [];
  const matrices = Array.isArray(result.data) ? result.data : [result.data];

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
            matrixName: matrix.name
          });
        }
      }
    }
  }

  return { count: objectives.length, objectives };
}

async function handleGetMatrixSummary(args) {
  const { include_correlations = true } = args;

  const include = include_correlations ? 'elements,correlations' : 'elements';
  const result = await callAPI(`/api/exports/matrices?include=${include}`);
  const ideasSummary = await callAPI('/api/exports/summary');

  const matrices = Array.isArray(result.data) ? result.data : [result.data];
  const matrix = matrices[0];

  if (!matrix) {
    return {
      message: 'No X-Matrix found. Create your first matrix to get started.',
      ideasOverview: ideasSummary.overview
    };
  }

  const summary = {
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
    ideasOverview: ideasSummary.overview,
    aiContext: ideasSummary.aiPromptContext
  };

  if (include_correlations && matrix.correlations) {
    summary.keyCorrelations = matrix.correlations.slice(0, 5).map(c => ({
      from: c.from.title,
      to: c.to.title,
      strength: c.strength
    }));
  }

  return summary;
}

async function handleShareMatrix(args) {
  const { action = 'create', matrix_id, share_id, label, expires_in_days } = args;

  let targetMatrixId = matrix_id;
  if (!targetMatrixId) {
    const matricesResult = await callAPI('/api/matrices?isActive=true&limit=1');
    if (matricesResult.matrices && matricesResult.matrices.length > 0) {
      targetMatrixId = matricesResult.matrices[0].id;
    } else {
      return { error: 'No matrix found. Create a matrix first.' };
    }
  }

  if (action === 'list') {
    const result = await callAPI(`/api/matrices/${targetMatrixId}/shares`);
    return { matrixId: targetMatrixId, ...result };
  }

  if (action === 'revoke') {
    if (!share_id) {
      return { error: 'share_id is required for action=revoke — call share_matrix with action=list to find it' };
    }
    const result = await callAPI(`/api/matrices/${targetMatrixId}/shares/${share_id}`, { method: 'DELETE' });
    return { success: true, message: 'Share link revoked — the public page is no longer accessible.', ...result };
  }

  const created = await callAPI(`/api/matrices/${targetMatrixId}/shares`, {
    method: 'POST',
    body: JSON.stringify({
      label: label ?? null,
      expiresInDays: expires_in_days ?? null
    })
  });

  return {
    success: true,
    message: 'Matrix published as a read-only public page. Anyone with this link can view it until you revoke it (share_matrix action=revoke).',
    ...created
  };
}

async function handleGetMatrixCompleteness(args) {
  const { matrix_id } = args;

  let targetMatrixId = matrix_id;
  if (!targetMatrixId) {
    const matricesResult = await callAPI('/api/matrices?isActive=true&limit=1');
    if (matricesResult.matrices && matricesResult.matrices.length > 0) {
      targetMatrixId = matricesResult.matrices[0].id;
    } else {
      return { error: 'No matrix found. Create a matrix first.' };
    }
  }

  return await callAPI(`/api/matrices/${targetMatrixId}/completeness`);
}

async function handleGetMatrixData(args) {
  const { matrix_id } = args;

  const result = await callAPI('/api/exports/matrices?include=elements,correlations');
  const matrices = Array.isArray(result.data) ? result.data : [result.data];
  const matrix = matrix_id
    ? matrices.find(m => m && m.id === matrix_id)
    : matrices[0];

  if (!matrix) {
    return { error: matrix_id ? `Matrix "${matrix_id}" not found` : 'No X-Matrix found. Create your first matrix to get started.' };
  }

  let completeness = null;
  try {
    completeness = await callAPI(`/api/matrices/${matrix.id}/completeness`);
  } catch {
    // completeness is optional context — the full dataset is still useful without it
  }

  return {
    matrix: {
      id: matrix.id,
      name: matrix.name,
      year: matrix.year,
      status: matrix.status,
      owner: matrix.owner
    },
    quadrantLabels: {
      north: getQuadrantLabel('north'),
      east: getQuadrantLabel('east'),
      south: getQuadrantLabel('south'),
      west: getQuadrantLabel('west')
    },
    elements: matrix.elements || { north: [], east: [], south: [], west: [] },
    correlations: matrix.correlations || [],
    completeness
  };
}

async function handleCreateMatrix(args) {
  const { name, description, period_type, period_start, period_end, is_default } = args;

  if (!name || name.trim().length === 0) {
    return { error: 'name is required' };
  }

  const created = await callAPI('/api/matrices', {
    method: 'POST',
    body: JSON.stringify({
      name: name.trim(),
      description: description ?? undefined,
      periodType: period_type ?? 'annual',
      periodStart: period_start ?? undefined,
      periodEnd: period_end ?? undefined,
      isDefault: is_default === true
    })
  });

  const matrix = created.matrix ?? created;
  return {
    success: true,
    message: `Matrix "${matrix.name}" created. Add elements with upsert_element, then wire them with set_correlation.`,
    matrix: { id: matrix.id, name: matrix.name, periodType: matrix.periodType }
  };
}

/** Resolve the matrix to write into: the one given, or the organization default. */
async function resolveMatrixId(matrixId) {
  if (matrixId) return matrixId;
  const result = await callAPI('/api/matrices?isActive=true&limit=1');
  return result.matrices && result.matrices.length > 0 ? result.matrices[0].id : null;
}

async function handleUpsertElement(args) {
  const {
    matrix_id,
    element_id,
    quadrant,
    title,
    description,
    status,
    target_value,
    current_value,
    unit,
    indicator_type,
    external_ref
  } = args;

  const matrixId = await resolveMatrixId(matrix_id);
  if (!matrixId) return { error: 'No matrix found. Create one first with create_matrix.' };

  if (!element_id && (!quadrant || !title)) {
    return { error: 'quadrant and title are required to create an element (or pass element_id to update one)' };
  }

  const body = {};
  if (quadrant !== undefined) body.quadrant = quadrant;
  if (title !== undefined) body.title = title;
  if (description !== undefined) body.description = description;
  if (status !== undefined) body.status = status;
  if (target_value !== undefined) body.targetValue = target_value;
  if (current_value !== undefined) body.currentValue = current_value;
  if (unit !== undefined) body.unit = unit;
  if (indicator_type !== undefined) body.indicatorType = indicator_type;
  if (external_ref !== undefined) body.externalRef = external_ref || null;

  const created = !element_id;
  const result = await callAPI(
    created ? `/api/matrices/${matrixId}/elements` : `/api/matrices/${matrixId}/elements/${element_id}`,
    { method: created ? 'POST' : 'PUT', body: JSON.stringify(body) }
  );

  const element = result.element ?? result;
  return {
    success: true,
    created,
    message: created ? `Element "${element.title}" created` : `Element "${element.title}" updated`,
    element
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

  const matrixId = await resolveMatrixId(matrix_id);
  if (!matrixId) return { error: 'No matrix found. Create one first with create_matrix.' };

  const result = await callAPI(`/api/matrices/${matrixId}/correlations`, {
    method: 'PUT',
    body: JSON.stringify({
      fromElementId: from_element_id,
      toElementId: to_element_id,
      strength
    })
  });

  const removed = result.removed === true;
  return {
    success: true,
    removed,
    message: removed ? 'Correlation removed' : `Correlation set to ${strength}`,
    correlation: result.correlation ?? null
  };
}

async function handleUpdateElementStatus(args) {
  const { element_id, status, progress, notes, external_ref } = args;

  if (!element_id) {
    return { error: 'element_id is required' };
  }
  if (!status && progress === undefined && !notes && external_ref === undefined) {
    return { error: 'At least one of status, progress, notes, or external_ref must be provided' };
  }

  // Locate the element's matrix (the PUT route is matrix-scoped).
  const matricesResult = await callAPI('/api/exports/matrices?include=elements');
  const matrices = Array.isArray(matricesResult.data) ? matricesResult.data : [matricesResult.data];

  let matrixId = null;
  let currentElement = null;
  for (const matrix of matrices) {
    if (!matrix?.elements) continue;
    for (const quadrant of ['north', 'east', 'south', 'west']) {
      const found = (matrix.elements[quadrant] || []).find(el => el.id === element_id);
      if (found) {
        matrixId = matrix.id;
        currentElement = found;
        break;
      }
    }
    if (matrixId) break;
  }

  if (!matrixId || !currentElement) {
    return { error: `Element with id "${element_id}" not found in any matrix` };
  }

  const updateBody = {};
  if (status) updateBody.status = status;
  if (progress !== undefined) updateBody.currentValue = String(progress);
  if (external_ref !== undefined) updateBody.externalRef = external_ref || null;
  if (notes) {
    const existingDesc = currentElement.description || '';
    const timestamp = new Date().toISOString().split('T')[0];
    const separator = existingDesc ? '\n\n' : '';
    updateBody.description = `${existingDesc}${separator}[${timestamp}] ${notes}`;
  }

  const updated = await callAPI(`/api/matrices/${matrixId}/elements/${element_id}`, {
    method: 'PUT',
    body: JSON.stringify(updateBody)
  });

  return {
    success: true,
    message: `Element "${currentElement.title}" updated`,
    element: updated,
    changes: {
      ...(status ? { status: { from: currentElement.status, to: status } } : {}),
      ...(progress !== undefined ? { progress } : {}),
      ...(external_ref !== undefined ? { externalRef: external_ref } : {}),
      ...(notes ? { notesAdded: notes } : {})
    }
  };
}

async function handleSearchIdeas(args) {
  const { query, status = 'all', priority = 'all', tags = [], limit = 20 } = args;

  const params = new URLSearchParams();
  if (status !== 'all') params.append('status', status);
  if (query) params.append('search', query);
  params.append('limit', limit.toString());

  const result = await callAPI(`/api/ideas?${params.toString()}`);
  let ideas = result.ideas || [];

  if (priority !== 'all') {
    ideas = ideas.filter(i => i.priority === priority);
  }
  if (tags.length > 0) {
    ideas = ideas.filter(i => i.tags?.some(t => tags.includes(t)));
  }

  return {
    count: ideas.length,
    query: query || null,
    filters: { status, priority, tags },
    ideas: ideas.slice(0, limit)
  };
}

async function handleGetManagementArchitecture() {
  return await callAPI('/api/cadences/architecture');
}

async function handleDiagnoseThemeDeployment(args) {
  const { theme_id, theme_name } = args;

  // 1. Get all themes
  const themesResult = await callAPI('/api/themes');
  const themes = themesResult.themes || [];

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

  // 2. Get full theme details
  const themeDetail = await callAPI(`/api/themes/${theme.id}`);

  // 3. Get cadences architecture
  const architecture = await callAPI('/api/cadences/architecture');
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
    const matricesResult = await callAPI('/api/exports/matrices?include=elements');
    const matrices = Array.isArray(matricesResult.data) ? matricesResult.data : [matricesResult.data];
    for (const matrix of matrices) {
      if (!matrix.elements) continue;
      for (const quadrant of ['north', 'east', 'south', 'west']) {
        const found = (matrix.elements[quadrant] || []).find(el => el.id === element_id);
        if (found) {
          elementQuadrant = quadrant;
          elementInfo = { id: found.id, title: found.title, quadrant };
          break;
        }
      }
      if (elementQuadrant) break;
    }
  }

  const architecture = await callAPI('/api/cadences/architecture');
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

async function main() {
  const server = new Server(
    {
      name: 'hoshin-kanri-mcp',
      version: VERSION
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      }
    }
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result;

      switch (name) {
        case 'add_idea':
          result = await handleAddIdea(args || {});
          break;
        case 'list_objectives':
          result = await handleListObjectives(args || {});
          break;
        case 'get_matrix_summary':
          result = await handleGetMatrixSummary(args || {});
          break;
        case 'get_matrix_completeness':
          result = await handleGetMatrixCompleteness(args || {});
          break;
        case 'get_matrix_data':
          result = await handleGetMatrixData(args || {});
          break;
        case 'share_matrix':
          result = await handleShareMatrix(args || {});
          break;
        case 'create_matrix':
          result = await handleCreateMatrix(args || {});
          break;
        case 'upsert_element':
          result = await handleUpsertElement(args || {});
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
        case 'get_management_architecture':
          result = await handleGetManagementArchitecture();
          break;
        case 'diagnose_theme_deployment':
          result = await handleDiagnoseThemeDeployment(args || {});
          break;
        case 'suggest_meeting_for_topic':
          result = await handleSuggestMeetingForTopic(args || {});
          break;
        default:
          result = { error: `Unknown tool: ${name}` };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }],
        isError: true
      };
    }
  });

  // Resources (empty)
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));

  // Prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: promptsList }));

  // Prompt content is shared across all transports in lib/prompt-definitions.js
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return getPromptMessages(request.params.name);
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
