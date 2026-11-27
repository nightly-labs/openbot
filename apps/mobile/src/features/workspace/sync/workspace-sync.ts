import type {
  AgentNotificationLevelsSnapshot,
  ConversationPage,
  HiddenAgentsSnapshot,
  QueueSnapshot,
  Routine,
  SidebarLayoutSnapshot,
  SidebarPinsSnapshot,
  WorkflowSummary,
} from "@openbot/contracts/ipc";
import { AGENT_HIDDEN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import { AGENT_NOTIFICATION_LEVELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { SIDEBAR_PINS_CAPABILITY } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import {
  HIDDEN_AGENTS_SYNC_COLLECTION,
  NOTIFICATION_LEVELS_SYNC_COLLECTION,
  QUEUE_SYNC_COLLECTION,
  ROUTINES_SYNC_COLLECTION,
  SIDEBAR_LAYOUT_SYNC_COLLECTION,
  SIDEBAR_PINS_SYNC_COLLECTION,
  SYNC_SNAPSHOT_KEY,
  WORKFLOWS_SYNC_COLLECTION,
} from "@openbot/contracts/team-protocol/sync-collections";
import { WORKFLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-v1";
import type { SyncCollection } from "@openbot/team-client/sync-client";
import type { RemoteAgent } from "../model/workspace-records";
import { createConversationLogs } from "./message-logs";
import type { MobileServerSync } from "./server-sync";
import {
  MOBILE_AGENTS_SYNC_COLLECTION,
  MOBILE_CONVERSATION_READS_SYNC_COLLECTION,
  SharedSyncCollection,
} from "./synced-collections";

export interface WorkspaceSyncHandlers {
  agents(serverId: string, agents: readonly RemoteAgent[]): void;
  hiddenAgents(serverId: string, snapshot: HiddenAgentsSnapshot): void;
  sidebarPins(serverId: string, snapshot: SidebarPinsSnapshot): void;
  sidebarLayout(serverId: string, snapshot: SidebarLayoutSnapshot): void;
  notificationLevels(serverId: string, snapshot: AgentNotificationLevelsSnapshot): void;
  conversationReads(serverId: string): void;
  routines(serverId: string, agentId: string, routines: readonly Routine[]): void;
  workflows(serverId: string, workflows: readonly WorkflowSummary[]): void;
  queue(serverId: string, agentId: string, snapshot: QueueSnapshot): void;
  conversationLog(serverId: string, agentId: string, page: ConversationPage): void;
}

export function syncedSnapshot<Entity>(handle: SyncCollection<Entity>): Entity | undefined {
  return handle.get(SYNC_SNAPSHOT_KEY);
}

export function routinesOf(handle: SyncCollection<Routine>, agentId: string): Routine[] {
  return handle.values().filter((routine) => routine.agentId === agentId);
}

export function queueOf(handle: SyncCollection<QueueSnapshot>, agentId: string): QueueSnapshot | undefined {
  const snapshot = syncedSnapshot(handle);
  return snapshot?.agentId === agentId ? snapshot : undefined;
}

export function orderSyncedAgents(
  agents: readonly RemoteAgent[],
  previousIds: readonly string[],
  layout: SidebarLayoutSnapshot | undefined,
): RemoteAgent[] {
  const positions = new Map(layout?.agentOrder.map((id, index) => [id, index]));
  const previous = new Map(previousIds.map((id, index) => [id, index]));
  const rank = (agent: RemoteAgent) => positions.get(agent.id) ?? positions.size;
  return [...agents].sort((a, b) => rank(a) - rank(b) || (previous.get(a.id) ?? -1) - (previous.get(b.id) ?? -1));
}

export type WorkspaceSyncCollections = ReturnType<typeof createWorkspaceSyncCollections>;

export function createWorkspaceSyncCollections(sync: MobileServerSync, handlers: () => WorkspaceSyncHandlers | null) {
  return {
    agents: new SharedSyncCollection(sync, MOBILE_AGENTS_SYNC_COLLECTION, {
      changed: (serverId, _param, handle) => handlers()?.agents(serverId, handle.values()),
    }),
    hiddenAgents: new SharedSyncCollection(sync, HIDDEN_AGENTS_SYNC_COLLECTION, {
      requires: [AGENT_HIDDEN_CAPABILITY],
      changed: (serverId, _param, handle) => {
        const snapshot = syncedSnapshot(handle);
        if (snapshot) handlers()?.hiddenAgents(serverId, snapshot);
      },
    }),
    sidebarPins: new SharedSyncCollection(sync, SIDEBAR_PINS_SYNC_COLLECTION, {
      requires: [SIDEBAR_PINS_CAPABILITY],
      changed: (serverId, _param, handle) => {
        const snapshot = syncedSnapshot(handle);
        if (snapshot) handlers()?.sidebarPins(serverId, snapshot);
      },
    }),
    sidebarLayout: new SharedSyncCollection(sync, SIDEBAR_LAYOUT_SYNC_COLLECTION, {
      changed: (serverId, _param, handle) => {
        const snapshot = syncedSnapshot(handle);
        if (snapshot) handlers()?.sidebarLayout(serverId, snapshot);
      },
    }),
    notificationLevels: new SharedSyncCollection(sync, NOTIFICATION_LEVELS_SYNC_COLLECTION, {
      requires: [AGENT_NOTIFICATION_LEVELS_CAPABILITY],
      changed: (serverId, _param, handle) => {
        const snapshot = syncedSnapshot(handle);
        if (snapshot) handlers()?.notificationLevels(serverId, snapshot);
      },
    }),
    conversationReads: new SharedSyncCollection(sync, MOBILE_CONVERSATION_READS_SYNC_COLLECTION, {
      changed: (serverId) => handlers()?.conversationReads(serverId),
    }),
    routines: new SharedSyncCollection(sync, ROUTINES_SYNC_COLLECTION, {
      changed: (serverId, agentId, handle) => {
        if (agentId) handlers()?.routines(serverId, agentId, routinesOf(handle, agentId));
      },
    }),
    workflows: new SharedSyncCollection(sync, WORKFLOWS_SYNC_COLLECTION, {
      requires: [WORKFLOWS_CAPABILITY],
      changed: (serverId, _param, handle) => handlers()?.workflows(serverId, handle.values()),
    }),
    queue: new SharedSyncCollection(sync, QUEUE_SYNC_COLLECTION, {
      changed: (serverId, agentId, handle) => {
        const snapshot = agentId ? queueOf(handle, agentId) : undefined;
        if (agentId && snapshot) handlers()?.queue(serverId, agentId, snapshot);
      },
    }),
    conversationLogs: createConversationLogs(sync, (serverId, agentId, page) =>
      handlers()?.conversationLog(serverId, agentId, page),
    ),
  };
}

export function retainServerCollections(collections: WorkspaceSyncCollections, serverId: string): () => void {
  const releases = [
    collections.agents.retain(serverId),
    collections.hiddenAgents.retain(serverId),
    collections.sidebarPins.retain(serverId),
    collections.sidebarLayout.retain(serverId),
    collections.notificationLevels.retain(serverId),
    collections.conversationReads.retain(serverId),
    collections.workflows.retain(serverId),
  ];
  return () => {
    for (const release of releases) release();
  };
}
