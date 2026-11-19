import { adminRoute, count, empty, fields, list, nullable, type OptionalRouteCodec, string } from "./admin-wire";

export const ONEPASSWORD_CONNECTOR_CAPABILITY = "onepassword-connector-v1";

export const ONEPASSWORD_CONNECTOR_ROUTES = {
  status: "/v1/admin/connectors/onepassword/status",
  connect: "/v1/admin/connectors/onepassword/connect",
  disconnect: "/v1/admin/connectors/onepassword/disconnect",
} as const;

export const ONEPASSWORD_CONNECTOR_TOKEN_LIMIT = 4_096;
export const ONEPASSWORD_CONNECTOR_VAULT_LIMIT = 500;
export const ONEPASSWORD_CONNECTOR_VAULT_NAME_LIMIT = 1_024;

const status = fields({
  state: string(64),
  vaultNames: list(string(ONEPASSWORD_CONNECTOR_VAULT_NAME_LIMIT), ONEPASSWORD_CONNECTOR_VAULT_LIMIT),
  loginCount: nullable(count),
  error: nullable(string(2_000)),
});

export const ONEPASSWORD_CONNECTOR_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [ONEPASSWORD_CONNECTOR_ROUTES.status, adminRoute(empty, status)],
  [
    ONEPASSWORD_CONNECTOR_ROUTES.connect,
    adminRoute(fields({ token: string(ONEPASSWORD_CONNECTOR_TOKEN_LIMIT) }), status),
  ],
  [ONEPASSWORD_CONNECTOR_ROUTES.disconnect, adminRoute(empty, status)],
]);
