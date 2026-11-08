---
name: agent-heartbeat
description: What a recurring or scheduled agent does at each pass on a hoshin.app strategy. Use when the user sets up a scheduled task, a weekly check, a "heartbeat", a routine that follows the strategy, or asks "vérifie chaque lundi ce qui est dû", "surveille nos indicateurs", "tâche planifiée Hoshin".
---

# Heartbeat on the strategy

At each pass:

1. `whoami` once per session.
2. `get_agenda` with `since` = the time of the previous pass, so nothing is handled twice. Each item has a
   stable `key` and the date it became due.
3. For each item, by `kind`:
   - `review_upcoming`: prepare it. Take the readings that are due, update the initiatives, write the agenda
     for the people (`get_matrix_data`). You may do this alone; send it to the people who run the review.
   - `review_unrecorded`: the review was held and not recorded. Ask the people what was decided, then
     `record_review` with their words. Never write decisions nobody stated.
   - `review_unscheduled`: propose a date to a person; `schedule_review` only once they agree.
   - `kpi_reading_missing`: read the KPI's definition (`get_matrix_data`, `kpiDefinition`), take the value
     where it says, then `update_element_status` with `current_value`, `period`, `origin_tool`,
     `origin_ref`, `extracted_at`. You may do this alone.
   - `initiative_stale`: get the progress from the execution tool (`external_ref`) or ask the owner, then
     `update_element_status` with `progress` and `notes`, and `upsert_initiative_sheet` for the next action.
     The health is the owner's call: propose it.
   - `action_overdue`: remind the person it is assigned to; never close it in their place.
4. Write what you did in one short message to the people concerned.

Keep your schedule, your `since` cursor and your collection recipe (which tool to query for which KPI) in
your own configuration: they are how you work, not the strategy. What the team needs tomorrow without you
(definitions, readings and their source, sheets, decisions) belongs in Hoshin.
