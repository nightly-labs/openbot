import {
  AGENT_THREAD_REQUESTS_CAPABILITY,
  AGENT_THREAD_REQUESTS_LIMIT,
  AGENT_THREAD_REQUESTS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-requests-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAgentTasks } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel, requireListedAgent, stringField } from "./request-helpers";

/**
 * The requests that each side thread of an agent sent to other agents and that wait for their answer,
 * from a joined server. A member who can send the agent a message can read them, as the thread on this
 * computer shows them. An agent that this peer cannot see answers as a missing agent does. Frozen by
 * `agent-thread-requests-v1`.
 */
export async function routeAgentThreadRequests(
  context: TeamApiRequestContext,
  tasks: TeamApiAgentTasks | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== AGENT_THREAD_REQUESTS_ROUTES.list) return "unmatched";
  if (!tasks || !capabilities.has(AGENT_THREAD_REQUESTS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.threadRequestsUnsupported"));
  // `readJson` has already run the body through the agent-thread-requests wire codec.
  const agentId = stringField(await readJson(request), "agentId");
  if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(tasks, agentId);
  requireAgentLevel(context, agentId, "chat");
  const threads = tasks
    .listTasks(agentId)
    .tasks.flatMap((task) =>
      task.awaitedReplies?.length
        ? [{ taskId: task.id, requests: task.awaitedReplies.slice(0, AGENT_THREAD_REQUESTS_LIMIT) }]
        : [],
    )
    .slice(0, AGENT_THREAD_REQUESTS_LIMIT);
  return json(200, { agentId, threads });
}
