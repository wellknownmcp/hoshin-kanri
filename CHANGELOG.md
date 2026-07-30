# Changelog

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
