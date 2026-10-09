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
  MessagingConnection,
  MessagingConnectionState,
  MessagingCredentialState,
  MessagingOverview,
  MessagingPlatform,
  RespondToApprovalInput,
} from "@openbot/contracts/ipc";
import { MESSAGING_CONNECTION_STATES } from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { TELEGRAM_LINK_CODE_TTL_SECONDS } from "@openbot/contracts/signal-protocol/telegram-route";
import { SLACK_ORCHESTRATOR_AVATAR } from "@openbot/contracts/slack-app";
import { TELEGRAM_ORCHESTRATOR_AVATAR } from "@openbot/contracts/telegram-app";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { Deferred, Effect, Exit, Result, Schema, Scope } from "effect";
import type { AgentLifecycleFailed } from "../agent-service";
import { causeHelpers } from "../effect-boundary";
import type { MessagingOrigin } from "../mailbox-store";
import type { SidebarLayoutStore } from "../sidebar-layout-store";
import { type DiscordAppPort, DiscordConnect, type DiscordConnectFailed } from "./discord/discord-connect";
import { discordOrchestratorMemories, discordOrchestratorProfile } from "./discord/discord-orchestrator";
import type { MessagingConnectionRecord, MessagingLink } from "./messaging-store";
import type { MessagingActivity, MessagingThreads } from "./messaging-threads";
import {
  type ConnectionIdentity,
  type InboundAction,
  type InboundMessage,
  type IngressAnswer,
  type IngressDelivery,
  type MessageTarget,
  type MessagingAdapter,
  MessagingConnectionError,
  type MessagingDriver,
  type MessagingIngress,
  type MessagingTransport,
} from "./messaging-types";
import { type SlackAppPort, SlackConnect, type SlackConnectFailed } from "./slack/slack-connect";
import { slackOrchestratorMemories, slackOrchestratorProfile } from "./slack/slack-orchestrator";
import { SlackWebApi } from "./slack/slack-web-api";
import { type TelegramAppPort, telegramLinkUrl } from "./telegram/telegram-connect";
import { telegramOrchestratorMemories, telegramOrchestratorProfile } from "./telegram/telegram-orchestrator";
import { parseTelegramUpdate, telegramLink, telegramRemoval } from "./telegram/telegram-updates";

const logger = createOpenBotLogger("messaging");

/** The tokens of each connection, kept by the main process in encrypted storage, by connection id. */
export interface MessagingCredentials {
  keys(): string[];
  status(connectionId: string): MessagingCredentialState;
  get(connectionId: string): Record<string, string> | null;
  set(connectionId: string, values: Record<string, string>): Effect.Effect<void, MessagingOperationFailed>;
  clear(connectionId: string): Effect.Effect<void, MessagingOperationFailed>;
  /** Removes the tokens of every key that is not listed. */
  retain(connectionIds: ReadonlySet<string>): Effect.Effect<void, MessagingOperationFailed>;
}

export interface MessagingAgents {
  listAgents(): AgentSummary[];
  respondToApproval(input: RespondToApprovalInput): Effect.Effect<void, AgentLifecycleFailed>;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  /** Creates an agent with no first message, on the named model or a new agent's default. */
  createAgentProfile(
    input: Pick<AddMessagingOrchestratorInput, "provider" | "model" | "reasoningEffort"> & {
      name: string;
      title: string;
      description: string;
      avatarSeed: string;
      avatarHue: AgentSummary["avatarHue"];
    },
  ): Effect.Effect<AgentSummary, AgentLifecycleFailed>;
  createMemory(input: { agentId: string; text: string }): unknown;
}

export interface MessagingServiceOptions {
  threads: MessagingThreads;
  agents: MessagingAgents;
  credentials: MessagingCredentials;
  drivers: readonly MessagingDriver[];
  /** A private folder for files that arrive, until the mailbox has copied them. */
  downloadsRoot: string;
  /**
   * The Signal relay of the OpenBot Slack and Discord apps. Without it and `slackApp` or
   * `discordApp`, no workspace of that platform can connect.
   */
  ingress?: MessagingIngress;
  slackApp?: SlackAppPort;
  discordApp?: DiscordAppPort;
  /** Only tests change this. */
  slackOrigin?: string;
  /** The account service half of the OpenBot Telegram bot. Without it and `ingress`, no chat can connect. */
  telegramApp?: TelegramAppPort;
  /** Where the Slack, Discord and Telegram Orchestrators go in the sidebar: an Integrations section. */
  sidebar?: Pick<SidebarLayoutStore, "getSnapshot" | "mutate">;
}

interface LiveConnection {
  record: MessagingConnectionRecord;
  adapter: MessagingAdapter;
  transport: MessagingTransport | null;
  identity: ConnectionIdentity | null;
  state: MessagingConnectionState;
  /** The last state the transport reported. A rate limit ends in it. */
  reported: MessagingConnectionState;
  retryAt: string | null;
}

