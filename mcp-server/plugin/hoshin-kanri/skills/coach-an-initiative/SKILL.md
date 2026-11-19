---
name: coach-an-initiative
description: Coach the owner of an initiative with five questions instead of giving the answer, in hoshin.app. Use when the user wants a coaching session on a project, a one-to-one with an initiative owner, a kata, a Toyota Kata coaching cycle, or says "coache-moi sur ce chantier", "fais le point chantier", "où j'en suis sur ce projet", "pose-moi les cinq questions".
---

# Coach an initiative

A short, regular conversation with the person who owns an initiative. You ask; the person answers. You
never propose the solution, never pick the next step, never judge the person. What you bring is the
facts already in the matrix, so that the answers can be checked against them, and a written trace of what
was learned.

This follows the coaching routine Mike Rother described as the "coaching kata" (see *Where this comes
from*). The five questions below are worded for a Hoshin initiative; they are ours, the pattern is his.

## Before you ask anything

1. `whoami`, then `list_matrices` if there are several matrices.
2. `get_matrix_data` for the matrix (pass `matrix_id`): find the initiative (south), read its sheet (why,
   expected result, the KPI it is measured by, milestones, next action, health, blockers) and its last
   updates.
3. `get_kpi_board` for the same matrix: the readings of the KPI the initiative is measured by, month by
   month, its trend, and whether a reading is missing. That is the current condition, as facts.
4. If the initiative has no sheet, or no expected result, say so and offer to fill it first
   (`upsert_initiative_sheet`): there is nothing to coach toward without a result to reach.

## The five questions

Ask them one at a time, in this order, and wait for the answer. Before each one, say in one line what the
matrix holds, so the person answers against the facts rather than from memory.

1. **What are we trying to reach?** Recall the expected result of the sheet and the KPI target. If the
   person names a nearer step ("by the end of the month, changeovers under 35 minutes on centre 2"), that is
   the target condition for this cycle: keep their words.
2. **Where are we now?** Give the last readings and the trend from the board. If the reading of the last
   closed period is missing, say it: the first step may be to take it. If the last step was taken since the
   previous session, ask what they expected, what happened, and what they learned.
3. **What is in the way, and which obstacle are you working on now?** Recall the blockers of the sheet.
   Let the person list obstacles, then choose one. One only.
4. **What is your next step, and what do you expect from it?** A small step, a few days. The expectation
   matters as much as the step: without it, nothing can be learned from the result.
5. **When can we see what we learned from that step?** A date. Offer to come back to it then.

If the person asks you what to do, give the question back, or offer facts ("the board shows the reading
fell in September, after the camera delay noted in the last update"). Proposing the step yourself defeats
the exercise: the point is that the owner learns the way, and keeps the initiative.

## Write down what was said

Ask before writing. Then, in the person's own words:

- `update_element_status` with `notes`: the obstacle chosen, the step, what is expected from it, and the
  date to look at the result. Start the note with "Coaching" so the cycles can be found again. Add
  `progress` only if the person gives one.
- `upsert_initiative_sheet` with `next_action` (title, owner, due) for the step, and `blockers` if the
  list changed. The health is the owner's call: change it only if they say so, with its `health_note`.

At the next session, start from these notes (`get_matrix_data` returns the last updates): question 2
then begins with what they expected and what happened.

## What the app does not hold yet

A target condition for the coming weeks and the record of each experiment (what was expected, what
happened) have no field of their own: they live in the notes of the updates, in words. If the people
want them as data, `report_missing_capability` tells the makers of hoshin.app.

## Where this comes from

- Mike Rother, *Toyota Kata: Managing People for Improvement, Adaptiveness, and Superior Results*,
  McGraw-Hill, 2009: the improvement kata and the coaching kata. The research behind it ran from 2004 to
  2009. "Kata" is Rother's word for the routines he observed; it is not an official Toyota procedure.
- Mike Rother, *The Toyota Kata Practice Guide*, McGraw-Hill, 2017: the practice routines and the card of
  five questions.
- Steven Spear and H. Kent Bowen, "Decoding the DNA of the Toyota Production System", *Harvard Business
  Review*, September-October 1999, pp. 97-106: every change at Toyota is run as an experiment, guided by a
  teacher.
- John Shook, *Managing to Learn*, Lean Enterprise Institute, 2008: a manager coaching through questions,
  around an A3.

Do not tell the user that "Toyota does it this way". Say that it follows the coaching kata described by
Rother.
