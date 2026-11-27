import { isDynamicRecord, isString } from "../runtime-values";
import { adminRoute, boolean, empty, fields, type OptionalRouteCodec } from "./admin-wire";

export const REMOTE_CHAT_CONTENT_CAPABILITY = "remote-chat-content-v1";

export const REMOTE_CHAT_CONTENT_ROUTES = {
  settings: "/v1/host/remote-chat-content",
  update: "/v1/admin/host/remote-chat-content/update",
} as const;

const snapshot = fields({ enabled: boolean });

export const REMOTE_CHAT_CONTENT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [REMOTE_CHAT_CONTENT_ROUTES.settings, adminRoute(empty, snapshot)],
  [REMOTE_CHAT_CONTENT_ROUTES.update, adminRoute(fields({ enabled: boolean }), snapshot)],
]);

export const REMOTE_CHAT_CONTENT_EVENT = "remote-chat-content";

export interface RemoteChatContentEvent {
  type: typeof REMOTE_CHAT_CONTENT_EVENT;
  serverId: string;
  enabled: boolean;
}

export function remoteChatContentEvent(value: unknown): RemoteChatContentEvent | null {
  if (!isDynamicRecord(value) || value.type !== REMOTE_CHAT_CONTENT_EVENT) return null;
  const { serverId, enabled } = value;
  if (!isString(serverId) || !serverId.length || serverId.length > 128 || typeof enabled !== "boolean")
    throw new Error("Invalid remote chat content event.");
  return { type: REMOTE_CHAT_CONTENT_EVENT, serverId, enabled };
}
