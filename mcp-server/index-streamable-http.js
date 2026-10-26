/**
 * Hoshin Kanri MCP Server
 *
 * Streamable HTTP transport for Claude Desktop and other MCP clients.
 * Tool and prompt definitions are shared across transports in lib/ (handlers stay per-transport).
 *
 * Port: 3101 (production)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  isInitializeRequest
} from '@modelcontextprotocol/sdk/types.js';

import express from 'express';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { promptsList, getPromptMessages } from './lib/prompt-definitions.js';
import { tools, getQuadrantLabel } from './lib/tool-definitions.js';
import { VERSION } from './lib/version.js';
import { assertSafeEndpoint } from './lib/safe-endpoint.js';

// Load environment variables
dotenv.config({ path: '../.env' });

const PORT = process.env.MCP_PORT || 3101;
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3007';
// Public URL of the OAuth-protected resource (RFC 9728 discovery). Falls back
// to the issuer URL used by the Next.js app.
const PUBLIC_URL = process.env.OAUTH_ISSUER || API_BASE;
const WWW_AUTHENTICATE = `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource"`;

// Session management: sessionId → { transport, server, authContext, principal,
// organizationId, organizationName, lastSeen, activeStreams }
const transports = new Map();

// Clients are supposed to close their session with DELETE /mcp, and often do
// not: a browser tab closes, a laptop sleeps, a network drops. Without an idle
// sweep every abandoned session keeps its transport, its MCP server instance and
// its bearer token alive for the lifetime of the process.
const SESSION_IDLE_MS = Number(process.env.MCP_SESSION_IDLE_MS || 30 * 60 * 1000);
const SESSION_SWEEP_MS = Number(process.env.MCP_SESSION_SWEEP_MS || 5 * 60 * 1000);
// Sessions live in this process's memory: one principal (the public demo token
// included) must not be able to grow the map until PM2 restarts the process and
// drops every tenant's sessions. Past its cap a principal recycles its oldest one.
// The public demo token is one principal shared by every visitor: the cap must
// leave room for them. Eviction is least-recently-used, and a client that gets
// 404 on its session re-initializes (MCP spec).
const MAX_SESSIONS_PER_PRINCIPAL = Number(process.env.MCP_MAX_SESSIONS_PER_PRINCIPAL || 50);
const MAX_SESSIONS_TOTAL = Number(process.env.MCP_MAX_SESSIONS_TOTAL || 2000);

/**
 * Stable identity of the caller behind a validated credential. An OAuth access
 * token changes on every refresh, so it is keyed on user + client; an hk_ token
 * is keyed on its row id. A session only ever serves the principal that created it.
 */
function principalOf(authInfo) {
  if (authInfo.kind === 'oauth2') return `oauth:${authInfo.userId}:${authInfo.clientId}`;
  return `token:${authInfo.tokenId}`;
}

async function closeSession(sessionId, session, reason) {
  transports.delete(sessionId);
  try {
    await session.transport.close();
  } catch (error) {
    console.error(`Session ${sessionId}: transport close failed (${reason}):`, error.message);
  }
  try {
    await session.server.close();
  } catch (error) {
    console.error(`Session ${sessionId}: server close failed (${reason}):`, error.message);
  }
}

async function sweepIdleSessions(now = Date.now()) {
  const expired = [];
  for (const [sessionId, session] of transports) {
    if (session.activeStreams > 0) continue;
    if (now - session.lastSeen > SESSION_IDLE_MS) expired.push([sessionId, session]);
  }

  for (const [sessionId, session] of expired) {
    await closeSession(sessionId, session, 'idle');
    console.log(`Session expired after inactivity: ${sessionId} (org: ${session.organizationName})`);
  }

  return expired.length;
}

const sweepTimer = setInterval(() => {
  sweepIdleSessions().catch((error) => console.error('Session sweep failed:', error.message));
}, SESSION_SWEEP_MS);
// Never hold the event loop open just to sweep.
sweepTimer.unref();

// Express app
const app = express();
app.use(express.json());

// ============================================
// AUTH HELPERS
// ============================================

/**
 * Validate a Bearer credential and resolve its organization context.
 *
 * Accepts both credential families the API understands: opaque API tokens
 * (`hk_*`, stored SHA-256 hashed) and OAuth 2.1 access tokens (JWT RS256).
 * Validation is deliberately delegated to the Next.js app — this process holds
 * no secret and no key material, and the same token is forwarded downstream to
 * `/api/*` afterwards.
 */
