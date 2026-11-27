export const WORKFLOW_SLACK_EVENTS = ["mention"] as const;
export type WorkflowSlackEvent = (typeof WORKFLOW_SLACK_EVENTS)[number];

export const WORKFLOW_SLACK_ACTIONS = ["reply", "post", "react"] as const;
export type WorkflowSlackAction = (typeof WORKFLOW_SLACK_ACTIONS)[number];

export const WORKFLOW_SLACK_EMOJI = ["✅", "👀", "🎉", "❌"] as const;
export type WorkflowSlackEmoji = (typeof WORKFLOW_SLACK_EMOJI)[number];

export const WORKFLOW_SLACK_TRIGGER_WORKSPACE = "trigger";

export const WORKFLOW_SLACK_TEXT_LIMIT = 200;
