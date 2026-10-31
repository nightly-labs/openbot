import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { agentThreadTitle } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import {
  AGENT_THREAD_BRANCHES_CAPABILITY,
  AGENT_THREAD_BRANCHES_LIMIT,
  AGENT_THREAD_BRANCHES_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-branches-v1";
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
import { Effect, Result } from "effect";
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

/**
 * `agent-thread-branches-v1`: branch a conversation of the agent into a new side thread, and the links
 * of the branches among the listed tasks. A branch needs the agent level of a task start; the list
 * needs what the `agent-tasks-v1` list needs. The member who branches has read the copy. An agent that
 * this peer cannot see (`hiddenAgentIds`) answers as a missing agent does. The frozen codec has already
 * checked the ids.
 */
export async function routeAgentThreadBranches(
  context: TeamApiRequestContext,
  tasks: TeamApiAgentTasks | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, member, json } = context;
  if (method !== "POST" || !Object.values(AGENT_THREAD_BRANCHES_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!tasks || !capabilities.has(AGENT_THREAD_BRANCHES_CAPABILITY))
    throw new HttpError(400, sourceText("error.backend.threadRemoteUnsupported"));
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(tasks, agentId);
  if (url.pathname === AGENT_THREAD_BRANCHES_ROUTES.list) {
    const branches = tasks
      .listTasks(agentId)
      .tasks.flatMap((task) => (task.branch ? [{ taskId: task.id, ...task.branch }] : []))
      .slice(0, AGENT_THREAD_BRANCHES_LIMIT);
    return json(200, { branches });
  }
  requireAgentLevel(context, agentId, "chat");
  const input = {
    agentId,
    taskId: body.taskId === null ? null : stringField(body, "taskId"),
    messageId: stringField(body, "messageId"),
    requestId: stringField(body, "requestId"),
  };
  const branched = await Effect.runPromise(Effect.result(tasks.branchTask(input, member.id)));
  if (Result.isSuccess(branched)) return json(200, branched.success);
  const failure = branched.failure;
  if (failure._tag === "AgentTaskBranchFailed") {
    switch (failure.reason) {
      case "source-not-found":
        throw new HttpError(404, sourceText("error.backend.threadNotFound"));
      case "message-not-found":
        throw new HttpError(404, sourceText("error.backend.branchMessageNotFound"));
      case "source-busy":
        throw new HttpError(409, sourceText("error.backend.branchSourceBusy"));
      case "thread-limit":
        throw new HttpError(
          409,
          sourceText("error.backend.threadOpenLimitReached", { count: INPUT_LIMITS.agentTasks }),
        );
    }
  }
  throw failure.cause;
}
