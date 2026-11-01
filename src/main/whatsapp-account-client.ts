// One linked-device connection to the user's WhatsApp account, through Baileys. The connector service
// loads this module only when it needs WhatsApp, so Baileys is not loaded at startup on a computer
// that never links. Baileys runs on events and Promises; the service wraps each call in an Effect.
//
// Baileys depends on `libsignal`, which is GPL-3.0. The root package.json replaces it with
// `vendor/whatsapp-signal`, so no GPL code is installed (see that package's README).

import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import makeWASocket, {
  type AuthenticationCreds,
  type AuthenticationState,
  type BaileysEventMap,
  type Chat,
  type Contact,
  DisconnectReason,
  fetchLatestWaWebVersion,
  initAuthCreds,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  jidNormalizedUser,
  normalizeMessageContent,
  proto,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SocketConfig,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from "@whiskeysockets/baileys";
import { whatsappStatusCode } from "./whatsapp-account-effects";
import type { WhatsAppHistory, WhatsAppStoredMessage } from "./whatsapp-account-history";

const baileysLogger = createOpenBotLogger("whatsapp-account-connector");

type SignalType = keyof SignalDataTypeMap;
/** Any one key that Baileys stores. */
type StoredKeyValue = SignalDataTypeMap[SignalType];
/** Per kind of key, the keys by id, as Baileys gave them. */
type StoredKeys = Partial<Record<SignalType, Record<string, StoredKeyValue>>>;

/** Every kind of key that Baileys stores. The build fails when Baileys adds or removes one. */
const SIGNAL_TYPE_FLAGS: Record<SignalType, true> = {
  "pre-key": true,
  session: true,
  "sender-key": true,
  "sender-key-memory": true,
  "app-state-sync-key": true,
  "app-state-sync-version": true,
  "lid-mapping": true,
  "device-list": true,
  tctoken: true,
  "identity-key": true,
};

function isSignalType(value: string): value is SignalType {
  return Object.hasOwn(SIGNAL_TYPE_FLAGS, value);
}

const SIGNAL_TYPES: readonly SignalType[] = Object.keys(SIGNAL_TYPE_FLAGS).filter(isSignalType);

/** The keys of the linked device. JSON with bytes; `whatsapp-account-data-file.ts` stores it. */
export interface WhatsAppStoredAuth {
  creds: AuthenticationCreds;
  keys: StoredKeys;
}

/** New keys for a device that is not linked yet. */
export function newWhatsAppAuth(): WhatsAppStoredAuth {
  return { creds: initAuthCreds(), keys: {} };
}

/**
 * The stored credentials. This app wrote the file and encrypted it, so a shallow check is enough;
 * WhatsApp checks the keys themselves.
 */
function isCreds(value: unknown): value is AuthenticationCreds {
  return (
    isDynamicRecord(value) &&
    isDynamicRecord(value.noiseKey) &&
    isDynamicRecord(value.signedIdentityKey) &&
    isDynamicRecord(value.signedPreKey) &&
    typeof value.registrationId === "number" &&
    typeof value.advSecretKey === "string"
  );
}

/** One key read back from this app's own encrypted file. WhatsApp checks the key itself. */
function isStoredKeyValue(value: unknown): value is StoredKeyValue {
  return value !== null && value !== undefined;
}

/** A stored key of `type`. Baileys wrote it with `set` for that type. */
function isKeyOf<Type extends SignalType>(
  _type: Type,
  value: StoredKeyValue | undefined,
): value is SignalDataTypeMap[Type] {
  return value !== undefined;
}

function readKeys(type: SignalType, value: DynamicRecord): Record<string, StoredKeyValue> {
  const result: Record<string, StoredKeyValue> = {};
  for (const [id, item] of Object.entries(value)) {
    // A sync key is a protobuf message; JSON keeps only its fields.
    const key =
      type === "app-state-sync-key" && isDynamicRecord(item)
        ? proto.Message.AppStateSyncKeyData.fromObject(item)
        : item;
    if (isStoredKeyValue(key)) result[id] = key;
  }
  return result;
}

/** The stored keys of a linked device, or null when `value` is not one. */
export function readWhatsAppStoredAuth(value: unknown): WhatsAppStoredAuth | null {
  if (!isDynamicRecord(value) || !isCreds(value.creds) || !isDynamicRecord(value.keys)) return null;
  const stored = value.keys;
  const keys: StoredKeys = {};
  for (const type of SIGNAL_TYPES) {
    const values = stored[type];
    if (isDynamicRecord(values)) keys[type] = readKeys(type, values);
  }
  return { creds: value.creds, keys };
}

function getKeys<Type extends SignalType>(
  keys: StoredKeys,
  type: Type,
  ids: readonly string[],
): { [id: string]: SignalDataTypeMap[Type] } {
  const values = keys[type];
  const result: { [id: string]: SignalDataTypeMap[Type] } = {};
  if (!values) return result;
  for (const id of ids) {
    const value = values[id];
    if (isKeyOf(type, value)) result[id] = value;
  }
  return result;
}

function setKeys(keys: StoredKeys, data: SignalDataSet): void {
  for (const type of SIGNAL_TYPES) {
    const entries = data[type];
    if (!entries) continue;
    const values = keys[type] ?? {};
    for (const [id, value] of Object.entries(entries)) {
      if (value === null || value === undefined) delete values[id];
      else values[id] = value;
    }
    keys[type] = values;
  }
}

/** Why the connection stopped for good. The service turns each reason into a sentence for the user. */
export type WhatsAppStopReason = "logged-out" | "qr-expired" | "replaced" | "forbidden" | "link-failed" | "outdated";

export interface WhatsAppAccountClientEvents {
  /** A new QR code to show. It is valid until the next one, about 20 seconds. */
  qr(code: string): void;
  /** WhatsApp accepted the device: the first time after a link, and after each reconnection. */
  open(account: { id: string; name: string }): void;
  /** WhatsApp is not reachable for now. The client reconnects on its own. */
  offline(): void;
  /** The connection stopped for good. After `logged-out`, the keys are no longer valid. */
  stopped(reason: WhatsAppStopReason, detail: string): void;
  /** The keys changed and must be stored. */
  authChanged(): void;
}

export interface WhatsAppAccountClientOptions {
  auth: WhatsAppStoredAuth;
  history: WhatsAppHistory;
  appVersion: string;
  events: WhatsAppAccountClientEvents;
}

/** Media words for agents. */
function mediaLabel(content: proto.IMessage): string | null {
  if (content.imageMessage) return "image";
  if (content.videoMessage)
    return content.videoMessage.gifPlayback ? "GIF" : `video (${content.videoMessage.seconds ?? 0}s)`;
  if (content.ptvMessage) return `video message (${content.ptvMessage.seconds ?? 0}s)`;
  if (content.audioMessage)
    return content.audioMessage.ptt
      ? `voice message (${content.audioMessage.seconds ?? 0}s)`
      : `audio (${content.audioMessage.seconds ?? 0}s)`;
  if (content.documentMessage) return `file: ${content.documentMessage.fileName ?? "document"}`;
  if (content.documentWithCaptionMessage?.message?.documentMessage)
    return `file: ${content.documentWithCaptionMessage.message.documentMessage.fileName ?? "document"}`;
  if (content.stickerMessage) return "sticker";
  if (content.locationMessage) {
    const { degreesLatitude, degreesLongitude, name } = content.locationMessage;
    return `location: ${name ? `${name}, ` : ""}${degreesLatitude ?? 0}, ${degreesLongitude ?? 0}`;
  }
  if (content.liveLocationMessage) return "live location";
  if (content.contactMessage) return `contact: ${content.contactMessage.displayName ?? ""}`.trim();
  if (content.contactsArrayMessage) return `contacts: ${content.contactsArrayMessage.contacts?.length ?? 0}`;
  if (content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3) {
    const poll = content.pollCreationMessage ?? content.pollCreationMessageV2 ?? content.pollCreationMessageV3;
    return `poll: ${poll?.name ?? ""}; options: ${(poll?.options ?? []).map((option) => option.optionName).join(", ")}`;
  }
  if (content.eventMessage) return `event: ${content.eventMessage.name ?? ""}`;
  return null;
}

function messageText(content: proto.IMessage): string {
  return (
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    content.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    content.buttonsResponseMessage?.selectedDisplayText ??
    content.listResponseMessage?.title ??
    content.templateButtonReplyMessage?.selectedDisplayText ??
    ""
  );
}

/** The context of a reply: the message types that can quote another message. */
function contextInfo(content: proto.IMessage): proto.IContextInfo | null {
  return (
    content.extendedTextMessage?.contextInfo ??
    content.imageMessage?.contextInfo ??
    content.videoMessage?.contextInfo ??
    content.audioMessage?.contextInfo ??
    content.documentMessage?.contextInfo ??
    content.stickerMessage?.contextInfo ??
    content.locationMessage?.contextInfo ??
    content.contactMessage?.contextInfo ??
    null
  );
}

function seconds(value: WAMessage["messageTimestamp"]): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toNumber" in value) return value.toNumber();
  return 0;
}

