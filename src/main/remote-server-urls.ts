// URLs and query strings the Team API client builds.
//
// The `openbot-remote-*` schemes are how a remote host's attachments, agent avatars and server logo
// reach the renderer: the host's own URLs are not reachable from there, so `addRemotePreviewUrls`
// rewrites them in place on a decoded payload before it leaves the main process. `src/main/index.ts`
// registers the matching protocol handlers, and they parse exactly what these builders emit.

import type { ConversationPageAnchor, DirectConversationPageAnchor } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { isUuidV4 } from "@openbot/contracts/validation";

export function pageQuery(anchor: ConversationPageAnchor | DirectConversationPageAnchor, limit: number): string {
  const query = new URLSearchParams({ limit: String(limit) });
  if (anchor.type === "before") query.set("before", anchor.cursor);
  if (anchor.type === "around") query.set("around", anchor.messageId);
  return `?${query.toString()}`;
}

export function isLocalDevelopmentApi(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export function addRemotePreviewUrls<T>(value: T, serverId: string): T {
  if (Array.isArray(value)) {
    for (const item of value) addRemotePreviewUrls(item, serverId);
    return value;
  }
  if (!isDynamicRecord(value)) return value;
  const record = value;
  if ("previewUrl" in record && isString(record.id)) {
    Reflect.set(record, "previewUrl", remoteAttachmentPreviewUrl(serverId, record.id));
  }
  if (isString(record.avatarUrl) && record.avatarUrl.startsWith("openbot-avatar:") && isString(record.id)) {
    Reflect.set(record, "avatarUrl", remoteAgentAvatarUrl(serverId, record.id, record.avatarUrl));
  }
  // A channel of a host with channel-picture-v1. A URL that is not the host's channel form shows no image.
  if (isString(record.imageUrl) && record.imageUrl.startsWith("openbot-avatar:") && isString(record.id)) {
    Reflect.set(record, "imageUrl", remoteChannelPictureUrl(serverId, record.id, record.imageUrl));
  }
  for (const item of Object.values(record)) addRemotePreviewUrls(item, serverId);
  return value;
}

function remoteAttachmentPreviewUrl(serverId: string, attachmentId: string): string {
  return `openbot-remote-attachment://${encodeURIComponent(serverId)}/${encodeURIComponent(attachmentId)}`;
}

function remoteAgentAvatarUrl(serverId: string, agentId: string, sourceUrl: string): string {
  const source = new URL(sourceUrl);
  const target = new URL(`openbot-remote-avatar://${encodeURIComponent(serverId)}/${encodeURIComponent(agentId)}`);
  target.search = source.search;
  return target.toString();
}

/**
 * The `openbot-remote-avatar:` URL of the image of a channel, from the host's
 * `openbot-avatar://channel/<id>?v=<version>&type=<mime>` URL (`channel-picture-v1`). The protocol
 * handler reads the bytes with `GET /v1/channels/image`. Null for a URL that is not of this channel.
 */
function remoteChannelPictureUrl(serverId: string, channelId: string, sourceUrl: string): string | null {
  const version = channelPictureVersion(sourceUrl, channelId);
  if (!version) return null;
  const target = new URL(
    `openbot-remote-avatar://${encodeURIComponent(serverId)}/channel/${encodeURIComponent(channelId)}`,
  );
  target.searchParams.set("v", version);
  return target.toString();
}

function channelPictureVersion(value: string, channelId: string): string | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    const version = url.searchParams.get("v") ?? "";
    if (
      url.protocol !== "openbot-avatar:" ||
      url.hostname !== "channel" ||
      segments.length !== 1 ||
      decodeURIComponent(segments[0] ?? "") !== channelId ||
      !isUuidV4(version)
    )
      return null;
    return version;
  } catch {
    return null;
  }
}

/**
 * What an `openbot-remote-avatar:` URL names: the avatar of an agent (one path segment) or the
 * picture of a channel (`channel` and the channel id). Any other form is null, so the protocol
 * handler answers 404 and asks the host for nothing.
 */
export function parseRemoteAvatarUrl(
  value: string,
): { kind: "agent" | "channel"; serverId: string; id: string; version: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "openbot-remote-avatar:") return null;
    const serverId = decodeURIComponent(url.hostname);
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const version = url.searchParams.get("v") ?? "";
    if (!serverId || !version) return null;
    if (segments.length === 1 && segments[0]) return { kind: "agent", serverId, id: segments[0], version };
    if (segments.length === 2 && segments[0] === "channel" && segments[1])
      return { kind: "channel", serverId, id: segments[1], version };
    return null;
  } catch {
    return null;
  }
}

export function remoteServerLogoUrl(serverId: string, version: string): string {
  const target = new URL(`openbot-remote-server-logo://${encodeURIComponent(serverId)}/logo`);
  target.searchParams.set("v", version);
  return target.toString();
}
