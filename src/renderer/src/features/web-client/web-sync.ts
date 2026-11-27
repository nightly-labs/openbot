import {
  type AgentEvent,
  type AgentNotificationLevelsSnapshot,
  CHANNEL_CHATS_CAPABILITY,
  type ChannelMessage,
  type ChannelPage,
  type ChannelSummary,
  type ClientAgentSummary,
  type ConversationMessage,
  type ConversationPage,
  type ConversationReadState,
  type CrmCustomer,
  canAdministerServer,
  type HiddenAgentsSnapshot,
  type QueueSnapshot,
  type Routine,
  type SidebarLayoutSnapshot,
  type SidebarPinsSnapshot,
  type TeamRole,
  type WorkflowSummary,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_HIDDEN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import { AGENT_NOTIFICATION_LEVELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CRM_CAPABILITY, CRM_ROUTES } from "@openbot/contracts/team-protocol/crm-v1";
import { SIDEBAR_PINS_CAPABILITY } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import {
  AGENTS_SYNC_COLLECTION,
  CHANNELS_SYNC_COLLECTION,
  CONVERSATION_READS_SYNC_COLLECTION,
  type ConversationReadEntry,
  CRM_CUSTOMERS_SYNC_COLLECTION,
  HIDDEN_AGENTS_SYNC_COLLECTION,
  NOTIFICATION_LEVELS_SYNC_COLLECTION,
  QUEUE_SYNC_COLLECTION,
  ROUTINES_SYNC_COLLECTION,
  SIDEBAR_LAYOUT_SYNC_COLLECTION,
  SIDEBAR_PINS_SYNC_COLLECTION,
  SYNC_SNAPSHOT_KEY,
  type SyncCollectionSpec,
  type SyncLogSpec,
  WORKFLOWS_SYNC_COLLECTION,
} from "@openbot/contracts/team-protocol/sync-collections";
import {
  AGENT_MESSAGES_SYNC_LOG,
  CHANNEL_MESSAGES_SYNC_LOG,
  CHANNEL_PAGE_META_SYNC_COLLECTION,
  type ChannelPageMeta,
  CONVERSATION_PAGE_META_SYNC_COLLECTION,
  type ConversationPageMeta,
} from "@openbot/contracts/team-protocol/sync-logs";
import {
  SYNC_CAPABILITY,
  type SyncClientMessage,
  type SyncServerMessage,
} from "@openbot/contracts/team-protocol/sync-v1";
import { WORKFLOWS_CAPABILITY, WORKFLOWS_ROUTES } from "@openbot/contracts/team-protocol/workflows-v1";
import type { RemoteTeamEvent } from "@openbot/team-client/remote-peer";
import {
  createSyncClient,
  type SyncClient,
  type SyncCollection,
  type SyncLog,
  type SyncLogEntry,
} from "@openbot/team-client/sync-client";
import { channelPageFromSync, conversationPageFromSync } from "@openbot/team-client/sync-pages";
import { markRemoteSync } from "@openbot/team-client/sync-profile";

const PAIR_WINDOW_MS = 2_000;
const CONVERSATION_PAGINATION_CAPABILITY = "conversation-pagination";
const CONVERSATION_LOG_LIMIT = 50;
const CHANNEL_LOG_LIMIT = 100;
const AGENT_PATH = `${TEAM_API_ROUTES.agents.all}/`;
const READ_POSTS: ReadonlySet<string> = new Set([
  WORKFLOWS_ROUTES.list,
  WORKFLOWS_ROUTES.get,
  WORKFLOWS_ROUTES.versions,
  WORKFLOWS_ROUTES.versionGraph,
  WORKFLOWS_ROUTES.runs,
  WORKFLOWS_ROUTES.run,
  CRM_ROUTES.overview,
  CRM_ROUTES.customers,
  CRM_ROUTES.payments,
  CRM_ROUTES.activity,
  CRM_ROUTES.settings,
]);
const WORKFLOW_PATHS: ReadonlySet<string> = new Set(Object.values(WORKFLOWS_ROUTES));
const CRM_PATHS: ReadonlySet<string> = new Set(Object.values(CRM_ROUTES));
const MESSAGE_WRITES: ReadonlySet<string> = new Set([
  CHANNEL_ROUTES.command,
  CHANNEL_ROUTES.delete,
  ...Object.values(TEAM_API_ROUTES.respond),
]);

type PayloadEventType =
  | "agents-changed"
  | "hidden-agents-changed"
  | "sidebar-pins-changed"
  | "sidebar-layout-changed"
  | "agent-notification-levels-changed";

type WriteScope = "workflows" | "crm" | "messages";

export type WebSyncOrder = "agents" | "channels";

export interface WebSyncOptions {
  capabilities: readonly string[];
  role: TeamRole | null;
  focusedAgentId: string | null;
  focusedChannelId: string | null;
  send(message: SyncClientMessage): Promise<void>;
  emit(event: AgentEvent): void;
  channelsChanged(): void;
  readsChanged(): void;
}

export interface WebSync {
  receive(message: SyncServerMessage): void;
  pause(): void;
  resubscribe(): void;
  focus(agentId: string | null): void;
  focusChannel(channelId: string | null): void;
  wrote(method: string, path: string): void;
  noteOrder(kind: WebSyncOrder, ids: readonly string[]): void;
  hostEvent(event: RemoteTeamEvent): boolean;
  channels(): ChannelSummary[] | null;
  agents(): ClientAgentSummary[] | null;
  hiddenAgents(): HiddenAgentsSnapshot | null;
  sidebarPins(): SidebarPinsSnapshot | null;
  sidebarLayout(): SidebarLayoutSnapshot | null;
  notificationLevels(): AgentNotificationLevelsSnapshot | null;
  conversationReads(): Record<string, ConversationReadState> | null;
  queue(agentId: string): QueueSnapshot | null;
  routinesFor(path: string): Routine[] | null;
  conversationPage(agentId: string): Promise<ConversationPage | null>;
  channelPage(channelId: string): Promise<ChannelPage | null>;
  workflows(): Promise<WorkflowSummary[] | null>;
  crmCustomers(): Promise<CrmCustomer[] | null>;
  dispose(): void;
}

function contentKey(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    isDynamicRecord(item) ? Object.entries(item).sort(([left], [right]) => (left < right ? -1 : 1)) : item,
  );
}

