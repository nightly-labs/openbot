import { adminRoute, boolean, fields, identifier, type OptionalRouteCodec } from "./admin-wire";

export const AGENT_NEW_CHAT_CAPABILITY = "agent-new-chat-v1";

export const AGENT_NEW_CHAT_ROUTES = {
  settings: "/v1/admin/agents/new-chat",
  update: "/v1/admin/agents/new-chat/update",
} as const;

const settings = fields({ allowNewChat: boolean });

export const AGENT_NEW_CHAT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_NEW_CHAT_ROUTES.settings, adminRoute(fields({ agentId: identifier }), settings)],
  [AGENT_NEW_CHAT_ROUTES.update, adminRoute(fields({ agentId: identifier, allowNewChat: boolean }), settings)],
]);
