import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { DISCORD_ORCHESTRATOR_AVATAR } from "@openbot/contracts/discord-app";
import { ATTACHMENT_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AddMessagingOrchestratorInput,
  AddTelegramOrchestratorInput,
  AgentApproval,
  AgentEvent,
  AgentSummary,
  ConnectTelegramChatInput,
  DiscordAccess,
  DiscordRoleList,
  MessagingConnection,
  MessagingConnectionState,
  MessagingConnectPage,
  MessagingCredentialState,
  MessagingOverview,
  MessagingPlatform,
  RespondToApprovalInput,
  SetDiscordAccessInput,
  SidebarLayoutSnapshot,
  SidebarSection,
  StartWhatsAppLinkInput,
  WhatsAppLinkState,
  WhatsAppOverview,
  WhatsAppSender,
} from "@openbot/contracts/ipc";
import { MESSAGING_CONNECTION_STATES, MESSAGING_LIMITS } from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import type { DiscordEmbed } from "@openbot/contracts/signal-protocol/discord-api";
import { TELEGRAM_LINK_CODE_TTL_SECONDS } from "@openbot/contracts/signal-protocol/telegram-route";
import { SLACK_ORCHESTRATOR_AVATAR } from "@openbot/contracts/slack-app";
import { TELEGRAM_ORCHESTRATOR_AVATAR } from "@openbot/contracts/telegram-app";
import { WHATSAPP_ORCHESTRATOR_AVATAR } from "@openbot/contracts/whatsapp-app";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactPostText, redactText } from "@openbot/logging";
import { Deferred, Effect, Exit, Result, Schedule, Schema, Scope } from "effect";
import type { AgentLifecycleFailed } from "../agent-service";
import { causeHelpers } from "../effect-boundary";
import type { MessagingOrigin } from "../mailbox-store";
import type { SidebarLayoutStore } from "../sidebar-layout-store";
import { type DiscordAppPort, DiscordConnect, type DiscordConnectFailed } from "./discord/discord-connect";
import { discordOrchestratorMemories, discordOrchestratorProfile } from "./discord/discord-orchestrator";
import { matchesHistoryFilter } from "./messaging-history-store";
import { mentionNames, withMentionNames } from "./messaging-mentions";
import { QUIET_ANSWER } from "./messaging-prompt";
import { MessagingStatusPosts, type PendingFinal, type StatusPost, type StopButton } from "./messaging-status-posts";
import type { MessagingConnectionRecord, MessagingLink } from "./messaging-store";
import {
  MESSAGING_NOT_RUNNING,
  type MessagingActivity,
  type MessagingAnswerFile,
  type MessagingDiscordSend,
  type MessagingHistory,
  type MessagingHistoryScope,
  type MessagingSlackSend,
  type MessagingTelegramSend,
  type MessagingThreads,
} from "./messaging-threads";
import {
  CANCEL_TEXT,
  type ConnectionIdentity,
  DiscordApiError,
  type HistoryFilter,
  type InboundAction,
  type InboundFile,
  type InboundMessage,
  type IngressAnswer,
  type IngressDelivery,
  type IngressState,
  type MessageTarget,
  type MessagingAdapter,
  type MessagingAdapterError,
  MessagingConnectionError,
  type MessagingDriver,
  type MessagingIngress,
  type MessagingTransport,
  type RecentMessages,
  type StatusReaction,
  TelegramCallError,
  WhatsAppAnswerPartlySent,
  WhatsAppRefusedError,
} from "./messaging-types";
import { type SlackAppPort, SlackConnect, type SlackConnectFailed } from "./slack/slack-connect";
import { slackOrchestratorMemories, slackOrchestratorProfile } from "./slack/slack-orchestrator";
import { slackPingedUsers } from "./slack/slack-render";
import { SlackApiError, SlackWebApi } from "./slack/slack-web-api";
import { type TelegramAppPort, telegramLinkUrl } from "./telegram/telegram-connect";
import { telegramOrchestratorMemories, telegramOrchestratorProfile } from "./telegram/telegram-orchestrator";
import { parseTelegramUpdate, telegramLink, telegramRemoval } from "./telegram/telegram-updates";
import { WHATSAPP_HISTORY_KEEP_MS } from "./whatsapp/whatsapp-archive";
import { WhatsAppConnect } from "./whatsapp/whatsapp-connect";
import { whatsAppOrchestratorMemories, whatsAppOrchestratorProfile } from "./whatsapp/whatsapp-orchestrator";
import type { WhatsAppRuntime } from "./whatsapp/whatsapp-runtime";

const logger = createOpenBotLogger("messaging");

export interface MessagingCredentials {
  keys(): string[];
  status(connectionId: string): MessagingCredentialState;
  get(connectionId: string): Record<string, string> | null;
  set(connectionId: string, values: Record<string, string>): Effect.Effect<void, MessagingOperationFailed>;
  clear(connectionId: string): Effect.Effect<void, MessagingOperationFailed>;
  retain(connectionIds: ReadonlySet<string>): Effect.Effect<void, MessagingOperationFailed>;
}

export interface MessagingAgents {
  listAgents(): AgentSummary[];
  respondToApproval(input: RespondToApprovalInput): Effect.Effect<void, AgentLifecycleFailed>;
  approvalExecutionThreadId(requestId: string | number): string | undefined;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  createAgentProfile(
    input: Pick<AddMessagingOrchestratorInput, "provider" | "model" | "reasoningEffort"> & {
      name: string;
      title: string;
      description: string;
      avatarSeed: string;
      avatarHue: AgentSummary["avatarHue"];
      startOnRunnableProvider: boolean;
    },
  ): Effect.Effect<AgentSummary, AgentLifecycleFailed>;
  createMemory(input: { agentId: string; text: string }): unknown;
  ensureDeletable(agentId: string): Effect.Effect<void, AgentLifecycleFailed>;
  deleteAgent(agentId: string): Effect.Effect<void, AgentLifecycleFailed>;
  sidebarChatIds(): ReadonlySet<string>;
}

export interface MessagingServiceOptions {
  threads: MessagingThreads;
  agents: MessagingAgents;
  credentials: MessagingCredentials;
  drivers: readonly MessagingDriver[];
  downloadsRoot: string;
  ingress?: MessagingIngress;
  slackApp?: SlackAppPort;
  discordApp?: DiscordAppPort;
  slackOrigin?: string;
  telegramApp?: TelegramAppPort;
  whatsapp?: WhatsAppRuntime;
  sidebar?: Pick<SidebarLayoutStore, "getSnapshot" | "mutate" | "removeAgent">;
  statusPath?: string;
}

interface LiveConnection {
  record: MessagingConnectionRecord;
  adapter: MessagingAdapter;
  transport: MessagingTransport | null;
  identity: ConnectionIdentity | null;
  state: MessagingConnectionState;
  reported: MessagingConnectionState;
  retryAt: string | null;
}

interface PendingApproval {
  requestId: string | number;
  connectionId: string;
  target: MessageTarget;
  messageId: string | null;
  allowedUserId: string | null;
  text: string;
  answered: boolean;
  accept: string;
  decline: string;
  posting: boolean;
}

const FATAL_STATES = new Set<MessagingConnectionState>(["invalid_token", "removed"]);
const APPROVAL_TEXT_LIMIT = 2_500;
const PROGRESS_TEXT_LIMIT = 1_000;
const LIVE_STATES = new Set<MessagingConnectionState>(["connecting", "connected", "reconnecting", "rate_limited"]);
const STARTING_STATES = new Set<MessagingConnectionState>(["connecting", "reconnecting", "rate_limited"]);
const RECENT_MESSAGES = 2_000;
const HISTORY_PRUNE_INTERVAL = "1 hour";
const QUEUED_TRANSPORT_WAIT_MS = 60_000;
const TELEGRAM_READY_TIMEOUT_MS = 15_000;
const IDENTIFY_RETRY_MS = 30_000;
const SETTLE_RETRY_MS = 60_000;
const FINAL_POST_ATTEMPTS = 5;
const RECEIVE_NAME_DEADLINE_MS = 5_000;
const RECEIVE_CONTEXT_DEADLINE_MS = 5_000;
const MENTION_MARKERS = /[\uE000-\uE001]/g;
const RESULT_REPORT = /^\s*[*_]*Status:?[*_]*:?\s*(?:done|partial|blocked)\b/i;

export class MessagingService {
  readonly #threads: MessagingThreads;
  readonly #agents: MessagingAgents;
  readonly #credentials: MessagingCredentials;
  readonly #drivers: ReadonlyMap<MessagingPlatform, MessagingDriver>;
  readonly #downloadsRoot: string;
  readonly #live = new Map<string, LiveConnection>();
  readonly #transportWaiters = new Map<string, Set<() => void>>();
  readonly #transportDeadlines = new Map<string, number>();
  readonly #status: MessagingStatusPosts;
  readonly #posts: Map<string, StatusPost>;
  readonly #targets = new Map<string, MessageTarget>();
  readonly #approvals = new Map<string, PendingApproval>();
  readonly #stops: Map<string, StopButton>;
  readonly #settleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #finalFailures = new Map<string, number>();
  readonly #chains = new Map<string, Deferred.Deferred<void>>();
  readonly #recent = new Set<string>();
  readonly #unsubscribe: Array<() => void> = [];
  readonly #ingress: MessagingIngress | null;
  readonly #connect: SlackConnect | null;
  readonly #discordConnect: DiscordConnect | null;
  readonly #slackOrigin: string | undefined;
  readonly #telegramApp: TelegramAppPort | null;
  readonly #whatsapp: WhatsAppConnect | null;
  readonly #whatsappRuntime: WhatsAppRuntime | null;
  readonly #sidebar: Pick<SidebarLayoutStore, "getSnapshot" | "mutate" | "removeAgent"> | null;
  #started = false;
  #connectionsStarted = false;
  #telegramLinkLease: { release: () => void; timer: ReturnType<typeof setTimeout> } | null = null;
  #scope = Scope.makeUnsafe();

  constructor(options: MessagingServiceOptions) {
    this.#threads = options.threads;
    this.#agents = options.agents;
    this.#credentials = options.credentials;
    this.#drivers = new Map(options.drivers.map((driver) => [driver.platform, driver]));
    this.#downloadsRoot = options.downloadsRoot;
    this.#ingress = options.ingress ?? null;
    this.#connect = options.ingress && options.slackApp ? new SlackConnect(options.slackApp) : null;
    this.#discordConnect = options.ingress && options.discordApp ? new DiscordConnect(options.discordApp) : null;
    this.#slackOrigin = options.slackOrigin;
    this.#telegramApp = options.ingress && options.telegramApp ? options.telegramApp : null;
    this.#whatsappRuntime = options.whatsapp ?? null;
    this.#whatsapp = options.whatsapp
      ? new WhatsAppConnect({
          runtime: options.whatsapp,
          store: options.threads.store,
          history: options.threads.history,
          credentials: options.credentials,
          hooks: {
            prepare: (workspaceId, workspaceName) => this.#prepareWhatsApp(workspaceId, workspaceName),
            finish: (connectionId, values) => this.#finishWhatsApp(connectionId, values),
            dispatch: (operation) => this.#dispatch(operation),
          },
        })
      : null;
    this.#sidebar = options.sidebar ?? null;
    this.#status = new MessagingStatusPosts(options.statusPath ?? null);
    this.#posts = this.#status.posts;
    this.#stops = this.#status.stops;
  }