// `opensSession` lets the API count MCP sessions (its audit row) rather than
// requests: every request is validated, only an initialize opens a session.
async function validateToken(token, opensSession = false) {
  if (!token) return null;

  try {
    // Call API to validate token
    const response = await fetch(`${API_BASE}/api/auth/validate-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opensSession ? { token, session: 'open' } : { token })
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.valid ? data : null;
  } catch (error) {
    console.error('Token validation error:', error.message);
    return null;
  }
}

/**
 * Extract Bearer token from request
 */
function extractToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
  res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ============================================
// MCP TOOLS DEFINITIONS
// ============================================


// ============================================
// TOOL HANDLERS
// ============================================

async function callAPI(endpoint, options = {}) {
  assertSafeEndpoint(endpoint);
  const url = `${API_BASE}${endpoint}`;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.message || error.error || `API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`API call failed: ${url}`, error.message);
    throw error;
  }
}

async function handleAddIdea(args, authContext) {
  const { title, description, priority = 'medium', source = 'conversation', tags = [] } = args;

  if (!title || title.trim().length === 0) {
    return { error: 'Title is required' };
  }

  const result = await callAPI('/api/ideas', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authContext.token}`,
      'X-Organization-Id': authContext.organizationId
    },
    body: JSON.stringify({ title, description, priority, source, tags })
  });

  return {
    success: true,
    message: `Idea "${title}" added to inbox`,
    idea: result,
    organization: authContext.organizationName
  };
}

async function handleListObjectives(args, authContext) {
  const { quadrant = 'all', status = 'all' } = args;

  // Call exports API for matrix data
  const result = await callAPI('/api/exports/matrices?include=elements', {
    headers: {
      'Authorization': `Bearer ${authContext.token}`,
      'X-Organization-Id': authContext.organizationId
    }
  });

  if (!result.data || result.data.length === 0) {
    return {
      message: 'No matrices found',
      objectives: []
    };
  }

  // Extract elements from first matrix (or all)
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

  return {
    count: objectives.length,
    objectives
  };
}

async function handleGetMatrixSummary(args, authContext) {
  const { include_correlations = true } = args;

  const headers = {
    'Authorization': `Bearer ${authContext.token}`,
    'X-Organization-Id': authContext.organizationId
  };

  // Get summary from exports API
  const include = include_correlations ? 'elements,correlations' : 'elements';
  const result = await callAPI(`/api/exports/matrices?include=${include}`, { headers });

  // Also get ideas summary
  const ideasSummary = await callAPI('/api/exports/summary', { headers });

  const matrices = Array.isArray(result.data) ? result.data : [result.data];
  const matrix = matrices[0];

  if (!matrix) {
    return {
      message: 'No X-Matrix found. Create your first matrix to get started.',
      ideasOverview: ideasSummary.overview
    };
  }

  // Calculate summary stats
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

async function handleGetMatrixData(args, authContext) {
  const { matrix_id } = args;

  const headers = {
    'Authorization': `Bearer ${authContext.token}`,
    'X-Organization-Id': authContext.organizationId
  };

  const result = await callAPI('/api/exports/matrices?include=elements,correlations', { headers });
  const matrices = Array.isArray(result.data) ? result.data : [result.data];
  const matrix = matrix_id
    ? matrices.find(m => m && m.id === matrix_id)
    : matrices[0];

  if (!matrix) {
    return {
      error: matrix_id ? `Matrix "${matrix_id}" not found` : 'No X-Matrix found. Create your first matrix to get started.',
      organization: authContext.organizationName
    };
  }

  let completeness = null;
  try {
    completeness = await callAPI(`/api/matrices/${matrix.id}/completeness`, { headers });
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
    completeness,
    organization: authContext.organizationName
  };
}

async function handleShareMatrix(args, authContext) {
  const { action = 'create', matrix_id, share_id, label, expires_in_days } = args;

  const headers = {
    'Authorization': `Bearer ${authContext.token}`,
    'X-Organization-Id': authContext.organizationId
  };

  let targetMatrixId = matrix_id;
  if (!targetMatrixId) {
    const matricesResult = await callAPI('/api/matrices?isActive=true&limit=1', { headers });
    if (matricesResult.matrices && matricesResult.matrices.length > 0) {
      targetMatrixId = matricesResult.matrices[0].id;
    } else {
      return { error: 'No matrix found. Create a matrix first.', organization: authContext.organizationName };
    }
  }

  if (action === 'list') {
    const result = await callAPI(`/api/matrices/${targetMatrixId}/shares`, { headers });
    return { matrixId: targetMatrixId, ...result };
  }

  if (action === 'revoke') {
    if (!share_id) {
      return { error: 'share_id is required for action=revoke — call share_matrix with action=list to find it' };
    }
    const result = await callAPI(`/api/matrices/${targetMatrixId}/shares/${share_id}`, {
      method: 'DELETE',
      headers
    });
    return { success: true, message: 'Share link revoked — the public page is no longer accessible.', ...result };
  }

  const created = await callAPI(`/api/matrices/${targetMatrixId}/shares`, {
    method: 'POST',
    headers,
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

async function handleCreateMatrix(args, authContext) {
  const { name, description, period_type, period_start, period_end, is_default } = args;

  if (!name || name.trim().length === 0) {
    return { error: 'name is required' };
  }

  const created = await callAPI('/api/matrices', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authContext.token}`,
      'X-Organization-Id': authContext.organizationId
    },
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
    matrix: { id: matrix.id, name: matrix.name, periodType: matrix.periodType },
    organization: authContext.organizationName
  };
}

