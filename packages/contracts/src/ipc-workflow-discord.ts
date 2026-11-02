/**
 * Discord triggers and outputs of workflows. A Discord trigger starts a run when a person mentions
 * OpenBot in a channel of a connected Discord server; a Discord output answers that message, posts in a
 * channel or adds a reaction. The node fields are in `WorkflowFields`. A joined client reads these nodes
 * and cannot change them: the server list, its channels and its roles are on the host only.
 */

/** The events that a Discord trigger can start on. Signal passes on only messages that mention OpenBot. */
export const WORKFLOW_DISCORD_EVENTS = ["mention"] as const;
export type WorkflowDiscordEvent = (typeof WORKFLOW_DISCORD_EVENTS)[number];

/** What a Discord output can do. */
export const WORKFLOW_DISCORD_ACTIONS = ["reply", "post", "react"] as const;
export type WorkflowDiscordAction = (typeof WORKFLOW_DISCORD_ACTIONS)[number];

/** The emoji that a `react` output can add. */
export const WORKFLOW_DISCORD_EMOJI = ["✅", "👀", "🎉", "❌"] as const;
export type WorkflowDiscordEmoji = (typeof WORKFLOW_DISCORD_EMOJI)[number];

/** The `connectionId` of an output that acts on the server of the trigger. */
export const WORKFLOW_DISCORD_TRIGGER_SERVER = "trigger";

/** The longest `text` filter of a Discord trigger. */
export const WORKFLOW_DISCORD_TEXT_LIMIT = 200;
