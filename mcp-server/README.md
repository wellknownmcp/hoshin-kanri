# hoshin-kanri-mcp

MCP server for [Hoshin Kanri](https://hoshin.app) — the X-Matrix all of a
company's agents share. A living X-Matrix (3-5 year objectives, annual
objectives, initiatives, KPIs, correlations), review cadences, a
completeness score, and the prompts that guide your AI agent through the
discipline: weekly execution sync, boardroom artifacts, deployment
diagnosis. Hoshin computes; the agent reasons; people decide.

**34 tools · 9 guided prompts · 2 modes: sovereign local (this package) or hosted (`https://hoshin.app/mcp`). MCP revisions 2026-07-28 and 2025-11-25.**

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

## Hosted mode — your organization on hoshin.app

Same tools against your organization on [hoshin.app](https://hoshin.app)
(EU-hosted, strict multi-tenant isolation, free tier), over Streamable HTTP,
no package to install:

- **claude.ai, Claude Desktop, Cursor:** add a custom connector with the URL
  `https://hoshin.app/mcp`. OAuth 2.1 does the rest — automatic discovery,
  you approve access in the browser, no token to paste.
- **Agents, scripts, Claude Code:** an API token (`hk_...`, created by an admin
  in Settings → API tokens) in a Bearer header:

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

**Upgrading from 3.x:** 4.0.0 removes the `hoshin-kanri-mcp-remote` stdio
bridge. Replace its `command`/`args`/`env.AUTH_TOKEN` entry with the
connector URL above, or with the `url` + `Authorization` header form. Node 20
or later is required.

## Tools

**Write:** `create_matrix` · `upsert_element` · `set_correlation` ·
`set_matrix_parent` (group → business unit → site) ·
`update_element_status` (status, a KPI's `current_value` with where it was
read — `origin_tool`, `origin_ref`, `extracted_at` —, `external_ref` — link to
the Linear/Jira project) · `add_idea` · `update_idea` (triage) ·
`upsert_initiative_sheet` (what a committee reads about an initiative: why,
expected result, milestones, next action, health with its sentence, blockers) ·
`set_kpi_definition` (formula, source system and reference, data owner,
frequency) · `upsert_cadence` (create or change a review cadence)

**Repair:** `delete_element` (a duplicate or a mistake) · `archive_matrix` ·
`delete_matrix` (asks for the matrix's exact name; cannot be undone)

**Read and judge:** `list_matrices` (find the site, unit or language you are
asked about) · `get_matrix_data` (full matrix with KPI targets and current
values, for views and artifacts; `audience: "external"` applies the public-link
filter for anything shown outside the organization) · `get_matrix_summary` ·
`get_matrix_completeness` (5-metric score) · `get_cascade` (what each level
took up, what nobody did) · `list_objectives` · `search_ideas` ·
`get_management_architecture` · `diagnose_theme_deployment` ·
`suggest_meeting_for_topic` · `list_members` (who can own an element)

**Review cycle:** `get_agenda` (today, the reviews ahead, and what is due
before them: reviews to prepare or record, KPIs missing a reading, initiatives
without an update, overdue actions; pass `since` from a recurring agent) ·
`schedule_review` · `record_review` (notes, decisions as stated, elements
discussed; keeps a snapshot of the matrix as it stood) · `get_review` (the
decisions and that snapshot, after any correction). Also a resource, `hoshin://agenda`, with subscriptions.

**Identity and help:** `whoami` (who this connection acts as, the role it
actually has, the plan and its limits, which matrices it may edit) · `get_help`
(the server's own manual: workflows, the heartbeat recipe, modeling rules, the
text of the prompts for clients that do not show them, rights, error codes, local mode) ·
`report_missing_capability` (tell us what you needed; in local mode nothing is
sent, you get the text to file as an issue).

**Publish:** `share_matrix` (a revocable read-only public link — remote mode
only, by design: in local mode your data has no cloud to leak to; elements marked
`visibility: "internal"` never appear, and `hide_figures` leaves out every value) ·
`export_matrix_image` (the X-Matrix as an SVG for a deck, vision at the bottom by
default or on top with `orientation: "top"`; `layout: "initiatives"` gives one
page per initiative sheet; `format: "png"` returns images instead of SVG text;
`audience: "external"` leaves out internal elements and figures) ·
`show_matrix` (the X-Matrix and a card per initiative, displayed in the conversation by
hosts that support MCP Apps, such as claude.ai on the web; text elsewhere).

The three write tools mean an agent can build a strategy from nothing:
`create_matrix`, then `upsert_element` per objective, KPI and initiative, then
`set_correlation` to wire adjacent quadrants — and `get_matrix_completeness` to
tell it what is still missing.

## Prompts

`weekly_sync` (pull execution progress from your execution tool via its MCP,
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
npm start             # streamable HTTP (server-side)
```

## Learn more

- [What is Hoshin Kanri?](https://hoshin.app/what-is-hoshin-kanri)
- [AI in lean management: start with steering](https://hoshin.app/ai-lean-management)
- Enterprise: federate this server behind your company's
  [Cortex Gateway](https://cortex-gateway.dev) as the steering backend.

MIT — the code is a commodity; your strategy is not.