  readonly start = Effect.fn("MessagingService.start")(function* (
    this: MessagingService,
  ): Effect.fn.Return<void, MessagingOperationFailed> {
    if (this.#started) return;
    this.#started = true;
    this.#scope = Scope.makeUnsafe();
    yield* Effect.forkIn(
      Effect.sync(() => this.#pruneHistory()).pipe(Effect.repeat(Schedule.spaced(HISTORY_PRUNE_INTERVAL))),
      this.#scope,
      { startImmediately: true },
    );
    this.#status.load(new Set(this.#threads.store.connections().map((record) => record.connectionId)));
    this.#unsubscribe.push(
      this.#threads.onActivity((activity) => {
        this.#dispatch(this.#serial(activity.link.linkId, this.#activity(activity)));
      }),
      this.#agents.onEvent((event) => this.#agentEvent(event)),
    );
    const ingress = this.#ingress;
    if (ingress)
      this.#unsubscribe.push(
        ingress.onState((state) => {
          if (state === "online") this.#transportDeadlines.clear();
        }),
      );
    this.#threads.setContextSource((link, origin) => this.#promptContext(link, origin));
    this.#threads.setOwnerPostSource(
      (link) => this.#whatsapp?.postsAsOwner(link.connectionId, link.platformChannelId) === true,
    );
    this.#threads.setHistorySource((link, scope, limit, filter) => this.#recentMessages(link, scope, limit, filter));
    this.#threads.setOutbound({
      keysUnreadable: (connectionId) => {
        const record = this.#threads.store.connection(connectionId);
        return record ? this.#summary(record).state === "secret_storage_unavailable" : false;
      },
      places: (connectionId) => this.#outboundPlaces(connectionId),
      history: (connectionId, placeId, limit, filter) => this.#outboundHistory(connectionId, placeId, limit, filter),
      post: (connectionId, target, markdown, files, embeds) =>
        this.#outboundPost(connectionId, target, markdown, files, embeds),
      discord: (connectionId, send) => this.#outboundDiscord(connectionId, send),
      telegram: (connectionId, send) => this.#outboundTelegram(connectionId, send),
      slack: (connectionId, send) => this.#outboundSlack(connectionId, send),
    });
    this.#ingress?.handle((workspaceId, delivery) => this.deliver(workspaceId, delivery));
    const records = this.#threads.store.connections();
    yield* this.#credentials.retain(new Set(records.map((record) => record.connectionId)));
    yield* Effect.forEach(
      records.filter((record) => record.enabled),
      (record) => this.#startConnection(record),
      { concurrency: "unbounded", discard: true },
    );
    this.#connectionsStarted = true;
    for (const [connectionId, waiters] of [...this.#transportWaiters]) {
      if (!this.#live.has(connectionId)) for (const ready of [...waiters]) ready();
    }
  }).bind(this);

  readonly stop = Effect.fn("MessagingService.stop")(function* (
    this: MessagingService,
  ): Effect.fn.Return<void, MessagingOperationFailed> {
    this.#started = false;
    this.#connectionsStarted = false;
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
    for (const waiters of [...this.#transportWaiters.values()]) for (const ready of [...waiters]) ready();
    this.#threads.setContextSource(null);
    this.#threads.setOwnerPostSource(null);
    this.#threads.setHistorySource(null);
    this.#threads.setOutbound(null);
    this.#ingress?.handle(null);
    this.#endTelegramLinkLease();
    if (this.#whatsapp) yield* this.#whatsapp.cancelLink();
    for (const timer of this.#settleTimers.values()) clearTimeout(timer);
    this.#settleTimers.clear();
    yield* Effect.forEach(
      [...this.#live.values()],
      (live) => {
        const transport = live.transport;
        return transport ? transport.stop() : Effect.void;
      },
      { concurrency: "unbounded", discard: true },
    );
    this.#live.clear();
    this.#whatsappRuntime?.closeAll();
    yield* Scope.close(this.#scope, Exit.void);
  }, Effect.uninterruptible).bind(this);

  hasLiveConnection(): boolean {
    return [...this.#live.values()].some((live) => LIVE_STATES.has(live.state));
  }

  resume(): void {
    this.#ingress?.reconnect();
    for (const live of this.#live.values()) live.transport?.reconnect();
  }

  slackOverview(): MessagingOverview {
    return this.#overview("slack");
  }

  discordOverview(): MessagingOverview {
    return this.#overview("discord");
  }

  telegramOverview(): MessagingOverview {
    return this.#overview("telegram");
  }

  whatsappOverview(): WhatsAppOverview {
    return { ...this.#overview("whatsapp"), accounts: this.#whatsapp?.accounts() ?? [] };
  }

  whatsappLinkState(): WhatsAppLinkState {
    return this.#whatsapp?.linkState() ?? { status: "idle", qr: null, code: null, workspaceId: null, error: null };
  }

  readonly startWhatsAppLink = Effect.fn("MessagingService.startWhatsAppLink")(function* (
    this: MessagingService,
    input: StartWhatsAppLinkInput,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    return yield* whatsapp.startLink(input);
  }).bind(this);

  readonly cancelWhatsAppLink = Effect.fn("MessagingService.cancelWhatsAppLink")(function* (this: MessagingService) {
    if (this.#whatsapp) yield* this.#whatsapp.cancelLink();
  }).bind(this);

  readonly listWhatsAppGroups = Effect.fn("MessagingService.listWhatsAppGroups")(function* (
    this: MessagingService,
    workspaceId: string,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    return yield* whatsapp.groups(workspaceId).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly addWhatsAppSender = Effect.fn("MessagingService.addWhatsAppSender")(function* (
    this: MessagingService,
    workspaceId: string,
    sender: WhatsAppSender,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    yield* whatsapp.addSender(workspaceId, sender).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly removeWhatsAppSender = Effect.fn("MessagingService.removeWhatsAppSender")(function* (
    this: MessagingService,
    workspaceId: string,
    senderId: string,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    yield* whatsapp.removeSender(workspaceId, senderId).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly setWhatsAppSenderReadOnly = Effect.fn("MessagingService.setWhatsAppSenderReadOnly")(function* (
    this: MessagingService,
    workspaceId: string,
    senderId: string,
    readOnly: boolean,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    yield* whatsapp.setSenderReadOnly(workspaceId, senderId, readOnly).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly answerWhatsAppRequest = Effect.fn("MessagingService.answerWhatsAppRequest")(function* (
    this: MessagingService,
    workspaceId: string,
    code: string,
    approve: boolean,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    yield* whatsapp.answerRequest(workspaceId, code, approve).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly setWhatsAppOwnNumber = Effect.fn("MessagingService.setWhatsAppOwnNumber")(function* (
    this: MessagingService,
    workspaceId: string,
    ownNumber: boolean,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    yield* whatsapp.setOwnNumber(workspaceId, ownNumber).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly setWhatsAppStatusReactions = Effect.fn("MessagingService.setWhatsAppStatusReactions")(function* (
    this: MessagingService,
    workspaceId: string,
    statusReactions: boolean,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    yield* whatsapp.setStatusReactions(workspaceId, statusReactions).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly setWhatsAppWorkingMessage = Effect.fn("MessagingService.setWhatsAppWorkingMessage")(function* (
    this: MessagingService,
    workspaceId: string,
    workingMessage: boolean,
  ) {
    const whatsapp = yield* messagingStep(() => this.#requireWhatsApp());
    yield* whatsapp.setWorkingMessage(workspaceId, workingMessage).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly disconnectWhatsAppNumber = Effect.fn("MessagingService.disconnectWhatsAppNumber")(function* (
    this: MessagingService,
    workspaceId: string,
  ) {
    const runtime = yield* messagingStep(() => this.#requireWhatsApp() && this.#whatsappRuntime);
    const record = yield* messagingStep(() => this.#requireConnection("whatsapp", workspaceId));
    const orphan = yield* this.#orphanedOrchestrator(record);
    const storeId = this.#credentials.get(record.connectionId)?.storeId;
    const handle = storeId ? runtime?.get(storeId) : null;
    if (handle) yield* handle.session.logout();
    yield* this.#stopConnection(record.connectionId);
    if (storeId) runtime?.delete(storeId);
    yield* messagingStep(() => {
      this.#threads.history.forget(record.connectionId);
      runtime?.deleteFiles(record.connectionId);
    });
    yield* this.#credentials.clear(record.connectionId);
    yield* messagingStep(() =>
      this.#threads.store.updateConnection(record.connectionId, { enabled: false, lastErrorCode: null }),
    );
    this.#whatsapp?.forget(workspaceId);
    if (orphan) yield* this.#deleteOrchestrator(orphan);
  }, Effect.uninterruptible).bind(this);

  readonly #prepareWhatsApp = Effect.fn("MessagingService.prepareWhatsApp")(function* (
    this: MessagingService,
    workspaceId: string,
    workspaceName: string,
  ) {
    const record = yield* messagingStep(() =>
      this.#threads.store.ensureConnection("whatsapp", workspaceId, workspaceName),
    );
    yield* this.#stopConnection(record.connectionId);
    return record.connectionId;
  });

  readonly #finishWhatsApp = Effect.fn("MessagingService.finishWhatsApp")(function* (
    this: MessagingService,
    connectionId: string,
    values: Record<string, string>,
  ) {
    yield* this.#credentials.set(connectionId, values);
    const record = this.#threads.store.connection(connectionId);
    if (!record) return;
    this.#threads.store.updateConnection(connectionId, {
      enabled: true,
      lastErrorCode: null,
      orchestratorAgentId: this.#orchestrator(record) ?? this.#platformOrchestrator("whatsapp"),
    });
    const updated = this.#threads.store.connection(connectionId);
    if (updated) yield* this.#startConnection(updated);
  }, Effect.uninterruptible);

  #withoutStatusPost(connectionId: string): boolean {
    return this.#whatsapp?.workingMessage(connectionId) === false;
  }

  #react(
    live: LiveConnection,
    target: MessageTarget,
    messageId: string,
    reaction: StatusReaction,
    on: boolean,
  ): Effect.Effect<void> {
    if (on && this.#whatsapp?.statusReactions(live.record.connectionId) === false) return Effect.void;
    return live.adapter.react(target, messageId, reaction, on).pipe(Effect.catch(() => Effect.void));
  }

  #quietEnd(connectionId: string, target: MessageTarget): boolean {
    return this.#whatsapp?.postsAsOwner(connectionId, target.platformChannelId) === true;
  }

  #requireWhatsApp(): WhatsAppConnect {
    if (!this.#whatsapp) throw new Error(sourceText("error.messaging.whatsappUnsupported"));
    return this.#whatsapp;
  }

  #overview(platform: MessagingPlatform): MessagingOverview {
    return {
      connections: this.#threads.store
        .connections()
        .filter((record) => record.platform === platform && this.#credentials.status(record.connectionId) !== "missing")
        .map((record) => this.#summary(record)),
    };
  }

  readonly reconnect = Effect.fn("MessagingService.reconnect")(function* (
    this: MessagingService,
    platform: MessagingPlatform,
    workspaceId: string,
    opensPage: boolean,
  ): Effect.fn.Return<MessagingConnectPage | null, MessagingOperationFailed> {
    const record = yield* messagingStep(() => this.#requireLinked(platform, workspaceId));
    if (platform === "discord" && record.lastErrorCode === "invalid_token")
      return yield* this.connectDiscordGuild(opensPage);
    if (this.#live.get(record.connectionId)?.state === "not_linked") {
      if (platform === "slack") return yield* this.connectSlackWorkspace(opensPage);
      if (platform === "discord") return yield* this.connectDiscordGuild(opensPage);
      if (platform === "telegram")
        return yield* this.connectTelegramChat(workspaceId.startsWith("-") ? "group" : "direct", opensPage);
    }
    yield* this.#stopConnection(record.connectionId);
    this.#threads.store.updateConnection(record.connectionId, { enabled: true, lastErrorCode: null });
    const updated = this.#threads.store.connection(record.connectionId);
    if (updated) yield* this.#startConnection(updated);
    this.#ingress?.reconnect();
    return null;
  }, Effect.uninterruptible).bind(this);

  readonly setEnabled = Effect.fn("MessagingService.setEnabled")(function* (
    this: MessagingService,
    platform: MessagingPlatform,
    workspaceId: string,
    enabled: boolean,
  ): Effect.fn.Return<void, MessagingOperationFailed> {
    const record = yield* messagingStep(() => this.#requireLinked(platform, workspaceId));
    yield* this.#stopConnection(record.connectionId);
    this.#threads.store.updateConnection(record.connectionId, { enabled, lastErrorCode: null });
    const updated = this.#threads.store.connection(record.connectionId);
    if (enabled && updated) yield* this.#startConnection(updated);
  }, Effect.uninterruptible).bind(this);

  readonly addOrchestrator = Effect.fn("MessagingService.addOrchestrator")(function* (
    this: MessagingService,
    platform: MessagingPlatform,
    input: AddMessagingOrchestratorInput,
  ) {
    if (platform === "whatsapp") return yield* this.#addSharedOrchestrator(platform, input);
    const record = yield* messagingStep(() => this.#requireConnection(platform, input.workspaceId));
    const current = this.#orchestrator(record) ?? this.#platformOrchestrator(platform);
    if (current) {
      this.#shareOrchestrator(platform, current);
      return { agentId: current, sectionId: null };
    }
    const discord = platform === "discord";
    const agent = yield* this.#agents
      .createAgentProfile({
        ...(discord ? discordOrchestratorProfile() : slackOrchestratorProfile()),
        ...(discord ? DISCORD_ORCHESTRATOR_AVATAR : SLACK_ORCHESTRATOR_AVATAR),
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        startOnRunnableProvider: true,
      })
      .pipe(toMessagingOperationFailed);
    const memories = discord ? discordOrchestratorMemories() : slackOrchestratorMemories();
    for (const text of memories) this.#agents.createMemory({ agentId: agent.id, text });
    this.#shareOrchestrator(platform, agent.id);
    const sectionId = yield* this.#placeInIntegrations(agent.id).pipe(
      Effect.catch((failure) => {
        this.#warn(failure.cause);
        return Effect.succeed(null);
      }),
    );
    return { agentId: agent.id, sectionId };
  }, Effect.uninterruptible).bind(this);

  readonly #placeInIntegrations = Effect.fn("MessagingService.placeInIntegrations")(function* (
    this: MessagingService,
    agentId: string,
  ) {
    const sidebar = this.#sidebar;
    if (!sidebar) return null;
    const name = sourceText("status.messaging.integrationsSection");
    const agentIds = new Set(this.#agents.listAgents().map((agent) => agent.id));
    const existing = integrationsSection(sidebar.getSnapshot());
    const layout = yield* sidebar
      .mutate(
        existing ? { type: "assign", agentId, sectionId: existing.id } : { type: "create", name, agentId },
        agentIds,
      )
      .pipe(toMessagingOperationFailed);
    return layout.agentAssignments[agentId] ?? null;
  });

  readonly #orphanedOrchestrator = Effect.fn("MessagingService.orphanedOrchestrator")(function* (
    this: MessagingService,
    record: MessagingConnectionRecord,
  ) {
    const agentId = this.#orchestrator(record);
    if (!agentId) return null;
    const shared = this.#threads.store
      .connections()
      .some(
        (other) =>
          other.connectionId !== record.connectionId &&
          other.orchestratorAgentId === agentId &&
          this.#credentials.status(other.connectionId) !== "missing",
      );
    if (shared) return null;
    yield* this.#agents.ensureDeletable(agentId).pipe(toMessagingOperationFailed);
    return agentId;
  });

  readonly #deleteOrchestrator = Effect.fn("MessagingService.deleteOrchestrator")(function* (
    this: MessagingService,
    agentId: string,
  ) {
    yield* Effect.gen({ self: this }, function* () {
      yield* this.#agents.deleteAgent(agentId).pipe(toMessagingOperationFailed);
      const sidebar = this.#sidebar;
      if (!sidebar) return;
      const layout = yield* sidebar.removeAgent(agentId).pipe(toMessagingOperationFailed);
      const section = integrationsSection(layout);
      const chatIds = this.#agents.sidebarChatIds();
      if (
        section &&
        !Object.entries(layout.agentAssignments).some(([id, sectionId]) => sectionId === section.id && chatIds.has(id))
      )
        yield* sidebar.mutate({ type: "delete", sectionId: section.id }, chatIds).pipe(toMessagingOperationFailed);
    }).pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
  });

  readonly connectSlackWorkspace = Effect.fn("MessagingService.connectSlackWorkspace")(function* (
    this: MessagingService,
    opensPage: boolean,
  ): Effect.fn.Return<MessagingConnectPage, MessagingOperationFailed> {
    const connect = yield* messagingStep(() => this.#requireConnect());
    return yield* connect.start(opensPage).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly completeSlackWorkspace = Effect.fn("MessagingService.completeSlackWorkspace")(function* (
    this: MessagingService,
    nonce: string,
    grant: string,
  ): Effect.fn.Return<boolean, MessagingOperationFailed> {
    const connect = yield* messagingStep(() => this.#requireConnect());
    const opened = yield* connect.complete(nonce, grant).pipe(toMessagingOperationFailed);
    if (!opened) return false;
    const record = this.#threads.store.ensureConnection("slack", opened.workspaceId, opened.workspaceName);
    yield* this.#stopConnection(record.connectionId);
    yield* this.#credentials.set(record.connectionId, {
      botToken: opened.botToken,
      botUserId: opened.botUserId,
      appId: opened.appId,
      workspaceId: opened.workspaceId,
    });
    this.#threads.store.updateConnection(record.connectionId, {
      enabled: true,
      workspaceName: opened.workspaceName,
      botUserId: opened.botUserId,
      appId: opened.appId,
      lastErrorCode: null,
      orchestratorAgentId: this.#orchestrator(record) ?? this.#platformOrchestrator("slack"),
    });
    this.#ingress?.reconnect();
    const updated = this.#threads.store.connection(record.connectionId);
    if (updated) yield* this.#startConnection(updated);
    return true;
  }, Effect.uninterruptible).bind(this);

  readonly disconnectSlackWorkspace = Effect.fn("MessagingService.disconnectSlackWorkspace")(function* (
    this: MessagingService,
    workspaceId: string,
  ) {
    const record = yield* messagingStep(() => this.#requireConnection("slack", workspaceId));
    const orphan = yield* this.#orphanedOrchestrator(record);
    yield* this.#stopConnection(record.connectionId);
    const botToken = this.#credentials.get(record.connectionId)?.botToken;
    if (botToken)
      yield* new SlackWebApi({ token: botToken, origin: this.#slackOrigin })
        .call("auth.revoke")
        .pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
    yield* this.#credentials.clear(record.connectionId);
    yield* messagingStep(() =>
      this.#threads.store.updateConnection(record.connectionId, { enabled: false, lastErrorCode: null }),
    );
    if (this.#connect)
      yield* this.#connect
        .unlink(workspaceId)
        .pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
    this.#ingress?.reconnect();
    if (orphan) yield* this.#deleteOrchestrator(orphan);
  }, Effect.uninterruptible).bind(this);

  readonly discordAccess = Effect.fn("MessagingService.discordAccess")(function* (
    this: MessagingService,
    guildId: string,
  ): Effect.fn.Return<DiscordAccess, MessagingOperationFailed> {
    const record = yield* messagingStep(() => this.#requireConnection("discord", guildId));
    return { allowedRoles: this.#threads.store.allowedRoles(record.connectionId) };
  }).bind(this);

  readonly listDiscordRoles = Effect.fn("MessagingService.listDiscordRoles")(function* (
    this: MessagingService,
    guildId: string,
  ): Effect.fn.Return<DiscordRoleList, MessagingOperationFailed> {
    const record = yield* messagingStep(() => this.#requireConnection("discord", guildId));
    const live = this.#live.get(record.connectionId);
    const roles = live?.identity ? live.adapter.roles?.() : undefined;
    if (!roles)
      return yield* new MessagingOperationFailed({
        cause: new Error(sourceText("error.messaging.discordRelayUnavailable")),
      });
    return {
      roles: (yield* roles.pipe(
        Effect.mapError((failure) => {
          const code = failure.cause instanceof DiscordApiError ? failure.cause.code : null;
          return new MessagingOperationFailed({
            cause: new Error(
              sourceText(
                code === "invalid_request"
                  ? "error.messaging.discordRolesUnsupported"
                  : "error.messaging.discordRelayUnavailable",
              ),
            ),
          });
        }),
      )).map((role) => ({ id: role.id, name: roleName(role.name) })),
    };
  }).bind(this);

  readonly setDiscordAccess = Effect.fn("MessagingService.setDiscordAccess")(function* (
    this: MessagingService,
    input: SetDiscordAccessInput,
  ): Effect.fn.Return<DiscordAccess, MessagingOperationFailed> {
    const record = yield* messagingStep(() => this.#requireConnection("discord", input.workspaceId));
    yield* messagingStep(() => this.#threads.store.replaceAllowedRoles(record.connectionId, input.allowedRoles));
    return { allowedRoles: this.#threads.store.allowedRoles(record.connectionId) };
  }).bind(this);

  readonly connectDiscordGuild = Effect.fn("MessagingService.connectDiscordGuild")(function* (
    this: MessagingService,
    opensPage: boolean,
  ): Effect.fn.Return<MessagingConnectPage, MessagingOperationFailed> {
    const connect = yield* messagingStep(() => this.#requireDiscordConnect());
    return yield* connect.start(opensPage).pipe(toMessagingOperationFailed);
  }).bind(this);

  readonly completeDiscordGuild = Effect.fn("MessagingService.completeDiscordGuild")(function* (
    this: MessagingService,
    nonce: string,
    grant: string,
  ): Effect.fn.Return<boolean, MessagingOperationFailed> {
    const connect = yield* messagingStep(() => this.#requireDiscordConnect());
    const opened = yield* connect.complete(nonce, grant).pipe(toMessagingOperationFailed);
    if (!opened) return false;
    const record = this.#threads.store.ensureConnection("discord", opened.guildId, opened.guildName);
    yield* this.#stopConnection(record.connectionId);
    yield* this.#credentials.set(record.connectionId, {
      guildId: opened.guildId,
      guildName: opened.guildName,
      appId: opened.appId,
    });
    this.#threads.store.updateConnection(record.connectionId, {
      enabled: true,
      workspaceName: opened.guildName,
      appId: opened.appId,
      lastErrorCode: null,
      orchestratorAgentId: this.#orchestrator(record) ?? this.#platformOrchestrator("discord"),
    });
    const updated = this.#threads.store.connection(record.connectionId);
    if (updated) yield* this.#startConnection(updated);
    this.#ingress?.reconnect();
    return true;
  }, Effect.uninterruptible).bind(this);

  readonly disconnectDiscordGuild = Effect.fn("MessagingService.disconnectDiscordGuild")(function* (
    this: MessagingService,
    guildId: string,
  ) {
    const record = yield* messagingStep(() => this.#requireConnection("discord", guildId));
    const orphan = yield* this.#orphanedOrchestrator(record);
    if (this.#discordConnect) yield* this.#discordConnect.unlink(guildId).pipe(toMessagingOperationFailed);
    yield* this.#stopConnection(record.connectionId);
    yield* this.#credentials.clear(record.connectionId);
    yield* messagingStep(() =>
      this.#threads.store.updateConnection(record.connectionId, { enabled: false, lastErrorCode: null }),
    );
    this.#ingress?.reconnect();
    if (orphan) yield* this.#deleteOrchestrator(orphan);
  }, Effect.uninterruptible).bind(this);

  readonly deliver = Effect.fn("MessagingService.deliver")(function* (
    this: MessagingService,
    workspaceId: string,
    delivery: IngressDelivery,
  ): Effect.fn.Return<IngressAnswer> {
    if (delivery.platform === "telegram") {
      yield* this.#deliverTelegram(workspaceId, delivery).pipe(
        Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))),
      );
      return { status: 200 };
    }
    const record = this.#threads.store.connectionForWorkspace(delivery.platform, workspaceId);
    if (!record) return { status: 404 };
    if (!record.enabled) return { status: 200 };
    const transport = yield* this.#transportFor(record, delivery.queued === true);
    if (!transport?.deliver) return { status: 503 };
    return yield* transport.deliver(delivery);
  }).bind(this);

  readonly addTelegramOrchestrator = Effect.fn("MessagingService.addTelegramOrchestrator")(function* (
    this: MessagingService,
    input: AddTelegramOrchestratorInput,
  ) {
    return yield* this.#addSharedOrchestrator("telegram", input);
  }, Effect.uninterruptible).bind(this);

  readonly addWhatsAppOrchestrator = Effect.fn("MessagingService.addWhatsAppOrchestrator")(function* (
    this: MessagingService,
    input: AddTelegramOrchestratorInput,
  ) {
    return yield* this.#addSharedOrchestrator("whatsapp", input);
  }, Effect.uninterruptible).bind(this);

  readonly #addSharedOrchestrator = Effect.fn("MessagingService.addSharedOrchestrator")(function* (
    this: MessagingService,
    platform: "telegram" | "whatsapp",
    input: AddTelegramOrchestratorInput,
  ) {
    const records = this.#threads.store.connections().filter((record) => record.platform === platform);
    if (!records.length)
      return yield* new MessagingOperationFailed({
        cause: new Error(
          sourceText(
            platform === "telegram" ? "error.messaging.telegramNotConnected" : "error.messaging.whatsappNotConnected",
          ),
        ),
      });
    const current = this.#platformOrchestrator(platform);
    if (current) {
      this.#assignSharedOrchestrator(platform, current);
      return { agentId: current, sectionId: null };
    }
    const telegram = platform === "telegram";
    const agent = yield* this.#agents
      .createAgentProfile({
        ...(telegram ? telegramOrchestratorProfile() : whatsAppOrchestratorProfile()),
        ...(telegram ? TELEGRAM_ORCHESTRATOR_AVATAR : WHATSAPP_ORCHESTRATOR_AVATAR),
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        startOnRunnableProvider: true,
      })
      .pipe(toMessagingOperationFailed);
    const memories = telegram ? telegramOrchestratorMemories() : whatsAppOrchestratorMemories();
    for (const text of memories) this.#agents.createMemory({ agentId: agent.id, text });
    this.#assignSharedOrchestrator(platform, agent.id);
    const sectionId = yield* this.#placeInIntegrations(agent.id).pipe(
      Effect.catch((failure) => {
        this.#warn(failure.cause);
        return Effect.succeed(null);
      }),
    );
    return { agentId: agent.id, sectionId };
  });

  readonly connectTelegramChat = Effect.fn("MessagingService.connectTelegramChat")(function* (
    this: MessagingService,
    place: ConnectTelegramChatInput["place"],
    opensPage: boolean,
  ): Effect.fn.Return<MessagingConnectPage, MessagingOperationFailed> {
    const { app, ingress } = yield* messagingStep(() => this.#requireTelegram());
    this.#endTelegramLinkLease();
    const release = ingress.acquire("telegram");
    const timer = setTimeout(() => this.#endTelegramLinkLease(), TELEGRAM_LINK_CODE_TTL_SECONDS * 1_000);
    timer.unref?.();
    this.#telegramLinkLease = { release, timer };
    const link = yield* Effect.all([this.#telegramReady(ingress), app.createLink()], { concurrency: "unbounded" }).pipe(
      Effect.map(([, created]) => created),
      Effect.onError(() => Effect.sync(() => this.#endTelegramLinkLease())),
    );
    const url = telegramLinkUrl(link.botUsername, link.code, place);
    if (opensPage) yield* messagingIo(() => app.openExternal(url));
    return { url, nonce: null };
  }).bind(this);

  #transportFor(
    record: { connectionId: string; enabled: boolean },
    queued: boolean,
  ): Effect.Effect<LiveConnection["transport"] | undefined> {
    const current = () => (record.enabled ? this.#live.get(record.connectionId)?.transport : undefined);
    const live = this.#live.get(record.connectionId);
    const starting = live ? STARTING_STATES.has(live.state) : !this.#connectionsStarted;
    if (current()?.deliver || !queued || !record.enabled || !starting) return Effect.sync(current);
    const deadline = this.#transportDeadlines.get(record.connectionId) ?? Date.now() + QUEUED_TRANSPORT_WAIT_MS;
    this.#transportDeadlines.set(record.connectionId, deadline);
    return Effect.callback<void>((resume) => {
      const waiters = this.#transportWaiters.get(record.connectionId) ?? new Set<() => void>();
      const ready = () => resume(Effect.void);
      waiters.add(ready);
      this.#transportWaiters.set(record.connectionId, waiters);
      return Effect.sync(() => {
        waiters.delete(ready);
        if (waiters.size === 0) this.#transportWaiters.delete(record.connectionId);
      });
    }).pipe(
      Effect.timeoutOrElse({ duration: Math.max(0, deadline - Date.now()), orElse: () => Effect.void }),
      Effect.map(current),
    );
  }

  #telegramReady(ingress: MessagingIngress): Effect.Effect<void, MessagingOperationFailed> {
    return Effect.callback<void, MessagingOperationFailed>((resume) => {
      const settled = (state: IngressState) => {
        if (ingress.telegram.available()) resume(Effect.void);
        else if (state === "online") resume(Effect.fail(telegramNotReady(state)));
        else return false;
        return true;
      };
      if (settled(ingress.state())) return;
      const stop = ingress.onState((state) => {
        if (settled(state)) stop();
      });
      return Effect.sync(stop);
    }).pipe(
      Effect.timeoutOrElse({
        duration: TELEGRAM_READY_TIMEOUT_MS,
        orElse: () =>
          Effect.suspend(() =>
            ingress.telegram.available() ? Effect.void : Effect.fail(telegramNotReady(ingress.state())),
          ),
      }),
    );
  }

  #endTelegramLinkLease(): void {
    const lease = this.#telegramLinkLease;
    this.#telegramLinkLease = null;
    if (!lease) return;
    clearTimeout(lease.timer);
    lease.release();
  }

  readonly disconnectTelegramChat = Effect.fn("MessagingService.disconnectTelegramChat")(function* (
    this: MessagingService,
    chatId: string,
  ) {
    const { app, ingress } = yield* messagingStep(() => this.#requireTelegram());
    const record = yield* messagingStep(() => this.#requireConnection("telegram", chatId));
    const orphan = yield* this.#orphanedOrchestrator(record);
    const botId = this.#credentials.get(record.connectionId)?.botId;
    yield* Effect.acquireUseRelease(
      Effect.sync(() => ingress.acquire("telegram")),
      () =>
        Effect.gen({ self: this }, function* () {
          yield* this.#stopConnection(record.connectionId);
          if (botId && record.lastErrorCode !== "removed")
            yield* ingress.telegram
              .call(botId, "leaveChat", { chat_id: Number(chatId) })
              .pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
        }),
      (release) => Effect.sync(release),
    );
    yield* messagingStep(() => this.#threads.history.forget(record.connectionId));
    yield* this.#credentials.clear(record.connectionId);
    yield* messagingStep(() =>
      this.#threads.store.updateConnection(record.connectionId, { enabled: false, lastErrorCode: null }),
    );
    yield* app.unlink(chatId).pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
    if (orphan) yield* this.#deleteOrchestrator(orphan);
  }, Effect.uninterruptible).bind(this);

  readonly #deliverTelegram = Effect.fn("MessagingService.deliverTelegram")(function* (
    this: MessagingService,
    chatId: string,
    delivery: Extract<IngressDelivery, { platform: "telegram" }>,
  ): Effect.fn.Return<void, MessagingOperationFailed> {
    const { botId } = delivery;
    const update = parseTelegramUpdate(delivery.body);
    if (!update) return;
    const link = delivery.linked ? telegramLink(update) : null;
    if (link) return yield* this.#linkTelegramChat(botId, chatId, link.title);
    const record = this.#threads.store.connectionForWorkspace("telegram", chatId);
    if (!record || (record.appId && record.appId !== botId)) return;
    const transport = yield* this.#transportFor(record, delivery.queued === true);
    if (transport?.deliver) {
      yield* transport.deliver(delivery);
      return;
    }
    if (
      record.lastErrorCode === "removed" ||
      this.#credentials.status(record.connectionId) === "missing" ||
      !telegramRemoval(update, botId, chatId)
    )
      return;
    yield* this.#stopConnection(record.connectionId);
    this.#threads.store.updateConnection(record.connectionId, { enabled: true, lastErrorCode: "removed" });
    if (this.#telegramApp)
      yield* this.#telegramApp
        .unlink(chatId)
        .pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
  });

  readonly #linkTelegramChat = Effect.fn("MessagingService.linkTelegramChat")(function* (
    this: MessagingService,
    botId: string,
    chatId: string,
    title: string,
  ) {
    const { ingress } = yield* messagingStep(() => this.#requireTelegram());
    const record = yield* messagingStep(() => this.#threads.store.ensureConnection("telegram", chatId, title));
    yield* this.#stopConnection(record.connectionId);
    const me = yield* ingress.telegram.call(botId, "getMe", {}).pipe(Effect.catch(() => Effect.succeed({})));
    const botUsername = "username" in me && me.username ? me.username : "";
    yield* this.#credentials.set(record.connectionId, {
      botId,
      chatId,
      chatTitle: title,
      ...(botUsername ? { botUsername } : {}),
    });
    this.#threads.store.updateConnection(record.connectionId, {
      enabled: true,
      workspaceName: title,
      botUserId: botId,
      appId: botId,
      lastErrorCode: null,
      orchestratorAgentId: this.#orchestrator(record) ?? this.#platformOrchestrator("telegram"),
    });
    const updated = this.#threads.store.connection(record.connectionId);
    if (updated) yield* this.#startConnection(updated);
    this.#endTelegramLinkLease();
    const live = this.#live.get(record.connectionId);
    if (live)
      yield* live.adapter
        .post(
          { platformChannelId: chatId, replyThreadId: null },
          { text: sourceText("status.messaging.telegramLinked", { bot: botUsername ? `@${botUsername}` : "OpenBot" }) },
        )
        .pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
  }, Effect.uninterruptible);

  #platformOrchestrator(platform: MessagingPlatform): string | null {
    const agents = new Set(this.#agents.listAgents().map((agent) => agent.id));
    for (const record of this.#threads.store.connections())
      if (record.platform === platform && record.orchestratorAgentId && agents.has(record.orchestratorAgentId))
        return record.orchestratorAgentId;
    return null;
  }

  #shareOrchestrator(platform: MessagingPlatform, agentId: string): void {
    for (const record of this.#threads.store.connections())
      if (record.platform === platform && !this.#orchestrator(record))
        this.#threads.store.updateConnection(record.connectionId, { orchestratorAgentId: agentId });
  }

  #assignSharedOrchestrator(platform: "telegram" | "whatsapp", agentId: string): void {
    for (const record of this.#threads.store.connections())
      if (record.platform === platform && record.orchestratorAgentId !== agentId)
        this.#threads.store.updateConnection(record.connectionId, { orchestratorAgentId: agentId });
  }

  readonly #startConnection = Effect.fn("MessagingService.startConnection")(function* (
    this: MessagingService,
    record: MessagingConnectionRecord,
  ) {
    const credentials = this.#credentials.get(record.connectionId);
    const driver = this.#drivers.get(record.platform);
    if (!driver || !credentials?.[driver.requiredCredential]) return;
    if (record.lastErrorCode === "removed") return;
    const live: LiveConnection = {
      record,
      adapter: driver.createAdapter(credentials, {
        connectionId: record.connectionId,
        rateLimited: (retryAt) => {
          live.retryAt = retryAt;
          this.#dispatch(this.#setState(live, "rate_limited"));
          const end = setTimeout(
            () => {
              if (this.#live.get(record.connectionId) !== live || live.retryAt !== retryAt) return;
              live.retryAt = null;
              if (live.state === "rate_limited") this.#dispatch(this.#setState(live, live.reported));
            },
            Math.max(0, Date.parse(retryAt) - Date.now()),
          );
          end.unref?.();
        },
      }),
      transport: null,
      identity: null,
      state: "connecting",
      reported: "connecting",
      retryAt: null,
    };
    this.#live.set(record.connectionId, live);
    const identified = yield* Effect.result(live.adapter.identify().pipe(toMessagingOperationFailed));
    if (Result.isFailure(identified)) {
      const error = identified.failure.cause;
      if (this.#live.get(record.connectionId) !== live) return;
      if (error instanceof MessagingConnectionError) return yield* this.#setState(live, error.state);
      const retry = setTimeout(() => {
        if (this.#live.get(record.connectionId) === live) this.#dispatch(this.#restart(record.connectionId));
      }, IDENTIFY_RETRY_MS);
      retry.unref?.();
      live.transport = {
        start: () => undefined,
        reconnect: () => this.#dispatch(this.#restart(record.connectionId)),
        stop: () => Effect.sync(() => clearTimeout(retry)),
      };
      return yield* this.#setState(live, "reconnecting");
    }
    live.identity = identified.success;
    if (this.#live.get(record.connectionId) !== live) return;
    const identity = live.identity;
    this.#threads.store.updateConnection(record.connectionId, {
      workspaceName: identity.workspaceName,
      botUserId: identity.botUserId,
      appId: identity.appId,
    });
    live.record = this.#threads.store.connection(record.connectionId) ?? record;
    const transport = driver.createTransport(credentials, identity);
    live.transport = transport;
    transport.start({
      state: (state) => {
        live.reported = state;
        if (state === "connected") live.retryAt = null;
        this.#dispatch(this.#setState(live, state));
      },
      message: (message) => this.#dispatch(this.#receive(live, message)),
      action: (action) => this.#dispatch(this.#action(live, action)),
      renamed: (workspaceName) => this.#dispatch(this.#renamed(live, workspaceName)),
      placeCreated: (platformChannelId) => {
        const join = live.adapter.joinPlace?.(platformChannelId);
        if (join) this.#dispatch(join.pipe(toMessagingOperationFailed));
      },
    });
    this.#transportDeadlines.delete(record.connectionId);
    for (const ready of [...(this.#transportWaiters.get(record.connectionId) ?? [])]) ready();
    const join = live.adapter.joinPublicPlaces?.();
    if (join)
      yield* Effect.forkIn(
        join.pipe(Effect.catch((error) => Effect.sync(() => this.#warn(error.cause)))),
        this.#scope,
        { startImmediately: true },
      );
  });

  readonly #renamed = Effect.fn("MessagingService.renamed")(function* (
    this: MessagingService,
    live: LiveConnection,
    workspaceName: string,
  ) {
    const name = workspaceName.slice(0, 256);
    this.#threads.store.updateConnection(live.record.connectionId, { workspaceName: name });
    const values = this.#credentials.get(live.record.connectionId);
    if (values?.chatTitle !== undefined)
      yield* this.#credentials.set(live.record.connectionId, { ...values, chatTitle: name });
  });

  readonly #restart = Effect.fn("MessagingService.restart")(function* (
    this: MessagingService,
    connectionId: string,
  ): Effect.fn.Return<void, MessagingOperationFailed> {
    yield* this.#stopConnection(connectionId);
    const record = this.#threads.store.connection(connectionId);
    if (record?.enabled) yield* this.#startConnection(record);
  });

  readonly #stopConnection = Effect.fn("MessagingService.stopConnection")(function* (
    this: MessagingService,
    connectionId: string,
  ): Effect.fn.Return<void, MessagingOperationFailed> {
    const live = this.#live.get(connectionId);
    this.#live.delete(connectionId);
    const transport = live?.transport;
    if (transport) yield* transport.stop();
  });

  readonly #setState = Effect.fn("MessagingService.setState")(function* (
    this: MessagingService,
    live: LiveConnection,
    state: MessagingConnectionState,
  ) {
    const wasConnected = live.state === "connected";
    live.state = state;
    if (state === "connected" && !wasConnected && this.#live.get(live.record.connectionId) === live)
      this.#dispatch(this.#settleStatusPosts(live));
    if (FATAL_STATES.has(state)) {
      this.#threads.store.updateConnection(live.record.connectionId, { lastErrorCode: state });
      logger.warn("A messaging connection stopped.", { platform: live.record.platform, state });
      const unlink:
        | Effect.Effect<void, DiscordConnectFailed | SlackConnectFailed | MessagingOperationFailed>
        | undefined =
        live.record.platform === "whatsapp"
          ? undefined
          : live.record.platform === "telegram"
            ? this.#telegramApp?.unlink(live.record.workspaceId)
            : live.record.platform === "discord"
              ? this.#discordConnect?.unlink(live.record.workspaceId)
              : this.#connect?.unlink(live.record.workspaceId);
      if (unlink) yield* unlink.pipe(Effect.catch((error) => Effect.sync(() => this.#warn(error.cause))));
      if (state === "removed" && this.#live.get(live.record.connectionId) === live)
        yield* this.#stopConnection(live.record.connectionId);
    }
  });

  #summary(record: MessagingConnectionRecord): MessagingConnection {
    const live = this.#live.get(record.connectionId);
    const credentials = this.#credentials.status(record.connectionId);
    const values = credentials === "saved" ? this.#credentials.get(record.connectionId) : null;
    const stored = isOneOf(MESSAGING_CONNECTION_STATES, record.lastErrorCode) ? record.lastErrorCode : null;
    const required = this.#drivers.get(record.platform)?.requiredCredential;
    const state: MessagingConnectionState = !record.enabled
      ? "paused"
      : credentials === "unreadable" || (values && required && !values[required])
        ? "secret_storage_unavailable"
        : (live?.state ?? stored ?? "connecting");
    return {
      workspaceId: record.workspaceId,
      platform: record.platform,
      enabled: record.enabled,
      state,
      workspaceName: record.workspaceName,
      botUserId: record.botUserId,
      missingScopes: live?.identity?.missingScopes ?? [],
      retryAt: state === "rate_limited" ? (live?.retryAt ?? null) : null,
      credentials,
      orchestratorAgentId: record.orchestratorAgentId,
    };
  }

  readonly #receive = Effect.fn("MessagingService.receive")(function* (
    this: MessagingService,
    live: LiveConnection,
    message: InboundMessage,
  ) {
    if (!live.identity) return;
    if (!this.#authorAllowed(live.record.connectionId, message)) return;
    const store = this.#threads.store;
    const existing = store.linkByKey(live.record.connectionId, message.platformChannelId, message.threadKey);
    const pings =
      (live.record.platform === "slack" && !message.isDirect && (message.requiresLink || !existing)) ||
      (live.record.platform === "whatsapp" &&
        message.isDirect &&
        !existing &&
        message.authorId !== live.identity.botUserId)
        ? store.pings(live.record.connectionId, message.platformChannelId, message.threadKey)
        : [];
    const ping = pings.find((candidate) => candidate.userId === message.authorId) ?? null;
    const poster =
      live.record.platform === "whatsapp" &&
      ping &&
      this.#agents.listAgents().some((agent) => agent.id === ping.agentId)
        ? ping.agentId
        : null;
    if (message.requiresLink && (pings.length ? !ping : !existing)) return;
    const dedupKey = `${live.record.connectionId}:${message.dedupKey}`;
    if (this.#recent.has(dedupKey)) return;
    this.#recent.add(dedupKey);
    if (this.#recent.size > RECENT_MESSAGES) {
      const oldest = this.#recent.values().next().value;
      if (oldest !== undefined) this.#recent.delete(oldest);
    }
    if (existing && CANCEL_TEXT.test(message.text) && message.files.length === 0) {
      if (yield* this.#threads.stop(existing.linkId, message.authorId).pipe(toMessagingOperationFailed)) {
        yield* this.#react(live, message.target, message.platformMessageId, "stopped", true);
        return;
      }
    }
    const { adapter } = live;
    const [authorName, mentioned, place, earlier] = yield* Effect.all(
      [
        adapter.authorName(message.authorId).pipe(
          toMessagingOperationFailed,
          Effect.timeoutOrElse({
            duration: RECEIVE_NAME_DEADLINE_MS,
            orElse: () => Effect.succeed(message.authorId),
          }),
        ),
        mentionNames([...message.mentionedUserIds, ...(message.replyTo?.mentionedUserIds ?? [])], (userId) =>
          adapter.authorName(userId),
        ),
        message.isDirect
          ? Effect.succeed(null)
          : adapter.placeName(message.platformChannelId).pipe(
              toMessagingOperationFailed,
              Effect.timeoutOrElse({
                duration: RECEIVE_NAME_DEADLINE_MS,
                orElse: () => Effect.succeed(message.platformChannelId),
              }),
            ),
        (adapter.platform === "discord" || adapter.platform === "telegram") && !message.isDirect
          ? adapter
              .history(
                message.platformChannelId,
                message.threadKey,
                existing?.historyCursor ?? null,
                message.platformMessageId,
              )
              .pipe(
                Effect.timeoutOrElse({ duration: RECEIVE_CONTEXT_DEADLINE_MS, orElse: () => Effect.succeed([]) }),
                Effect.catch(() => Effect.succeed([])),
              )
          : Effect.succeed([]),
      ],
      { concurrency: "unbounded" },
    );
    const named = withMentionNames(message.text, mentioned);
    const quote = message.replyTo;
    const replyTo = quote
      ? { authorName: quote.authorName, text: withMentionNames(quote.text, mentioned), sentAt: quote.sentAt }
      : ping && !existing
        ? { authorName: this.#pingAuthor(live.record, ping.agentId), text: ping.text, sentAt: ping.createdAt }
        : null;
    if (live.record.platform === "discord" && !message.isDirect && !existing) {
      const workflows = yield* this.#threads.workflowMention({
        connectionId: live.record.connectionId,
        serverName: live.record.workspaceName,
        channelId: message.platformChannelId,
        channelName: place ?? message.platformChannelId,
        messageId: message.platformMessageId,
        authorId: message.authorId,
        authorName,
        authorRoleIds: message.authorRoleIds ?? [],
        text: named,
        files: message.files,
        receivedAt: new Date().toISOString(),
      });
      if (workflows === "skipped")
        yield* adapter
          .react(message.target, message.platformMessageId, "failed", true)
          .pipe(Effect.catch(() => Effect.void));
      if (workflows !== "none") return;
    }
    if (live.record.platform === "telegram" && !message.isDirect && !existing) {
      const workflows = yield* this.#threads.workflowTelegramMention({
        connectionId: live.record.connectionId,
        chatName: live.record.workspaceName,
        chatId: message.platformChannelId,
        threadKey: message.threadKey,
        messageId: message.platformMessageId,
        authorId: message.authorId,
        authorName,
        text: named,
        receivedAt: new Date().toISOString(),
      });
      if (workflows === "skipped")
        yield* adapter
          .react(message.target, message.platformMessageId, "failed", true)
          .pipe(Effect.catch(() => Effect.void));
      if (workflows !== "none") return;
    }
    if (live.record.platform === "slack" && !message.isDirect && !existing && !ping) {
      const workflows = yield* this.#threads.slackWorkflowMention({
        connectionId: live.record.connectionId,
        workspaceName: live.record.workspaceName,
        channelId: message.platformChannelId,
        channelName: place ?? message.platformChannelId,
        messageId: message.platformMessageId,
        threadId: message.threadKey,
        authorId: message.authorId,
        authorName,
        text: named,
        files: message.files,
        receivedAt: new Date().toISOString(),
      });
      if (workflows === "skipped")
        yield* adapter
          .react(message.target, message.platformMessageId, "failed", true)
          .pipe(Effect.catch(() => Effect.void));
      if (workflows !== "none") return;
    }
    const agentId = existing?.agentId ?? this.#orchestrator(live.record) ?? poster;
    if (!agentId) {
      if (live.record.platform === "whatsapp" && message.authorId !== live.identity.botUserId) return;
      const noAgent =
        live.record.platform === "discord"
          ? "status.messaging.discordNoAgent"
          : live.record.platform === "telegram"
            ? "status.messaging.telegramNoAgent"
            : live.record.platform === "whatsapp"
              ? "status.messaging.whatsappNoAgent"
              : "status.messaging.noAgent";
      yield* adapter.post(message.target, { text: sourceText(noAgent) }).pipe(toMessagingOperationFailed);
      return;
    }
    const staging = join(this.#downloadsRoot, randomUUID());
    yield* Effect.acquireUseRelease(
      Effect.succeed(staging),
      () =>
        Effect.gen({ self: this }, function* () {
          const delivered = (messageId: string) =>
            this.#threads.received(`messaging:${live.record.connectionId}:${message.platformChannelId}:${messageId}`);
          const gave = (messageId: string) => Boolean(existing) && delivered(messageId);
          const quoted =
            quote?.messageId && !gave(quote.messageId)
              ? (quote.files ?? []).map((file) => ({ file, label: `${quote.authorName}: ${file.name}` }))
              : [];
          const hasOwnFiles = message.files.length > 0 || quoted.length > 0;
          const earlierFiles = [
            ...quoted,
            ...(hasOwnFiles ? [] : earlier)
              .filter((entry) => !delivered(entry.id))
              .toReversed()
              .flatMap((entry) =>
                (entry.files ?? []).map((file) => ({ file, label: `${entry.authorName}: ${file.name}` })),
              ),
          ];
          const { paths, skipped } = yield* this.#download(
            adapter,
            [...message.files, ...earlierFiles.map((item) => item.file)],
            staging,
          );
          const given = earlierFiles.filter((item) => !skipped.has(item.file)).map((item) => item.label);
          const notGiven = earlierFiles.filter((item) => skipped.has(item.file)).map((item) => item.label);
          const missing = message.files.flatMap((file) => {
            const reason = skipped.get(file);
            return reason ? [`${file.name} (${reason})`] : [];
          });
          const notes = [
            given.length ? `(Files of earlier messages, given with this one: ${given.join(", ")})` : "",
            notGiven.length ? `(Files of earlier messages that were not given: ${notGiven.join(", ")})` : "",
            missing.length ? `(Files that did not arrive: ${missing.join(", ")})` : "",
          ].filter(Boolean);
          const text = notes.length ? `${named}\n\n${notes.join("\n")}` : named;
          const result = yield* this.#threads
            .receive({
              connectionId: live.record.connectionId,
              agentId,
              platformChannelId: message.platformChannelId,
              threadKey: message.threadKey,
              isDirect: message.isDirect,
              title: message.isDirect ? authorName : `${place} · ${named.slice(0, 80) || authorName}`,
              text,
              sourcePaths: paths,
              origin: {
                authorId: message.authorId,
                authorName,
                platformMessageId: message.platformMessageId,
                ...(replyTo ? { replyTo } : {}),
              },
              idempotencyKey: `messaging:${live.record.connectionId}:${message.dedupKey}`,
            })
            .pipe(toMessagingOperationFailed);
          if (result.status === "duplicate") return;
          const key = `${result.link.linkId}:${message.platformMessageId}`;
          if (result.status === "busy") {
            if (
              !this.#quietEnd(live.record.connectionId, message.target) &&
              !this.#withoutStatusPost(live.record.connectionId)
            )
              yield* adapter
                .post(message.target, { text: sourceText("status.messaging.busy") })
                .pipe(toMessagingOperationFailed);
            yield* this.#react(live, message.target, message.platformMessageId, "failed", true);
            return;
          }
          this.#targets.set(key, message.target);
          yield* this.#react(live, message.target, message.platformMessageId, "received", true);
          if (result.waiting)
            yield* this.#serial(
              result.link.linkId,
              Effect.gen({ self: this }, function* () {
                if (
                  this.#posts.has(key) ||
                  !this.#targets.has(key) ||
                  this.#withoutStatusPost(live.record.connectionId) ||
                  this.#quietEnd(live.record.connectionId, message.target)
                )
                  return;
                const messageId = yield* adapter
                  .post(message.target, { text: sourceText("status.messaging.queued") })
                  .pipe(toMessagingOperationFailed);
                this.#posts.set(key, {
                  connectionId: live.record.connectionId,
                  target: message.target,
                  messageId,
                  stopToken: null,
                });
                this.#status.restored.delete(key);
                yield* this.#status.save();
              }),
            );
        }),
      () => messagingIo(() => rm(staging, { recursive: true, force: true })).pipe(Effect.orDie),
    );
  }, Effect.uninterruptible);

  #authorAllowed(connectionId: string, message: InboundMessage): boolean {
    const allowed = this.#threads.store.allowedRoles(connectionId);
    if (allowed.length === 0) return true;
    const roles = new Set(message.authorRoleIds ?? []);
    return allowed.some((role) => roles.has(role.id));
  }

  #pingAuthor(record: MessagingConnectionRecord, agentId: string): string {
    if (agentId === (this.#orchestrator(record) ?? agentId)) return "OpenBot, a post of yours";
    const name = this.#agents.listAgents().find((agent) => agent.id === agentId)?.name;
    return name ? `OpenBot, a post by your teammate ${name}` : "OpenBot";
  }

  #orchestrator(record: MessagingConnectionRecord): string | null {
    const id = this.#threads.store.connection(record.connectionId)?.orchestratorAgentId ?? null;
    return id && this.#agents.listAgents().some((agent) => agent.id === id) ? id : null;
  }

  readonly #download = Effect.fn("MessagingService.download")(function* (
    this: MessagingService,
    adapter: MessagingAdapter,
    files: readonly InboundFile[],
    staging: string,
  ) {
    const paths: string[] = [];
    const skipped = new Map<InboundFile, string>();
    let total = 0;
    for (const [index, file] of files.entries()) {
      if (paths.length >= INPUT_LIMITS.attachments) {
        skipped.set(file, `more than ${INPUT_LIMITS.attachments} files`);
        continue;
      }
      if (file.size > ATTACHMENT_LIMITS.fileBytes || total + file.size > ATTACHMENT_LIMITS.totalBytes) {
        skipped.set(file, "too large");
        continue;
      }
      const downloaded = yield* Effect.result(
        Effect.gen(function* () {
          yield* messagingIo(() => mkdir(join(staging, String(index)), { recursive: true, mode: 0o700 }));
          const destination = join(staging, String(index), basename(file.name) || "file");
          yield* adapter
            .download(file, destination, Math.min(ATTACHMENT_LIMITS.fileBytes, ATTACHMENT_LIMITS.totalBytes - total))
            .pipe(toMessagingOperationFailed);
          return destination;
        }),
      );
      if (Result.isFailure(downloaded)) {
        const cause = downloaded.failure.cause;
        skipped.set(file, tooLarge(cause) ? "too large" : "the download failed; the sender can send it again");
        this.#warn(cause, "A messaging file did not download.");
      } else {
        total += file.size;
        paths.push(downloaded.success);
      }
    }
    return { paths, skipped };
  });

  readonly #promptContext = Effect.fn("MessagingService.promptContext")(function* (
    this: MessagingService,
    link: MessagingLink,
    origin: MessagingOrigin,
  ) {
    const live = this.#live.get(link.connectionId);
    const workspaceName = live?.record.workspaceName ?? null;
    if (!live) return { workspaceName, place: link.title, messages: [], cursor: null, skippedFiles: [] };
    const place = link.isDirect
      ? "direct message"
      : yield* live.adapter.placeName(link.platformChannelId).pipe(toMessagingOperationFailed);
    const messages = yield* live.adapter
      .history(link.platformChannelId, link.threadKey, link.historyCursor, origin.platformMessageId)
      .pipe(Effect.catch(() => Effect.succeed([])));
    return { workspaceName, place, messages, cursor: origin.platformMessageId, skippedFiles: [] };
  });

  readonly #recentMessages = Effect.fn("MessagingService.recentMessages")(function* (
    this: MessagingService,
    link: MessagingLink,
    scope: MessagingHistoryScope,
    limit: number,
    filter: HistoryFilter,
  ): Effect.fn.Return<MessagingHistory | null, MessagingOperationFailed> {
    const live = this.#live.get(link.connectionId);
    if (!live?.identity) return null;
    const place = link.isDirect
      ? "direct message"
      : yield* live.adapter.placeName(link.platformChannelId).pipe(toMessagingOperationFailed);
    const recent = yield* filteredRecent(
      live.adapter,
      link.platformChannelId,
      scope === "conversation" ? link.threadKey : null,
      limit,
      filter,
    ).pipe(toMessagingOperationFailed);
    return { platform: live.record.platform, place, ...recent };
  });

  readonly #outboundPlaces = Effect.fn("MessagingService.outboundPlaces")(function* (
    this: MessagingService,
    connectionId: string,
  ) {
    const live = this.#live.get(connectionId);
    if (!live?.identity) return { error: MESSAGING_NOT_RUNNING };
    const whatsApp = live.record.platform === "whatsapp";
    return yield* live.adapter.places().pipe(
      Effect.map((list) => (whatsApp ? { ...list, note: WHATSAPP_ALLOWED_PLACES } : list)),
      Effect.catch((failure) => Effect.succeed({ error: refusal(failure) })),
    );
  });

  readonly #outboundHistory = Effect.fn("MessagingService.outboundHistory")(function* (
    this: MessagingService,
    connectionId: string,
    placeId: string,
    limit: number,
    filter: HistoryFilter,
  ) {
    const live = this.#live.get(connectionId);
    if (!live?.identity) return { error: MESSAGING_NOT_RUNNING };
    const platform = live.record.platform;
    return yield* Effect.gen(function* () {
      const place = (yield* live.adapter.places()).places.find((candidate) => candidate.id === placeId);
      if (!place)
        return {
          error:
            "This connection has no place with that id. Call openbot.messaging_list_places with the connection for the ids.",
        };
      const recent = yield* filteredRecent(live.adapter, placeId, null, limit, filter);
      return { history: { platform, place: place.name, ...recent } };
    }).pipe(
      Effect.catch((failure) =>
        Effect.succeed({ error: `${refusal(failure)} When the platform limits reads, try again in a minute.` }),
      ),
    );
  });

  readonly #outboundPost = Effect.fn("MessagingService.outboundPost")(function* (
    this: MessagingService,
    connectionId: string,
    named: MessageTarget,
    markdown: string,
    files: MessagingAnswerFile[] = [],
    embeds: DiscordEmbed[] = [],
  ) {
    const live = this.#live.get(connectionId);
    if (!live?.identity) return { error: MESSAGING_NOT_RUNNING, failure: "not-running" as const };
    const target = {
      ...named,
      platformChannelId: live.adapter.placeId?.(named.platformChannelId) ?? named.platformChannelId,
    };
    const postEmbeds = live.adapter.postEmbeds;
    if (embeds.length && !postEmbeds)
      return { error: "Only a Discord post can have embeds. Post the text alone.", failure: "refused" as const };
    if (live.record.platform === "telegram" && target.platformChannelId !== live.identity.workspaceId)
      return {
        error: "A Telegram connection posts only in its own chat. Use the connection of that chat.",
        failure: "refused" as const,
      };
    const guildId = live.record.platform === "discord" ? live.identity.workspaceId : null;
    const text = redactPostText(markdown);
    const botUserId = live.identity.botUserId;
    const pinged =
      live.record.platform === "slack" ? slackPingedUsers(text).filter((userId) => userId !== botUserId) : [];
    const direct = live.adapter.directChat?.(target) ?? null;
    const directPing = (posted: string) =>
      direct
        ? {
            ping: {
              userIds: [direct.userId],
              text: posted,
              platformChannelId: target.platformChannelId,
              threadKey: direct.threadKey,
            },
          }
        : {};
    if (!text.trim() && !embeds.length && files.length) {
      const result = yield* Effect.result(live.adapter.upload(target, files));
      if (Result.isFailure(result))
        return {
          error: `${refusal(result.failure)} A file can be in the place already. Do not post it again only because of this error.`,
          failure: "unknown" as const,
        };
      const uploaded = result.success;
      const sentFiles = files.map((file) => file.name).filter((name) => !uploaded.skipped.includes(name));
      if (!sentFiles.length)
        return {
          error:
            "No file was sent: a file can be empty, too large for the platform or not readable, or its send failed on the way. A file can be in the place already. Do not post it again only because of this error.",
          failure: "unknown" as const,
        };
      if (uploaded.firstId) live.adapter.rememberPost?.(target, uploaded.firstId, `Files: ${sentFiles.join(", ")}`);
      return {
        posted: true as const,
        ...(uploaded.firstId ? { messageId: uploaded.firstId } : {}),
        ...(uploaded.skipped.length ? { skippedFiles: uploaded.skipped } : {}),
        ...directPing(`Files: ${sentFiles.join(", ")}`),
      };
    }
    const single = files.length === 1 && !embeds.length ? files[0] : undefined;
    if (single && live.adapter.postFileWithText) {
      const captioned = yield* Effect.result(live.adapter.postFileWithText(target, text, single));
      if (Result.isFailure(captioned))
        return {
          error: refusal(captioned.failure),
          failure: "unknown" as const,
        };
      if (captioned.success) {
        live.adapter.rememberPost?.(target, captioned.success, `${text}\nFiles: ${single.name}`);
        return {
          posted: true as const,
          messageId: captioned.success,
          ...(guildId
            ? { url: `https://discord.com/channels/${guildId}/${target.platformChannelId}/${captioned.success}` }
            : {}),
          ...directPing(`${text}\nFiles: ${single.name}`),
        };
      }
    }
    const posted = yield* (
      postEmbeds && embeds.length
        ? postEmbeds.call(live.adapter, target, text, embeds.map(redactEmbed))
        : live.adapter.postAnswer(target, text, null)
    ).pipe(
      Effect.map((messageId) => ({
        posted: true as const,
        messageId,
        ...(guildId ? { url: `https://discord.com/channels/${guildId}/${target.platformChannelId}/${messageId}` } : {}),
        ...(pinged.length ? { ping: { userIds: pinged, text } } : directPing(text)),
      })),
      Effect.catch((failure) =>
        Effect.succeed({
          error: `${refusal(failure)} A long text goes in more than one post, so a part of it can be posted already. Do not post it again only because of this error.`,
          failure: "unknown" as const,
        }),
      ),
    );
    if (!("posted" in posted)) return posted;
    const skippedFiles = files.length
      ? yield* live.adapter.upload(target, files).pipe(
          Effect.map((uploaded) => uploaded.skipped),
          Effect.catch((failure) =>
            Effect.sync(() => {
              this.#warn(failure.cause);
              return files.map((file) => file.name);
            }),
          ),
        )
      : [];
    const sentFiles = files.map((file) => file.name).filter((name) => !skippedFiles.includes(name));
    live.adapter.rememberPost?.(
      target,
      posted.messageId,
      sentFiles.length ? `${text}\nFiles: ${sentFiles.join(", ")}` : text,
    );
    return skippedFiles.length ? { ...posted, skippedFiles } : posted;
  });

  readonly #outboundDiscord = Effect.fn("MessagingService.outboundDiscord")(function* (
    this: MessagingService,
    connectionId: string,
    send: MessagingDiscordSend,
  ) {
    const live = this.#live.get(connectionId);
    if (!live?.identity || live.record.platform !== "discord" || !live.adapter.addEmoji)
      return { failure: "not-running" as const };
    if (send.action === "react")
      return yield* live.adapter
        .addEmoji({ platformChannelId: send.channelId, replyThreadId: null }, send.messageId, send.emoji)
        .pipe(
          Effect.as({ posted: true as const }),
          Effect.catch((failure) =>
            Effect.sync(() => {
              this.#warn(failure.cause);
              return { failure: "refused" as const };
            }),
          ),
        );
    const target = {
      platformChannelId: send.channelId,
      replyThreadId: send.action === "reply" ? send.messageId : null,
    };
    const result = yield* this.#outboundPost(connectionId, target, send.text);
    return "posted" in result ? { posted: true as const } : { failure: result.failure };
  });

  readonly #outboundTelegram = Effect.fn("MessagingService.outboundTelegram")(function* (
    this: MessagingService,
    connectionId: string,
    send: MessagingTelegramSend,
  ) {
    const live = this.#live.get(connectionId);
    if (!live?.identity || live.record.platform !== "telegram" || !live.adapter.addEmoji)
      return { failure: "not-running" as const };
    const chatId = live.identity.workspaceId;
    if (send.action === "react")
      return yield* live.adapter
        .addEmoji({ platformChannelId: chatId, replyThreadId: null }, send.messageId, send.emoji)
        .pipe(
          Effect.as({ posted: true as const }),
          Effect.catch((failure) =>
            Effect.sync(() => {
              this.#warn(failure.cause);
              return { failure: "refused" as const };
            }),
          ),
        );
    const target = {
      platformChannelId: chatId,
      replyThreadId: send.action === "reply" ? `${send.threadKey}:${send.messageId}` : null,
    };
    const result = yield* this.#outboundPost(connectionId, target, send.text);
    return "posted" in result ? { posted: true as const } : { failure: result.failure };
  });

  readonly #outboundSlack = Effect.fn("MessagingService.outboundSlack")(function* (
    this: MessagingService,
    connectionId: string,
    send: MessagingSlackSend,
  ) {
    const live = this.#live.get(connectionId);
    if (!live?.identity || live.record.platform !== "slack" || !live.adapter.addEmoji)
      return { failure: "not-running" as const };
    if (send.action === "react")
      return yield* live.adapter
        .addEmoji({ platformChannelId: send.channelId, replyThreadId: null }, send.messageId, send.emoji)
        .pipe(
          Effect.as({ posted: true as const }),
          Effect.catch((failure) =>
            Effect.sync(() => {
              this.#warn(failure.cause);
              return { failure: "refused" as const };
            }),
          ),
        );
    const target = {
      platformChannelId: send.channelId,
      replyThreadId: send.action === "reply" ? send.threadId : null,
    };
    const result = yield* this.#outboundPost(connectionId, target, send.text);
    return "posted" in result ? { posted: true as const } : { failure: result.failure };
  });

  readonly #activity = Effect.fn("MessagingService.activity")(function* (
    this: MessagingService,
    activity: MessagingActivity,
  ) {
    if (!activity.origin) return;
    const live = this.#live.get(activity.link.connectionId);
    const origin = activity.origin;
    const key = `${activity.link.linkId}:${origin.platformMessageId}`;
    const target = this.#targets.get(key) ?? linkTarget(activity.link);
    const post = this.#posts.get(key);
    if (activity.type === "progress") {
      if (!live || !post?.messageId || !post.stopToken || post.final) return;
      const text = redactPostText(activity.text).replace(MENTION_MARKERS, "");
      yield* live.adapter
        .edit(target, post.messageId, {
          text: text.length > PROGRESS_TEXT_LIMIT ? `${text.slice(0, PROGRESS_TEXT_LIMIT - 1)}…` : text,
          buttons: [{ action: "stop" as const, label: sourceText("status.messaging.stop"), token: post.stopToken }],
        })
        .pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
      return;
    }
    if (activity.type === "started") {
      if (!live) return;
      if (
        !post?.messageId &&
        (activity.teammateRequest ||
          this.#withoutStatusPost(live.record.connectionId) ||
          this.#quietEnd(live.record.connectionId, target))
      ) {
        this.#posts.set(key, { connectionId: live.record.connectionId, target, messageId: null, stopToken: null });
        this.#status.restored.delete(key);
        yield* this.#status.save();
        return;
      }
      const stopToken = token();
      this.#stops.set(stopToken, {
        linkId: activity.link.linkId,
        authorId: origin.authorId,
        connectionId: live.record.connectionId,
      });
      if (post?.stopToken) this.#stops.delete(post.stopToken);
      const body = {
        text: sourceText("status.messaging.working"),
        buttons: [{ action: "stop" as const, label: sourceText("status.messaging.stop"), token: stopToken }],
      };
      const existingMessageId = post?.messageId ?? null;
      this.#posts.set(key, { connectionId: live.record.connectionId, target, messageId: existingMessageId, stopToken });
      this.#status.restored.delete(key);
      const messageId = existingMessageId
        ? yield* live.adapter
            .edit(target, existingMessageId, body)
            .pipe(toMessagingOperationFailed)
            .pipe(Effect.as(existingMessageId))
        : yield* live.adapter.post(target, body).pipe(toMessagingOperationFailed);
      this.#posts.set(key, { connectionId: live.record.connectionId, target, messageId, stopToken });
      yield* this.#status.save();
      return;
    }
    this.#targets.delete(key);
    const final = finalPost(
      activity,
      this.#threads.awaitsTeammate(activity.link.linkId),
      this.#quietEnd(activity.link.connectionId, target),
      this.#withoutStatusPost(activity.link.connectionId),
      live !== undefined,
    );
    if (final.answer && live?.record.platform === "slack") {
      const botUserId = live.identity?.botUserId;
      const userIds = slackPingedUsers(final.text).filter((userId) => userId !== botUserId);
      if (userIds.length)
        yield* this.#threads.recordPings({
          connectionId: activity.link.connectionId,
          platformChannelId: activity.link.platformChannelId,
          threadKey: activity.link.threadKey,
          userIds,
          agentId: activity.link.agentId,
          text: final.text,
        });
    }
    const ended: StatusPost = {
      connectionId: activity.link.connectionId,
      target,
      messageId: post?.messageId ?? null,
      stopToken: post?.stopToken ?? null,
      final,
    };
    this.#posts.set(key, ended);
    this.#status.restored.delete(key);
    yield* this.#status.save();
    if (!live) return;
    yield* this.#deliverFinal(live, key, ended);
    if (activity.type === "finished" && activity.status === "completed" && activity.files.length) {
      const { adapter } = live;
      const { skipped } = yield* adapter.upload(target, activity.files).pipe(toMessagingOperationFailed);
      if (skipped.length)
        yield* adapter
          .post(target, {
            text: sourceText("status.messaging.filesSkipped", { names: skipped.join(", ") }),
          })
          .pipe(toMessagingOperationFailed);
    }
  });

  readonly #deliverFinal = Effect.fn("MessagingService.deliverFinal")(function* (
    this: MessagingService,
    live: LiveConnection,
    key: string,
    post: StatusPost,
  ) {
    const final = post.final;
    if (!final || this.#posts.get(key) !== post) return;
    const { adapter } = live;
    const placeholder = (this.#finalFailures.get(key) ?? 0) + 1 >= FINAL_POST_ATTEMPTS ? null : post.messageId;
    yield* Effect.gen({ self: this }, function* () {
      if (final.reaction) {
        const platformMessageId = key.slice(key.indexOf(":") + 1);
        yield* this.#react(live, post.target, platformMessageId, "received", false);
        yield* this.#react(live, post.target, platformMessageId, final.reaction, true);
      }
      if (final.answer)
        yield* adapter.postAnswer(post.target, final.text, placeholder).pipe(toMessagingOperationFailed);
      else if (final.text) yield* this.#say(adapter, post.target, placeholder, final.text);
      else if (placeholder && adapter.remove)
        yield* adapter.remove(post.target, placeholder).pipe(toMessagingOperationFailed);
      else if (placeholder)
        yield* this.#say(adapter, post.target, placeholder, sourceText("status.messaging.noAnswer"));
    }).pipe(
      Effect.tapError((failure) =>
        Effect.gen({ self: this }, function* () {
          const cause = failure instanceof MessagingOperationFailed ? failure.cause : null;
          const partlySent = cause instanceof WhatsAppAnswerPartlySent;
          if ((partlySent ? cause.cause : cause) instanceof WhatsAppRefusedError) {
            if (final.answer || final.replacesAnswer) this.#noteUndelivered(key, final.answer && partlySent);
            return yield* this.#forgetPost(key, post);
          }
          const quiet = final.answer && this.#quietEnd(live.record.connectionId, post.target);
          if (quiet && partlySent) return yield* this.#forgetPost(key, post);
          const failures = (this.#finalFailures.get(key) ?? 0) + 1;
          this.#finalFailures.set(key, failures);
          let current = post;
          if (final.answer) {
            current = {
              ...post,
              final: {
                answer: false,
                text: quiet ? "" : sourceText("status.messaging.failed"),
                reaction: null,
                replacesAnswer: true,
              },
            };
            this.#posts.set(key, current);
            yield* this.#status.save();
          }
          if (failures < FINAL_POST_ATTEMPTS) return this.#settleLater(live.record.connectionId);
          yield* this.#forgetPost(key, current);
        }),
      ),
    );
    yield* this.#forgetPost(key, post);
  });

  #noteUndelivered(key: string, partlySent: boolean): void {
    try {
      this.#threads.noteUndelivered(
        key.slice(0, key.indexOf(":")),
        sourceText(partlySent ? "status.messaging.whatsappPartlyDelivered" : "status.messaging.whatsappNotDelivered"),
      );
    } catch (error) {
      this.#warn(error, "Could not mark a WhatsApp answer as not delivered.");
    }
  }

  readonly #forgetPost = Effect.fn("MessagingService.forgetPost")(function* (
    this: MessagingService,
    key: string,
    post: StatusPost,
  ) {
    this.#finalFailures.delete(key);
    if (this.#posts.get(key) === post) this.#posts.delete(key);
    if (post.stopToken) this.#stops.delete(post.stopToken);
    yield* this.#status.save();
  });

  readonly #settleStatusPosts = Effect.fn("MessagingService.settleStatusPosts")(function* (
    this: MessagingService,
    live: LiveConnection,
  ) {
    const connectionId = live.record.connectionId;
    for (const [key, stored] of [...this.#posts]) {
      if (stored.connectionId !== connectionId) continue;
      const linkId = key.slice(0, key.indexOf(":"));
      let post = stored;
      if (!post.final) {
        if (!this.#status.restored.has(key)) continue;
        if (this.#threads.isPending(linkId, key.slice(linkId.length + 1))) continue;
        this.#status.restored.delete(key);
        const quiet = this.#withoutStatusPost(connectionId) || this.#quietEnd(connectionId, post.target);
        const text = quiet ? "" : sourceText("status.messaging.stopped");
        post = { ...post, final: { answer: false, text, reaction: "stopped" } };
        this.#posts.set(key, post);
      }
      this.#dispatch(this.#serial(linkId, this.#deliverFinal(live, key, post)));
    }
    const unposted = new Set([...this.#approvals.values()].filter((pending) => pending.connectionId === connectionId));
    for (const pending of unposted) {
      if (pending.messageId === null && !pending.answered && !pending.posting)
        this.#dispatch(this.#postApproval(live, pending));
    }
  });

  #settleLater(connectionId: string): void {
    if (!this.#started || this.#settleTimers.has(connectionId)) return;
    const timer = setTimeout(() => {
      this.#settleTimers.delete(connectionId);
      const live = this.#live.get(connectionId);
      if (live?.state === "connected") this.#dispatch(this.#settleStatusPosts(live));
      else if (live) this.#settleLater(connectionId);
    }, SETTLE_RETRY_MS);
    timer.unref?.();
    this.#settleTimers.set(connectionId, timer);
  }

  readonly #say = Effect.fn("MessagingService.say")(function* (
    this: MessagingService,
    adapter: MessagingAdapter,
    target: MessageTarget,
    placeholder: string | null,
    text: string,
  ) {
    if (placeholder) yield* adapter.edit(target, placeholder, { text }).pipe(toMessagingOperationFailed);
    else yield* adapter.post(target, { text }).pipe(toMessagingOperationFailed);
  });

  #dispatch<A>(operation: Effect.Effect<A, MessagingOperationFailed>): void {
    if (!this.#started) return;
    Effect.runFork(
      operation.pipe(
        Effect.catch((error) => Effect.sync(() => this.#warn(error.cause))),
        Effect.uninterruptible,
        Effect.forkIn(this.#scope, { startImmediately: true }),
      ),
    );
  }

  #agentEvent(event: AgentEvent): void {
    if (event.type === "approval")
      this.#dispatch(
        this.#approval(
          event.approval,
          this.#agents.approvalExecutionThreadId(event.approval.requestId) ?? event.approval.threadId,
        ),
      );
    else if (event.type === "agent-input-resolved" && event.kind === "approval")
      this.#dispatch(this.#approvalResolved(event.requestId));
  }

  readonly #approval = Effect.fn("MessagingService.approval")(function* (
    this: MessagingService,
    approval: AgentApproval,
    executionThreadId: string,
  ) {
    const own = this.#threads.store.linkForThread(executionThreadId);
    const request = own ? null : this.#threads.teammateRequest(approval.agentId, approval.turnId);
    const link = own ?? request?.link;
    if (!link) return;
    const origin = request?.origin ?? this.#threads.runningOrigin(link.linkId)?.origin;
    const key = origin ? `${link.linkId}:${origin.platformMessageId}` : null;
    const target = (key && this.#targets.get(key)) || (key && this.#posts.get(key)?.target) || linkTarget(link);
    const teammate = request
      ? this.#agents
          .listAgents()
          .find((agent) => agent.id === approval.agentId)
          ?.name.replace(MENTION_MARKERS, "")
      : undefined;
    const kind =
      approval.kind === "command"
        ? sourceText("status.messaging.approvalCommand")
        : approval.kind === "file-change"
          ? sourceText("status.messaging.approvalFileChange")
          : sourceText("status.messaging.approvalPermissions");
    const detail = redactText([approval.command, approval.cwd, approval.reason].filter(Boolean).join("\n"))
      .replace(MENTION_MARKERS, "")
      .slice(0, APPROVAL_TEXT_LIMIT);
    const text = [
      teammate
        ? sourceText("status.messaging.approvalTitleTeammate", { agent: teammate })
        : sourceText("status.messaging.approvalTitle"),
      `**${kind}**`,
      detail ? `\`\`\`\n${detail}\n\`\`\`` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const accept = token();
    const decline = token();
    const pending: PendingApproval = {
      requestId: approval.requestId,
      connectionId: link.connectionId,
      target,
      messageId: null,
      allowedUserId: origin?.authorId ?? null,
      text,
      answered: false,
      accept,
      decline,
      posting: false,
    };
    this.#approvals.set(accept, pending);
    this.#approvals.set(decline, pending);
    const live = this.#live.get(link.connectionId);
    if (live) yield* this.#postApproval(live, pending);
  });

  readonly #postApproval = Effect.fn("MessagingService.postApproval")(function* (
    this: MessagingService,
    live: LiveConnection,
    pending: PendingApproval,
  ) {
    pending.posting = true;
    yield* live.adapter
      .post(pending.target, {
        text: pending.text,
        buttons: [
          { action: "accept", label: sourceText("status.messaging.approve"), token: pending.accept, style: "primary" },
          { action: "decline", label: sourceText("status.messaging.deny"), token: pending.decline, style: "danger" },
        ],
      })
      .pipe(
        toMessagingOperationFailed,
        Effect.tap((messageId) =>
          Effect.sync(() => {
            pending.messageId = messageId;
          }),
        ),
        Effect.tapError(() => Effect.sync(() => this.#settleLater(pending.connectionId))),
        Effect.ensuring(
          Effect.sync(() => {
            pending.posting = false;
          }),
        ),
      );
  });

  readonly #approvalResolved = Effect.fn("MessagingService.approvalResolved")(function* (
    this: MessagingService,
    requestId: string | number,
  ) {
    const entries = [...this.#approvals.entries()].filter(([, pending]) => pending.requestId === requestId);
    const pending = entries[0]?.[1];
    for (const [key] of entries) this.#approvals.delete(key);
    if (!pending || pending.answered) return;
    const live = this.#live.get(pending.connectionId);
    const messageId = pending.messageId;
    if (!messageId || !live) return;
    yield* live.adapter
      .edit(pending.target, messageId, {
        text: `${pending.text}\n${sourceText("status.messaging.answeredOnHost")}`,
      })
      .pipe(toMessagingOperationFailed);
  });

  readonly #action = Effect.fn("MessagingService.action")(function* (
    this: MessagingService,
    live: LiveConnection,
    action: InboundAction,
  ) {
    const { adapter } = live;
    if (action.type === "stop") {
      const stop = this.#stops.get(action.token);
      if (!stop || stop.connectionId !== live.record.connectionId) return;
      if (action.actorId !== stop.authorId) {
        yield* adapter
          .postPrivate(
            action.target,
            action.actorId,
            sourceText("status.messaging.onlyRequester", { user: adapter.mention(stop.authorId) }),
            action.replyHandle,
          )
          .pipe(toMessagingOperationFailed);
        return;
      }
      yield* this.#threads.stop(stop.linkId, stop.authorId).pipe(toMessagingOperationFailed);
      return;
    }
    const pending = this.#approvals.get(action.token);
    if (!pending || pending.connectionId !== live.record.connectionId) {
      yield* adapter
        .edit(action.target, action.platformMessageId, { text: sourceText("status.messaging.requestInactive") })
        .pipe(Effect.catch(() => Effect.void));
      return;
    }
    if (!pending.allowedUserId || action.actorId !== pending.allowedUserId) {
      yield* adapter
        .postPrivate(
          action.target,
          action.actorId,
          pending.allowedUserId
            ? sourceText("status.messaging.onlyRequester", { user: adapter.mention(pending.allowedUserId) })
            : sourceText("status.messaging.hostOnly"),
          action.replyHandle,
        )
        .pipe(toMessagingOperationFailed);
      return;
    }
    pending.answered = true;
    const answered = yield* Effect.result(
      this.#agents
        .respondToApproval({ requestId: pending.requestId, decision: action.decision })
        .pipe(toMessagingOperationFailed),
    );
    const outcome = Result.isFailure(answered)
      ? sourceText("status.messaging.requestInactive")
      : sourceText(action.decision === "accept" ? "status.messaging.approvedBy" : "status.messaging.deniedBy", {
          user: adapter.mention(action.actorId),
        });
    for (const [key, candidate] of this.#approvals) if (candidate === pending) this.#approvals.delete(key);
    yield* adapter
      .edit(pending.target, pending.messageId ?? action.platformMessageId, {
        text: `${pending.text}\n${outcome}`,
      })
      .pipe(toMessagingOperationFailed);
  }, Effect.uninterruptible);

  readonly #serial = Effect.fn("MessagingService.serial")(function* (
    this: MessagingService,
    linkId: string,
    task: Effect.Effect<void, MessagingOperationFailed>,
  ) {
    const previous = this.#chains.get(linkId);
    const next = Deferred.makeUnsafe<void>();
    this.#chains.set(linkId, next);
    yield* Effect.forkIn(
      Effect.gen({ self: this }, function* () {
        if (previous) yield* Deferred.await(previous);
        yield* task.pipe(Effect.catch((error) => Effect.sync(() => this.#warn(error.cause))));
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            Deferred.doneUnsafe(next, Effect.void);
            if (this.#chains.get(linkId) === next) this.#chains.delete(linkId);
          }),
        ),
      ),
      this.#scope,
      { startImmediately: true, uninterruptible: true },
    );
  });

  #requireConnection(platform: MessagingPlatform, workspaceId: string): MessagingConnectionRecord {
    const record = this.#threads.store.connectionForWorkspace(platform, workspaceId);
    if (!record)
      throw new Error(
        sourceText(
          platform === "discord"
            ? "error.messaging.discordNotConnected"
            : platform === "telegram"
              ? "error.messaging.telegramNotConnected"
              : platform === "whatsapp"
                ? "error.messaging.whatsappNotConnected"
                : "error.messaging.notConnected",
        ),
      );
    return record;
  }

  #requireLinked(platform: MessagingPlatform, workspaceId: string): MessagingConnectionRecord {
    const record = this.#requireConnection(platform, workspaceId);
    if (record.lastErrorCode === "removed") throw new Error(sourceText("error.messaging.telegramNotConnected"));
    return record;
  }

  #requireTelegram(): { app: TelegramAppPort; ingress: MessagingIngress } {
    if (!this.#telegramApp || !this.#ingress) throw new Error(sourceText("error.messaging.telegramUnsupported"));
    return { app: this.#telegramApp, ingress: this.#ingress };
  }

  #requireConnect(): SlackConnect {
    if (!this.#connect) throw new Error(sourceText("error.messaging.unsupported"));
    return this.#connect;
  }

  #requireDiscordConnect(): DiscordConnect {
    if (!this.#discordConnect) throw new Error(sourceText("error.messaging.discordUnsupported"));
    return this.#discordConnect;
  }

  #pruneHistory(): void {
    try {
      const cutoff = Date.now() - WHATSAPP_HISTORY_KEEP_MS;
      const paths = this.#threads.history.prune(new Date(cutoff).toISOString());
      this.#whatsappRuntime?.deleteSavedFiles(paths);
      this.#whatsappRuntime?.pruneFiles(cutoff);
    } catch (cause) {
      this.#warn(cause);
    }
  }

  #warn(error: unknown, message = "A messaging action failed."): void {
    const code = isDynamicRecord(error) && isString(error.code) ? error.code : undefined;
    logger.warn(message, {
      error: error instanceof Error ? error.name : "unknown",
      ...(code ? { code } : {}),
    });
  }
}

