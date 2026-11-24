---
name: build-x-matrix
description: Build or rework a Hoshin Kanri X-Matrix (policy deployment, strategy deployment) in hoshin.app, with long-term objectives, annual objectives, initiatives and KPIs, linked and scored. Use when the user wants to structure a strategy, cascade breakthrough objectives into annual objectives, turn a strategy note, plan or deck into an X-Matrix, add objectives, initiatives or KPIs, link them, run a catchball round on a draft, or says "Hoshin Kanri", "hoshin planning", "X-matrix", "policy deployment", "strategy deployment", "monte la X-Matrix", "construis notre matrice", "structure notre stratégie", "ajoute un chantier".
---

# Build an X-Matrix

The X-Matrix has four quadrants, always named this way in the tools, whatever way up a picture is drawn:
**north** = long-term objectives (3-5 years), **east** = annual objectives, **south** = initiatives,
**west** = KPIs. Correlations link adjacent quadrants only (north-east, east-south, south-west, west-north):
a KPI measures an annual objective through the initiatives that serve it.

Above the lines there is a written frame, `strategicContext` in `get_matrix_data`: the **purpose** of the
organization (why it exists, one text for all its matrices) and, per matrix, its **vision** (where it wants
to be at the horizon), its **context** (where it starts from) and its **tradeoffs** (what it gives up). The
lines of the north quadrant serve the vision; they are not the vision.

## Before writing

1. Call `whoami`: the organization this connection acts in, the role it really has, which matrices it may
   edit. One connection acts in one organization. If the strategy belongs to another organization the
   person has, tell them to add a second connector and choose that organization on the consent screen;
   never put it in the wrong one.
2. Call `list_matrices`. As soon as there is more than one, give `matrix_id` to every tool.
3. Read before you write: `get_matrix_data` shows what is already there. Do not duplicate elements.

## The frame first

1. Read `strategicContext` in `get_matrix_data`. If the organization already wrote why it exists and where
   it wants to be, build from it and say so. A `draft` in it is a proposal nobody validated: treat it as
   such.
2. If it is empty, ask before you propose a single line: why does the organization exist, where does it
   want to be at the horizon of this matrix, where does it start from, what does it give up? The person may
   have said it already in the conversation or in a document: reuse their words.
3. Store it with `set_strategic_context` (`purpose`, `vision`, `context`, `tradeoffs`; prose, not bullets).
   You write a draft. Give the person the link the tool returns: a person validates it in the app, never
   an agent. Do not wait for the validation to go on with the lines.
4. Never invent a purpose or a vision to fill the field. An empty frame is better than yours.

## Writing

1. `create_matrix` only if the person asked for a new matrix.
2. `upsert_element` per element. Keep each quadrant short: 3 to 5 long-term
   objectives, 3 to 7 annual objectives, 5 to 10 initiatives, 3 to 6 KPIs (the ranges the completeness score
   reads). Fewer leaves the strategy vague, more dilutes it. If the person lists ten long-term objectives, ask which few would change the position of
   the organization, and say what the others become (an annual objective, an initiative, business as
   usual). The choice is theirs.
   - A KPI is a number someone can read each period, with a level to reach. "Run training sessions" is an
     activity: it belongs in an initiative. When the person gives an activity as a KPI, say so and ask
     which number would show that it worked.
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
5. For each KPI, `set_kpi_definition`: formula, source system and reference, data owner, frequency, and
   `direction` (`up` when higher is better, `down` when lower is better). Ask the person rather than invent a
   formula. Without a direction the indicator board (`get_kpi_board`) gives no verdict on the KPI.

## Catchball before committing

A target handed down without an answer from the people who carry it is rarely realistic and rarely owned.

1. What leadership proposes goes in with `status: "draft"`. Say that it is a proposal.
2. Ask the person who will carry each annual objective and each initiative, and what they have answered:
   is the target reachable, with which capacity, depending on whom? You do not contact anyone and you do
   not answer for them. If nobody was asked yet, say so and offer to prepare the round: the draft lines,
   the questions, and a date. An organization that holds this round every year can keep it as a cadence
   (`upsert_cadence` with a name, the type `catchball`, a frequency and an operational level), then
   `schedule_review`; for a single round, a date agreed with the person is enough.
3. Write what came back in the person's words (`update_element_status` with `notes`), adjust targets and
   owners as they decide, then move the lines they confirm to `status: "active"`.
4. Read the owners in `get_matrix_data`: when one person carries most of the initiatives, say it. Whether
   that is a problem is the person's call.

## Check and show

- `get_matrix_completeness` scores the matrix and names what is missing; act on its suggestions with the
  person, do not chase the score alone.
- [references/example.md](references/example.md) shows a finished matrix and what its score points at.
- `show_matrix` displays the matrix and its initiative cards in the conversation.

## Rules

- The person decides the strategy. Propose titles, links and figures; write what they confirm.
- Never invent a figure. A value without a source stays empty.
- Mistakes: `delete_element` for a duplicate or an error; `update_element_status` with `cancelled` for
  something the organization dropped (its history stays). `delete_matrix` needs the exact name and
  cannot be undone; prefer `archive_matrix`.
- If something you need does not exist, say so with `report_missing_capability` (no strategy content in it).

## Connection

The tools named here come from the Hoshin Kanri MCP server. If they are not available in this session, say
so and tell the person how to connect it. Never act as if a tool had answered: without the server, nothing
is stored.

- Hosted: add the connector `https://hoshin.app/mcp` (sign in to hoshin.app, choose the organization).
- Local: `npx hoshin-kanri-mcp` keeps the matrices in JSON files on the machine and sends nothing
  anywhere. What involves other people exists only in the hosted app, and the tools say so when called:
  public links and page URLs, the directory of members (owners are free text), the validation of the
  written frame by a person, the excellence roadmap, and the sending of a missing-capability report.
