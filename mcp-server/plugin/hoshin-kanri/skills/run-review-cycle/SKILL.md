---
name: run-review-cycle
description: Prepare, run and record a strategy review in hoshin.app. Use when the user mentions a monthly committee, quarterly review, comité de pilotage, revue mensuelle, a KPI reading to take, initiative progress, an agenda to prepare, or "consigne les décisions", "prépare la revue", "on a eu le comité".
---

# Run the review cycle

## Know where things stand

1. `whoami`, then `list_matrices` (pass `matrix_id` when there are several).
2. `get_agenda`: today's date (UTC), the reviews ahead, the last reviews and their decisions, and what is
   due: reviews to prepare or record, cadences with no review scheduled, KPIs missing the reading of the
   last closed period, initiatives without an update, overdue actions.
3. No cadence yet? Ask how the organization reviews its strategy, then `upsert_cadence` (name, type,
   frequency, operational level). `get_management_architecture` lists the existing ones.

## Before the review

1. KPI readings: read each KPI's definition in `get_matrix_data` (`kpiDefinition`), take the value where it
   says, then `update_element_status` with `current_value`, `period` (`YYYY-MM` or `YYYY-Qn`) and where it
   was read: `origin_tool`, `origin_ref`, `extracted_at`. A reading of an open period is provisional and may
   be corrected; once the period has ended it is final.
2. Initiatives: `update_element_status` with `progress` and `notes`; `upsert_initiative_sheet` for the next
   action and the health. The health is the owner's call: propose it, with its `health_note`.
3. Agenda for the people: KPIs off target (read the direction first: lower is better for defects, costs,
   lead time), initiatives at risk, decisions waiting. Keep it to one page.
4. No review scheduled: propose a date, and once a person agrees, `schedule_review`.

## After the review

1. `record_review` right after the meeting, before correcting any figure: it keeps a snapshot of the
   matrix as it stands (values, progress, health, latest readings, score), the base of the decisions.
2. `decisions`: one entry per decision, in the participants' words. Never write a decision nobody stated;
   ask when unsure. `discussed_element_ids` for what was discussed, `held_on` if not today.
3. `get_review` reads a review and its snapshot back, even after figures were corrected.

## Rules

- People decide, you prepare and record.
- A value without a source is not a reading: ask, or leave it.
- Corrections after a review are fine (late data): the snapshot keeps what the committee saw.
