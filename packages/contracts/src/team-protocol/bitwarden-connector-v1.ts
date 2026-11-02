// Frozen optional bitwarden-connector-v1 wire contract.
//
// An owner or admin of a joined server connects the host's Bitwarden or Vaultwarden from their own
// computer. A session key from another computer cannot open the host's vault, so the host signs in
// and unlocks with its own `bw` CLI. `connect` carries the server address, the personal API key and
// the master password to the host once; no answer carries them. The host keeps them in its encrypted
// store, so it can unlock again after a restart. A member cannot use any route; `requireAdmin` on the
// host is the only gate.
//
// Every route answers the host's status. `connect` starts the sign-in and answers `connecting`: the
// client reads the status until it changes. `state` is text, so a later host state does not break an
// older client: a client shows a state that it does not know as not connected. `serverUrl` is the
// vault server of the connection, and `error` the last failure, as a sentence.
import { adminRoute, empty, fields, nullable, type OptionalRouteCodec, string } from "./admin-wire";

export const BITWARDEN_CONNECTOR_CAPABILITY = "bitwarden-connector-v1";

export const BITWARDEN_CONNECTOR_ROUTES = {
  status: "/v1/admin/connectors/bitwarden/status",
  connect: "/v1/admin/connectors/bitwarden/connect",
  disconnect: "/v1/admin/connectors/bitwarden/disconnect",
} as const;

export const BITWARDEN_CONNECTOR_URL_LIMIT = 2_048;
/** A personal API key's `client_id` and `client_secret` are well under this length. */
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
