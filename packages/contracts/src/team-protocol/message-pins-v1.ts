import type { PinnedMessagesSnapshot } from "../ipc-message-pins";
import { isPinnedMessagesSnapshot } from "../ipc-message-pins";
import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
  variant,
} from "./admin-wire";
import { AGENT_TASKS_CODECS, AGENT_TASKS_ROUTES } from "./agent-tasks-v1";
import { AGENT_THREAD_PAGE_LIMIT } from "./agent-thread-pages-v1";

export const MESSAGE_PINS_CAPABILITY = "message-pins-v1";

export const MESSAGE_PINS_ROUTES = {
  list: "/v1/message-pins/list",
  set: "/v1/message-pins/set",
  readThread: "/v1/message-pins/read-thread",
} as const;

const sender = fields({ id: identifier, name: string(120) });

const pin = fields({
  messageId: identifier,
  taskId: nullable(identifier),
  threadTitle: nullable(string(120)),
  pinnedAt: string(160),
  pinnedBy: variant({
    person: fields({ kind: oneOf("person"), sender: nullable(sender) }),
    agent: fields({ kind: oneOf("agent"), agentId: identifier }),
  }),
  author: oneOf("user", "agent"),
  sender: nullable(sender),
  senderAgentId: nullable(identifier),
  createdAt: string(160),
  text: string(1_000),
});

const snapshot = fields({ agentId: identifier, pins: list(pin, 200) });

const limit: AdminDecoder = (input) => {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 1 || input > AGENT_THREAD_PAGE_LIMIT)
    throw new Error("Invalid thread part limit.");
  return input;
};
const read = AGENT_TASKS_CODECS.get(AGENT_TASKS_ROUTES.read)?.response;
if (!read) throw new Error(`No agent-tasks-v1 codec for ${AGENT_TASKS_ROUTES.read}.`);
const conversation: AdminDecoder = (input) => read(200, input);

export const MESSAGE_PINS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [MESSAGE_PINS_ROUTES.list, adminRoute(fields({ agentId: identifier }), snapshot)],
  [
    MESSAGE_PINS_ROUTES.set,
    adminRoute(
      fields({ agentId: identifier, taskId: nullable(identifier), messageId: identifier, pinned: boolean }),
      snapshot,
    ),
  ],
  [
    MESSAGE_PINS_ROUTES.readThread,
    adminRoute(
      fields({ agentId: identifier, taskId: identifier, messageId: identifier, limit }),
      fields({ conversation, hasOlder: boolean, hasNewer: boolean }),
    ),
  ],
]);

export function decodeMessagePinsResponse(value: unknown): PinnedMessagesSnapshot {
  if (!isPinnedMessagesSnapshot(value)) throw new Error("Invalid pinned messages.");
  return value;
}

export type MessagePinsEvent = { type: "message-pins-changed"; agentId: string };

export function messagePinsEvent(input: unknown): MessagePinsEvent | null {
  if (!isDynamicRecord(input) || input.type !== "message-pins-changed") return null;
  const agentId = identifier(input.agentId);
  if (typeof agentId !== "string") throw new Error("Invalid message pins event.");
  return { type: "message-pins-changed", agentId };
}
