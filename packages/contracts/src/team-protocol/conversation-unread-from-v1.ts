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