/** The status post of one external message, which the answer replaces. */
interface StatusPost {
  connectionId: string;
  target: MessageTarget;
  messageId: string | null;
  stopToken: string | null;
}

interface PendingApproval {
  requestId: string | number;
  connectionId: string;
  target: MessageTarget;
  /** Null until Slack answers the post. A button press can arrive first, and it names its message. */
  messageId: string | null;
  /** The Slack user whose message started the turn. Null when it is not known, then only the host answers. */
  allowedUserId: string | null;
  text: string;
  answered: boolean;
}

const FATAL_STATES = new Set<MessagingConnectionState>(["invalid_token", "removed"]);
const LIVE_STATES = new Set<MessagingConnectionState>(["connecting", "connected", "reconnecting", "rate_limited"]);
const APPROVAL_TEXT_LIMIT = 2_500;
const CANCEL_TEXT = /^(cancel|stop)$/i;
const RECENT_MESSAGES = 2_000;
/** How long a Telegram link waits for the Signal socket. */
const TELEGRAM_READY_TIMEOUT_MS = 15_000;
/** How long a connection waits before it tries Slack again after Slack was unreachable. */
const IDENTIFY_RETRY_MS = 30_000;
/** The marker `mention` uses. Text that did not come from the host has it taken out. */
const MENTION_MARKERS = /[\uE000-\uE001]/g;

/**
 * Owns the live connections to chat platform workspaces: it starts and stops each one's transport,
 * picks the agent of each new conversation with the router agent, turns inbound messages into agent
 * work through `MessagingThreads`, posts status and answers back as OpenBot, and relays approvals
 * and stop requests. It never stores a token: `MessagingCredentials` does. It is platform-agnostic;
 * everything a platform does goes through its `MessagingDriver`.
 */
