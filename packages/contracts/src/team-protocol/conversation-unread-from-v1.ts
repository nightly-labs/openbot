// Frozen optional conversation-unread-from-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member who can view an
// agent can mark one message of the agent's chat and the messages after it unread, for themselves.
// The read mark moves back to the message shown before it. A read mark belongs to the member, not
// to a device, so all devices of the member share it; another member never sees it. The answer is
// the new read state: the count of agent messages after the mark, the first of them, and the mark.
// The route is a POST with its ids in the body. A hidden agent, or an agent that the peer cannot see,
// is not found (404), and so is a message that the chat does not hold. The `conversation/unread`
// route of the agent keeps its meaning: it marks the whole chat unread. Bounds and meaning do not
// follow IPC changes; widening any of it needs a second capability string.
import { adminRoute, count, fields, identifier, nullable, type OptionalRouteCodec } from "./admin-wire";

export const CONVERSATION_UNREAD_FROM_CAPABILITY = "conversation-unread-from-v1";

export const CONVERSATION_UNREAD_FROM_ROUTE = "/v1/conversations/unread-from";

export const CONVERSATION_UNREAD_FROM_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    CONVERSATION_UNREAD_FROM_ROUTE,
    adminRoute(
      fields({ agentId: identifier, fromMessageId: identifier }),
      fields({
        unreadCount: count,
        firstUnreadMessageId: nullable(identifier),
        throughMessageId: nullable(identifier),
      }),
    ),
  ],
]);
