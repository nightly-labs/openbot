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
