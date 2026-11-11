// Frozen optional whatsapp-working-message-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// joined server reads and sets, for each WhatsApp number that the host linked, whether the host posts
// its "Waiting" and "Working on it…" status posts in a chat while a request runs. With the setting
// off, a request gets a reaction and then only its answer; a reply of "stop" still stops it, and an
// approval is still posted. `whatsapp-connector-v1` is frozen and its overview cannot carry the
// setting, so `list` answers it for every linked number. A member cannot use any route;
// `requireAdmin` on the host is the only gate. Widening any of it needs a second capability string.
import { adminRoute, boolean, empty, fields, identifier, list, type OptionalRouteCodec } from "./admin-wire";

export const WHATSAPP_WORKING_MESSAGE_CAPABILITY = "whatsapp-working-message-v1";

export const WHATSAPP_WORKING_MESSAGE_ROUTES = {
  list: "/v1/admin/connectors/whatsapp/working-message",
  update: "/v1/admin/connectors/whatsapp/working-message/update",
} as const;

const setting = fields({ workspaceId: identifier, workingMessage: boolean });

export const WHATSAPP_WORKING_MESSAGE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WHATSAPP_WORKING_MESSAGE_ROUTES.list, adminRoute(empty, fields({ numbers: list(setting, 32) }))],
  [WHATSAPP_WORKING_MESSAGE_ROUTES.update, adminRoute(setting, empty)],
]);
