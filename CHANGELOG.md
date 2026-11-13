# Changelog

## 4.8.0 — 2026-11-13 (since 4.5.0)

### Breaking

- No tool both reads and writes any more, as the Claude connectors directory requires.
  `share_matrix` only creates a public link (its `action` argument is gone): `list_matrix_shares` lists
  the links of a matrix, `revoke_matrix_share` ends one. `translate_roadmap` only writes and refuses a
  call with no text: `get_roadmap_translation` reads what is stored for a language.

### Added

- Every tool carries a `title`, on the tool and in its annotations.
- **Excellence roadmap** (hosted only): a maturity grid assessed site by site, each site being a matrix of
  the cascade. `get_excellence_roadmap`, `assess_roadmap_item` (a level and its evidence, in the site's
  draft self-assessment), `get_roadmap_translation` and `translate_roadmap` (one grid, several languages;
  writing a translation needs an organization admin), and two MCP App views on `ui://hoshin/roadmap`:
  `show_roadmap` (one site, item by item) and `show_site_comparison` (sites side by side). `get_agenda`
  reports the roadmap items that need attention. In local mode these tools answer that the roadmap lives
  in the hosted app.
- **Plugin 1.1.1**: the `plant-pulse-to-matrix` skill, which carries a plant agent's daily records (the
  Claude for Manufacturing morning plant pulse and Quality Register, read with the Artifact and ArtifactData
  tools) up to the site matrix.

### Security (hosted HTTP transport only)

- Sessions are capped per organization (`MCP_MAX_SESSIONS_PER_ORG`, 200), whatever number of credentials it holds.
  When the session map is full, the organization holding the most sessions gives up its least recently used one,
  so a newcomer is always admitted (`lib/session-room.js`).
- A session kept alive by an open stream has its credential validated again after 12 hours without a request
  (`MCP_SESSION_STREAM_IDLE_MS`), and is closed if it is refused.

## 4.5.0 — 2026-11-08 (since 3.1.0)

### Breaking (4.0.0)

- The stdio bridge to the hosted API (`hoshin-kanri-mcp-remote`) is retired: connect to
  `https://hoshin.app/mcp` over HTTP, with OAuth or an API token in the `Authorization` header.
- Built on the MCP SDK v2. Two protocol revisions are served: 2026-07-28 (stateless, `server/discover`)
  and 2025-11-25 (`initialize`, sessions).

### Added

- **Claude plugin** (`mcp-server/plugin/hoshin-kanri`, marketplace at the repository root): the hosted
  connector and six skills.
- **`show_matrix`**: the X-Matrix and its initiative cards as an MCP App (SEP-1865, `ui://hoshin/matrix`),
  displayed in the conversation by hosts that support it; text elsewhere.
- **Review cycle**: `get_agenda` (and the `hoshin://agenda` resource), `schedule_review`,
  `record_review` (decisions as stated, a snapshot of the matrix), `get_review`, `upsert_cadence`.
- **KPI readings by period** with their source (`origin_tool`, `origin_ref`, `extracted_at`) and a
  provisional or final status; a progress log for objectives and initiatives.
- **`upsert_initiative_sheet`**, **`set_kpi_definition`**, **`list_members`**.
- **What may leave an organization**: elements marked `internal`, `get_matrix_data`
  `audience: "external"`, `share_matrix` `hide_figures` and `full_sheets`.
- **`export_matrix_image`**: the matrix as SVG or PNG, vision at the bottom or on top, or one page per
  initiative.
- **Repair**: `archive_matrix`, `delete_matrix` (exact name required), `delete_element`.
- **Identity and help**: `whoami`, `get_help` (the manual, for clients that show neither the server
  instructions nor the prompts), `report_missing_capability`.

### Fixed

- The server instructions named the quadrants the other way round from the writing tools: north = vision,
  east = annual objectives, south = initiatives, west = KPIs.

## 3.1.0

### Added — strategy deployed across levels

- **`get_cascade`** and **`set_matrix_parent`**. Hoshin kanri is deployed
  floor by floor: what the group decides this year (annual objectives,
  initiatives) becomes what a business unit must achieve, then a site. A matrix
  can now point to the matrix above it, and an element to the element of the
  parent matrix it deploys. `get_cascade` returns the tree, and for each
  parent → children edge: what was taken up and by whom, what nobody took up,
  the children's objectives anchored to nothing above, and a coverage
  percentage. Cancelled and completed elements are left out of the counts.
- **`create_matrix`** takes `parent_matrix_id`; **`upsert_element`** takes
  `parent_element_id` (an empty string removes the link). Links are refused on
  the matrix itself, in a cycle, beyond four levels, or to an element outside
  the direct parent matrix. Moving a matrix under another parent clears the
  element links that no longer point into it.
- Local JSON mode implements both tools, with the same rules. The analysis is
  a pure module (`lib/cascade.js`) kept identical to the hosted one by a parity
  test.

### Fixed

