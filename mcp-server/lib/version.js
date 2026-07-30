/**
 * Single source of truth for the version advertised over MCP.
 *
 * Read from package.json so the three transports, the npm package and the
 * registry manifest can never drift apart. package.json is always shipped by
 * npm, so this resolves inside the published package too.
 */

import { readFileSync } from 'fs';

export const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;
