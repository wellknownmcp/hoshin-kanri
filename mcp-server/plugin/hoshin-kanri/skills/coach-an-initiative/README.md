# Coach an initiative

A short, regular conversation with the person who owns an initiative. The agent asks five questions
and brings the facts already in the matrix; the owner answers. The agent never proposes the solution.

It follows the coaching kata described by Mike Rother (*Toyota Kata*, McGraw-Hill, 2009). "Kata" is
Rother's word for the routines he observed; it is not an official Toyota procedure.

## What it does

- Reads the initiative sheet and the readings of the KPI it is measured by.
- Asks: what are we trying to reach, where are we now, which obstacle are you working on, what is your next step and what do you expect from it, when can we see what we learned.
- Gives the question back when asked what to do.
- Writes what was said, in the owner's words, so the next session starts from it.

## Ask for it

- "Coach me on the SMED project."
- "Coache-moi sur ce chantier."

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
