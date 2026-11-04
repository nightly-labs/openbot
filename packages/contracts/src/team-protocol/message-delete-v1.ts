// Frozen optional message-delete-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member of a server can ask
// the host to delete one message from the chat of an agent (`agent`), from the chat of one open side
// task of the agent (`task`), or from a channel (`channel`). The host removes the message from its
// history and view for every member; the provider session of an agent can still remember it. Only the
// ids cross the wire, and the response is empty. A member can delete a message that they sent when
// they can chat with the agent, or when they are in the channel. Any other message needs manage access
// to the agent, or an admin of the server for a channel; else the host answers 403. The host answers
// 404 for a message it does not show, and 409 while the message is part of a running turn. Widening
// any of it needs a second capability string.
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