/** Whether a chat id is one that agents use: people and groups, not status, channels or broadcasts. */
function usefulChat(jid: string | null | undefined): jid is string {
  return !!jid && !isJidStatusBroadcast(jid) && !isJidBroadcast(jid) && !isJidNewsletter(jid);
}

/**
 * Keeps only the message line of a Baileys log entry, with every long number hidden: Baileys names
 * people by phone number, and its objects can hold message content.
 */
function logLine(message: unknown): string {
  return redactText(String(message ?? "")).replace(/\d{6,}/gu, "…");
}

function baileysLog(): SocketConfig["logger"] {
  const log = {
    level: "warn",
    child: () => log,
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: (_object: unknown, message?: string) => {
      if (message) baileysLogger.debug(`Baileys: ${logLine(message)}`);
    },
    error: (_object: unknown, message?: string) => {
      if (message) baileysLogger.warn(`Baileys: ${logLine(message)}`);
    },
  };
  return log;
}

/** The newest WhatsApp Web version, read once per process; Baileys' own version when it cannot be read. */
let webVersion: Promise<[number, number, number] | undefined> | null = null;
function latestWebVersion(): Promise<[number, number, number] | undefined> {
  webVersion ??= fetchLatestWaWebVersion()
    .then((result) => (result.isLatest ? result.version : undefined))
    .catch(() => undefined);
  return webVersion;
}

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];

