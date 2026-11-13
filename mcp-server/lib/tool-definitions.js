/**
 * MCP Tool Definitions for Hoshin Kanri
 * Shared between stdio, streamable-http, and local modes.
 */

export function getQuadrantLabel(quadrant) {
  const labels = {
    north: 'Long-term Strategic Objectives (3-5 years)',
    east: 'Annual Objectives',
    south: 'Actions & Projects',
    west: 'KPIs & Metrics'
  };
  return labels[quadrant] || quadrant;
}

// Links from a line to third-party tools (docs/sprint-liens-externes.md): a free label and a
// free reference, several per line. Hoshin keeps them and gives them back, it does not check
// what they point to. Same limits as src/lib/external-links.ts.
const LINKS_PARAM = {
  type: 'array',
  maxItems: 20,
  items: {
    type: 'object',
    properties: {
      label: { type: 'string', maxLength: 80, description: 'Free label, e.g. "Jira", "A3", "QRQC", "Drive"' },
      ref: { type: 'string', maxLength: 500, description: 'Free reference: a URL, a ticket or project number, a path' },
    },
    required: ['label', 'ref'],
    additionalProperties: false,
  },
  description:
    'Links to third-party tools (an A3, a QRQC, a ticket, a document, a project number). Sending the list REPLACES the current one: read it first (get_matrix_data, search_ideas) and send it back with your additions; [] clears it.',
};

