import {
  AGENT_THREAD_REWRITE_CAPABILITY,
  AGENT_THREAD_REWRITE_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-rewrite-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgentTasks } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { memberSender, readJson, requireAgentLevel, requireListedAgent, stringField } from "./request-helpers";

export interface AgentThreadRewriteRouteDependencies {
  tasks: Pick<TeamApiAgentTasks, "listAgents" | "rewriteMessage"> | undefined;
  hiddenAgentIds: ReadonlySet<string>;
}

/** Rewrites one finished user message in an agent main thread or side thread. */
export async function routeAgentThreadRewrite(
  context: TeamApiRequestContext,
  { tasks, hiddenAgentIds }: AgentThreadRewriteRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, member, json } = context;
  if (method !== "POST" || url.pathname !== AGENT_THREAD_REWRITE_ROUTES.rewrite) return "unmatched";
  if (!tasks || !capabilities.has(AGENT_THREAD_REWRITE_CAPABILITY))
    throw new HttpError(400, sourceText("error.backend.threadRemoteUnsupported"));
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(tasks, agentId);
  requireAgentLevel(context, agentId, "chat");
  const taskId = body.taskId === null ? null : stringField(body, "taskId");
  const receipt = await runCauseEffect(
    tasks.rewriteMessage(
      {
        agentId,
        taskId,
        messageId: stringField(body, "messageId"),
        text: stringField(body, "text"),
        requestId: stringField(body, "requestId"),
      },
      memberSender(member),
    ),
  );
  return json(202, receipt);
}
