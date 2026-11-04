// Frozen optional whatsapp-connector-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a joined
// server links WhatsApp numbers to the host from their own computer, and manages them. The host runs
// the WhatsApp session and keeps its keys; no route carries a stored key. A link answers the QR code
// text or the pairing code that the host's session got from WhatsApp, and the client shows it, so the
// phone links the host as a device. The QR code text holds the one-use secret of that link. The client reads `linkState` while it waits; the QR code changes about
// every 20 seconds. The other routes read and set the numbers, the contacts and groups that each
// number allows, the pairing requests that wait, and the WhatsApp Orchestrator, which starts on the
// host's default provider and model. A member cannot use any route; `requireAdmin` on the host is the
// only gate. Widening any of it needs a second capability string.
//
// `state`, `credentials` and the link `error` are text, so a later host value does not break an older
// client: a client shows a connection state that it does not know as an error, and a link error that
// it does not know as `unavailable`.
import {
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const WHATSAPP_CONNECTOR_CAPABILITY = "whatsapp-connector-v1";

export const WHATSAPP_CONNECTOR_ROUTES = {
  overview: "/v1/admin/connectors/whatsapp/overview",
  linkStart: "/v1/admin/connectors/whatsapp/link/start",
  linkState: "/v1/admin/connectors/whatsapp/link/state",
  linkCancel: "/v1/admin/connectors/whatsapp/link/cancel",
  disconnect: "/v1/admin/connectors/whatsapp/disconnect",
  reconnect: "/v1/admin/connectors/whatsapp/reconnect",
  enabled: "/v1/admin/connectors/whatsapp/enabled",
  orchestrator: "/v1/admin/connectors/whatsapp/orchestrator",
  groups: "/v1/admin/connectors/whatsapp/groups",
  senderAdd: "/v1/admin/connectors/whatsapp/senders/add",
  senderRemove: "/v1/admin/connectors/whatsapp/senders/remove",
  requestAnswer: "/v1/admin/connectors/whatsapp/requests/answer",
  ownNumber: "/v1/admin/connectors/whatsapp/own-number",
} as const;

const number = fields({ workspaceId: identifier });
const connection = fields({
  workspaceId: identifier,
  platform: oneOf("whatsapp"),
  enabled: boolean,
  state: string(64),
  workspaceName: string(256),
  botUserId: nullable(string(256)),
  missingScopes: list(string(64), 32),
  retryAt: nullable(string(64)),
  credentials: string(64),
  orchestratorAgentId: nullable(identifier),
});
const sender = fields({ id: string(128), kind: oneOf("contact", "group"), name: string(256) });
const pairingRequest = fields({ code: string(16), senderId: string(64), name: string(256), expiresAt: string(64) });
const account = fields({
  workspaceId: identifier,
  ownNumber: boolean,
  allowedSenders: list(sender, 200),
  pendingRequests: list(pairingRequest, 3),
});
const linkState = fields({
  status: oneOf("idle", "waiting", "linked", "failed"),
  qr: nullable(string(1_024)),
  code: nullable(string(16)),
  workspaceId: nullable(identifier),
  error: nullable(string(64)),
});

export const WHATSAPP_CONNECTOR_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    WHATSAPP_CONNECTOR_ROUTES.overview,
    adminRoute(empty, fields({ connections: list(connection, 32), accounts: list(account, 32) })),
  ],
  [
    WHATSAPP_CONNECTOR_ROUTES.linkStart,
    adminRoute(
      fields({ method: oneOf("qr", "code"), phoneNumber: nullable(string(32)), ownNumber: boolean }),
      linkState,
    ),
  ],
  [WHATSAPP_CONNECTOR_ROUTES.linkState, adminRoute(empty, linkState)],
  [WHATSAPP_CONNECTOR_ROUTES.linkCancel, adminRoute(empty, empty)],
  [WHATSAPP_CONNECTOR_ROUTES.disconnect, adminRoute(number, empty)],
  [WHATSAPP_CONNECTOR_ROUTES.reconnect, adminRoute(number, empty)],
  [WHATSAPP_CONNECTOR_ROUTES.enabled, adminRoute(fields({ workspaceId: identifier, enabled: boolean }), empty)],
  [
    WHATSAPP_CONNECTOR_ROUTES.orchestrator,
    adminRoute(empty, fields({ agentId: identifier, sectionId: nullable(identifier) })),
  ],
  [
    WHATSAPP_CONNECTOR_ROUTES.groups,
    adminRoute(number, fields({ groups: list(fields({ id: string(128), name: string(256) }), 500) })),
  ],
  [WHATSAPP_CONNECTOR_ROUTES.senderAdd, adminRoute(fields({ workspaceId: identifier, sender }), empty)],
  [
    WHATSAPP_CONNECTOR_ROUTES.senderRemove,
    adminRoute(fields({ workspaceId: identifier, senderId: string(128) }), empty),
  ],
  [
    WHATSAPP_CONNECTOR_ROUTES.requestAnswer,
    adminRoute(fields({ workspaceId: identifier, code: string(16), approve: boolean }), empty),
  ],
  [WHATSAPP_CONNECTOR_ROUTES.ownNumber, adminRoute(fields({ workspaceId: identifier, ownNumber: boolean }), empty)],
]);
