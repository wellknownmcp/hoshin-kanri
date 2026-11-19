# Weekly strategy and execution sync

Strategy lives in the X-Matrix; tasks live in Linear, Jira, Asana or GitHub Projects. This skill has
your agent bring the progress of each project up to the initiative it serves in hoshin.app, once a week,
and surface what drifted.

## What it does

- Reads the initiatives and the project each one points to.
- Reads the project in the execution tool, through that tool's own connector.
- Updates progress and notes; proposes the health, which stays the owner's call.
- Surfaces initiatives with no project, and projects that serve no initiative (strategy drift).
- Prepares a one-page weekly agenda.

## Ask for it

- "Sync our initiatives with Linear."
- "Fais le point sur les chantiers."

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
