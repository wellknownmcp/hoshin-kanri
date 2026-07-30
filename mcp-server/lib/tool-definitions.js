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
        source: {
          type: 'string',
          enum: ['conversation', 'team_meeting', 'customer_feedback', 'market_analysis', 'internal_audit', 'other'],
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
          enum: ['active', 'completed', 'on_hold', 'all'],
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
          enum: ['active', 'completed', 'on_hold', 'cancelled'],
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
  }
];
