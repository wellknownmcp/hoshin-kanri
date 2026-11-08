// The resource hoshin://agenda (docs/sprint-cadencement-agent.md, lot 3): the same
// agenda as the get_agenda tool, readable as a resource, with subscriptions. A
// subscribed session is re-read every AGENDA_POLL_MS; when the set of items due
// changes, the server sends notifications/resources/updated (MCP 2025-11-25).
//
// What MCP allows, and no more: the notification travels on a session the client
// keeps open. A client that is gone is woken by the webhook or the email
// (scripts/agenda-notify.ts), not by this.
import { ResourceNotFoundError } from '@modelcontextprotocol/server';
import { VIEW_HTML, VIEW_RESOURCE, VIEW_URI } from './matrix-view.js';

export const AGENDA_URI = 'hoshin://agenda';

// The SDK's resource-not-found error: -32602 with data { uri } on every revision (the 2026-07-28
// MUST; clients also accept the -32002 that earlier SDK builds sent).
const notFound = (uri) => new ResourceNotFoundError(uri, `Resource not found: ${uri}`);
const POLL_MS = Number(process.env.MCP_AGENDA_POLL_MS || 15 * 60 * 1000);

const RESOURCE = {
  uri: AGENDA_URI,
  name: 'agenda',
  title: 'Review cycle agenda',
  description:
    'Where the organization stands in its review cycle and what is due before the next review: the same content as the get_agenda tool. Subscribe to be notified when the items due change.',
  mimeType: 'application/json',
};

/** What changes when the agenda changes: the items due, by key. */
export function agendaFingerprint(agenda) {
  return (agenda?.items || []).map((i) => i.key).sort().join('\n');
}

/**
 * Registers the resource on an MCP server. `readAgenda` returns the agenda
 * (remote: GET /api/agenda with the session's token; local: computed from the files).
 *
 * `watch` says who decides to re-read it (docs/sprint-mcp-2026-07-28.md):
 * - 'subscribe' (2025-11-25): resources/subscribe starts the watch, unsubscribe stops it;
 * - 'always' (2026-07-28 over stdio): the connection is the subscription channel, so the
 *   watch runs for its lifetime and sendResourceUpdated reaches its listen streams;
 * - 'none' (2026-07-28 over HTTP): one server per request; lib/org-handlers.js watches.
 * resources/subscribe and unsubscribe exist only in 2025, so only 'subscribe' registers them.
 */
export function registerAgendaResource(server, readAgenda, { pollMs = POLL_MS, watch = 'subscribe' } = {}) {
  let timer = null;
  let last = null;
  // watching: a watch is on (set before its first read, so a stop during that read wins).
  // closed: the server is gone; nothing starts or sends after it.
  let watching = false;
  let closed = false;

  const stop = () => {
    watching = false;
    if (timer) clearInterval(timer);
    timer = null;
  };

  async function check() {
    try {
      const fingerprint = agendaFingerprint(await readAgenda());
      if (closed) return;
      if (last !== null && fingerprint !== last) await server.sendResourceUpdated({ uri: AGENDA_URI });
      last = fingerprint;
    } catch (error) {
      // An expired token or a transient API error: try again at the next tick.
      console.error('agenda resource: check failed:', error.message);
    }
  }

  // The MCP App view of show_matrix (lib/matrix-view.js) is the other resource of this server.
  server.setRequestHandler('resources/list', async () => ({ resources: [RESOURCE, VIEW_RESOURCE] }));

  server.setRequestHandler('resources/read', async (request) => {
    if (request.params.uri === VIEW_URI) {
      return { contents: [{ uri: VIEW_URI, mimeType: VIEW_RESOURCE.mimeType, text: VIEW_HTML, _meta: VIEW_RESOURCE._meta }] };
    }
    if (request.params.uri !== AGENDA_URI) throw notFound(request.params.uri);
    const agenda = await readAgenda();
    return { contents: [{ uri: AGENDA_URI, mimeType: 'application/json', text: JSON.stringify(agenda, null, 2) }] };
  });

  async function start() {
    if (watching || closed) return;
    watching = true;
    last = null;
    await check();
    // Stopped or closed during that first read (a probe instance discarded by serveStdio,
    // an unsubscribe right after subscribe): arm nothing.
    if (!watching || closed) return;
    timer = setInterval(check, pollMs);
    timer.unref?.();
  }

  if (watch === 'subscribe') {
    server.setRequestHandler('resources/subscribe', async (request) => {
      if (request.params.uri !== AGENDA_URI) throw notFound(request.params.uri);
      await start();
      return {};
    });

    server.setRequestHandler('resources/unsubscribe', async (request) => {
      if (request.params.uri === AGENDA_URI) stop();
      return {};
    });
  } else if (watch === 'always') {
    start();
  }

  const previous = server.onclose;
  server.onclose = () => {
    closed = true;
    stop();
    previous?.();
  };

  return { check, stop };
}
