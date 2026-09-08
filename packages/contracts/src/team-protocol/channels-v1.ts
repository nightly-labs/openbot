// Frozen optional channel-chats-v1 wire contract. Keep IPC types and limits out of this file.
import { isDynamicRecord, isString } from "../runtime-values";
import { decodeTeamProtocolV1HttpResponse } from "./v1";
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "./v2";

export const CHANNEL_ROUTES = {
  list: "/v1/channels",
  read: "/v1/channels/read",
  command: "/v1/channels/commands",
} as const;
type Decoder = (value: unknown) => TeamProtocolV2Json;
type Fields = Record<string, Decoder>;

const string =
  (maximum: number): Decoder =>
  (value) => {
    if (!isString(value) || value.length > maximum) throw new Error("Invalid channel text.");
    return value;
  };
const identifier: Decoder = (value) => {
  if (!isString(value) || !value.length || value.length > 128) throw new Error("Invalid channel identifier.");
  return value;
};
const sequence: Decoder = (value) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid channel sequence.");
  return value;
};
const boolean: Decoder = (value) => {
  if (typeof value !== "boolean") throw new Error("Invalid channel flag.");
  return value;
};
const nullable =
  (decode: Decoder): Decoder =>
  (value) =>
    value === null ? null : decode(value);
const oneOf =
  (...choices: string[]): Decoder =>
  (value) => {
    if (!isString(value) || !choices.includes(value)) throw new Error("Invalid channel state.");
    return value;
  };
const list =
  (decode: Decoder, maximum = Number.MAX_SAFE_INTEGER): Decoder =>
  (value) => {
    if (!Array.isArray(value) || value.length > maximum) throw new Error("Invalid channel list.");
    return value.map(decode);
  };
const identifiers: Decoder = (value) => {
  const result = list(identifier, 100)(value);
  if (!Array.isArray(result) || new Set(result).size !== result.length)
    throw new Error("Duplicate channel identifier.");
  return result;
};
function record(value: unknown, fields: Fields): Record<string, TeamProtocolV2Json> {
  if (!isDynamicRecord(value)) throw new Error("Invalid channel record.");
  return Object.fromEntries(Object.entries(fields).map(([key, decode]) => [key, decode(value[key])]));
}
const member: Decoder = (value) => record(value, { agentId: identifier, responsibility: string(2000) });
const draftFields = {
  name: string(80),
  purpose: string(2000),
  members: list(member, 100),
  leadAgentId: nullable(identifier),
  linkedThreadIds: identifiers,
};
const draft: Decoder = (value) => {
  const result = record(value, draftFields);
  if (!isString(result.name) || !result.name.trim() || !Array.isArray(result.members))
    throw new Error("Invalid channel draft.");
  const ids = result.members.map((item) => (isDynamicRecord(item) ? item.agentId : null));
  if (new Set(ids).size !== ids.length || (result.leadAgentId !== null && !ids.includes(result.leadAgentId)))
    throw new Error("Invalid channel membership.");
  return result;
};
const preview: Decoder = nullable((value) =>
  record(value, { authorName: string(80), text: string(200), at: string(80) }),
);
const channel: Decoder = (value) => ({
  ...record(draft(value), draftFields),
  ...record(value, { id: identifier, archived: boolean, revision: sequence, createdAt: string(80) }),
});
const task: Decoder = (value) =>
  record(value, {
    id: identifier,
    channelId: identifier,
    parentTaskId: nullable(identifier),
    rootTaskId: identifier,
    ownerAgentId: nullable(identifier),
    requestMessageId: identifier,
    instruction: string(100000),
    attachmentDraftIds: identifiers,
    expectedResult: string(100000),
    sourceMessageIds: identifiers,
    dependencies: identifiers,
    resources: list(string(4096), 64),
    state: oneOf("queued", "running", "waiting", "paused", "completed", "failed", "cancelled"),
    revision: sequence,
    assignmentCount: sequence,
    error: nullable(string(100000)),
  });

