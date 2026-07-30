# Completeness score — specification

A single 0–100 number, plus the reasons behind it, answering a question an
agent cannot answer from prose: **is this X-Matrix actually coherent, or does it
merely look filled in?**

Implemented as pure functions in
[`mcp-server/lib/completeness.js`](../mcp-server/lib/completeness.js) and, in
the web application, in its TypeScript twin — a separate npm package cannot
import the app's sources, so the engine exists twice and a test in the web
application asserts that both produce the same score, the same level and the
same suggestion codes for the same matrix. A matrix scores identically in
sovereign mode and in the cloud, or CI fails.

Exposed as the MCP tool `get_matrix_completeness` and as
`GET /api/matrices/:id/completeness`.

This document is the contract. Where it disagrees with the code, the code wins
and this document is a bug.

## The object being scored

```
                 NORTH — Vision, 3-5 year breakthrough objectives
                          ↑
              NW ─────────┼───────── NE
                          │
   WEST ──────────────────┼────────────────── EAST
   KPIs, indicators       │       Annual objectives
                          │
              SW ─────────┼───────── SE
                          ↓
                 SOUTH — Initiatives, projects
```

Correlations exist only between **adjacent** quadrants — the four corners. That
constraint is what makes the matrix a deployment tool rather than a mind map:
a vision cannot be wired directly to a KPI without passing through an annual
objective and an initiative.

| Corner | Link | Meaning |
|---|---|---|
| `NE` | North ↔ East | vision → annual objectives |
| `SE` | South ↔ East | initiatives → annual objectives |
| `SW` | South ↔ West | initiatives → KPIs |
| `NW` | North ↔ West | vision → KPIs |

Correlation strength: `none` (ignored entirely), `weak` ○, `medium` ◐,
`strong` ●. Only `strength !== 'none'` counts as a link — everywhere, in every
metric.

## The five metrics

| Metric | Weight | Question it answers |
|---|---|---|
| Coverage | 15% | are all four quadrants populated, and plausibly sized? |
| Density | 20% | are the corners actually wired, or nearly empty? |
| Orphans | 20% | is anything floating unconnected? |
| Chains | 25% | does each vision reach a KPI end-to-end? |
| Indicator balance | 20% | is every objective measured by both a leading and a lagging indicator? |

Chains carry the heaviest weight on purpose. A matrix can be dense and still
strategically mute if no single thread runs from intent to measurement.

### 1. Coverage — 15%

Per-quadrant element count against a recommended range, averaged over the four
quadrants.

| Quadrant | Minimum | Recommended |
|---|---|---|
| North (vision) | 1 | 3–5 |
| East (annual objectives) | 1 | 3–7 |
| South (initiatives) | 1 | 5–10 |
| West (KPIs) | 1 | 3–6 |

Per-quadrant score: `0` if empty · `60` if below the recommended minimum ·
`80` if above the recommended maximum (over-loading a quadrant is a mild
problem, not a neutral one) · `100` inside the range.

### 2. Correlation density — 20%

For each corner, `density = actual links / (count(q1) × count(q2))`, scored in
bands and averaged over the corners that have a non-zero denominator:

| Density | Level | Corner score |
|---|---|---|
| `≥ 0.8` | `rich` | 100 |
| `0.5 – 0.8` | `good` | 75 |
| `0.2 – 0.5` | `minimal` | 50 |
| `> 0` | `sparse` | 25 |
| `0` | `sparse` | 0 |

A corner where either quadrant is empty reports `level: "n/a"` and contributes
nothing — it is already penalised by coverage, and counting it twice would
double-punish an empty matrix.

### 3. Orphan detection — 20%

An element is an orphan when it appears in **no** correlation of non-`none`
strength — an objective nobody owns, a KPI nobody reads.

Scored on the ratio of orphans to total elements: `≥ 50% → 20` ·
`≥ 30% → 40` · `≥ 15% → 60` · `> 0 → 80` · none → `100`.

### 4. Chain completeness — 25%

For every North element, walk the deployment path through the correlation graph:

```
North → East → South → West
```

A chain is complete when the walk reaches at least one West element. The score
is the share of visions with a complete chain, and the response names the
missing hop (`east`, `south` or `west`) for each incomplete one — which is the
part an agent can act on.

The walk is breadth-first over adjacency, so a vision counts as complete if
*any* path reaches a KPI, not only the shortest one.

### 5. Indicator balance — 20%

West elements carry an `indicatorType`:

- **`result`** (lagging) — measures outcomes: revenue, NPS, market share.
- **`performance`** (leading) — measures the process producing them: calls per
  week, cycle time, completion rate.

An East or South element is **balanced** when it is correlated to at least one
of each. The score is `balanced / analysed` across East and South combined.

Both types are required because one alone cannot be acted on: leading
indicators tell you whether you are doing the work, lagging indicators tell you
whether the work was worth doing. A matrix wired only to lagging indicators is
a scoreboard; only to leading ones, a to-do list.

KPIs with no `indicatorType` are reported as `unclassified` and count as
neither — an unclassified KPI cannot balance anything.

## Global score and levels

```js
score = 0.15 × coverage
      + 0.20 × density
      + 0.20 × orphans
      + 0.25 × chains
      + 0.20 × indicatorBalance
```

| Score | `level` key | Reading |
|---|---|---|
| 86–100 | `excellent` | complete and coherent, ready for review |
| 71–85 | `bon` | well built, strategic chains visible |
| 51–70 | `acceptable` | sound structure, orphans left to wire |
| 31–50 | `minimal` | skeleton present, correlations missing |
| 0–30 | `incomplet` | too incomplete to steer with |