- Local JSON mode: changing an element's quadrant through `upsert_element` now
  moves it to the new quadrant instead of leaving it filed under the old one.

### Security

- **An HTTP session is bound to the principal that opened it.** The
  `Mcp-Session-Id` alone used to be enough to drive a session, and `GET` /
  `DELETE /mcp` asked for no token. Every request now needs a Bearer whose
  principal (API token, or OAuth user + client) matches the session; anything
  else gets `404 SESSION_NOT_FOUND`. A session is only created by an
  `initialize` request, with caps per principal (`MCP_MAX_SESSIONS_PER_PRINCIPAL`,
  default 50, least recently used evicted) and in total
  (`MCP_MAX_SESSIONS_TOTAL`, default 2000).
- **Tool ids can no longer leave their resource.** Ids such as `matrix_id` or
  `share_id` are interpolated into API paths, and `fetch` resolves `..` and cuts
  at `?` or `#`: a crafted id could turn one tool into a call on another
  endpoint with the user's token. `lib/safe-endpoint.js` now refuses any path
  segment outside `[A-Za-z0-9_-]` and any query string a tool could not have
  built, in both remote transports. Local JSON mode refuses unsafe matrix ids
  the same way, so an id cannot point outside the data directory.

## 3.0.0

### Added — an agent can now build a strategy, not only read one

- **`create_matrix`**, **`upsert_element`** and **`set_correlation`**. Until now
  the server could read a matrix, score it, diagnose a theme and move a status
  forward, but the structure itself had to be typed into a web UI. An agent can
  now start from nothing: create the matrix, add each objective, KPI and
  initiative, wire the adjacent quadrants, then ask
  `get_matrix_completeness` what is still missing.

  `upsert_element` creates when given a `quadrant` and a `title`, and updates
  when given an `element_id`. `set_correlation` with `strength: "none"` removes a
  link. Both accept an optional `matrix_id` and otherwise target the default
  matrix.

### Fixed

- **Local JSON mode hung on every element write.** `updateElement` held the
  per-matrix lock and then called `saveMatrix`, which waited for that same lock:
  a non-reentrant mutex waiting on its own caller. `update_element_status` — the
  only write path sovereign mode had — never returned. The mutex is now
  reentrant, and local writes are covered by tests that run under a timeout, so a
  hang fails instead of stalling.
- **Tool schemas advertised values the API rejects.** `add_idea` failed on its
  own default: it offered
  `conversation | team_meeting | customer_feedback | market_analysis | internal_audit | other`
  where the API accepted
  `team_meeting | client_feedback | market_watch | internal | other` — two values
  in common out of six. `conversation` is now a first-class source (for an
  agent-first product it is the most informative provenance there is) and the
  enums are aligned. `on_hold`, offered by `list_objectives` and
  `update_element_status`, never existed on the API side and is gone.

### Breaking

- **`get_matrix_completeness` returns structured suggestions.** `suggestions`
  was `string[]`; it is now an array of `{ code, params, message }`. Read
  `message` for the English prose an assistant can relay verbatim — it is the
  direct replacement for the old string. Use `code` + `params` to render the
  suggestion in another language.

  ```diff
  - "suggestions": ["Ajouter 1 élément(s) dans Initiatives …"]
  + "suggestions": [{
  +   "code": "coverage.low",
  +   "params": { "quadrant": "south", "count": 1 },
  +   "message": "Add 1 element(s) to Initiatives (South) to reach the recommended minimum"
  + }]
  ```

  The twelve codes and their params are documented in
  [docs/completeness-score.md](docs/completeness-score.md#the-suggestion-contract).

### Fixed

- **The score answers in English.** `suggestions` and `aiContext` were emitted in
  French while the rest of the agent surface is English, so an English-speaking
  user in sovereign local mode received a French diagnosis. `levelLabel` is now
  English too; the `level` keys (`bon`, `incomplet`, …) are unchanged, they are
  stable API identifiers.
- **"Add 0 element(s)".** The coverage suggestion counted the elements missing to
  reach the *hard minimum* instead of the recommended range, so a quadrant just
  under the range was told to add zero elements.
- **Idle sessions are swept** (Streamable HTTP transport). Clients are supposed
  to end a session with `DELETE /mcp` and often do not; every abandoned session
  kept a transport, an MCP server instance and a bearer token alive for the
  lifetime of the process. Sessions holding an open SSE stream are exempt.
  Tunable with `MCP_SESSION_IDLE_MS` (default 30 min) and `MCP_SESSION_SWEEP_MS`
  (default 5 min); `GET /health` now reports the live session count.

### Changed

- The version advertised over MCP is read from `package.json`, so the three
  transports, the npm package and the registry manifest cannot drift apart.

## 2.0.1

First release of this repository. The MCP server was previously published from a
private monorepo; the code it shipped is unchanged. See the
[registry entry](https://registry.modelcontextprotocol.io) for
`io.github.wellknownmcp/hoshin-kanri`.
