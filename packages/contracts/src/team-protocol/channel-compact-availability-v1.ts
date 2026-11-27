import { isDynamicRecord } from "../runtime-values";
import { adminRoute, boolean, fields, identifier, type OptionalRouteCodec } from "./admin-wire";

export const CHANNEL_COMPACT_AVAILABILITY_CAPABILITY = "channel-compact-availability-v1";

export const CHANNEL_COMPACT_AVAILABILITY_ROUTE = "/v1/channels/context/compact-availability";

export interface ChannelCompactAvailability {
  available: boolean;
}

export const CHANNEL_COMPACT_AVAILABILITY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CHANNEL_COMPACT_AVAILABILITY_ROUTE, adminRoute(fields({ channelId: identifier }), fields({ available: boolean }))],
]);

export function decodeChannelCompactAvailability(value: unknown): ChannelCompactAvailability {
  if (!isDynamicRecord(value) || typeof value.available !== "boolean")
    throw new Error("Invalid channel compact availability.");
  return { available: value.available };
}
