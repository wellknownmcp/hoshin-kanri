# Build a Hoshin Kanri X-Matrix

Hoshin Kanri (policy deployment, strategy deployment) turns a strategy into a few long-term objectives,
the annual objectives that serve them, the initiatives that should move those, and the KPIs that say
whether they do. The X-Matrix holds the four on one page, with the links between neighbours.

This skill has your agent build that matrix with you, in hoshin.app, where it stays: it can be reviewed
every month, scored, shared and read again by any agent the team uses.

## What it does

- Starts from the written frame: why the organization exists, where it wants to be, what it gives up. It asks; it never invents a purpose or a vision.
- Writes a few lines per quadrant, in your words, and pushes back on a list of ten long-term objectives.
- Calls out an activity dressed as a KPI, and asks which number would show that it worked.
- Links neighbours only, with a strength, and prefers no link to a weak one.
- Keeps a proposal as a draft until the people who carry it have answered (catchball).
- Fills the sheet of each initiative and the definition of each KPI (formula, source, owner, which way is better).
- Reads the completeness score and says what it points at, instead of chasing the number.

## Ask for it

- "Build our X-Matrix from this strategy note."
- "Cascade these three breakthrough objectives into annual objectives and initiatives."
- "Monte la X-Matrix de notre plan 2027."

A finished matrix and what its score points at: [references/example.md](references/example.md).

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
