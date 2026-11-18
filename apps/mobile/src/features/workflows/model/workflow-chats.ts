import {
  type RoutineResultConnectionOption,
  WORKFLOW_SLACK_TRIGGER_WORKSPACE,
  WORKFLOW_TELEGRAM_TRIGGER_CHAT,
} from "@openbot/contracts/ipc";

/**
 * The fields that a new Telegram or Slack trigger or output stores, as the desktop cards do. The host reads
 * the same names (`workflows-chats-v1`).
 */
export const TELEGRAM_TRIGGER_DEFAULTS = { event: "mention", connectionId: "" } as const;
export const SLACK_TRIGGER_DEFAULTS = { event: "mention", connectionId: "", placeId: "" } as const;
export const TELEGRAM_OUTPUT_DEFAULTS = { connectionId: WORKFLOW_TELEGRAM_TRIGGER_CHAT, action: "reply" } as const;
export const SLACK_OUTPUT_DEFAULTS = {
  connectionId: WORKFLOW_SLACK_TRIGGER_WORKSPACE,
  action: "reply",
  placeId: "",
} as const;

/** The host's linked Telegram chats: one connection is one chat. */
export function telegramChats(options: readonly RoutineResultConnectionOption[]) {
  return options.filter((option) => option.platform === "telegram");
}

/** The host's Slack workspaces, each with its channels. */
export function slackWorkspaces(options: readonly RoutineResultConnectionOption[]) {
  return options.filter((option) => option.platform === "slack");
}

/** The driver names a Slack channel "#general"; the rows add no "#" of their own on the phone. */
export function channelName(name: string): string {
  return name.startsWith("#") ? name : `#${name}`;
}
