// What main answers for the Slack workspaces of this computer. These guard the renderer.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { isSlackOverview, type SlackOverview } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";

/** The id of the agent that main created. */
export function decodeAgentIdReply(value: unknown): string {
  if (!isString(value) || !value || value.length > INPUT_LIMITS.identifier)
    throw new Error("Invalid agent id response.");
  return value;
}

export function decodeSlackOverviewReply(value: unknown): SlackOverview {
  if (!isSlackOverview(value)) throw new Error("Invalid Slack overview response.");
  return value;
}
