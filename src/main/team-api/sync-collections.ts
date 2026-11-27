import { CHANNEL_CHATS_CAPABILITY, type CrmCustomer, canAdministerServer, type TeamRole } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_HIDDEN_CAPABILITY, AGENT_HIDDEN_ROUTES } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import {
  AGENT_NOTIFICATION_LEVELS_CAPABILITY,
  AGENT_NOTIFICATION_LEVELS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CRM_CAPABILITY, CRM_ROUTES } from "@openbot/contracts/team-protocol/crm-v1";
import {
  SIDEBAR_FOLDERS_CAPABILITY,
  SIDEBAR_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/sidebar-folders-v1";
import { SIDEBAR_PINS_CAPABILITY, SIDEBAR_PINS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import {
  AGENTS_SYNC_COLLECTION,
  CHANNELS_SYNC_COLLECTION,
  CONVERSATION_READS_SYNC_COLLECTION,
  CRM_CUSTOMERS_SYNC_COLLECTION,
  HIDDEN_AGENTS_SYNC_COLLECTION,
  NOTIFICATION_LEVELS_SYNC_COLLECTION,
  QUEUE_SYNC_COLLECTION,
  ROUTINES_SYNC_COLLECTION,
  SIDEBAR_LAYOUT_SYNC_COLLECTION,
  SIDEBAR_PINS_SYNC_COLLECTION,
  type SyncCollectionSpec,
  WORKFLOWS_SYNC_COLLECTION,
} from "@openbot/contracts/team-protocol/sync-collections";
import { SYNC_LIMITS } from "@openbot/contracts/team-protocol/sync-v1";
import { WORKFLOWS_CAPABILITY, WORKFLOWS_ROUTES } from "@openbot/contracts/team-protocol/workflows-v1";
import type { ChannelService } from "../../backend/channel-service";
import type {
  TeamApiAgentNotificationLevels,
  TeamApiAgents,
  TeamApiCrm,
  TeamApiHiddenAgents,
  TeamApiSidebarLayout,
  TeamApiSidebarPins,
  TeamApiWorkflows,
} from "./dependencies";
import { visibleSnapshot } from "./route-agent-hidden";
import { queueResponse } from "./route-agent-queue";
import { isReleasedRoutine } from "./route-agent-routines";
import { visibleConversationReads } from "./route-agents";
import { visiblePeerChannels } from "./route-channels";
import { crmCustomerPage } from "./route-crm";
import type { SyncEntries, SyncHostCollection } from "./sync-hub";
import { visibleWorkflowSummaries } from "./workflow-visibility";

export interface TeamSyncViewer {
  readonly member: { readonly id: string; readonly role: TeamRole | null };
  readonly protocol: number;
  readonly hiddenAgentIds: ReadonlySet<string>;
  readonly capabilities: ReadonlySet<string>;
}

export interface TeamSyncSources {
  agents(): Pick<TeamApiAgents, "listAgents" | "listConversationReads" | "listRoutines" | "listQueue">;
  agentsReady(): Promise<void> | null;
  channels(): Pick<ChannelService, "store"> | undefined;
  hiddenAgents(): Pick<TeamApiHiddenAgents, "listHiddenAgents"> | undefined;
  sidebarPins(): Pick<TeamApiSidebarPins, "snapshot"> | undefined;
  notificationLevels(): Pick<TeamApiAgentNotificationLevels, "snapshot"> | undefined;
  sidebarLayout(): Pick<TeamApiSidebarLayout, "getSnapshot">;
  workflows(): Pick<TeamApiWorkflows, "listWithGraphs"> | undefined;
  crm(): Pick<TeamApiCrm, "customers"> | undefined;
  response(viewer: TeamSyncViewer, method: string, path: string, value: object): unknown;
}

export function teamSyncViewerKey(viewer: TeamSyncViewer): string {
  return [
    viewer.member.id,
    viewer.member.role ?? "",
    String(viewer.protocol),
    [...viewer.capabilities].sort().join(","),
    [...viewer.hiddenAgentIds].sort().join(","),
  ].join("\n");
}

function encodedList(body: unknown, field: string | null): unknown[] {
  const list = field === null ? body : isDynamicRecord(body) ? body[field] : undefined;
  if (!Array.isArray(list)) throw new Error("Team sync response has no list.");
  return list;
}

function listRows<Entity>(spec: SyncCollectionSpec<Entity>, items: readonly unknown[]): SyncEntries {
  return items.map((item) => [spec.key(spec.decode(item)), item] as const);
}

function snapshotRow<Entity>(spec: SyncCollectionSpec<Entity>, body: unknown): SyncEntries {
  return [[spec.key(spec.decode(body)), body] as const];
}

function visibleAgent(sources: TeamSyncSources, viewer: TeamSyncViewer, agentId: string | null): agentId is string {
  return (
    agentId !== null &&
    !viewer.hiddenAgentIds.has(agentId) &&
    sources
      .agents()
      .listAgents()
      .some((agent) => agent.id === agentId)
  );
}

async function allCrmCustomers(crm: Pick<TeamApiCrm, "customers">): Promise<CrmCustomer[]> {
  const customers: CrmCustomer[] = [];
  let after: number | null = null;
  do {
    const page = await crmCustomerPage(crm, after);
    customers.push(...page.customers);
    if (customers.length > SYNC_LIMITS.haveEntries) throw new Error("Team sync CRM customer list is too large.");
    after = page.next;
  } while (after !== null);
  return customers;
}

export function teamSyncCollections(sources: TeamSyncSources): SyncHostCollection<TeamSyncViewer>[] {
  const encode = (viewer: TeamSyncViewer, method: string, path: string, value: object) =>
    sources.response(viewer, method, path, value);
  return [
    {
      name: CHANNELS_SYNC_COLLECTION.name,
      read(viewer) {
        const channels = sources.channels();
        if (!channels || !viewer.capabilities.has(CHANNEL_CHATS_CAPABILITY)) return null;
        const body = encode(
          viewer,
          "GET",
          CHANNEL_ROUTES.list,
          visiblePeerChannels(channels, viewer.member, viewer.hiddenAgentIds),
        );
        return listRows(CHANNELS_SYNC_COLLECTION, encodedList(body, null));
      },
    },
    {
      name: AGENTS_SYNC_COLLECTION.name,
      read(viewer) {
        const rows = () =>
          listRows(
            AGENTS_SYNC_COLLECTION,
            encodedList(encode(viewer, "GET", TEAM_API_ROUTES.agents.all, sources.agents().listAgents()), null),
          );
        const ready = sources.agentsReady();
        return ready ? ready.then(rows) : rows();
      },
      readKeys(viewer, _agentId, keys) {
        const wanted = new Set(keys);
        const rows = () => {
          const agents = sources
            .agents()
            .listAgents()
            .filter((agent) => wanted.has(agent.id));
          return listRows(
            AGENTS_SYNC_COLLECTION,
            encodedList(encode(viewer, "GET", TEAM_API_ROUTES.agents.all, agents), null),
          );
        };
        const ready = sources.agentsReady();
        return ready ? ready.then(rows) : rows();
      },
    },
    {
      name: HIDDEN_AGENTS_SYNC_COLLECTION.name,
      read(viewer) {
        const hidden = sources.hiddenAgents();
        if (!hidden || !viewer.capabilities.has(AGENT_HIDDEN_CAPABILITY)) return null;
        const value = visibleSnapshot(hidden.listHiddenAgents(), viewer.hiddenAgentIds);
        return snapshotRow(HIDDEN_AGENTS_SYNC_COLLECTION, encode(viewer, "POST", AGENT_HIDDEN_ROUTES.read, value));
      },
    },
    {
      name: SIDEBAR_PINS_SYNC_COLLECTION.name,
      read(viewer) {
        const pins = sources.sidebarPins();
        if (!pins || !viewer.capabilities.has(SIDEBAR_PINS_CAPABILITY)) return null;
        const value = pins.snapshot(viewer.member.id, viewer.hiddenAgentIds);
        return snapshotRow(SIDEBAR_PINS_SYNC_COLLECTION, encode(viewer, "POST", SIDEBAR_PINS_ROUTES.read, value));
      },
    },
    {
      name: NOTIFICATION_LEVELS_SYNC_COLLECTION.name,
      read(viewer) {
        const levels = sources.notificationLevels();
        if (!levels || !viewer.capabilities.has(AGENT_NOTIFICATION_LEVELS_CAPABILITY)) return null;
        const value = levels.snapshot(viewer.member.id, viewer.hiddenAgentIds);
        return snapshotRow(
          NOTIFICATION_LEVELS_SYNC_COLLECTION,
          encode(viewer, "POST", AGENT_NOTIFICATION_LEVELS_ROUTES.read, value),
        );
      },
    },
    {
      name: SIDEBAR_LAYOUT_SYNC_COLLECTION.name,
      read(viewer) {
        const value = sources.sidebarLayout().getSnapshot();
        const body = viewer.capabilities.has(SIDEBAR_FOLDERS_CAPABILITY)
          ? encode(viewer, "POST", SIDEBAR_FOLDERS_ROUTES.read, value)
          : encode(viewer, "GET", TEAM_API_ROUTES.sidebarLayout.state, value);
        return snapshotRow(SIDEBAR_LAYOUT_SYNC_COLLECTION, body);
      },
    },
    {
      name: CONVERSATION_READS_SYNC_COLLECTION.name,
      read(viewer) {
        const reads = visibleConversationReads(
          sources.agents(),
          viewer.member.id,
          viewer.capabilities,
          viewer.hiddenAgentIds,
        );
        const body = encode(viewer, "GET", TEAM_API_ROUTES.agents.conversationReads, reads);
        if (!isDynamicRecord(body)) throw new Error("Team sync conversation reads are not a record.");
        return listRows(
          CONVERSATION_READS_SYNC_COLLECTION,
          Object.entries(body).map(([agentId, state]) => (isDynamicRecord(state) ? { ...state, agentId } : state)),
        );
      },
    },
    {
      name: ROUTINES_SYNC_COLLECTION.name,
      scoped: true,
      read(viewer, agentId) {
        if (!visibleAgent(sources, viewer, agentId)) return null;
        const routines = sources.agents().listRoutines(agentId).filter(isReleasedRoutine);
        return listRows(
          ROUTINES_SYNC_COLLECTION,
          encodedList(encode(viewer, "GET", TEAM_API_ROUTES.agent.routines(agentId), routines), null),
        );
      },
    },
    {
      name: WORKFLOWS_SYNC_COLLECTION.name,
      async read(viewer) {
        const workflows = sources.workflows();
        if (!workflows || !viewer.capabilities.has(WORKFLOWS_CAPABILITY)) return null;
        const summaries = await visibleWorkflowSummaries(
          {
            admin: canAdministerServer(viewer.member.role),
            protocol: viewer.protocol,
            hiddenAgentIds: viewer.hiddenAgentIds,
          },
          workflows,
          sources.agents(),
        );
        const body = encode(viewer, "POST", WORKFLOWS_ROUTES.list, { workflows: summaries });
        return listRows(WORKFLOWS_SYNC_COLLECTION, encodedList(body, "workflows"));
      },
    },
    {
      name: CRM_CUSTOMERS_SYNC_COLLECTION.name,
      async read(viewer) {
        const crm = sources.crm();
        if (!crm || !viewer.capabilities.has(CRM_CAPABILITY) || !canAdministerServer(viewer.member.role)) return null;
        const customers = await allCrmCustomers(crm);
        const body = encode(viewer, "POST", CRM_ROUTES.customers, { customers, next: null });
        return listRows(CRM_CUSTOMERS_SYNC_COLLECTION, encodedList(body, "customers"));
      },
    },
    {
      name: QUEUE_SYNC_COLLECTION.name,
      scoped: true,
      read(viewer, agentId) {
        if (!visibleAgent(sources, viewer, agentId)) return null;
        const snapshot = queueResponse(viewer.protocol, viewer.capabilities, sources.agents().listQueue(agentId));
        return snapshotRow(
          QUEUE_SYNC_COLLECTION,
          encode(viewer, "GET", TEAM_API_ROUTES.agent.queue(agentId), snapshot),
        );
      },
    },
  ];
}
