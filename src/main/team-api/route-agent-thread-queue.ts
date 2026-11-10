import {
  AGENT_THREAD_QUEUE_CAPABILITY,
  AGENT_THREAD_QUEUE_LIMIT,
  AGENT_THREAD_QUEUE_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-queue-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents, TeamApiAgentTasks } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import {
  readJson,
  requireAgentLevel,
  requireListedAgent,
  stringArray,
  stringField,
  WEBRTC_FRAME_BODY_BUDGET,
} from "./request-helpers";

/**
 * The waiting messages of each side thread of an agent, and their order in one thread, from a joined
 * server. A member who can send the agent a message can use them, as the panel of a thread on this
 * computer does. An agent that this peer cannot see answers as a missing agent does. Frozen by
 * `agent-thread-queue-v1`.
 */
export async function routeAgentThreadQueue(
  context: TeamApiRequestContext,
  tasks: TeamApiAgentTasks | undefined,
  agents: Pick<TeamApiAgents, "reorderQueue">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== AGENT_THREAD_QUEUE_ROUTES.list && url.pathname !== AGENT_THREAD_QUEUE_ROUTES.reorder)
  )
    return "unmatched";
  if (!tasks || !capabilities.has(AGENT_THREAD_QUEUE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.threadQueueUnsupported"));
  // `readJson` has already run the body through the agent-thread-queue wire codec.
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(tasks, agentId);
  requireAgentLevel(context, agentId, "chat");
  if (url.pathname === AGENT_THREAD_QUEUE_ROUTES.list) {
    const threads = tasks
      .listTasks(agentId)
      .tasks.flatMap((task) => (task.queue?.length ? [{ taskId: task.id, deliveries: task.queue }] : []))
      .slice(0, AGENT_THREAD_QUEUE_LIMIT)
      .map((thread) => ({
        taskId: thread.taskId,
        // A preview URL is an address on this computer: a client reads the file through its own route.
        deliveries: thread.deliveries.slice(0, AGENT_THREAD_QUEUE_LIMIT).map((delivery) => ({
          ...delivery,
          attachments: delivery.attachments.map((attachment) => ({ ...attachment, previewUrl: null })),
        })),
      }));
    return json(200, { agentId, threads: inFrame(agentId, threads) });
  }
  try {
    await runCauseEffect(
      agents.reorderQueue({
        agentId,
        taskId: stringField(body, "taskId"),
        deliveryIds: stringArray(body, "deliveryIds", AGENT_THREAD_QUEUE_LIMIT),
      }),
    );
  } catch (error) {
    // A stale order, or an order with channel work, is a sentence for the member. Any other error is a
    // host fault.
    if (error instanceof Error && REFUSALS().includes(error.message)) throw new HttpError(409, error.message);
    throw error;
  }
  return json(200, {});
}

/** The texts with which the queue refuses an order. */
const REFUSALS = () => [
  sourceText("error.backend.queueOrderStale"),
  sourceText("error.backend.useChannelTaskControlsWork"),
];

/**
 * The threads and deliveries that fit in one WebRTC frame, in queue order, as the queue window of
 * `route-agent-queue.ts` keeps them. A long queue then shows its first messages and does not fail.
 */
function inFrame<Delivery>(
  agentId: string,
  threads: readonly { taskId: string; deliveries: Delivery[] }[],
): { taskId: string; deliveries: Delivery[] }[] {
  let bytes = Buffer.byteLength(JSON.stringify({ agentId, threads: [] }));
  const kept: { taskId: string; deliveries: Delivery[] }[] = [];
  for (const thread of threads) {
    bytes += Buffer.byteLength(JSON.stringify({ taskId: thread.taskId, deliveries: [] })) + 1;
    if (bytes > WEBRTC_FRAME_BODY_BUDGET) break;
    const deliveries: Delivery[] = [];
    for (const delivery of thread.deliveries) {
      const next = bytes + Buffer.byteLength(JSON.stringify(delivery)) + 1;
      if (next > WEBRTC_FRAME_BODY_BUDGET) break;
      bytes = next;
      deliveries.push(delivery);
    }
    kept.push({ taskId: thread.taskId, deliveries });
    if (deliveries.length < thread.deliveries.length) break;
  }
  return kept;
}
