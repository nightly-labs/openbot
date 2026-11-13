// Frozen optional agent-speed-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: the speed of an agent, as
// `agent-fast-mode-v1` grants its fast mode, with the same access. A member reads it with view
// access to the agent and changes it with manage access. `speed` is "standard", "fast" or
// "ultrafast", or null until someone sets it: the host then sends no tier, and the provider keeps its
// own. "fast" asks the provider for the model's fast service tier on each turn. "ultrafast" asks for
// its Ultrafast tier, and for the fast tier on a model without one. A change applies from the next
// turn, and a change of provider sets "standard".
//
// The `models` route lists, for a member, every model of the host that has a fast tier, with the
// tier ids that the host sends (`fastServiceTier`, and `ultrafastServiceTier` when the model has
// one). Unlike `agent-fast-mode-v1`, it lists Claude models. Claude fast mode costs more per token,
// and a Claude subscription pays for it from usage credits, so a client that advertises this
// capability asks the user to confirm the price before it sets "fast" or "ultrafast" on an agent of
// the `claude` provider. Widening any of it needs a second capability string.
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
