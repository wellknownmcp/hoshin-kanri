# Run the Hoshin Kanri review cycle

A matrix built once and filed does nothing. Hoshin Kanri lives through its reviews: readings taken
against targets, initiatives updated, decisions written down, the plan adjusted (the check and act of PDCA).

This skill has your agent prepare a review, then record what the people decided, in hoshin.app.

## What it does

- Reads what is due: reviews to prepare or record, KPIs missing the reading of the last closed period, initiatives without an update, overdue actions.
- Takes each KPI reading where its definition says, and stores where it was read.
- Prepares a one-page agenda from the KPI board (each KPI month by month, against its target for the year): off target, missing, at risk.
- Records the review with the decisions in the participants' words, and a frozen snapshot of the matrix as the committee saw it.
- Offers four questions on the period (expected, happened, why, what we keep and change), from the after-action review.

## Ask for it

- "Prepare Thursday's monthly review."
- "Record what the committee decided."
- "Prépare la revue mensuelle."

## What you need

The skill drives the tools of the Hoshin Kanri MCP server; alone, it stores nothing.

- Hosted: add the connector `https://hoshin.app/mcp` to your agent and sign in to
  [hoshin.app](https://hoshin.app).
- Local: `npx hoshin-kanri-mcp` keeps the matrices in JSON files on your machine and sends nothing
  anywhere. What involves other people exists only in the hosted app: public links and page URLs, the
  directory of members, the validation of the written frame by a person, the excellence roadmap.

The whole set (eight skills and the connector) also installs as one Claude plugin. Plugin, server and
skills are open source (MIT): https://github.com/wellknownmcp/hoshin-kanri.

The procedure the agent follows is in [SKILL.md](SKILL.md).
