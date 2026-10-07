import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
export function bitwardenConnectorPort(): OpenBotDesktopApi["bitwardenConnector"] {
  return window.openbot.bitwardenConnector;
}
