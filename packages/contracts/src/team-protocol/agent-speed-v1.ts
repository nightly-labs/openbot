import {
  adminRoute,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const AGENT_SPEED_CAPABILITY = "agent-speed-v1";

export const AGENT_SPEED_ROUTES = {
  models: "/v1/agent-speed/models",
  settings: "/v1/agent-speed",
  update: "/v1/agent-speed/update",
} as const;

const speed = oneOf("standard", "fast", "ultrafast");
const speedModel = fields(
  { provider: identifier, id: string(160), fastServiceTier: string(64) },
  { ultrafastServiceTier: string(64) },
);
const settings = fields({ speed: nullable(speed) });

export const AGENT_SPEED_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_SPEED_ROUTES.models, adminRoute(empty, fields({ models: list(speedModel, 1_000) }))],
  [AGENT_SPEED_ROUTES.settings, adminRoute(fields({ agentId: identifier }), settings)],
  [AGENT_SPEED_ROUTES.update, adminRoute(fields({ agentId: identifier, speed }), settings)],
]);
