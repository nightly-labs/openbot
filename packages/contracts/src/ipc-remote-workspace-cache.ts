// A saved copy of a joined server's workspace, kept on this computer so that the next launch can show
// it while the server connects. It is optional and off by default: a conversation of a joined server
// otherwise stays only on the computer that runs that server. Main owns the copy, keys it by the
// signed-in account and the server, and deletes it when either goes away. The renderer only reads
// the copy of the server it shows and offers new data for it.

import { INPUT_LIMITS } from "./input-limits";
import { type AvatarHue, isAvatarHue, isAvatarSeed } from "./ipc-agent-identity";
import { type AgentSummary, isAgentSummary } from "./ipc-agents";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import {
  type ConversationMessage,
  isConversationMessage,
  isConversationMessageSender,
} from "./ipc-conversation-messages";
import { type ConversationReadState, isConversationReadState } from "./ipc-conversations";
import { isSidebarLayoutSnapshot, type SidebarLayoutSnapshot } from "./ipc-sidebar-layout";
import { isBoolean, isDynamicRecord, isString } from "./runtime-values";

/** How much one saved copy holds. Main cuts what it gets to these limits before it writes. */
export const REMOTE_WORKSPACE_CACHE_LIMITS = {
  agents: 200,
  /** The chats with saved messages, the most recently saved first. */
  conversations: 5,
  /** The latest messages of one chat. */
  messages: 30,
  /** The characters of one saved message. A longer one is cut. */
  messageText: 8_000,
  /** The characters of the sidebar preview of one agent. */
  preview: 500,
  /** Messages that one save request may offer. Main keeps only the latest `messages` of them. */
  offeredMessages: 400,
} as const;

export interface RemoteWorkspaceCachePreference {
  enabled: boolean;
}

/**
 * One agent of the saved roster: only what the saved sidebar row shows. The copy keeps no
 * description, provider, model, effort, thread id, workspace path or avatar address.
 */
export interface RemoteWorkspaceCacheAgent {
  id: string;
  name: string;
  title: string;
  preview: string;
  updatedAt: string | null;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
}

/**
 * One saved message: only what the saved chat shows. `turnId` and `itemType` group the steps of a
 * turn, and `replyToMessageId` marks a reply that quotes a selection. The copy keeps no attachments,
 * images, reactions, plans, routines, question prompts, queue state or agent exchange data.
 */
export type RemoteWorkspaceCacheMessage = Pick<
  ConversationMessage,
  "id" | "turnId" | "author" | "text" | "createdAt" | "status" | "itemType" | "senderMember" | "replyToMessageId"
>;

/** One chat of the saved copy: its latest messages, without attachments. */
export interface RemoteWorkspaceCacheConversation {
  agentId: string;
  messages: RemoteWorkspaceCacheMessage[];
}

export interface RemoteWorkspaceCache {
  serverId: string;
  /** When main wrote the copy, as an ISO date. */
  savedAt: string;
  /** The reader's member id on the server, which tells the reader's own messages apart. */
  memberId: string | null;
  agents: RemoteWorkspaceCacheAgent[];
  reads: Record<string, ConversationReadState>;
  /** Null when the server keeps no sidebar layout. */
  layout: SidebarLayoutSnapshot | null;
  conversations: RemoteWorkspaceCacheConversation[];
}

export interface SaveRemoteWorkspaceInput {
  serverId: string;
  memberId: string | null;
  agents: AgentSummary[];
  reads: Record<string, ConversationReadState>;
  layout: SidebarLayoutSnapshot | null;
}

export interface SaveRemoteConversationInput {
  serverId: string;
  agentId: string;
  messages: ConversationMessage[];
}

export function isRemoteWorkspaceCachePreference(value: unknown): value is RemoteWorkspaceCachePreference {
  return isDynamicRecord(value) && isBoolean(value.enabled);
}

function isReadStates(value: unknown, limit: number): value is Record<string, ConversationReadState> {
  if (!isDynamicRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= limit &&
    entries.every(([agentId, state]) => isIdentifier(agentId) && isConversationReadState(state))
  );
}

function isAgentList(value: unknown): value is AgentSummary[] {
  return Array.isArray(value) && value.length <= REMOTE_WORKSPACE_CACHE_LIMITS.agents && value.every(isAgentSummary);
}

function isMessageList(value: unknown, limit: number): value is ConversationMessage[] {
  return Array.isArray(value) && value.length <= limit && value.every(isConversationMessage);
}

