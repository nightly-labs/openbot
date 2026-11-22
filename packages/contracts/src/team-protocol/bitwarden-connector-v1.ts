import { adminRoute, empty, fields, nullable, type OptionalRouteCodec, string } from "./admin-wire";

export const BITWARDEN_CONNECTOR_CAPABILITY = "bitwarden-connector-v1";

export const BITWARDEN_CONNECTOR_ROUTES = {
  status: "/v1/admin/connectors/bitwarden/status",
  connect: "/v1/admin/connectors/bitwarden/connect",
  disconnect: "/v1/admin/connectors/bitwarden/disconnect",
} as const;

export const BITWARDEN_CONNECTOR_URL_LIMIT = 2_048;
export const BITWARDEN_CONNECTOR_KEY_LIMIT = 256;
export const BITWARDEN_CONNECTOR_PASSWORD_LIMIT = 1_024;

const status = fields({
  state: string(64),
  serverUrl: nullable(string(BITWARDEN_CONNECTOR_URL_LIMIT)),
  error: nullable(string(2_000)),
});

export const BITWARDEN_CONNECTOR_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [BITWARDEN_CONNECTOR_ROUTES.status, adminRoute(empty, status)],
  [
    BITWARDEN_CONNECTOR_ROUTES.connect,
    adminRoute(
      fields({
        serverUrl: string(BITWARDEN_CONNECTOR_URL_LIMIT),
        clientId: string(BITWARDEN_CONNECTOR_KEY_LIMIT),
        clientSecret: string(BITWARDEN_CONNECTOR_KEY_LIMIT),
        masterPassword: string(BITWARDEN_CONNECTOR_PASSWORD_LIMIT),
      }),
      status,
    ),
  ],
  [BITWARDEN_CONNECTOR_ROUTES.disconnect, adminRoute(empty, status)],
]);
