import {
  AGENT_QUEUE_TASK_CAPABILITY,
  AGENT_QUEUE_TASK_ROUTES,
} from "@openbot/contracts/team-protocol/agent-queue-task-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgentTasks } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel, requireListedAgent, stringField } from "./request-helpers";

/**
 * "Run as a new thread" on a message that waits in the queue of an agent's own chat, from a joined
 * server. A member who can send the agent a message can use it, as for a task start and for a cancel of
 * a queued message. An agent that this peer cannot see answers as a missing agent does. Frozen by
 * `agent-queue-task-v1`.
 */
export async function routeAgentQueueTask(
  context: TeamApiRequestContext,
  tasks: TeamApiAgentTasks | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== AGENT_QUEUE_TASK_ROUTES.run) return "unmatched";
  if (!tasks || !capabilities.has(AGENT_QUEUE_TASK_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.queuedMessageThreadUnsupported"));
  // `readJson` has already run the body through the agent-queue-task wire codec.
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(tasks, agentId);
  requireAgentLevel(context, agentId, "chat");
  const deliveryId = stringField(body, "deliveryId");
  try {
    return json(200, await runCauseEffect(tasks.runQueuedMessageAsTask({ agentId, deliveryId })));
  } catch (error) {
    // A message that left the queue, or one of a channel, is a sentence for the member. Any other error
    // is a host fault.
    if (error instanceof Error && REFUSALS().includes(error.message)) throw new HttpError(409, error.message);
    throw error;
  }
}

/** The texts with which the agent service refuses the move. */
const REFUSALS = () => [
  sourceText("error.backend.useChannelTaskControls"),
  sourceText("error.backend.queuedMessageUnavailable"),
];
