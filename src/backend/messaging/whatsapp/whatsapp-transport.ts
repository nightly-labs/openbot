import type { MessagingConnectionState } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { jidNormalizedUser, proto, type WAMessage } from "@openbot/whatsapp/baileys";
import { Effect } from "effect";
import type { InboundMessage, MessagingTransport, TransportSink } from "../messaging-types";
import {
  freshUpsert,
  sentAt,
  userJid,
  type WhatsAppEvent,
  type WhatsAppIdentity,
  whatsAppDedupKey,
  whatsAppInbound,
} from "./whatsapp-events";
import { WhatsAppSelfChatLimit } from "./whatsapp-loop-guard";
import type { WhatsAppConnectionHandle, WhatsAppRuntime } from "./whatsapp-runtime";
import type { WhatsAppSessionState } from "./whatsapp-session";

const logger = createOpenBotLogger("whatsapp");

const RECENT_MESSAGES = 2_000;
const DEBOUNCE_MS = 1_500;
const HANDLED_AFTER_MS = 60_000;
const PRUNE_INTERVAL_MS = 60 * 60_000;

const STATES: Record<WhatsAppSessionState, MessagingConnectionState | null> = {
  connecting: "connecting",
  open: "connected",
  reconnecting: "reconnecting",
  failing: "error",
  logged_out: "invalid_token",
  replaced: "error",
  unreachable: "reconnecting",
  stopped: null,
};

interface Pending {
  message: InboundMessage;
  head: string;
  followers: string[];
  timer: ReturnType<typeof setTimeout>;
}

export interface WhatsAppTransportOptions {
  runtime: WhatsAppRuntime;
  handle: WhatsAppConnectionHandle;
  identity: () => WhatsAppIdentity;
  workspaceId: string;
}

export class WhatsAppTransport implements MessagingTransport {
  readonly #runtime: WhatsAppRuntime;
  readonly #handle: WhatsAppConnectionHandle;
  readonly #identity: () => WhatsAppIdentity;
  readonly #workspaceId: string;
  readonly #seen = new Set<string>();
  readonly #pending = new Map<string, Pending>();
  readonly #handed = new Map<string, ReturnType<typeof setTimeout>>();
  #sink: TransportSink | null = null;
  #reading: Promise<void> = Promise.resolve();
  #unsubscribe: Array<() => void> = [];
  #prune: ReturnType<typeof setInterval> | null = null;
  readonly #selfChatLimit = new WhatsAppSelfChatLimit();
  #toldOtherOpenBot = false;

  constructor(options: WhatsAppTransportOptions) {
    this.#runtime = options.runtime;
    this.#handle = options.handle;
    this.#identity = options.identity;
    this.#workspaceId = options.workspaceId;
  }

