# Share an X-Matrix outside the organization

A strategy holds things that must not leave: named clients, amounts, salaries. This skill has your
agent share a Hoshin Kanri X-Matrix from hoshin.app with a board, investors, a partner or a client, with
the filter decided by the app and not by the agent.

## What it does

- Checks first that what must stay inside is marked internal.
- Reads the external version: no internal element, no value, no name, no reading.
- Exports a picture for a deck (PNG or SVG, one page per initiative if wanted).
- Creates a read-only public link that can be revoked, with or without figures.
- Says what it left out.

## Ask for it

- "Make a slide of our matrix for the board."
- "Partage la matrice avec notre investisseur, sans les chiffres."

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
