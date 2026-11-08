---
name: weekly-sync
description: Sync the initiatives of a hoshin.app X-Matrix with the execution tool (Linear, Jira, Asana, GitHub Projects) and prepare the weekly agenda. Use when the user asks for a weekly sync, "fais le point sur les chantiers", "mets à jour l'avancement depuis Linear/Jira", or strategy drift.
---

# Weekly strategy and execution sync

Routing rule: objectives, initiatives, KPIs, reviews and decisions live in Hoshin; tasks, issues, sprints
and boards live in the execution tool. Never copy tasks into Hoshin, never put strategy in the execution
tool.

1. `list_objectives` with `quadrant: "south"` (and `matrix_id` when there are several matrices) for the
   initiatives. Each may carry an `externalRef`, the project in the execution tool.
2. For each initiative with an `externalRef`, read the project in the execution tool through its own
   connector: progress, recently done, blocked, overdue.
3. Where something moved, `update_element_status`: `progress` (0-100, from done against total scope;
   initiatives only), `notes` in one or two lines (decisions and blockers, not a task list; do not repeat last
   week's), `status: "completed"` when the project shipped. Update the next action and, as a proposal, the
   health with `upsert_initiative_sheet`.
4. Gaps: initiatives without an `externalRef` (propose a link; the person confirms, then store it with
   `update_element_status` `external_ref`), and projects in the execution tool that serve no initiative
   (strategy drift: surface them).
5. Weekly agenda: KPIs off target (read the direction first) and moving away from it in their recent readings
   (`get_matrix_data`), blocked or stalled initiatives, drift, decisions waiting. One page, titled with the
   date.
