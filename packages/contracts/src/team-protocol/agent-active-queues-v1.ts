import { isQueueDelivery, isQueueSnapshot, type QueueSnapshot } from "../ipc-queue";
import { isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  count,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
  variant,
} from "./admin-wire";

export const AGENT_ACTIVE_QUEUES_CAPABILITY = "agent-active-queues-v1";

export const AGENT_ACTIVE_QUEUES_ROUTES = {
  list: "/v1/agent-active-queues/list",
} as const;

export const AGENT_ACTIVE_QUEUES_LIMIT = 1_000;
export const AGENT_ACTIVE_QUEUE_DELIVERY_LIMIT = 200;

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
    status: oneOf("queued", "starting", "running", "failed"),
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
const welcome: AdminDecoder = (value) => {
  if (value !== true) throw new Error("Invalid agent welcome flag.");
  return value;
};
const queue = fields(
  { agentId: identifier, deliveries: list(delivery, AGENT_ACTIVE_QUEUE_DELIVERY_LIMIT) },
  { welcome },
);
const listRequest: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => key !== "agentIds"))
    throw new Error("Invalid agent queues request.");
  return fields({}, { agentIds: list(identifier, AGENT_ACTIVE_QUEUES_LIMIT) })(input);
};

export const AGENT_ACTIVE_QUEUES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    AGENT_ACTIVE_QUEUES_ROUTES.list,
    adminRoute(
      listRequest,
      fields({
        queues: list(queue, AGENT_ACTIVE_QUEUES_LIMIT),
        omitted: list(identifier, AGENT_ACTIVE_QUEUES_LIMIT),
      }),
    ),
  ],
]);

export const ACTIVE_QUEUE_STATUSES: ReadonlySet<string> = new Set(["queued", "starting", "running", "failed"]);

export interface AgentActiveQueues {
  queues: QueueSnapshot[];
  omitted: string[];
}

export function isAgentActiveQueues(value: unknown): value is AgentActiveQueues {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.queues) &&
    value.queues.every(
      (entry) =>
        isQueueSnapshot(entry) &&
        entry.deliveries.every((item) => isQueueDelivery(item) && ACTIVE_QUEUE_STATUSES.has(item.status)),
    ) &&
    Array.isArray(value.omitted) &&
    value.omitted.every(isString)
  );
}

export function decodeAgentActiveQueues(value: unknown): AgentActiveQueues {
  if (!isAgentActiveQueues(value)) throw new Error("Invalid agent queues.");
  return value;
}
