// Frozen optional whatsapp-status-reactions-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// joined server reads and sets, for each WhatsApp number that the host linked, whether the host puts
// its status reactions (👀 when a request arrives, then ✅, ❌ or 🫡 at its end) on the person's
// message. With the setting off, the host adds no status reaction to a message of that number, and
// its posts do not change. `whatsapp-connector-v1` is frozen and its overview cannot carry the
// setting, so `list` answers it for every linked number. A member cannot use any route;
// `requireAdmin` on the host is the only gate. Widening any of it needs a second capability string.
import { adminRoute, boolean, empty, fields, identifier, list, type OptionalRouteCodec } from "./admin-wire";

export const WHATSAPP_STATUS_REACTIONS_CAPABILITY = "whatsapp-status-reactions-v1";

export const WHATSAPP_STATUS_REACTIONS_ROUTES = {
  list: "/v1/admin/connectors/whatsapp/status-reactions",
  update: "/v1/admin/connectors/whatsapp/status-reactions/update",
} as const;

const setting = fields({ workspaceId: identifier, statusReactions: boolean });

export const WHATSAPP_STATUS_REACTIONS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WHATSAPP_STATUS_REACTIONS_ROUTES.list, adminRoute(empty, fields({ numbers: list(setting, 32) }))],
  [WHATSAPP_STATUS_REACTIONS_ROUTES.update, adminRoute(setting, empty)],
]);