function tooLarge(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  return (
    (isDynamicRecord(cause) && cause.code === "too_large") ||
    cause.message === "file_too_large" ||
    cause.message.endsWith("file is too big")
  );
}

function integrationsSection(layout: SidebarLayoutSnapshot): SidebarSection | undefined {
  const name = sourceText("status.messaging.integrationsSection");
  return layout.sections.find((section) => section.name === name);
}

function linkTarget(link: MessagingLink): MessageTarget {
  return { platformChannelId: link.platformChannelId, replyThreadId: link.threadKey };
}

function redactEmbed(embed: DiscordEmbed): DiscordEmbed {
  const mask = (value: string | undefined) => (value === undefined ? undefined : redactPostText(value));
  return {
    title: mask(embed.title),
    description: mask(embed.description),
    url: mask(embed.url),
    color: embed.color,
    timestamp: embed.timestamp,
    author: embed.author && {
      name: redactPostText(embed.author.name),
      url: mask(embed.author.url),
      icon_url: mask(embed.author.icon_url),
    },
    footer: embed.footer && { text: redactPostText(embed.footer.text), icon_url: mask(embed.footer.icon_url) },
    thumbnail: embed.thumbnail && { url: redactPostText(embed.thumbnail.url) },
    image: embed.image && { url: redactPostText(embed.image.url) },
    fields: embed.fields?.map((field) => ({
      name: redactPostText(field.name),
      value: redactPostText(field.value),
      inline: field.inline,
    })),
  };
}

