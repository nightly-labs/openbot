import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { agentThreadTitle } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import {
  AGENT_THREAD_FILES_CAPABILITY,
  AGENT_THREAD_FILES_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-files-v1";
import {
  AGENT_THREAD_READS_CAPABILITY,
  AGENT_THREAD_READS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import { AGENT_THREADS_CAPABILITY, AGENT_THREADS_ROUTES } from "@openbot/contracts/team-protocol/agent-threads-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgentTasks } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import {
  markerExclusionsForCapabilities,
  memberSender,
  readJson,
  requireAgentLevel,
  requireListedAgent,
  stringArray,
  stringField,
} from "./request-helpers";

/**
 * `agent-threads-v1`: rename and delete a side thread, by its `agent-tasks-v1` task id. The same member
 * who can send to the agent can use them, with the agent level of a task change. An agent that this
 * peer cannot see (`hiddenAgentIds`) answers as a missing agent does.
 */
export async function routeAgentThreads(
  context: TeamApiRequestContext,
  tasks: TeamApiAgentTasks | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || !Object.values(AGENT_THREADS_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!tasks || !capabilities.has(AGENT_THREADS_CAPABILITY))
    throw new HttpError(400, sourceText("error.backend.threadRemoteUnsupported"));
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(tasks, agentId);
  requireAgentLevel(context, agentId, "chat");
  const taskId = stringField(body, "taskId");
  if (url.pathname === AGENT_THREADS_ROUTES.rename) {
    const title = agentThreadTitle(body.title);
    if (title === null) throw new HttpError(400, sourceText("error.backend.threadTitleRequired"));
    tasks.renameTask({ agentId, taskId }, title);
  } else {
    await runCauseEffect(tasks.deleteTask({ agentId, taskId }));
  }
  return json(200, {});
}

/**
 * `agent-thread-reads-v1`: the member's own read mark of each open side thread, and a move of one.
 * The same member who can send to the agent can use them. An agent that this peer cannot see
 * (`hiddenAgentIds`) answers as a missing agent does.
 */
export async function routeAgentThreadReads(
  context: TeamApiRequestContext,
  tasks: TeamApiAgentTasks | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, member, json } = context;
  if (method !== "POST" || !Object.values(AGENT_THREAD_READS_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!tasks || !capabilities.has(AGENT_THREAD_READS_CAPABILITY))
    throw new HttpError(400, sourceText("error.backend.threadRemoteUnsupported"));
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(tasks, agentId);
  requireAgentLevel(context, agentId, "chat");
  const exclusions = markerExclusionsForCapabilities(capabilities);
  if (url.pathname === AGENT_THREAD_READS_ROUTES.list)
    return json(200, { reads: tasks.listTaskReads(agentId, member.id, exclusions) });
  const input = {
    agentId,
    taskId: stringField(body, "taskId"),
    throughMessageId: stringField(body, "throughMessageId"),
  };
  return json(200, tasks.markTaskRead(input, member.id, exclusions));
}

/**
 * `agent-thread-files-v1`: start a side thread, or send to one, with attachment drafts that the member
 * uploaded. The same member who can send to the agent can use them, with the agent level of a task
 * start, and is the sender. An agent that this peer cannot see (`hiddenAgentIds`) answers as a missing
 * agent does. The frozen codec has already checked the ids, the bounds, and that text or a file is there.
 */
export async function routeAgentThreadFiles(
  context: TeamApiRequestContext,
  tasks: TeamApiAgentTasks | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, member, json } = context;
  if (method !== "POST" || !Object.values(AGENT_THREAD_FILES_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!tasks || !capabilities.has(AGENT_THREAD_FILES_CAPABILITY))
    throw new HttpError(400, sourceText("error.backend.threadRemoteUnsupported"));
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(tasks, agentId);
  requireAgentLevel(context, agentId, "chat");
  const message = {
    agentId,
    text: stringField(body, "text", true, INPUT_LIMITS.messageText),
    attachmentDraftIds: stringArray(body, "attachmentDraftIds"),
    ...(isString(body.clientMessageId) ? { clientMessageId: body.clientMessageId } : {}),
  };
  if (url.pathname === AGENT_THREAD_FILES_ROUTES.start)
    return json(200, await runCauseEffect(tasks.startTask(message, memberSender(member))));
  return json(
    202,
    await runCauseEffect(tasks.sendMessage({ ...message, taskId: stringField(body, "taskId") }, memberSender(member))),
  );
}
