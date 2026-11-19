import {
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";

export const AGENT_FAST_MODE_CAPABILITY = "agent-fast-mode-v1";

export const AGENT_FAST_MODE_ROUTES = {
  models: "/v1/agent-fast-mode/models",
  settings: "/v1/agent-fast-mode",
  update: "/v1/agent-fast-mode/update",
} as const;

const fastModel = fields({ provider: identifier, id: string(160), fastServiceTier: string(64) });
const settings = fields({ fastMode: nullable(boolean) });

export const AGENT_FAST_MODE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_FAST_MODE_ROUTES.models, adminRoute(empty, fields({ models: list(fastModel, 1_000) }))],
  [AGENT_FAST_MODE_ROUTES.settings, adminRoute(fields({ agentId: identifier }), settings)],
  [AGENT_FAST_MODE_ROUTES.update, adminRoute(fields({ agentId: identifier, fastMode: boolean }), settings)],
]);
