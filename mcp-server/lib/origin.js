// Origin validation (MCP Streamable HTTP transport, MUST): a page of another
// site must not drive this server from a visitor's browser (DNS rebinding).
// Requests without Origin (servers, desktop and CLI clients) pass; loopback
// origins pass for local tools such as the MCP Inspector.

const DEFAULT_ORIGINS = 'https://hoshin.app,https://www.hoshin.app,https://claude.ai,https://claude.com';

export function allowedOrigins(env = process.env) {
  return new Set(
    (env.MCP_ALLOWED_ORIGINS || DEFAULT_ORIGINS)
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  );
}

export function originAllowed(origin, allowed) {
  if (!origin) return true;
  if (allowed.has(origin)) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}
