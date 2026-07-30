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
        }
      },
      required: ['title']
    }
  },
  {
    name: 'list_objectives',
    description: 'List strategic objectives from the X-Matrix. Can filter by quadrant (north=long-term objectives, east=annual objectives, south=actions/projects, west=KPIs).',
    inputSchema: {
      type: 'object',
      properties: {
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
    description: 'Get a summary of the current X-Matrix state including progress on objectives, key correlations, and attention items.',
    inputSchema: {
      type: 'object',
      properties: {
        include_correlations: {
          type: 'boolean',
          description: 'Include element correlations in response (default: true)'
        }
      }
    }
  },
  {
    name: 'update_element_status',
    description: 'Update the status or progress of a matrix element (objective, action, or KPI).',
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
          description: 'Progress percentage (0-100)'
        },
        notes: {
          type: 'string',
          description: 'Update notes or comments'
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
- Indicator Balance: checks if objectives/initiatives have both RESULT (lagging - measures outcomes like revenue, NPS) AND PERFORMANCE (leading - measures process like calls/week, % completion) indicators linked.

Ideal state: each objective and initiative should be linked to at least one result indicator AND one performance indicator.`,
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
    description: `Get the COMPLETE dataset of an X-Matrix in one call: every element of all four quadrants (id, title, status, progress, externalRef, indicator type), all correlations (from/to element ids and titles, strength), and the completeness score.

Use this instead of get_matrix_summary when you need the full matrix — typically to render a view or build an interactive artifact (e.g. an X-Matrix cockpit for a leadership meeting, shareable with the team). The matrix_artifact prompt shows the recommended artifact layout.`,
    inputSchema: {
      type: 'object',
      properties: {
        matrix_id: {
          type: 'string',
          description: 'UUID of the matrix (optional, uses the first active matrix if not provided)'
        }
      }
    }
  },
  {
    name: 'share_matrix',
    description: `Publish a matrix as a public read-only web page and return the tokenized link — or list/revoke existing share links.

Publication is a deliberate act: anyone with the link can view the matrix (title, elements, correlations, completeness score) until the link is revoked or expires. The page is never indexed by search engines. Use it to share the X-Matrix with people OUTSIDE the organization (board members, investors, partners) without creating accounts. For sharing inside a claude.ai Team organization, prefer the matrix_artifact prompt instead.

Not available in local JSON mode (sovereign mode has no cloud page by design — export a snapshot artifact instead).`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'revoke'],
          description: 'create (default): publish and return the link. list: existing shares with status. revoke: kill a link (requires share_id).'
        },
        matrix_id: {
          type: 'string',
          description: 'UUID of the matrix (optional, uses the first active matrix if not provided)'
        },
        share_id: {
          type: 'string',
          description: 'UUID of the share to revoke (required for action=revoke, from action=list)'
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
        }
      }
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
    name: 'create_matrix',
    description:
      'Create a new X-Matrix. Use this to start a strategy from scratch: create the matrix, then add elements with upsert_element and wire them with set_correlation. The first matrix of an organization becomes the default one.',
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
          enum: ['annual', 'multi_year', 'quarterly'],
          description: 'Planning horizon (default: annual)'
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
        }
      },
      required: ['name']
    }
  },
  {
    name: 'upsert_element',
    description:
      'Create an X-Matrix element, or update one when element_id is given. Quadrants: north = 3-5 year vision, east = annual objectives, south = initiatives, west = KPIs. A west element should carry indicator_type so the completeness score can judge the leading/lagging balance.',
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
        }
      }
    }
  },
  {
    name: 'set_correlation',
    description:
      'Wire two elements of adjacent quadrants together, or unwire them with strength "none". Only adjacent pairs carry meaning: north↔east, east↔south, south↔west, north↔west. That constraint is what makes the matrix a deployment tool — a vision reaches a KPI through an objective and an initiative, never directly.',
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
  }
];
