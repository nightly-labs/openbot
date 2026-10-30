import { createOpenBotLogger } from "@openbot/logging";
import type { WhatsAppAuthStore } from "@openbot/whatsapp/auth-store";
import {
  type AnyMessageContent,
  type BaileysEventMap,
  Browsers,
  type ConnectionState,
  DEFAULT_CONNECTION_CONFIG,
  DisconnectReason,
  fetchLatestWaWebVersion,
  type GroupMetadata,
  generateMessageIDV2,
  type MiscMessageGenerationOptions,
  makeCacheableSignalKeyStore,
  proto,
  type SocketConfig,
  type UserFacingSocketConfig,
  type WAMessage,
  type WAVersion,
} from "@openbot/whatsapp/baileys";
import { Effect } from "effect";
import { MessagingAdapterError } from "../messaging-types";

const logger = createOpenBotLogger("whatsapp");

/** The calls OpenBot makes on a Baileys socket. The real socket has this shape; a test passes a fake. */
export interface WhatsAppSocket {
  ev: { on<T extends keyof BaileysEventMap>(event: T, listener: (arg: BaileysEventMap[T]) => void): void };
  ws: { on(event: "frame", listener: () => void): unknown };
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
  updateMediaMessage(message: WAMessage): Promise<WAMessage>;
  signalRepository: { lidMapping: { getPNForLID(lid: string): Promise<string | null> } };
}

export type WhatsAppSocketFactory = (config: UserFacingSocketConfig) => WhatsAppSocket;

export type WhatsAppSessionState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "logged_out"
  | "replaced"
  /** A link could not reach WhatsApp before it showed a code. */
  | "unreachable"
  | "stopped";

/** What a closed socket asks for, by its status code. */
export type CloseDecision = "fatal" | "replaced" | "restart" | "timeout" | "unreachable" | "retry";

const KEEP_ALIVE_MS = 25_000;
const CONNECT_TIMEOUT_MS = 60_000;
const QUERY_TIMEOUT_MS = 60_000;
const VERSION_TIMEOUT_MS = 5_000;
const BACKOFF_START_MS = 2_000;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_FACTOR = 1.8;
const BACKOFF_JITTER = 0.25;
/** A connection that stayed up this long starts its backoff from the beginning again. */
const STABLE_MS = 60_000;
/** No frame for this long means a dead socket that did not close. */
const WATCHDOG_SILENCE_MS = 90_000;
const WATCHDOG_INTERVAL_MS = 15_000;
/** How long a post waits for the socket to open. */
const SEND_DEADLINE_MS = 5 * 60_000;
/** Posts to one chat keep at least this much time between them, plus up to half of it at random. */
const CHAT_PACING_MS = 1_000;
/** How long OpenBot remembers the ids of its own posts, so their echoes are not read as messages. */
const ECHO_TTL_MS = 20 * 60_000;
const ECHO_LIMIT = 5_000;
const GROUP_CACHE_MS = 5 * 60_000;
const VERSION_META = "wa-version";
const HISTORY_KEPT: ReadonlySet<proto.Message.HistorySyncType> = new Set([
  proto.Message.HistorySyncType.INITIAL_BOOTSTRAP,
  proto.Message.HistorySyncType.PUSH_NAME,
  proto.Message.HistorySyncType.NON_BLOCKING_DATA,
]);

/**
 * The decision for a closed socket. 401, 403 and 411 mean the device was removed or refused: only a
 * new link helps. 440 means another client took the session; reconnecting would take it back and
 * forth. 515 is the restart that WhatsApp asks for after pairing. During pairing, a 408 after a code
 * was shown is a QR code that ran out: one restart gives new codes, a second one ends the link. A link
 * that closes before it showed any code did not reach WhatsApp, such as with no network.
 */
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

/** The wait before the next attempt: exponential, capped, with jitter. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * BACKOFF_FACTOR ** attempt);
  return Math.round(base * (1 - BACKOFF_JITTER + 2 * BACKOFF_JITTER * random()));
}

export interface WhatsAppSessionOptions {
  store: WhatsAppAuthStore;
  createSocket: WhatsAppSocketFactory;
  makeSignalRepository: SocketConfig["makeSignalRepository"];
  /** True for a link that has not finished: no messages are read, and a QR timeout ends it. */
  pairing?: boolean;
  /** WhatsApp Web's current version, or null. Tests pass one that makes no request. */
  fetchVersion?: () => Promise<WAVersion | null>;
  now?: () => number;
}