const WHATSAPP_ALLOWED_PLACES =
  "This list has only the WhatsApp chats that the user allowed, not all chats of this number. For a chat that is not in it, tell the user to open Marketplace, then Apps, then WhatsApp, and to use Add contact or Add group for this number. A place with readOnly is read only: read its history, but OpenBot cannot post in it.";

const WHATSAPP_NOT_CONNECTED =
  "WhatsApp is not connected on this number now. Tell the user to open Marketplace, then Apps, then WhatsApp, and to use Reconnect or Link again for this number.";

const WHATSAPP_LOCAL_REFUSALS = new Map([
  [
    "place_not_allowed",
    "OpenBot sent nothing: the user did not allow this WhatsApp chat. Tell the user to open Marketplace, then Apps, then WhatsApp, and to use Add contact or Add group for this chat. Then the post can go to it.",
  ],
  [
    "place_read_only",
    "OpenBot sent nothing: the user made this WhatsApp chat read only. OpenBot reads it but never posts in it. Do not post it again: give the result in the conversation that you answer.",
  ],
  ["not_connected", WHATSAPP_NOT_CONNECTED],
  ["not_linked", WHATSAPP_NOT_CONNECTED],
  [
    "not_confirmed",
    "The WhatsApp connection dropped before WhatsApp confirmed the message, also after OpenBot sent it again. It can be in the chat already. Do not post it again only because of this error: tell the user to check the chat.",
  ],
]);

