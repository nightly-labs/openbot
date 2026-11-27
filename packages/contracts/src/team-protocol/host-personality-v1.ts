import { adminRoute, empty, fields, type OptionalRouteCodec, oneOf } from "./admin-wire";

export const HOST_PERSONALITY_CAPABILITY = "host-personality-v1";

export const HOST_PERSONALITY_ROUTES = {
  settings: "/v1/host/personality",
  update: "/v1/admin/host/personality/update",
} as const;

const responseStyle = oneOf("natural", "classic");
const snapshot = fields({ responseStyle });

export const HOST_PERSONALITY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_PERSONALITY_ROUTES.settings, adminRoute(empty, snapshot)],
  [HOST_PERSONALITY_ROUTES.update, adminRoute(snapshot, snapshot)],
]);
