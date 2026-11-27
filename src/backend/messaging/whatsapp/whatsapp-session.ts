import { createOpenBotLogger } from "@openbot/logging";
import type { WhatsAppAuthStore } from "@openbot/whatsapp/auth-store";
import {
  type AnyMessageContent,
  type BaileysEventMap,
  type BinaryNode,
  Browsers,
  type ConnectionState,
  DEFAULT_CONNECTION_CONFIG,
  DisconnectReason,
  fetchLatestWaWebVersion,
  type GroupMetadata,
  generateMessageIDV2,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  type MiscMessageGenerationOptions,
  makeCacheableSignalKeyStore,
  proto,
  type SocketConfig,
  type UserFacingSocketConfig,
  type WAMessage,
  type WAMessageKey,
  type WAVersion,
} from "@openbot/whatsapp/baileys";
import { Effect } from "effect";
import { MessagingAdapterError, WhatsAppRefusedError } from "../messaging-types";
import type { WhatsAppUpsertWindow } from "./whatsapp-events";

const logger = createOpenBotLogger("whatsapp");

export interface WhatsAppSocket {
  ev: { on<T extends keyof BaileysEventMap>(event: T, listener: (arg: BaileysEventMap[T]) => void): void };
  ws: {
    on(event: "frame", listener: () => void): unknown;
    on(event: typeof MESSAGE_ACK, listener: (node: WhatsAppAck) => void): unknown;
    on(event: typeof NODE_HANDLING, listener: (node: BinaryNode, started: boolean) => void): unknown;
  };
  user?: { id: string } | undefined;
  sendMessage(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
  ): Promise<WAMessage | undefined>;
  requestPairingCode(phoneNumber: string): Promise<string>;
  logout(): Promise<void>;
  end(error: Error | undefined): void;
  groupFetchAllParticipating(): Promise<{ [jid: string]: GroupMetadata }>;
  groupMetadata(jid: string): Promise<GroupMetadata>;
  onWhatsApp(...phoneNumbers: string[]): Promise<Array<{ jid: string; exists: boolean }> | undefined>;
  updateMediaMessage(message: WAMessage): Promise<WAMessage>;
  signalRepository: {
    lidMapping: {
      getPNForLID(lid: string): Promise<string | null>;
      getLIDForPN(pn: string): Promise<string | null>;
    };
  };
}

export interface WhatsAppAck {
  attrs: { id?: string; error?: string };
}

export const MESSAGE_ACK = "CB:ack,class:message";

export const NODE_HANDLING = "openbot:node";

export type WhatsAppSocketFactory = (config: UserFacingSocketConfig) => WhatsAppSocket;

export type WhatsAppSessionState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "failing"
  | "logged_out"
  | "replaced"
  | "unreachable"
  | "stopped";

export type CloseDecision = "fatal" | "replaced" | "restart" | "timeout" | "unreachable" | "retry";

const KEEP_ALIVE_MS = 25_000;
const CONNECT_TIMEOUT_MS = 60_000;
const QUERY_TIMEOUT_MS = 60_000;
const VERSION_TIMEOUT_MS = 5_000;
const BACKOFF_START_MS = 2_000;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_FACTOR = 1.8;
const BACKOFF_JITTER = 0.25;
const FAILING_AFTER_ATTEMPTS = 12;
const STABLE_MS = 60_000;
const WATCHDOG_SILENCE_MS = 90_000;
const WATCHDOG_INTERVAL_MS = 15_000;
const STALL_MS = 5 * 60_000;
const STALL_LIMIT = 3;
const STALL_WINDOW_MS = 60 * 60_000;
const SEND_DEADLINE_MS = 5 * 60_000;
const ACK_WAIT_MS = 10_000;
const LID_WAIT_MS = 5_000;
const NO_LID_TTL_MS = 10 * 60_000;
const CHAT_MEMORY_LIMIT = 1_000;
const SEND_ATTEMPTS = 3;
const CHAT_PACING_MS = 1_000;
const ECHO_TTL_MS = 20 * 60_000;
const ECHO_LIMIT = 5_000;
const GROUP_CACHE_MS = 5 * 60_000;
const VERSION_META = "wa-version";
const UNREAD_LIMIT = 200;
const HISTORY_KEPT: ReadonlySet<proto.Message.HistorySyncType> = new Set([
  proto.Message.HistorySyncType.INITIAL_BOOTSTRAP,
  proto.Message.HistorySyncType.PUSH_NAME,
  proto.Message.HistorySyncType.NON_BLOCKING_DATA,
]);