const DISCORD_NOT_LINKED =
  "This Discord server is not linked to this OpenBot server now. Another OpenBot server of the user may answer there. Tell the user to open Marketplace, then Apps, then Discord, and to select Reconnect for this Discord server if this server must answer there.";

const TELEGRAM_RELAY_REFUSALS = new Map([
  [
    "telegram_503 relay_unavailable",
    "OpenBot on this computer is not connected to the OpenBot service now. Telegram calls go through that service, so Telegram did not refuse this call, and the connection and place ids are not the cause. OpenBot connects again by itself. When a Telegram call fails again in a few minutes, tell the user that OpenBot on this computer cannot connect to its service, and that the computer must be online and signed in to OpenBot.",
  ],
  [
    "telegram_504 timeout",
    "The OpenBot service did not answer this Telegram call in time. Telegram did not refuse it, and the connection and place ids are not the cause.",
  ],
]);

function telegramNotReady(state: IngressState): MessagingOperationFailed {
  const text =
    state === "online"
      ? sourceText("error.messaging.telegramServiceUnavailable")
      : state === "signed_out" || state === "no_host"
        ? sourceText("error.messaging.telegramRelayUnavailable")
        : sourceText("error.messaging.telegramRelayUnreachable");
  return new MessagingOperationFailed({ cause: new Error(text) });
}

