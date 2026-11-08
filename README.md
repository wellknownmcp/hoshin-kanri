# Hoshin Kanri — MCP server

The MCP server behind [hoshin.app](https://hoshin.app): a living **X-Matrix**
your AI agent can read, challenge and update — 3-to-5-year objectives, annual
objectives, initiatives, KPIs, the correlations between them, the review
cadences that keep them alive, and a completeness score that gives a verdict
instead of a vibe.

**34 tools · 9 guided prompts · 2 transports · a Claude plugin · MCP revisions 2026-07-28 and 2025-11-25 · MIT.**

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

### Claude plugin — the connector and the know-how in one step

The plugin bundles the hosted connector with six skills that tell Claude how to work with an X-Matrix:
build one, run the review cycle, follow it on a schedule, share it outside without leaking what is
internal, build a cockpit, sync initiatives with Linear or Jira.

- **claude.ai, Claude desktop, Cowork**: Customize > Plugins > Add > Add marketplace, enter
  `wellknownmcp/hoshin-kanri`, then add **Hoshin Kanri X-Matrix** and connect its **hoshin** connector.
- **Claude Code**: `/plugin install hoshin-kanri --marketplace wellknownmcp/hoshin-kanri`

Source: [`mcp-server/plugin/hoshin-kanri`](mcp-server/plugin/hoshin-kanri).

### Hosted mode — OAuth 2.1, nothing to install

Any MCP client connects to `https://hoshin.app/mcp` (claude.ai, Claude Desktop, Claude Code, Cursor).
Dynamic client registration, Client ID Metadata Documents and PKCE: add the URL as a connector and
authorize. One connection acts in one organization, chosen on the consent screen.

<details>
<summary>Or with an API token</summary>

```json
{
  "mcpServers": {
    "hoshin-kanri": {
      "type": "http",
      "url": "https://hoshin.app/mcp",
      "headers": { "Authorization": "Bearer hk_..." }
    }
  }
}
```
</details>

### Sovereign local mode — nothing leaves your machine

Your matrix lives in plain JSON files on your own disk. No account, no cloud, no telemetry. This is the
default binary of the npm package, on purpose.

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

`HOSHIN_DATA_DIR` defaults to `~/hoshin-data/`. The files *are* the export: readable, diffable,
versionable, yours. See [docs/data-residency.md](docs/data-residency.md).

## What is in here

| Path | What |
|---|---|
| `mcp-server/index-local.js` | stdio transport, local JSON store — the npm default bin |
| `mcp-server/index-streamable-http.js` | Streamable HTTP transport, the one serving `hoshin.app/mcp` |
| `mcp-server/lib/tool-definitions.js` | the 34 tool schemas, shared by both transports |
| `mcp-server/lib/prompt-definitions.js` | the 9 guided prompts, shared by both transports |
| `mcp-server/lib/help.js` | `get_help`: the server's own manual, for clients that show no prompts |
| `mcp-server/lib/completeness.js` | the completeness score, as pure functions |
| `mcp-server/lib/cascade.js` | the group → business unit → site analysis, as pure functions |
| `mcp-server/lib/agenda.js` | what is due in the review cycle, as pure functions |
| `mcp-server/lib/xmatrix-svg.js` | the X-Matrix and initiative pages drawn as SVG |
| `mcp-server/lib/external-view.js` | what may leave an organization, for every external reading |
| `mcp-server/lib/matrix-view.js` | the MCP App view of `show_matrix` |
| `mcp-server/lib/json-store.js` | atomic local JSON store (tmp + rename, in-process mutex) |
| `mcp-server/plugin/hoshin-kanri` | the Claude plugin: connector and skills |
| `docs/completeness-score.md` | the score specification — metrics, weights, response shape |
| `docs/data-residency.md` | where your strategy lives, per transport |
| `server.json` | the MCP registry manifest |
| `.claude-plugin/marketplace.json` | the plugin marketplace of this repository |## Tools

The full list, grouped by what an agent does with them, is in
[`mcp-server/README.md`](mcp-server/README.md#tools). A few worth calling out:

- **`get_matrix_completeness`** returns a 0–100 score across five metrics (coverage, correlation density,
  orphan elements, end-to-end strategic chains, leading/lagging indicator balance) with the specific
  suggestions behind it. This is the part that makes an agent useful rather than agreeable.
- **`get_agenda`** tells a recurring agent where the organization stands in its review cycle and what is
  due, with stable keys and a `since` cursor so it never acts twice. **`record_review`** keeps the
  decisions as stated and a snapshot of the matrix the review saw; **`get_review`** reads it back.
- **`update_element_status`** records a KPI reading for a period with where it was read
  (`origin_tool`, `origin_ref`, `extracted_at`), or an initiative's progress; `external_ref` links the
  Linear/Jira/GitHub project. **`upsert_initiative_sheet`** and **`set_kpi_definition`** keep what a
  committee reads and how each number is computed.
- **`get_matrix_data`** with `audience: "external"` applies the filter of a public link: elements marked
  internal, figures and names never leave the organization. **`export_matrix_image`** draws the matrix
  for a deck (SVG or PNG, vision at the bottom or on top); **`show_matrix`** displays it in the
  conversation as an MCP App.
- **`get_cascade`** reads a deployment across levels — a group matrix, its business units, their sites.

`share_matrix` publishes a revocable, read-only public page of a matrix. It is **refused in local mode** —
by design: in sovereign mode there is no cloud for your data to leak into.


