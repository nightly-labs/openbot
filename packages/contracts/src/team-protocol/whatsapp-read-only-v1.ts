import { adminRoute, boolean, empty, fields, identifier, list, type OptionalRouteCodec, string } from "./admin-wire";

export const WHATSAPP_READ_ONLY_CAPABILITY = "whatsapp-read-only-v1";

export const WHATSAPP_READ_ONLY_ROUTES = {
  list: "/v1/admin/connectors/whatsapp/read-only",
  update: "/v1/admin/connectors/whatsapp/read-only/update",
} as const;

const number = fields({ workspaceId: identifier, readOnly: list(string(128), 200) });
const update = fields({ workspaceId: identifier, senderId: string(128), readOnly: boolean });

export const WHATSAPP_READ_ONLY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WHATSAPP_READ_ONLY_ROUTES.list, adminRoute(empty, fields({ numbers: list(number, 32) }))],
  [WHATSAPP_READ_ONLY_ROUTES.update, adminRoute(update, empty)],
]);
