// Frozen optional telegram-account-connector-v1 wire contract.
//
// An owner or admin of a joined server signs the host in to their own Telegram account from their own
// computer. The host runs the sign-in and keeps the session; the client only shows its steps. A QR
// code needs nothing from the client but the picture: the user scans it with Telegram on a phone. For
// a sign-in with the phone number, `submit` carries the number, the code and the two-step password to
// the host, one value per call, on the encrypted Team channel; no answer carries them. The host
// registers each value for redaction before it uses it. A member cannot use any route; `requireAdmin`
// on the host is the only gate.
//
// Every route answers the host's status. `state` and `method` are text, so a later host state does
// not break an older client: a client shows a state that it does not know as not connected. `qrUrl`
// is the `tg://login` address that the QR code holds, set only in `qr`; it lets a phone sign in to the
// host's connection, so it goes only to an admin. `error` is the last failure, as a sentence.
import {
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const TELEGRAM_ACCOUNT_CONNECTOR_CAPABILITY = "telegram-account-connector-v1";

export const TELEGRAM_ACCOUNT_CONNECTOR_ROUTES = {
  status: "/v1/admin/connectors/telegram-account/status",
  connect: "/v1/admin/connectors/telegram-account/connect",
  submit: "/v1/admin/connectors/telegram-account/submit",
  cancel: "/v1/admin/connectors/telegram-account/cancel",
  disconnect: "/v1/admin/connectors/telegram-account/disconnect",
  setSending: "/v1/admin/connectors/telegram-account/set-sending",
} as const;

/** The longest value of `submit`. A two-step password can be long; a number or a code is short. */
export const TELEGRAM_ACCOUNT_CONNECTOR_VALUE_LIMIT = 256;
/** An api_hash is 32 hexadecimal characters. */
export const TELEGRAM_ACCOUNT_CONNECTOR_API_HASH_LIMIT = 64;

const account = fields({
  name: string(256),
  username: nullable(string(64)),
  phone: nullable(string(32)),
});

const status = fields({
  state: string(64),
  method: nullable(string(16)),
  qrUrl: nullable(string(512)),
  qrExpiresAt: nullable(count),
  codeViaApp: nullable(boolean),
  passwordHint: nullable(string(256)),
  account: nullable(account),
  sendingEnabled: boolean,
  error: nullable(string(2_000)),
});

export const TELEGRAM_ACCOUNT_CONNECTOR_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.status, adminRoute(empty, status)],
  [
    TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.connect,
    adminRoute(
      fields({
        method: oneOf("qr", "phone"),
        apiId: nullable(count),
        apiHash: nullable(string(TELEGRAM_ACCOUNT_CONNECTOR_API_HASH_LIMIT)),
      }),
      status,
    ),
  ],
  [
    TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.submit,
    adminRoute(
      fields({
        field: oneOf("phone", "code", "password"),
        value: string(TELEGRAM_ACCOUNT_CONNECTOR_VALUE_LIMIT),
      }),
      status,
    ),
  ],
  [TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.cancel, adminRoute(empty, status)],
  [TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.disconnect, adminRoute(empty, status)],
  [TELEGRAM_ACCOUNT_CONNECTOR_ROUTES.setSending, adminRoute(fields({ enabled: boolean }), status)],
]);