function refusal(failure: MessagingAdapterError): string {
  const cause = failure.cause;
  if (cause instanceof WhatsAppRefusedError)
    return `WhatsApp refused the message: ${cause.code}. It was not delivered. Do not post it again: tell the user that WhatsApp did not deliver it.`;
  const local = cause instanceof Error ? WHATSAPP_LOCAL_REFUSALS.get(cause.message) : undefined;
  if (local) return local;
  if (cause instanceof DiscordApiError && cause.code === "unknown_guild") return DISCORD_NOT_LINKED;
  const relay =
    cause instanceof TelegramCallError ? TELEGRAM_RELAY_REFUSALS.get(`${cause.code} ${cause.message}`) : undefined;
  if (relay) return relay;
  const code =
    cause instanceof SlackApiError || cause instanceof DiscordApiError || cause instanceof TelegramCallError
      ? cause.code
      : "no_answer";
  return `The platform refused the call: ${code}. Check the connection and place ids with openbot.messaging_list_places.`;
}

function roleName(name: string): string {
  if (name.length <= MESSAGING_LIMITS.roleName) return name;
  const cut = name.slice(0, MESSAGING_LIMITS.roleName);
  return /[\uD800-\uDBFF]$/u.test(cut) ? cut.slice(0, -1) : cut;
}

