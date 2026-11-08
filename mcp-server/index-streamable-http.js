/**
 * Hoshin Kanri MCP Server
 *
 * Streamable HTTP transport for Claude Desktop and other MCP clients.
 * Tool and prompt definitions are shared across transports in lib/ (handlers stay per-transport).
 *
 * Port: 3101 (production)
 */

import { NodeStreamableHTTPServerTransport, toNodeHandler } from '@modelcontextprotocol/node';
import { Server, createMcpHandler, isInitializeRequest, isLegacyRequest } from '@modelcontextprotocol/server';
import express from 'express';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { promptsList, getPromptMessages } from './lib/prompt-definitions.js';
import { tools, getQuadrantLabel } from './lib/tool-definitions.js';
import { VERSION } from './lib/version.js';
import { assertSafeEndpoint } from './lib/safe-endpoint.js';
import { registerAgendaResource } from './lib/agenda-resource.js';
import { apiErrorMessage, listMatrices, pickMatrix, findElement, elementBody, ideaUpdateBody, updateElementStatus, managementArchitecture, diagnoseThemeDeployment, suggestMeetingForTopic, getAgenda, scheduleReview, recordReview, whoami, reportMissingCapability, archiveMatrix, deleteMatrix, deleteElement, exportMatrixImage, getReview, upsertInitiativeSheet, setKpiDefinition, upsertCadence, listMembers, showMatrix } from './lib/remote-tools.js';
import { toolResult } from './lib/matrix-view.js';
import { getHelp, SERVER_INSTRUCTIONS } from './lib/help.js';
import { allowedOrigins, originAllowed } from './lib/origin.js';
import { createOrgHandlers } from './lib/org-handlers.js';
import { createListenLimits } from './lib/listen-limits.js';

// Load environment variables
dotenv.config({ path: '../.env' });

const PORT = process.env.MCP_PORT || 3101;
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3007';
// Public URL of the OAuth-protected resource (RFC 9728 discovery). Falls back
// to the issuer URL used by the Next.js app.
const PUBLIC_URL = process.env.OAUTH_ISSUER || API_BASE;
// The scope hint keeps a client from asking for every scope we list (mcp:admin included).
const WWW_AUTHENTICATE = `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource", scope="mcp:read mcp:write"`;

// Origin validation (MCP Streamable HTTP, MUST): lib/origin.js.
const ALLOWED_ORIGINS = allowedOrigins();

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
  orgHandlers.sweep().catch((error) => console.error('2026 handler sweep failed:', error.message));
}, SESSION_SWEEP_MS);
// Never hold the event loop open just to sweep.
sweepTimer.unref();

// Express app
const app = express();
// 2025-06-18 removed JSON-RPC batching; a bounded body and batch size keep a
// token holder from making the SDK validate unbounded input (GHSA-f897-62hf-6gxq).
const MAX_BODY_BYTES = 256 * 1024;
app.use(express.json({ limit: MAX_BODY_BYTES }));
app.use((req, res, next) => {
  if (Array.isArray(req.body) && req.body.length > 20) {
    return res.status(400).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Batch too large' }, id: null });
  }
  next();
});

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
  const origin = req.headers.origin;
  if (!originAllowed(origin, ALLOWED_ORIGINS)) {
    return res.status(403).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Origin not allowed' }, id: null });
  }
  res.header('Access-Control-Allow-Origin', origin || '*');
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID');
  res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
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
      throw new Error(apiErrorMessage(response.status, error));
    }

    return await response.json();
  } catch (error) {
    console.error(`API call failed: ${url}`, error.message);
    throw error;
  }
}

/** callAPI bound to the caller's credentials, for the shared helpers in lib/remote-tools.js. */
function apiFor(authContext) {
  const auth = {
    'Authorization': `Bearer ${authContext.token}`,
    'X-Organization-Id': authContext.organizationId
  };
  return (endpoint, options = {}) => callAPI(endpoint, { ...options, headers: { ...auth, ...options.headers } });
}

/** A shared tool's answer, with the organization it acted in (errors pass through). */
async function withOrg(pending, authContext) {
  const result = await pending;
  return result.error ? result : { ...result, organization: authContext.organizationName };
}

async function handleListMatrices(args, authContext) {
  const matrices = await listMatrices(apiFor(authContext), { includeArchived: args.include_archived === true });
  return { count: matrices.length, matrices, organization: authContext.organizationName };
}

