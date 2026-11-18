// Frozen optional agent-thread-requests-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member who can send a
// message to an agent can read, for each side thread of that agent, the requests that the agent sent
// from that thread to other agents and whose answer has not come back yet: the message id, the agent
// it went to, and its state (`queued`, `starting` or `running`). A host that grants this also grants
// `agent-tasks-v1`. The host does not ask for a role, as for a message to the agent. A hidden agent,
// or an agent that the peer cannot see, is not found (404). `list` names only the threads that have
// such a request. `agent-tasks-changed` carries no requests: a client reads `list` again when the
// state of a thread changes, as it does when the thread sends a request or an answer comes back.
// Every route is a POST with its ids in the body. Widening any of it needs a second capability string.
import { type AgentTaskAwaitedReply, type AgentTasksSnapshot, isAgentTaskAwaitedReply } from "../ipc-agent-tasks";
import { isDynamicRecord } from "../runtime-values";
import { type AdminDecoder, adminRoute, fields, identifier, list, type OptionalRouteCodec, oneOf } from "./admin-wire";

export const AGENT_THREAD_REQUESTS_CAPABILITY = "agent-thread-requests-v1";
export const AGENT_THREAD_REQUESTS_ROUTES = { list: "/v1/agent-thread-requests/list" } as const;

/** The most threads, and the most requests of one thread, that one answer carries. */
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

/** The open requests of each thread, as `list` answers them. */
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

/** `snapshot` with the open requests of each task. A task that `requests` does not name has none. */
export function withAgentThreadRequests(
  snapshot: AgentTasksSnapshot,
  requests: AgentThreadRequests,
): AgentTasksSnapshot {
  const byTask = new Map(requests.threads.map((entry) => [entry.taskId, entry.requests]));
  return { ...snapshot, tasks: snapshot.tasks.map((task) => ({ ...task, awaitedReplies: byTask.get(task.id) ?? [] })) };
}