export const tools = [
  {
    name: 'add_idea',
    description: 'Add a new idea to the Hoshin Kanri inbox. Ideas can be strategic initiatives, improvement suggestions, or action items that may later be linked to the X-Matrix.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the idea (required)'
        },
        description: {
          type: 'string',
          description: 'Detailed description of the idea'
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Priority level (default: medium)'
        },
        // Must stay identical to IDEA_SOURCES in src/lib/enums.ts — the API
        // validates against that enum, so any value advertised here and absent
        // there is a promise the agent cannot keep. A test asserts the match.
        source: {
          type: 'string',
          enum: ['conversation', 'team_meeting', 'client_feedback', 'market_watch', 'internal', 'other'],
          description: 'Where this idea originated (default: conversation)'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization'
        },
        linked_element_id: {
          type: 'string',
          description: 'UUID of the matrix element this idea relates to (any matrix of the organization)'
        },
        links: LINKS_PARAM
      },
      required: ['title']
    }
  },
  {
    name: 'update_idea',
    description: 'Triage an idea of the inbox: change its status (accept, reject, mark implemented), its priority, or link it to the matrix element it serves. Find the idea_id with search_ideas.',
    inputSchema: {
      type: 'object',
      properties: {
        idea_id: { type: 'string', description: 'UUID of the idea (required)' },
        // Must stay identical to IDEA_STATUSES / IDEA_PRIORITIES in src/lib/enums.ts.
        status: {
          type: 'string',
          enum: ['inbox', 'reviewing', 'accepted', 'rejected', 'implemented'],
          description: 'New status'
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'New priority'
        },
        linked_element_id: {
          type: 'string',
          description: 'UUID of the matrix element this idea serves. Pass an empty string to unlink.'
        },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
        links: LINKS_PARAM
      },
      required: ['idea_id']
    }
  },
  {
    name: 'list_matrices',
    description: 'List the X-Matrices of the organization: id, name, whether it is the default one, its parent matrix in a cascade (group → business unit → site), and its size. Start here when the user names a matrix ("the Lyon site", "the English one"): every other tool takes the matrix_id this returns, and defaults to the default matrix without it.',
    inputSchema: {
      type: 'object',
      properties: {
        include_archived: {
          type: 'boolean',
          description: 'Also list archived matrices (default: false)'
        }
      }
    }
  },
  {
    name: 'list_objectives',
    description: 'List the elements of the X-Matrix: objectives, initiatives and KPIs with their status, target and current value. Filter by quadrant (north=long-term objectives, east=annual objectives, south=actions/projects, west=KPIs). Without matrix_id, returns the elements of every matrix of the organization, each row tagged with matrixId and matrixName.',
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: {
          type: 'string',
          description: 'UUID of one matrix (from list_matrices). Recommended when the organization has several matrices.'
        },
        quadrant: {
          type: 'string',
          enum: ['north', 'east', 'south', 'west', 'all'],
          description: 'Which quadrant to list (default: all). North=strategic, East=annual, South=actions, West=KPIs'
        },
        status: {
          type: 'string',
          enum: ['draft', 'active', 'completed', 'cancelled', 'all'],
          description: 'Filter by status (default: all)'
        }
      }
    }
  },
  {
    name: 'get_matrix_summary',
    description: 'Get a summary of an X-Matrix: element counts per quadrant, key correlations, and the ideas inbox. Defaults to the default matrix of the organization; pass matrix_id for another one (a site or business unit in a cascade, or another language).',
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: {
          type: 'string',
          description: 'UUID of the matrix to summarize (optional, uses the default matrix if not provided)'
        },
        include_correlations: {
          type: 'boolean',
          description: 'Include element correlations in response (default: true)'
        }
      }
    }
  },
  {
    name: 'update_element_status',
    description: 'Update the status, progress or measured value of a matrix element (objective, initiative or KPI), or log a comment. For a KPI, current_value is recorded as the reading of a period (the current quarter unless you pass period): earlier quarters are kept, and recording the same period again corrects it. For an initiative or objective, progress (a percentage) and notes go to its update log with author and date. get_matrix_data returns the last readings and updates.',
    inputSchema: {
      type: 'object',
      properties: {
        element_id: {
          type: 'string',
          description: 'UUID of the element to update'
        },
        status: {
          type: 'string',
          // No `on_hold`: the element statuses are draft | active | completed |
          // cancelled, and advertising a fifth one only produced a validation
          // error the agent could not diagnose. Adding a real "paused" status is
          // a product decision, not a schema fix.
          enum: ['draft', 'active', 'completed', 'cancelled'],
          description: 'New status'
        },
        progress: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
          description: 'Progress percentage (0-100) of an initiative or objective. Refused on a KPI.'
        },
        current_value: {
          type: 'string',
          description: 'New measured value of a KPI (e.g. "1.2"), in the unit of the element. Recorded for `period`. An empty string clears the value.'
        },
        period: {
          type: 'string',
          pattern: '^(20\\d\\d|2100)-(Q[1-4]|0[1-9]|1[0-2])$',
          description: 'KPIs only: the period the value measures, a quarter (2026-Q3) or a month (2026-09). Default: the current quarter. Pass it when recording a past quarter.'
        },
        notes: {
          type: 'string',
          description: 'A comment for the update log (with progress on an initiative, or as the note of a KPI reading)'
        },
        origin_tool: {
          type: 'string',
          maxLength: 100,
          description: 'KPI readings only: the tool you read the value in, when you copied it from one (e.g. "HubSpot", "Pennylane"). Pass it every time you copy a value, so a reviewer knows where the number comes from.'
        },
        origin_ref: {
          type: 'string',
          maxLength: 500,
          description: 'KPI readings only: where in that tool (a report name, a saved query, a URL).'
        },
        extracted_at: {
          type: 'string',
          description: 'KPI readings only: when you extracted the value from that tool, a date (YYYY-MM-DD) or an ISO datetime. Not in the future.'
        },
        external_ref: {
          type: 'string',
          description: 'Link to the matching project in the execution tool (Linear/Jira URL or ID). Set it once; weekly syncs use it to pull progress.'
        }
      },
      required: ['element_id']
    }
  },
  {
    name: 'search_ideas',
    description: 'Search through the ideas inbox with filters for status, priority, tags, or text search.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text search in title and description'
        },
        status: {
          type: 'string',
          enum: ['inbox', 'reviewing', 'accepted', 'rejected', 'implemented', 'all'],
          description: 'Filter by status (default: all)'
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical', 'all'],
          description: 'Filter by priority'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags (any match)'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Maximum results (default: 20)'
        }
      }
    }
  },
  {
    name: 'get_matrix_completeness',
    description: `Analyze X-Matrix completeness and get AI-friendly score. Returns:
- Coverage: elements per quadrant (min 3-5 recommended)
- Density: correlation fill rate between adjacent quadrants
- Orphans: elements without any links
- Chains: complete Vision→Objective→Initiative→KPI paths
- Indicator Balance: checks if initiatives have both RESULT (lagging - measures outcomes like revenue, NPS) AND PERFORMANCE (leading - measures process like calls/week, % completion) indicators linked. An objective is judged through the KPIs of its initiatives; one with no initiative is left to Chains.

Ideal state: each initiative is linked to at least one result indicator AND one performance indicator. East and West do not link directly.`,
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: {
          type: 'string',
          description: 'UUID of the matrix to analyze (optional, uses default matrix if not provided)'
        }
      }
    }
  },
  {
    name: 'get_matrix_data',
    description: `Get the COMPLETE dataset of an X-Matrix in one call: every element of all four quadrants (id, title, status, progress, externalRef, indicator type, target and current value), each KPI's last 8 readings by period (oldest first, to read the trend), each element's last 3 progress updates with comments, all correlations (from/to element ids and titles, strength), and the completeness score.

Each initiative (south) carries its sheet (why, expected result, milestones, next action, health and its sentence, blockers), each KPI (west) its definition (formula, source system and reference, data owner, frequency), and each reading its status: provisional while its period runs, final once it ended.

For anything you will show outside the organization, pass audience "external": the same filter as a public link applies, so you never have to decide yourself what may leave. Each initiative carries pageUrl, its page in the app: cite it as the reference version in what you build.

Use this instead of get_matrix_summary when you need the full matrix — typically to render a view or build an interactive artifact (e.g. an X-Matrix cockpit for a leadership meeting, shareable with the team). The matrix_artifact prompt shows the recommended artifact layout.`,
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: {
          type: 'string',
          description: 'UUID of the matrix (default: the default matrix of the organization). Pass it as soon as list_matrices shows more than one.'
        },
        audience: {
          type: 'string',
          enum: ['internal', 'external'],
          description: 'external for anything that will be shown outside the organization (a board deck, an investor update, a partner): leaves out the elements marked internal and their correlations, every value, target, unit, link, name, reading, update and KPI definition; a sheet keeps why, the expected result, milestones, the next action and the health; the score counts what is shown. Default internal: everything.'
        }
      }
    }
  },
  {
    name: 'share_matrix',
    description: `Publish a matrix as a public read-only web page and return the tokenized link. list_matrix_shares lists the existing links, revoke_matrix_share ends one.

Publication is a deliberate act: anyone with the link can view the matrix (title, elements, correlations, completeness score) until the link is revoked or expires. Elements marked internal (upsert_element visibility "internal") never appear, nor their correlations; hide_figures leaves out every value, target, unit and execution link. Before publishing, mark internal what must not leave the organization (prospects, salaries, anything said in confidence). The page is never indexed by search engines. Use it to share the X-Matrix with people OUTSIDE the organization (board members, investors, partners) without creating accounts. For sharing inside a claude.ai Team organization, prefer the matrix_artifact prompt instead.

Not available in local JSON mode (sovereign mode has no cloud page by design — export a snapshot artifact instead).`,
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: {
          type: 'string',
          description: 'UUID of the matrix (default: the default matrix of the organization). Pass it as soon as list_matrices shows more than one.'
        },
        label: {
          type: 'string',
          description: 'Optional label to remember who this link was created for (e.g. "board Q3")'
        },
        expires_in_days: {
          type: 'integer',
          minimum: 1,
          maximum: 365,
          description: 'Optional auto-expiry in days (default: no expiry, revocable manually)'
        },
        full_sheets: {
          type: 'boolean',
          description: 'true: the initiative pages of the link show the full sheet (owner, sponsor, who does the next action, blockers, the sentence behind the health). Only when the person asked for it, for an audience they trust (default false)'
        },
        hide_figures: {
          type: 'boolean',
          description: 'true: the page shows the structure only, no value, target, unit or execution link (default false)'
        }
      }
    }
  },
  {
    name: 'list_matrix_shares',
    description:
      'List the public links of a matrix made with share_matrix: id, label, created and expiry dates, whether the link shows figures or full sheets, and whether it is still active. Use it before revoke_matrix_share, or to tell the person who can still open the matrix from outside. Not available in local JSON mode.',
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: {
          type: 'string',
          description: 'UUID of the matrix (default: the default matrix of the organization)'
        }
      }
    }
  },
  {
    name: 'revoke_matrix_share',
    description:
      'Revoke a public link of a matrix: the page stops opening at once, for everyone who has the link. It cannot be undone; a new share_matrix makes a new link. Take share_id from list_matrix_shares. Not available in local JSON mode.',
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: {
          type: 'string',
          description: 'UUID of the matrix (default: the default matrix of the organization)'
        },
        share_id: {
          type: 'string',
          description: 'UUID of the link to revoke, from list_matrix_shares'
        }
      },
      required: ['share_id']
    }
  },
  {
    name: 'get_management_architecture',
    description: 'Returns the complete management system architecture - all meeting cadences organized by hierarchy level (strategic, tactical, operational_mgmt, team_mgmt, execution). Shows the tree of meetings, their frequency, team scope, tracked quadrants, and how they cascade from strategic reviews down to daily stand-ups.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'diagnose_theme_deployment',
    description: 'Analyze if a strategic theme is properly deployed from vision down to operational meetings. Returns a deployment score, coverage per hierarchy level, and suggestions for improving deployment.',
    inputSchema: {
      type: 'object',
      properties: {
        theme_id: {
          type: 'string',
          description: 'UUID of the strategic theme to analyze'
        },
        theme_name: {
          type: 'string',
          description: 'Name of the theme to search for (alternative to theme_id)'
        }
      }
    }
  },
  {
    name: 'suggest_meeting_for_topic',
    description: 'Recommend the right meeting level and cadence for a given topic based on its nature and the X-Matrix quadrant it relates to.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Description of the topic to find the right meeting for (required)'
        },
        element_id: {
          type: 'string',
          description: 'UUID of the X-Matrix element related to this topic (optional)'
        }
      },
      required: ['topic']
    }
  },
  {
    name: 'get_agenda',
    description:
      'Where the organization stands in its review cycle, and what is due. Call it first in any session about follow-up or a review, and at every heartbeat. Returns: today (UTC, current quarter and month), the calendar of reviews ahead (scheduled, or expected from the cadence frequency), the last completed reviews with their decisions, and the items due: reviews to prepare (7 days ahead, 1 for weekly ones), reviews held but never recorded, cadences with no review scheduled, KPIs missing the reading of the last closed period, initiatives without a progress update within the review rhythm, overdue actions. Each item has a stable key and the date it became due: pass since (the time of your previous call) to get only what is new, so a recurring agent never acts twice on the same item. get_help topic "heartbeat" says, for each kind of item, which tool to call and what to submit to a person first.',
    inputSchema: {
      type: 'object',
      properties: {
        since: {
          type: 'string',
          description: 'ISO date or datetime of your previous call: only items that became due after it are listed (openCount still counts them all).'
        },
        horizon_days: {
          type: 'number',
          description: 'How far ahead the calendar looks, in days (1 to 180, default 30).'
        },
        matrix_id: {
          type: 'string',
          description: 'Limit indicators, initiatives and actions to one matrix (from list_matrices). Reviews and cadences are organization-wide.'
        }
      }
    }
  },
  {
    name: 'schedule_review',
    description:
      'Schedule a review (a meeting instance) of a cadence: a monthly review, a quarterly review, a catchball round. Get the cadence ids from get_management_architecture and the expected date from get_agenda. Refused (MEETING_ALREADY_SCHEDULED) if that cadence already has a review scheduled that day, so a retry or a second heartbeat does not create a duplicate.',
    inputSchema: {
      type: 'object',
      properties: {
        cadence_id: { type: 'string', description: 'UUID of the cadence (required)' },
        date: { type: 'string', description: 'Date of the review, YYYY-MM-DD (required)' },
        matrix_id: { type: 'string', description: 'The matrix this review looks at (optional)' }
      },
      required: ['cadence_id', 'date']
    }
  },
  {
    name: 'record_review',
    description:
      'Record a review that was held: its notes, its decisions as the participants stated them, the matrix elements it discussed, and the date it was held if not today. The agent records what the committee decided; it never decides in its place, so write decisions only from what people said or wrote. A review is recorded once (MEETING_ALREADY_COMPLETED after that). The reviews to record are listed by get_agenda (kind review_unrecorded). Recording it keeps a snapshot of the matrix as it stands at that moment (values, progress, health of the initiatives, latest readings, score): record it right after the meeting, before correcting figures, so the snapshot is what the committee saw. get_review reads it back.',
    inputSchema: {
      type: 'object',
      properties: {
        review_id: { type: 'string', description: 'UUID of the review, from get_agenda (required)' },
        notes: { type: 'string', description: 'What was said: progress, blockers, discussion' },
        decisions: { type: 'array', items: { type: 'string' }, description: 'One entry per decision, as stated by the participants (at most 50)' },
        discussed_element_ids: { type: 'array', items: { type: 'string' }, description: 'UUIDs of the matrix elements discussed' },
        held_on: { type: 'string', description: 'Date the review was held, YYYY-MM-DD, if not today. Never in the future.' }
      },
      required: ['review_id']
    }
  },
  {
    name: 'create_matrix',
    description:
      'Create a new X-Matrix. Use this to start a strategy from scratch: create the matrix, then add elements with upsert_element and wire them with set_correlation. The first matrix of an organization becomes the default one. For a multi-level deployment (group → business unit → site), create the lower-level matrix with parent_matrix_id, then link each of its elements to what it deploys from above with upsert_element.parent_element_id.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the matrix, e.g. "Strategy 2027" (required)'
        },
        description: {
          type: 'string',
          description: 'What this deployment covers'
        },
        period_type: {
          type: 'string',
          // Must stay identical to MATRIX_PERIOD_TYPES in src/lib/enums.ts.
          enum: ['annual', 'quarterly', 'custom'],
          description: 'Planning horizon (default: annual). A multi-year strategy is "custom" with period_start and period_end.'
        },
        period_start: {
          type: 'string',
          description: 'Start of the period, ISO date (YYYY-MM-DD)'
        },
        period_end: {
          type: 'string',
          description: 'End of the period, ISO date (YYYY-MM-DD)'
        },
        is_default: {
          type: 'boolean',
          description: 'Make this the default matrix of the organization'
        },
        parent_matrix_id: {
          type: 'string',
          description: 'UUID of the matrix of the level above (e.g. the group matrix for a business-unit matrix). At most 4 levels.'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'upsert_element',
    description:
      'Create an X-Matrix element, or update one when element_id is given. Quadrants: north = 3-5 year vision, east = annual objectives, south = initiatives, west = KPIs. A west element should carry indicator_type so the completeness score can judge the leading/lagging balance. Aim for 3 to 5 elements per quadrant. Use status "draft" for a hypothesis the committee has not validated yet. Set visibility "internal" at creation for anything that must not leave the organization (named prospects, amounts, salaries), before any share or export. The initiative sheet and the KPI definition are written by upsert_initiative_sheet and set_kpi_definition.',
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: {
          type: 'string',
          description: 'UUID of the matrix (default: the organization default matrix)'
        },
        element_id: {
          type: 'string',
          description: 'UUID of an existing element to update. Omit to create a new one.'
        },
        quadrant: {
          type: 'string',
          enum: ['north', 'east', 'south', 'west'],
          description: 'Quadrant of the element (required when creating)'
        },
        title: {
          type: 'string',
          description: 'Title of the element (required when creating)'
        },
        description: {
          type: 'string',
          description: 'Longer description, rationale, scope'
        },
        status: {
          type: 'string',
          enum: ['draft', 'active', 'completed', 'cancelled'],
          description: 'Status of the element (default: active)'
        },
        target_value: {
          type: 'string',
          description: 'Target to reach, e.g. "38"'
        },
        current_value: {
          type: 'string',
          description: 'Where it stands today, e.g. "31"'
        },
        unit: {
          type: 'string',
          description: 'Unit of the values, e.g. "%", "k€", "days"'
        },
        indicator_type: {
          type: 'string',
          enum: ['result', 'performance'],
          description:
            'For west elements only: result = lagging (measures outcomes), performance = leading (measures the process producing them). Every objective should be tracked by at least one of each.'
        },
        external_ref: {
          type: 'string',
          description: 'URL or key of the project implementing this in your execution tool (Linear, Jira, GitHub)'
        },
        links: LINKS_PARAM,
        owner_id: {
          type: 'string',
          description: 'UUID of the user who owns this element. Pass an empty string to clear.'
        },
        due_date: {
          type: 'string',
          description: 'Due date, ISO format (YYYY-MM-DD). Pass an empty string to clear.'
        },
        parent_element_id: {
          type: 'string',
          description:
            'Cascade: UUID of the element of the PARENT matrix that this element deploys. Usual pattern: a parent annual objective (east) or initiative (south) becomes a north or east element of the level below. The matrix must have a parent matrix. Pass an empty string to remove the link.'
        },
        visibility: {
          type: 'string',
          enum: ['shared', 'internal'],
          description:
            '"internal" keeps the element, and its correlations, off public share pages and external images: named prospects or clients, salaries, anything said in confidence. Default "shared". It does not restrict who reads it inside the organization.'
        }
      }
    }
  },
  {
    name: 'get_cascade',
    description: `Read the multi-level deployment below a matrix (group → business units → sites): the sub-matrices level by level, and for each level what it decided (annual objectives and initiatives) that the level below took up, and what NOBODY took up. Also lists lower-level priorities that name nothing above (unanchored — legitimate local priorities or drift, to be discussed), and a coverage percentage.

Use it to answer "is our group strategy actually deployed in the sites?", to prepare a catchball session, or before assessing how an event at group level propagates down.`,
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: {
          type: 'string',
          description: 'UUID of the top matrix of the cascade to read (default: the organization default matrix)'
        }
      }
    }
  },
  {
    name: 'set_matrix_parent',
    description:
      'Attach an existing matrix under the matrix of the level above (business unit under group, site under business unit), or detach it with an empty parent_matrix_id. Links from its elements to the old parent are cleared. Refused if it would create a loop or a fifth level.',
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: {
          type: 'string',
          description: 'UUID of the matrix to attach (required)'
        },
        parent_matrix_id: {
          type: 'string',
          description: 'UUID of the matrix of the level above; empty string to detach (required)'
        }
      },
      required: ['matrix_id', 'parent_matrix_id']
    }
  },
  {
    name: 'set_correlation',
    description:
      'Wire two elements of adjacent quadrants together, or unwire them with strength "none". Only adjacent pairs carry meaning: north↔east, east↔south, south↔west, north↔west; any other pair is refused (NOT_ADJACENT). Omit matrix_id to use the matrix the elements belong to. That constraint is what makes the matrix a deployment tool — a vision reaches a KPI through an objective and an initiative, never directly.',
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: {
          type: 'string',
          description: 'UUID of the matrix (default: the organization default matrix)'
        },
        from_element_id: {
          type: 'string',
          description: 'UUID of the first element (required)'
        },
        to_element_id: {
          type: 'string',
          description: 'UUID of the second element (required)'
        },
        strength: {
          type: 'string',
          enum: ['none', 'weak', 'medium', 'strong'],
          description: 'How strongly they are linked. "none" removes the correlation.'
        }
      },
      required: ['from_element_id', 'to_element_id', 'strength']
    }
  },
  {
    name: 'show_matrix',
    description:
      'Show the X-Matrix to the person, in the conversation: the matrix drawn (vision at the bottom by default) and a card per initiative (health, why, expected result and its KPI, milestones, next action, a button to its page). Hosts that support MCP Apps (claude.ai on the web) display it; elsewhere you get the same content as text. It is the plain reference view: to build your own presentation, read get_matrix_data. Pass audience "external" when the screen is shared with people outside the organization.',
    _meta: { ui: { resourceUri: 'ui://hoshin/matrix' } },
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: { type: 'string', description: 'UUID of the matrix (default: the default matrix of the organization)' },
        audience: { type: 'string', enum: ['internal', 'external'], description: 'internal (default) or external: the filter of a public link' },
        orientation: { type: 'string', enum: ['bottom', 'top'], description: 'bottom (default): vision at the bottom; top: as the app' },
        lang: { type: 'string', enum: ['en', 'fr'], description: 'Language of the labels (default: the account language)' }
      }
    }
  },
  {
    name: 'get_review',
    description:
      'Read a recorded review: its date, notes and decisions, and the snapshot of the matrix taken when it was recorded (each element with its status, value, target, progress, health and latest reading, and the completeness score). Use it to see what a decision was based on, even after a figure was corrected. snapshot is null for a review not recorded yet, or recorded before snapshots existed. Review ids come from get_agenda (recentReviews, items).',
    inputSchema: {
      type: 'object',
      properties: { review_id: { type: 'string', description: 'UUID of the review (required)' } },
      required: ['review_id']
    }
  },
  {
    name: 'upsert_cadence',
    description:
      'Create a review cadence (a monthly committee, a quarterly review, a weekly stand-up), or change one when cadence_id is given. Reviews are then scheduled with schedule_review and recorded with record_review. get_management_architecture lists the cadences and their ids. Fields not given are kept.',
    inputSchema: {
      type: 'object',
      properties: {
        cadence_id: { type: 'string', description: 'UUID of the cadence to change. Omit to create one.' },
        name: { type: 'string', description: 'Name, e.g. "Comité mensuel" (required to create)' },
        type: { type: 'string', enum: ['strategic', 'annual', 'qbr', 'monthly', 'weekly', 'daily', 'catchball'], description: 'Kind of review (required to create)' },
        frequency: { type: 'string', enum: ['yearly', 'quarterly', 'monthly', 'weekly', 'daily'], description: 'How often it meets (required to create): get_agenda expects the next review from it' },
        operational_level: { type: 'string', enum: ['strategic', 'tactical', 'operational_mgmt', 'team_mgmt', 'execution'], description: 'Level it decides at (required to create)' },
        primary_quadrant: { type: 'string', enum: ['north', 'east', 'south', 'west'], description: 'The quadrant it mainly reviews' },
        tracked_quadrants: { type: 'array', items: { type: 'string', enum: ['north', 'east', 'south', 'west'] }, description: 'Quadrants it follows' },
        duration_minutes: { type: 'number', description: 'Usual length, in minutes (default 60)' },
        scope_description: { type: 'string', description: 'What it covers, who attends' },
        parent_cadence_id: { type: 'string', description: 'The cadence it reports to (a monthly committee under the quarterly review)' }
      }
    }
  },
  {
    name: 'upsert_initiative_sheet',
    description:
      'Fill or change the sheet of an initiative (south element): what a committee reads in two minutes, no task management. Each field given replaces the stored one, null clears it, fields not given are kept. When an execution tool holds the project (external_ref set), keep the sheet as a summary of it and leave the tasks there. A new health (green, amber, red) needs health_note, one sentence that justifies it; update it at each review.',
    inputSchema: {
      type: 'object',
      properties: {
        element_id: { type: 'string', description: 'UUID of the initiative (required)' },
        sponsor: { type: ['string', 'null'], description: 'Sponsor, when not the owner (the owner is owner_id of upsert_element)' },
        why: { type: ['string', 'null'], description: 'The problem it addresses and the annual objective it serves' },
        expected_result: { type: ['string', 'null'], description: 'What "done" means' },
        measured_by: { type: ['string', 'null'], description: 'UUID of the KPI (west element, same matrix) that measures the result' },
        milestones: {
          type: ['array', 'null'],
          description: '3 to 6 dated milestones (8 at most); replaces the whole list',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              date: { type: 'string', description: 'YYYY-MM-DD' },
              status: { type: 'string', enum: ['planned', 'done', 'late'] }
            },
            required: ['title', 'status']
          }
        },
        next_action: {
          type: ['object', 'null'],
          description: 'One action, who does it, by when',
          properties: { title: { type: 'string' }, owner: { type: 'string' }, due: { type: 'string', description: 'YYYY-MM-DD' } },
          required: ['title']
        },
        health: { type: ['string', 'null'], enum: ['green', 'amber', 'red', null], description: 'Weather of the initiative; needs health_note' },
        health_note: { type: ['string', 'null'], description: 'One sentence that justifies the health' },
        blockers: { type: ['string', 'null'], description: 'Risks, and what needs an arbitration or a decision of the committee' },
        resources: { type: ['string', 'null'], description: 'Budget, time, hires needed' }
      },
      required: ['element_id']
    }
  },
  {
    name: 'set_kpi_definition',
    description:
      'Define a KPI (west element): how its value is computed, in which system and where it is read, who answers for the number, how often a reading is due. Read it before taking a reading, so every agent computes the KPI the same way. Each field given replaces the stored one, null clears it, fields not given are kept.',
    inputSchema: {
      type: 'object',
      properties: {
        element_id: { type: 'string', description: 'UUID of the KPI (required)' },
        formula: { type: ['string', 'null'], description: 'How the value is computed, e.g. "active accounts / signed accounts, at month end"' },
        source_system: { type: ['string', 'null'], description: 'The system the value is read in (e.g. "HubSpot", "Pennylane")' },
        source_ref: { type: ['string', 'null'], description: 'Where in it: a report, a saved query, a URL' },
        data_owner: { type: ['string', 'null'], description: 'Who answers for the number' },
        frequency: { type: ['string', 'null'], enum: ['monthly', 'quarterly', null], description: 'How often a reading is due' }
      },
      required: ['element_id']
    }
  },
  {
    name: 'get_excellence_roadmap',
    description:
      'The excellence roadmap of the organization: a maturity grid (themes, items asked as questions, one description per level) assessed site by site. Returns the grid, and for each site its level and target per item, the initiative linked to an item, the assessments, and "findings": what is missing (a site due for an assessment, an item under its target with no initiative or with a closed one, a score with no evidence). Signal the findings; people decide. A site is a matrix: pass matrix_id to read one site only, in the language that site works in (one grid is kept in several languages; every site is assessed on the same items). With several roadmaps, pass roadmap_id (the error lists them).',
    inputSchema: {
      type: 'object',
      properties: {
        roadmap_id: { type: 'string', description: 'UUID of the roadmap; optional when the organization has one' },
        matrix_id: { type: 'string', description: 'UUID of a site (a matrix, from list_matrices): only that site, in its own language' },
        lang: { type: 'string', description: 'Language of the grid texts (en, fr, es, pt, de…). One grid, several languages: a text not translated comes in the source language. Without it: the language of the site given, else the source language. "languages" in the answer lists what exists.' }
      }
    }
  },
  {
    name: 'assess_roadmap_item',
    description:
      'Write the level observed on one item of the excellence roadmap for a site, with the evidence: what was seen (a document, a figure, a workstation). It goes into the draft self-assessment of that site, opened if there is none. A field given replaces the stored one; not_applicable clears the level, and a level given later makes the item applicable again. The site keeps being judged on its last validated assessment until a person validates this draft. Never score without evidence, and never from a guess: read the item with get_excellence_roadmap first (howToAssess says what to go and see). You prepare; a person validates the self-assessment in the app, and an official assessment is an auditor\'s: it cannot be written or validated here.',
    inputSchema: {
      type: 'object',
      properties: {
        roadmap_id: { type: 'string', description: 'UUID of the roadmap; optional when the organization has one' },
        matrix_id: { type: 'string', description: 'UUID of the site assessed (a matrix)' },
        item_id: { type: 'string', description: 'UUID of the item (from get_excellence_roadmap)' },
        level: { type: 'integer', minimum: 1, maximum: 6, description: 'Level observed, 1 = the first level of the roadmap' },
        not_applicable: { type: 'boolean', description: 'true when the item does not apply to this site' },
        evidence: { type: 'string', description: 'What was seen that supports the level' },
        remark: { type: 'string', description: 'Strong point or recommendation' }
      },
      required: ['matrix_id', 'item_id']
    }
  },
  {
    name: 'show_roadmap',
    description:
      'Show one site against the excellence roadmap to the person, in the conversation: theme by theme, each item with the level the site stands at, its target, what the current level says and what the next one asks for, the initiative that must raise it, and the items below target with no initiative. Hosts that support MCP Apps (claude.ai on the web) display it; elsewhere you get the same content as text. It is the plain reference view, in the language that site reads the grid in: to build your own presentation, read get_excellence_roadmap. With several sites, pass matrix_id (the error lists them); to put the sites side by side, use show_site_comparison.',
    _meta: { ui: { resourceUri: 'ui://hoshin/roadmap' } },
    inputSchema: {
      type: 'object',
      properties: {
        roadmap_id: { type: 'string', description: 'UUID of the roadmap; optional when the organization has one' },
        matrix_id: { type: 'string', description: 'UUID of the site (a matrix, from list_matrices); optional when one site only is on the roadmap' },
        lang: { type: 'string', description: 'Language of the grid texts (en, fr, es, pt, de…); default: the language of the site' }
      }
    }
  },
  {
    name: 'show_site_comparison',
    description:
      'Show the sites of the excellence roadmap side by side to the person, in the conversation: per theme the average level of each site, the overall average, the number of items below target, the assessment each site is judged on, and the items the sites are furthest apart on (where one plant has something to show another). Hosts that support MCP Apps display it; elsewhere you get the same content as text. Averages are over the items assessed, each shown with the number of items it stands on, and are a reading aid: a level is a step, not a grade. What each site is judged on (official, self-assessment, draft) is written under its name: say it when you comment. It compares; it ranks nobody and decides nothing.',
    _meta: { ui: { resourceUri: 'ui://hoshin/roadmap' } },
    inputSchema: {
      type: 'object',
      properties: {
        roadmap_id: { type: 'string', description: 'UUID of the roadmap; optional when the organization has one' },
        lang: { type: 'string', description: 'Language of the grid texts (en, fr, es, pt, de…); default: the language of your account if the roadmap is translated into it, else its source language' }
      }
    }
  },
  {
    name: 'get_roadmap_translation',
    description:
      'Read what is stored for one more language of the excellence roadmap: the name, description, levels, themes and items in that language, an empty string where a text is not translated yet, and how many texts are still missing. Read it before translate_roadmap, with get_excellence_roadmap in the source language for the texts to translate and their ids.',
    inputSchema: {
      type: 'object',
      properties: {
        roadmap_id: { type: 'string', description: 'UUID of the roadmap; optional when the organization has one' },
        locale: { type: 'string', enum: ['en', 'fr', 'es', 'pt', 'de', 'it', 'nl', 'pl', 'cs', 'ro', 'tr', 'zh', 'ja'], description: 'The language to read; never the source language of the roadmap' }
      },
      required: ['locale']
    }
  },
  {
    name: 'translate_roadmap',
    description:
      'Write the texts of the excellence roadmap in one more language. One grid, several languages: a group keeps one roadmap and its translations, and every site is assessed on the same items, each reading them in its own language. A translation is part of the standard, so it is the work of whoever owns the grid: writing one requires an organization admin (an API token created by an admin with the admin permission; a claude.ai connector acts as an editor at most and is refused with 403). Read what is stored first with get_roadmap_translation. A field given replaces the stored translation, an empty string removes it (the source language is served again), a theme or item left out keeps what it had; at least one text is required. Translate the meaning of each level faithfully: a description that drifts changes what the site is scored on. The source language is not written here; the grid is edited in the app.',
    inputSchema: {
      type: 'object',
      properties: {
        roadmap_id: { type: 'string', description: 'UUID of the roadmap; optional when the organization has one' },
        locale: { type: 'string', enum: ['en', 'fr', 'es', 'pt', 'de', 'it', 'nl', 'pl', 'cs', 'ro', 'tr', 'zh', 'ja'], description: 'The language to write; never the source language of the roadmap' },
        name: { type: 'string', description: 'Name of the roadmap in that language' },
        description: { type: 'string', description: 'Its description in that language' },
        levels: {
          type: 'array',
          description: 'The levels, in the order of the roadmap (first = level 1)',
          items: { type: 'object', properties: { name: { type: 'string' }, meaning: { type: 'string' } } }
        },
        themes: {
          type: 'array',
          description: 'Themes to translate, by id; those left out keep their translation',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'UUID of the theme' },
              name: { type: 'string' },
              objective: { type: 'string' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'UUID of the item' },
                    question: { type: 'string' },
                    how_to_assess: { type: 'string' },
                    level_descriptions: { type: 'array', items: { type: 'string' }, description: 'One per level, in order; an empty string leaves that level in the source language' }
                  },
                  required: ['id']
                }
              }
            },
            required: ['id']
          }
        }
      },
      required: ['locale']
    }
  },
  {
    name: 'list_members',
    description:
      'The directory of the organization: the active members, with their id and name. Use the id as owner_id in upsert_element to name who owns an objective, an initiative or a KPI. Inviting a person is done by an admin in the app (Settings, Users): it sends an email in the name of the organization. In local mode there are no members.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'archive_matrix',
    description:
      'Archive a matrix (archived: true, the default) or bring it back (archived: false). Nothing is deleted: list_matrices hides archived matrices unless include_archived is true. Archiving the default matrix hands the default to the oldest active top-level matrix, which only an organization admin may do. Prefer it to delete_matrix when in doubt.',
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: { type: 'string', description: 'UUID of the matrix (from list_matrices)' },
        archived: { type: 'boolean', description: 'true (default) archives, false brings it back' }
      },
      required: ['matrix_id']
    }
  },
  {
    name: 'delete_matrix',
    description:
      'Delete a matrix for good, with its elements, correlations, KPI readings, update logs and public share links; matrices below it in the cascade are detached. It cannot be undone. Ask the person first, then pass confirm_name: the exact name of the matrix, as list_matrices gives it; any other value is refused (CONFIRMATION_MISMATCH) and nothing is deleted. To set a matrix aside, use archive_matrix.',
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: { type: 'string', description: 'UUID of the matrix (from list_matrices)' },
        confirm_name: { type: 'string', description: 'The exact name of the matrix, repeated as a confirmation' }
      },
      required: ['matrix_id', 'confirm_name']
    }
  },
  {
    name: 'delete_element',
    description:
      'Delete an element (objective, initiative or KPI) created by mistake or duplicated, with its correlations, KPI readings and update log; elements of lower matrices that deployed it keep their place but lose that link. It cannot be undone. For an element the organization dropped, prefer update_element_status with status "cancelled": its history stays.',
    inputSchema: {
      type: 'object',
      properties: {
        element_id: { type: 'string', description: 'UUID of the element (from list_objectives or get_matrix_data)' }
      },
      required: ['element_id']
    }
  },
  {
    name: 'export_matrix_image',
    description:
      'Draw the X-Matrix as an SVG picture for a deck or a report: the four bands, the correlation marks in the corners, the completeness score. Returns svg (the document), filename and mediaType. audience "internal" (default) draws everything with the KPI values; "external" leaves out the elements marked internal and every value and target, as a public page without figures. layout "initiatives" returns one page per initiative instead (its sheet: owner, why, expected result, milestones, next action, health, blockers), in pages; with audience "external" a page names nobody and leaves out blockers, the sentence behind the health, resources and the KPI value. Save the svg as a file; PowerPoint and Keynote insert it as is. For Google Slides, pass format "png": the pictures come back as images.',
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: { type: 'string', description: 'UUID of the matrix (default: the default matrix)' },
        audience: { type: 'string', enum: ['internal', 'external'], description: 'internal (default) or external' },
        lang: { type: 'string', enum: ['en', 'fr'], description: 'Language of the labels (default: the account language; English in local mode)' },
        layout: { type: 'string', enum: ['matrix', 'initiatives'], description: 'matrix (default): the X-Matrix; initiatives: one page per initiative sheet' },
        orientation: { type: 'string', enum: ['bottom', 'top'], description: 'bottom (default): vision at the bottom, annual objectives left, initiatives on top, KPIs right, as most templates; top: vision on top, as the app' },
        format: { type: 'string', enum: ['svg', 'png'], description: 'svg (default): the document as text, for PowerPoint and Keynote; png: the pictures as images, for Google Slides and anything else' }
      }
    }
  },
  {
    name: 'whoami',
    description:
      'Call it first in a session, then list_matrices and get_agenda; read before you write. Who you act as and what you may do. Returns: the organization, the member behind this connection and their role, the role this connection actually has (capped by the API token permissions or the OAuth scopes, and by the plan), the plan with its limits and usage (and whether they are enforced), and for each active matrix whether you may edit it. An API token acts as the admin who created it: what it writes is recorded under that member.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_help',
    description:
      'The manual of this server: what the X-Matrix holds, the review cycle and which tool does what (workflows), what a recurring agent does with each item of get_agenda (heartbeat), how to fill a matrix well: correlation strengths, drafts, visibility, sizes (modeling), what the prompts matrix_artifact and weekly_sync contain, for clients that do not show prompts (prompts), rights and plans (rights), error codes and what to do (errors), the local mode (local). Without a topic: the overview and the list of topics.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', enum: ['overview', 'workflows', 'heartbeat', 'modeling', 'prompts', 'rights', 'errors', 'local'], description: 'One topic; omit for the overview.' }
      }
    }
  },
  {
    name: 'report_missing_capability',
    description:
      'Tell the Hoshin Kanri team that you needed something this server does not do: a tool, a field, a filter, a right. Describe the capability and what you were trying to do; do not paste strategy content (titles, figures, names). Counted per organization; when feature names one of the capabilities listed as not built, it counts toward building it. Refused for the public demo organization. In local mode nothing is sent: you get the address to file it yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        capability: { type: 'string', description: 'What is missing, in one sentence (3 to 300 characters).' },
        use_case: { type: 'string', description: 'What you were trying to do when you needed it (up to 1000 characters).' },
        feature: { type: 'string', enum: ["agent-inbox-token","saml","claude-ema","client-encryption","kpi-alerts","on-prem","matrix-orientation","a3-initiative"], description: 'Only if it is one of these capabilities, listed as not built yet.' }
      },
      required: ['capability']
    }
  }
];

