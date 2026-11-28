import {
  type AgentNotificationLevelsSnapshot,
  CHANNEL_CHATS_CAPABILITY,
  type ChannelMessage,
  type ChannelPage,
  type ChannelSummary,
  type ClientAgentSummary,
  type ConversationMessage,
  type ConversationPage,
  type ConversationReadState,
  CRM_LIMITS,
  type CrmCustomer,
  type CrmCustomerPage,
  type CrmCustomerPageInput,
  decodeChannelPage,
  decodeChannelSummaries,
  type HiddenAgentsSnapshot,
  type QueueSnapshot,
  type Routine,
  type SidebarLayoutSnapshot,
  type SidebarPinsSnapshot,
  type WorkflowSummary,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_HIDDEN_CAPABILITY, AGENT_HIDDEN_ROUTES } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import {
  AGENT_NOTIFICATION_LEVELS_CAPABILITY,
  AGENT_NOTIFICATION_LEVELS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CRM_CAPABILITY, CRM_ROUTES } from "@openbot/contracts/team-protocol/crm-v1";
import { type TeamCurrentCapability, teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
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
  SYNC_SNAPSHOT_KEY,
  type SyncCollectionSpec,
  type SyncLogSpec,
  WORKFLOWS_SYNC_COLLECTION,
  wireSyncBody,
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
  isSyncName,
  SYNC_CAPABILITY,
  type SyncClientMessage,
  type SyncServerMessage,
  syncName,
} from "@openbot/contracts/team-protocol/sync-v1";
import { TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import { WORKFLOWS_CAPABILITY, WORKFLOWS_ROUTES } from "@openbot/contracts/team-protocol/workflows-v1";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { decodeRemoteCrmCustomerPage } from "@openbot/team-client/crm-decoding";
import { createSyncClient, type SyncClient, type SyncCollection, type SyncLog } from "@openbot/team-client/sync-client";
import { channelPageFromSync, conversationPageFromSync } from "@openbot/team-client/sync-pages";
import { decodeRemoteWorkflowList } from "@openbot/team-client/workflow-decoding";
import { Effect } from "effect";
import {
  decodeAgentNotificationLevelsFromHost,
  decodeAgentSummaries,
  decodeHiddenAgentsFromHost,
  decodeQueueSnapshot,
  decodeRoutines,
  decodeSidebarLayoutSnapshot,
  decodeSidebarPinsFromHost,
} from "./remote-agent-decoding";
import { decodeConversationPageFromHost, decodeConversationReadStates } from "./remote-conversation-decoding";
import { decodeRemoteBody } from "./remote-server-http";
import { addRemotePreviewUrls } from "./remote-server-urls";

const logger = createOpenBotLogger("remote-sync");

const REMOTE_SYNC_SCOPES_PER_SERVER = 8;
export const REMOTE_SYNC_CONVERSATION_ROWS = 50;
const REMOTE_SYNC_CHANNEL_ROWS = 100;

const SYNC_HOST_PROTOCOL = TEAM_PROTOCOL_V10;
const SYNC_HOST_CAPABILITIES = teamCapabilitiesForProtocol(SYNC_HOST_PROTOCOL);

export interface RemoteServerSyncOptions {
  supports(serverId: string, capability: TeamCurrentCapability): boolean;
  send(serverId: string, message: SyncClientMessage): Promise<void>;
  onChanged(serverId: string, name: string): void;
}

export interface ConversationReadRow {
  readonly agentId: string;
  readonly state: ConversationReadState;
}

export function syncedOrRequest<Value, Failure>(
  synced: Value | null,
  request: () => Effect.Effect<Value, Failure>,
): Effect.Effect<Value, Failure> {
  return synced === null ? request() : Effect.succeed(synced);
}

type DesktopSpec<Entity> = (serverId: string) => SyncCollectionSpec<Entity>;

interface RemoteSyncRegistration {
  readonly name: string;
  readonly capability: TeamCurrentCapability;
  open(serverId: string, client: SyncClient, changed: (name: string) => void): void;
  close(serverId: string): void;
}

interface HttpRow {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function decodeAsHttp<Body>(row: HttpRow, decode: (value: unknown) => Body): Body {
  return decodeRemoteBody(row.method, row.path, 200, row.body, SYNC_HOST_PROTOCOL, SYNC_HOST_CAPABILITIES, decode);
}

function withRemotePreviewUrls<Entity>(spec: SyncCollectionSpec<Entity>, serverId: string): SyncCollectionSpec<Entity> {
  return { ...spec, decode: (row) => addRemotePreviewUrls(spec.decode(row), serverId) };
}

function single<Entity>(list: readonly Entity[]): Entity {
  const [entity, ...rest] = list;
  if (entity === undefined || rest.length > 0) throw new Error("Invalid sync row.");
  return entity;
}

function listSpec<Entity>(
  base: { readonly name: string; readonly scoped?: boolean },
  key: (entity: Entity) => string,
  read: (row: unknown) => Entity,
  compare?: (left: Entity, right: Entity) => number,
): SyncCollectionSpec<Entity> {
  return {
    name: base.name,
    ...(base.scoped ? { scoped: true } : {}),
    key,
    decode: read,
    ...(compare ? { compare } : {}),
  };
}

function snapshotSpec<Entity>(base: { readonly name: string }, read: (row: unknown) => Entity) {
  return listSpec(base, () => SYNC_SNAPSHOT_KEY, read);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function newestFirst(left: { updatedAt: string; id: string }, right: { updatedAt: string; id: string }): number {
  return compareText(right.updatedAt, left.updatedAt) || compareText(left.id, right.id);
}

class PrependedOrder {
  readonly #keys = new Map<string, readonly string[]>();

  arrange<Entity>(serverId: string, values: readonly Entity[], key: (entity: Entity) => string): Entity[] {
    const keys = values.map(key);
    const known = this.#keys.get(serverId);
    const present = new Set(keys);
    const knownSet = new Set(known ?? []);
    const next = known
      ? [...keys.filter((candidate) => !knownSet.has(candidate)).reverse(), ...known.filter((k) => present.has(k))]
      : keys;
    this.#keys.set(serverId, next);
    const byKey = new Map(values.map((entity) => [key(entity), entity]));
    return next.flatMap((candidate) => {
      const entity = byKey.get(candidate);
      return entity === undefined ? [] : [entity];
    });
  }

  forget(serverId: string): void {
    this.#keys.delete(serverId);
  }
}

class RemoteSyncedList<Entity> implements RemoteSyncRegistration {
  readonly name: string;
  readonly capability: TeamCurrentCapability;
  readonly #spec: DesktopSpec<Entity>;
  readonly #order: PrependedOrder | null;
  readonly #handles = new Map<string, SyncCollection<Entity>>();
  readonly #listeners = new Set<(serverId: string, values: readonly Entity[]) => void>();

  constructor(
    name: string,
    capability: TeamCurrentCapability,
    spec: DesktopSpec<Entity>,
    order: PrependedOrder | null = null,
  ) {
    this.name = name;
    this.capability = capability;
    this.#spec = spec;
    this.#order = order;
  }

  open(serverId: string, client: SyncClient, changed: (name: string) => void): void {
    const spec = this.#spec(serverId);
    const handle = client.collection(withRemotePreviewUrls(spec, serverId));
    handle.subscribe(() => {
      const status = handle.status();
      if (status === "unavailable") this.#order?.forget(serverId);
      if (status !== "synced") return;
      const values = this.#arrange(serverId, handle, spec);
      for (const listener of this.#listeners) listener(serverId, values);
      changed(handle.name);
    });
    this.#handles.set(serverId, handle);
  }

  close(serverId: string): void {
    this.#handles.delete(serverId);
    this.#order?.forget(serverId);
  }

  onSynced(listener: (serverId: string, values: readonly Entity[]) => void): void {
    this.#listeners.add(listener);
  }

  values(serverId: string): Entity[] | null {
    const handle = this.#handles.get(serverId);
    if (handle?.status() !== "synced") return null;
    return this.#arrange(serverId, handle, this.#spec(serverId));
  }

  value(serverId: string): Entity | null {
    return this.values(serverId)?.[0] ?? null;
  }

  #arrange(serverId: string, handle: SyncCollection<Entity>, spec: SyncCollectionSpec<Entity>): Entity[] {
    return this.#order ? this.#order.arrange(serverId, handle.values(), spec.key) : [...handle.values()];
  }
}

interface ScopedServer<Entity> {
  readonly client: SyncClient;
  readonly changed: (name: string) => void;
  readonly handles: Map<string, SyncCollection<Entity>>;
}

class RemoteSyncedScopes<Entity> implements RemoteSyncRegistration {
  readonly name: string;
  readonly capability: TeamCurrentCapability;
  readonly #spec: (serverId: string, param: string) => SyncCollectionSpec<Entity>;
  readonly #servers = new Map<string, ScopedServer<Entity>>();
  readonly #listeners = new Set<(serverId: string, param: string, values: readonly Entity[]) => void>();

  constructor(
    name: string,
    capability: TeamCurrentCapability,
    spec: (serverId: string, param: string) => SyncCollectionSpec<Entity>,
  ) {
    this.name = name;
    this.capability = capability;
    this.#spec = spec;
  }

  open(serverId: string, client: SyncClient, changed: (name: string) => void): void {
    this.#servers.set(serverId, { client, changed, handles: new Map() });
  }

  close(serverId: string): void {
    this.#servers.delete(serverId);
  }

  values(serverId: string, param: string): Entity[] | null {
    const server = this.#servers.get(serverId);
    if (!server || !isSyncName(`${this.name}:${param}`)) return null;
    const handle = server.handles.get(param) ?? this.#subscribe(serverId, server, param);
    server.handles.delete(param);
    server.handles.set(param, handle);
    for (const [oldest] of server.handles) {
      if (server.handles.size <= REMOTE_SYNC_SCOPES_PER_SERVER) break;
      this.#release(server, oldest);
    }
    return handle.status() === "synced" ? [...handle.values()] : null;
  }

  value(serverId: string, param: string): Entity | null {
    return this.values(serverId, param)?.[0] ?? null;
  }

  isSynced(serverId: string, param: string): boolean {
    return this.#servers.get(serverId)?.handles.get(param)?.status() === "synced";
  }

  onSynced(listener: (serverId: string, param: string, values: readonly Entity[]) => void): void {
    this.#listeners.add(listener);
  }

  retain(serverId: string, params: ReadonlySet<string>): void {
    const server = this.#servers.get(serverId);
    if (!server) return;
    for (const param of [...server.handles.keys()]) if (!params.has(param)) this.#release(server, param);
  }

  #subscribe(serverId: string, server: ScopedServer<Entity>, param: string): SyncCollection<Entity> {
    const handle = server.client.collection(withRemotePreviewUrls(this.#spec(serverId, param), serverId), param);
    handle.subscribe(() => {
      if (handle.status() !== "synced") return;
      for (const listener of this.#listeners) listener(serverId, param, handle.values());
      server.changed(handle.name);
    });
    return handle;
  }

  #release(server: ScopedServer<Entity>, param: string): void {
    server.handles.delete(param);
    server.client.release(syncName(this.name, param));
  }
}

interface RemoteSyncedPagesOptions<Row, Meta, Page> {
  readonly log: SyncLogSpec<Row>;
  readonly meta: SyncCollectionSpec<Meta>;
  readonly rows: number;
  build(param: string, log: SyncLog<Row>, meta: Meta): Page | null;
}

interface PageScope<Page> {
  page: Page | null;
  synced(): boolean;
}

interface PagedServer<Page> {
  readonly client: SyncClient;
  readonly changed: (name: string) => void;
  readonly scopes: Map<string, PageScope<Page>>;
}

function logEntities<Row>(log: SyncLog<Row>): Row[] {
  return log.rows().map((row) => row.entity);
}

class RemoteSyncedPages<Row, Meta, Page> implements RemoteSyncRegistration {
  readonly name: string;
  readonly capability: TeamCurrentCapability;
  readonly #options: RemoteSyncedPagesOptions<Row, Meta, Page>;
  readonly #servers = new Map<string, PagedServer<Page>>();
  readonly #listeners = new Set<(serverId: string, param: string, page: Page) => void>();

  constructor(capability: TeamCurrentCapability, options: RemoteSyncedPagesOptions<Row, Meta, Page>) {
    this.name = options.log.name;
    this.capability = capability;
    this.#options = options;
  }

  open(serverId: string, client: SyncClient, changed: (name: string) => void): void {
    this.#servers.set(serverId, { client, changed, scopes: new Map() });
  }

  close(serverId: string): void {
    this.#servers.delete(serverId);
  }

  latest(serverId: string, param: string): Page | null {
    const server = this.#servers.get(serverId);
    if (!server || !isSyncName(`${this.name}:${param}`) || !isSyncName(`${this.#options.meta.name}:${param}`))
      return null;
    const scope = server.scopes.get(param) ?? this.#subscribe(serverId, server, param);
    server.scopes.delete(param);
    server.scopes.set(param, scope);
    for (const [oldest] of server.scopes) {
      if (server.scopes.size <= REMOTE_SYNC_SCOPES_PER_SERVER) break;
      this.#release(server, oldest);
    }
    return scope.synced() ? scope.page : null;
  }

  isSynced(serverId: string, param: string): boolean {
    const scope = this.#servers.get(serverId)?.scopes.get(param);
    return scope?.synced() === true && scope.page !== null;
  }

  onPage(listener: (serverId: string, param: string, page: Page) => void): void {
    this.#listeners.add(listener);
  }

  retain(serverId: string, params: ReadonlySet<string>): void {
    const server = this.#servers.get(serverId);
    if (!server) return;
    for (const param of [...server.scopes.keys()]) if (!params.has(param)) this.#release(server, param);
  }

  #subscribe(serverId: string, server: PagedServer<Page>, param: string): PageScope<Page> {
    const log = server.client.log(this.#options.log, param, { limit: this.#options.rows });
    const meta = server.client.collection(this.#options.meta, param);
    const scope: PageScope<Page> = {
      page: null,
      synced: () => log.status() === "synced" && meta.status() === "synced",
    };
    const rebuild = (name: string) => () => {
      const snapshot = scope.synced() ? meta.get(SYNC_SNAPSHOT_KEY) : undefined;
      if (snapshot === undefined) {
        scope.page = null;
        return;
      }
      const page = this.#build(serverId, param, log, snapshot);
      if (page === null) return;
      scope.page = page;
      for (const listener of this.#listeners) listener(serverId, param, page);
      server.changed(name);
    };
    log.subscribe(rebuild(log.name));
    meta.subscribe(rebuild(meta.name));
    return scope;
  }

  #build(serverId: string, param: string, log: SyncLog<Row>, meta: Meta): Page | null {
    try {
      return addRemotePreviewUrls(this.#options.build(param, log, meta), serverId);
    } catch (error) {
      logger.warn("Remote sync could not rebuild a page:", toLogValue(error));
      return null;
    }
  }

  #release(server: PagedServer<Page>, param: string): void {
    server.scopes.delete(param);
    server.client.release(syncName(this.name, param));
    server.client.release(syncName(this.#options.meta.name, param));
  }
}

interface WireChannelPageMeta {
  readonly wire: DynamicRecord;
  readonly meta: ChannelPageMeta;
}

interface ServerSync {
  readonly client: SyncClient;
  readonly names: string;
  online: boolean;
}

export class RemoteServerSync {
  readonly #options: RemoteServerSyncOptions;
  readonly #servers = new Map<string, ServerSync>();
  readonly #registrations: RemoteSyncRegistration[] = [];

  readonly channels = this.#list(
    new RemoteSyncedList<ChannelSummary>(CHANNELS_SYNC_COLLECTION.name, CHANNEL_CHATS_CAPABILITY, () =>
      listSpec(
        CHANNELS_SYNC_COLLECTION,
        (channel) => channel.id,
        (row) =>
          single(decodeAsHttp({ method: "GET", path: CHANNEL_ROUTES.list, body: [row] }, decodeChannelSummaries)),
      ),
    ),
  );

  readonly agents = this.#list(
    new RemoteSyncedList<ClientAgentSummary>(
      AGENTS_SYNC_COLLECTION.name,
      SYNC_CAPABILITY,
      () =>
        listSpec(
          AGENTS_SYNC_COLLECTION,
          (agent) => agent.id,
          (row) =>
            single(
              decodeAsHttp({ method: "GET", path: TEAM_API_ROUTES.agents.all, body: [row] }, decodeAgentSummaries),
            ),
        ),
      new PrependedOrder(),
    ),
  );

  readonly hiddenAgents = this.#list(
    new RemoteSyncedList<HiddenAgentsSnapshot>(HIDDEN_AGENTS_SYNC_COLLECTION.name, AGENT_HIDDEN_CAPABILITY, () =>
      snapshotSpec(HIDDEN_AGENTS_SYNC_COLLECTION, (row) =>
        decodeAsHttp({ method: "POST", path: AGENT_HIDDEN_ROUTES.read, body: row }, decodeHiddenAgentsFromHost),
      ),
    ),
  );

  readonly sidebarPins = this.#list(
    new RemoteSyncedList<SidebarPinsSnapshot>(SIDEBAR_PINS_SYNC_COLLECTION.name, SIDEBAR_PINS_CAPABILITY, () =>
      snapshotSpec(SIDEBAR_PINS_SYNC_COLLECTION, (row) =>
        decodeAsHttp({ method: "POST", path: SIDEBAR_PINS_ROUTES.read, body: row }, decodeSidebarPinsFromHost),
      ),
    ),
  );

  readonly sidebarLayout = this.#list(
    new RemoteSyncedList<SidebarLayoutSnapshot>(SIDEBAR_LAYOUT_SYNC_COLLECTION.name, SYNC_CAPABILITY, (serverId) => {
      const folders = this.#options.supports(serverId, SIDEBAR_FOLDERS_CAPABILITY);
      return snapshotSpec(SIDEBAR_LAYOUT_SYNC_COLLECTION, (row) =>
        decodeAsHttp(
          folders
            ? { method: "POST", path: SIDEBAR_FOLDERS_ROUTES.read, body: row }
            : { method: "GET", path: TEAM_API_ROUTES.sidebarLayout.state, body: row },
          decodeSidebarLayoutSnapshot,
        ),
      );
    }),
  );

  readonly notificationLevels = this.#list(
    new RemoteSyncedList<AgentNotificationLevelsSnapshot>(
      NOTIFICATION_LEVELS_SYNC_COLLECTION.name,
      AGENT_NOTIFICATION_LEVELS_CAPABILITY,
      () =>
        snapshotSpec(NOTIFICATION_LEVELS_SYNC_COLLECTION, (row) =>
          decodeAsHttp(
            { method: "POST", path: AGENT_NOTIFICATION_LEVELS_ROUTES.read, body: row },
            decodeAgentNotificationLevelsFromHost,
          ),
        ),
    ),
  );

  readonly conversationReads = this.#list(
    new RemoteSyncedList<ConversationReadRow>(CONVERSATION_READS_SYNC_COLLECTION.name, SYNC_CAPABILITY, () =>
      listSpec(
        CONVERSATION_READS_SYNC_COLLECTION,
        (entry) => entry.agentId,
        (row) => {
          if (!isDynamicRecord(row) || typeof row.agentId !== "string") throw new Error("Invalid sync row.");
          const { agentId, ...state } = row;
          const reads = decodeAsHttp(
            { method: "GET", path: TEAM_API_ROUTES.agents.conversationReads, body: { [agentId]: state } },
            decodeConversationReadStates,
          );
          const decoded = reads[agentId];
          if (!decoded || Object.keys(reads).length !== 1) throw new Error("Invalid sync row.");
          return { agentId, state: decoded };
        },
      ),
    ),
  );

  readonly routines = this.#list(
    new RemoteSyncedScopes<Routine>(ROUTINES_SYNC_COLLECTION.name, SYNC_CAPABILITY, (_serverId, agentId) =>
      listSpec<Routine>(
        ROUTINES_SYNC_COLLECTION,
        (routine) => routine.id,
        (row) =>
          single(
            decodeAsHttp({ method: "GET", path: TEAM_API_ROUTES.agent.routines(agentId), body: [row] }, decodeRoutines),
          ),
        newestFirst,
      ),
    ),
  );

  readonly workflows = this.#list(
    new RemoteSyncedList<WorkflowSummary>(WORKFLOWS_SYNC_COLLECTION.name, WORKFLOWS_CAPABILITY, () =>
      listSpec<WorkflowSummary>(
        WORKFLOWS_SYNC_COLLECTION,
        (workflow) => workflow.id,
        (row) =>
          single(
            decodeAsHttp(
              { method: "POST", path: WORKFLOWS_ROUTES.list, body: { workflows: [row] } },
              decodeRemoteWorkflowList,
            ),
          ),
        newestFirst,
      ),
    ),
  );

  readonly crmCustomers = this.#list(
    new RemoteSyncedList<CrmCustomer>(CRM_CUSTOMERS_SYNC_COLLECTION.name, CRM_CAPABILITY, () =>
      listSpec(
        CRM_CUSTOMERS_SYNC_COLLECTION,
        (customer) => customer.id,
        (row) =>
          single(
            decodeAsHttp(
              { method: "POST", path: CRM_ROUTES.customers, body: { customers: [row], next: null } },
              decodeRemoteCrmCustomerPage,
            ).customers,
          ),
        (left, right) => left.number - right.number,
      ),
    ),
  );

  readonly queues = this.#list(
    new RemoteSyncedScopes<QueueSnapshot>(QUEUE_SYNC_COLLECTION.name, SYNC_CAPABILITY, (_serverId, agentId) =>
      snapshotSpec(QUEUE_SYNC_COLLECTION, (row) =>
        decodeAsHttp({ method: "GET", path: TEAM_API_ROUTES.agent.queue(agentId), body: row }, decodeQueueSnapshot),
      ),
    ),
  );

  readonly agentPages = this.#list(
    new RemoteSyncedPages<ConversationMessage, ConversationPageMeta, ConversationPage>(SYNC_CAPABILITY, {
      log: AGENT_MESSAGES_SYNC_LOG,
      meta: CONVERSATION_PAGE_META_SYNC_COLLECTION,
      rows: REMOTE_SYNC_CONVERSATION_ROWS,
      build: (agentId, log, meta) => {
        const page = conversationPageFromSync(logEntities(log), meta, log.references(), {
          olderCursor: log.olderCursor(),
        });
        if (!page) return null;
        const path = TEAM_API_ROUTES.agent.conversationPage(agentId);
        return decodeAsHttp({ method: "GET", path, body: wireSyncBody(path, page) }, decodeConversationPageFromHost);
      },
    }),
  );

  readonly channelPages = this.#list(
    new RemoteSyncedPages<ChannelMessage, WireChannelPageMeta, ChannelPage>(CHANNEL_CHATS_CAPABILITY, {
      log: CHANNEL_MESSAGES_SYNC_LOG,
      meta: snapshotSpec(CHANNEL_PAGE_META_SYNC_COLLECTION, (row) => {
        const meta = CHANNEL_PAGE_META_SYNC_COLLECTION.decode(row);
        if (!isDynamicRecord(row)) throw new Error("Invalid sync row.");
        return { wire: row, meta };
      }),
      rows: REMOTE_SYNC_CHANNEL_ROWS,
      build: (_channelId, log, { wire, meta }) => {
        const page = channelPageFromSync(logEntities(log), meta, { olderCursor: log.olderCursor() });
        if (!page) return null;
        return decodeAsHttp(
          { method: "POST", path: CHANNEL_ROUTES.read, body: { ...wire, messages: page.messages } },
          decodeChannelPage,
        );
      },
    }),
  );

  constructor(options: RemoteServerSyncOptions) {
    this.#options = options;
    this.agents.onSynced((serverId, agents) => {
      const agentIds = new Set(agents.map((agent) => agent.id));
      this.routines.retain(serverId, agentIds);
      this.queues.retain(serverId, agentIds);
      this.agentPages.retain(serverId, agentIds);
    });
    this.channels.onSynced((serverId, channels) => {
      this.channelPages.retain(serverId, new Set(channels.map((channel) => channel.id)));
    });
  }

  latestConversationPage(
    serverId: string,
    agentId: string,
    limit = REMOTE_SYNC_CONVERSATION_ROWS,
  ): ConversationPage | null {
    if (limit < REMOTE_SYNC_CONVERSATION_ROWS) return null;
    const page = this.agentPages.latest(serverId, agentId);
    return page && (page.messages.length >= limit || !page.pageInfo.hasOlder) ? page : null;
  }

  conversationReadRecord(serverId: string): Record<string, ConversationReadState> | null {
    const rows = this.conversationReads.values(serverId);
    return rows && Object.fromEntries(rows.map((row) => [row.agentId, row.state]));
  }

  crmCustomerPage(serverId: string, input: CrmCustomerPageInput): CrmCustomerPage | null {
    const all = this.crmCustomers.values(serverId);
    if (!all) return null;
    const after = input.after ?? 0;
    const rows = all.filter((customer) => customer.number > after).slice(0, CRM_LIMITS.page + 1);
    const customers = rows.slice(0, CRM_LIMITS.page);
    return { customers, next: rows.length > CRM_LIMITS.page ? (customers.at(-1)?.number ?? null) : null };
  }

  online(serverId: string): void {
    const enabled = this.#options.supports(serverId, SYNC_CAPABILITY)
      ? this.#registrations.filter((registration) => this.#options.supports(serverId, registration.capability))
      : [];
    const names = [
      ...enabled.map((registration) => registration.name),
      String(this.#options.supports(serverId, SIDEBAR_FOLDERS_CAPABILITY)),
    ].join("\n");
    const current = this.#servers.get(serverId);
    if (current && current.names !== names) this.forget(serverId);
    if (enabled.length === 0) return;
    const entry = this.#servers.get(serverId) ?? this.#open(serverId, enabled, names);
    entry.online = true;
    entry.client.resubscribe();
  }

  offline(serverId: string): void {
    const entry = this.#servers.get(serverId);
    if (!entry) return;
    entry.online = false;
    entry.client.pause();
  }

  reset(serverId: string): void {
    const entry = this.#servers.get(serverId);
    if (entry?.online) entry.client.resubscribe();
  }

  receive(serverId: string, message: SyncServerMessage): void {
    this.#servers.get(serverId)?.client.receive(message);
  }

  forget(serverId: string): void {
    const entry = this.#servers.get(serverId);
    if (!entry) return;
    this.#servers.delete(serverId);
    for (const registration of this.#registrations) registration.close(serverId);
    entry.client.dispose();
  }

  stop(): void {
    for (const serverId of [...this.#servers.keys()]) this.forget(serverId);
  }

  #list<Registration extends RemoteSyncRegistration>(registration: Registration): Registration {
    this.#registrations.push(registration);
    return registration;
  }

  #open(serverId: string, enabled: readonly RemoteSyncRegistration[], names: string): ServerSync {
    const client = createSyncClient({
      send: (message) => this.#options.send(serverId, message),
      onError: (error) => logger.warn("Remote sync stopped for a collection:", toLogValue(error)),
    });
    for (const registration of enabled)
      registration.open(serverId, client, (name) => this.#options.onChanged(serverId, name));
    const entry: ServerSync = { client, names, online: false };
    this.#servers.set(serverId, entry);
    return entry;
  }
}
