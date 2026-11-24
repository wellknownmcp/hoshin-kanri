---
name: run-review-cycle
description: Prepare, run and record a Hoshin Kanri strategy review in hoshin.app, the check and act of the PDCA cycle. Use when the user mentions a monthly committee, monthly business review, quarterly review, bowling chart or bowler, comité de pilotage, revue mensuelle, a KPI reading to take, initiative progress, an agenda to prepare, or "consigne les décisions", "prépare la revue", "on a eu le comité".
---

# Run the review cycle

## Know where things stand

1. `whoami`, then `list_matrices` (give `matrix_id` when there are several).
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
3. Agenda for the people: `get_kpi_board` gives the KPIs month by month under the annual objective each one
   measures, with the trend and whether the target is met (`onTarget`). Bring the KPIs off target, the
   readings still missing, the objectives nothing measures; then the initiatives at risk and the decisions
   waiting. A KPI whose `direction` is not set has no verdict: do not judge it yourself, ask which way is
   better and record it with `set_kpi_definition`. Give the people the board's `pageUrl`. Keep it to one page.
4. No review scheduled: propose a date, and once a person agrees, `schedule_review`.

## After the review

1. `record_review` right after the meeting, before correcting any figure: it keeps a snapshot of the
   matrix as it stands (values, progress, health, latest readings, score), the base of the decisions.
2. `decisions`: one entry per decision, in the participants' words. Never write a decision nobody stated;
   ask when unsure. `discussed_element_ids` for what was discussed, `held_on` if not today.
3. `get_review` reads a review and its snapshot back, even after figures were corrected.

### What the period taught: four questions before closing

A review that only lists figures and decisions learns nothing. Before you record it, offer the people four
questions on the period that just ended, taken one at a time. They answer; you do not answer for them, and
you do not rank the answers. Bring the facts first (the board of `get_kpi_board`, the decisions of the
previous review in `get_agenda`).

1. **What did we expect?** The decisions and targets of the last review, as recorded.
2. **What happened?** The readings and the progress, as they stand. Facts, not causes yet.
3. **Why the difference?** Where it went better as much as where it went worse. No blame: the question
   is about the work, not the person.
4. **What do we keep, and what do we change?** What comes out as a decision goes in `decisions`, in the
   participants' words.

Write the answers to the first three in `notes`, under the heading "What the period taught". If the
people have no time for it, skip it and say nothing more: it is an offer, not a gate.

This is the after-action review of the US Army (*A Leader's Guide to After-Action Reviews*, Training
Circular 25-20, September 1993; Morrison and Meliza, *Foundations of the After Action Review Process*, US
Army Research Institute, 1999). The four questions above are worded for a strategy review; the pattern
(what was intended, what happened, why, what to sustain and what to improve) is theirs.

## Rules

- People decide, you prepare and record.
- A value without a source is not a reading: ask, or leave it.
- Corrections after a review are fine (late data): the snapshot keeps what the committee saw.

## Connection

The tools named here come from the Hoshin Kanri MCP server. If they are not available in this session, say
so and tell the person how to connect it. Never act as if a tool had answered: without the server, nothing
is stored.

- Hosted: add the connector `https://hoshin.app/mcp` (sign in to hoshin.app, choose the organization).
- Local: `npx hoshin-kanri-mcp` keeps the matrices in JSON files on the machine and sends nothing
  anywhere. What involves other people exists only in the hosted app, and the tools say so when called:
  public links and page URLs, the directory of members (owners are free text), the validation of the
  written frame by a person, the excellence roadmap, and the sending of a missing-capability report.
