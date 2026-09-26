import {
  decodeQueueEditRequest,
  QueueEditRejectedError,
  TEAM_QUEUE_EDIT_CAPABILITY,
} from "@openbot/contracts/team-protocol/queue-edit-v1";
import { HttpError } from "./http-error";
// One agent's outgoing queue, and the ways a member can change their mind about it.
//
// Cancel, steer, update and reorder all name the delivery they mean, and `steer` also names the
// turn it expected to be running. The agent service rejects a stale expectation; these routes only
// see that the field arrived.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { ReorderQueueInput, SteerQueuedMessageInput, UpdateQueuedMessageInput } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAgents } from "./dependencies";
import type { AgentRouteTarget, RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, stringArray, stringField } from "./request-helpers";

export interface AgentQueueRouteDependencies {
  agents: Pick<
    TeamApiAgents,
    | "listQueue"
    | "acknowledgeFailedTurn"
    | "cancelQueuedMessage"
    | "steerQueuedMessage"
    | "updateQueuedMessage"
    | "editQueuedMessage"
    | "reorderQueue"
    | "interrupt"
  >;
}

export async function routeAgentQueue(
  context: TeamApiRequestContext,
  { agentId, action }: AgentRouteTarget,
  { agents }: AgentQueueRouteDependencies,
): Promise<RouteOutcome> {
  const { method, request, json, empty } = context;

  if (method === "POST" && action === "queue/edit") {
    if (context.protocol < 3 || !context.capabilities.has(TEAM_QUEUE_EDIT_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.queueEditUnsupported"));
    try {
      return json(200, await agents.editQueuedMessage(agentId, decodeQueueEditRequest(await readJson(request))));
    } catch (error) {
      if (error instanceof QueueEditRejectedError) throw new HttpError(409, error.message);
      throw error;
    }
  }
  if (method === "GET" && action === "queue") {
    return json(200, agents.listQueue(agentId));
  }
  if (method === "POST" && action === "failures/acknowledge") {
    const body = await readJson(request);
    agents.acknowledgeFailedTurn(agentId, stringField(body, "turnId"));
    return empty(204);
  }
  if (method === "POST" && action === "queue/cancel") {
    const body = await readJson(request);
    await agents.cancelQueuedMessage(agentId, stringField(body, "deliveryId"));
    return empty(204);
  }
  if (method === "POST" && action === "queue/steer") {
    const body = await readJson(request);
    await agents.steerQueuedMessage({
      agentId,
      deliveryId: stringField(body, "deliveryId"),
      expectedTurnId: stringField(body, "expectedTurnId"),
    } satisfies SteerQueuedMessageInput);
    return empty(204);
  }
  if (method === "POST" && action === "queue/update") {
    const body = await readJson(request);
    await agents.updateQueuedMessage({
      agentId,
      deliveryId: stringField(body, "deliveryId"),
      text: stringField(body, "text", true, INPUT_LIMITS.messageText),
      keepAttachmentIds: stringArray(body, "keepAttachmentIds"),
      attachmentDraftIds: stringArray(body, "attachmentDraftIds"),
    } satisfies UpdateQueuedMessageInput);
    return empty(204);
  }
  if (method === "POST" && action === "queue/reorder") {
    const body = await readJson(request);
    await agents.reorderQueue({
      agentId,
      deliveryIds: stringArray(body, "deliveryIds", INPUT_LIMITS.messageRecipients),
    } satisfies ReorderQueueInput);
    return empty(204);
  }
  if (method === "POST" && action === "interrupt") {
    const body = await readJson(request);
    await agents.interrupt(agentId, stringField(body, "turnId"));
    return empty(204);
  }

  return "unmatched";
}
