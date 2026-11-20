import {
  type AgentColors,
  type AgentEvent,
  type AgentRuntimeSnapshot,
  type AgentStatus,
  type AvatarColor,
  type BrowserTab,
  type ChatColors,
  type ClientAgentSummary,
  decodeProviderModelSources,
  type ProviderModelSourceEntry,
  type TeamMemberSummary,
  withModelSources,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_USAGE_LIMIT_ROUTES, type AgentUsageLimits } from "@openbot/contracts/team-protocol/agent-usage-limit-v1";
import { PROVIDER_MODEL_SOURCE_ROUTES } from "@openbot/contracts/team-protocol/provider-model-source-v1";
import { Deferred, Effect, Result } from "effect";
import { decodeAgentSummaries, decodeQueueSnapshot, decodeRemoteAgentUsageLimits } from "./remote-agent-decoding";
import { decodeConversationPageFromHost } from "./remote-conversation-decoding";
import type { RemoteRequestFn } from "./remote-server-client";
import { addRemotePreviewUrls, pageQuery } from "./remote-server-urls";
import type { RemoteWorkflowError } from "./remote-service-effects";

interface ConversationRefresh {
  revision: number;
  sequence: number;
}

interface QueueRefresh {
  dirty: boolean;
}

const FALLBACK_CONVERSATION_LIMIT = 1;
const INVALIDATED_CONVERSATION_LIMIT = 50;

export interface RemoteEventRefreshOptions {
  request: RemoteRequestFn;
  hasServer: (serverId: string) => boolean;
  emit: (serverId: string, event: AgentEvent, bufferedLive?: boolean) => void;
  onReceivedRuntimeSnapshot?: (serverId: string, snapshot: AgentRuntimeSnapshot) => void;
  onMemberChatColors?: (serverId: string) => void;
  hasUsageLimits?: (serverId: string) => boolean;
  hasModelSources?: (serverId: string) => boolean;
}

export class RemoteEventRefresh {
  readonly #request: RemoteRequestFn;
  readonly #hasServer: (serverId: string) => boolean;
  readonly #emit: (serverId: string, event: AgentEvent, bufferedLive?: boolean) => void;
  readonly #onReceivedRuntimeSnapshot: (serverId: string, snapshot: AgentRuntimeSnapshot) => void;
  readonly #onMemberChatColors: (serverId: string) => void;
  readonly #hasUsageLimits: (serverId: string) => boolean;
  readonly #hasModelSources: (serverId: string) => boolean;
  readonly #conversations = new Map<string, ConversationRefresh>();
  readonly #queues = new Map<string, QueueRefresh>();
  readonly #generations = new Map<string, number>();
  readonly #rosterLoads = new Map<string, Deferred.Deferred<void, RemoteWorkflowError>>();
  readonly #browserHolds = new Map<string, ReadonlySet<string>>();
  readonly #browserPageStates = new Map<string, ReadonlyMap<string, { canGoBack: boolean; canGoForward: boolean }>>();
  readonly #browserStates = new Map<string, { tabs: BrowserTab[]; activeTabId: string | null }>();
  readonly #agentColors = new Map<string, ReadonlyMap<string, AvatarColor>>();
  readonly #agentRosters = new Map<string, ClientAgentSummary[]>();
  readonly #agentChatColors = new Map<string, ReadonlyMap<string, AvatarColor>>();
  readonly #memberChatColors = new Map<string, ReadonlyMap<string, AvatarColor>>();
  readonly #runtimeSnapshots = new Map<string, AgentRuntimeSnapshot>();
  readonly #usageLimits = new Map<string, AgentUsageLimits>();
  readonly #usageLimitReads = new Map<string, QueueRefresh>();
  readonly #statuses = new Map<string, AgentStatus>();
  readonly #modelSources = new Map<string, ProviderModelSourceEntry[]>();
  readonly #modelSourceReads = new Map<string, QueueRefresh>();

  constructor(options: RemoteEventRefreshOptions) {
    this.#request = options.request;
    this.#hasServer = options.hasServer;
    this.#emit = options.emit;
    this.#onReceivedRuntimeSnapshot = options.onReceivedRuntimeSnapshot ?? (() => undefined);
    this.#onMemberChatColors = options.onMemberChatColors ?? (() => undefined);
    this.#hasUsageLimits = options.hasUsageLimits ?? (() => false);
    this.#hasModelSources = options.hasModelSources ?? (() => false);
  }

