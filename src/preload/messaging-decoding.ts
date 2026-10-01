// What main answers for the Slack workspaces of this computer. These guard the renderer.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type AddSlackOrchestratorResult, isSlackOverview, type SlackOverview } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

function isIdentifier(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= INPUT_LIMITS.identifier;
}

/** The orchestrator that main created, and the sidebar section it went to. */
export function decodeAddSlackOrchestratorReply(value: unknown): AddSlackOrchestratorResult {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.agentId) ||
    !(value.sectionId === null || isIdentifier(value.sectionId))
  )
    throw new Error("Invalid Slack orchestrator response.");
  return { agentId: value.agentId, sectionId: value.sectionId };
}

export function decodeSlackOverviewReply(value: unknown): SlackOverview {
  if (!isSlackOverview(value)) throw new Error("Invalid Slack overview response.");
  return value;
}