type UpsertListener = (event: { messages: WAMessage[]; type: string }) => void;

/**
 * One linked WhatsApp device: its Baileys socket and the decisions around it. It reconnects with
 * backoff, restarts when WhatsApp asks, stops for good when the device was removed or another client
 * took the session, and reconnects a socket that went silent. Posts wait for the socket (up to five
 * minutes), keep a gap between posts to one chat, and are kept for WhatsApp's retry receipts. The
 * adapter and the transport of a connection share one session.
 */
export class WhatsAppSession {
  readonly #store: WhatsAppAuthStore;
  readonly #createSocket: WhatsAppSocketFactory;
  readonly #makeSignalRepository: SocketConfig["makeSignalRepository"];
  readonly #pairing: boolean;
  readonly #fetchVersion: () => Promise<WAVersion | null>;
  readonly #now: () => number;
  readonly #stateListeners = new Set<(state: WhatsAppSessionState) => void>();
  readonly #upsertListeners = new Set<UpsertListener>();
  readonly #qrListeners = new Set<(qr: string) => void>();
  readonly #openWaiters = new Set<() => void>();
  readonly #echoes = new Map<string, number>();
  readonly #chatQueues = new Map<string, Promise<unknown>>();
  readonly #lastSend = new Map<string, number>();
  readonly #groups = new Map<string, { metadata: GroupMetadata; at: number }>();
  #socket: WhatsAppSocket | null = null;
  #state: WhatsAppSessionState = "stopped";
  #started = false;
  #attempt = 0;
  #restartedOnce = false;
  /** A QR code was shown in this session, so a 408 means that the codes ran out. */
  #codeShown = false;
  #openedAt = 0;
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
  }

  get state(): WhatsAppSessionState {
    return this.#state;
  }

  /** When the socket last opened, in milliseconds; 0 before the first open. */
  get openedAt(): number {
    return this.#openedAt;
  }

  get store(): WhatsAppAuthStore {
    return this.#store;
  }

  /** The socket while it is open. */
  socket(): WhatsAppSocket | null {
    return this.#state === "open" ? this.#socket : null;
  }

  onState(listener: (state: WhatsAppSessionState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  onUpsert(listener: UpsertListener): () => void {
    this.#upsertListeners.add(listener);
    return () => this.#upsertListeners.delete(listener);
  }

  onQr(listener: (qr: string) => void): () => void {
    this.#qrListeners.add(listener);
    return () => this.#qrListeners.delete(listener);
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#attempt = 0;
    this.#setState("connecting");
    void this.#connect();
  }

  /** Closes the socket and opens a new one now, such as after the computer wakes. */
  reconnect(): void {
    if (!this.#started || this.#state === "logged_out" || this.#state === "replaced") return;
    this.#attempt = 0;
    this.#dropSocket();
    this.#setState("reconnecting");
    void this.#connect();
  }

  /** Stops for good. The store stays open; its owner closes it. */
  readonly stop = Effect.fn("WhatsAppSession.stop")(function* (this: WhatsAppSession) {
    yield* Effect.sync(() => {
      this.#started = false;
      this.#dropSocket();
      this.#setState("stopped");
      for (const wake of [...this.#openWaiters]) wake();
    });
  });

  /** A code to type on the phone, for a link without a QR code. */
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

  /** Unlinks this device from the account. A failure is ignored: the owner can remove it on the phone. */
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

  /**
   * True when the message id is one of OpenBot's own posts. The store keeps them for a day, so after a
   * restart an echo of a post in the owner's own chat is still not read as a new request.
   */
  isOwnPost(messageId: string): boolean {
    const at = this.#echoes.get(messageId);
    return (at !== undefined && this.#now() - at < ECHO_TTL_MS) || this.#store.hasOutbound(messageId);
  }

  /** Posts to one chat, after the socket opens and after the gap since the last post to that chat. */
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

  /** The metadata of a group, from a short cache. */
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
      browser: Browsers.macOS("OpenBot"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      // Own posts are not read back: in the owner's own chat they would look like the owner's requests.
      emitOwnEvents: false,
      fireInitQueries: true,
      generateHighQualityLinkPreview: false,
      keepAliveIntervalMs: KEEP_ALIVE_MS,
      connectTimeoutMs: CONNECT_TIMEOUT_MS,
      defaultQueryTimeoutMs: QUERY_TIMEOUT_MS,
      // Only the history parts that carry contact names and the phone/LID mappings, which Baileys needs
      // for stable sessions. The full and recent history of the owner's chats is not fetched, and the
      // transport never reads history messages: it reads only new ones (`messages.upsert`).
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
      if (this.#socket !== socket || this.#pairing) return;
      for (const listener of this.#upsertListeners) listener(event);
    });
    socket.ws.on("frame", () => {
      if (this.#socket === socket) this.#lastFrameAt = this.#now();
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
      this.#lastFrameAt = this.#openedAt;
      this.#startWatchdog();
      this.#setState("open");
      for (const wake of [...this.#openWaiters]) wake();
      return;
    }
    if (update.connection !== "close") return;
    const code = statusCode(update.lastDisconnect?.error);
    const decision = closeDecision(code, this.#pairing && !this.#store.linked, this.#restartedOnce, this.#codeShown);
    if (this.#openedAt && this.#now() - this.#openedAt >= STABLE_MS) this.#attempt = 0;
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
    this.#setState("reconnecting");
    const delay = backoffDelay(this.#attempt);
    this.#attempt += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      void this.#connect();
    }, delay);
    this.#retryTimer.unref?.();
  }

  #startWatchdog(): void {
    if (this.#watchdog) return;
    this.#watchdog = setInterval(() => {
      if (this.#state !== "open" || this.#now() - this.#lastFrameAt < WATCHDOG_SILENCE_MS) return;
      logger.warn("A WhatsApp socket went silent; reconnecting.");
      this.reconnect();
    }, WATCHDOG_INTERVAL_MS);
    this.#watchdog.unref?.();
  }

  /** Ends the current socket without reading its close event. */
  #dropSocket(): void {
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    if (this.#watchdog) clearInterval(this.#watchdog);
    this.#watchdog = null;
    const socket = this.#socket;
    this.#socket = null;
    if (!socket) return;
    try {
      socket.end(undefined);
    } catch {
      // The socket was already closed.
    }
  }

  #setState(state: WhatsAppSessionState): void {
    if (this.#state === state) return;
    this.#state = state;
    for (const listener of this.#stateListeners) listener(state);
  }

  /** WhatsApp Web's own version, from its server, or the last one known. */
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
    // The caller handles a failure of `next`; this branch only cleans up, so it must not reject.
    const forget = () => {
      if (this.#chatQueues.get(jid) === next) this.#chatQueues.delete(jid);
    };
    next.then(forget, forget);
    return next;
  }

  async #sendNow(jid: string, content: AnyMessageContent, options?: MiscMessageGenerationOptions): Promise<WAMessage> {
    const socket = await this.#openSocket();
    const gap = CHAT_PACING_MS * (1 + Math.random() / 2) - (this.#now() - (this.#lastSend.get(jid) ?? 0));
    if (gap > 0) await new Promise((resume) => setTimeout(resume, gap));
    // The id is known before the send, so an echo that arrives first is already an own post.
    const messageId = options?.messageId ?? generateMessageIDV2(socket.user?.id);
    this.#remember(messageId);
    const sent = await socket.sendMessage(jid, content, { ...options, messageId });
    this.#lastSend.set(jid, this.#now());
    if (!sent?.key.id) throw new Error("no_message_id");
    if (sent.message) this.#store.putOutbound(sent.key.id, sent.message);
    return sent;
  }

  /** The open socket, waiting for it up to the send deadline. */
  async #openSocket(): Promise<WhatsAppSocket> {
    const deadline = this.#now() + SEND_DEADLINE_MS;
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

/** The version that WhatsApp Web's own server names, within a short time. */
async function webVersion(): Promise<WAVersion | null> {
  const result = await fetchLatestWaWebVersion({ signal: AbortSignal.timeout(VERSION_TIMEOUT_MS) });
  return result.isLatest ? result.version : null;
}

/** The status code of a Baileys close error (a Boom), when it has one. */
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

/**
 * Baileys logs through this. It keeps only warnings and errors, and only their message text without
 * long numbers: the objects that Baileys passes can hold message content, phone numbers and keys.
 */
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
