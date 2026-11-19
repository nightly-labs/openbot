// Frozen optional provider-environment-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and set the environment variables that each process of one of the server's
// providers starts with: "claude", "codex" or "antigravity". A list has at most 32 variables. A name
// has at most 128 characters and a value at most 8,192. A sensitive value goes to the host only: a
// read gives an empty `value` and `stored: true`, and an update with `value: null` keeps the stored
// value. The host refuses an invalid, reserved or repeated name with 400. It applies a change to the
// provider's processes that start after it. A member cannot use either route; `requireAdmin` on the
// host is the only gate. Widening any of it needs a second capability string.
import {
  isProviderEnvironmentProvider,
  type ProviderEnvironment,
  type ProviderEnvironmentVariable,
} from "../ipc-provider-environment";
import { isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  fields,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const PROVIDER_ENVIRONMENT_CAPABILITY = "provider-environment-v1";

export const PROVIDER_ENVIRONMENT_ROUTES = {
  settings: "/v1/admin/host/provider-environment",
  update: "/v1/admin/host/provider-environment/update",
} as const;

const WIRE_PROVIDERS = ["claude", "codex", "antigravity"];
const WIRE_LIMITS = { variables: 32, name: 128, value: 8_192 } as const;

const provider: AdminDecoder = oneOf(...WIRE_PROVIDERS);
const inputVariable = fields({
  name: string(WIRE_LIMITS.name),
  value: nullable(string(WIRE_LIMITS.value)),
  sensitive: boolean,
});
const readVariable = fields({
  name: string(WIRE_LIMITS.name),
  value: string(WIRE_LIMITS.value),
  sensitive: boolean,
  stored: boolean,
});
const snapshot = fields({ provider, variables: list(readVariable, WIRE_LIMITS.variables) });

export const PROVIDER_ENVIRONMENT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PROVIDER_ENVIRONMENT_ROUTES.settings, adminRoute(fields({ provider }), snapshot)],
  [
    PROVIDER_ENVIRONMENT_ROUTES.update,
    adminRoute(fields({ provider, variables: list(inputVariable, WIRE_LIMITS.variables) }), snapshot),
  ],
]);

/**
 * The variables that a host answers, as the client type. It is not the preload decoder: the two check
 * different senders.
 */
export function decodeProviderEnvironmentResponse(value: unknown): ProviderEnvironment {
  if (
    !isDynamicRecord(value) ||
    !isProviderEnvironmentProvider(value.provider) ||
    !Array.isArray(value.variables) ||
    value.variables.length > WIRE_LIMITS.variables
  )
    throw new Error("Invalid provider environment.");
  const variables: ProviderEnvironmentVariable[] = [];
  for (const item of value.variables) {
    if (
      !isDynamicRecord(item) ||
      !isString(item.name) ||
      item.name.length > WIRE_LIMITS.name ||
      !isString(item.value) ||
      item.value.length > WIRE_LIMITS.value ||
      typeof item.sensitive !== "boolean" ||
      typeof item.stored !== "boolean"
    )
      throw new Error("Invalid provider environment.");
    variables.push({ name: item.name, value: item.value, sensitive: item.sensitive, stored: item.stored });
  }
  return { provider: value.provider, variables };
}
