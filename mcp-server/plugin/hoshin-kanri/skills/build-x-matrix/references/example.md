# Example: the Hoshimeca X-Matrix

Hoshimeca is the fictional company of the hoshin.app demo: 120 people, precision machining, plants in
Dayton, Ohio and Wichita, Kansas. Every figure below is invented for the demo. The live matrix, with its
readings, initiative sheets and reviews, is at https://hoshin.app/demo (no account needed); it may hold
more than this page.

## The four quadrants

**North, long-term objectives (3-5 years)**

- N1. Become the Midwest reference in precision machining ($25M revenue by 2029)
- N2. Zero customer defects: aerospace-grade quality on every line
- N3. An attractive plant: retain key skills and attract the next generation

**East, annual objectives**

- E1. $16.5M revenue (+12%) with gross margin held
- E2. Customer non-conformity: from 1.8% to 0.8%
- E3. Cut average production lead time by 20%
- E4. Absenteeism below 4%

**South, initiatives**

- S1. In-line quality control with machine vision — milling shop
- S2. SMED program on the 3 bottleneck machining centers
- S3. AS9100 certification (aerospace market)
- S4. Operator cross-training plan (skills matrix)
- S5. Shop-floor scheduling overhaul (fine-grained planning)
- S6. Employer brand: community college partnership + onboarding track

**West, KPIs** (target, current value at the time of the seed)

| KPI | Type | Target | Current |
|---|---|---|---|
| W1. Monthly invoiced revenue ($M) | result | 1.38 | 1.29 |
| W2. Customer non-conformity rate (%) | result | 0.8 | 1.4 |
| W3. Internal defect PPM | performance | 450 | 720 |
| W4. Average lead time (days) | performance | 18 | 23 |
| W5. On-time delivery OTD (%) | result | 96 | 91 |
| W6. Changeover time (min) | performance | 25 | 41 |
| W7. Absenteeism (%) | result | 4 | 5.2 |
| W8. Operators certified on ≥3 workstations | performance | 24 | 15 |

Eight KPIs is above the 3 to 6 the score reads as ideal: the demo shows a matrix as companies write
them, not a model answer.

## The links

Only adjacent quadrants are linked. ● strong, ◐ medium, ○ weak, empty = no link.

**Long-term objective → annual objective**

| | E1 | E2 | E3 | E4 |
|---|---|---|---|---|
| N1 | ● | ◐ | ◐ | |
| N2 | | ● | ○ | |
| N3 | | | | ● |

**Annual objective → initiative**

| | S1 | S2 | S3 | S4 | S5 | S6 |
|---|---|---|---|---|---|---|
| E1 | | ◐ | ● | | ◐ | |
| E2 | ● | | ◐ | ○ | | |
| E3 | | ● | | ○ | ● | |
| E4 | | | | | | |

**Initiative → KPI**

| | W1 | W2 | W3 | W4 | W5 | W6 | W7 | W8 |
|---|---|---|---|---|---|---|---|---|
| S1 | | ● | ● | | | | | |
| S2 | | | | ◐ | ◐ | ● | | |
| S3 | ◐ | ◐ | ◐ | | ○ | | | |
| S4 | | | | | | | ◐ | ● |
| S5 | | | | ● | ● | | | |
| S6 | | | | | | | | |

The fourth corner, KPI → long-term objective, holds no link in the demo.

## What the matrix says about itself

Reading the chains from a long-term objective down to a KPI shows what holds and what does not.
`get_matrix_completeness` returns several suggestions for this matrix (among them the empty fourth corner and the
balance of the indicators). Two of them point at a hole in the plan itself:

- **S6, the employer brand, is linked to nothing.** The score names it as an orphan. It consumes effort
  and serves no stated objective. It reads like the plan for E4 and N3, but the link was never drawn, and
  no KPI says whether it works.
- **N3, the attractive plant, has no complete chain.** The score says its chain stops before the
  initiatives. The reason is one level down: E4, absenteeism below 4%, is the only annual objective under
  N3, and no initiative serves it. An annual objective is measured through the KPIs of its initiatives, so
  nothing measures E4 either, although an absenteeism KPI exists (W7, reached only through S4).

The useful answer is not to draw two links to raise the score: it is to ask the people whether S6 is the
plan for E4, and which number would show it.

A chain that holds, for comparison: N2 (zero customer defects) → E2 (non-conformity from 1.8% to 0.8%) →
S1 (machine vision in the milling shop) → W2 and W3 (customer non-conformity rate, internal defect PPM).
Each level says how the one above will be reached, and the last one is a number read every month.