function isQuietAnswer(answer: string): boolean {
  return answer.trim().replace(/^[`*_"']+|[`*_"'.]+$/g, "") === QUIET_ANSWER;
}

function token(): string {
  return randomBytes(16).toString("hex");
}

function finalPost(
  activity: Exclude<MessagingActivity, { type: "started" | "progress" }>,
  awaitsTeammate: boolean,
  quiet: boolean,
  answerOnly: boolean,
  sendsFiles: boolean,
): PendingFinal {
  const reacts = activity.type === "cancelled" || !activity.followUp;
  if (activity.type === "cancelled" || activity.status === "interrupted")
    return {
      answer: false,
      text: quiet || answerOnly ? "" : sourceText("status.messaging.stopped"),
      reaction: reacts ? "stopped" : null,
    };
  if (activity.status === "failed")
    return {
      answer: false,
      text: quiet ? "" : (activity.reason ?? sourceText("status.messaging.failed")),
      reaction: reacts ? "failed" : null,
    };
  const reaction = reacts ? "done" : null;
  if (
    activity.answer &&
    (isQuietAnswer(activity.answer) || (activity.teammateRequest && RESULT_REPORT.test(activity.answer)))
  )
    return { answer: false, text: "", reaction };
  if (activity.answer) return { answer: true, text: redactPostText(activity.answer), reaction };
  if (answerOnly || activity.teammateRequest) return { answer: false, text: "", reaction };
  if (!activity.followUp && awaitsTeammate)
    return { answer: false, text: sourceText("status.messaging.delegated"), reaction };
  if (sendsFiles && activity.files.length) return { answer: false, text: "", reaction };
  return { answer: false, text: sourceText("status.messaging.noAnswer"), reaction };
}

function filteredRecent(
  adapter: MessagingAdapter,
  platformChannelId: string,
  threadKey: string | null,
  limit: number,
  filter: HistoryFilter,
): Effect.Effect<RecentMessages, MessagingAdapterError> {
  if (adapter.searchesHistory || (!filter.query && !filter.before))
    return adapter.recent(platformChannelId, threadKey, limit, filter);
  return adapter.recent(platformChannelId, threadKey, limit).pipe(
    Effect.map((recent) => ({
      messages: recent.messages.filter((entry) => matchesHistoryFilter(entry, filter)),
      note: [recent.note, `query and before searched only the newest ${limit} messages.`].filter(Boolean).join(" "),
    })),
  );
}

export class MessagingOperationFailed extends Schema.TaggedError<MessagingOperationFailed>()(
  "MessagingOperationFailed",
  {
    cause: Schema.Defect(),
  },
) {}

const {
  io: messagingIo,
  sync: messagingStep,
  rewrap: toMessagingOperationFailed,
} = causeHelpers(MessagingOperationFailed);
