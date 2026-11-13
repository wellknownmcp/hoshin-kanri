# Hoshin Kanri X-Matrix

Run your organization's strategy as an X-Matrix with Claude, through the Hoshin Kanri connector
([hoshin.app](https://hoshin.app)): long-term vision, annual objectives, initiatives and KPIs, the
links between them, and the review cycle that keeps them alive.

## Install

- **claude.ai, Claude desktop, Cowork**: Customize > Plugins > Add > Add marketplace, enter
  `wellknownmcp/hoshin-kanri`, then add **Hoshin Kanri X-Matrix**.
- **Claude Code**:

```
/plugin install hoshin-kanri --marketplace wellknownmcp/hoshin-kanri
```

## Use it

Connect the bundled **hoshin** connector from the plugin's Connectors tab (you sign in to hoshin.app and
choose the organization). Then ask Claude in plain words:

- "Build our X-Matrix from this strategy note" — `build-x-matrix`
- "Prepare Thursday's monthly review" or "Record what the committee decided" — `run-review-cycle`
- "Check what is due in our strategy every Monday" (a scheduled task) — `agent-heartbeat`
- "Make a slide of our matrix for the board" — `share-outside`
- "Build a cockpit of our strategy for the leadership meeting" — `strategy-cockpit`
- "Sync our initiatives with Linear" — `weekly-sync`
- "Put this month's OEE from the plant pulse into the site matrix" — `plant-pulse-to-matrix`

The skills tell Claude the order of the tools, the defaults, and the rules that matter: people decide and
Claude records; elements marked internal never leave the organization; a review keeps a snapshot of what
it saw.

## Data

The plugin itself stores nothing and sends nothing. The connector sends what you and Claude write to your
hoshin.app organization (hosted in France, OVH) and reads it back, with the rights of the person who
connected it. Privacy policy: https://hoshin.app/legal/privacy. The connector's server is open source (MIT):
https://github.com/wellknownmcp/hoshin-kanri.
