import type { MessagingConnectionState } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { jidNormalizedUser, proto, type WAMessage } from "@openbot/whatsapp/baileys";
import { Effect } from "effect";
import type { InboundMessage, MessagingTransport, TransportSink } from "../messaging-types";
import {
  freshUpsert,
  type WhatsAppEvent,
  type WhatsAppIdentity,
  whatsAppDedupKey,
  whatsAppInbound,
} from "./whatsapp-events";
import type { WhatsAppConnectionHandle, WhatsAppRuntime } from "./whatsapp-runtime";
import type { WhatsAppSessionState } from "./whatsapp-session";

const logger = createOpenBotLogger("whatsapp");

/** A socket can deliver one message twice, such as after a reconnect. */
const RECENT_MESSAGES = 2_000;
/** Text-only messages of one author in one conversation within this time become one message. */
const DEBOUNCE_MS = 1_500;
/** A journaled message counts as handed on this long after the transport gave it to the service. */
const HANDLED_AFTER_MS = 60_000;
const PRUNE_INTERVAL_MS = 60 * 60_000;

const STATES: Record<WhatsAppSessionState, MessagingConnectionState | null> = {
  connecting: "connecting",
  open: "connected",
  reconnecting: "reconnecting",
  logged_out: "invalid_token",
  // Another client took the session. The service keeps the state until the owner reconnects.
  replaced: "error",
  // Only a link that has not finished gets it; its own flow reports it.
  unreachable: "reconnecting",
  stopped: null,
};

interface Pending {
  message: InboundMessage;
  /** The journal key of the first message, which the joined message keeps. */
  head: string;
  /** The journal keys of the messages joined into it. */
  followers: string[];
  timer: ReturnType<typeof setTimeout>;
}

export interface WhatsAppTransportOptions {
  runtime: WhatsAppRuntime;
  handle: WhatsAppConnectionHandle;
  identity: WhatsAppIdentity;
  workspaceId: string;
}

/**
 * The inbound half of one linked number. It reads the messages that the socket receives, keeps only
 * those that the sender rules let through, journals each before it hands it on (so a crash replays
 * it, and the mailbox idempotency key drops a copy), and joins a burst of short messages into one.
 */
export class WhatsAppTransport implements MessagingTransport {
  readonly #runtime: WhatsAppRuntime;
  readonly #handle: WhatsAppConnectionHandle;
  readonly #identity: WhatsAppIdentity;
  readonly #workspaceId: string;
  readonly #seen = new Set<string>();
  readonly #pending = new Map<string, Pending>();
  /** The journal keys of messages handed to the service and not yet marked handled, with their timers. */
  readonly #handed = new Map<string, ReturnType<typeof setTimeout>>();
  #sink: TransportSink | null = null;
  /** Messages are read one at a time, so they reach the service in the order WhatsApp gave them. */
  #reading: Promise<void> = Promise.resolve();
  #unsubscribe: Array<() => void> = [];
  #prune: ReturnType<typeof setInterval> | null = null;

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
        for (const message of messages) if (freshUpsert(type, message, session.openedAt)) this.#enqueue(message, true);
      }),
    );
    store.prune();
    this.#prune = setInterval(() => this.#handle.store.prune(), PRUNE_INTERVAL_MS);
    this.#prune.unref?.();
    sink.state("connecting");
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
    // The service finishes the messages it has (its work is uninterruptible), so after a normal stop
    // only a crash replays them.
    for (const [dedupKey, timer] of this.#handed) {
      clearTimeout(timer);
      this.#handle.store.markHandled(dedupKey);
    }
    this.#handed.clear();
    if (this.#prune) clearInterval(this.#prune);
    this.#prune = null;
    // The store stays open: a restart of the connection uses it again.
    yield* this.#handle.session.stop();
  });

  #enqueue(message: WAMessage, live: boolean): void {
    this.#reading = this.#reading.then(() => this.#read(message, live));
  }

  async #read(message: WAMessage, live: boolean): Promise<void> {
    const dedupKey = whatsAppDedupKey(message);
    if (!dedupKey || this.#remember(dedupKey)) return;
    const { session, store, chats } = this.#handle;
    let event: WhatsAppEvent | null;
    try {
      event = await whatsAppInbound(message, {
        me: this.#identity,
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
      });
    } catch (cause) {
      logger.warn("A WhatsApp message could not be read.", { cause: cause instanceof Error ? cause.name : "unknown" });
      return;
    }
    if (!event || !this.#sink) return;
    if (event.type === "pairing") return this.#pair(event);
    if (event.type === "action") {
      this.#sink.action(event.action);
      return;
    }
    if (live) store.journal({ dedupKey, payload: encodeJournal(message), receivedAt: Date.now() });
    // The message continues its conversation: a reply to it names the same conversation.
    if (event.isGroup)
      store.putPost(event.message.platformMessageId, { chatJid: event.chatJid, threadKey: event.message.threadKey });
    // A replayed message goes alone: joined with others, its own key would not reach the mailbox.
    if (live) this.#queue(event.message, dedupKey);
    else this.#hand(event.message, dedupKey);
  }

  /** Joins a burst of short text messages of one author in one conversation; any other message goes at once. */
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
    // Nothing of a burst counts as handled before it goes: a stop before then replays each message.
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
    // The joined messages are in the first one's text, so a replay must not send them again.
    for (const follower of pending.followers) this.#handle.store.markHandled(follower);
    this.#handledLater(pending.head);
  }

  #hand(message: InboundMessage, dedupKey: string): void {
    this.#sink?.message(message);
    this.#handledLater(dedupKey);
  }

  /** The service takes a message within moments; a crash before this time replays it. */
  #handledLater(dedupKey: string): void {
    const timer = setTimeout(() => {
      this.#handed.delete(dedupKey);
      this.#handle.store.markHandled(dedupKey);
    }, HANDLED_AFTER_MS);
    timer.unref?.();
    this.#handed.set(dedupKey, timer);
  }

  /** A dedicated number answers an unknown person once, with the code the owner sees in OpenBot. */
  async #pair(event: Extract<WhatsAppEvent, { type: "pairing" }>): Promise<void> {
    const request = this.#runtime.policy.pairing(this.#workspaceId, event.senderId, event.name);
    if (!request?.created) return;
    await Effect.runPromise(
      this.#handle.session
        .send(event.chatJid, { text: sourceText("status.messaging.whatsappPairingCode", { code: request.code }) })
        .pipe(Effect.catch(() => Effect.void)),
    );
  }

  /** True when the message was already read. */
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

/** The message as protobuf, and the phone forms of its chat and author, which protobuf does not carry. */
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
