// Optional password-managers-v1 wire contract.
//
// An owner or admin of a joined server connects the host to a password manager, such as Proton Pass,
// from their own computer or phone. One set of routes serves every manager that the host has: each
// request names the manager. `manager`, `state`, `step`, `methods` and `errorCode` are text, so a
// later host manager, state or step does not break an older client: a client hides a manager that
// it does not know, and shows a state that it does not know as not connected.
//
// `connect` starts a connection and answers the status at once; the client reads the status until
// `state` changes. A `browser` connection signs in on the host: the status carries `signInUrl`, the
// page that the client opens in the user's browser. The host then makes its own read-only access
// and keeps only that. A `key` connection carries an access key that the user made, once; no answer
// carries it. `extra-password` answers the step of the same name during a `browser` connection.
// A member cannot use any route; `requireAdmin` on the host is the only gate.
import {
  adminRoute,
  count,
  empty,
  fields,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
  variant,
} from "./admin-wire";

export const PASSWORD_MANAGERS_CAPABILITY = "password-managers-v1";

export const PASSWORD_MANAGERS_ROUTES = {
  list: "/v1/admin/password-managers/list",
  connect: "/v1/admin/password-managers/connect",
  cancel: "/v1/admin/password-managers/cancel",
  disconnect: "/v1/admin/password-managers/disconnect",
} as const;

export const PASSWORD_MANAGERS_ID_LIMIT = 64;
/** The host lists at most this many managers. */
export const PASSWORD_MANAGERS_LIMIT = 32;
/** An access key, such as a Proton Pass `pst_<token>::<key>`, is well under this length. */
export const PASSWORD_MANAGERS_KEY_LIMIT = 4_096;
export const PASSWORD_MANAGERS_PASSWORD_LIMIT = 1_024;
export const PASSWORD_MANAGERS_URL_LIMIT = 8_192;
/** The host sends at most this many vault names, each cut to `PASSWORD_MANAGERS_VAULT_NAME_LIMIT`. */
export const PASSWORD_MANAGERS_VAULT_LIMIT = 500;
export const PASSWORD_MANAGERS_VAULT_NAME_LIMIT = 1_024;

const manager = string(PASSWORD_MANAGERS_ID_LIMIT);

const status = fields({
  manager,
  state: string(64),
  step: nullable(string(64)),
  methods: list(string(64), 16),
  signInUrl: nullable(string(PASSWORD_MANAGERS_URL_LIMIT)),
  vaultNames: list(string(PASSWORD_MANAGERS_VAULT_NAME_LIMIT), PASSWORD_MANAGERS_VAULT_LIMIT),
  loginCount: nullable(count),
  /** Milliseconds since 1970, when the host's access ends; null when it does not end. */
  expiresAt: nullable(count),
  error: nullable(string(2_000)),
  errorCode: nullable(string(64)),
});

const onlyManager = fields({ manager });

export const PASSWORD_MANAGERS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PASSWORD_MANAGERS_ROUTES.list, adminRoute(empty, fields({ managers: list(status, PASSWORD_MANAGERS_LIMIT) }))],
  [
    PASSWORD_MANAGERS_ROUTES.connect,
    adminRoute(
      fields({
        manager,
        method: variant({
          browser: fields({ kind: oneOf("browser") }),
          key: fields({ kind: oneOf("key"), key: string(PASSWORD_MANAGERS_KEY_LIMIT) }),
          "extra-password": fields({
            kind: oneOf("extra-password"),
            password: string(PASSWORD_MANAGERS_PASSWORD_LIMIT),
          }),
        }),
      }),
      status,
    ),
  ],
  [PASSWORD_MANAGERS_ROUTES.cancel, adminRoute(onlyManager, status)],
  [PASSWORD_MANAGERS_ROUTES.disconnect, adminRoute(onlyManager, status)],
]);
