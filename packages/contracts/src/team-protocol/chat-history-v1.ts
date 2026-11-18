// Frozen optional chat-history-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent:
// - `agentDelete`: a member with manage access to an agent of the host can delete the history of the
//   agent's own chat, as "Delete history" on the host does. The messages, their files and the provider
//   sessions of that chat go; side threads, profile, memories and workspace stay.
// - `channelClear`: a member who sees a channel can start a new conversation in it, as "New
//   conversation" on the host does. The host writes a marker, and the members forget the earlier
//   messages; the messages stay.
// - `channelCompact`: a member who sees a channel can ask the host to compact the channel session of
//   each member now. The messages stay.
// - `channelDelete`: an owner or admin of the server can delete the history of a channel, as "Delete
//   history" on the host does. The messages and their files go, and the members forget them.
// Only the agent id or the channel id crosses the wire, and the response is empty. The host refuses
// while work of the chat or the channel runs or waits. Widening any of it needs a second capability
// string.
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
