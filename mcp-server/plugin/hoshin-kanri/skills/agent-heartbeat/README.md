# Agent heartbeat on the strategy

For an agent that runs on a schedule (every Monday, every morning) rather than when someone asks.
It tells the agent what to do at each pass on a Hoshin Kanri strategy kept in hoshin.app, without
handling anything twice.

## What it does

- Reads the agenda since the previous pass: each item has a stable key and the date it became due.
- Does alone what an agent may do alone: take a KPI reading at its source, prepare a review.
- Asks a person for the rest: a date, a decision, the health of an initiative.
- Never writes a decision nobody stated, never closes an action in someone's place.

## Ask for it

- "Check what is due in our strategy every Monday."
- "Vérifie chaque lundi ce qui est dû."

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
