// Lot 2 check (docs/sprint-mcp-2026-07-28.md): v2 clients in each negotiation mode against an
// HTTP MCP endpoint. Read-only: whoami, get_help, get_agenda, the agenda resource, a listen stream.
// Usage: MCP_URL=https://hoshin.app/mcp MCP_TOKEN=hk_... node scripts/era-smoke.mjs
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = new URL(process.env.MCP_URL || 'http://127.0.0.1:3101/mcp');
const token = process.env.MCP_TOKEN;
if (!token) throw new Error('MCP_TOKEN is required');
const line = (k, v) => console.log(k.padEnd(28), typeof v === 'string' ? v : JSON.stringify(v));

async function run(label, mode) {
  const wire = [];
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (input, init) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      const res = await fetch(input, init);
      wire.push(`${init?.method ?? 'GET'} ${body?.method ?? ''} ${res.status}`);
      return res;
    },
  });
  const client = new Client({ name: 'era-smoke', version: '1' }, { versionNegotiation: { mode } });
  await client.connect(transport);
  line(`${label}: era`, client.getProtocolEra() ?? '?');
  line(`${label}: instructions`, Boolean(client.getInstructions()));
  const tools = (await client.listTools()).tools.map((t) => t.name);
  line(`${label}: tools`, tools.length);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: Boolean(r.isError), body: JSON.parse(r.content[0].text) };
  };
  const who = await call('whoami');
  line(`${label}: whoami`, { org: who.body.organization?.slug, kind: who.body.connection?.kind, canWrite: who.body.connection?.canWrite });
  const agenda = await call('get_agenda');
  line(`${label}: get_agenda`, { isError: agenda.isError, date: agenda.body.now?.date, open: agenda.body.openCount });
  const read = await client.readResource({ uri: 'hoshin://agenda' });
  line(`${label}: read agenda`, read.contents[0].uri);
  try {
    await client.readResource({ uri: 'hoshin://nope' });
  } catch (e) {
    line(`${label}: unknown resource`, e.code);
  }
  if (client.getProtocolEra() === 'modern') {
    const sub = await client.listen({ resourceSubscriptions: ['hoshin://agenda'] });
    line(`${label}: listen`, 'acknowledged');
    await sub.close?.();
  } else {
    await client.subscribeResource({ uri: 'hoshin://agenda' });
    line(`${label}: subscribe`, 'ok');
  }
  line(`${label}: wire`, wire.slice(0, 4));
  await client.close();
}

// MODES=auto,legacy to skip the pinned client (against a server with MCP_MODERN=off).
const modes = (process.env.MODES || 'pinned,auto,legacy').split(',');
if (modes.includes('pinned')) await run('pinned 2026', { pin: '2026-07-28' });
if (modes.includes('auto')) await run('auto', 'auto');
if (modes.includes('legacy')) await run('legacy', 'legacy');
