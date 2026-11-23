import { type AgentTasksSnapshot, isAgentTasksSnapshot } from "../ipc-agent-tasks";
import { type ConversationSnapshot, isConversationSnapshot } from "../ipc-conversations";
import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";
import { withExchangeExpectsReply } from "./conversation-exchange-v7";
import { withConversationPlans } from "./conversation-plan-v4";
import { withConversationSenders } from "./conversation-sender-v5";
import { toCurrentAgentKeys, toWireAgentKeys } from "./current-agent-keys";
import { isProviderAwareConversationSnapshot, projectProviderAwareConversation } from "./provider-aware-codec";
import type { TeamProtocolV2Json } from "./webrtc-framing";

export const AGENT_TASKS_CAPABILITY = "agent-tasks-v1";
export const AGENT_TASKS_ROUTES = {
  list: "/v1/agent-tasks/list",
  read: "/v1/agent-tasks/read",
  start: "/v1/agent-tasks/start",
  send: "/v1/agent-tasks/send",
  stop: "/v1/agent-tasks/stop",
  close: "/v1/agent-tasks/close",
  reopen: "/v1/agent-tasks/reopen",
} as const;

const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid agent task request.");
    return decode(input);
  };
const time = string(160);
const taskLimit: AdminDecoder = (input) => {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 1 || input > 4)
    throw new Error("Invalid agent task limit.");
  return input;
};
const queuePosition: AdminDecoder = (input) => {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 1)
    throw new Error("Invalid agent task queue position.");
  return input;
};
const queuedMessage = fields({ deliveryId: identifier, text: string(500), createdAt: time });
const queuedMessages: AdminDecoder = (input) => {
  if (!Array.isArray(input)) throw new Error("Invalid agent task queue.");
  return input.slice(0, 1_000).map(queuedMessage);
};
const task = fields({
  id: identifier,
  agentId: identifier,
  threadId: identifier,
  origin: oneOf("user", "agent"),
  title: string(120),
  state: oneOf("running", "queued", "idle", "closed"),
  outcome: nullable(oneOf("completed", "failed", "interrupted")),
  hold: nullable(
    oneOf("task-limit", "agent-restarting", "usage-limit", "server-busy", "agent-busy", "one-turn", "sign-in"),
  ),
  activeTurnId: nullable(identifier),
  progress: nullable(string(500)),
  error: nullable(string(2_000)),
  queuedMessages,
  createdAt: time,
  updatedAt: time,
  closedAt: nullable(time),
});
const snapshot = fields({ agentId: identifier, tasks: list(task, 50), limit: taskLimit });
const conversation: AdminDecoder = (input) => {
  if (!isDynamicRecord(input)) throw new Error("Invalid agent task conversation.");
  const copy: TeamProtocolV2Json = JSON.parse(JSON.stringify(input));
  const wire = toWireAgentKeys(copy);
  if (!isProviderAwareConversationSnapshot(wire)) throw new Error("Invalid agent task conversation.");
  const projected = projectProviderAwareConversation(wire, false, false);
  return toCurrentAgentKeys(
    withConversationSenders(withConversationPlans(withExchangeExpectsReply(projected, wire), wire), wire),
  );
};
const receipt = fields({
  messageId: identifier,
  deliveries: list(
    fields({
      id: identifier,
      recipientAgentId: identifier,
      status: oneOf("queued", "starting", "running", "completed", "failed", "interrupted", "cancelled"),
      position: nullable(queuePosition),
    }),
    100,
  ),
});
const text = string(100_000);
const agent = exact(["agentId"], fields({ agentId: identifier }));
const agentTask = exact(["agentId", "taskId"], fields({ agentId: identifier, taskId: identifier }));
const start = exact(
  ["agentId", "text", "clientMessageId"],
  fields({ agentId: identifier, text }, { clientMessageId: identifier }),
);
const send = exact(
  ["agentId", "taskId", "text", "clientMessageId"],
  fields({ agentId: identifier, taskId: identifier, text }, { clientMessageId: identifier }),
);

export const AGENT_TASKS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_TASKS_ROUTES.list, adminRoute(agent, snapshot)],
  [AGENT_TASKS_ROUTES.read, adminRoute(agentTask, conversation)],
  [AGENT_TASKS_ROUTES.start, adminRoute(start, task)],
  [AGENT_TASKS_ROUTES.send, adminRoute(send, receipt)],
  [AGENT_TASKS_ROUTES.stop, adminRoute(agentTask, empty)],
  [AGENT_TASKS_ROUTES.close, adminRoute(agentTask, empty)],
  [AGENT_TASKS_ROUTES.reopen, adminRoute(agentTask, empty)],
]);

export type AgentTasksEvent =
  | { type: "agent-tasks-changed"; snapshot: AgentTasksSnapshot }
  | { type: "agent-task-conversation"; taskId: string; snapshot: ConversationSnapshot }
  | {
      type: "agent-task-conversation-delta";
      taskId: string;
      agentId: string;
      threadId: string;
      turnId: string;
      messageId: string;
      delta: string;
      createdAt: string;
      revision: number;
    };

const delta = fields({
  taskId: identifier,
  agentId: identifier,
  threadId: identifier,
  turnId: identifier,
  messageId: identifier,
  delta: text,
  createdAt: time,
  revision: (input) => {
    if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0)
      throw new Error("Invalid agent task revision.");
    return input;
  },
});

export function agentTasksEvent(input: unknown): AgentTasksEvent | null {
  if (!isDynamicRecord(input)) return null;
  switch (input.type) {
    case "agent-tasks-changed": {
      const decoded = snapshot(input.snapshot);
      if (!isAgentTasksSnapshot(decoded)) throw new Error("Invalid agent tasks event.");
      return { type: "agent-tasks-changed", snapshot: decoded };
    }
    case "agent-task-conversation": {
      const taskId = identifier(input.taskId);
      const decoded = conversation(input.snapshot);
      if (typeof taskId !== "string" || !isConversationSnapshot(decoded))
        throw new Error("Invalid agent task conversation event.");
      return { type: "agent-task-conversation", taskId, snapshot: decoded };
    }
    case "agent-task-conversation-delta": {
      const decoded = delta(input);
      if (
        !isDynamicRecord(decoded) ||
        typeof decoded.taskId !== "string" ||
        typeof decoded.agentId !== "string" ||
        typeof decoded.threadId !== "string" ||
        typeof decoded.turnId !== "string" ||
        typeof decoded.messageId !== "string" ||
        typeof decoded.delta !== "string" ||
        typeof decoded.createdAt !== "string" ||
        typeof decoded.revision !== "number"
      )
        throw new Error("Invalid agent task delta event.");
      return {
        type: "agent-task-conversation-delta",
        taskId: decoded.taskId,
        agentId: decoded.agentId,
        threadId: decoded.threadId,
        turnId: decoded.turnId,
        messageId: decoded.messageId,
        delta: decoded.delta,
        createdAt: decoded.createdAt,
        revision: decoded.revision,
      };
    }
    default:
      return null;
  }
}
