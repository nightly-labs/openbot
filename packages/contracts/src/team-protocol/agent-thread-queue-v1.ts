// Frozen optional agent-thread-queue-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member who can send a
// message to an agent can read, in full, the messages that wait in the queue of each open side thread
// of that agent, and can change their order in one thread. This is the queue of a side thread, as the
// user of the host's computer sees it. The released `agent-tasks-v1` list sends only the start of each
// waiting message. Cancel, steer and edit of a waiting message use the released queue routes of the
// agent, by delivery id. The host does not ask for a role, as for a message to the agent. A hidden
// agent, or an agent that the peer cannot see, is not found (404). The list names only the threads
// that have a waiting message. The host sends no preview URL of a file: it is an address on the host.
// A change of the queue sends the released `agent-tasks-changed` event. Every route is a POST with
// its ids in the body. Widening any of it needs a second capability string.
import type { AgentTasksSnapshot } from "../ipc-agent-tasks";
import { isQueueDelivery, type QueueDelivery } from "../ipc-queue";
import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
  variant,
} from "./admin-wire";

export const AGENT_THREAD_QUEUE_CAPABILITY = "agent-thread-queue-v1";

export const AGENT_THREAD_QUEUE_ROUTES = {
  list: "/v1/agent-thread-queue/list",
  reorder: "/v1/agent-thread-queue/reorder",
} as const;

/** The most threads, and the most waiting messages of one thread, that one answer carries. */
export const AGENT_THREAD_QUEUE_LIMIT = 100;

const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid agent thread queue request.");
    return decode(input);
  };

const time = string(160);
const attachment = fields({
  id: identifier,
  name: string(255),
  size: count,
  kind: oneOf("image", "file"),
  mimeType: string(255),
  previewKind: oneOf("image", "pdf", "text", "none"),
  previewUrl: nullable(string(2_048)),
});
const sender = variant({
  user: fields({ kind: oneOf("user") }),
  agent: fields({ kind: oneOf("agent"), agentId: identifier }),
  routine: fields({
    kind: oneOf("routine"),
    routineId: identifier,
    runId: identifier,
    routineName: string(80),
    scheduledFor: time,
  }),
});
const delivery = fields(
  {
    id: identifier,
    messageId: identifier,
    recipientAgentId: identifier,
    sender,
    text: string(100_000),
    attachments: list(attachment, 10),
    replyToMessageId: nullable(identifier),
    status: oneOf("queued", "starting", "running", "completed", "failed", "interrupted", "cancelled"),
    position: nullable(count),
    turnId: nullable(identifier),
    error: nullable(string(100_000)),
    createdAt: time,
  },
  {
    editing: boolean,
    expectsReply: boolean,
    steerFallback: oneOf("provider-unsupported", "steer-failed"),
  },
);
const thread = fields({ taskId: identifier, deliveries: list(delivery, AGENT_THREAD_QUEUE_LIMIT) });

export const AGENT_THREAD_QUEUE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    AGENT_THREAD_QUEUE_ROUTES.list,
    adminRoute(
      exact(["agentId"], fields({ agentId: identifier })),
      fields({ agentId: identifier, threads: list(thread, AGENT_THREAD_QUEUE_LIMIT) }),
    ),
  ],
  [
    AGENT_THREAD_QUEUE_ROUTES.reorder,
    adminRoute(
      exact(
        ["agentId", "taskId", "deliveryIds"],
        fields({ agentId: identifier, taskId: identifier, deliveryIds: list(identifier, 100) }),
      ),
      empty,
    ),
  ],
]);

/** The waiting messages of each thread, as `list` answers them. */
export interface AgentThreadQueues {
  agentId: string;
  threads: Array<{ taskId: string; deliveries: QueueDelivery[] }>;
}

export function isAgentThreadQueues(value: unknown): value is AgentThreadQueues {
  return (
    isDynamicRecord(value) &&
    typeof value.agentId === "string" &&
    Array.isArray(value.threads) &&
    value.threads.every(
      (entry) =>
        isDynamicRecord(entry) &&
        typeof entry.taskId === "string" &&
        Array.isArray(entry.deliveries) &&
        entry.deliveries.every(isQueueDelivery),
    )
  );
}

/**
 * `snapshot` with the full queue of each task. A task that `queues` does not name has no waiting
 * message. With a queue, each task shows its waiting messages as on the host's computer.
 */
export function withAgentThreadQueues(snapshot: AgentTasksSnapshot, queues: AgentThreadQueues): AgentTasksSnapshot {
  const byTask = new Map(queues.threads.map((entry) => [entry.taskId, entry.deliveries]));
  return { ...snapshot, tasks: snapshot.tasks.map((task) => ({ ...task, queue: byTask.get(task.id) ?? [] })) };
}
