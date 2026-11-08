// Both protocol revisions over stdio (docs/sprint-mcp-2026-07-28.md, lot 3): launches a stdio
// server (default index-local.js) once per era with a v2 client and prints a JSON summary.
// Run by src/lib/mcp-eras.test.ts; usable by hand: node scripts/stdio-era-check.mjs [server.js]
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.resolve(here, '..', process.argv[2] || 'index-local.js');

async function once(mode) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env }, stderr: 'ignore' });
  const client = new Client({ name: 'stdio-era-check', version: '1' }, { versionNegotiation: { mode } });
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((t) => t.name);
  const prompts = (await client.listPrompts()).prompts.length;
  const who = JSON.parse((await client.callTool({ name: 'whoami', arguments: {} })).content[0].text);
  const agenda = JSON.parse((await client.callTool({ name: 'get_agenda', arguments: {} })).content[0].text);
  const unknown = await client.callTool({ name: 'nope', arguments: {} });
  const resource = (await client.readResource({ uri: 'hoshin://agenda' })).contents[0].uri;
  let missing = null;
  try {
    await client.readResource({ uri: 'hoshin://nope' });
  } catch (e) {
    missing = e.code;
  }
  const era = client.getProtocolEra();
  if (era === 'modern') await (await client.listen({ resourceSubscriptions: ['hoshin://agenda'] })).close?.();
  else await client.subscribeResource({ uri: 'hoshin://agenda' });
  const result = { era, instructions: Boolean(client.getInstructions()), tools: tools.length, prompts, mode: who.mode ?? who.organization?.slug, agendaDate: agenda.now?.date, unknownToolIsError: Boolean(unknown.isError), resource, missing };
  await client.close();
  return result;
}

const out = { modern: await once({ pin: '2026-07-28' }), legacy: await once('legacy') };
console.log(JSON.stringify(out));
