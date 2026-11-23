import { adminRoute, boolean, count, fields, type OptionalRouteCodec } from "./admin-wire";

export const COMPUTER_ACTIVITY_CAPABILITY = "computer-activity-v1";

export const COMPUTER_ACTIVITY_ROUTES = { report: "/v1/client/activity" } as const;

export const COMPUTER_ACTIVITY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [COMPUTER_ACTIVITY_ROUTES.report, adminRoute(fields({ idleSeconds: count }), fields({ phones: boolean }))],
]);
