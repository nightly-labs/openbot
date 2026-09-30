import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { ATTACHMENT_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentApproval,
  AgentEvent,
  AgentSummary,
  CreateSlackAppInput,
  MessagingConnection,
  MessagingConnectionState,
  MessagingCredentialState,
  MessagingOverview,
  MessagingPlatform,
  MessagingThread,
  RespondToApprovalInput,
  SlackOverview,
} from "@openbot/contracts/ipc";
import { MESSAGING_CONNECTION_STATES } from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import type { MessagingOrigin } from "../mailbox-store";
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
import { SlackManagedApps, type SlackManagerPort } from "./slack/slack-managed-apps";

const logger = createOpenBotLogger("messaging");

/**
 * The tokens of each connection, kept by the main process in encrypted storage. A key is a
 * connection id, or `slack-workspace:<id>` for the manager token of a Slack workspace.
 */
export interface MessagingCredentials {
  keys(): string[];
  status(connectionId: string): MessagingCredentialState;
  get(connectionId: string): Record<string, string> | null;
  set(connectionId: string, values: Record<string, string>): Promise<void>;
  clear(connectionId: string): Promise<void>;
  /** Removes the tokens of every key that is not listed. */
  retain(connectionIds: ReadonlySet<string>): Promise<void>;
}

export interface MessagingAgents {
  listAgents(): AgentSummary[];
  respondToApproval(input: RespondToApprovalInput): Promise<void>;
  onEvent(listener: (event: AgentEvent) => void): () => void;
}

export interface MessagingServiceOptions {
  threads: MessagingThreads;
  agents: MessagingAgents;
  credentials: MessagingCredentials;
  drivers: readonly MessagingDriver[];
  /** A private folder for files that arrive, until the mailbox has copied them. */
  downloadsRoot: string;
  /** The Signal relay of the Slack apps. Without it and `slackManager`, no Slack app can connect. */
  ingress?: MessagingIngress;
  slackManager?: SlackManagerPort;
  /** Only tests change this. */
  slackOrigin?: string;
}

interface LiveConnection {
  record: MessagingConnectionRecord;
  adapter: MessagingAdapter;
  transport: MessagingTransport | null;
  identity: ConnectionIdentity | null;
  state: MessagingConnectionState;
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

const FATAL_STATES = new Set<MessagingConnectionState>(["invalid_token"]);
const LIVE_STATES = new Set<MessagingConnectionState>(["connecting", "connected", "reconnecting", "rate_limited"]);
const APPROVAL_TEXT_LIMIT = 2_500;
const CANCEL_TEXT = /^(cancel|stop)$/i;
const RECENT_MESSAGES = 2_000;
/** The marker `mention` uses. Text that did not come from the host has it taken out. */
const MENTION_MARKERS = /[\uE000-\uE001]/g;

/**
 * Owns the live connections to chat platforms: it starts and stops each one's transport, turns
 * inbound messages into agent work through `MessagingThreads`, posts status and answers back, and
 * relays approvals and stop requests. It never stores a token: `MessagingCredentials` does. It is
 * platform-agnostic; everything a platform does goes through its `MessagingDriver`.
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
  readonly #chains = new Map<string, Promise<void>>();
  readonly #recent = new Set<string>();
  readonly #unsubscribe: Array<() => void> = [];
  readonly #ingress: MessagingIngress | null;
  readonly #managed: SlackManagedApps | null;
  #started = false;

  constructor(options: MessagingServiceOptions) {
    this.#threads = options.threads;
    this.#agents = options.agents;
    this.#credentials = options.credentials;
    this.#drivers = new Map(options.drivers.map((driver) => [driver.platform, driver]));
    this.#downloadsRoot = options.downloadsRoot;
    this.#ingress = options.ingress ?? null;
    this.#managed =
      options.ingress && options.slackManager
        ? new SlackManagedApps({
            store: options.threads.store,
            credentials: options.credentials,
            ingress: options.ingress,
            manager: options.slackManager,
            connections: {
              restart: (connectionId) => this.#restart(connectionId),
              stop: (connectionId) => this.#stopConnection(connectionId),
            },
            origin: options.slackOrigin,
          })
        : null;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#unsubscribe.push(
      this.#threads.onActivity((activity) => this.#serial(activity.link.linkId, () => this.#activity(activity))),
      this.#agents.onEvent((event) => this.#agentEvent(event)),
    );
    this.#threads.setContextSource((link, origin) => this.#promptContext(link, origin));
    this.#ingress?.handle((connectionId, delivery) => this.deliverSlack(connectionId, delivery));
    const records = this.#threads.store.connections();
    await this.#credentials.retain(this.#retainedKeys());
    const agents = new Set(this.#agents.listAgents().map((agent) => agent.id));
    await Promise.all(
      records
        .filter((record) => record.enabled && agents.has(record.agentId))
        .map((record) => this.#startConnection(record)),
    );
  }

  /**
   * Moves each Slack app to this host's current request URL and install address. The main process
   * calls it once the host's identity is loaded, because the account service issues the URL for a
   * named host only.
   */
  async syncSlackApps(): Promise<void> {
    await this.#managed?.sync(this.#agentMap(), true);
  }