export function closeDecision(
  code: number | undefined,
  pairing: boolean,
  restartedOnce: boolean,
  codeShown: boolean,
): CloseDecision {
  if (
    code === DisconnectReason.loggedOut ||
    code === DisconnectReason.forbidden ||
    code === DisconnectReason.multideviceMismatch
  )
    return "fatal";
  if (code === DisconnectReason.connectionReplaced) return "replaced";
  if (code === DisconnectReason.restartRequired) return "restart";
  if (pairing && !codeShown) return "unreachable";
  if (pairing && code === DisconnectReason.timedOut) return restartedOnce ? "timeout" : "restart";
  return "retry";
}

export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * BACKOFF_FACTOR ** attempt);
  return Math.round(base * (1 - BACKOFF_JITTER + 2 * BACKOFF_JITTER * random()));
}

export interface WhatsAppSessionOptions {
  store: WhatsAppAuthStore;
  createSocket: WhatsAppSocketFactory;
  makeSignalRepository: SocketConfig["makeSignalRepository"];
  pairing?: boolean;
  fetchVersion?: () => Promise<WAVersion | null>;
  now?: () => number;
  readOnly?: (jid: string) => boolean;
}

type UpsertListener = (event: { messages: WAMessage[]; type: string }) => void;

type AckResult = { error: string | undefined } | "closed" | "timeout";

export class WhatsAppSession {
  readonly #store: WhatsAppAuthStore;
  readonly #createSocket: WhatsAppSocketFactory;
  readonly #makeSignalRepository: SocketConfig["makeSignalRepository"];
  #pairing: boolean;
  readonly #fetchVersion: () => Promise<WAVersion | null>;
  readonly #now: () => number;
  readonly #readOnly: (jid: string) => boolean;
  readonly #stateListeners = new Set<(state: WhatsAppSessionState) => void>();
  readonly #upsertListeners = new Set<UpsertListener>();
  readonly #unread: Array<{ messages: WAMessage[]; type: string }> = [];
  readonly #qrListeners = new Set<(qr: string) => void>();
  readonly #openWaiters = new Set<() => void>();
  readonly #echoes = new Map<string, number>();
  readonly #acks = new Map<string, (result: AckResult) => void>();
  readonly #chatQueues = new Map<string, Promise<unknown>>();
  readonly #lastSend = new Map<string, number>();
  readonly #postChats = new Map<string, string>();
  readonly #noLid = new Map<string, number>();
  readonly #groups = new Map<string, { metadata: GroupMetadata; at: number }>();
  readonly #handling = new Map<BinaryNode, number>();
  #stalls: number[] = [];
  #socket: WhatsAppSocket | null = null;
  #state: WhatsAppSessionState = "stopped";
  #started = false;
  #browserName = "OpenBot";
  #attempt = 0;
  #restartedOnce = false;
  #codeShown = false;
  #openedAt = 0;
  #socketOpenedAt = 0;
  #historySent = false;
  #historySentAtOpen = false;
  #lastFrameAt = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #watchdog: ReturnType<typeof setInterval> | null = null;
  #version: WAVersion | null = null;

