import { createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { sourceText } from "@openbot/i18n/source";
import { WhatsAppStoreUnreadable } from "@openbot/whatsapp/auth-store";
import {
  type AnyMessageContent,
  downloadMediaMessage,
  isJidGroup,
  type MiscMessageGenerationOptions,
  type WAMessage,
  type WAMessageKey,
} from "@openbot/whatsapp/baileys";
import { Effect, Result } from "effect";
import type { MessagingAnswerFile } from "../messaging-threads";
import {
  type ConnectionIdentity,
  type ContextEntry,
  type InboundFile,
  type MessageBody,
  type MessageTarget,
  type MessagingAdapter,
  MessagingAdapterError,
  MessagingConnectionError,
  type MessagingDriver,
  type MessagingPlace,
  type StatusReaction,
} from "../messaging-types";
import {
  userJid,
  WHATSAPP_DIRECT_THREAD,
  type WhatsAppIdentity,
  whatsAppQuoteId,
  whatsAppThreadKey,
} from "./whatsapp-events";
import { whatsAppChunks, whatsAppText } from "./whatsapp-render";
import type { WhatsAppConnectionHandle, WhatsAppRuntime } from "./whatsapp-runtime";
import { WhatsAppTransport } from "./whatsapp-transport";

/** WhatsApp takes larger files, but a phone on mobile data should not have to. */
const WHATSAPP_FILE_BYTES_LIMIT = 64 * 1024 * 1024;
/** WhatsApp clients show an edit only within 15 minutes; a later edit is lost without an error. */
const EDIT_WINDOW_MS = 14 * 60_000;
const PLACE_NAME_TIMEOUT_MS = 5_000;

const REACTIONS: Record<StatusReaction, string> = {
  received: "👀",
  done: "👌",
  failed: "💔",
  stopped: "🫡",
};

const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** The stored values of one linked number. `whatsappStoreKey` opens its store, the others name it. */
export interface WhatsAppCredentials {
  storeId: string;
  storeKey: Uint8Array;
  ownNumber: boolean;
}

export function whatsAppCredentials(values: Record<string, string>): WhatsAppCredentials {
  return {
    storeId: values.storeId ?? "",
    storeKey: Buffer.from(values.whatsappStoreKey ?? "", "base64"),
    ownNumber: values.ownNumber !== "0",
  };
}

/** The linked number of a store, or null before the link finished. */
export function whatsAppIdentity(handle: WhatsAppConnectionHandle): WhatsAppIdentity | null {
  const me = handle.store.creds.me;
  const number = me?.id ? userPart(me.id) : null;
  if (!number) return null;
  return { number, lid: me?.lid ? `${userPart(me.lid)}@lid` : null };
}

/** A phone number with only its last digits shown, for a name that can appear in logs and lists. */
export function maskedNumber(number: string): string {
  return number.length <= 4 ? number : `+${"•".repeat(Math.max(0, number.length - 4))}${number.slice(-4)}`;
}

/** The outbound side of one linked number. It never logs message text or phone numbers. */
class WhatsAppAdapter implements MessagingAdapter {
  readonly platform = "whatsapp" as const;
  readonly #runtime: WhatsAppRuntime;
  readonly #credentials: WhatsAppCredentials;
  #opened: WhatsAppConnectionHandle | null = null;
  /** When each post was sent, for the edit window. */
  readonly #sentAt = new Map<string, number>();

  constructor(runtime: WhatsAppRuntime, credentials: WhatsAppCredentials) {
    this.#runtime = runtime;
    this.#credentials = credentials;
  }

  /** The open store. `identify` opens it; every other call comes after a successful `identify`. */
  get #handle(): WhatsAppConnectionHandle {
    this.#opened ??= this.#runtime.open(this.#credentials.storeId, this.#credentials.storeKey);
    return this.#opened;
  }

  identify(): Effect.Effect<ConnectionIdentity, MessagingAdapterError> {
    return Effect.suspend(() => {
      const opened = Result.try({
        try: () => this.#handle,
        catch: (cause) => cause,
      });
      // A store that another process holds is tried again later. One that does not open has lost its
      // keys: the number must link again.
      if (Result.isFailure(opened))
        return Effect.fail(
          new MessagingAdapterError({
            cause:
              opened.failure instanceof WhatsAppStoreUnreadable
                ? new MessagingConnectionError("invalid_token")
                : opened.failure,
          }),
        );
      const identity = whatsAppIdentity(this.#handle);
      // A device that never finished its link, or one whose keys were removed, must link again.
      if (!identity)
        return Effect.fail(new MessagingAdapterError({ cause: new MessagingConnectionError("invalid_token") }));
      const name = this.#handle.store.creds.me?.name?.trim();
      return Effect.succeed({
        workspaceId: identity.number,
        workspaceName: name ? `${name} (${maskedNumber(identity.number)})` : maskedNumber(identity.number),
        botUserId: identity.number,
        appId: "whatsapp",
        missingScopes: [],
      });
    });
  }

  readonly post = Effect.fnUntraced(function* (this: WhatsAppAdapter, target: MessageTarget, body: MessageBody) {
    const sent = yield* this.#send(target, { text: this.#statusText(body), ...this.#mentions(body.text) });
    if (body.buttons?.length)
      this.#handle.chats.rememberMenu(sent, {
        chatJid: target.platformChannelId,
        threadKey: whatsAppThreadKey(target),
        buttons: body.buttons,
      });
    return sent;
  });

  readonly edit = Effect.fnUntraced(function* (
    this: WhatsAppAdapter,
    target: MessageTarget,
    messageId: string,
    body: MessageBody,
  ) {
    if (!body.buttons?.length) this.#handle.chats.forgetMenu(messageId);
    const sentAt = this.#sentAt.get(messageId);
    // Past the window, an edit would be lost: the change goes as a new post that quotes the old one.
    if (sentAt === undefined || Date.now() - sentAt > EDIT_WINDOW_MS) {
      yield* this.post(target, body);
      return;
    }
    yield* this.#session().send(target.platformChannelId, {
      text: this.#statusText(body),
      edit: this.#ownKey(target, messageId),
    });
  });

  /** WhatsApp has no message that only one person sees, so the text is a reply in the chat. */
  postPrivate(target: MessageTarget, _userId: string, text: string): Effect.Effect<void, MessagingAdapterError> {
    return this.post(target, { text }).pipe(Effect.asVoid);
  }

  readonly react = Effect.fnUntraced(function* (
    this: WhatsAppAdapter,
    target: MessageTarget,
    messageId: string,
    reaction: StatusReaction,
    on: boolean,
  ) {
    const facts = this.#handle.chats.keyOf(messageId);
    const key: WAMessageKey = {
      remoteJid: target.platformChannelId,
      id: messageId,
      fromMe: facts?.fromMe ?? false,
      ...(facts?.participant ? { participant: facts.participant } : {}),
    };
    yield* this.#session().send(target.platformChannelId, { react: { text: on ? REACTIONS[reaction] : "", key } });
  });

  readonly postAnswer = Effect.fnUntraced(function* (
    this: WhatsAppAdapter,
    target: MessageTarget,
    markdown: string,
    replaceMessageId: string | null,
  ) {
    yield* this.#checkPlace(target.platformChannelId);
    const [first = "", ...rest] = whatsAppChunks(markdown);
    let firstId: string | null = null;
    if (replaceMessageId) {
      const sentAt = this.#sentAt.get(replaceMessageId);
      if (sentAt !== undefined && Date.now() - sentAt <= EDIT_WINDOW_MS) {
        const edited = yield* Effect.result(
          this.#session().send(target.platformChannelId, { text: first, edit: this.#ownKey(target, replaceMessageId) }),
        );
        if (Result.isSuccess(edited)) firstId = replaceMessageId;
      }
      if (firstId === null)
        // The status post would stay as "Working on it…" above the answer, so it goes.
        yield* this.#session()
          .send(target.platformChannelId, { delete: this.#ownKey(target, replaceMessageId) })
          .pipe(Effect.catch(() => Effect.void));
    }
    firstId ??= yield* this.#send(target, { text: first });
    for (const chunk of rest) yield* this.#send(target, { text: chunk });
    return firstId;
  });

  readonly upload = Effect.fnUntraced(function* (
    this: WhatsAppAdapter,
    target: MessageTarget,
    files: MessagingAnswerFile[],
  ) {
    yield* this.#checkPlace(target.platformChannelId);
    const skipped: string[] = [];
    for (const file of files) {
      const sent = yield* Effect.result(
        Effect.gen({ self: this }, function* () {
          const size = yield* Effect.tryPromise({
            try: () => stat(file.path).then((info) => info.size),
            catch: (cause) => new MessagingAdapterError({ cause }),
          });
          if (size === 0 || size > WHATSAPP_FILE_BYTES_LIMIT) return false;
          const image = IMAGE_TYPES[extname(file.name).toLowerCase()];
          const content: AnyMessageContent = image
            ? { image: { url: file.path }, mimetype: image }
            : {
                document: { url: file.path },
                fileName: file.name.slice(0, 255) || "file",
                mimetype: "application/octet-stream",
              };
          yield* this.#send(target, content);
          return true;
        }),
      );
      if (Result.isFailure(sent) || !sent.success) skipped.push(file.name);
    }
    return skipped;
  });

  history(
    platformChannelId: string,
    threadKey: string,
    afterId: string | null,
    beforeId: string,
  ): Effect.Effect<ContextEntry[], MessagingAdapterError> {
    return Effect.sync(() => this.#handle.chats.history(platformChannelId, threadKey, afterId, beforeId));
  }

  /** WhatsApp sends no history to this device: this is what it saw since it started. */
  recent(
    platformChannelId: string,
    threadKey: string | null,
    limit: number,
  ): Effect.Effect<ContextEntry[], MessagingAdapterError> {
    return Effect.sync(() => this.#handle.chats.recent(platformChannelId, threadKey, limit));
  }

  readonly download = Effect.fnUntraced(function* (
    this: WhatsAppAdapter,
    file: InboundFile,
    destination: string,
    maxBytes: number,
  ) {
    const message = this.#handle.chats.media(file.url);
    if (!message) return yield* new MessagingAdapterError({ cause: new Error("file_unavailable") });
    if (file.size > maxBytes) return yield* new MessagingAdapterError({ cause: new Error("file_too_large") });
    const socket = this.#handle.session.socket();
    yield* Effect.tryPromise({
      try: async () => {
        const stream = await downloadMediaMessage(
          message,
          "stream",
          {},
          {
            logger: silentLogger,
            reuploadRequest: (stale) =>
              socket ? socket.updateMediaMessage(stale) : Promise.reject(new Error("not_connected")),
          },
        );
        let total = 0;
        const limit = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            total += chunk.byteLength;
            done(total > maxBytes ? new Error("file_too_large") : null, chunk);
          },
        });
        await pipeline(stream, limit, createWriteStream(destination, { mode: 0o600 }));
      },
      catch: (cause) => new MessagingAdapterError({ cause }),
    });
  });

  authorName(userId: string): Effect.Effect<string, MessagingAdapterError> {
    return Effect.sync(() => this.#handle.chats.name(userId) ?? maskedNumber(userId));
  }

  placeName(platformChannelId: string): Effect.Effect<string, MessagingAdapterError> {
    return Effect.gen({ self: this }, function* () {
      if (!isJidGroup(platformChannelId)) {
        const user = userPart(platformChannelId);
        return (user && this.#handle.chats.name(user)) ?? maskedNumber(user ?? platformChannelId);
      }
      const known = this.#handle.chats.groupName(platformChannelId);
      if (known) return known;
      const metadata = yield* this.#handle.session
        .groupMetadata(platformChannelId)
        .pipe(Effect.timeoutOrElse({ duration: PLACE_NAME_TIMEOUT_MS, orElse: () => Effect.succeed(null) }));
      this.#handle.chats.rememberGroup(platformChannelId, metadata?.subject);
      return this.#handle.chats.groupName(platformChannelId) ?? "WhatsApp group";
    });
  }

  /** The owner's own chat and the allowed chats. OpenBot posts nowhere else. */
  places(): Effect.Effect<MessagingPlace[], MessagingAdapterError> {
    return Effect.gen({ self: this }, function* () {
      const identity = whatsAppIdentity(this.#handle);
      if (!identity) return [];
      const rules = this.#runtime.policy.rules(identity.number);
      const places: MessagingPlace[] = [];
      if (rules.ownNumber)
        places.push({
          id: userJid(identity.number),
          name: sourceText("status.messaging.whatsappOwnChat"),
          kind: "chat",
        });
      for (const contact of rules.contacts)
        places.push({
          id: userJid(contact),
          name: this.#handle.chats.name(contact) ?? maskedNumber(contact),
          kind: "chat",
        });
      for (const group of rules.groups) places.push({ id: group, name: yield* this.placeName(group), kind: "channel" });
      return places;
    });
  }

  /** WhatsApp notifies a person for `@<number>` when the post also lists them; `post` does that. */
  mention(userId: string): string {
    return /^[0-9]+$/u.test(userId) ? `@${userId}` : userId;
  }

  #session() {
    return this.#handle.session;
  }

  /** Posts to the target's chat, quoting the message it answers in a group, and records the post. */
  #send(target: MessageTarget, content: AnyMessageContent): Effect.Effect<string, MessagingAdapterError> {
    return Effect.gen({ self: this }, function* () {
      yield* this.#checkPlace(target.platformChannelId);
      const quoteId = whatsAppQuoteId(target);
      const options: MiscMessageGenerationOptions | undefined = quoteId
        ? { quoted: this.#quoted(target, quoteId) }
        : undefined;
      const sent = yield* this.#session().send(target.platformChannelId, content, options);
      const id = sent.key.id ?? "";
      this.#sentAt.set(id, Date.now());
      if (this.#sentAt.size > 1_000) {
        const oldest = this.#sentAt.keys().next().value;
        if (oldest !== undefined) this.#sentAt.delete(oldest);
      }
      const threadKey = isJidGroup(target.platformChannelId)
        ? target.replyThreadId
          ? whatsAppThreadKey(target)
          : id
        : WHATSAPP_DIRECT_THREAD;
      // A reply to this post continues its conversation, also after a restart.
      this.#handle.store.putPost(id, { chatJid: target.platformChannelId, threadKey });
      this.#handle.chats.rememberKey(id, { fromMe: true, participant: null, text: "" });
      return id;
    });
  }

  /** Refuses a chat that the owner did not allow, such as a place an agent named by mistake. */
  #checkPlace(chatJid: string): Effect.Effect<void, MessagingAdapterError> {
    return Effect.suspend(() => {
      const identity = whatsAppIdentity(this.#handle);
      if (!identity) return Effect.fail(new MessagingAdapterError({ cause: new Error("not_linked") }));
      const rules = this.#runtime.policy.rules(identity.number);
      const user = isJidGroup(chatJid) ? null : userPart(chatJid);
      const allowed =
        this.#handle.chats.isAllowedChat(chatJid) ||
        (isJidGroup(chatJid)
          ? rules.groups.has(chatJid)
          : user === identity.number || (user !== null && rules.contacts.has(user)));
      return allowed ? Effect.void : Effect.fail(new MessagingAdapterError({ cause: new Error("place_not_allowed") }));
    });
  }

  /** The message to quote. WhatsApp needs its key and some content; the text is what OpenBot saw of it. */
  #quoted(target: MessageTarget, messageId: string): WAMessage {
    const facts = this.#handle.chats.keyOf(messageId);
    return {
      key: {
        remoteJid: target.platformChannelId,
        id: messageId,
        fromMe: facts?.fromMe ?? false,
        ...(facts?.participant ? { participant: facts.participant } : {}),
      },
      message: { conversation: facts?.text ?? "" },
    };
  }

  #ownKey(target: MessageTarget, messageId: string): WAMessageKey {
    return { remoteJid: target.platformChannelId, id: messageId, fromMe: true };
  }

  /** Status text from the host, in WhatsApp's formatting, with its buttons as a numbered menu. */
  #statusText(body: MessageBody): string {
    const actions = new Set(body.buttons?.map((button) => button.action));
    const menu = [
      actions.has("accept") && actions.has("decline") ? sourceText("status.messaging.whatsappApprovalMenu") : "",
      actions.has("stop") ? sourceText("status.messaging.whatsappStopMenu") : "",
    ].filter(Boolean);
    return [whatsAppText(body.text), ...menu].join("\n\n");
  }

  /** The people that host text mentions as `@<number>`, so WhatsApp shows them as mentions. */
  #mentions(text: string): { mentions?: string[] } {
    const numbers = [...text.matchAll(/@([0-9]{5,20})\b/gu)].map((match) => userJid(match[1] ?? ""));
    return numbers.length ? { mentions: [...new Set(numbers)] } : {};
  }
}

export interface WhatsAppDriverOptions {
  runtime: WhatsAppRuntime;
}

/** Each connection is one linked number with its own store; the runtime keeps them open. */
export function whatsAppDriver(options: WhatsAppDriverOptions): MessagingDriver {
  const { runtime } = options;
  return {
    platform: "whatsapp",
    requiredCredential: "whatsappStoreKey",
    createAdapter(credentials) {
      return new WhatsAppAdapter(runtime, whatsAppCredentials(credentials));
    },
    // After `identify`, which opened the store.
    createTransport(credentials, identity) {
      const values = whatsAppCredentials(credentials);
      const handle = runtime.open(values.storeId, values.storeKey);
      const me = whatsAppIdentity(handle) ?? { number: identity.workspaceId, lid: null };
      return new WhatsAppTransport({ runtime, handle, identity: me, workspaceId: identity.workspaceId });
    },
  };
}

function userPart(jid: string): string | null {
  return jid.split("@")[0]?.split(":")[0] ?? null;
}

const silentLogger = {
  level: "silent",
  child: () => silentLogger,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
