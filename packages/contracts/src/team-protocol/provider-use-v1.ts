import { type AgentProviderId, isAgentProvider } from "../agent-providers";
import { isDynamicRecord } from "../runtime-values";
import { adminRoute, boolean, empty, fields, identifier, list, type OptionalRouteCodec } from "./admin-wire";

export const PROVIDER_USE_CAPABILITY = "provider-use-v1";

export const PROVIDER_USE_ROUTES = {
  list: "/v1/admin/provider-use/list",
  set: "/v1/admin/provider-use/set",
} as const;

export const PROVIDER_USE_LIMIT = 64;

const offList = fields({ off: list(identifier, PROVIDER_USE_LIMIT) });

export const PROVIDER_USE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PROVIDER_USE_ROUTES.list, adminRoute(empty, offList)],
  [PROVIDER_USE_ROUTES.set, adminRoute(fields({ provider: identifier, on: boolean }), offList)],
]);

export function decodeProviderUseResponse(value: unknown): AgentProviderId[] {
  if (!isDynamicRecord(value) || !Array.isArray(value.off)) throw new Error("Invalid provider use.");
  return value.off.filter(isAgentProvider);
}