  readonly forward = Effect.fn("RemoteEvents.forward")(function* (
    this: RemoteEventRefresh,
    serverId: string,
    event: AgentEvent,
    bufferedLive = false,
  ) {
    this.#advance(serverId);
    if (event.type === "runtime-snapshot") this.#onReceivedRuntimeSnapshot(serverId, event.snapshot);
    if (event.type === "agents-changed") this.#rosterLoads.delete(serverId);
    if (event.type === "conversation-invalidated") {
      yield* this.#refreshConversationPage(serverId, event.agentId, event.revision);
    } else if (event.type === "queue-invalidated") {
      yield* this.#refreshQueue(serverId, event.agentId);
    } else if (event.type === "agent-colors-changed") {
      this.rememberAgentColors(serverId, event);
    } else if (event.type === "chat-colors-changed") {
      this.rememberChatColors(serverId, event);
    } else if (event.type === "agents-changed") {
      this.#emitRoster(serverId, addRemotePreviewUrls(event.agents, serverId), bufferedLive);
    } else if (event.type === "browser-user-control-changed" || event.type === "browser-page-state-changed") {
      if (event.type === "browser-user-control-changed") this.#browserHolds.set(serverId, new Set(event.tabIds));
      else this.#browserPageStates.set(serverId, new Map(event.tabs.map(({ tabId, ...state }) => [tabId, state])));
      this.#emit(serverId, event);
      const state = this.#browserStates.get(serverId);
      if (state) this.#emit(serverId, addRemotePreviewUrls(this.#withBrowserHolds(serverId, state), serverId));
    } else if (event.type === "status" && this.#hasModelSources(serverId)) {
      this.#statuses.set(serverId, event.status);
      this.#emitStatus(serverId, bufferedLive);
      yield* this.#refreshModelSources(serverId);
    } else if (event.type === "runtime-snapshot" && this.#hasUsageLimits(serverId)) {
      this.#runtimeSnapshots.set(serverId, event.snapshot);
      this.#emitRuntimeSnapshot(serverId, bufferedLive);
      yield* this.#refreshUsageLimits(serverId);
    } else {
      if (event.type === "browser-changed")
        this.#browserStates.set(serverId, { tabs: event.tabs, activeTabId: event.activeTabId });
      const remoteEvent = addRemotePreviewUrls(
        event.type === "browser-changed" ? this.#withBrowserHolds(serverId, event) : event,
        serverId,
      );
      if (bufferedLive) this.#emit(serverId, remoteEvent, true);
      else this.#emit(serverId, remoteEvent);
    }
  }).bind(this);