// Channel messages share the already frozen V1 message fields. Provider-session internals and
// direct-delivery metadata have no place in a channel transcript and are not projected here.
const conversationMessage: Decoder = (value) => {
  if (!isDynamicRecord(value)) throw new Error("Invalid channel message.");
  const fields = [
    "id",
    "turnId",
    "author",
    "text",
    "createdAt",
    "status",
    "itemType",
    "source",
    "replyToMessageId",
    "attachments",
    "imageGeneration",
    "questionPrompt",
  ];
  const projected = Object.fromEntries(
    fields.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]),
  );
  const snapshot = decodeTeamProtocolV1HttpResponse("GET", "/v1/agents/channel/conversation-page", 200, {
    botId: "channel",
    threadId: null,
    activeTurnId: null,
    revision: 0,
    messages: [projected],
    references: {},
    pageInfo: { hasOlder: false, olderCursor: null },
  });
  if (!isDynamicRecord(snapshot) || !Array.isArray(snapshot.messages) || !snapshot.messages[0])
    throw new Error("Invalid channel message.");
  return decodeTeamProtocolV2Json(snapshot.messages[0]);
};
const message: Decoder = (value) =>
  record(value, {
    id: identifier,
    channelId: identifier,
    sequence,
    author: (author) =>
      record(author, { kind: oneOf("member", "agent", "coordinator"), id: identifier, name: string(80) }),
    taskId: nullable(identifier),
    superseded: boolean,
    message: conversationMessage,
  });

export function isChannelRoute(path: string): boolean {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  return pathname === CHANNEL_ROUTES.list || pathname === CHANNEL_ROUTES.read || pathname === CHANNEL_ROUTES.command;
}

export function channelRequest(path: string, value: unknown): TeamProtocolV2Json {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (pathname === CHANNEL_ROUTES.list) return {};
  if (pathname === CHANNEL_ROUTES.read) {
    if (!isDynamicRecord(value)) throw new Error("Invalid channel read request.");
    return {
      ...record(value, { channelId: identifier }),
      ...(value.beforeSequence === undefined ? {} : { beforeSequence: sequence(value.beforeSequence) }),
    };
  }
  if (pathname !== CHANNEL_ROUTES.command || !isDynamicRecord(value)) throw new Error("Invalid channel command.");
  const common = record(value, {
    type: oneOf("save", "archive", "restore", "read", "send", "stop", "resume", "reassign"),
    operationId: identifier,
    channelId: identifier,
  });
  if (value.type === "save") return { ...common, draft: draft(value.draft) };
  if (value.type === "archive" || value.type === "restore") return common;
  if (value.type === "read") return { ...common, throughSequence: sequence(value.throughSequence) };
  if (value.type === "send") {
    const result = record(value, {
      text: string(100000),
      recipientAgentId: nullable(identifier),
      replyToMessageId: nullable(identifier),
      attachmentDraftIds: identifiers,
    });
    if (
      !isString(result.text) ||
      (!result.text.trim() && Array.isArray(result.attachmentDraftIds) && !result.attachmentDraftIds.length)
    )
      throw new Error("Provide a channel message.");
    return { ...common, ...result };
  }
  return { ...common, ...record(value, { taskId: identifier, recipientAgentId: nullable(identifier) }) };
}

export function channelResponse(path: string, status: number, value: unknown): TeamProtocolV2Json {
  if (status >= 400) return record(value, { error: string(100000) });
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (pathname === CHANNEL_ROUTES.list)
    return list((item) => ({
      ...record(item, { unreadCount: sequence, activeTasks: sequence, lastMessage: preview }),
      ...record(channel(item), {
        ...draftFields,
        id: identifier,
        archived: boolean,
        revision: sequence,
        createdAt: string(80),
      }),
    }))(value);
  if (pathname === CHANNEL_ROUTES.read)
    return record(value, {
      channel,
      messages: list(message, 100),
      tasks: list(task),
      olderCursor: nullable(sequence),
      throughSequence: sequence,
    });
  if (pathname === CHANNEL_ROUTES.command) return channel(value);
  throw new Error("Unknown channel route.");
}

export function channelEvent(value: unknown): { type: "channels-changed"; channelId: string; revision: number } | null {
  if (!isDynamicRecord(value) || value.type !== "channels-changed") return null;
  if (
    !isString(value.channelId) ||
    !value.channelId.length ||
    value.channelId.length > 128 ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  )
    throw new Error("Invalid channel event.");
  return { type: "channels-changed", channelId: value.channelId, revision: value.revision };
}
