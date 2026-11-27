import { isDynamicRecord, isString } from "./runtime-values";

export interface RemoteChatContentPreference {
  enabled: boolean;
}

export const DEFAULT_REMOTE_CHAT_CONTENT_PREFERENCE: RemoteChatContentPreference = { enabled: false };

export interface HostRemoteChatContent {
  enabled: boolean;
}

export interface RemoteChatContentChange {
  serverId: string;
  enabled: boolean;
}

export function hostRemoteChatContent({ enabled }: RemoteChatContentPreference): HostRemoteChatContent {
  return { enabled };
}

export function decodeHostRemoteChatContent(value: unknown): HostRemoteChatContent {
  if (!isDynamicRecord(value) || typeof value.enabled !== "boolean")
    throw new Error("Invalid remote chat content setting.");
  return { enabled: value.enabled };
}

export function decodeRemoteChatContentChange(value: unknown): RemoteChatContentChange {
  if (
    !isDynamicRecord(value) ||
    !isString(value.serverId) ||
    !value.serverId.length ||
    value.serverId.length > 128 ||
    typeof value.enabled !== "boolean"
  )
    throw new Error("Invalid remote chat content change.");
  return { serverId: value.serverId, enabled: value.enabled };
}
