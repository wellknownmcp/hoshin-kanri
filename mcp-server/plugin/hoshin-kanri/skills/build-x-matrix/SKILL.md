---
name: build-x-matrix
description: Build or rework a Hoshin Kanri X-Matrix in hoshin.app. Use when the user wants to structure a strategy, turn a strategy note, plan or deck into an X-Matrix, add objectives, initiatives or KPIs, link them, or asks "monte la X-Matrix", "construis notre matrice", "structure notre stratégie", "ajoute un chantier", "Hoshin Kanri".
---

# Build an X-Matrix

The X-Matrix has four quadrants, always named this way in the tools, whatever way up a picture is drawn:
**north** = long-term vision (3-5 years), **east** = annual objectives, **south** = initiatives,
**west** = KPIs. Correlations link adjacent quadrants only (north-east, east-south, south-west, west-north):
a KPI measures an annual objective through the initiatives that serve it.

## Before writing

1. Call `whoami`: the organization this connection acts in, the role it really has, which matrices it may
   edit. One connection acts in one organization. If the strategy belongs to another organization the
   person has, tell them to add a second connector and choose that organization on the consent screen;
   never put it in the wrong one.
2. Call `list_matrices`. As soon as there is more than one, pass `matrix_id` to every tool.
3. Read before you write: `get_matrix_data` shows what is already there. Do not duplicate elements.

## Writing

1. `create_matrix` only if the person asked for a new matrix.
2. `upsert_element` per element. Aim for 3 to 5 per quadrant: fewer leaves the strategy vague, more
   dilutes it.
   - Give each KPI `indicator_type` (`result` or `performance`), a `target_value` and `unit` when known.
   - Use `status: "draft"` for a hypothesis the committee has not validated yet.
   - Set `visibility: "internal"` at creation for anything that must not leave the organization: named
     prospects or clients, amounts, salaries, anything said in confidence. Do it now, not before a share.
   - Owners: `list_members` gives the ids for `owner_id`. Inviting a person is done by an admin in the app.
3. `set_correlation` between adjacent quadrants. Strength: `strong` = designed for it or measures it
   directly; `medium` = contributes clearly but is not the main lever; `weak` = indirect or partial. When in
   doubt, no link rather than a weak one.
4. For each initiative, `upsert_initiative_sheet`: why, expected result, `measured_by` (the KPI), 3 to 6
   milestones, the next action, and a health only with its `health_note`. If an execution tool holds the
   project, set `external_ref` on the element and keep the sheet as a summary.
5. For each KPI, `set_kpi_definition`: formula, source system and reference, data owner, frequency. Ask the
   person rather than invent a formula.

## Check and show

- `get_matrix_completeness` scores the matrix and names what is missing; act on its suggestions with the
  person, do not chase the score alone.
- `show_matrix` displays the matrix and its initiative cards in the conversation.

## Rules

- The person decides the strategy. Propose titles, links and figures; write what they confirm.
- Never invent a figure. A value without a source stays empty.
- Mistakes: `delete_element` for a duplicate or an error; `update_element_status` with `cancelled` for
  something the organization dropped (its history stays). `delete_matrix` needs the exact name and
  cannot be undone; prefer `archive_matrix`.
- If something you need does not exist, say so with `report_missing_capability` (no strategy content in it).
