// Frozen optional provider-default-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and set the provider, and the model beside it, that a new agent of that host
// starts on when its creator chooses none. `provider` is null when the host has none, or when the
// client's protocol does not show it (as Team API protocol 7 does not show DeepSeek). `model` is
// null for the provider's own default model. The host refuses a provider or a model that it does
// not know, and a provider that the client's protocol does not show. A change does not change an
// agent that exists. A member cannot use either route; `requireAdmin` on the host is the only gate.
// Widening any of it needs a second capability string.
import { isString } from "../runtime-values";
import { type AdminDecoder, adminRoute, empty, fields, nullable, type OptionalRouteCodec, string } from "./admin-wire";
import { OPEN_PROVIDER_ID } from "./provider-aware-codec";

export const PROVIDER_DEFAULT_CAPABILITY = "provider-default-v1";

export const PROVIDER_DEFAULT_ROUTES = {
  settings: "/v1/admin/host/default-provider",
  update: "/v1/admin/host/default-provider/update",
} as const;

const providerId: AdminDecoder = (value) => {
  if (!isString(value) || !OPEN_PROVIDER_ID.test(value)) throw new Error("Invalid default provider.");
  return value;
};
const model = nullable(string(160));
const snapshot = fields({ provider: nullable(providerId), model });

export const PROVIDER_DEFAULT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PROVIDER_DEFAULT_ROUTES.settings, adminRoute(empty, snapshot)],
  [PROVIDER_DEFAULT_ROUTES.update, adminRoute(fields({ provider: providerId, model }), snapshot)],
]);
