// Frozen optional provider-use-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read which built-in providers of the host are off, and turn one of them off or on, as
// the switch in Settings > Providers does on this computer. A provider that is off does not start, and
// its agents cannot use it. The list names at most 64 providers by their ids. A change names one
// built-in provider id and the new state. The host refuses the custom agent provider (`acp`), a
// provider that an agent uses, and a provider that is busy (a check, a start or a sign-in), each with
// the host's message. Both routes answer the list after the change. `requireAdmin` on the host is the
// only gate. Widening any of it needs a second capability string.
import { type AgentProviderId, isAgentProvider } from "../agent-providers";
import { isDynamicRecord } from "../runtime-values";
import { adminRoute, boolean, empty, fields, identifier, list, type OptionalRouteCodec } from "./admin-wire";

export const PROVIDER_USE_CAPABILITY = "provider-use-v1";

export const PROVIDER_USE_ROUTES = {
  list: "/v1/admin/provider-use/list",
  set: "/v1/admin/provider-use/set",
} as const;

/** The most provider ids that one list carries. */
export const PROVIDER_USE_LIMIT = 64;

const offList = fields({ off: list(identifier, PROVIDER_USE_LIMIT) });

export const PROVIDER_USE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PROVIDER_USE_ROUTES.list, adminRoute(empty, offList)],
  [PROVIDER_USE_ROUTES.set, adminRoute(fields({ provider: identifier, on: boolean }), offList)],
]);

/**
 * The off providers that a host answers, as the client type. The transport has already run it through
 * the codec above. A provider id that this client does not know is left out: it has no row to show.
 */
export function decodeProviderUseResponse(value: unknown): AgentProviderId[] {
  if (!isDynamicRecord(value) || !Array.isArray(value.off)) throw new Error("Invalid provider use.");
  return value.off.filter(isAgentProvider);
}
