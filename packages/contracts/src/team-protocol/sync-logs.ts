import { isIdentifier } from "../ipc-bounded-values";
import { type ChannelMessage, type ChannelPage, decodeChannelPage, isChannelMessage } from "../ipc-chat-channels";
import { type ConversationMessage, isConversationMessage } from "../ipc-conversation-messages";
import { type ConversationReadState, isConversationReadState } from "../ipc-conversations";
import { guardedDecoder } from "../ipc-decoding";
import { isDynamicRecord, isNumber, isString } from "../runtime-values";
import { SYNC_SNAPSHOT_KEY, type SyncCollectionSpec, type SyncLogSpec, wireDecoder } from "./sync-collections";

export const AGENT_MESSAGES_SYNC_LOG: SyncLogSpec<ConversationMessage> = {
  name: "agent-messages.v1",
  key: (message) => message.id,
  decode: wireDecoder(isConversationMessage, "conversation page messages"),
};

export const CHANNEL_MESSAGES_SYNC_LOG: SyncLogSpec<ChannelMessage> = {
  name: "channel-messages.v1",
  key: (message) => message.id,
  decode: wireDecoder(isChannelMessage, "channel conversation response"),
};

export interface ConversationPageMeta {
  agentId: string;
  threadId: string | null;
  activeTurnId: string | null;
  revision: number;
  messageCount: number;
  oldestAt: string | null;
  historyExtent: boolean;
  readState?: ConversationReadState;
}

export type ChannelPageMeta = Omit<ChannelPage, "messages">;

function isCount(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 0;
}

function isConversationPageMeta(value: unknown): value is ConversationPageMeta {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    (value.threadId === null || isIdentifier(value.threadId)) &&
    (value.activeTurnId === null || isIdentifier(value.activeTurnId)) &&
    isCount(value.revision) &&
    isCount(value.messageCount) &&
    (value.oldestAt === null || isString(value.oldestAt)) &&
    typeof value.historyExtent === "boolean" &&
    (value.readState === undefined || isConversationReadState(value.readState))
  );
}

function decodeChannelPageMeta(value: unknown): ChannelPageMeta {
  if (!isDynamicRecord(value) || Object.hasOwn(value, "messages")) throw new Error("Invalid channel page meta.");
  const { messages: _messages, ...meta } = decodeChannelPage({ ...value, messages: [] });
  return meta;
}

export const CONVERSATION_PAGE_META_SYNC_COLLECTION: SyncCollectionSpec<ConversationPageMeta> = {
  name: "conversation-meta.v1",
  scoped: true,
  key: () => SYNC_SNAPSHOT_KEY,
  decode: guardedDecoder(isConversationPageMeta, "conversation page meta"),
};

export const CHANNEL_PAGE_META_SYNC_COLLECTION: SyncCollectionSpec<ChannelPageMeta> = {
  name: "channel-meta.v1",
  scoped: true,
  key: () => SYNC_SNAPSHOT_KEY,
  decode: decodeChannelPageMeta,
};
