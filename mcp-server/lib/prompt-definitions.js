/**
 * MCP Prompt Definitions for Hoshin Kanri
 * Shared between stdio, streamable-http, and local modes.
 */

export const promptsList = [
  {
    name: 'strategic_review',
    description: 'Guide for conducting a strategic review of the X-Matrix with Mermaid visualizations',
    arguments: []
  },
  {
    name: 'idea_triage',
    description: 'Help prioritize and categorize ideas in the inbox, with export-ready tables',
    arguments: []
  },
  {
    name: 'indicator_balance',
    description: 'Analyze and improve the balance between result (lagging) and performance (leading) indicators',
    arguments: []
  },
  {
    name: 'deployment_diagnosis',
    description: 'Full strategic deployment analysis with cascade diagram',
    arguments: []
  },
  {
    name: 'meeting_setup_guide',
    description: 'Guide for setting up the right meeting cadences with hierarchy diagram',
    arguments: []
  },
  {
    name: 'visual_matrix',
    description: 'Generate visual representations of the X-Matrix: Mermaid diagrams, Excalidraw JSON, or structured views',
    arguments: [
      {
        name: 'format',
        description: 'Output format: mermaid (default), excalidraw, or both',
        required: false
      }
    ]
  },
  {
    name: 'export_data',
    description: 'Format Hoshin Kanri data for Excel/CSV export: matrices, ideas, KPIs, action items',
    arguments: [
      {
        name: 'scope',
        description: 'What to export: all (default), matrix, ideas, kpis, actions',
        required: false
      }
    ]
  },
  {
    name: 'matrix_artifact',
    description: 'Build a shareable interactive X-Matrix artifact (leadership cockpit): full matrix rendered for boardroom projection, refreshable from live data, shareable with the team on claude.ai Team/Enterprise plans',
    arguments: [
      {
        name: 'matrix_id',
        description: 'UUID of the matrix to render (optional, uses the first active matrix)',
        required: false
      }
    ]
  },
  {
    name: 'weekly_sync',
    description: 'Sync strategy with execution: pull progress from the execution tool (Linear, Jira...) via its MCP, update initiative statuses, prepare the weekly cadence agenda',
    arguments: [
      {
        name: 'execution_tool',
        description: 'Name of the execution tool whose MCP is connected (default: Linear)',
        required: false
      }
    ]
  }
];