function payloadKey(event: RemoteTeamEvent): [PayloadEventType, string] | null {
  switch (event.type) {
    case "agents-changed":
      return [event.type, contentKey(event.agents)];
    case "hidden-agents-changed":
      return [event.type, contentKey(event.agents)];
    case "sidebar-pins-changed":
      return [event.type, contentKey({ items: event.items, updatedAt: event.updatedAt })];
    case "sidebar-layout-changed":
      return [event.type, contentKey(event.layout)];
    case "agent-notification-levels-changed":
      return [event.type, contentKey({ server: event.server, agents: event.agents })];
    default:
      return null;
  }
}

function signalKey(event: RemoteTeamEvent): string | null {
  switch (event.type) {
    case "routines-changed":
      return `${event.type}:${event.agentId}`;
    case "workflows-changed":
      return `${event.type}:${event.workflowId}`;
    case "crm-changed":
      return event.type;
    case "queue-invalidated":
      return `${event.type}:${event.agentId}`;
    case "conversation-invalidated":
      return `${event.type}:${event.agentId}`;
    case "channels-changed":
      return `${event.type}:${event.channelId}`;
    default:
      return null;
  }
}

function writeScope(method: string, path: string): WriteScope | null {
  if (method === "GET" || READ_POSTS.has(path)) return null;
  if (WORKFLOW_PATHS.has(path)) return "workflows";
  if (CRM_PATHS.has(path)) return "crm";
  return MESSAGE_WRITES.has(path) || path.startsWith(AGENT_PATH) ? "messages" : null;
}

function inOrder<Entity extends { id: string }>(
  values: readonly Entity[],
  order: ReadonlyMap<string, number>,
): Entity[] {
  const rank = (id: string) => order.get(id) ?? order.size;
  return [...values].sort((left, right) => rank(left.id) - rank(right.id));
}

class RecentSyncSignals {
  readonly #arrivals = new Map<string, number[]>();

  fromSync(key: string): void {
    this.#arrivals.set(key, [...this.#fresh(key), Date.now()]);
  }

  hostIsNew(key: string): boolean {
    const fresh = this.#fresh(key);
    const matched = fresh.shift() !== undefined;
    if (fresh.length > 0) this.#arrivals.set(key, fresh);
    else this.#arrivals.delete(key);
    return !matched;
  }

  #fresh(key: string): number[] {
    const now = Date.now();
    return (this.#arrivals.get(key) ?? []).filter((at) => now - at < PAIR_WINDOW_MS);
  }
}

interface Watched<Entity> {
  handle: SyncCollection<Entity>;
  stop(): void;
}

interface WatchedLog<Entity> {
  handle: SyncLog<Entity>;
  stop(): void;
}

