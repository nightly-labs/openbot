import { adminRoute, empty, fields, nullable, type OptionalRouteCodec, string } from "./admin-wire";
import { PROVIDER_ACCOUNT_ID } from "./provider-accounts-v1";

export const PROVIDER_ACCOUNT_KEYS_CAPABILITY = "provider-account-keys-v1";

export const PROVIDER_ACCOUNT_KEYS_ROUTES = {
  connect: "/v1/admin/providers/accounts/key/connect",
} as const;

export const PROVIDER_ACCOUNT_KEYS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDER_ACCOUNT_KEYS_ROUTES.connect,
    adminRoute(fields({ provider: string(64), accountId: nullable(PROVIDER_ACCOUNT_ID), key: string(512) }), empty),
  ],
]);
