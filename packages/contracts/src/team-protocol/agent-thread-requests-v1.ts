import { type AgentTaskAwaitedReply, type AgentTasksSnapshot, isAgentTaskAwaitedReply } from "../ipc-agent-tasks";
import { isDynamicRecord } from "../runtime-values";
import { type AdminDecoder, adminRoute, fields, identifier, list, type OptionalRouteCodec, oneOf } from "./admin-wire";

export const AGENT_THREAD_REQUESTS_CAPABILITY = "agent-thread-requests-v1";
export const AGENT_THREAD_REQUESTS_ROUTES = { list: "/v1/agent-thread-requests/list" } as const;

export const AGENT_THREAD_REQUESTS_LIMIT = 50;

const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid agent thread request list.");
    return decode(input);
  };
const request = fields({
  messageId: identifier,
  recipientAgentId: identifier,
  status: oneOf("queued", "starting", "running"),
});
const thread = fields({ taskId: identifier, requests: list(request, AGENT_THREAD_REQUESTS_LIMIT) });

export const AGENT_THREAD_REQUESTS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    AGENT_THREAD_REQUESTS_ROUTES.list,
    adminRoute(
      exact(["agentId"], fields({ agentId: identifier })),
      fields({ agentId: identifier, threads: list(thread, AGENT_THREAD_REQUESTS_LIMIT) }),
    ),
  ],
]);

export interface AgentThreadRequests {
  agentId: string;
  threads: Array<{ taskId: string; requests: AgentTaskAwaitedReply[] }>;
}

export function isAgentThreadRequests(value: unknown): value is AgentThreadRequests {
  return (
    isDynamicRecord(value) &&
    typeof value.agentId === "string" &&
    Array.isArray(value.threads) &&
    value.threads.every(
      (entry) =>
        isDynamicRecord(entry) &&
        typeof entry.taskId === "string" &&
        Array.isArray(entry.requests) &&
        entry.requests.every(isAgentTaskAwaitedReply),
    )
  );
}

export function withAgentThreadRequests(
  snapshot: AgentTasksSnapshot,
  requests: AgentThreadRequests,
): AgentTasksSnapshot {
  const byTask = new Map(requests.threads.map((entry) => [entry.taskId, entry.requests]));
  return { ...snapshot, tasks: snapshot.tasks.map((task) => ({ ...task, awaitedReplies: byTask.get(task.id) ?? [] })) };
}
