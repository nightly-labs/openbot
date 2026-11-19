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
