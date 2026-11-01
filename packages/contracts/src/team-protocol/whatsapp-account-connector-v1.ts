// Frozen optional whatsapp-account-connector-v1 wire contract.
//
// An owner or admin of a joined server links the host to their own WhatsApp account from their own
// computer. The host runs the link and keeps the keys of the linked device; the client only shows its
// steps. A QR code needs nothing from the client but the picture: the user scans it with WhatsApp on
// the phone. To link with a code instead, `submit` carries the phone number to the host on the
// encrypted Team channel, and the host answers the code that the user types on the phone. A member
// cannot use any route; `requireAdmin` on the host is the only gate.
//
// Every route answers the host's status. `state` and `method` are text, so a later host state does
// not break an older client: a client shows a state that it does not know as not connected. `qrCode`
// and `pairingCode` let a phone link the host's connection, so they go only to an admin. `error` is
// the last failure, as a sentence.
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

export const WHATSAPP_ACCOUNT_CONNECTOR_CAPABILITY = "whatsapp-account-connector-v1";

export const WHATSAPP_ACCOUNT_CONNECTOR_ROUTES = {
  status: "/v1/admin/connectors/whatsapp-account/status",
  connect: "/v1/admin/connectors/whatsapp-account/connect",
  submit: "/v1/admin/connectors/whatsapp-account/submit",
  cancel: "/v1/admin/connectors/whatsapp-account/cancel",
  disconnect: "/v1/admin/connectors/whatsapp-account/disconnect",
  setSending: "/v1/admin/connectors/whatsapp-account/set-sending",
} as const;

/** The longest value of `submit`: a phone number. */
export const WHATSAPP_ACCOUNT_CONNECTOR_VALUE_LIMIT = 32;

const account = fields({
  name: string(256),
  phone: nullable(string(32)),
});

const history = fields({
  chats: count,
  messages: count,
});

const status = fields({
  state: string(64),
  method: nullable(string(16)),
  qrCode: nullable(string(1_024)),
  qrExpiresAt: nullable(count),
  pairingCode: nullable(string(16)),
  account: nullable(account),
  history: nullable(history),
  sendingEnabled: boolean,
  error: nullable(string(2_000)),
});

export const WHATSAPP_ACCOUNT_CONNECTOR_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.status, adminRoute(empty, status)],
  [WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.connect, adminRoute(fields({ method: oneOf("qr", "phone") }), status)],
  [
    WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.submit,
    adminRoute(fields({ field: oneOf("phone"), value: string(WHATSAPP_ACCOUNT_CONNECTOR_VALUE_LIMIT) }), status),
  ],
  [WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.cancel, adminRoute(empty, status)],
  [WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.disconnect, adminRoute(empty, status)],
  [WHATSAPP_ACCOUNT_CONNECTOR_ROUTES.setSending, adminRoute(fields({ enabled: boolean }), status)],
]);
