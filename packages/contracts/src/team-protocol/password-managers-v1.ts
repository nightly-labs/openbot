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
export const PASSWORD_MANAGERS_LIMIT = 32;
export const PASSWORD_MANAGERS_KEY_LIMIT = 4_096;
export const PASSWORD_MANAGERS_PASSWORD_LIMIT = 1_024;
export const PASSWORD_MANAGERS_URL_LIMIT = 8_192;
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
