# Strategy cockpit

hoshin.app keeps the data and a plain reference view. This skill has your agent build the view you
want for a leadership meeting: an interactive page of the Hoshin Kanri X-Matrix, from the same data.

## What it does

- Reads the full matrix: elements, links and their strength, readings by period, initiative sheets, score.
- Builds one self-contained page, readable on a projector.
- Lights the elements linked to the one you click, and marks the elements linked to nothing.
- Applies what the meeting dictates ("this initiative is done", "the KPI is at 1.2") and refreshes.

## Ask for it

- "Build a cockpit of our strategy for the leadership meeting."
- "Une vue de la X-Matrix pour le comité."

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