  constructor(options: WhatsAppSessionOptions) {
    this.#store = options.store;
    this.#createSocket = options.createSocket;
    this.#makeSignalRepository = options.makeSignalRepository;
    this.#pairing = options.pairing ?? false;
    this.#fetchVersion = options.fetchVersion ?? webVersion;
    this.#now = options.now ?? Date.now;
    this.#readOnly = options.readOnly ?? (() => false);
  }

  get state(): WhatsAppSessionState {
    return this.#state;
  }

  get openedAt(): number {
    return this.#openedAt;
  }

  upsertWindow(): WhatsAppUpsertWindow {
    return { openedAt: this.#openedAt, synced: this.#historySentAtOpen, now: this.#now() };
  }

  get store(): WhatsAppAuthStore {
    return this.#store;
  }

  socket(): WhatsAppSocket | null {
    return this.#state === "open" ? this.#socket : null;
  }

  onState(listener: (state: WhatsAppSessionState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  onUpsert(listener: UpsertListener): () => void {
    this.#upsertListeners.add(listener);
    for (const event of this.#unread.splice(0)) listener(event);
    return () => this.#upsertListeners.delete(listener);
  }

  finishPairing(): void {
    this.#pairing = false;
  }

  onQr(listener: (qr: string) => void): () => void {
    this.#qrListeners.add(listener);
    return () => this.#qrListeners.delete(listener);
  }

  start(options: { codeLink?: boolean } = {}): void {
    if (this.#started) return;
    this.#started = true;
    this.#historySent = this.#store.linked;
    this.#browserName = options.codeLink ? "Chrome" : "OpenBot";
    this.#attempt = 0;
    this.#stalls = [];
    this.#setState("connecting");
    void this.#connect();
  }

  reconnect(): void {
    if (!this.#started || this.#state === "logged_out" || this.#state === "replaced") return;
    if (this.#state === "failing") this.#stalls = [];
    this.#attempt = 0;
    this.#dropSocket();
    this.#setState("reconnecting");
    void this.#connect();
  }

  readonly stop = Effect.fn("WhatsAppSession.stop")(function* (this: WhatsAppSession) {
    yield* Effect.sync(() => {
      this.#started = false;
      this.#dropSocket();
      this.#setState("stopped");
      for (const wake of [...this.#openWaiters]) wake();
    });
  });

  readonly requestPairingCode = Effect.fn("WhatsAppSession.requestPairingCode")(function* (
    this: WhatsAppSession,
    phoneNumber: string,
  ) {
    const socket = this.#socket;
    if (!socket) return yield* new MessagingAdapterError({ cause: new Error("not_connected") });
    return yield* Effect.tryPromise({
      try: () => socket.requestPairingCode(phoneNumber),
      catch: (cause) => new MessagingAdapterError({ cause }),
    });
  });

  readonly logout = Effect.fn("WhatsAppSession.logout")(function* (this: WhatsAppSession) {
    const socket = this.socket();
    this.#started = false;
    if (socket)
      yield* Effect.tryPromise({ try: () => socket.logout(), catch: (cause) => cause }).pipe(
        Effect.catch(() => Effect.void),
      );
    this.#dropSocket();
    this.#setState("stopped");
  });

  isOwnPost(messageId: string): boolean {
    const at = this.#echoes.get(messageId);
    return (at !== undefined && this.#now() - at < ECHO_TTL_MS) || this.#store.hasOutbound(messageId);
  }

  send(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
  ): Effect.Effect<WAMessage, MessagingAdapterError> {
    return Effect.tryPromise({
      try: () => this.#queue(jid, () => this.#sendNow(jid, content, options)),
      catch: (cause) => new MessagingAdapterError({ cause }),
    });
  }

  readonly groupMetadata = Effect.fn("WhatsAppSession.groupMetadata")(function* (this: WhatsAppSession, jid: string) {
    const cached = this.#groups.get(jid);
    if (cached && this.#now() - cached.at < GROUP_CACHE_MS) return cached.metadata;
    const socket = this.socket();
    if (!socket) return yield* new MessagingAdapterError({ cause: new Error("not_connected") });
    const metadata = yield* Effect.tryPromise({
      try: () => socket.groupMetadata(jid),
      catch: (cause) => new MessagingAdapterError({ cause }),
    });
    this.#groups.set(jid, { metadata, at: this.#now() });
    return metadata;
  });

  readonly registered = Effect.fn("WhatsAppSession.registered")(function* (
    this: WhatsAppSession,
    numbers: readonly string[],
  ) {
    const socket = this.socket();
    if (!socket) return yield* new MessagingAdapterError({ cause: new Error("not_connected") });
    const found = yield* Effect.tryPromise({
      try: () => socket.onWhatsApp(...numbers),
      catch: (cause) => new MessagingAdapterError({ cause }),
    });
    if (!found) return null;
    return found.filter((result) => result.exists).map((result) => jidNormalizedUser(result.jid));
  });

  readonly groups = Effect.fn("WhatsAppSession.groups")(function* (this: WhatsAppSession) {
    const socket = this.socket();
    if (!socket) return yield* new MessagingAdapterError({ cause: new Error("not_connected") });
    const all = yield* Effect.tryPromise({
      try: () => socket.groupFetchAllParticipating(),
      catch: (cause) => new MessagingAdapterError({ cause }),
    });
    const at = this.#now();
    for (const metadata of Object.values(all)) this.#groups.set(metadata.id, { metadata, at });
    return Object.values(all);
  });

  async #connect(): Promise<void> {
    if (!this.#started) return;
    const version = await this.#waVersion();
    if (!this.#started || this.#socket) return;
    const socket = this.#createSocket({
      auth: { creds: this.#store.creds, keys: makeCacheableSignalKeyStore(this.#store.state.keys, baileysLogger) },
      makeSignalRepository: this.#makeSignalRepository,
      logger: baileysLogger,
      version,
      browser: Browsers.macOS(this.#browserName),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      emitOwnEvents: false,
      fireInitQueries: true,
      generateHighQualityLinkPreview: false,
      keepAliveIntervalMs: KEEP_ALIVE_MS,
      connectTimeoutMs: CONNECT_TIMEOUT_MS,
      defaultQueryTimeoutMs: QUERY_TIMEOUT_MS,
      shouldSyncHistoryMessage: ({ syncType }) =>
        syncType !== null && syncType !== undefined && HISTORY_KEPT.has(syncType),
      getMessage: async (key) => (key.id ? this.#store.getOutbound(key.id) : undefined),
      cachedGroupMetadata: async (jid) => {
        const cached = this.#groups.get(jid);
        return cached && this.#now() - cached.at < GROUP_CACHE_MS ? cached.metadata : undefined;
      },
    });
    this.#socket = socket;
    this.#lastFrameAt = this.#now();
    socket.ev.on("creds.update", (update) => {
      if (this.#socket !== socket) return;
      Object.assign(this.#store.creds, update);
      this.#store.saveCreds();
    });
    socket.ev.on("connection.update", (update) => this.#update(socket, update));
    socket.ev.on("messages.upsert", (event) => {
      if (this.#socket !== socket || (this.#pairing && !this.#store.linked)) return;
      if (this.#upsertListeners.size === 0) {
        if (this.#unread.length < UNREAD_LIMIT) this.#unread.push(event);
        return;
      }
      for (const listener of this.#upsertListeners) listener(event);
    });
    socket.ws.on("frame", () => {
      if (this.#socket === socket) this.#lastFrameAt = this.#now();
    });
    socket.ws.on(MESSAGE_ACK, (node) => {
      if (this.#socket === socket && node.attrs.id) this.#acks.get(node.attrs.id)?.({ error: node.attrs.error });
    });
    socket.ws.on(NODE_HANDLING, (node, started) => {
      if (this.#socket !== socket) return;
      if (started === true) this.#handling.set(node, this.#now());
      else this.#handling.delete(node);
    });
  }

  #update(socket: WhatsAppSocket, update: Partial<ConnectionState>): void {
    if (this.#socket !== socket) return;
    if (update.qr) {
      this.#codeShown = true;
      for (const listener of this.#qrListeners) listener(update.qr);
    }
    if (update.connection === "open") {
      this.#openedAt = this.#now();
      this.#socketOpenedAt = this.#openedAt;
      this.#historySentAtOpen = this.#historySent;
      if (this.#store.linked) this.#historySent = true;
      this.#lastFrameAt = this.#openedAt;
      this.#startWatchdog();
      this.#setState("open");
      for (const wake of [...this.#openWaiters]) wake();
      return;
    }
    if (update.connection !== "close") return;
    const code = statusCode(update.lastDisconnect?.error);
    const decision = closeDecision(code, this.#pairing && !this.#store.linked, this.#restartedOnce, this.#codeShown);
    if (this.#socketOpenedAt && this.#now() - this.#socketOpenedAt >= STABLE_MS) this.#attempt = 0;
    this.#dropSocket();
    const error = update.lastDisconnect?.error;
    logger.warn("A WhatsApp socket closed.", {
      code: code ?? null,
      decision,
      reason: fixedText(error instanceof Error ? error.message : undefined),
    });
    if (!this.#started) return;
    if (decision === "fatal") {
      this.#started = false;
      this.#setState("logged_out");
      return;
    }
    if (decision === "replaced") {
      this.#started = false;
      this.#setState("replaced");
      return;
    }
    if (decision === "timeout" || decision === "unreachable") {
      this.#started = false;
      this.#setState(decision === "timeout" ? "stopped" : "unreachable");
      return;
    }
    if (decision === "restart") {
      this.#restartedOnce = true;
      this.#setState("reconnecting");
      void this.#connect();
      return;
    }
    const delay = backoffDelay(this.#attempt);
    this.#attempt += 1;
    this.#setState(this.#attempt >= FAILING_AFTER_ATTEMPTS ? "failing" : "reconnecting");
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      void this.#connect();
    }, delay);
    this.#retryTimer.unref?.();
  }

  #startWatchdog(): void {
    if (this.#watchdog) return;
    this.#watchdog = setInterval(() => {
      if (this.#state !== "open") return;
      if (this.#now() - this.#lastFrameAt >= WATCHDOG_SILENCE_MS) {
        logger.warn("A WhatsApp socket went silent; reconnecting.");
        this.reconnect();
        return;
      }
      const oldest = this.#handling.values().next();
      if (this.#historySentAtOpen && !oldest.done && this.#now() - oldest.value >= STALL_MS) this.#stalled();
    }, WATCHDOG_INTERVAL_MS);
    this.#watchdog.unref?.();
  }

  #stalled(): void {
    const now = this.#now();
    this.#stalls = [...this.#stalls.filter((at) => now - at < STALL_WINDOW_MS), now];
    const stop = this.#stalls.length >= STALL_LIMIT;
    logger.warn("A WhatsApp socket stopped delivering messages.", {
      reason: "message_stalled",
      action: stop ? "stop" : "reconnect",
    });
    if (!stop) {
      this.reconnect();
      return;
    }
    this.#dropSocket();
    this.#setState("failing");
  }

  #dropSocket(): void {
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    if (this.#watchdog) clearInterval(this.#watchdog);
    this.#watchdog = null;
    this.#handling.clear();
    this.#socketOpenedAt = 0;
    const socket = this.#socket;
    this.#socket = null;
    if (!socket) return;
    for (const finish of this.#acks.values()) finish("closed");
    try {
      socket.end(undefined);
    } catch {}
  }

  #setState(state: WhatsAppSessionState): void {
    if (this.#state === state) return;
    this.#state = state;
    for (const listener of this.#stateListeners) listener(state);
  }

  async #waVersion(): Promise<WAVersion> {
    if (this.#version) return this.#version;
    const cached = parseVersion(this.#store.getMeta(VERSION_META));
    const fetched = await this.#fetchVersion().catch(() => null);
    const version = fetched ?? cached ?? DEFAULT_CONNECTION_CONFIG.version;
    if (fetched) this.#store.setMeta(VERSION_META, JSON.stringify(version));
    this.#version = version;
    return version;
  }

  #queue<A>(jid: string, work: () => Promise<A>): Promise<A> {
    const previous = this.#chatQueues.get(jid) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.#chatQueues.set(jid, next);
    const forget = () => {
      if (this.#chatQueues.get(jid) === next) this.#chatQueues.delete(jid);
    };
    next.then(forget, forget);
    return next;
  }

  async #sendNow(jid: string, content: AnyMessageContent, options?: MiscMessageGenerationOptions): Promise<WAMessage> {
    let messageId = options?.messageId;
    const deadline = this.#now() + SEND_DEADLINE_MS;
    for (let attempt = 1; ; attempt += 1) {
      const socket = await this.#openSocket(deadline);
      const address = this.#postChat(content) ?? (await this.#address(socket, jid));
      const gap = CHAT_PACING_MS * (1 + Math.random() / 2) - (this.#now() - (this.#lastSend.get(jid) ?? 0));
      if (gap > 0) await new Promise((resume) => setTimeout(resume, gap));
      if (this.#readOnly(jid)) throw new Error("place_read_only");
      messageId ??= generateMessageIDV2(socket.user?.id);
      this.#remember(messageId);
      const ack = this.#ackOf(messageId);
      try {
        const sent = await socket.sendMessage(address, onAddress(content, jid, address), {
          ...options,
          ...(options?.quoted ? { quoted: { ...options.quoted, key: onKey(options.quoted.key, jid, address) } } : {}),
          messageId,
        });
        this.#lastSend.set(jid, this.#now());
        if (!sent?.key.id) throw new Error("no_message_id");
        const result = await ack.wait();
        if (result === "timeout" && this.#socket === socket && this.#acks.size === 1) {
          logger.warn("A WhatsApp socket stopped delivering messages.", {
            reason: "post_unconfirmed",
            action: "reconnect",
          });
          this.reconnect();
        }
        if (result === "closed" && this.#started) {
          if (attempt >= SEND_ATTEMPTS) throw new Error("not_confirmed");
          continue;
        }
        if (typeof result === "object" && result.error)
          throw attempt > 1 ? new Error("not_confirmed") : new WhatsAppRefusedError(result.error);
        if (sent.message) this.#store.putOutbound(sent.key.id, sent.message);
        if (isPnUser(jid)) remember(this.#postChats, messageId, address);
        return sent;
      } finally {
        ack.cancel();
      }
    }
  }

  async #address(socket: WhatsAppSocket, jid: string): Promise<string> {
    if (!isPnUser(jid) || (socket.user && jidNormalizedUser(socket.user.id) === jid)) return jid;
    const missedAt = this.#noLid.get(jid);
    if (missedAt !== undefined && this.#now() - missedAt < NO_LID_TTL_MS) return jid;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lid = await Promise.race([
      socket.signalRepository.lidMapping.getLIDForPN(jid).then(
        (found) => (found && isLidUser(found) ? jidNormalizedUser(found) : null),
        () => undefined,
      ),
      new Promise<undefined>((resolve) => {
        const wait = setTimeout(() => resolve(undefined), LID_WAIT_MS);
        wait.unref?.();
        timer = wait;
      }),
    ]).finally(() => clearTimeout(timer));
    if (lid) return lid;
    if (lid === null) remember(this.#noLid, jid, this.#now());
    else logger.warn("WhatsApp: no LID for a contact in time; the post goes to the phone number.");
    return jid;
  }

  #postChat(content: AnyMessageContent): string | undefined {
    const key = "edit" in content && content.edit ? content.edit : "delete" in content ? content.delete : null;
    return key?.id ? this.#postChats.get(key.id) : undefined;
  }

  #ackOf(messageId: string): { wait: () => Promise<AckResult>; cancel: () => void } {
    let finish: (result: AckResult) => void = () => undefined;
    const promise = new Promise<AckResult>((resolve) => {
      finish = resolve;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.#acks.set(messageId, finish);
    return {
      wait: () => {
        timer = setTimeout(() => finish("timeout"), ACK_WAIT_MS);
        timer.unref?.();
        return promise;
      },
      cancel: () => {
        clearTimeout(timer);
        if (this.#acks.get(messageId) === finish) this.#acks.delete(messageId);
      },
    };
  }

  async #openSocket(deadline: number): Promise<WhatsAppSocket> {
    for (;;) {
      const socket = this.socket();
      if (socket) return socket;
      if (!this.#started || this.#now() >= deadline) throw new Error("not_connected");
      await new Promise<void>((resume) => {
        const wake = () => {
          clearTimeout(timer);
          this.#openWaiters.delete(wake);
          resume();
        };
        const timer = setTimeout(wake, Math.max(0, deadline - this.#now()));
        this.#openWaiters.add(wake);
      });
    }
  }

  #remember(messageId: string): void {
    const now = this.#now();
    this.#echoes.set(messageId, now);
    if (this.#echoes.size <= ECHO_LIMIT) return;
    for (const [id, at] of this.#echoes) {
      if (this.#echoes.size <= ECHO_LIMIT && now - at < ECHO_TTL_MS) break;
      this.#echoes.delete(id);
    }
  }
}

function onAddress(content: AnyMessageContent, jid: string, address: string): AnyMessageContent {
  if (address === jid) return content;
  if ("edit" in content && content.edit) return { ...content, edit: onKey(content.edit, jid, address) };
  if ("delete" in content) return { ...content, delete: onKey(content.delete, jid, address) };
  if ("react" in content && content.react.key)
    return { ...content, react: { ...content.react, key: onKey(content.react.key, jid, address) } };
  return content;
}

function remember<V>(memory: Map<string, V>, key: string, value: V): void {
  memory.delete(key);
  memory.set(key, value);
  const oldest = memory.size > CHAT_MEMORY_LIMIT ? memory.keys().next().value : undefined;
  if (oldest !== undefined) memory.delete(oldest);
}

function onKey<K extends WAMessageKey>(key: K, jid: string, address: string): K {
  return key.remoteJid === jid ? { ...key, remoteJid: address } : key;
}

async function webVersion(): Promise<WAVersion | null> {
  const result = await fetchLatestWaWebVersion({ signal: AbortSignal.timeout(VERSION_TIMEOUT_MS) });
  return result.isLatest ? result.version : null;
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("output" in error)) return undefined;
  const output = error.output;
  return typeof output === "object" &&
    output !== null &&
    "statusCode" in output &&
    typeof output.statusCode === "number"
    ? output.statusCode
    : undefined;
}

function parseVersion(text: string | undefined): WAVersion | null {
  if (!text) return null;
  try {
    const [major, minor, patch] = JSON.parse(text);
    return [major, minor, patch].every((part) => Number.isInteger(part)) ? [major, minor, patch] : null;
  } catch {
    return null;
  }
}

const baileysLogger: SocketConfig["logger"] = {
  level: "warn",
  child: () => baileysLogger,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: (object, message) => logger.warn(`WhatsApp: ${fixedText(object, message)}`),
  error: (object, message) => logger.error(`WhatsApp: ${fixedText(object, message)}`),
};

function fixedText(object: unknown, message?: string): string {
  const text = typeof message === "string" ? message : typeof object === "string" ? object : "event";
  return text.replace(/[0-9]{5,}/gu, "…").slice(0, 200);
}
