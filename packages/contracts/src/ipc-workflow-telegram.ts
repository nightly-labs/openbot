/**
 * Telegram triggers and outputs of workflows. A Telegram trigger starts a run when a person mentions the
 * OpenBot bot, or replies to it, in a linked group chat; a Telegram output answers that message, posts in
 * a linked chat or adds a reaction. The node fields are in `WorkflowFields`. An owner or admin of a joined
 * server changes these nodes only through `workflows-chats-v1`, with the chats of the routine-results
 * options; any other joined client reads them.
 */

/** The events that a Telegram trigger can start on. The bot gets a group message only when it is named. */
export const WORKFLOW_TELEGRAM_EVENTS = ["mention"] as const;
export type WorkflowTelegramEvent = (typeof WORKFLOW_TELEGRAM_EVENTS)[number];

/** What a Telegram output can do. */
export const WORKFLOW_TELEGRAM_ACTIONS = ["reply", "post", "react"] as const;
export type WorkflowTelegramAction = (typeof WORKFLOW_TELEGRAM_ACTIONS)[number];

/** The emoji that a `react` output can add. The Bot API accepts only emoji from its own list. */
export const WORKFLOW_TELEGRAM_EMOJI = ["👍", "👀", "🎉", "👌"] as const;
export type WorkflowTelegramEmoji = (typeof WORKFLOW_TELEGRAM_EMOJI)[number];

/** The `connectionId` of an output that acts on the chat of the trigger. */
export const WORKFLOW_TELEGRAM_TRIGGER_CHAT = "trigger";

/** The longest `text` filter of a Telegram trigger. */
export const WORKFLOW_TELEGRAM_TEXT_LIMIT = 200;
