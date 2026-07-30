# Changelog

## 3.0.0

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
