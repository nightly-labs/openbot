import type { QueueSnapshot } from "@openbot/contracts/ipc";
import {
  AGENT_ACTIVE_QUEUE_DELIVERY_LIMIT,
  AGENT_ACTIVE_QUEUES_CAPABILITY,
  AGENT_ACTIVE_QUEUES_LIMIT,
  AGENT_ACTIVE_QUEUES_ROUTES,
} from "@openbot/contracts/team-protocol/agent-active-queues-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, stringArray, WEBRTC_FRAME_BODY_BUDGET } from "./request-helpers";

export async function routeAgentActiveQueues(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listAgents" | "listActiveQueues">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== AGENT_ACTIVE_QUEUES_ROUTES.list) return "unmatched";
  if (!capabilities.has(AGENT_ACTIVE_QUEUES_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.activeQueuesUnsupported"));
  const body = await readJson(request);
  const named = body.agentIds === undefined ? null : new Set(stringArray(body, "agentIds", AGENT_ACTIVE_QUEUES_LIMIT));
  const agentIds = agents
    .listAgents()
    .map((agent) => agent.id)
    .filter(
      (agentId) =>
        (named === null || named.has(agentId)) &&
        !hiddenAgentIds.has(agentId) &&
        context.agentLevel(agentId) !== "none",
    )
    .slice(0, AGENT_ACTIVE_QUEUES_LIMIT);
  return json(200, inFrame(agents.listActiveQueues(agentIds)));
}

function withoutHostAddresses(queue: QueueSnapshot): QueueSnapshot {
  return {
    agentId: queue.agentId,
    ...(queue.welcome ? { welcome: true as const } : {}),
    deliveries: queue.deliveries.map((delivery) => ({
      ...delivery,
      attachments: delivery.attachments.map((attachment) => ({ ...attachment, previewUrl: null })),
    })),
  };
}

function inFrame(queues: readonly QueueSnapshot[]): { queues: QueueSnapshot[]; omitted: string[] } {
  const omittedIds = queues.map((queue) => queue.agentId);
  let bytes = Buffer.byteLength(JSON.stringify({ queues: [], omitted: omittedIds }));
  const kept: QueueSnapshot[] = [];
  const omitted: string[] = [];
  for (const queue of queues) {
    if (queue.deliveries.length > AGENT_ACTIVE_QUEUE_DELIVERY_LIMIT) {
      omitted.push(queue.agentId);
      continue;
    }
    const wire = withoutHostAddresses(queue);
    const size = Buffer.byteLength(JSON.stringify(wire)) + 1;
    if (bytes + size <= WEBRTC_FRAME_BODY_BUDGET) {
      bytes += size;
      kept.push(wire);
    } else omitted.push(queue.agentId);
  }
  return { queues: kept, omitted };
}
