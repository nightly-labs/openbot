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
