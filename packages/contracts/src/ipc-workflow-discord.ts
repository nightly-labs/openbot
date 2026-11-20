export const WORKFLOW_DISCORD_EVENTS = ["mention"] as const;
export type WorkflowDiscordEvent = (typeof WORKFLOW_DISCORD_EVENTS)[number];

export const WORKFLOW_DISCORD_ACTIONS = ["reply", "post", "react"] as const;
export type WorkflowDiscordAction = (typeof WORKFLOW_DISCORD_ACTIONS)[number];

export const WORKFLOW_DISCORD_EMOJI = ["✅", "👀", "🎉", "❌"] as const;
export type WorkflowDiscordEmoji = (typeof WORKFLOW_DISCORD_EMOJI)[number];

export const WORKFLOW_DISCORD_TRIGGER_SERVER = "trigger";

export const WORKFLOW_DISCORD_TEXT_LIMIT = 200;
