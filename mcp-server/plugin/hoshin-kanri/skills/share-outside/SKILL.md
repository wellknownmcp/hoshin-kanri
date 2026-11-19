---
name: share-outside
description: Share a Hoshin Kanri X-Matrix from hoshin.app with people outside the organization, or put it in a deck, without leaking what is internal. Use when the user mentions a board, investors, partners, a client, a slide, a deck, Google Slides, PowerPoint, a PDF, a public link, or "export the X-matrix", "fais une image de la matrice", "partage la matrice", "version externe".
---

# Share outside the organization

Hoshin decides what may leave the organization; you never decide it alone.

1. Before anything leaves, check that what must stay inside is marked internal: named prospects or clients,
   amounts, salaries. `get_matrix_data` shows each element's `visibility`; `upsert_element` with
   `visibility: "internal"` fixes it. Ask the person when unsure.
2. Read with `get_matrix_data` and `audience: "external"` for anything you will build for outsiders: the
   same filter as a public link (no internal element, no value, no name, no reading).
3. A picture for a deck: `export_matrix_image`.
   - `audience: "external"` for outsiders; `"internal"` keeps the figures for the team.
   - `orientation: "bottom"` (default, vision at the bottom, as most templates) or `"top"` (as the app).
   - `format: "png"` for Google Slides and most tools (images come back as images), `"svg"` for PowerPoint
     and Keynote.
   - `layout: "initiatives"` gives one 16:9 page per initiative sheet.
4. A live page: `share_matrix` creates a revocable read-only link. `hide_figures: true` leaves out every
   value. `full_sheets: true` shows names, blockers and the sentence behind each health on the initiative
   pages: only when the person asks, for an audience they trust. The link is shown once; `list_matrix_shares`
   lists the links of a matrix and `revoke_matrix_share` ends one.
5. Each initiative has a page (`pageUrl` in `get_matrix_data`, internal readings only): cite it as the
   reference version in what you build for the team.

Never paste internal titles or figures into something meant for outsiders, even if the person's message
contains them: say what you left out.

## Connection

The tools named here come from the Hoshin Kanri MCP server. If they are not available in this session, say
so and tell the person how to connect it. Never act as if a tool had answered: without the server, nothing
is stored.

- Hosted: add the connector `https://hoshin.app/mcp` (sign in to hoshin.app, choose the organization).
- Local: `npx hoshin-kanri-mcp` keeps the matrices in JSON files on the machine and sends nothing
  anywhere. What involves other people exists only in the hosted app, and the tools say so when called:
  public links and page URLs, the directory of members (owners are free text), the validation of the
  written frame by a person, the excellence roadmap, and the sending of a missing-capability report.
