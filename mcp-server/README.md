# hoshin-kanri-mcp

MCP server for [Hoshin Kanri](https://hoshin.app) — the AI harness for
strategic steering. A living X-Matrix (3-5 year objectives, annual
objectives, initiatives, KPIs, correlations), review cadences, a
completeness score, and the prompts that let your AI agent run the
discipline: weekly execution sync, boardroom artifacts, deployment
diagnosis.

**11 tools · 9 guided prompts · 2 modes: sovereign local or remote API.**

## Quick start — sovereign local mode (nothing leaves your machine)

Your matrix lives in JSON files on your computer. No account, no cloud, no
telemetry — the strictest answer to "where does my strategy live?".

```json
// claude_desktop_config.json
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

`HOSHIN_DATA_DIR` defaults to `~/hoshin-data/`. Files are plain JSON —
readable, diffable, versionable, yours.

## Remote mode — the hoshin.app cloud API

Same tools against your organization on [hoshin.app](https://hoshin.app)
(EU-hosted, strict multi-tenant isolation, free tier):

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

Or skip the package entirely: claude.ai, Claude Desktop and Cursor connect
straight to `https://hoshin.app/mcp` with OAuth 2.1 — automatic discovery,
no token to paste.

## Tools

`get_matrix_data` (full matrix for views and artifacts) ·
`get_matrix_summary` · `get_matrix_completeness` (5-metric score) ·
`list_objectives` · `update_element_status` (accepts `external_ref` — link
to the Linear/Jira project) · `add_idea` · `search_ideas` ·
`get_management_architecture` · `diagnose_theme_deployment` ·
`suggest_meeting_for_topic` · `share_matrix` (publish a revocable read-only
public link — remote mode only, by design: in local mode your data has no
cloud to leak to).

## Prompts

`weekly_sync` (pull execution progress from Linear/Jira via their MCP,
update statuses, prepare the weekly review agenda) · `matrix_artifact`
(boardroom-ready interactive X-Matrix artifact) · `strategic_review` ·
`deployment_diagnosis` · `indicator_balance` · `meeting_setup_guide` ·
`visual_matrix` · `export_data` · `idea_triage`.

## Development (this directory)

`index-streamable-http.js` is the production HTTP transport served at
`https://hoshin.app/mcp` (port 3101 behind nginx) — it is not part of the
npm package. Env: `MCP_PORT`, `API_BASE_URL`, `OAUTH_ISSUER`.

```bash
npm install
npm run start:local   # sovereign JSON mode
npm run start:stdio   # remote API mode (AUTH_TOKEN, API_BASE_URL)
npm start             # streamable HTTP (server-side)
```

## Learn more

- [What is Hoshin Kanri?](https://hoshin.app/what-is-hoshin-kanri)
- [AI in lean management: start with steering](https://hoshin.app/ai-lean-management)
- Enterprise: federate this server behind your company's
  [Cortex Gateway](https://cortex-gateway.dev) as the steering backend.

MIT — the code is a commodity; your strategy is not.
