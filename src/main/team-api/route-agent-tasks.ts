import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { TeamMemberSummary } from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { AGENT_TASKS_CAPABILITY, AGENT_TASKS_ROUTES } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgentTasks } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import {
  conversationSnapshotForCapabilities,
  memberSender,
  readJson,
  requireAgentLevel,
  requireListedAgent,
  stringField,
} from "./request-helpers";

/**
 * `agent-tasks-v1`: the tasks of one agent. A member who can send a message to the agent can use them,
 * so no role is checked, as for `POST /v1/agents/:id/messages`. The member is the sender of a start and
 * of a message. An agent that this peer cannot see (`hiddenAgentIds`) answers as a missing agent does.
 */
export async function routeAgentTasks(
  context: TeamApiRequestContext,
  tasks: TeamApiAgentTasks | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json, member } = context;
  if (method !== "POST" || !Object.values(AGENT_TASKS_ROUTES).some((path) => path === url.pathname)) return "unmatched";
  if (!tasks || !capabilities.has(AGENT_TASKS_CAPABILITY))
    throw new HttpError(400, sourceText("error.backend.threadRemoteUnsupported"));
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(tasks, agentId);
  if (url.pathname === AGENT_TASKS_ROUTES.list) return json(200, tasks.listTasks(agentId));
  if (url.pathname !== AGENT_TASKS_ROUTES.read) requireAgentLevel(context, agentId, "chat");
  if (url.pathname === AGENT_TASKS_ROUTES.start) return json(200, await startTask(tasks, agentId, body, member));
  const taskId = stringField(body, "taskId");
  switch (url.pathname) {
    case AGENT_TASKS_ROUTES.read:
      return json(200, conversationSnapshotForCapabilities(tasks.readTask(agentId, taskId), capabilities));
    case AGENT_TASKS_ROUTES.send:
      return json(
        202,
        await runCauseEffect(
          tasks.sendMessage(
            {
              agentId,
              taskId,
              text: stringField(body, "text", false, INPUT_LIMITS.messageText),
              ...clientMessageId(body),
            },
            memberSender(member),
          ),
        ),
      );
    case AGENT_TASKS_ROUTES.stop:
      await runCauseEffect(tasks.stopTask({ agentId, taskId }));
      return json(200, {});
    case AGENT_TASKS_ROUTES.close:
      await runCauseEffect(tasks.closeTask({ agentId, taskId }));
      return json(200, {});
    case AGENT_TASKS_ROUTES.reopen:
      tasks.reopenTask({ agentId, taskId });
      return json(200, {});
  }
  return "unmatched";
}

function startTask(tasks: TeamApiAgentTasks, agentId: string, body: DynamicRecord, member: TeamMemberSummary) {
  return runCauseEffect(
    tasks.startTask(
      { agentId, text: stringField(body, "text", false, INPUT_LIMITS.messageText), ...clientMessageId(body) },
      memberSender(member),
    ),
  );
}

/** The frozen codec has already checked that it is an identifier. */
function clientMessageId(body: DynamicRecord): { clientMessageId?: string } {
  return isString(body.clientMessageId) ? { clientMessageId: body.clientMessageId } : {};
}
