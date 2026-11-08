// Caps on open subscriptions/listen streams (2026-07-28 HTTP leg), the counterpart of the
// 2025 session caps: each stream is a long-lived SSE response, so one token must not be
// able to hold them by the thousand, nor fill an organization's handler for everyone else.

export function createListenLimits({ perPrincipal = 10, total = 500 } = {}) {
  const open = new Map();
  let count = 0;
  return {
    /** A release function when a stream may open, or null past a cap. */
    acquire(principal) {
      const mine = open.get(principal) ?? 0;
      if (mine >= perPrincipal || count >= total) return null;
      open.set(principal, mine + 1);
      count++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (open.get(principal) ?? 1) - 1;
        if (left <= 0) open.delete(principal);
        else open.set(principal, left);
        count--;
      };
    },
    stats: () => ({ total: count, principals: open.size }),
  };
}
