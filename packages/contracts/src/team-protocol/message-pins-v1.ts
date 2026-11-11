// Frozen optional message-pins-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member who can send a
// message to an agent of the host can list the pinned messages of all chats of that agent (its own
// chat and its side threads, archived ones too), and can pin or unpin one shown message of one chat
// (`taskId`, else null for the agent's own chat), as the user of this computer can from the menu of a
// message. The agent of the chat can also pin and unpin with its `pin_message` tool; the routes do
// not change that. The list carries at most 200 pins, the newest pin first, each with the id of the
// message, its side thread and its title (120 characters) or null for both, the time of the pin,
// who pinned it (a person with id and name, or null for the user of the host computer, or the agent
// with its id), who wrote the message, the person who sent it (id and name) or null, the other agent
// that sent it or null, the time of the message, and the start of its text (the host cuts it to
// 1,000 characters). Both routes answer with the list after the request. The host refuses an agent
// that the client cannot see, a message that the chat does not show, and a pin over the limit of 50
// in one chat. The host sends `message-pins-changed` with the agent id when a pin of the agent
// changes, so a client reads the list again. To open a pin of a side thread at its message, the same
// member can also read the part of a side thread around one message (`read-thread`): `limit` (1 to
// 100) is a target as in `agent-thread-pages-v1`, about half of it before the message. The answer has
// the messages oldest first, in the frozen `agent-tasks-v1` conversation shape, with `hasOlder` and
// `hasNewer`, which say if the thread has more before and after them. The host can send fewer so that
// the answer fits one WebRTC frame. A message that the thread does not hold gives no messages and
// false for both. Widening any of it needs a second capability string.
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
/** The frozen `agent-tasks-v1` conversation of a task read. */
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

/** The list a host answers, as the client type. The transport has already run it through the codec above. */
export function decodeMessagePinsResponse(value: unknown): PinnedMessagesSnapshot {
  if (!isPinnedMessagesSnapshot(value)) throw new Error("Invalid pinned messages.");
  return value;
}

/** A pin of the agent changed: read the list again. */
export type MessagePinsEvent = { type: "message-pins-changed"; agentId: string };

export function messagePinsEvent(input: unknown): MessagePinsEvent | null {
  if (!isDynamicRecord(input) || input.type !== "message-pins-changed") return null;
  const agentId = identifier(input.agentId);
  if (typeof agentId !== "string") throw new Error("Invalid message pins event.");
  return { type: "message-pins-changed", agentId };
}
