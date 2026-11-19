---
name: strategy-cockpit
description: Build an interactive view of the Hoshin Kanri X-Matrix from hoshin.app for a leadership meeting or the team (an artifact, a cockpit, a strategy dashboard). Use when the user asks for a cockpit, a visual of the matrix to project, an X-matrix dashboard, "un tableau de bord de la stratégie", "une vue de la X-Matrix pour le comité".
---

# Strategy cockpit

Hoshin keeps the data and a plain reference view; you build the presentation the person wants from the
same data. For a quick look in the conversation, `show_matrix` is enough. For a richer, interactive view:

1. `get_matrix_data` (pass `matrix_id` when there are several matrices; `audience: "external"` if the
   cockpit will be shown outside the organization). It returns every element, the correlations with their
   strength, the KPI readings by period with their status, the initiative sheets, the KPI definitions, and
   the completeness score. Do not use `get_matrix_summary`: it truncates. For a table of the KPIs month by
   month, `get_kpi_board` has the grouping by annual objective, the trend and the verdict already computed:
   use its figures rather than recompute them.
2. One self-contained page, no external assets. Layout around the center: north (vision) on top or at the
   bottom as the person prefers, east (annual objectives), south (initiatives), west (KPIs); the matrix name
   and score in the center.
3. Element cards: title, status (draft dashed, completed green, cancelled struck), current value against
   target for KPIs (values are text and may use a decimal comma), the health of each initiative, a link
   icon for an `externalRef` that is http or https only.
4. Interactions that matter: click an element to light its correlated elements (stronger = darker), click
   again to reset; a legend; a subtle mark on elements with no correlation.
5. Large type, high contrast, readable on a projector. Each initiative's `pageUrl` is the reference version:
   link to it.

During the meeting the person may dictate changes ("this initiative is done", "the KPI is at 1.2"): apply
them with `update_element_status` and `upsert_initiative_sheet`, then refresh the view. Decisions go in
`record_review` after the meeting.

## Connection

The tools named here come from the Hoshin Kanri MCP server. If they are not available in this session, say
so and tell the person how to connect it. Never act as if a tool had answered: without the server, nothing
is stored.

- Hosted: add the connector `https://hoshin.app/mcp` (sign in to hoshin.app, choose the organization).
- Local: `npx hoshin-kanri-mcp` keeps the matrices in JSON files on the machine and sends nothing
  anywhere. What involves other people exists only in the hosted app, and the tools say so when called:
  public links and page URLs, the directory of members (owners are free text), the validation of the
  written frame by a person, the excellence roadmap, and the sending of a missing-capability report.
