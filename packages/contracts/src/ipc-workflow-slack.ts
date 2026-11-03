/**
 * Slack triggers and outputs of workflows. A Slack trigger starts a run when a person mentions OpenBot in
 * a channel of a connected Slack workspace; a Slack output replies in the thread of that message, posts
 * in a channel or adds a reaction. The node fields are in `WorkflowFields`. A joined client reads these
 * nodes and cannot change them: the workspace list and its channels are on the host only.
 */

/** The events that a Slack trigger can start on. Slack sends `app_mention` for a message that names OpenBot. */
export const WORKFLOW_SLACK_EVENTS = ["mention"] as const;
export type WorkflowSlackEvent = (typeof WORKFLOW_SLACK_EVENTS)[number];

/** What a Slack output can do. */
export const WORKFLOW_SLACK_ACTIONS = ["reply", "post", "react"] as const;
export type WorkflowSlackAction = (typeof WORKFLOW_SLACK_ACTIONS)[number];

/** The emoji that a `react` output can add. The host gives Slack the name of each one. */
export const WORKFLOW_SLACK_EMOJI = ["✅", "👀", "🎉", "❌"] as const;
export type WorkflowSlackEmoji = (typeof WORKFLOW_SLACK_EMOJI)[number];

/** The `connectionId` of an output that acts on the workspace of the trigger. */
export const WORKFLOW_SLACK_TRIGGER_WORKSPACE = "trigger";

/** The longest `text` filter of a Slack trigger. */
export const WORKFLOW_SLACK_TEXT_LIMIT = 200;
