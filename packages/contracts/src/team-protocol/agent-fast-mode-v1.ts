// Frozen optional agent-fast-mode-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member of a server reads the
// fast mode of an agent with view access to it, and changes it with manage access, as the member
// changes its model and reasoning effort on the released agent route. Fast mode asks the provider for its fast service tier on each
// turn of a model that has one; another model runs at standard speed. `fastMode` is null until someone
// sets it: the host then sends no tier, and the provider keeps its own. A change applies from the next
// turn. The `models` route lists, for a member, the models of the host that have a fast tier, with the
// tier id that the host sends (`fastServiceTier`, such as Codex `priority`); the released model list
// does not carry it. Widening any of it needs a second capability string.
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