async function handleUpdateIdea(args, authContext) {
  const { idea_id } = args;
  if (!idea_id) return { error: 'idea_id is required — find it with search_ideas' };
  const body = ideaUpdateBody(args);
  if (Object.keys(body).length === 0) {
    return { error: 'Nothing to update: pass status, priority, linked_element_id, title, description or links' };
  }
  const idea = await apiFor(authContext)(`/api/ideas/${idea_id}`, { method: 'PUT', body: JSON.stringify(body) });
  return { success: true, message: `Idea "${idea.title}" updated`, idea, organization: authContext.organizationName };
}

async function handleAddIdea(args, authContext) {
  const { title, description, priority = 'medium', source = 'conversation', tags = [], linked_element_id, links } = args;

  if (!title || title.trim().length === 0) {
    return { error: 'Title is required' };
  }

  const result = await callAPI('/api/ideas', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authContext.token}`,
      'X-Organization-Id': authContext.organizationId
    },
    body: JSON.stringify({ title, description, priority, source, tags, linkedElementId: linked_element_id || undefined, links })
  });

  return {
    success: true,
    message: `Idea "${title}" added to inbox`,
    idea: result,
    organization: authContext.organizationName
  };
}

async function handleListObjectives(args, authContext) {
  const { quadrant = 'all', status = 'all', matrix_id } = args;

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
  const all = Array.isArray(result.data) ? result.data : [result.data];
  // An org with a group and its sites holds several matrices: without a
  // matrix_id the rows of all of them come back, each tagged with its matrix.
  const matrices = matrix_id ? all.filter(m => m && m.id === matrix_id) : all;
  if (matrix_id && matrices.length === 0) {
    return { error: `Matrix "${matrix_id}" not found — list_matrices gives the ids` };
  }

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

  return {
    count: objectives.length,
    objectives
  };
}

async function handleGetMatrixSummary(args, authContext) {
  const { matrix_id, include_correlations = true } = args;

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
  const matrix = pickMatrix(matrices, matrix_id);

  if (!matrix) {
    if (matrix_id) return { error: `Matrix "${matrix_id}" not found` };
    return {
      message: 'No X-Matrix found. Create your first matrix to get started.',
      ideasOverview: ideasSummary.overview
    };
  }

  // Calculate summary stats
  const summary = {
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
  const { matrix_id, audience = 'internal' } = args;
  if (!['internal', 'external'].includes(audience)) return { error: 'audience must be "internal" or "external"' };
  // External: the API applies the filter of lib/external-view.ts (docs/sprint-pages-de-repli.md).
  const aud = audience === 'external' ? '&audience=external' : '';

  const headers = {
    'Authorization': `Bearer ${authContext.token}`,
    'X-Organization-Id': authContext.organizationId
  };

  const result = await callAPI(`/api/exports/matrices?include=elements,correlations${aud}`, { headers });
  const matrices = Array.isArray(result.data) ? result.data : [result.data];
  const matrix = pickMatrix(matrices, matrix_id);

  if (!matrix) {
    return {
      error: matrix_id ? `Matrix "${matrix_id}" not found` : 'No X-Matrix found. Create your first matrix to get started.',
      organization: authContext.organizationName
    };
  }

  let completeness = null;
  try {
    completeness = await callAPI(`/api/matrices/${matrix.id}/completeness${aud ? '?audience=external' : ''}`, { headers });
  } catch {
    // completeness is optional context — the full dataset is still useful without it
  }

  return {
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
    elements: matrix.elements || { north: [], east: [], south: [], west: [] },
    correlations: matrix.correlations || [],
    completeness,
    audience,
    ...(audience === 'external' && { hiddenElements: matrix.hiddenElements ?? 0 }),
    organization: authContext.organizationName
  };
}

async function handleShareMatrix(args, authContext) {
  const { action = 'create', matrix_id, share_id, label, expires_in_days, hide_figures, full_sheets } = args;

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
      expiresInDays: expires_in_days ?? null,
      hideFigures: hide_figures === true,
      fullSheets: full_sheets === true
    })
  });

  return {
    success: true,
    message: 'Matrix published as a read-only public page. Anyone with this link can view it until you revoke it (share_matrix action=revoke).',
    ...created
  };
}

async function handleCreateMatrix(args, authContext) {
  const { name, description, period_type, period_start, period_end, is_default, parent_matrix_id } = args;

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
      isDefault: is_default === true,
      parentMatrixId: parent_matrix_id || undefined
    })
  });

  const matrix = created.matrix ?? created;
  return {
    success: true,
    message: `Matrix "${matrix.name}" created. Add elements with upsert_element, then wire them with set_correlation.`,
    matrix: { id: matrix.id, name: matrix.name, periodType: matrix.periodType, parentMatrixId: matrix.parentMatrixId ?? null },
    organization: authContext.organizationName
  };
}

/**
 * Resolve the matrix to act on: the one given, or the organization default. Same
 * rule as pickMatrix (lib/remote-tools.js): GET /api/matrices sorts the default
 * first among the active ones.
 */
async function resolveMatrixId(matrixId, headers) {
  if (matrixId) return matrixId;
  const result = await callAPI('/api/matrices?isActive=true&limit=1', { headers });
  return result.matrices && result.matrices.length > 0 ? result.matrices[0].id : null;
}

async function handleUpsertElement(args, authContext) {
  const { matrix_id, element_id, quadrant, title } = args;

  const headers = {
    'Authorization': `Bearer ${authContext.token}`,
    'X-Organization-Id': authContext.organizationId
  };

  if (!element_id && (!quadrant || !title)) {
    return { error: 'quadrant and title are required to create an element (or pass element_id to update one)' };
  }

  // Updating an element: it lives in its own matrix, which may not be the
  // default one (a site in a cascade).
  let matrixId = matrix_id;
  if (!matrixId && element_id) {
    const found = await findElement(apiFor(authContext), element_id);
    if (!found) return { error: `Element "${element_id}" not found in any matrix` };
    matrixId = found.matrixId;
  }
  matrixId = await resolveMatrixId(matrixId, headers);
  if (!matrixId) return { error: 'No matrix found. Create one first with create_matrix.' };

  const body = elementBody(args);

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

async function handleGetCascade(args, authContext) {
  const headers = {
    'Authorization': `Bearer ${authContext.token}`,
    'X-Organization-Id': authContext.organizationId
  };
  const matrixId = await resolveMatrixId(args.matrix_id, headers);
  if (!matrixId) return { error: 'No matrix found. Create one first with create_matrix.' };
  const cascade = await callAPI(`/api/matrices/${matrixId}/cascade`, { headers });
  return { ...cascade, organization: authContext.organizationName };
}

async function handleSetMatrixParent(args, authContext) {
  const { matrix_id, parent_matrix_id } = args;
  if (!matrix_id) return { error: 'matrix_id is required' };
  const headers = {
    'Authorization': `Bearer ${authContext.token}`,
    'X-Organization-Id': authContext.organizationId
  };
  const updated = await callAPI(`/api/matrices/${matrix_id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ parentMatrixId: parent_matrix_id || null })
  });
  return {
    success: true,
    message: updated.parentMatrixId ? `Matrix "${updated.name}" attached under its parent` : `Matrix "${updated.name}" detached`,
    matrix: { id: updated.id, name: updated.name, parentMatrixId: updated.parentMatrixId ?? null },
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

  let matrixId = matrix_id;
  if (!matrixId) {
    const found = await findElement(apiFor(authContext), from_element_id);
    if (!found) return { error: `Element "${from_element_id}" not found in any matrix` };
    matrixId = found.matrixId;
  }

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
  const { element_id, status, progress, current_value, notes, external_ref, period } = args;

  // Shared through lib/remote-tools.js: a KPI value is a reading for a period, progress
  // and notes go to the element's update log (lib/remote-tools.js).
  const result = await updateElementStatus(apiFor(authContext), {
    element_id, status, progress, current_value, notes, external_ref, period
  });
  return result.error ? result : { ...result, organization: authContext.organizationName };
}

