import { adminRoute, empty, type OptionalRouteCodec } from "./admin-wire";

export const FOCUS_USE_CAPABILITY = "focus-use-v1";

export const FOCUS_USE_ROUTES = { ping: "/v1/client/focus" } as const;

export const FOCUS_USE_INTERVAL_MS = 4 * 60_000;

export const FOCUS_USE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [FOCUS_USE_ROUTES.ping, adminRoute(empty, empty)],
]);