/** Checks the saved fields only. Other fields, as in a copy from an earlier version, are not read. */
export function isRemoteWorkspaceCacheAgent(value: unknown): value is RemoteWorkspaceCacheAgent {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.title, INPUT_LIMITS.agentTitle) &&
    isBoundedString(value.preview, INPUT_LIMITS.messageText) &&
    (value.updatedAt === null || isBoundedString(value.updatedAt, 160)) &&
    isAvatarSeed(value.avatarSeed) &&
    (value.avatarHue === null || isAvatarHue(value.avatarHue))
  );
}

/** Checks the saved fields only. Other fields, as in a copy from an earlier version, are not read. */
export function isRemoteWorkspaceCacheMessage(value: unknown): value is RemoteWorkspaceCacheMessage {
  if (!isDynamicRecord(value)) return false;
  const author = value.author;
  const status = value.status;
  return (
    isIdentifier(value.id) &&
    isString(value.text) &&
    isBoundedString(value.createdAt, 160) &&
    (author === "user" || author === "assistant" || author === "agent" || author === "system") &&
    (status === "streaming" || status === "completed" || status === "failed" || status === "interrupted") &&
    (value.turnId === undefined || isIdentifier(value.turnId)) &&
    (value.itemType === undefined || isBoundedString(value.itemType, INPUT_LIMITS.identifier)) &&
    (value.senderMember === undefined || isConversationMessageSender(value.senderMember)) &&
    (value.replyToMessageId === undefined || value.replyToMessageId === null || isIdentifier(value.replyToMessageId))
  );
}

/** The saved fields of an agent, with a short preview. Main writes and reads the copy through this. */
export function remoteWorkspaceCacheAgent(agent: RemoteWorkspaceCacheAgent): RemoteWorkspaceCacheAgent {
  return {
    id: agent.id,
    name: agent.name,
    title: agent.title,
    preview: agent.preview.slice(0, REMOTE_WORKSPACE_CACHE_LIMITS.preview),
    updatedAt: agent.updatedAt,
    avatarSeed: agent.avatarSeed,
    avatarHue: agent.avatarHue,
  };
}

/** The saved fields of a message, with its text cut to the limit. Main writes and reads the copy through this. */
export function remoteWorkspaceCacheMessage(message: RemoteWorkspaceCacheMessage): RemoteWorkspaceCacheMessage {
  return {
    id: message.id,
    author: message.author,
    text: message.text.slice(0, REMOTE_WORKSPACE_CACHE_LIMITS.messageText),
    createdAt: message.createdAt,
    status: message.status,
    ...(message.turnId === undefined ? {} : { turnId: message.turnId }),
    ...(message.itemType === undefined ? {} : { itemType: message.itemType }),
    ...(message.senderMember === undefined
      ? {}
      : { senderMember: { id: message.senderMember.id, name: message.senderMember.name } }),
    ...(message.replyToMessageId === undefined ? {} : { replyToMessageId: message.replyToMessageId }),
  };
}

export function isRemoteWorkspaceCacheConversation(value: unknown): value is RemoteWorkspaceCacheConversation {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    Array.isArray(value.messages) &&
    value.messages.length <= REMOTE_WORKSPACE_CACHE_LIMITS.messages &&
    value.messages.every(isRemoteWorkspaceCacheMessage)
  );
}

export function isRemoteWorkspaceCache(value: unknown): value is RemoteWorkspaceCache {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.serverId) &&
    isString(value.savedAt) &&
    !Number.isNaN(Date.parse(value.savedAt)) &&
    (value.memberId === null || isIdentifier(value.memberId)) &&
    Array.isArray(value.agents) &&
    value.agents.length <= REMOTE_WORKSPACE_CACHE_LIMITS.agents &&
    value.agents.every(isRemoteWorkspaceCacheAgent) &&
    isReadStates(value.reads, REMOTE_WORKSPACE_CACHE_LIMITS.agents) &&
    (value.layout === null || isSidebarLayoutSnapshot(value.layout)) &&
    Array.isArray(value.conversations) &&
    value.conversations.length <= REMOTE_WORKSPACE_CACHE_LIMITS.conversations &&
    value.conversations.every(isRemoteWorkspaceCacheConversation)
  );
}

export function isSaveRemoteWorkspaceInput(value: unknown): value is SaveRemoteWorkspaceInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.serverId) &&
    (value.memberId === null || isIdentifier(value.memberId)) &&
    isAgentList(value.agents) &&
    isReadStates(value.reads, REMOTE_WORKSPACE_CACHE_LIMITS.agents) &&
    (value.layout === null || isSidebarLayoutSnapshot(value.layout))
  );
}

export function isSaveRemoteConversationInput(value: unknown): value is SaveRemoteConversationInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.serverId) &&
    isIdentifier(value.agentId) &&
    isMessageList(value.messages, REMOTE_WORKSPACE_CACHE_LIMITS.offeredMessages)
  );
}
