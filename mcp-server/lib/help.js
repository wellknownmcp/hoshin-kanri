// get_help: the server's own manual, served the same by every transport
// (docs/sprint-identite-agent-et-plans.md). Static text, no API call: an agent
// can read it before it has any rights, and the local mode sends nothing anywhere.
// Several clients (claude.ai among them) show neither the server instructions nor
// the prompts to the model: what an agent must know is here and in tool descriptions.

import { getPromptMessages } from './prompt-definitions.js';

const TOPICS = {
  overview: `Hoshin Kanri keeps an organization's strategy as an X-Matrix and runs its review cycle.
The matrix has four quadrants, named as upsert_element and list_objectives name them: north = long-term vision
(3-5 years), east = annual objectives, south = initiatives, west = KPIs. How a picture of the matrix is turned
on the page does not change these names. Correlations link adjacent quadrants only
(north-east, east-south, south-west, west-north); a KPI measures an objective through the initiatives that serve it.
Start a session with whoami (who you act as, what you may do), then list_matrices, then get_agenda
(what is due before the next review). Read before you write; the people decide, you prepare and record.`,
  workflows: `Review cycle:
1. get_agenda: today's date, reviews ahead, what is due (review to prepare, review held but not recorded,
   cadence with no review scheduled, KPI missing the reading of the last closed period, initiative without an update, overdue action).
2. Before a review: update KPIs and initiatives (update_element_status with period, current_value or progress),
   then prepare the agenda (get_matrix_summary, diagnose_theme_deployment).
3. After a review: record_review with the notes, the decisions as the participants stated them, the elements discussed, and held_on.
   It keeps a snapshot of the matrix as it stands then: record before correcting figures. get_review reads it back.
4. No review scheduled: schedule_review with the date get_agenda expects (a second call the same day is refused, MEETING_ALREADY_SCHEDULED).
Heartbeat agents: pass since (the time of your previous call) to get_agenda, so you never act twice on the same item.
Building a matrix: create_matrix, then upsert_element per quadrant, then set_correlation between adjacent quadrants; get_matrix_completeness scores it.
get_help topic "modeling" says how to fill it well. Owners: list_members gives the ids for owner_id; inviting a person is done in the app by an admin.
Initiatives: upsert_initiative_sheet (why, expected result, milestones, next action, health with its sentence, blockers).
KPIs: set_kpi_definition (formula, source system and reference, data owner, frequency), read it before every reading.
Cadences: upsert_cadence creates or changes one (a monthly committee); get_management_architecture lists them.
Several matrices: pass matrix_id everywhere as soon as list_matrices shows more than one. Without it, every tool uses the
same one: the default matrix if it is active, else the first active one.
Mark visibility "internal" on what must not leave the organization (named prospects or clients, salaries) before share_matrix or an external picture.
Repairing: delete_element for a duplicate or a mistake (update_element_status "cancelled" for something the organization dropped);
archive_matrix sets a matrix aside; delete_matrix asks for its exact name and cannot be undone.
Copying a value from another tool (HubSpot, a finance tool): pass origin_tool, origin_ref and extracted_at with current_value.
To show the matrix to the person in the conversation: show_matrix (the X-Matrix and a card per initiative; hosts with MCP Apps draw it).
For anything shown outside the organization, read with get_matrix_data audience "external": the same filter as a public link,
so you never decide alone what may leave. Each initiative has a page (pageUrl), the reference version to cite.
For a deck: export_matrix_image (audience "external" leaves out internal elements and every figure; layout "initiatives"
gives one page per initiative sheet). It returns SVG; format "png" returns the pictures as images, for Google Slides.
Weekly sync with an execution tool (Linear, Jira): the prompt weekly_sync. Ideas from the field: add_idea, then update_idea to triage.
Groups and sites: get_cascade, set_matrix_parent.`,
  heartbeat: `A recurring agent (a scheduled task, a heartbeat) does this at each pass:
whoami once, then get_agenda with since = the time of its previous pass. For each item, by kind:
- review_upcoming: prepare it. Take the readings that are due (see kpi_reading_missing), update the initiatives,
  then write the agenda for the people (get_matrix_data). Alone: yes. Send it to the people who run the review.
- review_unrecorded: the review was held and not recorded. Ask the people what was decided; then record_review with
  their words. Never write decisions nobody stated.
- review_unscheduled: propose a date to a person; once agreed, schedule_review. Alone: only if a person asked for it.
- kpi_reading_missing: read the KPI's definition (get_matrix_data, kpiDefinition), take the value where it
  says, then update_element_status with current_value, period, origin_tool, origin_ref, extracted_at. Alone: yes.
  A reading of an open period is provisional and may be corrected; once its period has ended it is final.
- initiative_stale: get the progress from the execution tool (external_ref) or ask the owner; then update_element_status
  with progress and notes, and upsert_initiative_sheet for the next action and the health. Alone: from a tool, yes;
  the health of an initiative is the owner's call, propose it.
- action_overdue: remind the person it is assigned to; never close it in their place.
Write what you did in one short message to the people concerned. Keep your schedule, your since cursor and your
collection recipe in your own configuration: they are how you work, not the strategy.`,
  modeling: `Filling a matrix well:
- 3 to 5 elements per quadrant: fewer leaves the strategy vague, more dilutes it (the completeness score counts it).
- Correlation strength: strong = the initiative is designed for this objective, or the KPI measures it directly;
  medium = it contributes clearly but is not the main lever; weak = an indirect or partial effect. No link rather than a weak one
  when in doubt: a matrix full of weak links tells the committee nothing.
- Status "draft" for a hypothesis the committee has not validated yet; it becomes "active" once the review agrees.
- Visibility "internal", at creation, for anything that must not leave the organization (named prospects or clients,
  amounts, salaries): upsert_element with visibility. Public pages and external pictures leave it out, with its links.
- A KPI measures an annual objective through the initiatives that serve it. Give each KPI indicator_type
  (result or performance) and a definition (set_kpi_definition), so another agent computes it the same way.
- Each initiative gets a sheet a committee reads in two minutes (upsert_initiative_sheet). When an execution tool
  holds the project, set external_ref, keep the tasks there and the sheet as its summary.`,
  prompts: `Two prompts carry a whole workflow. Clients that do not show MCP prompts can read their text here,
in "prompts" below: follow it as if the user had picked the prompt.
- matrix_artifact: build an interactive X-Matrix for a leadership meeting from get_matrix_data.
- weekly_sync: sync the initiatives with the execution tool (Linear, Jira) and prepare the weekly agenda.`,
  rights: `What a connection may do is the member's role, capped by the credential:
- OAuth (claude.ai, Cursor, Desktop): you act as the person who consented, capped by the scopes (mcp:read, mcp:write, mcp:admin).
- API token (hk_...): created by an admin, it acts as that admin, capped by its permissions (read, or read and write: editor at most).
- A matrix with assigned editors can only be changed by them and by admins (MATRIX_EDIT_RESTRICTED).
- The plan can hold agents at read-only (PLAN_READ_ONLY): whoami says whether it is enforced.
- A connection acts in one organization. A person may have several: to act in another, they connect the client
  a second time and choose that organization on the consent screen. This connection is not told the others.
Call whoami to read all of it for your connection, including which matrices you may edit.`,
  errors: `Errors arrive as "HTTP <status> <CODE>: <message>". The common ones:
FORBIDDEN (role too low for this write), PLAN_READ_ONLY (the plan gives agents read-only access),
PLAN_LIMIT_MATRICES / PLAN_LIMIT_USERS (plan limit reached), MATRIX_EDIT_RESTRICTED (matrix reserved to its editors),
NOT_ADJACENT (correlation between non-adjacent quadrants), NOT_A_KPI / KPI_NO_PROGRESS (a reading or a definition on a non-KPI, a progress on a KPI),
NOT_AN_INITIATIVE (a sheet on a non-initiative), HEALTH_NOTE_REQUIRED (a health without its sentence), MEASURE_NOT_A_KPI (measured_by is not a KPI of the matrix),
PARENT_NOT_FOUND / SELF_PARENT / CADENCE_CYCLE (parent cadence),
MEETING_ALREADY_SCHEDULED, MEETING_ALREADY_COMPLETED, MEETING_CANCELLED, DATE_IN_FUTURE,
ELEMENT_NOT_FOUND, VALIDATION_ERROR (with the invalid fields), RATE_LIMITED,
CONFIRMATION_MISMATCH (delete_matrix: confirm_name is not the exact name), DEFAULT_MATRIX_ADMIN_ONLY (archiving or deleting the default matrix).
If what you need does not exist, say so with report_missing_capability.`,
  local: `Local mode keeps the matrix in JSON files on this machine (HOSHIN_DATA_DIR); nothing is sent anywhere.
The same tools work, except share_matrix (no public page) and report_missing_capability (it gives you the address to file it yourself).
Rights do not apply: whoever runs the server owns the data.`,
};

