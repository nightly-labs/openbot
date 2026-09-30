import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the Connectors section reaches in main: the one GitHub connection of this computer. */
export type GitHubConnectorPort = OpenBotDesktopApi["githubConnector"];

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function githubConnectorPort(): GitHubConnectorPort {
  return window.openbot.githubConnector;
}