export class MessagingService {
  readonly #threads: MessagingThreads;
  readonly #agents: MessagingAgents;
  readonly #credentials: MessagingCredentials;
  readonly #drivers: ReadonlyMap<MessagingPlatform, MessagingDriver>;
  readonly #downloadsRoot: string;
  readonly #live = new Map<string, LiveConnection>();
  /** Status posts by `linkId:platformMessageId`, until the turn that answers the message ends. */
  readonly #posts = new Map<string, StatusPost>();
  /** The reply target of each external message, by `linkId:platformMessageId`. */
  readonly #targets = new Map<string, MessageTarget>();
  readonly #approvals = new Map<string, PendingApproval>();
  readonly #stops = new Map<string, { linkId: string; authorId: string; connectionId: string }>();
  readonly #chains = new Map<string, Deferred.Deferred<void>>();
  readonly #recent = new Set<string>();
  readonly #unsubscribe: Array<() => void> = [];
  readonly #ingress: MessagingIngress | null;
  readonly #connect: SlackConnect | null;
  readonly #discordConnect: DiscordConnect | null;
  readonly #slackOrigin: string | undefined;
  readonly #telegramApp: TelegramAppPort | null;
  readonly #sidebar: Pick<SidebarLayoutStore, "getSnapshot" | "mutate"> | null;
  #started = false;
  /** Holds the ingress socket open while a Telegram link code waits for its chat. */
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
    this.#sidebar = options.sidebar ?? null;
  }

  readonly start = Effect.fn("MessagingService.start")(function* (
    this: MessagingService,
  ): Effect.fn.Return<void, MessagingOperationFailed> {
    if (this.#started) return;
    this.#started = true;
    this.#scope = Scope.makeUnsafe();
    this.#unsubscribe.push(
      this.#threads.onActivity((activity) => {
        this.#dispatch(this.#serial(activity.link.linkId, this.#activity(activity)));
      }),
      this.#agents.onEvent((event) => this.#agentEvent(event)),
    );
    this.#threads.setContextSource((link, origin) => this.#promptContext(link, origin));
    this.#ingress?.handle((workspaceId, delivery) => this.deliver(workspaceId, delivery));
    const records = this.#threads.store.connections();
    yield* this.#credentials.retain(new Set(records.map((record) => record.connectionId)));
    yield* Effect.forEach(
      records.filter((record) => record.enabled),
      (record) => this.#startConnection(record),
      { concurrency: "unbounded", discard: true },
    );
  }).bind(this);

  readonly stop = Effect.fn("MessagingService.stop")(function* (
    this: MessagingService,
  ): Effect.fn.Return<void, MessagingOperationFailed> {
    this.#started = false;
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
    this.#threads.setContextSource(null);
    this.#ingress?.handle(null);
    this.#endTelegramLinkLease();
    yield* Effect.forEach(
      [...this.#live.values()],
      (live) => {
        const transport = live.transport;
        return transport ? transport.stop() : Effect.void;
      },
      { concurrency: "unbounded", discard: true },
    );
    this.#live.clear();
    yield* Scope.close(this.#scope, Exit.void);
  }, Effect.uninterruptible).bind(this);

  /** After the computer wakes, every socket may be dead without knowing it. */
  resume(): void {
    this.#ingress?.reconnect();
    for (const live of this.#live.values()) live.transport?.reconnect();
  }

  hasLiveConnection(): boolean {
    return [...this.#live.values()].some((live) => LIVE_STATES.has(live.state));
  }

  /** The Slack workspaces of this computer, for Server settings > Connectors. A disconnected one is left out. */
  slackOverview(): MessagingOverview {
    return this.#overview("slack");
  }

  /** The Discord guilds of this computer, for Server settings > Connectors. A disconnected one is left out. */
  discordOverview(): MessagingOverview {
    return this.#overview("discord");
  }

  /** The Telegram chats linked to this computer. A disconnected one is left out. */
  telegramOverview(): MessagingOverview {
    return this.#overview("telegram");
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
  ): Effect.fn.Return<void, MessagingOperationFailed> {
    const record = yield* messagingStep(() => this.#requireLinked(platform, workspaceId));
    // A guild that removed the bot has no bot to reconnect to and no link: it must install it again.
    if (platform === "discord" && record.lastErrorCode === "invalid_token") return yield* this.connectDiscordGuild();
    yield* this.#stopConnection(record.connectionId);
    this.#threads.store.updateConnection(record.connectionId, { enabled: true, lastErrorCode: null });
    const updated = this.#threads.store.connection(record.connectionId);
    if (updated) yield* this.#startConnection(updated);
    this.#ingress?.reconnect();
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
    const record = yield* messagingStep(() => this.#requireConnection(platform, input.workspaceId));
    const current = this.#agents.listAgents().find((agent) => agent.id === record.orchestratorAgentId);
    if (current) return { agentId: current.id, sectionId: null };
    const discord = platform === "discord";
    const agent = yield* this.#agents
      .createAgentProfile({
        ...(discord ? discordOrchestratorProfile() : slackOrchestratorProfile()),
        ...(discord ? DISCORD_ORCHESTRATOR_AVATAR : SLACK_ORCHESTRATOR_AVATAR),
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      })
      .pipe(toMessagingOperationFailed);
    const memories = discord
      ? discordOrchestratorMemories(record.workspaceName)
      : slackOrchestratorMemories(record.workspaceName);
    for (const text of memories) this.#agents.createMemory({ agentId: agent.id, text });
    this.#threads.store.updateConnection(record.connectionId, { orchestratorAgentId: agent.id });
    // A sidebar it cannot reach leaves the agent where new agents go; the orchestrator still answers.
    const sectionId = yield* this.#placeInIntegrations(agent.id).pipe(
      Effect.catch((failure) => {
        this.#warn(failure.cause);
        return Effect.succeed(null);
      }),
    );
    return { agentId: agent.id, sectionId };
  }, Effect.uninterruptible).bind(this);

  /**
   * Puts the orchestrator in the sidebar's Integrations section, which it creates the first time, so
   * the agents that serve an integration stay apart from the user's own. Returns the section id.
   */
  readonly #placeInIntegrations = Effect.fn("MessagingService.placeInIntegrations")(function* (
    this: MessagingService,
    agentId: string,
  ) {
    const sidebar = this.#sidebar;
    if (!sidebar) return null;
    const name = sourceText("status.messaging.integrationsSection");
    const agentIds = new Set(this.#agents.listAgents().map((agent) => agent.id));
    const existing = sidebar.getSnapshot().sections.find((section) => section.name === name);
    const layout = yield* sidebar
      .mutate(
        existing ? { type: "assign", agentId, sectionId: existing.id } : { type: "create", name, agentId },
        agentIds,
      )
      .pipe(toMessagingOperationFailed);
    return layout.agentAssignments[agentId] ?? null;
  });

  /** Opens the OpenBot Slack app's install in the browser. A deep link to `completeSlackWorkspace` ends it. */
  readonly connectSlackWorkspace = Effect.fn("MessagingService.connectSlackWorkspace")(function* (
    this: MessagingService,
  ) {
    const connect = yield* messagingStep(() => this.#requireConnect());
    yield* connect.start().pipe(toMessagingOperationFailed);
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
    });
    const updated = this.#threads.store.connection(record.connectionId);
    if (updated) yield* this.#startConnection(updated);
    // Signal learns the workspaces of this host when the socket connects.
    this.#ingress?.reconnect();
    return true;
  }, Effect.uninterruptible).bind(this);

  readonly disconnectSlackWorkspace = Effect.fn("MessagingService.disconnectSlackWorkspace")(function* (
    this: MessagingService,
    workspaceId: string,
  ) {
    const record = yield* messagingStep(() => this.#requireConnection("slack", workspaceId));
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
  }, Effect.uninterruptible).bind(this);

  /** Opens the OpenBot Discord app's install in the browser. A deep link to `completeDiscordGuild` ends it. */
  readonly connectDiscordGuild = Effect.fn("MessagingService.connectDiscordGuild")(function* (this: MessagingService) {
    const connect = yield* messagingStep(() => this.#requireDiscordConnect());
    yield* connect.start().pipe(toMessagingOperationFailed);
  }).bind(this);

  /**
   * Stores the guild that the account service linked to this host, and starts its connection. The
   * grant holds no token: the bot token stays in Signal.
   */
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
    });
    const updated = this.#threads.store.connection(record.connectionId);
    if (updated) yield* this.#startConnection(updated);
    // Signal learns the guilds of this host when the socket connects.
    this.#ingress?.reconnect();
    return true;
  }, Effect.uninterruptible).bind(this);

  /**
   * Unlinks the guild, then stops its connection and forgets it. OpenBot stays in the guild until a
   * guild admin removes it. When the unlink fails, nothing changes, so the user can try again: the
   * guild stays linked to this host until the account service unlinks it.
   */
  readonly disconnectDiscordGuild = Effect.fn("MessagingService.disconnectDiscordGuild")(function* (
    this: MessagingService,
    guildId: string,
  ) {
    const record = yield* messagingStep(() => this.#requireConnection("discord", guildId));
    if (this.#discordConnect) yield* this.#discordConnect.unlink(guildId).pipe(toMessagingOperationFailed);
    yield* this.#stopConnection(record.connectionId);
    yield* this.#credentials.clear(record.connectionId);
    yield* messagingStep(() =>
      this.#threads.store.updateConnection(record.connectionId, { enabled: false, lastErrorCode: null }),
    );
    this.#ingress?.reconnect();
  }, Effect.uninterruptible).bind(this);

  /**
   * One event that Signal passed on for a workspace: a Slack request, whose signature Signal has
   * checked, a Discord event, or a Telegram update. A paused connection answers 200, so Slack does not
   * send it again, and does nothing. An unknown workspace answers 404.
   */
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
    const transport = this.#live.get(record.connectionId)?.transport;
    if (!transport?.deliver) return { status: 503 };
    return yield* transport.deliver(delivery);
  }).bind(this);

  /**
   * Creates the Telegram Orchestrator, or gives the one that exists to every Telegram chat. One agent
   * answers every chat, so a chat linked later gets it too.
   */
  readonly addTelegramOrchestrator = Effect.fn("MessagingService.addTelegramOrchestrator")(function* (
    this: MessagingService,
    input: AddTelegramOrchestratorInput,
  ) {
    const records = this.#threads.store.connections().filter((record) => record.platform === "telegram");
    if (!records.length)
      return yield* new MessagingOperationFailed({
        cause: new Error(sourceText("error.messaging.telegramNotConnected")),
      });
    const current = this.#telegramOrchestrator();
    if (current) {
      this.#assignTelegramOrchestrator(current);
      return { agentId: current, sectionId: null };
    }
    const agent = yield* this.#agents
      .createAgentProfile({
        ...telegramOrchestratorProfile(),
        ...TELEGRAM_ORCHESTRATOR_AVATAR,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      })
      .pipe(toMessagingOperationFailed);
    for (const text of telegramOrchestratorMemories()) this.#agents.createMemory({ agentId: agent.id, text });
    this.#assignTelegramOrchestrator(agent.id);
    const sectionId = yield* this.#placeInIntegrations(agent.id).pipe(
      Effect.catch((failure) => {
        this.#warn(failure.cause);
        return Effect.succeed(null);
      }),
    );
    return { agentId: agent.id, sectionId };
  }, Effect.uninterruptible).bind(this);

  /**
   * Opens a `t.me` link with a one-use code in the browser. Telegram sends the code in the chat that
   * the user adds the bot to, and Signal links that chat to this host (`#deliverTelegram`).
   */
  readonly connectTelegramChat = Effect.fn("MessagingService.connectTelegramChat")(function* (
    this: MessagingService,
    place: ConnectTelegramChatInput["place"],
  ) {
    const { app, ingress } = yield* messagingStep(() => this.#requireTelegram());
    // Signal routes the new chat to this host's socket when the chat sends the code. With no
    // connection running, nothing else holds the socket open, so the code holds it until it expires.
    this.#endTelegramLinkLease();
    const release = ingress.acquire("telegram");
    const timer = setTimeout(() => this.#endTelegramLinkLease(), TELEGRAM_LINK_CODE_TTL_SECONDS * 1_000);
    timer.unref?.();
    this.#telegramLinkLease = { release, timer };
    // Opened before the socket is ready, Telegram could send the code while Signal has no socket to
    // route the new chat to.
    const link = yield* Effect.all([this.#telegramReady(ingress), app.createLink()], { concurrency: "unbounded" }).pipe(
      Effect.map(([, created]) => created),
      Effect.onError(() => Effect.sync(() => this.#endTelegramLinkLease())),
    );
    yield* messagingIo(() => app.openExternal(telegramLinkUrl(link.botUsername, link.code, place)));
  }).bind(this);

  /** Waits a short time for the socket to be open with a Signal that has Telegram. */
  #telegramReady(ingress: MessagingIngress): Effect.Effect<void, MessagingOperationFailed> {
    const unavailable = () =>
      new MessagingOperationFailed({ cause: new Error(sourceText("error.messaging.telegramRelayUnavailable")) });
    if (ingress.telegram.available()) return Effect.void;
    // A Signal that answered without Telegram does not gain it on this socket.
    if (ingress.state() === "online") return Effect.fail(unavailable());
    return Effect.callback<void>((resume) => {
      const stop = ingress.onState(() => {
        if (!ingress.telegram.available()) return;
        stop();
        resume(Effect.void);
      });
      return Effect.sync(stop);
    }).pipe(Effect.timeoutOrElse({ duration: TELEGRAM_READY_TIMEOUT_MS, orElse: () => Effect.fail(unavailable()) }));
  }

  #endTelegramLinkLease(): void {
    const lease = this.#telegramLinkLease;
    this.#telegramLinkLease = null;
    if (!lease) return;
    clearTimeout(lease.timer);
    lease.release();
  }

  /**
   * The bot leaves the chat, and the chat is unlinked from this host. The conversations stay in
   * OpenBot, and a later link of the same chat gives them back their agents.
   */
  readonly disconnectTelegramChat = Effect.fn("MessagingService.disconnectTelegramChat")(function* (
    this: MessagingService,
    chatId: string,
  ) {
    const { app, ingress } = yield* messagingStep(() => this.#requireTelegram());
    const record = yield* messagingStep(() => this.#requireConnection("telegram", chatId));
    const botId = this.#credentials.get(record.connectionId)?.botId;
    // The chat's transport may be the last holder of the socket. The call needs it open, and it must
    // come before the unlink: Signal accepts a call only for a chat that is routed to this host.
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
    yield* this.#credentials.clear(record.connectionId);
    yield* messagingStep(() =>
      this.#threads.store.updateConnection(record.connectionId, { enabled: false, lastErrorCode: null }),
    );
    yield* app.unlink(chatId).pipe(Effect.catch((failure) => Effect.sync(() => this.#warn(failure.cause))));
  }, Effect.uninterruptible).bind(this);

  /**
   * One Telegram update of a chat routed to this host, which Signal has checked. A `/start <code>`
   * links the chat only when Signal marks it `linked`: the account service matched the code to this
   * host. Anyone in a routed chat can send a `/start` with a made-up code.
   */
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
    // A chat that both the production and the development bot are in answers only its own bot.
    if (!record || (record.appId && record.appId !== botId)) return;
    const transport = record.enabled ? this.#live.get(record.connectionId)?.transport : undefined;
    if (transport?.deliver) {
      yield* transport.deliver(delivery);
      return;
    }
    // A paused chat has no transport, and Telegram does not send a removal again. Without this, a
    // resume shows the chat as connected, and Signal keeps routing it here. A disconnected chat has no
    // credentials, and the removal is the echo of its `leaveChat`.
    if (
      record.lastErrorCode === "removed" ||
      this.#credentials.status(record.connectionId) === "missing" ||
      !telegramRemoval(update, botId, chatId)
    )
      return;
    yield* this.#stopConnection(record.connectionId);
    // As for a running chat: the summary shows `removed` rather than `paused`, with no Resume.
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
      orchestratorAgentId: this.#orchestrator(record) ?? this.#telegramOrchestrator(),
    });
    const updated = this.#threads.store.connection(record.connectionId);
    if (updated) yield* this.#startConnection(updated);
    // The chat's transport holds the socket from here.
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

  /** The Telegram Orchestrator: one agent for every Telegram chat, or null until the user adds it. */
  #telegramOrchestrator(): string | null {
    const agents = new Set(this.#agents.listAgents().map((agent) => agent.id));
    for (const record of this.#threads.store.connections())
      if (record.platform === "telegram" && record.orchestratorAgentId && agents.has(record.orchestratorAgentId))
        return record.orchestratorAgentId;
    return null;
  }

  #assignTelegramOrchestrator(agentId: string): void {
    for (const record of this.#threads.store.connections())
      if (record.platform === "telegram" && record.orchestratorAgentId !== agentId)
        this.#threads.store.updateConnection(record.connectionId, { orchestratorAgentId: agentId });
  }

  // Connection lifecycle.

  readonly #startConnection = Effect.fn("MessagingService.startConnection")(function* (
    this: MessagingService,
    record: MessagingConnectionRecord,
  ) {
    const credentials = this.#credentials.get(record.connectionId);
    const driver = this.#drivers.get(record.platform);
    if (!driver || !credentials?.[driver.requiredCredential]) return;
    // A chat that removed the bot is unlinked: its transport would report the socket, not the chat.
    if (record.lastErrorCode === "removed") return;
    const live: LiveConnection = {
      record,
      adapter: driver.createAdapter(credentials, {
        rateLimited: (retryAt) => {
          live.retryAt = retryAt;
          this.#dispatch(this.#setState(live, "rate_limited"));
          // The platform said when it can take calls again. A newer limit replaces this one.
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
      // Slack is unreachable now. Try again later; Reconnect and a wake from sleep do it at once.
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
    // So people can mention OpenBot in any public channel without inviting it first. Channels made
    // while the host was off are joined here too.
    const join = live.adapter.joinPublicPlaces?.();
    if (join)
      yield* Effect.forkIn(
        join.pipe(Effect.catch((error) => Effect.sync(() => this.#warn(error.cause)))),
        this.#scope,
        { startImmediately: true },
      );
  });

  /** The chat has a new title. The credentials keep it too, so the next start does not take the old one. */
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
    live.state = state;
    if (FATAL_STATES.has(state)) {
      this.#threads.store.updateConnection(live.record.connectionId, { lastErrorCode: state });
      logger.warn("A messaging connection stopped.", { platform: live.record.platform, state });
      // The workspace uninstalled OpenBot or revoked its token, or the bot left the Telegram chat:
      // Signal stops routing it here.
      const unlink:
        | Effect.Effect<void, DiscordConnectFailed | SlackConnectFailed | MessagingOperationFailed>
        | undefined =
        live.record.platform === "telegram"
          ? this.#telegramApp?.unlink(live.record.workspaceId)
          : live.record.platform === "discord"
            ? this.#discordConnect?.unlink(live.record.workspaceId)
            : this.#connect?.unlink(live.record.workspaceId);
      if (unlink) yield* unlink.pipe(Effect.catch((error) => Effect.sync(() => this.#warn(error.cause))));
      // The summary then shows the stored state, which a reconnect of the socket cannot change.
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
    // Before any await: a redelivered event can arrive while the first copy is still downloading its
    // files, before the mailbox holds its idempotency key. The mailbox key covers a restart.
    const store = this.#threads.store;
    const existing = store.linkByKey(live.record.connectionId, message.platformChannelId, message.threadKey);
    // Before the dedup key: a reply with a mention also arrives as `app_mention`, which must still run.
    if (message.requiresLink && !existing) return;
    const dedupKey = `${live.record.connectionId}:${message.dedupKey}`;
    if (this.#recent.has(dedupKey)) return;
    this.#recent.add(dedupKey);
    if (this.#recent.size > RECENT_MESSAGES) {
      const oldest = this.#recent.values().next().value;
      if (oldest !== undefined) this.#recent.delete(oldest);
    }
    if (existing && CANCEL_TEXT.test(message.text) && message.files.length === 0) {
      if (yield* this.#threads.stop(existing.linkId, message.authorId).pipe(toMessagingOperationFailed)) {
        yield* live.adapter
          .react(message.target, message.platformMessageId, "stopped", true)
          .pipe(Effect.catch(() => Effect.void));
        return;
      }
    }
    const { adapter } = live;
    const authorName = yield* adapter.authorName(message.authorId).pipe(toMessagingOperationFailed);
    const place = message.isDirect
      ? null
      : yield* adapter.placeName(message.platformChannelId).pipe(toMessagingOperationFailed);
    // A conversation keeps its agent. A new one goes to the workspace's orchestrator, which asks its
    // teammates; without one, nothing answers.
    const agentId = existing?.agentId ?? this.#orchestrator(live.record);
    if (!agentId) {
      const noAgent =
        live.record.platform === "discord"
          ? "status.messaging.discordNoAgent"
          : live.record.platform === "telegram"
            ? "status.messaging.telegramNoAgent"
            : "status.messaging.noAgent";
      yield* adapter.post(message.target, { text: sourceText(noAgent) }).pipe(toMessagingOperationFailed);
      return;
    }
    const staging = join(this.#downloadsRoot, randomUUID());
    yield* Effect.acquireUseRelease(
      Effect.succeed(staging),
      () =>
        Effect.gen({ self: this }, function* () {
          const { paths, skipped } = yield* this.#download(adapter, message, staging);
          const text = skipped.length
            ? `${message.text}\n\n(Files that did not arrive: ${skipped.join(", ")})`
            : message.text;
          const result = yield* this.#threads
            .receive({
              connectionId: live.record.connectionId,
              agentId,
              platformChannelId: message.platformChannelId,
              threadKey: message.threadKey,
              isDirect: message.isDirect,
              title: message.isDirect ? authorName : `${place} · ${message.text.slice(0, 80) || authorName}`,
              text,
              sourcePaths: paths,
              origin: { authorId: message.authorId, authorName, platformMessageId: message.platformMessageId },
              idempotencyKey: `messaging:${live.record.connectionId}:${message.dedupKey}`,
            })
            .pipe(toMessagingOperationFailed);
          if (result.status === "duplicate") return;
          const key = `${result.link.linkId}:${message.platformMessageId}`;
          if (result.status === "busy") {
            yield* adapter
              .post(message.target, { text: sourceText("status.messaging.busy") })
              .pipe(toMessagingOperationFailed);
            yield* adapter
              .react(message.target, message.platformMessageId, "failed", true)
              .pipe(Effect.catch(() => Effect.void));
            return;
          }
          this.#targets.set(key, message.target);
          yield* adapter
            .react(message.target, message.platformMessageId, "received", true)
            .pipe(Effect.catch(() => Effect.void));
          // In the same order as the turn's own posts: a turn that already started has its status post.
          if (result.waiting)
            yield* this.#serial(
              result.link.linkId,
              Effect.gen({ self: this }, function* () {
                if (this.#posts.has(key) || !this.#targets.has(key)) return;
                const messageId = yield* adapter
                  .post(message.target, { text: sourceText("status.messaging.queued") })
                  .pipe(toMessagingOperationFailed);
                this.#posts.set(key, {
                  connectionId: live.record.connectionId,
                  target: message.target,
                  messageId,
                  stopToken: null,
                });
              }),
            );
        }),
      () => messagingIo(() => rm(staging, { recursive: true, force: true })).pipe(Effect.orDie),
    );
  }, Effect.uninterruptible);

  #orchestrator(record: MessagingConnectionRecord): string | null {
    const id = this.#threads.store.connection(record.connectionId)?.orchestratorAgentId ?? null;
    return id && this.#agents.listAgents().some((agent) => agent.id === id) ? id : null;
  }

  /** Downloads the files of a message into `staging`, within the attachment limits. */
  readonly #download = Effect.fn("MessagingService.download")(function* (
    this: MessagingService,
    adapter: MessagingAdapter,
    message: InboundMessage,
    staging: string,
  ) {
    const paths: string[] = [];
    const skipped: string[] = [];
    let total = 0;
    for (const [index, file] of message.files.entries()) {
      if (
        paths.length >= INPUT_LIMITS.attachments ||
        file.size > ATTACHMENT_LIMITS.fileBytes ||
        total + file.size > ATTACHMENT_LIMITS.totalBytes
      ) {
        skipped.push(file.name);
        continue;
      }
      const downloaded = yield* Effect.result(
        Effect.gen(function* () {
          yield* messagingIo(() => mkdir(join(staging, String(index)), { recursive: true, mode: 0o700 }));
          // Only the final path segment can come from the external file name.
          const destination = join(staging, String(index), basename(file.name) || "file");
          yield* adapter
            .download(file, destination, Math.min(ATTACHMENT_LIMITS.fileBytes, ATTACHMENT_LIMITS.totalBytes - total))
            .pipe(toMessagingOperationFailed);
          return destination;
        }),
      );
      if (Result.isFailure(downloaded)) skipped.push(file.name);
      else {
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

  readonly #activity = Effect.fn("MessagingService.activity")(function* (
    this: MessagingService,
    activity: MessagingActivity,
  ) {
    const live = this.#live.get(activity.link.connectionId);
    if (!live || !activity.origin) return;
    const { adapter } = live;
    const origin = activity.origin;
    const key = `${activity.link.linkId}:${origin.platformMessageId}`;
    const target = this.#targets.get(key) ?? linkTarget(activity.link);
    const post = this.#posts.get(key);
    if (activity.type === "started") {
      const stopToken = token();
      this.#stops.set(stopToken, {
        linkId: activity.link.linkId,
        authorId: origin.authorId,
        connectionId: live.record.connectionId,
      });
      const body = {
        text: sourceText("status.messaging.working"),
        buttons: [{ action: "stop" as const, label: sourceText("status.messaging.stop"), token: stopToken }],
      };
      const existingMessageId = post?.messageId;
      const messageId = existingMessageId
        ? yield* adapter
            .edit(target, existingMessageId, body)
            .pipe(toMessagingOperationFailed)
            .pipe(Effect.as(existingMessageId))
        : yield* adapter.post(target, body).pipe(toMessagingOperationFailed);
      this.#posts.set(key, { connectionId: live.record.connectionId, target, messageId, stopToken });
      return;
    }
    this.#posts.delete(key);
    this.#targets.delete(key);
    if (post?.stopToken) this.#stops.delete(post.stopToken);
    const placeholder = post?.messageId ?? null;
    const reaction =
      activity.type === "cancelled"
        ? "stopped"
        : activity.status === "completed"
          ? "done"
          : activity.status === "interrupted"
            ? "stopped"
            : "failed";
    // A follow-up turn answers a teammate's reply: the person's message already shows how its own turn ended.
    if (activity.type === "cancelled" || !activity.followUp) {
      yield* adapter.react(target, origin.platformMessageId, "received", false).pipe(Effect.catch(() => Effect.void));
      yield* adapter.react(target, origin.platformMessageId, reaction, true).pipe(Effect.catch(() => Effect.void));
    }
    if (activity.type === "cancelled" || activity.status === "interrupted") {
      yield* this.#say(adapter, target, placeholder, sourceText("status.messaging.stopped"));
      return;
    }
    if (activity.status === "failed") {
      // The provider's error can hold local paths or MCP values, so Slack gets a fixed sentence.
      yield* this.#say(adapter, target, placeholder, sourceText("status.messaging.failed"));
      return;
    }
    // Slack is outside this computer, so a secret in the answer must not reach it.
    if (activity.answer) {
      const answer = redactText(activity.answer);
      yield* adapter.postAnswer(target, answer, placeholder).pipe(toMessagingOperationFailed);
    }
    // A turn that only asked a teammate has nothing to say yet: the answer comes back to this thread.
    else if (!activity.followUp && this.#threads.awaitsTeammate(activity.link.linkId))
      yield* this.#say(adapter, target, placeholder, sourceText("status.messaging.delegated"));
    else yield* this.#say(adapter, target, placeholder, sourceText("status.messaging.noAnswer"));
    if (activity.files.length) {
      const skipped = yield* adapter.upload(target, activity.files).pipe(toMessagingOperationFailed);
      if (skipped.length)
        yield* adapter
          .post(target, {
            text: sourceText("status.messaging.filesSkipped", { names: skipped.join(", ") }),
          })
          .pipe(toMessagingOperationFailed);
    }
  });

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
    if (event.type === "approval") this.#dispatch(this.#approval(event.approval));
    else if (event.type === "agent-input-resolved" && event.kind === "approval")
      this.#dispatch(this.#approvalResolved(event.requestId));
  }

  readonly #approval = Effect.fn("MessagingService.approval")(function* (
    this: MessagingService,
    approval: AgentApproval,
  ) {
    const link = this.#threads.store.linkForThread(approval.threadId);
    const live = link ? this.#live.get(link.connectionId) : undefined;
    if (!link || !live) return;
    const running = this.#threads.runningOrigin(link.linkId);
    const key = running ? `${link.linkId}:${running.origin.platformMessageId}` : null;
    const target = (key && this.#targets.get(key)) || (key && this.#posts.get(key)?.target) || linkTarget(link);
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
      sourceText("status.messaging.approvalTitle"),
      `**${kind}**`,
      detail ? `\`\`\`\n${detail}\n\`\`\`` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const accept = token();
    const decline = token();
    // Known before the post: a person can press a button before Slack's answer to the post arrives.
    const pending: PendingApproval = {
      requestId: approval.requestId,
      connectionId: live.record.connectionId,
      target,
      messageId: null,
      allowedUserId: running?.origin.authorId ?? null,
      text,
      answered: false,
    };
    this.#approvals.set(accept, pending);
    this.#approvals.set(decline, pending);
    pending.messageId = yield* live.adapter
      .post(target, {
        text,
        buttons: [
          { action: "accept", label: sourceText("status.messaging.approve"), token: accept, style: "primary" },
          { action: "decline", label: sourceText("status.messaging.deny"), token: decline, style: "danger" },
        ],
      })
      .pipe(toMessagingOperationFailed)
      .pipe(
        Effect.onError(() =>
          Effect.sync(() => {
            this.#approvals.delete(accept);
            this.#approvals.delete(decline);
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

  // Helpers.

  /**
   * Runs the posts of one conversation in order. A turn can start and end while the post that
   * announced it is still on its way, and the answer must replace that post, not race it.
   */
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
              : "error.messaging.notConnected",
        ),
      );
    return record;
  }

  /** A connection that can start again. A chat that removed the bot needs a new link first. */
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

  #warn(error: unknown): void {
    // Only the kind of failure and the platform's error code: a Slack error message can quote
    // message text, and its code cannot.
    const code = isDynamicRecord(error) && isString(error.code) ? error.code : undefined;
    logger.warn("A messaging action failed.", {
      error: error instanceof Error ? error.name : "unknown",
      ...(code ? { code } : {}),
    });
  }
}

/** Where to answer when the message that started the work is not known: the conversation's thread. */
function linkTarget(link: MessagingLink): MessageTarget {
  return { platformChannelId: link.platformChannelId, replyThreadId: link.threadKey };
}

function token(): string {
  return randomBytes(16).toString("hex");
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
