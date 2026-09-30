import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { renderSlackIcon } from "./slack-icon";

/** What the Slack page reaches in main: the Slack apps of this computer's agents. */
export interface SlackConnectorPort {
  messaging: OpenBotDesktopApi["messaging"];
  /** The agent's avatar as a PNG for its Slack app icon. */
  slackIcon: (agentId: string) => Promise<Uint8Array>;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function slackConnectorPort(): SlackConnectorPort {
  return {
    messaging: window.openbot.messaging,
    slackIcon: (agentId) => window.openbot.agentTemplates.preview(agentId).then(renderSlackIcon),
  };
}