  #withBrowserHolds(
    serverId: string,
    state: { tabs: BrowserTab[]; activeTabId: string | null },
  ): Extract<AgentEvent, { type: "browser-changed" }> {
    const held = this.#browserHolds.get(serverId);
    const pageStates = this.#browserPageStates.get(serverId);
    const tabs = state.tabs.map((tab) => {
      const { userControl: _, canGoBack: _back, canGoForward: _forward, ...rest } = tab;
      const pageState = pageStates?.get(tab.id);
      return {
        ...rest,
        ...(held?.has(tab.id) ? { userControl: true as const } : {}),
        ...(pageState ? { canGoBack: pageState.canGoBack, canGoForward: pageState.canGoForward } : {}),
      };
    });
    return { type: "browser-changed", tabs, activeTabId: state.activeTabId };
  }

  readonly refreshAgentState = Effect.fn("RemoteEvents.refreshAgentState")(function* (
    this: RemoteEventRefresh,
    serverId: string,
  ) {
    const generation = this.#advance(serverId);
    const request = { request: this.#request };
    const agents = yield* request.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries);
    if (this.#generations.get(serverId) !== generation) return;
    this.#emitRoster(serverId, agents);
    yield* Effect.forEach(
      agents,
      (agent) =>
        Effect.gen({ self: this }, function* () {
          const [page, queue] = yield* Effect.all(
            [
              this.#conversationPageEffect(serverId, agent.id, FALLBACK_CONVERSATION_LIMIT),
              request.request(serverId, TEAM_API_ROUTES.agent.queue(agent.id), decodeQueueSnapshot),
            ],
            { concurrency: "unbounded" },
          );
          if (this.#generations.get(serverId) !== generation) return;
          const { pageInfo: _, references: __, readState: ___, ...snapshot } = page;
          this.#emit(serverId, { type: "conversation", snapshot });
          this.#emit(serverId, { type: "queue-changed", snapshot: queue });
        }).pipe(Effect.catch(() => Effect.void)),
      { concurrency: "unbounded", discard: true },
    );
  }).bind(this);

  readonly refreshAgentRoster = Effect.fn("RemoteEvents.refreshAgentRoster")(function* (
    this: RemoteEventRefresh,
    serverId: string,
  ) {
    const pending = this.#rosterLoads.get(serverId);
    if (pending) return yield* Deferred.await(pending);
    const operation = Deferred.makeUnsafe<void, RemoteWorkflowError>();
    this.#rosterLoads.set(serverId, operation);
    yield* Effect.gen({ self: this }, function* () {
      const agents = yield* this.#request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries);
      if (this.#rosterLoads.get(serverId) !== operation || !this.#hasServer(serverId)) return;
      this.#emitRoster(serverId, agents);
    }).pipe(
      Effect.onExit((exit) => Deferred.done(operation, exit)),
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#rosterLoads.get(serverId) === operation) this.#rosterLoads.delete(serverId);
        }),
      ),
    );
  }).bind(this);

  withAgentColors(serverId: string, agents: ClientAgentSummary[]): ClientAgentSummary[] {
    if (!this.#agentColors.has(serverId) && !this.#agentChatColors.has(serverId)) return agents;
    return agents.map((agent) => this.agentWithColor(serverId, agent));
  }

  agentWithColor(serverId: string, agent: ClientAgentSummary): ClientAgentSummary {
    const colors = this.#agentColors.get(serverId);
    const chatColors = this.#agentChatColors.get(serverId);
    const colored = colors ? withAgentColor(agent, colors.get(agent.id)) : agent;
    return chatColors ? withChatColor(colored, chatColors.get(agent.id)) : colored;
  }

  withMemberChatColors<Member extends TeamMemberSummary>(serverId: string, members: Member[]): Member[] {
    const chatColors = this.#memberChatColors.get(serverId);
    return chatColors ? members.map((member) => withChatColor(member, chatColors.get(member.id))) : members;
  }

  rememberChatColors(serverId: string, colors: ChatColors): void {
    const agents = new Map(colors.agents.map((entry) => [entry.agentId, entry.color]));
    const members = new Map(colors.members.map((entry) => [entry.memberId, entry.color]));
    const agentsChanged = !sameColors(this.#agentChatColors.get(serverId), agents);
    const membersChanged = !sameColors(this.#memberChatColors.get(serverId), members);
    this.#agentChatColors.set(serverId, agents);
    this.#memberChatColors.set(serverId, members);
    const roster = this.#agentRosters.get(serverId);
    if (agentsChanged && roster)
      this.#emit(serverId, { type: "agents-changed", agents: this.withAgentColors(serverId, roster) });
    if (membersChanged) this.#onMemberChatColors(serverId);
  }

  rememberAgentColors(serverId: string, colors: AgentColors): void {
    const next = new Map(colors.agents.map((entry) => [entry.agentId, entry.color]));
    const previous = this.#agentColors.get(serverId);
    this.#agentColors.set(serverId, next);
    if (sameColors(previous, next)) return;
    const roster = this.#agentRosters.get(serverId);
    if (roster) this.#emit(serverId, { type: "agents-changed", agents: this.withAgentColors(serverId, roster) });
  }

  #emitRuntimeSnapshot(serverId: string, bufferedLive = false): void {
    const snapshot = this.#runtimeSnapshots.get(serverId);
    if (!snapshot) return;
    const limits = this.#usageLimits.get(serverId);
    const event = addRemotePreviewUrls(
      { type: "runtime-snapshot" as const, snapshot: limits ? { ...snapshot, ...limits } : snapshot },
      serverId,
    );
    if (bufferedLive) this.#emit(serverId, event, true);
    else this.#emit(serverId, event);
  }

  #emitStatus(serverId: string, bufferedLive = false): void {
    const status = this.#statuses.get(serverId);
    if (!status) return;
    const event = { type: "status" as const, status: withModelSources(status, this.#modelSources.get(serverId) ?? []) };
    if (bufferedLive) this.#emit(serverId, event, true);
    else this.#emit(serverId, event);
  }

  readonly #refreshModelSources = Effect.fn("RemoteEvents.refreshModelSources")(function* (
    this: RemoteEventRefresh,
    serverId: string,
  ) {
    const pending = this.#modelSourceReads.get(serverId);
    if (pending) {
      pending.dirty = true;
      return;
    }
    const read = { dirty: false };
    this.#modelSourceReads.set(serverId, read);
    yield* Effect.gen({ self: this }, function* () {
      do {
        read.dirty = false;
        const result = yield* this.#request(serverId, PROVIDER_MODEL_SOURCE_ROUTES.list, decodeProviderModelSources, {
          method: "POST",
          body: {},
        }).pipe(Effect.result);
        if (Result.isFailure(result)) {
          if (read.dirty) continue;
          return;
        }
        if (!this.#hasServer(serverId)) return;
        const previous = this.#modelSources.get(serverId);
        this.#modelSources.set(serverId, result.success);
        if (JSON.stringify(previous ?? []) !== JSON.stringify(result.success)) this.#emitStatus(serverId);
      } while (read.dirty);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#modelSourceReads.get(serverId) === read) this.#modelSourceReads.delete(serverId);
        }),
      ),
    );
  });

  readonly #refreshUsageLimits = Effect.fn("RemoteEvents.refreshUsageLimits")(function* (
    this: RemoteEventRefresh,
    serverId: string,
  ) {
    const pending = this.#usageLimitReads.get(serverId);
    if (pending) {
      pending.dirty = true;
      return;
    }
    const read = { dirty: false };
    this.#usageLimitReads.set(serverId, read);
    yield* Effect.gen({ self: this }, function* () {
      do {
        read.dirty = false;
        const result = yield* this.#request(serverId, AGENT_USAGE_LIMIT_ROUTES.list, decodeRemoteAgentUsageLimits, {
          method: "POST",
          body: {},
        }).pipe(Effect.result);
        if (Result.isFailure(result)) {
          if (read.dirty) continue;
          return;
        }
        if (!this.#hasServer(serverId)) return;
        const previous = this.#usageLimits.get(serverId);
        this.#usageLimits.set(serverId, result.success);
        if (JSON.stringify(previous) !== JSON.stringify(result.success)) this.#emitRuntimeSnapshot(serverId);
      } while (read.dirty);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#usageLimitReads.get(serverId) === read) this.#usageLimitReads.delete(serverId);
        }),
      ),
    );
  });

  #emitRoster(serverId: string, agents: ClientAgentSummary[], bufferedLive = false): void {
    this.#agentRosters.set(serverId, agents);
    const event = { type: "agents-changed" as const, agents: this.withAgentColors(serverId, agents) };
    if (bufferedLive) this.#emit(serverId, event, true);
    else this.#emit(serverId, event);
  }

  forget(serverId: string): void {
    this.#rosterLoads.delete(serverId);
    this.#agentColors.delete(serverId);
    this.#agentRosters.delete(serverId);
    this.#agentChatColors.delete(serverId);
    this.#memberChatColors.delete(serverId);
    this.#browserHolds.delete(serverId);
    this.#browserPageStates.delete(serverId);
    this.#browserStates.delete(serverId);
    this.#runtimeSnapshots.delete(serverId);
    this.#usageLimits.delete(serverId);
    this.#usageLimitReads.delete(serverId);
    this.#statuses.delete(serverId);
    this.#modelSources.delete(serverId);
    this.#modelSourceReads.delete(serverId);
    this.#generations.delete(serverId);
    for (const key of this.#conversations.keys()) {
      if (key.startsWith(`${serverId}\0`)) this.#conversations.delete(key);
    }
    for (const key of this.#queues.keys()) {
      if (key.startsWith(`${serverId}\0`)) this.#queues.delete(key);
    }
  }

  clear(): void {
    this.#rosterLoads.clear();
    this.#agentColors.clear();
    this.#agentRosters.clear();
    this.#agentChatColors.clear();
    this.#memberChatColors.clear();
    this.#browserHolds.clear();
    this.#browserPageStates.clear();
    this.#browserStates.clear();
    this.#runtimeSnapshots.clear();
    this.#usageLimits.clear();
    this.#usageLimitReads.clear();
    this.#generations.clear();
    this.#conversations.clear();
    this.#queues.clear();
  }

  readonly #refreshConversationPage = Effect.fn("RemoteEvents.refreshConversationPage")(function* (
    this: RemoteEventRefresh,
    serverId: string,
    agentId: string,
    revision: number,
  ) {
    const key = `${serverId}\0${agentId}`;
    const pending = this.#conversations.get(key);
    if (pending) {
      if (pending.revision === revision) pending.sequence += 1;
      pending.revision = Math.max(pending.revision, revision);
      return;
    }
    const request = { revision, sequence: 0 };
    this.#conversations.set(key, request);
    yield* Effect.gen({ self: this }, function* () {
      while (this.#hasServer(serverId)) {
        const requestedRevision = request.revision;
        const requestedSequence = request.sequence;
        const result = yield* this.#conversationPageEffect(serverId, agentId, INVALIDATED_CONVERSATION_LIMIT).pipe(
          Effect.result,
        );
        if (Result.isFailure(result)) {
          if (request.sequence !== requestedSequence || request.revision !== requestedRevision) continue;
          return;
        }
        const page = result.success;
        if (request.sequence !== requestedSequence) continue;
        if (page.revision >= request.revision) {
          this.#emit(serverId, { type: "conversation-page", page });
          return;
        }
        if (request.revision === requestedRevision) return;
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#conversations.get(key) === request) this.#conversations.delete(key);
        }),
      ),
    );
  });

  readonly #refreshQueue = Effect.fn("RemoteEvents.refreshQueue")(function* (
    this: RemoteEventRefresh,
    serverId: string,
    agentId: string,
  ) {
    const key = `${serverId}\0${agentId}`;
    const pending = this.#queues.get(key);
    if (pending) {
      pending.dirty = true;
      return;
    }
    const request = { dirty: false };
    this.#queues.set(key, request);
    yield* Effect.gen({ self: this }, function* () {
      do {
        request.dirty = false;
        const result = yield* this.#request(serverId, TEAM_API_ROUTES.agent.queue(agentId), decodeQueueSnapshot).pipe(
          Effect.result,
        );
        if (Result.isFailure(result)) {
          if (request.dirty) continue;
          return;
        }
        if (!this.#hasServer(serverId)) return;
        this.#emit(serverId, { type: "queue-changed", snapshot: result.success });
      } while (request.dirty);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#queues.get(key) === request) this.#queues.delete(key);
        }),
      ),
    );
  });

  readonly #conversationPageEffect = Effect.fn("RemoteEvents.conversationPage")(
    (serverId: string, agentId: string, limit: number) =>
      this.#request(
        serverId,
        `${TEAM_API_ROUTES.agent.conversationPage(agentId)}${pageQuery({ type: "latest" }, limit)}`,
        decodeConversationPageFromHost,
      ),
  );

  #advance(serverId: string): number {
    const generation = (this.#generations.get(serverId) ?? 0) + 1;
    this.#generations.set(serverId, generation);
    return generation;
  }
}

function withAgentColor(agent: ClientAgentSummary, color: AvatarColor | undefined): ClientAgentSummary {
  const { avatarColor: _, ...rest } = agent;
  return color ? { ...rest, avatarColor: color } : rest;
}

function withChatColor<Item extends { chatColor?: AvatarColor }>(item: Item, color: AvatarColor | undefined): Item {
  const next = { ...item };
  if (color) next.chatColor = color;
  else delete next.chatColor;
  return next;
}

function sameColors(
  previous: ReadonlyMap<string, AvatarColor> | undefined,
  next: ReadonlyMap<string, AvatarColor>,
): boolean {
  return (
    previous !== undefined &&
    previous.size === next.size &&
    [...next].every(([id, color]) => previous.get(id) === color)
  );
}