  async stop(): Promise<void> {
    this.#started = false;
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
    this.#threads.setContextSource(null);
    this.#ingress?.handle(null);
    await Promise.all([...this.#live.values()].map((live) => live.transport?.stop()));
    this.#live.clear();
  }

  /** After the computer wakes, every socket may be dead without knowing it. */
  resume(): void {
    this.#ingress?.reconnect();
    for (const live of this.#live.values()) live.transport?.reconnect();
  }

  hasLiveConnection(): boolean {
    return [...this.#live.values()].some((live) => LIVE_STATES.has(live.state));
  }

  overview(agentId: string): MessagingOverview {
    this.#requireAgent(agentId);
    const record = this.#threads.store.connectionFor(agentId, "slack");
    return {
      connection: record ? this.#summary(record) : null,
      threads: this.#threads.list(agentId),
      slackWorkspaces: this.#managed?.workspaces() ?? [],
    };
  }

  /** Every agent's Slack connection, for Server settings > Connectors. A deleted agent's row is left out. */
  slackOverview(): SlackOverview {
    const agents = this.#agentMap();
    return {
      connections: this.#threads.store
        .connections()
        .filter((record) => record.platform === "slack" && agents.has(record.agentId))
        .map((record) => this.#summary(record)),
      workspaces: this.#managed?.workspaces() ?? [],
    };
  }

  readThread(agentId: string, linkId: string): MessagingThread {
    this.#requireAgent(agentId);
    return this.#threads.read(agentId, linkId);
  }

  async reconnect(agentId: string): Promise<MessagingOverview> {
    const record = this.#requireConnection(agentId);
    await this.#stopConnection(record.connectionId);
    this.#threads.store.updateConnection(record.connectionId, { enabled: true, lastErrorCode: null });
    const updated = this.#threads.store.connection(record.connectionId);
    if (updated) await this.#startConnection(updated);
    return this.overview(agentId);
  }

  async setEnabled(agentId: string, enabled: boolean): Promise<MessagingOverview> {
    const record = this.#requireConnection(agentId);
    await this.#stopConnection(record.connectionId);
    this.#threads.store.updateConnection(record.connectionId, { enabled, lastErrorCode: null });
    const updated = this.#threads.store.connection(record.connectionId);
    if (enabled && updated) await this.#startConnection(updated);
    return this.overview(agentId);
  }

  /**
   * Removes the tokens, stops the connection and deletes the agent's Slack app, which nothing else
   * can use. The conversations stay, for reading and for a later connect.
   */
  async disconnect(agentId: string): Promise<MessagingOverview> {
    const record = this.#requireConnection(agentId);
    await this.#stopConnection(record.connectionId);
    // The connection ends either way. When Slack keeps the app, the person is told, so they can
    // delete it in Slack: nothing on this computer can reach it after this.
    const appKept = await this.#managed
      ?.deleteApp(record.connectionId)
      .then(() => false)
      .catch((error) => {
        this.#warn(error);
        return true;
      });
    await this.#credentials.clear(record.connectionId);
    this.#threads.store.updateConnection(record.connectionId, {
      enabled: false,
      workspaceId: null,
      workspaceName: null,
      botUserId: null,
      appId: null,
      lastErrorCode: null,
    });
    if (appKept) throw new Error(sourceText("error.messaging.slackAppNotDeleted"));
    return this.overview(agentId);
  }

  // Managed Slack apps.

  /** Opens the OpenBot manager app's consent in the browser. A deep link to `completeSlackWorkspace` ends it. */
  async connectSlackWorkspace(): Promise<void> {
    await this.#requireManaged().startWorkspace();
  }

  /** False for a link that this run did not start. */
  completeSlackWorkspace(nonce: string, grant: string): Promise<boolean> {
    return this.#requireManaged().completeWorkspace(nonce, grant);
  }

  async disconnectSlackWorkspace(workspaceId: string): Promise<void> {
    await this.#requireManaged().disconnectWorkspace(workspaceId);
  }

  /** Creates the agent's own Slack app in the workspace and opens its install page. */
  async createSlackApp(input: CreateSlackAppInput): Promise<MessagingOverview> {
    const managed = this.#requireManaged();
    const agent = this.#requireAgent(input.agentId);
    const record = this.#threads.store.ensureConnection(input.agentId, "slack");
    await managed.createApp(record.connectionId, agent, input.workspaceId);
    return this.overview(input.agentId);
  }

  /** The app's addresses are brought up to date first: Slack refuses an install to an address it does not list. */
  async openSlackInstall(agentId: string): Promise<void> {
    const managed = this.#requireManaged();
    const record = this.#requireConnection(agentId);
    await managed.sync(this.#agentMap(), true);
    await managed.openInstall(record.connectionId);
  }

  /** Sets the agent's avatar as the icon of its Slack app. An icon Slack already has is not sent again. */
  async setSlackIcon(agentId: string, png: Uint8Array): Promise<void> {
    await this.#requireManaged().setIcon(this.#requireConnection(agentId).connectionId, png);
  }

  /** False for a link that this run did not start. */
  completeSlackInstall(state: string, code: string): Promise<boolean> {
    return this.#requireManaged().completeInstall(state, code);
  }

  /**
   * One request that Slack sent to a managed app's request URL. A paused connection answers 200, so
   * Slack does not send it again, and does nothing. An unknown one answers 404.
   */
  async deliverSlack(connectionId: string, delivery: IngressDelivery): Promise<IngressAnswer> {
    const check = this.#managed?.answerUrlCheck(connectionId, delivery);
    if (check) return check;
    const record = this.#threads.store.connection(connectionId);
    if (!record) return { status: 404 };
    if (!record.enabled) return { status: 200 };
    const transport = this.#live.get(connectionId)?.transport;
    if (!transport?.deliver) return { status: 503 };
    return transport.deliver(delivery);
  }

  // Connection lifecycle.

  async #startConnection(record: MessagingConnectionRecord): Promise<void> {
    const credentials = this.#credentials.get(record.connectionId);
    const driver = this.#drivers.get(record.platform);
    // A managed app that is not installed yet has no bot token: it waits for `completeSlackInstall`.
    if (!credentials || !driver || !credentials.botToken) return;
    const live: LiveConnection = {
      record,
      adapter: driver.createAdapter(credentials, {
        rateLimited: (retryAt) => {
          live.retryAt = retryAt;
          this.#setState(live, "rate_limited");
        },
      }),
      transport: null,
      identity: null,
      state: "connecting",
      retryAt: null,
    };
    this.#live.set(record.connectionId, live);
    try {
      live.identity = await live.adapter.identify();
    } catch (error) {
      if (this.#live.get(record.connectionId) !== live) return;
      if (error instanceof MessagingConnectionError) return this.#setState(live, error.state);
      // Slack is unreachable now. Reconnect tries again; a wake from sleep does too.
      live.transport = {
        start: () => undefined,
        reconnect: () => void this.#restart(record.connectionId),
        stop: async () => undefined,
      };
      return this.#setState(live, "reconnecting");
    }
    if (this.#live.get(record.connectionId) !== live) return;
    const identity = live.identity;
    this.#threads.store.updateConnection(record.connectionId, {
      workspaceId: identity.workspaceId,
      workspaceName: identity.workspaceName,
      botUserId: identity.botUserId,
      appId: identity.appId,
    });
    live.record = this.#threads.store.connection(record.connectionId) ?? record;
    const transport = driver.createTransport(credentials, identity);
    live.transport = transport;
    transport.start({
      state: (state) => {
        if (state === "connected") live.retryAt = null;
        this.#setState(live, state);
      },
      message: (message) => void this.#receive(live, message).catch((error) => this.#warn(error)),
      action: (action) => void this.#action(live, action).catch((error) => this.#warn(error)),
      placeCreated: (platformChannelId) =>
        void live.adapter.joinPlace?.(platformChannelId).catch((error) => this.#warn(error)),
    });
    // So people can mention the agent in any public channel without inviting it first. Channels
    // made while the host was off are joined here too.
    void live.adapter.joinPublicPlaces?.().catch((error) => this.#warn(error));
  }

  async #restart(connectionId: string): Promise<void> {
    await this.#stopConnection(connectionId);
    const record = this.#threads.store.connection(connectionId);
    if (record?.enabled) await this.#startConnection(record);
  }

  async #stopConnection(connectionId: string): Promise<void> {
    const live = this.#live.get(connectionId);
    this.#live.delete(connectionId);
    await live?.transport?.stop();
  }

  #setState(live: LiveConnection, state: MessagingConnectionState): void {
    live.state = state;
    if (FATAL_STATES.has(state)) {
      this.#threads.store.updateConnection(live.record.connectionId, { lastErrorCode: state });
      logger.warn("A messaging connection stopped.", { platform: live.record.platform, state });
    }
  }

  #summary(record: MessagingConnectionRecord): MessagingConnection {
    const live = this.#live.get(record.connectionId);
    const credentials = this.#credentials.status(record.connectionId);
    const values = credentials === "saved" ? this.#credentials.get(record.connectionId) : null;
    const stored = isOneOf(MESSAGING_CONNECTION_STATES, record.lastErrorCode) ? record.lastErrorCode : null;
    const state: MessagingConnectionState = !record.enabled
      ? "paused"
      : credentials === "unreadable"
        ? "secret_storage_unavailable"
        : values && !values.botToken
          ? "awaiting_install"
          : (live?.state ?? stored ?? "connecting");
    return {
      agentId: record.agentId,
      platform: record.platform,
      enabled: record.enabled,
      state,
      workspaceName: record.workspaceName,
      botUserId: record.botUserId,
      missingScopes: live?.identity?.missingScopes ?? [],
      retryAt: state === "rate_limited" ? (live?.retryAt ?? null) : null,
      credentials,
    };
  }

  // Inbound.

  async #receive(live: LiveConnection, message: InboundMessage): Promise<void> {
    const agent = this.#agents.listAgents().find((candidate) => candidate.id === live.record.agentId);
    if (!agent || !live.identity) return;
    // Before any await: a redelivered event can arrive while the first copy is still downloading its
    // files, before the mailbox holds its idempotency key. The mailbox key covers a restart.
    const dedupKey = `${live.record.connectionId}:${message.dedupKey}`;
    if (this.#recent.has(dedupKey)) return;
    this.#recent.add(dedupKey);
    if (this.#recent.size > RECENT_MESSAGES) {
      const oldest = this.#recent.values().next().value;
      if (oldest !== undefined) this.#recent.delete(oldest);
    }
    const store = this.#threads.store;
    const existing = store.linkByKey(live.record.connectionId, message.platformChannelId, message.threadKey);
    if (message.requiresLink && !existing) return;
    if (existing && CANCEL_TEXT.test(message.text) && message.files.length === 0) {
      if (await this.#threads.stop(existing.linkId, message.authorId)) {
        await live.adapter.react(message.target, message.platformMessageId, "stopped", true).catch(() => undefined);
        return;
      }
    }
    const { adapter } = live;
    const authorName = await adapter.authorName(message.authorId);
    const place = message.isDirect ? null : await adapter.placeName(message.platformChannelId);
    const staging = join(this.#downloadsRoot, randomUUID());
    try {
      const { paths, skipped } = await this.#download(adapter, message, staging);
      const text = skipped.length
        ? `${message.text}\n\n(Files that did not arrive: ${skipped.join(", ")})`
        : message.text;
      const result = await this.#threads.receive({
        connectionId: live.record.connectionId,
        agentId: agent.id,
        platformChannelId: message.platformChannelId,
        threadKey: message.threadKey,
        isDirect: message.isDirect,
        title: message.isDirect ? authorName : `${place} · ${message.text.slice(0, 80) || authorName}`,
        text,
        sourcePaths: paths,
        origin: { authorId: message.authorId, authorName, platformMessageId: message.platformMessageId },
        idempotencyKey: `messaging:${live.record.connectionId}:${message.dedupKey}`,
      });
      if (result.status === "duplicate") return;
      const key = `${result.link.linkId}:${message.platformMessageId}`;
      if (result.status === "busy") {
        await adapter.post(message.target, { text: sourceText("status.messaging.busy", { name: agent.name }) });
        await adapter.react(message.target, message.platformMessageId, "failed", true).catch(() => undefined);
        return;
      }
      this.#targets.set(key, message.target);
      await adapter.react(message.target, message.platformMessageId, "received", true).catch(() => undefined);
      // In the same order as the turn's own posts: a turn that already started has its status post.
      if (result.waiting)
        this.#serial(result.link.linkId, async () => {
          if (this.#posts.has(key) || !this.#targets.has(key)) return;
          const messageId = await adapter.post(message.target, {
            text: sourceText("status.messaging.queued", { name: agent.name }),
          });
          this.#posts.set(key, {
            connectionId: live.record.connectionId,
            target: message.target,
            messageId,
            stopToken: null,
          });
        });
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  /** Downloads the files of a message into `staging`, within the attachment limits. */
  async #download(
    adapter: MessagingAdapter,
    message: InboundMessage,
    staging: string,
  ): Promise<{ paths: string[]; skipped: string[] }> {
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
      try {
        await mkdir(join(staging, String(index)), { recursive: true, mode: 0o700 });
        // The name comes from another person, so only its last segment is used.
        const destination = join(staging, String(index), basename(file.name) || "file");
        await adapter.download(
          file,
          destination,
          Math.min(ATTACHMENT_LIMITS.fileBytes, ATTACHMENT_LIMITS.totalBytes - total),
        );
        total += file.size;
        paths.push(destination);
      } catch {
        skipped.push(file.name);
      }
    }
    return { paths, skipped };
  }

  async #promptContext(link: MessagingLink, origin: MessagingOrigin) {
    const live = this.#live.get(link.connectionId);
    const workspaceName = live?.record.workspaceName ?? null;
    if (!live) return { workspaceName, place: link.title, messages: [], cursor: null, skippedFiles: [] };
    const place = link.isDirect ? "direct message" : await live.adapter.placeName(link.platformChannelId);
    const messages = await live.adapter
      .history(link.platformChannelId, link.threadKey, link.historyCursor, origin.platformMessageId)
      .catch(() => []);
    return { workspaceName, place, messages, cursor: origin.platformMessageId, skippedFiles: [] };
  }

  // Outbound.

  async #activity(activity: MessagingActivity): Promise<void> {
    const live = this.#live.get(activity.link.connectionId);
    if (!live || !activity.origin) return;
    const { adapter } = live;
    const agentName = this.#agentName(activity.link.agentId);
    const key = `${activity.link.linkId}:${activity.origin.platformMessageId}`;
    const target = this.#targets.get(key) ?? linkTarget(activity.link);
    const post = this.#posts.get(key);
    if (activity.type === "started") {
      const stopToken = token();
      this.#stops.set(stopToken, {
        linkId: activity.link.linkId,
        authorId: activity.origin.authorId,
        connectionId: live.record.connectionId,
      });
      const body = {
        text: sourceText("status.messaging.working"),
        buttons: [{ action: "stop" as const, label: sourceText("status.messaging.stop"), token: stopToken }],
      };
      const messageId = post?.messageId
        ? await adapter.edit(target, post.messageId, body).then(() => post.messageId)
        : await adapter.post(target, body);
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
      await adapter.react(target, activity.origin.platformMessageId, "received", false).catch(() => undefined);
      await adapter.react(target, activity.origin.platformMessageId, reaction, true).catch(() => undefined);
    }
    if (activity.type === "cancelled" || activity.status === "interrupted") {
      await this.#say(adapter, target, placeholder, sourceText("status.messaging.stopped"));
      return;
    }
    if (activity.status === "failed") {
      // The provider's error can hold local paths or MCP values, so Slack gets a fixed sentence.
      await this.#say(adapter, target, placeholder, sourceText("status.messaging.failed", { name: agentName }));
      return;
    }
    if (activity.answer) await adapter.postAnswer(target, activity.answer, placeholder);
    else await this.#say(adapter, target, placeholder, sourceText("status.messaging.noAnswer", { name: agentName }));
    if (activity.files.length) {
      const skipped = await adapter.upload(target, activity.files);
      if (skipped.length)
        await adapter.post(target, {
          text: sourceText("status.messaging.filesSkipped", { names: skipped.join(", ") }),
        });
    }
  }

  async #say(
    adapter: MessagingAdapter,
    target: MessageTarget,
    placeholder: string | null,
    text: string,
  ): Promise<void> {
    if (placeholder) await adapter.edit(target, placeholder, { text });
    else await adapter.post(target, { text });
  }

  #agentEvent(event: AgentEvent): void {
    if (event.type === "approval") void this.#approval(event.approval).catch((error) => this.#warn(error));
    else if (event.type === "agent-input-resolved" && event.kind === "approval")
      void this.#approvalResolved(event.requestId).catch((error) => this.#warn(error));
    else if (event.type === "prompt")
      void this.#question(event.threadId, event.agentId).catch((error) => this.#warn(error));
    else if (event.type === "agents-changed")
      void this.#forgetDeletedAgents(event.agents)
        .then(() => this.#managed?.sync(new Map(event.agents.map((agent) => [agent.id, agent]))))
        .catch((error) => this.#warn(error));
  }

  async #approval(approval: AgentApproval): Promise<void> {
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
      sourceText("status.messaging.approvalTitle", { name: this.#agentName(link.agentId) }),
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
    try {
      pending.messageId = await live.adapter.post(target, {
        text,
        buttons: [
          { action: "accept", label: sourceText("status.messaging.approve"), token: accept, style: "primary" },
          { action: "decline", label: sourceText("status.messaging.deny"), token: decline, style: "danger" },
        ],
      });
    } catch (error) {
      this.#approvals.delete(accept);
      this.#approvals.delete(decline);
      throw error;
    }
  }

  async #approvalResolved(requestId: string | number): Promise<void> {
    const entries = [...this.#approvals.entries()].filter(([, pending]) => pending.requestId === requestId);
    const pending = entries[0]?.[1];
    for (const [key] of entries) this.#approvals.delete(key);
    if (!pending || pending.answered) return;
    const live = this.#live.get(pending.connectionId);
    if (!pending.messageId) return;
    await live?.adapter.edit(pending.target, pending.messageId, {
      text: `${pending.text}\n${sourceText("status.messaging.answeredOnHost")}`,
    });
  }

  async #question(threadId: string, agentId: string): Promise<void> {
    const link = this.#threads.store.linkForThread(threadId);
    const live = link ? this.#live.get(link.connectionId) : undefined;
    if (!link || !live) return;
    await live.adapter.post(linkTarget(link), {
      text: sourceText("status.messaging.questionOnHost", { name: this.#agentName(agentId) }),
    });
  }

  async #action(live: LiveConnection, action: InboundAction): Promise<void> {
    const { adapter } = live;
    if (action.type === "stop") {
      const stop = this.#stops.get(action.token);
      if (!stop || stop.connectionId !== live.record.connectionId) return;
      if (action.actorId !== stop.authorId) {
        await adapter.postPrivate(
          action.target,
          action.actorId,
          sourceText("status.messaging.onlyRequester", { user: adapter.mention(stop.authorId) }),
        );
        return;
      }
      await this.#threads.stop(stop.linkId, stop.authorId);
      return;
    }
    const pending = this.#approvals.get(action.token);
    if (!pending || pending.connectionId !== live.record.connectionId) {
      await adapter
        .edit(action.target, action.platformMessageId, { text: sourceText("status.messaging.requestInactive") })
        .catch(() => undefined);
      return;
    }
    if (!pending.allowedUserId || action.actorId !== pending.allowedUserId) {
      await adapter.postPrivate(
        action.target,
        action.actorId,
        pending.allowedUserId
          ? sourceText("status.messaging.onlyRequester", { user: adapter.mention(pending.allowedUserId) })
          : sourceText("status.messaging.hostOnly"),
      );
      return;
    }
    pending.answered = true;
    let outcome: string;
    try {
      await this.#agents.respondToApproval({ requestId: pending.requestId, decision: action.decision });
      outcome = sourceText(action.decision === "accept" ? "status.messaging.approvedBy" : "status.messaging.deniedBy", {
        user: adapter.mention(action.actorId),
      });
    } catch {
      outcome = sourceText("status.messaging.requestInactive");
    }
    for (const [key, candidate] of this.#approvals) if (candidate === pending) this.#approvals.delete(key);
    await adapter.edit(pending.target, pending.messageId ?? action.platformMessageId, {
      text: `${pending.text}\n${outcome}`,
    });
  }

  /**
   * A deleted agent's links are already gone with it. This stops its socket, deletes a Slack app
   * that OpenBot managed for it, and removes its tokens.
   */
  async #forgetDeletedAgents(agents: readonly AgentSummary[]): Promise<void> {
    const ids = new Set(agents.map((agent) => agent.id));
    for (const [connectionId, live] of this.#live) {
      if (ids.has(live.record.agentId)) continue;
      await this.#stopConnection(connectionId);
    }
    // The rows of a deleted agent's connections are gone with it, installed or not. Their saved
    // credentials name each app, so the apps are deleted before the credentials are.
    const retained = this.#retainedKeys();
    for (const key of this.#credentials.keys()) {
      if (!retained.has(key)) await this.#managed?.deleteApp(key).catch((error) => this.#warn(error));
    }
    await this.#credentials.retain(retained);
  }

  /** The credential keys that still belong to something: each connection, and each Slack workspace. */
  #retainedKeys(): Set<string> {
    return new Set([
      ...this.#threads.store.connections().map((record) => record.connectionId),
      ...(this.#managed?.workspaceKeys() ?? []),
    ]);
  }

  #agentMap(): Map<string, AgentSummary> {
    return new Map(this.#agents.listAgents().map((agent) => [agent.id, agent]));
  }

  #requireManaged(): SlackManagedApps {
    if (!this.#managed) throw new Error(sourceText("error.messaging.unsupported"));
    return this.#managed;
  }

  // Helpers.

  /**
   * Runs the posts of one conversation in order. A turn can start and end while the post that
   * announced it is still on its way, and the answer must replace that post, not race it.
   */
  #serial(linkId: string, task: () => Promise<void>): void {
    const next = (this.#chains.get(linkId) ?? Promise.resolve())
      .then(task)
      .catch((error) => this.#warn(error))
      .finally(() => {
        if (this.#chains.get(linkId) === next) this.#chains.delete(linkId);
      });
    this.#chains.set(linkId, next);
  }

  #requireAgent(agentId: string): AgentSummary {
    const agent = this.#agents.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(sourceText("error.team.agentNotFound"));
    return agent;
  }

  #requireConnection(agentId: string): MessagingConnectionRecord {
    this.#requireAgent(agentId);
    const record = this.#threads.store.connectionFor(agentId, "slack");
    if (!record) throw new Error(sourceText("error.messaging.notConnected"));
    return record;
  }

  #agentName(agentId: string): string {
    return this.#agents.listAgents().find((agent) => agent.id === agentId)?.name ?? "The agent";
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

/** Where to answer when the message that started the work is not known: the thread, or the DM. */
function linkTarget(link: MessagingLink): MessageTarget {
  return { platformChannelId: link.platformChannelId, replyThreadId: link.isDirect ? null : link.threadKey };
}

function token(): string {
  return randomBytes(16).toString("hex");
}
