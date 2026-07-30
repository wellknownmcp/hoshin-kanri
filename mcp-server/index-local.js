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

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { homedir } from 'node:os';
import path from 'node:path';

import { tools, getQuadrantLabel } from './lib/tool-definitions.js';
import { promptsList, getPromptMessages } from './lib/prompt-definitions.js';
import { createJsonStore } from './lib/json-store.js';
import { VERSION } from './lib/version.js';

// ============================================
// CONFIGURATION
// ============================================

const dataDir = process.env.HOSHIN_DATA_DIR || path.join(homedir(), 'hoshin-data');
const store = createJsonStore({ dataDir });

// ============================================
// TOOL HANDLERS
// ============================================

async function handleAddIdea(args) {
  const { title, description, priority = 'medium', source = 'conversation', tags = [] } = args;

  if (!title || title.trim().length === 0) {
    return { error: 'Title is required' };
  }

  const idea = await store.createIdea({ title, description, priority, source, tags });

  return {
    success: true,
    message: `Idea "${title}" added to inbox`,
    idea
  };
}

async function handleListObjectives(args) {
  const { quadrant = 'all', status = 'all' } = args;

  const matrices = await store.listMatrices();

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

  const matrices = await store.listMatrices();
  const summary = await store.getSummary();
  const matrix = matrices[0];

  if (!matrix) {
    return {
      message: 'No X-Matrix found. Create your first matrix to get started.',
      ideasOverview: summary.overview
    };
  }

  const result = {
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
  const { matrix_id } = args;

  const matrices = await store.listMatrices();
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

  const matrix = await store.createMatrix({
    name: name.trim(),
    description: description ?? null,
    periodType: period_type ?? 'annual',
    periodStart: period_start ?? null,
    periodEnd: period_end ?? null,
    isDefault: is_default === true,
  });

  return {
    success: true,
    message: `Matrix "${matrix.name}" created. Add elements with upsert_element, then wire them with set_correlation.`,
    matrix: { id: matrix.id, name: matrix.name, periodType: matrix.periodType },
  };
}

/** Resolve the matrix to write into: the one given, or the default. */
async function resolveMatrixId(matrixId) {
  if (matrixId) return matrixId;
  const matrix = await store.getDefaultMatrix();
  return matrix ? matrix.id : null;
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
    external_ref,
  } = args;

  const matrixId = await resolveMatrixId(matrix_id);
  if (!matrixId) return { error: 'No matrix found. Create one first with create_matrix.' };

  if (!element_id && (!quadrant || !title)) {
    return { error: 'quadrant and title are required to create an element (or pass element_id to update one)' };
  }

  const patch = {};
  if (quadrant !== undefined) patch.quadrant = quadrant;
  if (title !== undefined) patch.title = title;
  if (description !== undefined) patch.description = description;
  if (status !== undefined) patch.status = status;
  if (target_value !== undefined) patch.targetValue = target_value;
  if (current_value !== undefined) patch.currentValue = current_value;
  if (unit !== undefined) patch.unit = unit;
  if (indicator_type !== undefined) patch.indicatorType = indicator_type;
  if (external_ref !== undefined) patch.externalRef = external_ref || null;

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

async function handleUpdateElementStatus(args) {
  const { element_id, status, progress, notes, external_ref } = args;

  if (!element_id) {
    return { error: 'element_id is required' };
  }

  if (!status && progress === undefined && !notes && external_ref === undefined) {
    return { error: 'At least one of status, progress, notes, or external_ref must be provided' };
  }

  const found = await store.findElementMatrix(element_id);
  if (!found) {
    return { error: `Element with id "${element_id}" not found in any matrix` };
  }

  const { matrix, element: currentElement } = found;

  const updateBody = {};
  if (status) updateBody.status = status;
  if (external_ref !== undefined) updateBody.externalRef = external_ref || null;
  if (progress !== undefined) updateBody.currentValue = progress;
  if (notes) {
    const existingDesc = currentElement.description || '';
    const timestamp = new Date().toISOString().split('T')[0];
    const separator = existingDesc ? '\n\n' : '';
    updateBody.description = `${existingDesc}${separator}[${timestamp}] ${notes}`;
  }

  const updated = await store.updateElement(matrix.id, element_id, updateBody);

  return {
    success: true,
    message: `Element "${currentElement.title}" updated successfully`,
    element: updated,
    changes: {
      ...(status ? { status: { from: currentElement.status, to: status } } : {}),
      ...(progress !== undefined ? { progress } : {}),
      ...(notes ? { notesAdded: notes } : {})
    }
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

async function main() {
  // Initialize store (creates directories and empty files)
  await store.initialize();

  const server = new Server(
    {
      name: 'hoshin-kanri-local',
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
        case 'get_matrix_data':
          result = await handleGetMatrixData(args || {});
          break;
        case 'share_matrix':
          // Sovereign mode: data lives only on this machine, there is no cloud
          // page to publish to — and that is the point of local mode.
          result = {
            error: 'share_matrix is not available in local JSON mode: your data never leaves this machine (sovereignty by design). To share the matrix, generate a snapshot artifact with the matrix_artifact prompt and send it — a deliberate, one-shot publication you fully control.'
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

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return getPromptMessages(request.params.name);
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

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
