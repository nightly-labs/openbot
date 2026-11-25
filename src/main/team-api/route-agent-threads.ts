import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { agentThreadTitle } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  AGENT_ARCHIVED_THREADS_CAPABILITY,
  AGENT_ARCHIVED_THREADS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-archived-threads-v1";
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
  AGENT_THREAD_PAGES_CAPABILITY,
  AGENT_THREAD_PAGES_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-pages-v1";
import {
  AGENT_THREAD_READS_CAPABILITY,
  AGENT_THREAD_READS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import {
  AGENT_THREAD_REPLIES_CAPABILITY,
  AGENT_THREAD_REPLIES_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-replies-v1";
import { AGENT_THREADS_CAPABILITY, AGENT_THREADS_ROUTES } from "@openbot/contracts/team-protocol/agent-threads-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgentTasks } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import {
  conversationSnapshotForCapabilities,
  markerExclusionsForCapabilities,
  memberSender,
  readJson,
  requireAgentLevel,
  requireListedAgent,
  stringArray,
  stringField,
  WEBRTC_FRAME_BODY_BUDGET,
} from "./request-helpers";
import { agentTaskWire } from "./route-agent-tasks";

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
    return json(
      200,
      agentTaskWire(
        await runCauseEffect(tasks.startTask(message, memberSender(member), undefined, context.fromChrome)),
        capabilities,
      ),
    );
  return json(
    202,
    await runCauseEffect(
      tasks.sendMessage(
        { ...message, taskId: stringField(body, "taskId") },
        memberSender(member),
        undefined,
        context.fromChrome,
      ),
    ),
  );
}

export async function routeAgentThreadReplies(
  context: TeamApiRequestContext,
  tasks: TeamApiAgentTasks | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, member, json } = context;
  if (method !== "POST" || url.pathname !== AGENT_THREAD_REPLIES_ROUTES.send) return "unmatched";
  if (!tasks || !capabilities.has(AGENT_THREAD_REPLIES_CAPABILITY))
    throw new HttpError(400, sourceText("error.backend.threadRemoteUnsupported"));
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(tasks, agentId);
  requireAgentLevel(context, agentId, "chat");
  const message = {
    agentId,
    taskId: stringField(body, "taskId"),
    text: stringField(body, "text", true, INPUT_LIMITS.messageText),
    attachmentDraftIds: stringArray(body, "attachmentDraftIds"),
    replyToMessageId: stringField(body, "replyToMessageId"),
    ...(isString(body.clientMessageId) ? { clientMessageId: body.clientMessageId } : {}),
  };
  return json(
    202,
    await runCauseEffect(tasks.sendMessage(message, memberSender(member), undefined, context.fromChrome)),
  );
}

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

export async function routeAgentArchivedThreads(
  context: TeamApiRequestContext,
  tasks: TeamApiAgentTasks | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== AGENT_ARCHIVED_THREADS_ROUTES.list) return "unmatched";
  if (!tasks || !capabilities.has(AGENT_ARCHIVED_THREADS_CAPABILITY))
    throw new HttpError(400, sourceText("error.backend.threadRemoteUnsupported"));
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(tasks, agentId);
  const before = isDynamicRecord(body.before)
    ? { updatedAt: stringField(body.before, "updatedAt", false, 160), threadId: stringField(body.before, "threadId") }
    : null;
  return json(200, tasks.listArchivedTasks({ agentId, before }));
}

export async function routeAgentThreadPages(
  context: TeamApiRequestContext,
  tasks: TeamApiAgentTasks | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== AGENT_THREAD_PAGES_ROUTES.readOlder) return "unmatched";
  if (!tasks || !capabilities.has(AGENT_THREAD_PAGES_CAPABILITY))
    throw new HttpError(400, sourceText("error.backend.threadRemoteUnsupported"));
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireListedAgent(tasks, agentId);
  const input = { agentId, taskId: stringField(body, "taskId"), beforeMessageId: stringField(body, "beforeMessageId") };
  for (let limit = typeof body.limit === "number" ? body.limit : 50; ; limit = Math.floor(limit / 2)) {
    const page = tasks.readTaskPage({ ...input, limit }, markerExclusionsForCapabilities(capabilities));
    const answer = { ...page, conversation: conversationSnapshotForCapabilities(page.conversation, capabilities) };
    if (Buffer.byteLength(JSON.stringify(answer)) <= WEBRTC_FRAME_BODY_BUDGET) return json(200, answer);
    if (limit <= 1) throw new HttpError(413, sourceText("error.team.conversationPageTooLarge"));
  }
}
