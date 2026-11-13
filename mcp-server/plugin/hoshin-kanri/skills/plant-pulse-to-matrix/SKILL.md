---
name: plant-pulse-to-matrix
description: Turn what a plant agent already produces (the morning plant pulse and Quality Register of the Claude for Manufacturing plugin, or any daily production report) into the monthly KPI readings, improvement ideas and roadmap evidence of the site's hoshin.app matrix. Use when the user asks "mets le TRS du mois dans la matrice", "monthly OEE reading from the plant pulse", "what does the quality register say for our objectives", "use the production reports as evidence for the roadmap", or when a kpi_reading_missing item points to the plant pulse.
---

# From the plant pulse to the strategy

Two layers, two rhythms. The plant agent runs daily management: yesterday's output against the production
plan, OEE, downtime, nonconformances and their 8Ds, each day, for the people on the floor. Hoshin holds the
strategy: the targets those numbers serve, read once a period, the initiatives that should move them, and
the maturity of each site. Carry up only what the strategy reads. Never copy daily figures, tickets or
CAPAs into Hoshin, and never write a target: targets are decided by people, in Hoshin.

## 1. Find the site and its KPIs

1. `whoami`, then `list_matrices`. In a cascade, a site is a matrix. Match the site name of the plant
   records to its site matrix; if two could fit, ask once.
2. `get_matrix_data` with `matrix_id` of that site. A KPI (west) is read from the plant records only when its
   definition says so. If it has no definition yet, propose one and store it with `set_kpi_definition` once
   the person agrees:
   - `formula`: for OEE, "mean of the daily site OEE over the production days of the month with complete
     data (availability x performance x quality, as the morning plant pulse computes it)";
   - `source_system`: "Claude for Manufacturing, morning plant pulse";
   - `source_ref`: the site's Operations Command Center dashboard, its day records, the field read;
   - `data_owner`: the person who answers for the number at the site; `frequency`: "monthly".

## 2. Find the plant records

The plant plugin keeps two dashboards per site in the Claude artifact store of the account that ran it,
each with its own database: "<Site>: Operations Command Center" (collection "pulse_days", one record per
production day, key "<Site>_YYYY-MM-DD") and "<Site>: Quality Register" (collection "ncrs", one record per
nonconformance, key "<Site>_<NCR ref>").

1. Find the dashboard: the Dashboards block of the plant's Open work page first, then the `Artifact` tool,
   action list, matching the exact title.
2. Read its records with the `ArtifactData` tool, action query or list, on that dashboard and collection.
   Keep the keys of the period's production days.
3. The dashboards are private to the account that ran the plant plugin. Run this skill in that account,
   or have the dashboard shared with the person who runs it; whether a shared dashboard's records can be
   read from another account has not been checked.
4. If this session has no artifact tools, or no dashboard is found, do not estimate: ask the person for
   the morning reports or the exports of the period, and say the reading rests on them.

## 3. Read the period, absent is not zero

Follow the same rules as the plant plugin:

- A record with "data_complete" false, or a field that is null, is a gap, never a zero and never 1.0.
- Ratios (oee, availability, performance, quality): mean over the complete days where the field is not
  null. Below half the production days of the period, write no reading: say which days are missing. The
  mean is unweighted; if the definition asks for a time-weighted figure, the day records cannot give it,
  so say so.
- Quantities ("planned_qty", "actual_qty"): sum per unit, never across units. Output against plan is
  actual over planned, per unit, over the days where both are present.
- Sums (downtime minutes, losses): only when every production day of the period is covered; otherwise no
  reading. A loss priced on a placeholder rate ("rate_source" is "profile_placeholder") is not a KPI
  reading. Keep the currency as given.
- A day with "output_provisional" true makes the output reading provisional: say so in the note.

## 4. Write the reading

`update_element_status` on the KPI, with:
- `current_value` in the unit of the KPI (OEE 0.712 is 71.2 when the KPI is in %);
- `period`: the month, e.g. 2026-11;
- `notes`: how many days the figure rests on, out of how many, and the gaps by name;
- `origin_tool`: "Claude for Manufacturing, morning plant pulse"; `origin_ref`: the dashboard and the first
  and last record keys; `extracted_at`: the newest "data_as_of" of the records read.

A month still running gives a provisional reading in Hoshin; write it again once the month is closed. If a
reading for that period already exists, say what changes before replacing it.

## 5. From recurring problems to ideas, never to initiatives

Read the period in the Quality Register. The bad-actor ranking of breakdown-diagnosis is not stored: use
it only when the person runs it or gives it. Propose an idea, with `add_idea`, when:
- a nonconformance recurs and the previous fix did not hold ("recurrence", "previous_fix_held" false);
- the same leading cause comes back across several 8Ds of the period;
- an 8D labels an action "improvement, not corrective action";
- the same machines stay at the top of the bad-actor ranking month after month.

Give the idea a one-line `title`, the evidence in `description` (counts, references, the period), the
`linked_element_id` of the objective or KPI it serves, the NCR or 8D references in `links`, and `source`
"internal". The review decides what becomes an initiative (`run-review-cycle`). Correcting a defect stays in
daily management; an idea is for what the plant must get better at.

## 6. Evidence for the excellence roadmap

`get_excellence_roadmap` with the site's `matrix_id`. Some items are answered by what the plant agent keeps,
for instance: indicators read on time (the day records and their gaps), what happens when a defect appears
(the Quality Register: containment, 8D steps, effectiveness checks), breakdowns analyzed and preventive
maintenance kept (breakdown-diagnosis and its PM changes). Propose a level with `assess_roadmap_item`
(`level`, `evidence` citing the records and the period, `remark`). It is a draft: people validate an
assessment, in the app.

The agentic level means the team owns the practice, an agent watches it against the standard and signals
the gaps, and people decide. A dashboard that refreshes alone is not enough: the evidence is that the
team acts on the exceptions it shows.