The `level` keys are stable API identifiers with a French heritage
(`bon`, `incomplet`); treat them as opaque enum values and use `levelLabel` or
your own mapping for display. Renaming them would break existing consumers.

## Response shape

```jsonc
{
  "matrixId": "uuid",
  "matrixName": "Strategy 2027",
  "score": 72,
  "level": "bon",
  "levelLabel": "Bon",
  "details": {
    "coverage": {
      "score": 85,
      "north": { "count": 3, "min": 1, "ideal": "3-5",  "status": "ok",  "score": 100 },
      "east":  { "count": 5, "min": 1, "ideal": "3-7",  "status": "ok",  "score": 100 },
      "south": { "count": 4, "min": 1, "ideal": "5-10", "status": "low", "score": 60  },
      "west":  { "count": 2, "min": 1, "ideal": "3-6",  "status": "low", "score": 60  }
    },
    "density": {
      "score": 65,
      "NE": { "possible": 15, "actual": 8, "density": 0.53, "level": "good",    "score": 75 },
      "SE": { "possible": 20, "actual": 6, "density": 0.30, "level": "minimal", "score": 50 },
      "SW": { "possible": 8,  "actual": 2, "density": 0.25, "level": "minimal", "score": 50 },
      "NW": { "possible": 6,  "actual": 4, "density": 0.67, "level": "good",    "score": 75 }
    },
    "orphans": {
      "score": 80,
      "count": 2,
      "total": 14,
      "elements": [
        { "id": "uuid1", "quadrant": "south", "title": "Initiative X" },
        { "id": "uuid2", "quadrant": "west",  "title": "KPI Y" }
      ]
    },
    "chains": {
      "score": 67,
      "complete": 2,
      "incomplete": 1,
      "total": 3,
      "details": [
        {
          "vision": "Become the reference in our segment",
          "visionId": "uuid3",
          "path": { "east": ["Objective A"], "south": ["Initiative 1"], "west": ["Revenue"] },
          "complete": true,
          "missing": []
        },
        {
          "vision": "Product innovation",
          "visionId": "uuid4",
          "path": { "east": ["Objective B"], "south": [], "west": [] },
          "complete": false,
          "missing": ["south"]
        }
      ]
    },
    "indicatorBalance": {
      "score": 40,
      "kpiStats": { "total": 4, "result": 2, "performance": 1, "unclassified": 1 },
      "east":  { "total": 5, "balanced": 1, "score": 20, "details": [] },
      "south": { "total": 4, "balanced": 2, "score": 50, "details": [] },
      "unbalancedElements": [
        { "id": "uuid5", "title": "Objective A", "hasResult": true, "hasPerformance": false, "balanced": false, "missing": "performance" }
      ]
    }
  },
  "suggestions": [
    {
      "code": "coverage.low",
      "params": { "quadrant": "south", "count": 1 },
      "message": "Add 1 element(s) to Initiatives (South) to reach the recommended minimum"
    },
    {
      "code": "orphans.one",
      "params": { "quadrant": "south", "title": "Initiative X" },
      "message": "Link \"Initiative X\" (Initiatives (South)) to an adjacent element"
    },
    {
      "code": "chains.incomplete",
      "params": { "vision": "Product innovation", "missing": ["south"] },
      "message": "Vision \"Product innovation\" has no complete chain (missing: Initiatives (South))"
    }
  ],
  "aiContext": "Matrix \"Strategy 2027\" — score 72/100 (Good). Elements: 3 vision(s), … "
}
```

The `east.details` / `south.details` arrays are abridged above; each holds one
entry per analysed element, in the same shape as `unbalancedElements`.

## The suggestion contract

Suggestions are machine-readable first. `message` is the English rendering — the
agent surface, relayed verbatim to assistants. `code` and `params` let a UI
render the same suggestion in the reader's language, the same way the API error
contract works: localise from the code, never from the message.

`params` carry **raw keys, never rendered labels**: a quadrant travels as
`north`, a chain's missing hops as `["south"]`. A server that interpolated
"Initiatives (South)" into the string would make the sentence untranslatable —
which is precisely how these strings ended up locked to one language before.

| Code | Params |
|---|---|
| `coverage.empty` | `quadrant` |
| `coverage.low` | `quadrant`, `count` — elements missing to reach the *recommended* range |
| `density.sparse` | `corner`, `from`, `to` |
| `orphans.one` | `quadrant`, `title` |
| `orphans.many` | `quadrant`, `count` |
| `chains.incomplete` | `vision`, `missing` (quadrant keys) |
| `balance.unclassified` | `count` |
| `balance.noResult`, `balance.noPerformance` | — |
| `balance.missingBoth`, `balance.missingResult`, `balance.missingPerformance` | `title` |

Suggestions are emitted in metric order — coverage, density, orphans, chains,
indicator balance — and capped at 12, so the list is stable across runs rather
than ranked by leverage. Use the per-metric `score` values if you need to
prioritise. `aiContext` is a prose digest an assistant can quote without
re-deriving the numbers.

## Design notes

**Why weights at all.** Every metric is a proxy, and proxies get gamed. The
weighting says out loud what the score believes: connectedness (chains,
orphans, density = 65%) matters more than volume (coverage = 15%). You can add
elements all day without moving the score much.

**Why a score and not a checklist.** A checklist is passed and forgotten; a
number that drops when a KPI is deleted keeps a review honest. The score is
designed to be recomputed at every cadence and quoted in the meeting.

**Where it is deliberately blunt.** The score says nothing about whether an
objective is *ambitious*, whether a KPI is *measurable*, or whether an
initiative is *funded*. Those are judgement calls, and inventing a number for
them would be the false precision this score exists to avoid. That judgement is
the agent's job — the score just refuses to let structural gaps hide behind it.
