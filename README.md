# Hoshin Kanri — MCP server

The MCP server behind [hoshin.app](https://hoshin.app): a living **X-Matrix**
your AI agent can read, challenge and update — 3-to-5-year objectives, annual
objectives, initiatives, KPIs, the correlations between them, the review
cadences that keep them alive, and a completeness score that gives a verdict
instead of a vibe.

**16 tools · 9 guided prompts · 3 transports · MIT.**

Registry entry: [`io.github.wellknownmcp/hoshin-kanri`](https://registry.modelcontextprotocol.io)
· npm: [`hoshin-kanri-mcp`](https://www.npmjs.com/package/hoshin-kanri-mcp)

## Why this exists

Agents are good at doing the work and bad at knowing which work matters. The
missing piece is not more memory — it is *structured* strategic memory: an
object with quadrants, correlations and a score, so an agent can answer "does
this initiative actually serve a stated objective?" and be wrong out loud when
it does not.

That object is the X-Matrix, a Hoshin Kanri artifact that predates all of this
by forty years. This server exposes it over the Model Context Protocol.

## Install

### Sovereign local mode — nothing leaves your machine

Your matrix lives in plain JSON files on your own disk. No account, no cloud,
no telemetry. This is the default binary of the npm package, on purpose.

```json
{
  "mcpServers": {
    "hoshin-kanri": {
      "command": "npx",
      "args": ["-y", "hoshin-kanri-mcp"],
      "env": { "HOSHIN_DATA_DIR": "/path/to/your/data" }
    }
  }
}
```

`HOSHIN_DATA_DIR` defaults to `~/hoshin-data/`. The files *are* the export:
readable, diffable, versionable, yours. See [docs/data-residency.md](docs/data-residency.md).

### Hosted mode — OAuth 2.1, nothing to install

claude.ai, Claude Desktop and Cursor connect straight to `https://hoshin.app/mcp`.
Dynamic client registration + PKCE, so there is no token to paste and no
config file to edit — add the URL as a connector and authorize.

<details>
<summary>Or with a static API token, over stdio</summary>

```json
{
  "mcpServers": {
    "hoshin-kanri": {
      "command": "npx",
      "args": ["-y", "-p", "hoshin-kanri-mcp", "hoshin-kanri-mcp-remote"],
      "env": { "AUTH_TOKEN": "hk_..." }
    }
  }
}
```
</details>

## What is in here

| Path | What |
|---|---|
| `mcp-server/index-local.js` | stdio transport, local JSON store — the npm default bin |
| `mcp-server/index-stdio.js` | stdio transport against the hosted API |
| `mcp-server/index-streamable-http.js` | Streamable HTTP transport, the one serving `hoshin.app/mcp` |
| `mcp-server/lib/tool-definitions.js` | the 16 tool schemas, shared by all three transports |
| `mcp-server/lib/prompt-definitions.js` | the 9 guided prompts, shared by all three transports |
| `mcp-server/lib/completeness.js` | the completeness score, as pure functions |
| `mcp-server/lib/cascade.js` | the group → business unit → site analysis, as pure functions |
| `mcp-server/lib/json-store.js` | atomic local JSON store (tmp + rename, in-process mutex) |
| `docs/completeness-score.md` | the score specification — metrics, weights, response shape |
| `docs/data-residency.md` | where your strategy lives, per transport |
| `server.json` | the MCP registry manifest |

Tool and prompt *definitions* are shared across transports by design: only the
handlers differ. A tool that exists in hosted mode and not in local mode would
quietly make the sovereign mode a second-class citizen, so parity is a rule,
not an aspiration — with one deliberate exception, documented below.

## Tools

`get_matrix_data` · `get_matrix_summary` · `get_matrix_completeness` ·
`list_objectives` · `update_element_status` · `add_idea` · `search_ideas` ·
`get_management_architecture` · `diagnose_theme_deployment` ·
`suggest_meeting_for_topic` · `share_matrix` · `create_matrix` ·
`upsert_element` · `set_correlation` · `get_cascade` · `set_matrix_parent`

A few worth calling out:

- **`get_matrix_completeness`** returns a 0–100 score across five metrics
  (coverage, correlation density, orphan elements, end-to-end strategic chains,
  leading/lagging indicator balance) with the specific suggestions behind it.
  This is the part that makes an agent useful rather than agreeable.
- **`update_element_status`** accepts an `external_ref` — the URL or key of the
  Linear/Jira/GitHub project implementing that initiative. Strategy lives here,
  tasks live in your execution tool, and the `weekly_sync` prompt walks an agent
  across both.
- **`create_matrix`**, **`upsert_element`** and **`set_correlation`** let an
  agent build a strategy from nothing, then keep it current.
- **`get_cascade`** reads a deployment across levels — a group matrix, its
  business units, their sites. A matrix points to the one above it
  (`parent_matrix_id`, or `set_matrix_parent` later); an element points to the
  element of the parent matrix it deploys (`parent_element_id`). The report
  gives, for each level, the annual objectives and initiatives the children took
  up, the ones nobody took up, the child objectives anchored to nothing above,
  and a coverage percentage. Same org, no cycles, four levels at most.

`share_matrix` publishes a revocable, read-only public page of a matrix. It is
**refused in local mode** — by design: in sovereign mode there is no cloud for
your data to leak into, so there is nothing to publish from.

## Prompts

`weekly_sync` (pull execution progress from your issue tracker's MCP, update
statuses, prepare the weekly agenda) · `matrix_artifact` (a boardroom-ready
interactive X-Matrix) · `strategic_review` · `deployment_diagnosis` ·
`indicator_balance` · `meeting_setup_guide` · `visual_matrix` · `export_data` ·
`idea_triage`

## Development

```bash
cd mcp-server
pnpm install
pnpm start:local    # sovereign JSON mode
pnpm start:stdio    # hosted API mode (AUTH_TOKEN, API_BASE_URL)
pnpm start          # Streamable HTTP (server-side; MCP_PORT, API_BASE_URL, OAUTH_ISSUER)
```

Smoke-test the local transport without any client:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' \
  | HOSHIN_DATA_DIR=/tmp/hoshin-smoke node index-local.js 2>/dev/null
```

stdout carries JSON-RPC only; logs and the startup banner go to stderr.

This repository holds the MCP server and its specifications. The hosted web
application (Next.js, Prisma, the OAuth 2.1 authorization server) is a separate,
closed codebase — the MIT code here is what you run, and what you can audit
before running it.

Issues and pull requests are welcome, in English or French.

## Learn more

- [What is Hoshin Kanri?](https://hoshin.app/what-is-hoshin-kanri)
- [AI in lean management: start with steering](https://hoshin.app/ai-lean-management)
- [Model Context Protocol](https://modelcontextprotocol.io)

MIT — the code is a commodity; your strategy is not.
