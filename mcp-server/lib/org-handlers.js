// The 2026-07-28 leg of the HTTP transport (docs/sprint-mcp-2026-07-28.md, lot 2).
//
// One createMcpHandler per organization: a handler's event bus reaches every
// subscriptions/listen stream it serves, with no notion of who opened it, so a
// handler per org is what keeps an agenda notification inside its org. Each
// entry watches its org's agenda only while a listen stream is open on it, with
// the token of the latest request from that org, and is dropped once idle.

import { agendaFingerprint, AGENDA_URI } from './agenda-resource.js';

export function createOrgHandlers({ createHandler, readAgenda, pollMs, idleMs = 30 * 60 * 1000, now = Date.now, log = console.error }) {
  const entries = new Map();

  function makeEntry(organizationId) {
    const listeners = new Set();
    const entry = { organizationId, token: null, lastUsed: now(), last: null, timer: null, listeners, handler: null };

    async function check() {
      if (!entry.token) return;
      try {
        const fingerprint = agendaFingerprint(await readAgenda(entry.token, organizationId));
        if (entry.last !== null && fingerprint !== entry.last) entry.handler.notify.resourceUpdated(AGENDA_URI);
        entry.last = fingerprint;
      } catch (error) {
        // An expired token or a transient API error: the next request refreshes the token.
        log(`agenda watch (${organizationId.slice(0, 8)}): ${error.message}`);
      }
    }

    // The bus the SDK's listen router registers each open stream on.
    const bus = {
      publish(event) {
        for (const listener of [...listeners]) {
          try {
            listener(event);
          } catch (error) {
            log(`listen delivery failed: ${error.message}`);
          }
        }
      },
      subscribe(listener) {
        listeners.add(listener);
        if (listeners.size === 1 && !entry.timer) {
          entry.last = null;
          check();
          entry.timer = setInterval(check, pollMs);
          entry.timer.unref?.();
        }
        let done = false;
        return () => {
          if (done) return;
          done = true;
          listeners.delete(listener);
          entry.lastUsed = now();
          if (listeners.size === 0 && entry.timer) {
            clearInterval(entry.timer);
            entry.timer = null;
          }
        };
      },
    };

    entry.check = check;
    entry.bus = bus;
    entry.handler = createHandler(bus);
    return entry;
  }

  return {
    /** The handler for this org, created on first use; records the caller's current token. */
    handlerFor(organizationId, token) {
      let entry = entries.get(organizationId);
      if (!entry) {
        entry = makeEntry(organizationId);
        entries.set(organizationId, entry);
      }
      entry.token = token;
      entry.lastUsed = now();
      return entry.handler;
    },
    /** Closes the handlers of orgs with no open stream and no request for idleMs. */
    async sweep() {
      for (const [id, entry] of entries) {
        if (entry.listeners.size === 0 && now() - entry.lastUsed > idleMs) {
          entries.delete(id);
          if (entry.timer) clearInterval(entry.timer);
          await entry.handler.close().catch((error) => log(`modern handler close failed: ${error.message}`));
        }
      }
    },
    /** For tests and the health line. */
    stats() {
      return [...entries.values()].map((e) => ({ organizationId: e.organizationId, listeners: e.listeners.size, watching: Boolean(e.timer) }));
    },
    _entry: (id) => entries.get(id),
  };
}
