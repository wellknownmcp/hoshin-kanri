# From the plant pulse to the X-Matrix

A plant agent runs daily management: yesterday's output, OEE, downtime, nonconformances. The X-Matrix
holds the strategy those numbers serve, read once a period. This skill carries up only what the strategy
reads, from the morning plant pulse and Quality Register of the Claude for Manufacturing plugin, or from
any daily production report.

## What it does

- Matches the plant to its site matrix and reads which KPIs are defined as coming from the plant records.
- Computes the monthly reading by the same rules as the plant plugin: a gap is never a zero.
- Writes the reading with its source, the days it rests on and the gaps by name.
- Turns recurring problems into ideas, one per pattern, never into initiatives: the review decides.
- Proposes evidence for the excellence roadmap; people validate an assessment.

## Ask for it

- "Put this month's OEE from the plant pulse into the site matrix."
- "Mets le TRS du mois dans la matrice."

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
