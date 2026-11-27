import { isDynamicRecord, isString } from "../runtime-values";
import { adminRoute, empty, fields, type OptionalRouteCodec, string } from "./admin-wire";

export const WATCH_RELAY_ROUTES = {
  setup: "/v1/watch/setup",
} as const;

export interface WatchRelaySetup {
  hostId: string;
  watchKey: string;
}

export function decodeWatchRelaySetup(value: unknown): WatchRelaySetup {
  if (!isDynamicRecord(value) || !isString(value.hostId) || !isString(value.watchKey)) {
    throw new Error("The watch setup response is invalid.");
  }
  return { hostId: value.hostId, watchKey: value.watchKey };
}

export const WATCH_RELAY_TEAM_CAPABILITY = "watch-relay-v1";

export const WATCH_RELAY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WATCH_RELAY_ROUTES.setup, adminRoute(empty, fields({ hostId: string(128), watchKey: string(128) }))],
]);
