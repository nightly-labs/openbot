import {
  type RoutineResultConnectionOption,
  WORKFLOW_SLACK_TRIGGER_WORKSPACE,
  WORKFLOW_TELEGRAM_TRIGGER_CHAT,
} from "@openbot/contracts/ipc";

export const TELEGRAM_TRIGGER_DEFAULTS = { event: "mention", connectionId: "" } as const;
export const SLACK_TRIGGER_DEFAULTS = { event: "mention", connectionId: "", placeId: "" } as const;
export const TELEGRAM_OUTPUT_DEFAULTS = { connectionId: WORKFLOW_TELEGRAM_TRIGGER_CHAT, action: "reply" } as const;
export const SLACK_OUTPUT_DEFAULTS = {
  connectionId: WORKFLOW_SLACK_TRIGGER_WORKSPACE,
  action: "reply",
  placeId: "",
} as const;

export function telegramChats(options: readonly RoutineResultConnectionOption[]) {
  return options.filter((option) => option.platform === "telegram");
}

export function slackWorkspaces(options: readonly RoutineResultConnectionOption[]) {
  return options.filter((option) => option.platform === "slack");
}

export function channelName(name: string): string {
  return name.startsWith("#") ? name : `#${name}`;
}