const promptMessages = {
  strategic_review: {
    description: 'Strategic Review Guide',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Please help me conduct a strategic review of my Hoshin Kanri X-Matrix.

Start by using get_matrix_summary to understand the current state.
Then use list_objectives to review each quadrant:
- North: Are our long-term objectives still relevant?
- East: Are annual objectives aligned and on track?
- South: Are actions and projects progressing?
- West: Are KPIs moving in the right direction?

Finally, check search_ideas for any pending items that should be integrated.

**Visual output:**
After your analysis, generate a Mermaid diagram showing the strategic chain status:
\`\`\`mermaid
graph TD
  subgraph "Vision (North)"
    N1["Objective title"]
  end
  subgraph "Annual (East)"
    E1["Objective title"]
  end
  subgraph "Initiatives (South)"
    S1["Initiative title"]
  end
  subgraph "KPIs (West)"
    W1["KPI title"]
  end
  N1 -->|strong| E1
  E1 -->|medium| S1
  S1 -->|strong| W1
\`\`\`
Use arrow labels (strong/medium/weak) and color-code nodes by status:
- Active: default
- Completed: style with green (#22c55e)
- On hold: style with amber (#f59e0b)
- At risk (orphan or broken chain): style with red (#ef4444)

Also present a summary table of each quadrant suitable for copy-paste into Excel.`
        }
      }
    ]
  },
  idea_triage: {
    description: 'Idea Triage Guide',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Help me triage ideas in my Hoshin Kanri inbox.

Use search_ideas with status=inbox to see pending ideas.
For each idea, help me decide:
1. Is this aligned with our strategic objectives? (use list_objectives to check)
2. What priority should it have?
3. Should it be accepted, rejected, or needs more review?

Group related ideas and suggest which quadrant they might belong to if accepted.

**Output format:**
Present the triage results as a markdown table ready for Excel export:

| # | Title | Priority | Recommendation | Target Quadrant | Aligned With | Reasoning |
|---|-------|----------|---------------|-----------------|-------------|-----------|

Group related ideas visually with a Mermaid mindmap:
\`\`\`mermaid
mindmap
  root((Ideas Inbox))
    Strategic Alignment
      Idea A
      Idea B
    Quick Wins
      Idea C
    Needs Review
      Idea D
\`\`\``
        }
      }
    ]
  },
  indicator_balance: {
    description: 'Indicator Balance Analysis',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Analyze the balance of indicators in my X-Matrix and help me improve it.

**Context on Indicator Types:**
- **Result indicators (lagging)**: Measure OUTCOMES - what we achieved
  Examples: Revenue (CA), Net Promoter Score (NPS), Market share, Customer satisfaction
- **Performance indicators (leading)**: Measure PROCESS - how we work
  Examples: Calls per week, % tasks completed, Velocity, Time to response

**Best practice:** Each objective (East quadrant) and initiative (South quadrant) should ideally be linked to BOTH types of indicators to:
1. Track if we're doing the right activities (performance/leading)
2. Verify if those activities produce the desired results (result/lagging)

**Your task:**
1. Use get_matrix_completeness to get the current indicator balance score
2. Identify which objectives/initiatives are missing indicators
3. For each unbalanced element, suggest:
   - If missing RESULT indicator: what outcome should we measure?
   - If missing PERFORMANCE indicator: what process metric should we track?
4. Prioritize suggestions based on strategic importance

Focus on the indicatorBalance section of the completeness response, particularly:
- kpiStats: current distribution of result vs performance indicators
- unbalancedElements: list of objectives/initiatives needing attention

**Visual output:**
Show the indicator balance as a Mermaid diagram:
\`\`\`mermaid
graph LR
  subgraph "Objectives (East)"
    E1["Objective"]
  end
  subgraph "Result KPIs"
    R1["Revenue"]:::result
  end
  subgraph "Performance KPIs"
    P1["Calls/week"]:::perf
  end
  E1 --> R1
  E1 -.->|MISSING| P1
  classDef result fill:#3b82f6,color:#fff
  classDef perf fill:#f59e0b,color:#fff
\`\`\`
Use solid arrows for existing links, dashed arrows with "MISSING" label for gaps.
Also provide an Excel-ready table: | Element | Quadrant | Has Result | Has Performance | Missing | Suggestion |`
        }
      }
    ]
  },
  deployment_diagnosis: {
    description: 'Strategic Deployment Diagnosis',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Conduct a full strategic deployment diagnosis of my organization's management system.

Follow these steps:

1. **Management Architecture Review**
   Call get_management_architecture to see the complete meeting hierarchy.
   - How many levels are covered? (strategic, tactical, operational_mgmt, team_mgmt, execution)
   - Are there gaps in the hierarchy?
   - Is there a clear cascade from strategic reviews down to daily stand-ups?

2. **X-Matrix Completeness**
   Call get_matrix_completeness to get the current structural score.
   - What is the overall completeness score?
   - Are there orphan elements or broken chains?
   - Is the indicator balance healthy?

3. **Theme Deployment Analysis**
   For each strategic theme, call diagnose_theme_deployment to check if it is properly cascaded.
   - Which themes are well-deployed vs. poorly-deployed?
   - At which hierarchy levels are there coverage gaps?

4. **Synthesis & Recommendations**
   Combine all findings into a structured diagnosis:
   - Overall deployment health score
   - Top 3 critical gaps (themes not reaching operational level, missing cadences, etc.)
   - Prioritized action plan to improve deployment
   - Quick wins vs. structural changes needed

**Visual output:**
Generate a Mermaid diagram showing the deployment cascade:
\`\`\`mermaid
graph TD
  subgraph "Strategic"
    S["Annual Review"]
  end
  subgraph "Tactical"
    T["QBR"]
  end
  subgraph "Operational"
    O["Monthly Review"]
  end
  subgraph "Team"
    W["Weekly"]
  end
  subgraph "Execution"
    D["Daily"]
  end
  S --> T --> O --> W --> D
\`\`\`
Color-code each level: green (covered), amber (partial), red (missing).
Add theme coverage indicators per level.

Present the results clearly with scores, status indicators, and actionable recommendations.`
        }
      }
    ]
  },
  meeting_setup_guide: {
    description: 'Meeting Setup Guide',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Help me set up the right meeting cadences for my organization's management system.

Follow these steps:

1. **Current State Review**
   Call get_management_architecture to see what cadences already exist.
   - Which hierarchy levels have meetings?
   - Which levels are missing?
   - Are there redundant cadences?

2. **Matrix Elements Analysis**
   Call get_matrix_summary and list_objectives to understand the X-Matrix content.
   - What quadrants have the most elements?
   - Which elements need regular review?

3. **Gap Identification**
   Based on Hoshin Kanri best practices, identify missing cadences:
   - Every organization needs at minimum: Strategic Review (yearly), QBR (quarterly), Monthly Review
   - Team-level (weekly) and execution (daily) cadences depend on organizational structure
   - Each quadrant should be the primary focus of at least one cadence type

4. **Cadence Recommendations**
   For each missing level, suggest:
   - Meeting name, type, and frequency
   - Primary quadrant focus
   - Tracked quadrants
   - Team scope
   - Duration
   - Which KPIs should be reviewed at each level

5. **KPI Assignment**
   Recommend which KPIs (West quadrant elements) should be discussed at which meeting level:
   - Monthly KPIs in Monthly Review
   - Weekly derived KPIs in team meetings
   - Daily derived KPIs in stand-ups

**Visual output:**
Present the recommended meeting hierarchy as a Mermaid flowchart:
\`\`\`mermaid
graph TD
  S["Strategic Review<br/>Yearly | North"]:::existing
  T["QBR<br/>Quarterly | South"]:::new
  O["Monthly Review<br/>Monthly | West"]:::existing
  W["Team Weekly<br/>Weekly | West"]:::new
  D["Daily Stand-up<br/>Daily | West"]:::new
  S --> T --> O --> W --> D
  classDef existing fill:#22c55e,color:#fff
  classDef new fill:#3b82f6,color:#fff,stroke-dasharray: 5 5
\`\`\`
Use solid borders for existing cadences, dashed for recommended new ones.

Present a clear action plan for setting up the complete management system.`
        }
      }
    ]
  },
  visual_matrix: {
    description: 'Visual X-Matrix Representations',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Generate visual representations of my Hoshin Kanri X-Matrix.

**Step 1: Gather data**
Call get_matrix_summary (with include_correlations=true), list_objectives, and get_matrix_completeness.

**Step 2: Generate Mermaid diagram**
Create a comprehensive X-Matrix flowchart showing all 4 quadrants, elements, and correlations:

\`\`\`mermaid
graph TD
  subgraph North["Vision (3-5 ans)"]
    N1["Vision item 1"]
    N2["Vision item 2"]
  end
  subgraph East["Annual Objectives"]
    E1["Objective 1"]
    E2["Objective 2"]
  end
  subgraph South["Initiatives"]
    S1["Initiative 1"]
    S2["Initiative 2"]
  end
  subgraph West["KPIs"]
    W1["KPI 1"]:::result
    W2["KPI 2"]:::perf
  end

  N1 ==>|strong| E1
  N1 -->|medium| E2
  E1 ==>|strong| S1
  S1 ==>|strong| W1
  S1 -->|medium| W2

  classDef result fill:#3b82f6,color:#fff
  classDef perf fill:#f59e0b,color:#fff
  classDef orphan fill:#ef4444,color:#fff,stroke-dasharray: 5 5
\`\`\`

Rules:
- ==> (thick arrow) for strong correlations
- --> (normal arrow) for medium correlations
- -.-> (dotted arrow) for weak correlations
- Blue nodes for Result KPIs, Amber for Performance KPIs
- Red dashed border for orphan elements (no correlations)
- Add the completeness score as a note

**Step 3: Generate Excalidraw JSON**
Create an Excalidraw-compatible JSON file representing the X-Matrix as a diamond layout:
- North quadrant at top
- East quadrant on the right
- South quadrant at bottom
- West quadrant on the left
- Correlation lines connecting elements between adjacent quadrants
- Color coding: blue (#3b82f6) for result KPIs, amber (#f59e0b) for performance KPIs, red (#ef4444) for orphans

The Excalidraw JSON should follow the standard format:
\`\`\`json
{
  "type": "excalidraw",
  "version": 2,
  "elements": [
    {
      "type": "rectangle",
      "x": 0, "y": 0, "width": 200, "height": 40,
      "backgroundColor": "#a5d8ff",
      "strokeColor": "#1e1e1e",
      "text": "Element title"
    }
  ]
}
\`\`\`

Place elements in a diamond pattern:
- North: centered at top (x=400, y=50)
- East: right side (x=700, y=300)
- South: centered at bottom (x=400, y=550)
- West: left side (x=100, y=300)
- Draw arrows between correlated elements

Provide the Excalidraw JSON in a code block so the user can save it as a .excalidraw file and open it in Excalidraw.

**Step 4: Summary table**
Provide a markdown summary table of all elements with their status, quadrant, and correlation count - suitable for Excel copy-paste.`
        }
      }
    ]
  },
  export_data: {
    description: 'Export Hoshin Kanri Data for Excel/CSV',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Help me export my Hoshin Kanri data in a format ready for Excel or CSV.

**Step 1: Gather all data**
Call these tools to collect the full dataset:
- get_matrix_summary (with include_correlations=true)
- list_objectives (all quadrants)
- get_matrix_completeness
- search_ideas (all statuses)
- get_management_architecture

**Step 2: Generate structured tables**
Format the data as markdown tables optimized for Excel copy-paste. Generate one table per sheet:

**Sheet 1: X-Matrix Elements**
| ID | Quadrant | Title | Status | Progress | Indicator Type | Correlation Count |
|----|----------|-------|--------|----------|---------------|-------------------|

**Sheet 2: Correlations**
| From Element | From Quadrant | To Element | To Quadrant | Strength |
|-------------|---------------|------------|-------------|----------|

**Sheet 3: Ideas Inbox**
| ID | Title | Description | Priority | Status | Source | Tags | Created |
|----|-------|-------------|----------|--------|--------|------|---------|

**Sheet 4: KPI Dashboard**
| KPI | Type (R/P) | Current Value | Target | Linked Objectives | Linked Initiatives |
|-----|-----------|---------------|--------|-------------------|-------------------|

**Sheet 5: Completeness Score**
| Metric | Score | Details | Suggestions |
|--------|-------|---------|-------------|

**Sheet 6: Meeting Cadences**
| Name | Level | Frequency | Primary Quadrant | Team Scope | Tracked Quadrants |
|------|-------|-----------|-----------------|------------|-------------------|

**Guidelines:**
- Use clean, consistent formatting in each table
- Dates in ISO format (YYYY-MM-DD)
- No nested objects - flatten everything for spreadsheet compatibility
- UUIDs can be shortened to first 8 chars for readability
- Include totals/summary rows where relevant
- If there is no data for a section, note it and skip the table

The user can then select each table and paste directly into Excel sheets.`
        }
      }
    ]
  },

  matrix_artifact: {
    description: 'Interactive X-Matrix Artifact (Leadership Cockpit)',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Build an interactive X-Matrix artifact I can project in a leadership meeting and share with my team.

**Step 1 — Get the full dataset.**
Call get_matrix_data (pass matrix_id if I gave one). It returns every element of the four quadrants, all correlations with strength, and the completeness score. Do NOT use get_matrix_summary — it truncates.

**Step 2 — Build a single-page interactive artifact.**
One self-contained page (React or HTML), no external assets (the artifact sandbox blocks external requests). Layout — the classic X-Matrix reading order around the center:
- CENTER: matrix name + year + completeness score badge (color: ≥80 green, ≥60 amber, else red)
- NORTH (top): long-term strategic objectives (3-5 years)
- EAST (right): annual objectives
- SOUTH (bottom): initiatives / projects
- WEST (left): KPIs & metrics

Element cards show: title, status color (active=neutral, completed=green, on_hold=amber, cancelled=strikethrough), progress bar when progress/currentValue exists, and a small link icon when externalRef is set (clickable only for http/https values — never render other schemes as links).

Interactions that matter (keep it simple, this is a boardroom tool, not a dashboard):
- Click an element → highlight its correlated elements across quadrants (use the correlations list; stronger = thicker/darker highlight) and dim the rest. Click again to reset.
- A compact legend for status colors and correlation strengths.
- Orphan elements (no correlations) get a subtle red dot — they are the completeness score's main complaint.

Design for projection: large readable type, high contrast, works on a 1280px projector. No scroll if the matrix fits; otherwise scroll per quadrant, never the whole page.

**Step 3 — Live data and sharing (tell me this after building).**
- If this claude.ai environment supports MCP-connected artifacts, wire a "Refresh" control that re-reads via get_matrix_data so the artifact stays live; viewers then need this Hoshin Kanri connector authorized on their own account (viewer role is enough — reads only).
- Otherwise the artifact is a snapshot of the data at build time: re-run this prompt to regenerate; on Team/Enterprise plans, republishing updates the same shared URL so teammates always see the latest version.
- Sharing rule (sovereignty): on Team/Enterprise plans artifacts can only be shared inside the organization, to authenticated members — fine for a leadership committee. Do not publish a public copy of the matrix; the strategy is confidential by default.

**Step 4 — Meeting mode hint.**
Remind me that during the meeting I can dictate changes ("mark initiative X at risk", "log the decision to freeze project Y") — you apply them with update_element_status and add_idea, then refresh or regenerate the artifact so the room sees the update.`
        }
      }
    ]
  },

  weekly_sync: {
    description: 'Weekly Strategy ↔ Execution Sync',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Run my weekly strategy/execution sync. You have two roles here: Hoshin Kanri holds the WHY/WHAT (strategy, initiatives, KPIs, review cadences); the execution tool (Linear, Jira, or similar — use its MCP tools if connected) holds the HOW (projects, issues, cycles).

**Data routing rule — apply it consistently:**
- Strategic objectives, annual goals, initiatives, KPIs, review decisions → Hoshin Kanri
- Tasks, issues, sprints, bugs, project boards → the execution tool
- Never duplicate work items into Hoshin; never put strategy into the execution tool.

**Step 1 — Map initiatives to execution.**
Use list_objectives (quadrant: south) to get the initiatives. Each may carry an \\\`externalRef\\\` (URL or ID of the linked project in the execution tool). For each initiative with an externalRef, fetch the current state of that project from the execution tool's MCP (progress, recently completed work, blocked items, overdue items).

**Step 2 — Update Hoshin statuses.**
For each initiative where execution data shows a meaningful change, call update_element_status:
- progress: estimate 0-100 from completed vs total scope
- notes: 1-2 lines max — decisions and blockers, not a task list
- status: 'completed' if the project shipped, keep 'active' otherwise

**Step 3 — Flag the gaps.**
- Initiatives WITHOUT an externalRef: list them and, if a matching project exists in the execution tool, propose the link (the user confirms, then store it via update_element_status with external_ref).
- Projects in the execution tool that map to NO initiative: surface them — untracked work is strategy drift.

**Step 4 — Prepare the weekly cadence agenda.**
Use get_management_architecture to find the weekly-level cadence. Build a proposed agenda:
1. KPIs off-track (west elements where currentValue lags targetValue)
2. Blocked or stalled initiatives (from Step 1)
3. Strategy drift items (from Step 3)
4. Pending decisions from notes

**Output format:** a markdown brief titled "Weekly Sync — {date}" with sections: Initiatives status table (title, progress, trend, blocker), Gaps, Proposed agenda. Keep it under one page — this is a meeting input, not a report.`
        }
      }
    ]
  }
};

export function getPromptMessages(name) {
  return promptMessages[name] || { description: 'Unknown prompt', messages: [] };
}
