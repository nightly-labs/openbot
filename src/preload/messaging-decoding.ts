// What main answers for the Slack workspaces of this computer. These guard the renderer.

import { isSlackOverview, type SlackOverview } from "@openbot/contracts/ipc";

export function decodeSlackOverviewReply(value: unknown): SlackOverview {
  if (!isSlackOverview(value)) throw new Error("Invalid Slack overview response.");
  return value;
}