/**
 * The Baileys socket of one linked device, with reconnection. The connector service owns it: it
 * decides when to link, when the device was removed, and whether sending is allowed. This class only
 * talks to WhatsApp and keeps the history up to date.
 */
export class WhatsAppAccountClient {
  readonly #options: WhatsAppAccountClientOptions;
  readonly #auth: AuthenticationState;
  #socket: WASocket | null = null;
  #open = false;
  #stopped = false;
  #attempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Waiting `whenOpen` calls. */
  readonly #openWaiters = new Set<() => void>();
  /** Messages that this device sent, for the retries that WhatsApp asks for. */
  readonly #sent = new Map<string, proto.IMessage>();
  /** History requests in progress, by chat. */
  readonly #historyWaiters = new Map<string, Set<() => void>>();

  constructor(options: WhatsAppAccountClientOptions) {
    this.#options = options;
    const stored = options.auth;
    this.#auth = {
      creds: stored.creds,
      keys: {
        get: (type, ids) => getKeys(stored.keys, type, ids),
        set: (data) => {
          setKeys(stored.keys, data);
          options.events.authChanged();
        },
      },
    };
  }

  /** Whether WhatsApp accepted this device: it was linked before or a link just succeeded. */
  registered(): boolean {
    return this.#auth.creds.registered === true || !!this.#auth.creds.me?.id;
  }

  isOpen(): boolean {
    return this.#open;
  }

  /** Opens the socket. Events report the rest. */
  async start(): Promise<void> {
    if (this.#stopped) return;
    const version = await latestWebVersion();
    if (this.#stopped) return;
    const socket = makeWASocket({
      ...(version ? { version } : {}),
      auth: this.#auth,
      logger: baileysLog(),
      // A Desktop or macOS name makes WhatsApp refuse the connection (Baileys #2741).
      browser: ["OpenBot", "Chrome", this.#options.appVersion],
      // The phone keeps its notifications only while this device does not show as online.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => (key.id ? this.#sent.get(key.id) : undefined),
    });
    this.#socket = socket;
    // Events of a socket that was replaced or closed are dropped; key changes are always kept.
    const on = <E extends keyof BaileysEventMap>(event: E, handler: (value: BaileysEventMap[E]) => void) => {
      socket.ev.on(event, (value) => {
        if (socket === this.#socket) handler(value);
      });
    };
    socket.ev.on("creds.update", (update) => {
      Object.assign(this.#auth.creds, update);
      this.#options.events.authChanged();
    });
    on("connection.update", (update) => {
      if (update.qr) this.#options.events.qr(update.qr);
      if (update.connection === "open") this.#opened(socket);
      if (update.connection === "close") this.#closed(update.lastDisconnect?.error);
    });
    on("messaging-history.set", ({ chats, contacts, messages }) => {
      this.#chats(chats);
      this.#contacts(contacts);
      const touched = new Set<string>();
      for (const message of messages) {
        const chat = this.#message(message);
        if (chat) touched.add(chat);
      }
      for (const chat of touched) this.#historyArrived(chat);
    });
    on("chats.upsert", (chats) => this.#chats(chats));
    on("chats.update", (updates) => this.#chatUpdates(updates));
    on("chats.delete", (ids) => {
      for (const id of ids) this.#options.history.deleteChat(id);
    });
    on("contacts.upsert", (contacts) => this.#contacts(contacts));
    on("contacts.update", (contacts) => this.#contacts(contacts));
    on("messages.upsert", ({ messages }) => {
      for (const message of messages) this.#message(message);
    });
    on("groups.upsert", (groups) => {
      for (const group of groups)
        this.#options.history.upsertChat({ id: group.id, name: group.subject, kind: "group" });
    });
    on("groups.update", (groups) => {
      for (const group of groups)
        if (group.id && group.subject)
          this.#options.history.upsertChat({ id: group.id, name: group.subject, kind: "group" });
    });
  }

  /** Waits until the socket is open, or `timeoutMs`. Answers whether it is open. */
  whenOpen(timeoutMs: number): Promise<boolean> {
    if (this.#open) return Promise.resolve(true);
    if (this.#stopped) return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.#openWaiters.delete(done);
        resolve(this.#open);
      };
      const timer = setTimeout(done, timeoutMs);
      this.#openWaiters.add(done);
    });
  }

  /** Asks WhatsApp for the code that the user types on the phone. Call after the first QR code. */
  async requestPairingCode(phone: string): Promise<string> {
    const socket = this.#requireSocket();
    const code = await socket.requestPairingCode(phone);
    return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
  }

  /** The WhatsApp id of a phone number, or null when the number has no WhatsApp account. */
  async lookUp(phone: string): Promise<string | null> {
    const results = await this.#requireOpenSocket().onWhatsApp(phone);
    const found = results?.find((result) => result.exists);
    return found ? jidNormalizedUser(found.jid) : null;
  }

  async sendText(chat: string, text: string, replyTo: WhatsAppStoredMessage | null): Promise<WhatsAppStoredMessage> {
    const socket = this.#requireOpenSocket();
    const quoted: WAMessage | undefined = replyTo
      ? {
          key: {
            remoteJid: chat,
            id: replyTo.id,
            fromMe: replyTo.fromMe,
            ...(isJidGroup(chat) && replyTo.sender ? { participant: replyTo.sender } : {}),
          },
          message: { conversation: replyTo.text },
        }
      : undefined;
    const sent = await socket.sendMessage(chat, { text }, quoted ? { quoted } : undefined);
    if (!sent?.key.id) throw new Error("WhatsApp did not confirm the message.");
    if (sent.message) {
      this.#sent.set(sent.key.id, sent.message);
      const oldest = this.#sent.keys().next();
      if (this.#sent.size > 200 && !oldest.done) this.#sent.delete(oldest.value);
    }
    this.#message(sent);
    const stored = this.#options.history.messages(jidNormalizedUser(chat)).find((item) => item.id === sent.key.id);
    if (!stored) throw new Error("WhatsApp did not confirm the message.");
    return stored;
  }

  /** Sends read receipts for `messages`, the unread messages of others in one chat. */
  async markRead(chat: string, messages: readonly WhatsAppStoredMessage[]): Promise<void> {
    const socket = this.#requireOpenSocket();
    const keys: WAMessageKey[] = messages.map((message) => ({
      remoteJid: chat,
      id: message.id,
      fromMe: false,
      ...(isJidGroup(chat) && message.sender ? { participant: message.sender } : {}),
    }));
    if (keys.length > 0) await socket.readMessages(keys);
    this.#options.history.upsertChat({ id: chat, unread: { set: 0 } });
  }

  /**
   * Asks the phone for up to `count` messages older than `oldest`, and waits up to `timeoutMs` for
   * them. The phone answers only while it is online; answers whether messages arrived.
   */
  async fetchOlder(chat: string, oldest: WhatsAppStoredMessage, count: number, timeoutMs: number): Promise<boolean> {
    const socket = this.#requireOpenSocket();
    const arrived = new Promise<boolean>((resolve) => {
      const waiters = this.#historyWaiters.get(chat) ?? new Set();
      const done = (value: boolean) => {
        clearTimeout(timer);
        waiters.delete(onArrival);
        resolve(value);
      };
      const onArrival = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      waiters.add(onArrival);
      this.#historyWaiters.set(chat, waiters);
    });
    await socket.fetchMessageHistory(
      count,
      {
        remoteJid: chat,
        id: oldest.id,
        fromMe: oldest.fromMe,
        ...(isJidGroup(chat) && oldest.sender ? { participant: oldest.sender } : {}),
      },
      oldest.at,
    );
    return arrived;
  }

  /** Removes this device from the account, as Linked devices > Log out does on the phone. */
  async logOut(): Promise<void> {
    const socket = this.#requireOpenSocket();
    this.#stopped = true;
    await socket.logout();
  }

  /** Closes the socket and stops reconnecting. The keys stay valid. */
  destroy(): void {
    this.#stopped = true;
    this.#open = false;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    const socket = this.#socket;
    this.#socket = null;
    socket?.end(undefined).catch(() => {});
    for (const waiter of this.#openWaiters) waiter();
  }

  // --- connection ----------------------------------------------------------------------------

  #requireSocket(): WASocket {
    if (!this.#socket) throw new Error("WhatsApp is not connected.");
    return this.#socket;
  }

  #requireOpenSocket(): WASocket {
    if (!this.#socket || !this.#open) throw new Error("WhatsApp is not connected.");
    return this.#socket;
  }

  #opened(socket: WASocket): void {
    this.#open = true;
    this.#attempt = 0;
    const me = socket.user ?? this.#auth.creds.me;
    const id = me?.id ? jidNormalizedUser(me.id) : "";
    this.#options.history.setOwnId(id || null);
    this.#options.events.open({ id, name: me?.name ?? me?.notify ?? "" });
    for (const waiter of [...this.#openWaiters]) waiter();
    // Group names, which a history sync does not always carry.
    socket
      .groupFetchAllParticipating()
      .then((groups) => {
        for (const group of Object.values(groups))
          this.#options.history.upsertChat({ id: group.id, name: group.subject, kind: "group" });
      })
      .catch(() => {});
  }

  #closed(error: Error | undefined): void {
    this.#open = false;
    this.#socket = null;
    if (this.#stopped) return;
    const code = whatsappStatusCode(error);
    // After a link, WhatsApp closes the first connection and expects a new one with the new keys.
    if (code === DisconnectReason.restartRequired) {
      void this.start();
      return;
    }
    const reason = this.#stopReason(code);
    if (reason) {
      this.#stopped = true;
      this.#options.events.stopped(reason, logLine(error?.message ?? ""));
      return;
    }
    this.#options.events.offline();
    const delay = RECONNECT_DELAYS_MS[Math.min(this.#attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 60_000;
    this.#attempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.start();
    }, delay);
  }

  /** Why a close with `code` stops the connection for good, or null when the client reconnects. */
  #stopReason(code: number | null): WhatsAppStopReason | null {
    if (code === DisconnectReason.loggedOut) return "logged-out";
    if (code === DisconnectReason.connectionReplaced) return "replaced";
    if (code === DisconnectReason.forbidden) return "forbidden";
    if (code === 405) return "outdated";
    if (this.registered()) return null;
    return code === DisconnectReason.timedOut ? "qr-expired" : "link-failed";
  }

  // --- history ---------------------------------------------------------------------------------

  #chats(chats: Chat[]): void {
    for (const chat of chats) {
      const id = chat.id ? jidNormalizedUser(chat.id) : null;
      if (!usefulChat(id)) continue;
      this.#options.history.upsertChat({
        id,
        name: chat.name ?? null,
        kind: isJidGroup(id) ? "group" : "private",
        ...(typeof chat.unreadCount === "number" ? { unread: { set: chat.unreadCount } } : {}),
        ...(typeof chat.archived === "boolean" ? { archived: chat.archived } : {}),
        lastAt: seconds(chat.conversationTimestamp ?? chat.lastMessageRecvTimestamp ?? 0),
      });
    }
  }

  #chatUpdates(updates: Partial<Chat>[]): void {
    for (const update of updates) {
      const id = update.id ? jidNormalizedUser(update.id) : null;
      if (!usefulChat(id)) continue;
      this.#options.history.upsertChat({
        id,
        ...(update.name ? { name: update.name } : {}),
        ...(typeof update.unreadCount === "number" ? { unread: { add: update.unreadCount } } : {}),
        ...(typeof update.archived === "boolean" ? { archived: update.archived } : {}),
        ...(update.conversationTimestamp ? { lastAt: seconds(update.conversationTimestamp) } : {}),
      });
    }
  }

  #contacts(contacts: Partial<Contact>[]): void {
    for (const contact of contacts) {
      for (const id of [contact.id, contact.lid, contact.phoneNumber]) {
        if (!id) continue;
        const jid = jidNormalizedUser(id);
        // `name` is what the user saved on the phone; `notify` is what the person set.
        this.#options.history.setContactName(jid, contact.name);
        this.#options.history.setPushName(jid, contact.verifiedName ?? contact.notify);
      }
    }
  }

  /** Stores one message. Answers its chat, or null when the message is not one to keep. */
  #message(message: WAMessage): string | null {
    const remote = message.key.remoteJid ? jidNormalizedUser(message.key.remoteJid) : null;
    if (!usefulChat(remote) || !message.key.id) return null;
    const history = this.#options.history;
    // A message that this device could not decrypt.
    if (message.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT) {
      this.#store(message, remote, { text: "", media: "message that could not be decrypted on this computer" });
      return remote;
    }
    const content = normalizeMessageContent(message.message);
    if (!content) return null;
    const protocol = content.protocolMessage;
    if (protocol) {
      const target = protocol.key?.id;
      if (target && protocol.type === proto.Message.ProtocolMessage.Type.REVOKE)
        history.changeMessage(remote, target, { deleted: true });
      if (target && protocol.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT && protocol.editedMessage) {
        const edited = normalizeMessageContent(protocol.editedMessage);
        if (edited) history.changeMessage(remote, target, { text: messageText(edited) });
      }
      return null;
    }
    if (content.reactionMessage) return null;
    const text = messageText(content);
    const media = mediaLabel(content);
    if (!text && !media) return null;
    this.#store(message, remote, { text, media });
    return remote;
  }

  #store(message: WAMessage, chat: string, body: { text: string; media: string | null }): void {
    const content = normalizeMessageContent(message.message);
    const fromMe = message.key.fromMe === true;
    const sender = fromMe ? null : jidNormalizedUser(message.key.participant ?? message.key.remoteJid ?? "") || null;
    this.#options.history.upsertMessage({
      id: message.key.id ?? "",
      chat,
      sender,
      fromMe,
      pushName: message.pushName ?? null,
      at: seconds(message.messageTimestamp),
      text:
        body.text.length > 4_000
          ? `${body.text.slice(0, 4_000)}… [${body.text.length - 4_000} more characters]`
          : body.text,
      media: body.media,
      replyTo: (content && contextInfo(content)?.stanzaId) || null,
      edited: false,
      deleted: false,
    });
  }

  #historyArrived(chat: string): void {
    for (const waiter of [...(this.#historyWaiters.get(chat) ?? [])]) waiter();
  }
}