export const HELP_TOPICS = Object.keys(TOPICS);

export function getHelp({ topic } = {}) {
  if (topic && !TOPICS[topic]) {
    return { error: `Unknown topic "${topic}". Topics: ${HELP_TOPICS.join(', ')}.` };
  }
  if (topic === 'prompts') {
    const text = (name) => getPromptMessages(name).messages.map((m) => m.content.text).join('\n\n');
    return { topic, text: TOPICS.prompts, prompts: { matrix_artifact: text('matrix_artifact'), weekly_sync: text('weekly_sync') }, topics: HELP_TOPICS };
  }
  if (topic) return { topic, text: TOPICS[topic], topics: HELP_TOPICS };
  return {
    topic: 'overview',
    text: TOPICS.overview,
    topics: HELP_TOPICS,
    more: 'Call get_help with one of these topics. Full reference: https://hoshin.app/llms.txt',
  };
}

export const ISSUES_URL = 'https://github.com/wellknownmcp/hoshin-kanri/issues';

/** report_missing_capability in local mode: nothing is sent, the agent gets the text to file. */
export function localCapabilityReport(args = {}) {
  const lines = [
    String(args.capability || '').trim(),
    args.use_case ? `Use case: ${args.use_case}` : null,
    args.feature ? `Listed capability: ${args.feature}` : null,
  ].filter(Boolean);
  return {
    sent: false,
    message: 'Local mode sends nothing. To tell the Hoshin Kanri team, open an issue (or ask the user to) with this text.',
    fileAt: ISSUES_URL,
    draft: lines.join('\n'),
  };
}

/** Sent at initialization: clients put it in the model's context without a tool call. */
export const SERVER_INSTRUCTIONS = `Hoshin Kanri keeps the organization's strategy as an X-Matrix (north: long-term vision, east: annual objectives, south: initiatives, west: KPIs) and runs its review cycle.
Start with whoami (who you act as, what you may change), then list_matrices, then get_agenda (today's date and what is due before the next review). get_help explains workflows, rights and error codes.
Read before you write. People decide; you prepare, update readings and progress, and record what the review decided (record_review). If something you need does not exist, use report_missing_capability.`;
