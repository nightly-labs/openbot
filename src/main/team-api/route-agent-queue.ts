import { TEAM_QUEUE_WINDOW_CAPABILITY } from "@openbot/contracts/team-protocol/current";
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
import type {
  QueueDelivery,
  QueueSnapshot,
  ReorderQueueInput,
  SteerQueuedMessageInput,
  UpdateQueuedMessageInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { SteerUnsupportedError } from "../../backend/agent/queue-controls";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import type { AgentRouteTarget, RouteOutcome, TeamApiRequestContext } from "./request-context";
import {
  memberSender,
  readJson,
  requireListedAgent,
  stringArray,
  stringField,
  WEBRTC_FRAME_BODY_BUDGET,
} from "./request-helpers";

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
    | "listAgents"
  >;
}

export async function routeAgentQueue(
  context: TeamApiRequestContext,
  { agentId, action }: AgentRouteTarget,
  { agents }: AgentQueueRouteDependencies,
): Promise<RouteOutcome> {
  const { method, request, member, json, empty } = context;
  const snapshot = (value: QueueSnapshot) =>
    json(
      200,
      context.protocol >= 7 && context.capabilities.has(TEAM_QUEUE_WINDOW_CAPABILITY) ? queueWindow(value) : value,
    );

  if (method === "POST" && action === "queue/edit") {
    if (context.protocol < 3 || !context.capabilities.has(TEAM_QUEUE_EDIT_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.queueEditUnsupported"));
    try {
      return snapshot(
        await runCauseEffect(
          agents.editQueuedMessage(agentId, decodeQueueEditRequest(await readJson(request)), memberSender(member)),
        ),
      );
    } catch (error) {
      if (error instanceof QueueEditRejectedError) throw new HttpError(409, error.message);
      throw error;
    }
  }
  if (method === "GET" && action === "queue") {
    return snapshot(agents.listQueue(agentId));
  }
  if (method === "POST" && action === "failures/acknowledge") {
    const body = await readJson(request);
    agents.acknowledgeFailedTurn(agentId, stringField(body, "turnId"));
    return empty(204);
  }
  if (method === "POST" && action === "queue/cancel") {
    const body = await readJson(request);
    await runCauseEffect(agents.cancelQueuedMessage(agentId, stringField(body, "deliveryId")));
    return empty(204);
  }
  if (method === "POST" && action === "queue/steer") {
    const body = await readJson(request);
    requireListedAgent(agents, agentId);
    try {
      await runCauseEffect(
        agents.steerQueuedMessage({
          agentId,
          deliveryId: stringField(body, "deliveryId"),
          expectedTurnId: stringField(body, "expectedTurnId"),
        } satisfies SteerQueuedMessageInput),
      );
    } catch (error) {
      // A client shows a refusal's text, but only "Request failed" for a 500.
      if (error instanceof SteerUnsupportedError) throw new HttpError(409, error.message);
      throw error;
    }
    return empty(204);
  }
  if (method === "POST" && action === "queue/update") {
    const body = await readJson(request);
    await runCauseEffect(
      agents.updateQueuedMessage(
        {
          agentId,
          deliveryId: stringField(body, "deliveryId"),
          text: stringField(body, "text", true, INPUT_LIMITS.messageText),
          keepAttachmentIds: stringArray(body, "keepAttachmentIds"),
          attachmentDraftIds: stringArray(body, "attachmentDraftIds"),
        } satisfies UpdateQueuedMessageInput,
        memberSender(member),
      ),
    );
    return empty(204);
  }
  if (method === "POST" && action === "queue/reorder") {
    const body = await readJson(request);
    await runCauseEffect(
      agents.reorderQueue({
        agentId,
        deliveryIds: stringArray(body, "deliveryIds", INPUT_LIMITS.messageRecipients),
      } satisfies ReorderQueueInput),
    );
    return empty(204);
  }
  if (method === "POST" && action === "interrupt") {
    const body = await readJson(request);
    requireListedAgent(agents, agentId);
    await runCauseEffect(agents.interrupt(agentId, stringField(body, "turnId")));
    return empty(204);
  }

  return "unmatched";
}

/** The completed deliveries a queue-window-v1 snapshot keeps at most. */
const QUEUE_WINDOW_COMPLETED_LIMIT = 100;
const ACTIVE_STATUSES = new Set<QueueDelivery["status"]>(["queued", "starting", "running"]);

/**
 * queue-window-v1: the queue without its old history. The store keeps every finished delivery, so a
 * long-lived agent's full snapshot passes one WebRTC frame and a remote client cannot read it.
 * Every active delivery stays, because the composer, the queue and the edit lock act on them. Then
 * every failed, interrupted and cancelled delivery stays, newest first, while it fits in the frame:
 * the clients show its failure reason or hide its message, at any age. Only completed deliveries
 * leave: the newest 100 stay, for receipts, while they fit.
 */
function queueWindow(snapshot: QueueSnapshot): QueueSnapshot {
  const newestFirst = snapshot.deliveries
    .map((delivery, index) => ({ delivery, index }))
    .filter(({ delivery }) => !ACTIVE_STATUSES.has(delivery.status))
    .sort((a, b) => b.delivery.createdAt.localeCompare(a.delivery.createdAt) || b.index - a.index)
    .map(({ delivery }) => delivery);
  if (newestFirst.length === 0) return snapshot;
  const kept = new Set<QueueDelivery>();
  let bytes = Buffer.byteLength(
    JSON.stringify({
      ...snapshot,
      deliveries: snapshot.deliveries.filter(({ status }) => ACTIVE_STATUSES.has(status)),
    }),
  );
  const keep = (deliveries: QueueDelivery[]) => {
    for (const delivery of deliveries) {
      const next = bytes + Buffer.byteLength(JSON.stringify(delivery)) + 1;
      if (next > WEBRTC_FRAME_BODY_BUDGET) return;
      bytes = next;
      kept.add(delivery);
    }
  };
  keep(newestFirst.filter(({ status }) => status !== "completed"));
  keep(newestFirst.filter(({ status }) => status === "completed").slice(0, QUEUE_WINDOW_COMPLETED_LIMIT));
  return {
    ...snapshot,
    deliveries: snapshot.deliveries.filter((delivery) => ACTIVE_STATUSES.has(delivery.status) || kept.has(delivery)),
  };
}