// MCP tool annotations. Claude (and other clients) read readOnlyHint to tell
// reads from writes in their permission settings: an organization can let every
// member read freely and keep writes behind an approval. destructiveHint marks
// writes that can remove something (a correlation, element links, a public link).
const READ_ONLY = new Set([
  'list_matrices',
  'list_objectives',
  'get_matrix_summary',
  'get_matrix_data',
  'get_matrix_completeness',
  'get_cascade',
  'search_ideas',
  'get_management_architecture',
  'diagnose_theme_deployment',
  'suggest_meeting_for_topic',
  'get_agenda',
  'whoami',
  'get_help',
  'export_matrix_image',
  'get_review',
  'list_members',
  'show_matrix',
  'get_excellence_roadmap',
  'show_roadmap',
  'show_site_comparison',
  'list_matrix_shares',
  'get_roadmap_translation'
]);
const DESTRUCTIVE = new Set(['set_correlation', 'set_matrix_parent', 'revoke_matrix_share', 'archive_matrix', 'delete_matrix', 'delete_element']);

// The name a person reads in the client's permission prompt and tool list. The
// Claude directory requires one on every tool (docs/sprint-annuaire-connecteurs.md).
export const TOOL_TITLES = {
  add_idea: 'Add an idea',
  update_idea: 'Update an idea',
  list_matrices: 'List matrices',
  list_objectives: 'List objectives',
  get_matrix_summary: 'Get matrix summary',
  update_element_status: 'Update status, reading or progress',
  search_ideas: 'Search ideas',
  get_matrix_completeness: 'Get completeness score',
  get_matrix_data: 'Get full matrix data',
  share_matrix: 'Publish a public link',
  list_matrix_shares: 'List public links',
  revoke_matrix_share: 'Revoke a public link',
  get_management_architecture: 'Get meeting architecture',
  diagnose_theme_deployment: 'Diagnose theme deployment',
  suggest_meeting_for_topic: 'Suggest a meeting for a topic',
  get_agenda: 'Get agenda and what is due',
  schedule_review: 'Schedule a review',
  record_review: 'Record a review',
  create_matrix: 'Create a matrix',
  upsert_element: 'Add or edit an element',
  get_cascade: 'Get cascade report',
  set_matrix_parent: 'Set parent matrix',
  set_correlation: 'Set a correlation',
  show_matrix: 'Show the X-Matrix',
  get_review: 'Get a recorded review',
  upsert_cadence: 'Add or edit a cadence',
  upsert_initiative_sheet: 'Edit an initiative sheet',
  set_kpi_definition: 'Set a KPI definition',
  get_excellence_roadmap: 'Get excellence roadmap',
  assess_roadmap_item: 'Assess a roadmap item',
  show_roadmap: 'Show a site roadmap',
  show_site_comparison: 'Compare sites',
  get_roadmap_translation: 'Get a roadmap translation',
  translate_roadmap: 'Write a roadmap translation',
  list_members: 'List members',
  archive_matrix: 'Archive a matrix',
  delete_matrix: 'Delete a matrix',
  delete_element: 'Delete an element',
  export_matrix_image: 'Export matrix image',
  whoami: 'Who am I',
  get_help: 'Get help',
  report_missing_capability: 'Report a missing capability'
};

for (const tool of tools) {
  const readOnly = READ_ONLY.has(tool.name);
  const title = TOOL_TITLES[tool.name];
  if (!title) throw new Error(`tool ${tool.name} has no title in TOOL_TITLES`);
  // MCP 2025-06-18 puts the display name on the tool; older clients read it in annotations.
  tool.title = title;
  tool.annotations = {
    title,
    readOnlyHint: readOnly,
    ...(readOnly ? {} : { destructiveHint: DESTRUCTIVE.has(tool.name) }),
    // share_matrix publishes a page anyone with the link can open.
    openWorldHint: tool.name === 'share_matrix'
  };
}
