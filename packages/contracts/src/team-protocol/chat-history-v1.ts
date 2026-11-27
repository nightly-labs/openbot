import { adminRoute, empty, fields, identifier, type OptionalRouteCodec } from "./admin-wire";

export const CHAT_HISTORY_CAPABILITY = "chat-history-v1";

export const CHAT_HISTORY_ROUTES = {
  agentDelete: "/v1/agent-history/delete",
  channelClear: "/v1/channels/context/clear",
  channelCompact: "/v1/channels/context/compact",
  channelDelete: "/v1/channels/history/delete",
} as const;

export const CHAT_HISTORY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CHAT_HISTORY_ROUTES.agentDelete, adminRoute(fields({ agentId: identifier }), empty)],
  [CHAT_HISTORY_ROUTES.channelClear, adminRoute(fields({ channelId: identifier }), empty)],
  [CHAT_HISTORY_ROUTES.channelCompact, adminRoute(fields({ channelId: identifier }), empty)],
  [CHAT_HISTORY_ROUTES.channelDelete, adminRoute(fields({ channelId: identifier }), empty)],
]);
