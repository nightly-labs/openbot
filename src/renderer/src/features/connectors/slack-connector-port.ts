import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the Slack page reaches in main: the Slack workspaces of this computer. */
export interface SlackConnectorPort {
  messaging: OpenBotDesktopApi["messaging"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function slackConnectorPort(): SlackConnectorPort {
  return { messaging: window.openbot.messaging };
}
