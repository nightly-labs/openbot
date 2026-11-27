export const WORKFLOW_TELEGRAM_EVENTS = ["mention"] as const;
export type WorkflowTelegramEvent = (typeof WORKFLOW_TELEGRAM_EVENTS)[number];

export const WORKFLOW_TELEGRAM_ACTIONS = ["reply", "post", "react"] as const;
export type WorkflowTelegramAction = (typeof WORKFLOW_TELEGRAM_ACTIONS)[number];

export const WORKFLOW_TELEGRAM_EMOJI = ["👍", "👀", "🎉", "👌"] as const;
export type WorkflowTelegramEmoji = (typeof WORKFLOW_TELEGRAM_EMOJI)[number];

export const WORKFLOW_TELEGRAM_TRIGGER_CHAT = "trigger";

export const WORKFLOW_TELEGRAM_TEXT_LIMIT = 200;
