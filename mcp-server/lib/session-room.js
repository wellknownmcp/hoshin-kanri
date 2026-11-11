// Which sessions to close so that one more fits (audit run-2, 9).
//
// Sessions live in one map shared by every organization. The caps used to be
// per credential and first come, first served: an admin mints credentials at
// will, so one organization could hold all the seats and every other tenant's
// `initialize` answered 503. Three rules now, in this order:
//   1. a principal (one credential) keeps at most `perPrincipal` sessions;
//   2. an organization keeps at most `perOrg`, whatever number of credentials;
//   3. when the map is full, the organization holding the most sessions gives
//      up its least recently used one.
// A newcomer is therefore always admitted, and the one who pays is the largest
// holder. A client whose session was closed gets 404 and re-initializes (MCP).
//
// Pure: no clock, no I/O. Tested by src/lib/mcp-session-room.test.ts.

/**
 * @param {Iterable<[string, { principal: string, organizationId: string, lastSeen: number }]>} sessions
 * @param {{ principal: string, organizationId: string }} incoming
 * @param {{ perPrincipal: number, perOrg: number, total: number }} caps
 * @returns {string[]} ids of the sessions to close, least recently used first within each rule
 */
export function sessionsToEvict(sessions, incoming, caps) {
  const live = [...sessions]
    .map(([id, s]) => ({ id, principal: s.principal, org: s.organizationId, lastSeen: s.lastSeen }))
    .sort((a, b) => a.lastSeen - b.lastSeen);
  const evicted = new Set();

  const trim = (match, cap) => {
    const held = live.filter((s) => !evicted.has(s.id) && match(s));
    for (const s of held.slice(0, Math.max(0, held.length - cap + 1))) evicted.add(s.id);
  };
  trim((s) => s.principal === incoming.principal, caps.perPrincipal);
  trim((s) => s.org === incoming.organizationId, caps.perOrg);

  let left = live.filter((s) => !evicted.has(s.id));
  while (left.length > 0 && left.length >= caps.total) {
    const counts = new Map();
    for (const s of left) counts.set(s.org, (counts.get(s.org) ?? 0) + 1);
    // `left` is in least-recently-used order: the first session of the largest
    // organization is its oldest, and among equal organizations the one whose
    // session is the oldest overall goes first.
    let pick = left[0];
    for (const s of left) if (counts.get(s.org) > counts.get(pick.org)) pick = s;
    evicted.add(pick.id);
    left = left.filter((s) => s.id !== pick.id);
  }
  return [...evicted];
}
