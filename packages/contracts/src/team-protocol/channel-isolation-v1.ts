import { isDynamicRecord } from "../runtime-values";
import { CHANNEL_ROUTES } from "./channels-v1";
import type { TeamProtocolV2Json } from "./webrtc-framing";

export const CHANNEL_ISOLATION_CAPABILITY = "channel-isolation-v1";

function isolation(value: unknown): { [key: string]: TeamProtocolV2Json } {
  if (!isDynamicRecord(value) || value.isolated === undefined) return {};
  if (typeof value.isolated !== "boolean") throw new Error("Invalid channel isolation.");
  return { isolated: value.isolated };
}

function withIsolation(projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  if (!isDynamicRecord(projected)) return projected;
  return { ...projected, ...isolation(source) };
}

export function withChannelDraftIsolation(
  path: string,
  projected: TeamProtocolV2Json,
  source: unknown,
): TeamProtocolV2Json {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (pathname !== CHANNEL_ROUTES.command || !isDynamicRecord(projected) || projected.type !== "save") return projected;
  if (!isDynamicRecord(source) || projected.draft === undefined) return projected;
  return { ...projected, draft: withIsolation(projected.draft, source.draft) };
}

export function withChannelIsolation(path: string, projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (pathname === CHANNEL_ROUTES.command) return withIsolation(projected, source);
  if (pathname === CHANNEL_ROUTES.read) {
    if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
    return { ...projected, channel: withIsolation(projected.channel ?? null, source.channel) };
  }
  if (pathname !== CHANNEL_ROUTES.list || !Array.isArray(projected) || !Array.isArray(source)) return projected;
  return projected.map((summary, index) => withIsolation(summary, source[index]));
}
