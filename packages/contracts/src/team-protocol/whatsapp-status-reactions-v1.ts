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