/** Resolve the matrix to write into: the one given, or the organization default. */
async function resolveMatrixId(matrixId, headers) {
  if (matrixId) return matrixId;
  const result = await callAPI('/api/matrices?isActive=true&limit=1', { headers });
  return result.matrices && result.matrices.length > 0 ? result.matrices[0].id : null;
}

async function handleUpsertElement(args, authContext) {
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

  const headers = {
    'Authorization': `Bearer ${authContext.token}`,
    'X-Organization-Id': authContext.organizationId
  };

  const matrixId = await resolveMatrixId(matrix_id, headers);
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
    { method: created ? 'POST' : 'PUT', headers, body: JSON.stringify(body) }
  );

  const element = result.element ?? result;
  return {
    success: true,
    created,
    message: created ? `Element "${element.title}" created` : `Element "${element.title}" updated`,
    element,
    organization: authContext.organizationName
  };
}

async function handleSetCorrelation(args, authContext) {
  const { matrix_id, from_element_id, to_element_id, strength } = args;

  if (!from_element_id || !to_element_id) {
    return { error: 'from_element_id and to_element_id are required' };
  }
  if (!strength) {
    return { error: 'strength is required (none | weak | medium | strong)' };
  }

  const headers = {
    'Authorization': `Bearer ${authContext.token}`,
    'X-Organization-Id': authContext.organizationId
  };

  const matrixId = await resolveMatrixId(matrix_id, headers);
  if (!matrixId) return { error: 'No matrix found. Create one first with create_matrix.' };

  const result = await callAPI(`/api/matrices/${matrixId}/correlations`, {
    method: 'PUT',
    headers,
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
    correlation: result.correlation ?? null,
    organization: authContext.organizationName
  };
}

async function handleUpdateElementStatus(args, authContext) {
  const { element_id, status, progress, notes, external_ref } = args;

  if (!element_id) {
    return { error: 'element_id is required' };
  }

  if (!status && progress === undefined && !notes && external_ref === undefined) {
    return { error: 'At least one of status, progress, notes, or external_ref must be provided' };
  }

  const headers = {
    'Authorization': `Bearer ${authContext.token}`,
    'X-Organization-Id': authContext.organizationId
  };

  // Find the element's matrix by fetching all matrices with elements
  const matricesResult = await callAPI('/api/exports/matrices?include=elements', { headers });
  const matrices = Array.isArray(matricesResult.data) ? matricesResult.data : [matricesResult.data];

  let matrixId = null;
  let currentElement = null;

  for (const matrix of matrices) {
    if (!matrix.elements) continue;
    for (const quadrant of ['north', 'east', 'south', 'west']) {
      const elements = matrix.elements[quadrant] || [];
      const found = elements.find(el => el.id === element_id);
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

  // Build the update body
  const updateBody = {};
  if (status) {
    updateBody.status = status;
  }
  if (external_ref !== undefined) {
    updateBody.externalRef = external_ref || null;
  }
  if (progress !== undefined) {
    updateBody.currentValue = String(progress);
  }
  if (notes) {
    // Append notes to existing description
    const existingDesc = currentElement.description || '';
    const timestamp = new Date().toISOString().split('T')[0];
    const separator = existingDesc ? '\n\n' : '';
    updateBody.description = `${existingDesc}${separator}[${timestamp}] ${notes}`;
  }

  const updatedElement = await callAPI(`/api/matrices/${matrixId}/elements/${element_id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(updateBody)
  });

  return {
    success: true,
    message: `Element "${currentElement.title}" updated successfully`,
    element: updatedElement,
    changes: {
      ...(status ? { status: { from: currentElement.status, to: status } } : {}),
      ...(progress !== undefined ? { progress } : {}),
      ...(notes ? { notesAdded: notes } : {})
    },
    organization: authContext.organizationName
  };
}

async function handleSearchIdeas(args, authContext) {
  const { query, status = 'all', priority = 'all', tags = [], limit = 20 } = args;

  // Build query params
  const params = new URLSearchParams();
  if (status !== 'all') params.append('status', status);
  if (query) params.append('search', query);
  params.append('limit', limit.toString());

  const result = await callAPI(`/api/ideas?${params.toString()}`, {
    headers: {
      'Authorization': `Bearer ${authContext.token}`,
      'X-Organization-Id': authContext.organizationId
    }
  });

  let ideas = result.ideas || [];

  // Additional client-side filtering
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
    ideas: ideas.slice(0, limit),
    organization: authContext.organizationName
  };
}


async function handleGetMatrixCompleteness(args, authContext) {
  const { matrix_id } = args;

  const headers = {
    'Authorization': `Bearer ${authContext.token}`,
    'X-Organization-Id': authContext.organizationId
  };

  // If no matrix_id provided, get default matrix first
  let targetMatrixId = matrix_id;

  if (!targetMatrixId) {
    // Get matrices list and use the first/default one
    const matricesResult = await callAPI('/api/matrices?isActive=true&limit=1', { headers });
    if (matricesResult.matrices && matricesResult.matrices.length > 0) {
      targetMatrixId = matricesResult.matrices[0].id;
    } else {
      return {
        error: 'No matrix found. Create a matrix first.',
        organization: authContext.organizationName
      };
    }
  }

  // Get completeness analysis
  const result = await callAPI(`/api/matrices/${targetMatrixId}/completeness`, { headers });

  return {
    ...result,
    organization: authContext.organizationName
  };
}

async function handleGetManagementArchitecture(args, authContext) {
  const headers = {
    'Authorization': `Bearer ${authContext.token}`,
    'X-Organization-Id': authContext.organizationId
  };

  const architecture = await callAPI('/api/cadences/architecture', { headers });

  return {
    ...architecture,
    organization: authContext.organizationName
  };
}

async function handleDiagnoseThemeDeployment(args, authContext) {
  const { theme_id, theme_name } = args;

  const headers = {
    'Authorization': `Bearer ${authContext.token}`,
    'X-Organization-Id': authContext.organizationId
  };

  // 1. Get all themes
  const themesResult = await callAPI('/api/themes', { headers });
  const themes = themesResult.themes || [];

  // Find the target theme
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
      availableThemes: themes.map(t => ({ id: t.id, name: t.name })),
      organization: authContext.organizationName
    };
  }

  // 2. Get full theme details (with element info)
  const themeDetail = await callAPI(`/api/themes/${theme.id}`, { headers });

  // 3. Get cadences architecture
  const architecture = await callAPI('/api/cadences/architecture', { headers });
  const cadencesByLevel = architecture.byLevel || {};

  // 4. Analyze X-Matrix presence
  const deployment = {
    north: { present: (themeDetail.elements?.north?.length || 0) > 0, elements: themeDetail.elements?.north?.length || 0 },
    east: { present: (themeDetail.elements?.east?.length || 0) > 0, elements: themeDetail.elements?.east?.length || 0 },
    south: { present: (themeDetail.elements?.south?.length || 0) > 0, elements: themeDetail.elements?.south?.length || 0 },
    west: { present: (themeDetail.elements?.west?.length || 0) > 0, elements: themeDetail.elements?.west?.length || 0 }
  };

  // Count quadrants present
  const quadrantsPresent = Object.values(deployment).filter(d => d.present).length;

  // 5. Analyze operational coverage per level
  const themeElementIds = [
    ...(themeDetail.northElements || []),
    ...(themeDetail.eastElements || []),
    ...(themeDetail.southElements || []),
    ...(themeDetail.westElements || [])
  ];

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
        status: 'missing',
        message: `No cadences defined at ${levelLabels[level]} level`
      });
      continue;
    }

    // Check if any cadence at this level tracks elements from this theme
    const meetingCoverage = cadences.map(c => {
      const trackedQuadrants = c.trackedQuadrants || [];
      const primaryQuadrant = c.primaryQuadrant;
      const allQuadrants = primaryQuadrant ? [primaryQuadrant, ...trackedQuadrants] : trackedQuadrants;
      const uniqueQuadrants = [...new Set(allQuadrants)];

      // A cadence covers this theme if it tracks quadrants where the theme has elements
      const relevantQuadrants = uniqueQuadrants.filter(q => deployment[q]?.present);
      const coverageRatio = uniqueQuadrants.length > 0
        ? relevantQuadrants.length / Object.values(deployment).filter(d => d.present).length
        : 0;

      return {
        name: c.name,
        frequency: c.frequency,
        teamScope: c.teamScope,
        trackedQuadrants: uniqueQuadrants,
        relevantQuadrants,
        coverageRatio
      };
    });

    const bestCoverage = Math.max(...meetingCoverage.map(m => m.coverageRatio), 0);
    let status = 'critical';
    if (bestCoverage >= 0.75) { status = 'ok'; coveredLevels++; }
    else if (bestCoverage >= 0.25) { status = 'warning'; coveredLevels += 0.5; }

    operationalCoverage.push({
      level,
      levelLabel: levelLabels[level],
      coverage: Math.round(bestCoverage * 100) / 100,
      meetings: meetingCoverage,
      status
    });
  }

  // 6. Calculate deployment score
  const matrixPresenceScore = (quadrantsPresent / 4) * 40; // 40% weight
  const operationalScore = (coveredLevels / levelOrder.length) * 60; // 60% weight
  const score = Math.round(matrixPresenceScore + operationalScore);

  // 7. Generate suggestions
  const suggestions = [];
  for (const quadrant of ['north', 'east', 'south', 'west']) {
    if (!deployment[quadrant].present) {
      const quadrantLabels = { north: 'Vision (North)', east: 'Annual Objectives (East)', south: 'Initiatives (South)', west: 'KPIs (West)' };
      suggestions.push(`Add ${quadrantLabels[quadrant]} elements for theme "${themeDetail.name}"`);
    }
  }
  for (const oc of operationalCoverage) {
    if (oc.status === 'critical') {
      suggestions.push(`No meetings at ${oc.levelLabel} level cover theme "${themeDetail.name}" - consider creating one or linking existing cadences`);
    } else if (oc.status === 'warning') {
      suggestions.push(`Partial coverage at ${oc.levelLabel} level - review tracked quadrants in meetings`);
    }
  }

  return {
    theme: themeDetail.name,
    themeId: themeDetail.id,
    score,
    deployment,
    operationalCoverage,
    suggestions,
    aiContext: `Theme "${themeDetail.name}" deployment score ${score}/100. Present in ${quadrantsPresent}/4 quadrants. ${coveredLevels}/${levelOrder.length} hierarchy levels have adequate coverage.`,
    organization: authContext.organizationName
  };
}

async function handleSuggestMeetingForTopic(args, authContext) {
  const { topic, element_id } = args;

  if (!topic || topic.trim().length === 0) {
    return { error: 'topic is required' };
  }

  const headers = {
    'Authorization': `Bearer ${authContext.token}`,
    'X-Organization-Id': authContext.organizationId
  };

  // Determine quadrant from element if provided
  let elementQuadrant = null;
  let elementInfo = null;

  if (element_id) {
    const matricesResult = await callAPI('/api/exports/matrices?include=elements', { headers });
    const matrices = Array.isArray(matricesResult.data) ? matricesResult.data : [matricesResult.data];

    for (const matrix of matrices) {
      if (!matrix.elements) continue;
      for (const quadrant of ['north', 'east', 'south', 'west']) {
        const elements = matrix.elements[quadrant] || [];
        const found = elements.find(el => el.id === element_id);
        if (found) {
          elementQuadrant = quadrant;
          elementInfo = { id: found.id, title: found.title, quadrant };
          break;
        }
      }
      if (elementQuadrant) break;
    }
  }

  // Get cadences
  const architecture = await callAPI('/api/cadences/architecture', { headers });
  const cadencesByLevel = architecture.byLevel || {};

  // Recommendation logic based on quadrant
  const quadrantToLevel = {
    north: {
      recommended: ['strategic'],
      acceptable: ['tactical'],
      notRecommended: ['operational_mgmt', 'team_mgmt', 'execution'],
      reason: 'Vision/strategic objectives (North quadrant, 3-5 year horizon) should be discussed at strategic level meetings (annual reviews, strategic planning)'
    },
    east: {
      recommended: ['tactical', 'operational_mgmt'],
      acceptable: ['strategic'],
      notRecommended: ['team_mgmt', 'execution'],
      reason: 'Annual objectives (East quadrant) should be reviewed at tactical level (QBR) or monthly operations reviews'
    },
    south: {
      recommended: ['tactical', 'operational_mgmt'],
      acceptable: ['team_mgmt'],
      notRecommended: ['strategic', 'execution'],
      reason: 'Initiatives and projects (South quadrant) should be tracked at QBR (quarterly) or monthly reviews, with weekly check-ins as needed'
    },
    west: {
      recommended: ['operational_mgmt', 'team_mgmt'],
      acceptable: ['execution'],
      notRecommended: ['strategic', 'tactical'],
      reason: 'KPIs and metrics (West quadrant) should be tracked at monthly reviews and weekly team meetings, with derived KPIs in daily stand-ups'
    }
  };

  const levelLabels = {
    strategic: 'Strategic (Annual/Multi-year)',
    tactical: 'Tactical (Quarterly/QBR)',
    operational_mgmt: 'Operational Management (Monthly)',
    team_mgmt: 'Team Management (Weekly)',
    execution: 'Operational Execution (Daily)'
  };

  const mapping = elementQuadrant
    ? quadrantToLevel[elementQuadrant]
    : null;

  // Build recommendations
  const recommended = [];
  const notRecommended = [];

  if (mapping) {
    // Build recommended list with matching cadences
    for (const level of mapping.recommended) {
      const cadences = cadencesByLevel[level] || [];
      recommended.push({
        level,
        levelLabel: levelLabels[level],
        priority: 'recommended',
        cadences: cadences.map(c => ({ id: c.id, name: c.name, frequency: c.frequency, teamScope: c.teamScope })),
        reason: mapping.reason
      });
    }

    for (const level of mapping.acceptable) {
      const cadences = cadencesByLevel[level] || [];
      recommended.push({
        level,
        levelLabel: levelLabels[level],
        priority: 'acceptable',
        cadences: cadences.map(c => ({ id: c.id, name: c.name, frequency: c.frequency, teamScope: c.teamScope })),
        reason: `Acceptable if the topic requires attention at this level`
      });
    }

    for (const level of mapping.notRecommended) {
      notRecommended.push({
        level,
        levelLabel: levelLabels[level],
        reason: level === 'execution' || level === 'team_mgmt'
          ? 'Too operational - this topic has a longer time horizon than daily/weekly discussions'
          : 'Too high-level - this topic is more operational and does not require strategic-level discussion'
      });
    }
  } else {
    // No element provided - recommend based on topic keywords (heuristic)
    const topicLower = topic.toLowerCase();

    let detectedLevel = 'operational_mgmt'; // default
    let detectedReason = 'General topic - defaulting to monthly review level';

    if (topicLower.match(/vision|strat[ée]gi|long.?term|3.?5\s*ans|pluriannuel/)) {
      detectedLevel = 'strategic';
      detectedReason = 'Topic mentions strategic/vision/long-term concepts';
    } else if (topicLower.match(/trimestr|quarter|qbr|initiative|projet|program/)) {
      detectedLevel = 'tactical';
      detectedReason = 'Topic mentions quarterly/initiative/project concepts';
    } else if (topicLower.match(/mensuel|monthly|kpi|indicat|m[ée]trique|review/)) {
      detectedLevel = 'operational_mgmt';
      detectedReason = 'Topic mentions monthly/KPI/metrics concepts';
    } else if (topicLower.match(/hebdo|weekly|[ée]quipe|team|sprint/)) {
      detectedLevel = 'team_mgmt';
      detectedReason = 'Topic mentions weekly/team/sprint concepts';
    } else if (topicLower.match(/daily|quotidien|standup|stand.?up|jour/)) {
      detectedLevel = 'execution';
      detectedReason = 'Topic mentions daily/stand-up concepts';
    }

    const allLevels = ['strategic', 'tactical', 'operational_mgmt', 'team_mgmt', 'execution'];
    const levelIndex = allLevels.indexOf(detectedLevel);

    for (let i = 0; i < allLevels.length; i++) {
      const level = allLevels[i];
      const cadences = cadencesByLevel[level] || [];
      const distance = Math.abs(i - levelIndex);

      if (distance === 0) {
        recommended.push({
          level,
          levelLabel: levelLabels[level],
          priority: 'recommended',
          cadences: cadences.map(c => ({ id: c.id, name: c.name, frequency: c.frequency, teamScope: c.teamScope })),
          reason: detectedReason
        });
      } else if (distance === 1) {
        recommended.push({
          level,
          levelLabel: levelLabels[level],
          priority: 'acceptable',
          cadences: cadences.map(c => ({ id: c.id, name: c.name, frequency: c.frequency, teamScope: c.teamScope })),
          reason: 'Adjacent level - acceptable if context requires'
        });
      } else {
        notRecommended.push({
          level,
          levelLabel: levelLabels[level],
          reason: i < levelIndex
            ? 'Too high-level for this topic'
            : 'Too operational for this topic'
        });
      }
    }
  }

  return {
    topic,
    element: elementInfo,
    recommended,
    notRecommended,
    organization: authContext.organizationName
  };
}

// ============================================
// MCP SERVER FACTORY
// ============================================

function createServer(authContext) {
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
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result;

      switch (name) {
        case 'add_idea':
          result = await handleAddIdea(args || {}, authContext);
          break;
        case 'list_objectives':
          result = await handleListObjectives(args || {}, authContext);
          break;
        case 'get_matrix_summary':
          result = await handleGetMatrixSummary(args || {}, authContext);
          break;
        case 'get_matrix_data':
          result = await handleGetMatrixData(args || {}, authContext);
          break;
        case 'share_matrix':
          result = await handleShareMatrix(args || {}, authContext);
          break;
        case 'create_matrix':
          result = await handleCreateMatrix(args || {}, authContext);
          break;
        case 'upsert_element':
          result = await handleUpsertElement(args || {}, authContext);
          break;
        case 'set_correlation':
          result = await handleSetCorrelation(args || {}, authContext);
          break;
        case 'update_element_status':
          result = await handleUpdateElementStatus(args || {}, authContext);
          break;
        case 'search_ideas':
          result = await handleSearchIdeas(args || {}, authContext);
          break;
        case 'get_matrix_completeness':
          result = await handleGetMatrixCompleteness(args || {}, authContext);
          break;
        case 'get_management_architecture':
          result = await handleGetManagementArchitecture(args || {}, authContext);
          break;
        case 'diagnose_theme_deployment':
          result = await handleDiagnoseThemeDeployment(args || {}, authContext);
          break;
        case 'suggest_meeting_for_topic':
          result = await handleSuggestMeetingForTopic(args || {}, authContext);
          break;
        default:
          result = { error: `Unknown tool: ${name}` };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: error.message }, null, 2)
          }
        ],
        isError: true
      };
    }
  });

  // List resources (empty for now)
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: []
  }));

  // List prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: promptsList }));

  // Prompt content is shared across all transports in lib/prompt-definitions.js
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return getPromptMessages(request.params.name);
  });

  return server;
}

// ============================================
// HTTP ENDPOINTS
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'hoshin-mcp',
    version: VERSION,
    sessions: transports.size,
    timestamp: new Date().toISOString()
  });
});

// MCP info
app.get('/mcp/info', (req, res) => {
  res.json({
    name: 'Hoshin Kanri MCP Server',
    version: VERSION,
    transport: 'streamable-http',
    tools: tools.map(t => ({ name: t.name, description: t.description })),
    endpoints: {
      mcp: '/mcp',
      health: '/health',
      info: '/mcp/info'
    }
  });
});

// Validate the Bearer of any /mcp request; on failure the 401 is already sent.
async function authenticate(req, res) {
  const token = extractToken(req);
  if (!token) {
    // WWW-Authenticate lets OAuth-capable clients (claude.ai, Cursor)
    // discover the authorization server instead of failing silently.
    res.status(401).set('WWW-Authenticate', WWW_AUTHENTICATE).json({
      error: 'UNAUTHORIZED',
      message: 'Bearer token required. Use an API token (hk_*) or connect via OAuth.'
    });
    return null;
  }

  const opensSession = req.method === 'POST' && !req.headers['mcp-session-id'] && isInitializeRequest(req.body);
  const authInfo = await validateToken(token, opensSession);
  if (!authInfo) {
    res.status(401).set('WWW-Authenticate', WWW_AUTHENTICATE).json({
      error: 'INVALID_TOKEN',
      message: 'Invalid or expired token.'
    });
    return null;
  }
  return authInfo;
}

// An Mcp-Session-Id is not a credential: the session it names is only served to
// the principal that opened it (the session runs tools with that principal's token).
function sessionFor(req, res, authInfo) {
  const sessionId = req.headers['mcp-session-id'];
  const session = sessionId ? transports.get(sessionId) : null;
  if (!session) {
    res.status(404).json({ error: 'SESSION_NOT_FOUND', message: 'Unknown session. Send an initialize request first.' });
    return null;
  }
  if (session.principal !== principalOf(authInfo)) {
    res.status(404).json({ error: 'SESSION_NOT_FOUND', message: 'Unknown session. Send an initialize request first.' });
    return null;
  }
  return { sessionId, session };
}

async function makeRoomFor(principal) {
  const own = [...transports].filter(([, s]) => s.principal === principal).sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  for (const [id, s] of own.slice(0, Math.max(0, own.length - MAX_SESSIONS_PER_PRINCIPAL + 1))) {
    await closeSession(id, s, 'per-principal cap');
  }
  return transports.size < MAX_SESSIONS_TOTAL;
}

// Main MCP endpoint - POST for requests, GET for SSE stream
app.post('/mcp', async (req, res) => {
  try {
    const authInfo = await authenticate(req, res);
    if (!authInfo) return;

    let sessionId;
    let session;

    if (req.headers['mcp-session-id']) {
      const found = sessionFor(req, res, authInfo);
      if (!found) return;
      ({ sessionId, session } = found);
      session.lastSeen = Date.now();
      // Same principal, possibly a refreshed OAuth access token: forward the
      // current one, not the one the session was opened with.
      session.authContext.token = authInfo.token;
    } else {
      // Only an initialize request opens a session: anything else would store a
      // server + transport the SDK then rejects, and never reclaim it.
      if (!isInitializeRequest(req.body)) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'Missing Mcp-Session-Id: send an initialize request first.' });
      }
      const principal = principalOf(authInfo);
      if (!(await makeRoomFor(principal))) {
        return res.status(503).json({ error: 'TOO_MANY_SESSIONS', message: 'Server at session capacity, retry later.' });
      }

      sessionId = randomUUID();
      const authContext = {
        token: authInfo.token,
        organizationId: authInfo.organizationId,
        organizationName: authInfo.organizationName
      };
      const server = createServer(authContext);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId
      });

      session = {
        transport,
        server,
        authContext,
        principal,
        organizationId: authInfo.organizationId,
        organizationName: authInfo.organizationName,
        lastSeen: Date.now(),
        // An SSE stream can legitimately sit quiet for a long time; a session
        // holding one open is not idle and must survive the sweep.
        activeStreams: 0
      };
      transports.set(sessionId, session);

      // Connect server to transport
      await server.connect(transport);

      console.log(`New MCP session: ${sessionId.slice(0, 8)}… (org: ${authInfo.organizationName}, ${transports.size} live)`);
    }

    // Set session ID header
    res.setHeader('Mcp-Session-Id', sessionId);

    // Handle the request
    await session.transport.handleRequest(req, res, req.body);

  } catch (error) {
    console.error('MCP request error:', error);
    res.status(500).json({ error: error.message });
  }
});

// SSE stream endpoint
app.get('/mcp', async (req, res) => {
  const authInfo = await authenticate(req, res);
  if (!authInfo) return;
  const found = sessionFor(req, res, authInfo);
  if (!found) return;
  const { sessionId, session } = found;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Mcp-Session-Id', sessionId);

  session.lastSeen = Date.now();
  session.activeStreams++;
  res.on('close', () => {
    session.activeStreams = Math.max(0, session.activeStreams - 1);
    session.lastSeen = Date.now();
  });

  // Handle SSE
  await session.transport.handleRequest(req, res);
});

// Session termination
app.delete('/mcp', async (req, res) => {
  const authInfo = await authenticate(req, res);
  if (!authInfo) return;
  const found = sessionFor(req, res, authInfo);
  if (!found) return;

  await closeSession(found.sessionId, found.session, 'client DELETE');
  console.log(`Session terminated: ${found.sessionId.slice(0, 8)}… (${transports.size} live)`);

  res.status(204).end();
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║         Hoshin Kanri MCP Server                           ║
╠═══════════════════════════════════════════════════════════╣
║  Port:      ${PORT}                                          ║
║  Transport: Streamable HTTP                               ║
║  API:       ${API_BASE}                         ║
╠═══════════════════════════════════════════════════════════╣
║  Endpoints:                                               ║
║  - POST /mcp        MCP requests                          ║
║  - GET  /mcp        SSE stream                            ║
║  - GET  /health     Health check                          ║
║  - GET  /mcp/info   Server info                           ║
╠═══════════════════════════════════════════════════════════╣
║  Tools:   ${String(tools.length).padEnd(2)} (shared in lib/tool-definitions.js)         ║
║  Prompts: ${String(promptsList.length).padEnd(2)} (shared in lib/prompt-definitions.js)       ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
