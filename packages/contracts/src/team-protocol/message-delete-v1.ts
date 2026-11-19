import { adminRoute, empty, fields, identifier, type OptionalRouteCodec } from "./admin-wire";

export const MESSAGE_DELETE_CAPABILITY = "message-delete-v1";

export const MESSAGE_DELETE_ROUTES = {
  agent: "/v1/messages/delete",
  task: "/v1/messages/delete-task",
  channel: "/v1/channels/messages/delete",
} as const;

export const MESSAGE_DELETE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [MESSAGE_DELETE_ROUTES.agent, adminRoute(fields({ agentId: identifier, messageId: identifier }), empty)],
  [
    MESSAGE_DELETE_ROUTES.task,
    adminRoute(fields({ agentId: identifier, taskId: identifier, messageId: identifier }), empty),
  ],
  [MESSAGE_DELETE_ROUTES.channel, adminRoute(fields({ channelId: identifier, messageId: identifier }), empty)],
]);