async function handleSearchIdeas(args, authContext) {
  const { query, status = 'all', priority = 'all', tags = [], limit = 20 } = args;

  // Build query params
  const params = new URLSearchParams();
  if (status !== 'all') params.append('status', status);
  if (priority !== 'all') params.append('priority', priority);
  if (query) params.append('search', query);
  // Tags are filtered here, after the fetch: take the API maximum so the
  // filter does not run on a truncated page.
  params.append('limit', tags.length > 0 ? '200' : limit.toString());

  const result = await callAPI(`/api/ideas?${params.toString()}`, {
    headers: {
      'Authorization': `Bearer ${authContext.token}`,
      'X-Organization-Id': authContext.organizationId
    }
  });

  let ideas = result.ideas || [];

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

// Cadences and themes: one implementation in lib/remote-tools.js, shared with the stdio transport.
async function handleGetManagementArchitecture(args, authContext) {
  return { ...(await managementArchitecture(apiFor(authContext))), organization: authContext.organizationName };
}

async function handleDiagnoseThemeDeployment(args, authContext) {
  return { ...(await diagnoseThemeDeployment(apiFor(authContext), args)), organization: authContext.organizationName };
}

async function handleSuggestMeetingForTopic(args, authContext) {
  const result = await suggestMeetingForTopic(apiFor(authContext), args);
  return result.error ? result : { ...result, organization: authContext.organizationName };
}

async function handleGetAgenda(args, authContext) {
  return { ...(await getAgenda(apiFor(authContext), args)), organization: authContext.organizationName };
}

async function handleScheduleReview(args, authContext) {
  return scheduleReview(apiFor(authContext), args);
}

async function handleRecordReview(args, authContext) {
  return recordReview(apiFor(authContext), args);
}

async function handleWhoami(authContext) {
  return whoami(apiFor(authContext));
}

async function handleReportMissingCapability(args, authContext) {
  return reportMissingCapability(apiFor(authContext), args);
}

// ============================================
// MCP SERVER FACTORY
// ============================================

function createServer(authContext, era = 'legacy') {
  const server = new Server(
    {
      name: 'hoshin-kanri-mcp',
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
  server.setRequestHandler('tools/list', async () => ({
    tools
  }));

  // Handle tool calls
  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result;

      switch (name) {
        case 'add_idea':
          result = await handleAddIdea(args || {}, authContext);
          break;
        case 'update_idea':
          result = await handleUpdateIdea(args || {}, authContext);
          break;
        case 'list_matrices':
          result = await handleListMatrices(args || {}, authContext);
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
        case 'get_cascade':
          result = await handleGetCascade(args || {}, authContext);
          break;
        case 'set_matrix_parent':
          result = await handleSetMatrixParent(args || {}, authContext);
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
        case 'get_agenda':
          result = await handleGetAgenda(args || {}, authContext);
          break;
        case 'schedule_review':
          result = await handleScheduleReview(args || {}, authContext);
          break;
        case 'record_review':
          result = await handleRecordReview(args || {}, authContext);
          break;
        case 'whoami':
          result = await handleWhoami(authContext);
          break;
        case 'get_help':
          result = getHelp(args || {});
          break;
        case 'report_missing_capability':
          result = await handleReportMissingCapability(args || {}, authContext);
          break;
        case 'archive_matrix':
          result = await withOrg(archiveMatrix(apiFor(authContext), args || {}), authContext);
          break;
        case 'delete_matrix':
          result = await withOrg(deleteMatrix(apiFor(authContext), args || {}), authContext);
          break;
        case 'delete_element':
          result = await withOrg(deleteElement(apiFor(authContext), args || {}), authContext);
          break;
        case 'export_matrix_image':
          result = await withOrg(exportMatrixImage(apiFor(authContext), args || {}), authContext);
          break;
        case 'get_review':
          result = await withOrg(getReview(apiFor(authContext), args || {}), authContext);
          break;
        case 'upsert_initiative_sheet':
          result = await withOrg(upsertInitiativeSheet(apiFor(authContext), args || {}), authContext);
          break;
        case 'set_kpi_definition':
          result = await withOrg(setKpiDefinition(apiFor(authContext), args || {}), authContext);
          break;
        case 'upsert_cadence':
          result = await withOrg(upsertCadence(apiFor(authContext), args || {}), authContext);
          break;
        case 'list_members':
          result = await withOrg(listMembers(apiFor(authContext), args || {}), authContext);
          break;
        case 'show_matrix':
          result = await showMatrix(apiFor(authContext), args || {});
          break;
        default:
          result = { error: `Unknown tool: ${name}` };
      }

      // A tool that answers { error } failed: isError says so, so the client and the model
      // do not take it as a result. show_matrix also carries structuredContent for its view.
      return toolResult(result);
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

  // hoshin://agenda, re-read with the session's current token (refreshed by each POST).
  // 2025: a session's resources/subscribe starts the watch. 2026: one server per request,
  // the per-org handler (lib/org-handlers.js) watches while a listen stream is open.
  registerAgendaResource(server, () => getAgenda(apiFor(authContext)), { watch: era === 'modern' ? 'none' : 'subscribe' });

  // List prompts
  server.setRequestHandler('prompts/list', async () => ({ prompts: promptsList }));

  // Prompt content is shared across all transports in lib/prompt-definitions.js
  server.setRequestHandler('prompts/get', async (request) => {
    return getPromptMessages(request.params.name, request.params.arguments || {});
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

  // A session opening, for the API's count: initialize in 2025, server/discover in 2026.
  const opensSession = req.method === 'POST' && !req.headers['mcp-session-id'] && (isInitializeRequest(req.body) || req.body?.method === 'server/discover');
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

// ============================================
// 2026-07-28 (docs/sprint-mcp-2026-07-28.md, lot 2)
// ============================================

// MCP_MODERN=off sends every request down the 2025 path, without a code change.
const MODERN = process.env.MCP_MODERN !== 'off';

const orgHandlers = createOrgHandlers({
  createHandler: (bus) =>
    createMcpHandler((ctx) => createServer(authContextOf(ctx.authInfo), ctx.era), {
      legacy: 'reject',
      bus,
      maxRequestBodySize: MAX_BODY_BYTES,
      onerror: (error) => console.error('MCP 2026 error:', error.message)
    }),
  readAgenda: (token, organizationId) => getAgenda(apiFor({ token, organizationId })),
  pollMs: Number(process.env.MCP_AGENDA_POLL_MS || 15 * 60 * 1000)
});
const nodeAdapters = new WeakMap();
const listenLimits = createListenLimits({
  perPrincipal: Number(process.env.MCP_MAX_LISTEN_PER_PRINCIPAL || 10),
  total: Number(process.env.MCP_MAX_LISTEN_TOTAL || 500)
});

function authContextOf(authInfo) {
  return {
    token: authInfo?.token,
    organizationId: authInfo?.extra?.organizationId,
    organizationName: authInfo?.extra?.organizationName
  };
}

/** A web Request carrying the Express request's method and headers, for isLegacyRequest (the body is passed parsed). */
function webRequestOf(req) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
  }
  return new Request(`http://localhost${req.originalUrl}`, { method: req.method, headers });
}

async function serveModern(req, res, authInfo) {
  // The SDK verifies no token: it receives the one we validated, as pass-through authInfo.
  req.auth = {
    token: authInfo.token,
    clientId: principalOf(authInfo),
    scopes: [],
    extra: { organizationId: authInfo.organizationId, organizationName: authInfo.organizationName }
  };
  // A listen stream stays open: counted per principal and in total, released when it closes.
  if (req.body?.method === 'subscriptions/listen') {
    const release = listenLimits.acquire(principalOf(authInfo));
    if (!release) {
      return res.status(429).json({
        jsonrpc: '2.0',
        id: req.body.id ?? null,
        error: { code: -32000, message: 'Too many open listen streams: close one before opening another.' }
      });
    }
    res.on('close', release);
  }
  const handler = orgHandlers.handlerFor(authInfo.organizationId, authInfo.token);
  let node = nodeAdapters.get(handler);
  if (!node) {
    node = toNodeHandler(handler, {
      maxRequestBodySize: MAX_BODY_BYTES,
      onerror: (error) => console.error('MCP 2026 adapter error:', error.message)
    });
    nodeAdapters.set(handler, node);
  }
  await node(req, res, req.body);
}

// Main MCP endpoint - POST for requests, GET for SSE stream
app.post('/mcp', async (req, res) => {
  try {
    const authInfo = await authenticate(req, res);
    if (!authInfo) return;

    // 2026-07-28: no session, each request carries its revision in _meta.
    if (MODERN && !req.headers['mcp-session-id'] && !(await isLegacyRequest(webRequestOf(req), req.body, { maxRequestBodySize: MAX_BODY_BYTES }))) {
      return await serveModern(req, res, authInfo);
    }

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
      const transport = new NodeStreamableHTTPServerTransport({
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
