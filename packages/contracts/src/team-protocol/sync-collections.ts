import {
  type AgentNotificationLevelsSnapshot,
  isAgentNotificationLevelsSnapshot,
} from "../ipc-agent-notification-levels";
import { type ClientAgentSummary, isClientAgentSummary } from "../ipc-agents";
import { isIdentifier } from "../ipc-bounded-values";
import { type ChannelSummary, decodeChannelSummaries } from "../ipc-chat-channels";
import { type ConversationReadState, isConversationReadState } from "../ipc-conversations";
import { type CrmCustomer, isCrmCustomer } from "../ipc-crm";
import { guardedDecoder } from "../ipc-decoding";
import { type HiddenAgentsSnapshot, isHiddenAgentsSnapshot } from "../ipc-hidden-agents";
import { isQueueSnapshot, type QueueSnapshot } from "../ipc-queue";
import { isRoutine, type Routine } from "../ipc-routines";
import { isSidebarLayoutSnapshot, type SidebarLayoutSnapshot } from "../ipc-sidebar-layout";
import { isSidebarPinsSnapshot, type SidebarPinsSnapshot } from "../ipc-sidebar-pins";
import { decodeWorkflowSummary, type WorkflowSummary } from "../ipc-workflows";
import { isBoolean, isDynamicRecord, isNumber, isString } from "../runtime-values";
import { toCurrentAgentKeys, toWireAgentKeysObjectForPath } from "./current-agent-keys";
import type { TeamProtocolV1JsonObject, TeamProtocolV1JsonValue } from "./v1";

export interface SyncCollectionSpec<Entity> {
  readonly name: string;
  readonly scoped?: boolean;
  key(entity: Entity): string;
  decode(value: unknown): Entity;
  compare?(left: Entity, right: Entity): number;
}

export interface SyncLogSpec<Entity> {
  readonly name: string;
  key(entity: Entity): string;
  decode(value: unknown): Entity;
}

export const CHANNELS_SYNC_COLLECTION: SyncCollectionSpec<ChannelSummary> = {
  name: "channels.v1",
  key: (channel) => channel.id,
  decode: (value) => {
    const [channel] = decodeChannelSummaries([value]);
    if (!channel) throw new Error("Invalid channel list response.");
    return channel;
  },
  compare: (left, right) =>
    left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : left.id < right.id ? -1 : 1,
};

export const SYNC_SNAPSHOT_KEY = "snapshot";

function isWireJson(value: unknown): value is TeamProtocolV1JsonValue {
  if (value === null || isString(value) || isBoolean(value)) return true;
  if (isNumber(value)) return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isWireJson);
  return isDynamicRecord(value) && Object.values(value).every(isWireJson);
}

function currentKeys(value: unknown, label: string): TeamProtocolV1JsonValue {
  if (!isWireJson(value)) throw new Error(`Invalid ${label}.`);
  return toCurrentAgentKeys(value);
}

export function wireSyncBody(path: string, value: unknown): TeamProtocolV1JsonObject {
  if (!isDynamicRecord(value) || !isWireJson(value)) throw new Error("Invalid sync body.");
  return toWireAgentKeysObjectForPath(path, value);
}

export function wireDecoder<Entity>(
  guard: (value: unknown) => value is Entity,
  label: string,
): (value: unknown) => Entity {
  const decode = guardedDecoder(guard, label);
  return (value) => decode(currentKeys(value, label));
}

function snapshotCollection<Entity>(name: string, decode: (value: unknown) => Entity): SyncCollectionSpec<Entity> {
  return { name, key: () => SYNC_SNAPSHOT_KEY, decode };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function newestFirst(left: { updatedAt: string; id: string }, right: { updatedAt: string; id: string }): number {
  return compareText(right.updatedAt, left.updatedAt) || compareText(left.id, right.id);
}

export const AGENTS_SYNC_COLLECTION: SyncCollectionSpec<ClientAgentSummary> = {
  name: "agents.v1",
  key: (agent) => agent.id,
  decode: wireDecoder(isClientAgentSummary, "agent list response"),
};

export const HIDDEN_AGENTS_SYNC_COLLECTION: SyncCollectionSpec<HiddenAgentsSnapshot> = snapshotCollection(
  "hidden-agents.v1",
  wireDecoder(isHiddenAgentsSnapshot, "hidden agents response"),
);

export const SIDEBAR_PINS_SYNC_COLLECTION: SyncCollectionSpec<SidebarPinsSnapshot> = snapshotCollection(
  "sidebar-pins.v1",
  wireDecoder(isSidebarPinsSnapshot, "pinned chats response"),
);

export const SIDEBAR_LAYOUT_SYNC_COLLECTION: SyncCollectionSpec<SidebarLayoutSnapshot> = snapshotCollection(
  "sidebar-layout.v1",
  guardedDecoder(isSidebarLayoutSnapshot, "sidebar layout response"),
);

export const NOTIFICATION_LEVELS_SYNC_COLLECTION: SyncCollectionSpec<AgentNotificationLevelsSnapshot> =
  snapshotCollection(
    "notification-levels.v1",
    wireDecoder(isAgentNotificationLevelsSnapshot, "agent notification levels response"),
  );

export interface ConversationReadEntry extends ConversationReadState {
  agentId: string;
}

function isConversationReadEntry(value: unknown): value is ConversationReadEntry {
  return isDynamicRecord(value) && isIdentifier(value.agentId) && isConversationReadState(value);
}

export const CONVERSATION_READS_SYNC_COLLECTION: SyncCollectionSpec<ConversationReadEntry> = {
  name: "conversation-reads.v1",
  key: (entry) => entry.agentId,
  decode: guardedDecoder(isConversationReadEntry, "conversation reads response"),
};

export const ROUTINES_SYNC_COLLECTION: SyncCollectionSpec<Routine> = {
  name: "routines.v1",
  scoped: true,
  key: (routine) => routine.id,
  decode: wireDecoder(isRoutine, "routine list response"),
  compare: newestFirst,
};

export const WORKFLOWS_SYNC_COLLECTION: SyncCollectionSpec<WorkflowSummary> = {
  name: "workflows.v1",
  key: (workflow) => workflow.id,
  decode: (value) => decodeWorkflowSummary(currentKeys(value, "remote workflow list")),
  compare: newestFirst,
};

export const CRM_CUSTOMERS_SYNC_COLLECTION: SyncCollectionSpec<CrmCustomer> = {
  name: "crm-customers.v1",
  key: (customer) => customer.id,
  decode: wireDecoder(isCrmCustomer, "remote CRM customers"),
  compare: (left, right) => left.number - right.number,
};

export const QUEUE_SYNC_COLLECTION: SyncCollectionSpec<QueueSnapshot> = {
  name: "queue.v1",
  scoped: true,
  key: () => SYNC_SNAPSHOT_KEY,
  decode: wireDecoder(isQueueSnapshot, "queue response"),
};