  start(sink: TransportSink): void {
    this.#sink = sink;
    const { session, store } = this.#handle;
    this.#unsubscribe.push(
      session.onState((state) => {
        const mapped = STATES[state];
        if (mapped) this.#sink?.state(mapped);
      }),
      session.onUpsert(({ messages, type }) => {
        const upsertWindow = session.upsertWindow();
        for (const message of messages) {
          if (freshUpsert(type, message, upsertWindow)) this.#enqueue(message, true);
          else if (type === "append") this.#enqueue(message, false, true);
        }
      }),
    );
    store.prune();
    this.#prune = setInterval(() => this.#handle.store.prune(), PRUNE_INTERVAL_MS);
    this.#prune.unref?.();
    sink.state(session.state === "open" ? "connected" : "connecting");
    for (const entry of store.unhandled()) {
      const message = decodeJournal(entry.payload);
      if (message) this.#enqueue(message, false);
    }
    session.start();
  }

  reconnect(): void {
    this.#handle.session.reconnect();
  }

  readonly stop = Effect.fn("WhatsAppTransport.stop")(function* (this: WhatsAppTransport) {
    this.#sink = null;
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
    for (const pending of this.#pending.values()) clearTimeout(pending.timer);
    this.#pending.clear();
    for (const [dedupKey, timer] of this.#handed) {
      clearTimeout(timer);
      this.#handle.store.markHandled(dedupKey);
    }
    this.#handed.clear();
    if (this.#prune) clearInterval(this.#prune);
    this.#prune = null;
    yield* this.#handle.session.stop();
  });

  #enqueue(message: WAMessage, live: boolean, historyOnly = false): void {
    this.#reading = this.#reading
      .then(() => this.#read(message, live, historyOnly))
      .catch((cause: unknown) => {
        logger.warn("A WhatsApp message could not be read.", {
          cause: cause instanceof Error ? cause.name : "unknown",
        });
      });
  }

  async #read(message: WAMessage, live: boolean, historyOnly: boolean): Promise<void> {
    const dedupKey = whatsAppDedupKey(message);
    if (!dedupKey || message.messageStubType === proto.WebMessageInfo.StubType.CIPHERTEXT) return;
    if (historyOnly ? this.#seen.has(dedupKey) : this.#remember(dedupKey)) return;
    const { session, store, chats } = this.#handle;
    let event: WhatsAppEvent | null;
    try {
      event = await whatsAppInbound(message, {
        me: this.#identity(),
        openedAt: session.openedAt,
        now: Date.now(),
        rules: this.#runtime.policy.rules(this.#workspaceId),
        chats,
        isOwnPost: (id) => session.isOwnPost(id),
        threadOf: (id) => store.getPost(id)?.threadKey ?? null,
        numberForLid: async (lid) => {
          const mapping = session.socket()?.signalRepository.lidMapping;
          const pn = mapping ? await mapping.getPNForLID(lid).catch(() => null) : null;
          return pn ? (jidNormalizedUser(pn).split("@")[0]?.split(":")[0] ?? null) : null;
        },
        historyOnly,
      });
    } catch (cause) {
      logger.warn("A WhatsApp message could not be read.", { cause: cause instanceof Error ? cause.name : "unknown" });
      return;
    }
    if (!event || !this.#sink) return;
    if (event.type === "pairing") return this.#pair(event);
    if (event.type === "otherOpenBot") {
      if (this.#toldOtherOpenBot) return;
      this.#toldOtherOpenBot = await this.#tell(event.chatJid, "status.messaging.whatsappOtherOpenBot");
      return;
    }
    if (event.type === "action") {
      this.#sink.action(event.action);
      return;
    }
    if (live && event.chatJid === userJid(this.#identity().number)) {
      const limit = this.#selfChatLimit.check(sentAt(message) || Date.now(), event.message.text);
      if (limit === "pause") {
        logger.warn("The owner's own WhatsApp chat got too many requests; it gets no answers for a while.");
        await this.#tell(event.chatJid, "status.messaging.whatsappPaused");
        return;
      }
      if (limit === "paused") return;
    }
    if (live) store.journal({ dedupKey, payload: encodeJournal(message), receivedAt: Date.now() });
    if (event.isGroup)
      store.putPost(event.message.platformMessageId, { chatJid: event.chatJid, threadKey: event.message.threadKey });
    if (live) this.#queue(event.message, dedupKey);
    else this.#hand(event.message, dedupKey);
  }

  #queue(message: InboundMessage, dedupKey: string): void {
    const key = `${message.platformChannelId}:${message.threadKey}:${message.authorId}`;
    const pending = this.#pending.get(key);
    const textOnly = message.files.length === 0 && !message.replyTo;
    if (pending && textOnly) {
      clearTimeout(pending.timer);
      pending.followers.push(dedupKey);
      pending.message = {
        ...pending.message,
        text: `${pending.message.text}\n${message.text}`,
        mentionedUserIds: [...new Set([...pending.message.mentionedUserIds, ...message.mentionedUserIds])],
        requiresLink: pending.message.requiresLink && message.requiresLink,
        platformMessageId: message.platformMessageId,
        target: message.target,
      };
      pending.timer = this.#flushLater(key);
      return;
    }
    if (pending) this.#flush(key);
    if (!textOnly) {
      this.#hand(message, dedupKey);
      return;
    }
    this.#pending.set(key, { message, head: dedupKey, followers: [], timer: this.#flushLater(key) });
  }

  #flushLater(key: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => this.#flush(key), DEBOUNCE_MS);
    timer.unref?.();
    return timer;
  }

  #flush(key: string): void {
    const pending = this.#pending.get(key);
    this.#pending.delete(key);
    if (!pending || !this.#sink) return;
    clearTimeout(pending.timer);
    this.#sink.message(pending.message);
    for (const follower of pending.followers) this.#handle.store.markHandled(follower);
    this.#handledLater(pending.head);
  }

  #hand(message: InboundMessage, dedupKey: string): void {
    this.#sink?.message(message);
    this.#handledLater(dedupKey);
  }

  #handledLater(dedupKey: string): void {
    const timer = setTimeout(() => {
      this.#handed.delete(dedupKey);
      this.#handle.store.markHandled(dedupKey);
    }, HANDLED_AFTER_MS);
    timer.unref?.();
    this.#handed.set(dedupKey, timer);
  }

  async #pair(event: Extract<WhatsAppEvent, { type: "pairing" }>): Promise<void> {
    const request = this.#runtime.policy.pairing(this.#workspaceId, event.senderId, event.name);
    if (!request?.created) return;
    await Effect.runPromise(
      this.#handle.session
        .send(event.chatJid, { text: sourceText("status.messaging.whatsappPairingCode", { code: request.code }) })
        .pipe(Effect.catch(() => Effect.void)),
    );
  }

  #tell(chatJid: string, key: "status.messaging.whatsappOtherOpenBot" | "status.messaging.whatsappPaused") {
    return Effect.runPromise(
      this.#handle.session.send(chatJid, { text: sourceText(key) }).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      ),
    );
  }

  #remember(dedupKey: string): boolean {
    if (this.#seen.has(dedupKey)) return true;
    this.#seen.add(dedupKey);
    if (this.#seen.size > RECENT_MESSAGES) {
      const oldest = this.#seen.values().next().value;
      if (oldest !== undefined) this.#seen.delete(oldest);
    }
    return false;
  }
}

interface JournalEntry {
  message: string;
  remoteJidAlt?: string;
  participantAlt?: string;
}

function encodeJournal(message: WAMessage): string {
  const entry: JournalEntry = {
    message: Buffer.from(proto.WebMessageInfo.encode(message).finish()).toString("base64"),
    ...(message.key.remoteJidAlt ? { remoteJidAlt: message.key.remoteJidAlt } : {}),
    ...(message.key.participantAlt ? { participantAlt: message.key.participantAlt } : {}),
  };
  return JSON.stringify(entry);
}

function decodeJournal(payload: string): WAMessage | null {
  try {
    const { message, remoteJidAlt, participantAlt } = JSON.parse(payload);
    if (typeof message !== "string") return null;
    const decoded = proto.WebMessageInfo.decode(Buffer.from(message, "base64"));
    if (!decoded.key) return null;
    const key = {
      ...decoded.key,
      ...(typeof remoteJidAlt === "string" ? { remoteJidAlt } : {}),
      ...(typeof participantAlt === "string" ? { participantAlt } : {}),
    };
    return Object.assign(decoded, { key });
  } catch {
    return null;
  }
}