interface AgentScope {
  agentId: string;
  queue: Watched<QueueSnapshot>;
  routines: Watched<Routine>;
  messages: WatchedLog<ConversationMessage> | null;
  meta: Watched<ConversationPageMeta> | null;
  lastPage: ConversationPage | null;
}

interface ChannelScope {
  channelId: string;
  messages: WatchedLog<ChannelMessage>;
  meta: Watched<ChannelPageMeta>;
  lastPage: ChannelPage | null;
}

function changedKeys<Entity>(before: ReadonlyMap<string, Entity>, after: ReadonlyMap<string, Entity>): string[] {
  const keys = new Set<string>();
  for (const [key, entity] of after) if (before.get(key) !== entity) keys.add(key);
  for (const key of before.keys()) if (!after.has(key)) keys.add(key);
  return [...keys];
}

function sameRows<Entity>(before: readonly SyncLogEntry<Entity>[], after: readonly SyncLogEntry<Entity>[]): boolean {
  return (
    before.length === after.length &&
    before.every((entry, index) => {
      const next = after[index];
      return next !== undefined && next.key === entry.key && next.order === entry.order && next.entity === entry.entity;
    })
  );
}

export function createWebSync(options: WebSyncOptions): WebSync | null {
  const has = (capability: string) => options.capabilities.includes(capability);
  if (!has(SYNC_CAPABILITY)) return null;
  const client: SyncClient = createSyncClient({ send: options.send });
  const delivered = new Map<PayloadEventType, { key: string; from: "host" | "sync" }>();
  const syncSignals = new RecentSyncSignals();
  const writes: Record<WriteScope, number> = { workflows: 0, crm: 0, messages: 0 };
  const readsAfter = new Map<string, number>();
  const order: Record<WebSyncOrder, ReadonlyMap<string, number>> = { agents: new Map(), channels: new Map() };
  let disposed = false;

  function emit(event: AgentEvent): void {
    if (disposed) return;
    const payload = payloadKey(event);
    if (payload) {
      const [type, key] = payload;
      if (delivered.get(type)?.key === key) return;
      delivered.set(type, { key, from: "sync" });
      options.emit(event);
      return;
    }
    const signal = signalKey(event);
    if (signal) syncSignals.fromSync(signal);
    options.emit(event);
  }

  function noteOrder(kind: WebSyncOrder, ids: readonly string[]): void {
    order[kind] = new Map(ids.map((id, index) => [id, index] as const));
  }

  async function settled(scope: WriteScope, reader: string): Promise<void> {
    const count = writes[scope];
    if ((readsAfter.get(reader) ?? 0) >= count) return;
    await client.barrier();
    readsAfter.set(reader, Math.max(readsAfter.get(reader) ?? 0, count));
  }

  function watch<Entity>(
    spec: SyncCollectionSpec<Entity>,
    param: string | null,
    changed: (keys: string[], values: readonly Entity[]) => void,
  ): Watched<Entity> {
    const handle = client.collection(spec, param);
    let baseline: Map<string, Entity> | null = null;
    const stop = handle.subscribe(() => {
      if (handle.status() !== "synced") return;
      const values = handle.values();
      const next = new Map(values.map((entity) => [spec.key(entity), entity] as const));
      const before = baseline;
      baseline = next;
      if (!before) {
        markRemoteSync(`sync:${spec.name}`);
        return;
      }
      const keys = changedKeys(before, next);
      if (keys.length > 0) changed(keys, values);
    });
    return { handle, stop };
  }

  function watchLog<Entity>(
    spec: SyncLogSpec<Entity>,
    param: string,
    limit: number,
    changed: () => void,
  ): WatchedLog<Entity> {
    const handle = client.log(spec, param, { limit });
    let baseline: { rows: readonly SyncLogEntry<Entity>[]; references: ReadonlyMap<string, Entity> } | null = null;
    const stop = handle.subscribe(() => {
      if (handle.status() !== "synced") return;
      const next = { rows: handle.rows(), references: handle.references() };
      const before = baseline;
      baseline = next;
      if (!before) {
        markRemoteSync(`sync:${spec.name}`);
        return;
      }
      if (!sameRows(before.rows, next.rows) || changedKeys(before.references, next.references).length > 0) changed();
    });
    return { handle, stop };
  }

  function synced<Entity>(watched: Watched<Entity> | null): readonly Entity[] | null {
    return watched?.handle.status() === "synced" ? watched.handle.values() : null;
  }

  function snapshot<Entity>(watched: Watched<Entity> | null): Entity | null {
    return watched?.handle.status() === "synced" ? (watched.handle.get(SYNC_SNAPSHOT_KEY) ?? null) : null;
  }

  function snapshotWatch<Entity>(
    spec: SyncCollectionSpec<Entity>,
    event: (value: Entity) => AgentEvent,
  ): Watched<Entity> {
    return watch(spec, null, (_keys, values) => {
      const [value] = values;
      if (value !== undefined) emit(event(value));
    });
  }

  const channels = has(CHANNEL_CHATS_CAPABILITY)
    ? watch(CHANNELS_SYNC_COLLECTION, null, () => options.channelsChanged())
    : null;
  const agents = watch(AGENTS_SYNC_COLLECTION, null, (_keys, values) =>
    emit({ type: "agents-changed", agents: inOrder(values, order.agents) }),
  );
  const hiddenAgents = has(AGENT_HIDDEN_CAPABILITY)
    ? snapshotWatch(HIDDEN_AGENTS_SYNC_COLLECTION, (value) => ({ type: "hidden-agents-changed", agents: value.agents }))
    : null;
  const sidebarPins = has(SIDEBAR_PINS_CAPABILITY)
    ? snapshotWatch(SIDEBAR_PINS_SYNC_COLLECTION, (value) => ({
        type: "sidebar-pins-changed",
        items: value.items,
        updatedAt: value.updatedAt,
      }))
    : null;
  const sidebarLayout = snapshotWatch(SIDEBAR_LAYOUT_SYNC_COLLECTION, (layout) => ({
    type: "sidebar-layout-changed",
    layout,
  }));
  const notificationLevels = has(AGENT_NOTIFICATION_LEVELS_CAPABILITY)
    ? snapshotWatch(NOTIFICATION_LEVELS_SYNC_COLLECTION, (value) => ({
        type: "agent-notification-levels-changed",
        server: value.server,
        agents: value.agents,
      }))
    : null;
  const reads: Watched<ConversationReadEntry> = watch(CONVERSATION_READS_SYNC_COLLECTION, null, () =>
    options.readsChanged(),
  );
  let workflows: Watched<WorkflowSummary> | null = null;
  let crmCustomers: Watched<CrmCustomer> | null = null;
  let scoped: AgentScope | null = null;
  let channelScope: ChannelScope | null = null;

  function release(watched: { handle: { name: string }; stop(): void } | null): void {
    if (!watched) return;
    watched.stop();
    client.release(watched.handle.name);
  }

  function conversationChanged(agentId: string): void {
    const meta = scoped?.agentId === agentId ? snapshot(scoped.meta) : null;
    emit({ type: "conversation-invalidated", agentId, revision: meta?.revision ?? 0 });
  }

  function channelChanged(channelId: string): void {
    const meta = channelScope?.channelId === channelId ? snapshot(channelScope.meta) : null;
    emit({ type: "channels-changed", channelId, revision: meta?.channel.revision ?? 0 });
  }

  function focus(agentId: string | null): void {
    if (disposed || scoped?.agentId === agentId) return;
    if (scoped) {
      release(scoped.queue);
      release(scoped.routines);
      release(scoped.messages);
      release(scoped.meta);
      scoped = null;
    }
    if (agentId === null) return;
    const queue = watch(QUEUE_SYNC_COLLECTION, agentId, () => emit({ type: "queue-invalidated", agentId }));
    const routines = watch(ROUTINES_SYNC_COLLECTION, agentId, () => emit({ type: "routines-changed", agentId }));
    const paged = has(CONVERSATION_PAGINATION_CAPABILITY);
    const changed = () => conversationChanged(agentId);
    scoped = {
      agentId,
      queue,
      routines,
      messages: paged ? watchLog(AGENT_MESSAGES_SYNC_LOG, agentId, CONVERSATION_LOG_LIMIT, changed) : null,
      meta: paged ? watch(CONVERSATION_PAGE_META_SYNC_COLLECTION, agentId, changed) : null,
      lastPage: null,
    };
  }

  function focusChannel(channelId: string | null): void {
    if (disposed || !has(CHANNEL_CHATS_CAPABILITY) || channelScope?.channelId === channelId) return;
    if (channelScope) {
      release(channelScope.messages);
      release(channelScope.meta);
      channelScope = null;
    }
    if (channelId === null) return;
    const changed = () => channelChanged(channelId);
    channelScope = {
      channelId,
      messages: watchLog(CHANNEL_MESSAGES_SYNC_LOG, channelId, CHANNEL_LOG_LIMIT, changed),
      meta: watch(CHANNEL_PAGE_META_SYNC_COLLECTION, channelId, changed),
      lastPage: null,
    };
  }

  function ready<Row, Meta>(scope: { messages: WatchedLog<Row> | null; meta: Watched<Meta> | null }): boolean {
    return scope.messages?.handle.status() === "synced" && scope.meta?.handle.status() === "synced";
  }

  async function conversationPage(agentId: string): Promise<ConversationPage | null> {
    const scope = scoped;
    if (disposed || scope?.agentId !== agentId || !ready(scope)) return null;
    await settled("messages", "conversation");
    const log = scope.messages?.handle;
    const meta = snapshot(scope.meta);
    if (scoped !== scope || !log || !meta || !ready(scope)) return null;
    const page = conversationPageFromSync(
      log.rows().map((row) => row.entity),
      meta,
      log.references(),
      { olderCursor: log.olderCursor() },
    );
    if (page) scope.lastPage = page;
    return scope.lastPage;
  }

  async function channelPage(channelId: string): Promise<ChannelPage | null> {
    const scope = channelScope;
    if (disposed || scope?.channelId !== channelId || !ready(scope)) return null;
    await settled("messages", "channel");
    const meta = snapshot(scope.meta);
    if (channelScope !== scope || !meta || !ready(scope)) return null;
    const log = scope.messages.handle;
    const page = channelPageFromSync(
      log.rows().map((row) => row.entity),
      meta,
      { olderCursor: log.olderCursor() },
    );
    if (page) scope.lastPage = page;
    return scope.lastPage;
  }

  focus(options.focusedAgentId);
  focusChannel(options.focusedChannelId);
  client.resubscribe();

  return {
    receive: (message) => client.receive(message),
    pause: () => client.pause(),
    resubscribe: () => client.resubscribe(),
    focus,
    focusChannel,
    wrote(method, path) {
      const scope = writeScope(method, path);
      if (scope) writes[scope] += 1;
    },
    noteOrder,
    hostEvent(event) {
      if (event.type === "agents-changed")
        noteOrder(
          "agents",
          event.agents.map((agent) => agent.id),
        );
      const payload = payloadKey(event);
      if (payload) {
        const [type, key] = payload;
        const last = delivered.get(type);
        delivered.set(type, { key, from: "host" });
        return last?.from !== "sync" || last.key !== key;
      }
      const signal = signalKey(event);
      return signal === null || syncSignals.hostIsNew(signal);
    },
    channels: () => {
      const values = synced(channels);
      return values ? inOrder(values, order.channels) : null;
    },
    agents: () => {
      const values = synced(agents);
      return values ? inOrder(values, order.agents) : null;
    },
    hiddenAgents: () => snapshot(hiddenAgents),
    sidebarPins: () => snapshot(sidebarPins),
    sidebarLayout: () => snapshot(sidebarLayout),
    notificationLevels: () => snapshot(notificationLevels),
    conversationReads() {
      const values = synced(reads);
      if (!values) return null;
      const result: Record<string, ConversationReadState> = {};
      for (const { agentId, ...state } of values) result[agentId] = state;
      return result;
    },
    queue: (agentId) => (scoped?.agentId === agentId ? snapshot(scoped.queue) : null),
    routinesFor(path) {
      if (!scoped || path !== TEAM_API_ROUTES.agent.routines(scoped.agentId)) return null;
      const values = synced(scoped.routines);
      return values ? [...values] : null;
    },
    conversationPage,
    channelPage,
    async workflows() {
      if (disposed || !has(WORKFLOWS_CAPABILITY)) return null;
      if (!workflows) {
        workflows = watch(WORKFLOWS_SYNC_COLLECTION, null, (keys) => {
          for (const workflowId of keys) emit({ type: "workflows-changed", workflowId });
        });
        return null;
      }
      if (workflows.handle.status() !== "synced") return null;
      await settled("workflows", "workflows");
      const values = synced(workflows);
      return values ? [...values] : null;
    },
    async crmCustomers() {
      if (disposed || !has(CRM_CAPABILITY) || !canAdministerServer(options.role)) return null;
      if (!crmCustomers) {
        crmCustomers = watch(CRM_CUSTOMERS_SYNC_COLLECTION, null, () => emit({ type: "crm-changed" }));
        return null;
      }
      if (crmCustomers.handle.status() !== "synced") return null;
      await settled("crm", "crm");
      const values = synced(crmCustomers);
      return values ? [...values] : null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      client.dispose();
    },
  };
}
