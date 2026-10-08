// A saved copy of a joined server's workspace, kept on this computer so that the next launch can show
// it while the server connects. It is optional and off by default: a conversation of a joined server
// otherwise stays only on the computer that runs that server. Main owns the copy, keys it by the
// signed-in account and the server, and deletes it when either goes away. The renderer only reads
// the copy of the server it shows and offers new data for it.

import { type AgentSummary, isAgentSummary } from "./ipc-agents";
import { isIdentifier } from "./ipc-bounded-values";
import { type ConversationMessage, isConversationMessage } from "./ipc-conversation-messages";
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

/** One chat of the saved copy: its latest messages, without attachments. */
export interface RemoteWorkspaceCacheConversation {
  agentId: string;
  messages: ConversationMessage[];
}

export interface RemoteWorkspaceCache {
  serverId: string;
  /** When main wrote the copy, as an ISO date. */
  savedAt: string;
  /** The reader's member id on the server, which tells the reader's own messages apart. */
  memberId: string | null;
  agents: AgentSummary[];
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

export function isRemoteWorkspaceCacheConversation(value: unknown): value is RemoteWorkspaceCacheConversation {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    isMessageList(value.messages, REMOTE_WORKSPACE_CACHE_LIMITS.messages)
  );
}

export function isRemoteWorkspaceCache(value: unknown): value is RemoteWorkspaceCache {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.serverId) &&
    isString(value.savedAt) &&
    !Number.isNaN(Date.parse(value.savedAt)) &&
    (value.memberId === null || isIdentifier(value.memberId)) &&
    isAgentList(value.agents) &&
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
