import { chmod, copyFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { parseWhatsAppPhoneNumber } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { WhatsAppStoreUnreadable } from "@openbot/whatsapp/auth-store";
import {
  type AnyMessageContent,
  isJidGroup,
  type MiscMessageGenerationOptions,
  type WAMessage,
  type WAMessageKey,
} from "@openbot/whatsapp/baileys";
import { Effect, Result } from "effect";
import { imageSize } from "../../image-size";
import type { MessagingAnswerFile } from "../messaging-threads";
import {
  type ConnectionIdentity,
  type ContextEntry,
  type HistoryFilter,
  type InboundFile,
  type MessageBody,
  type MessageTarget,
  type MessagingAdapter,
  MessagingAdapterError,
  MessagingConnectionError,
  type MessagingDriver,
  type MessagingPlace,
  type MessagingPlaces,
  type RecentMessages,
  type StatusReaction,
  WhatsAppAnswerPartlySent,
  WhatsAppRefusedError,
} from "../messaging-types";
import { WhatsAppArchive } from "./whatsapp-archive";
import {
  userJid,
  WHATSAPP_DIRECT_THREAD,
  type WhatsAppIdentity,
  whatsAppQuoteId,
  whatsAppThreadKey,
} from "./whatsapp-events";
import { downloadWhatsAppMedia } from "./whatsapp-media";
import { whatsAppChunks, whatsAppText } from "./whatsapp-render";
import type { WhatsAppConnectionHandle, WhatsAppRuntime } from "./whatsapp-runtime";
import { allowsContact, isReadOnlyChat, whatsAppNumberForms } from "./whatsapp-senders";
import type { WhatsAppSocket } from "./whatsapp-session";
import { WhatsAppTransport } from "./whatsapp-transport";

const WHATSAPP_FILE_BYTES_LIMIT = 64 * 1024 * 1024;
const WHATSAPP_CAPTION_LIMIT = 1_024;
const WHATSAPP_POST_STOPS = new Set([
  "place_not_allowed",
  "place_read_only",
  "no_account",
  "not_linked",
  "not_connected",
  "not_confirmed",
]);
const EDIT_WINDOW_MS = 14 * 60_000;
const PLACE_NAME_TIMEOUT_MS = 5_000;
const ACCOUNT_CHECK_TIMEOUT_MS = 5_000;
const SAVED_HISTORY_NOTE =
  "WhatsApp sends no older messages to OpenBot. OpenBot has only the messages that it received after the number was linked and the chat was allowed, up to 1 day old on arrival, for 90 days. In a chat with a contact, the messages that the user sent from their phone are not saved. Fewer messages here does not mean that the connection has a problem: tell the user what OpenBot can read.";

const REACTIONS: Record<StatusReaction, string> = {
  received: "👀",
  done: "✅",
  failed: "❌",
  stopped: "🫡",
};

const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const DOCUMENT_TYPES: Record<string, string> = {
  ".htm": "text/html",
  ".html": "text/html",
};

export interface WhatsAppCredentials {
  storeId: string;
  storeKey: Uint8Array;
  ownNumber: boolean;
  workingMessage: boolean;
  statusReactions: boolean;
}

export function whatsAppCredentials(values: Record<string, string>): WhatsAppCredentials {
  return {
    storeId: values.storeId ?? "",
    storeKey: Buffer.from(values.whatsappStoreKey ?? "", "base64"),
    ownNumber: values.ownNumber !== "0",
    workingMessage: values.workingMessage !== "0",
    statusReactions: values.statusReactions !== "0",
  };
}

export function whatsAppIdentity(handle: WhatsAppConnectionHandle): WhatsAppIdentity | null {
  const me = handle.store.creds.me;
  const number = me?.id ? userPart(me.id) : null;
  if (!number) return null;
  return { number, lid: me?.lid ? `${userPart(me.lid)}@lid` : null };
}

export function maskedNumber(number: string): string {
  return number.length <= 4 ? number : `+${"•".repeat(Math.max(0, number.length - 4))}${number.slice(-4)}`;
}

class WhatsAppAdapter implements MessagingAdapter {
  readonly platform = "whatsapp" as const;
  readonly searchesHistory = true;
  readonly #runtime: WhatsAppRuntime;
  readonly #credentials: WhatsAppCredentials;
  #opened: WhatsAppConnectionHandle | null = null;
  readonly #sentAt = new Map<string, number>();
  #accounts: { socket: WhatsAppSocket; numbers: Set<string> } | null = null;

  constructor(runtime: WhatsAppRuntime, credentials: WhatsAppCredentials) {
    this.#runtime = runtime;
    this.#credentials = credentials;
  }

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
    yield* this.#checkPlace(target.platformChannelId);
    const sent = yield* this.#send(target, {
      text: this.#statusText(body),
      ...this.#mentions(body.text),
    });
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
    if (sentAt === undefined || Date.now() - sentAt > EDIT_WINDOW_MS) {
      yield* this.post(target, body);
      return;
    }
    yield* this.#session().send(target.platformChannelId, {
      text: this.#statusText(body),
      edit: this.#ownKey(target, messageId),
    });
  });

  readonly remove = Effect.fnUntraced(function* (this: WhatsAppAdapter, target: MessageTarget, messageId: string) {
    yield* this.#session().send(target.platformChannelId, { delete: this.#ownKey(target, messageId) });
    this.#handle.chats.forgetMenu(messageId);
    this.#sentAt.delete(messageId);
  });

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
    const firstMentions = this.#mentions(first);
    let firstId: string | null = null;
    const sentAt = replaceMessageId ? this.#sentAt.get(replaceMessageId) : undefined;
    if (replaceMessageId && !firstMentions.mentions && sentAt !== undefined && Date.now() - sentAt <= EDIT_WINDOW_MS) {
      const edited = yield* Effect.result(
        this.#session().send(target.platformChannelId, { text: first, edit: this.#ownKey(target, replaceMessageId) }),
      );
      if (Result.isSuccess(edited)) firstId = replaceMessageId;
    }
    if (firstId === null) {
      firstId = yield* this.#send(target, { text: first, ...firstMentions });
      if (replaceMessageId) yield* this.remove(target, replaceMessageId).pipe(Effect.catch(() => Effect.void));
    }
    for (const chunk of rest)
      yield* this.#send(target, { text: chunk, ...this.#mentions(chunk) }).pipe(
        Effect.mapError((failure) =>
          replaceMessageId
            ? new MessagingAdapterError({ cause: new WhatsAppAnswerPartlySent(failure.cause) })
            : failure,
        ),
      );
    return firstId;
  });

  readonly upload = Effect.fnUntraced(function* (
    this: WhatsAppAdapter,
    target: MessageTarget,
    files: MessagingAnswerFile[],
  ) {
    yield* this.#checkPlace(target.platformChannelId);
    const skipped: string[] = [];
    let firstId: string | null = null;
    for (const file of files) {
      const sent = yield* Effect.result(
        Effect.gen({ self: this }, function* () {
          const content = yield* this.#fileContent(file);
          if (!content) return false;
          const messageId = yield* this.#send(target, content);
          if (messageId) firstId ??= messageId;
          return true;
        }),
      );
      if (Result.isFailure(sent) || !sent.success) skipped.push(file.name);
    }
    return { skipped, firstId };
  });

  readonly postFileWithText = Effect.fnUntraced(function* (
    this: WhatsAppAdapter,
    target: MessageTarget,
    markdown: string,
    file: MessagingAnswerFile,
  ) {
    const chunks = whatsAppChunks(markdown);
    const caption = chunks.length === 1 ? (chunks[0] ?? "") : "";
    if (!caption || caption.length > WHATSAPP_CAPTION_LIMIT) return null;
    const content = yield* this.#fileContent(file).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!content) return null;
    yield* this.#checkPlace(target.platformChannelId);
    return yield* this.#send(target, { ...content, caption, ...this.#mentions(caption) }).pipe(
      Effect.catch((failure) => {
        const cause = failure.cause;
        const stops =
          cause instanceof WhatsAppRefusedError || (cause instanceof Error && WHATSAPP_POST_STOPS.has(cause.message));
        return stops ? Effect.fail(failure) : Effect.succeed(null);
      }),
    );
  });

  readonly #fileContent = Effect.fnUntraced(function* (this: WhatsAppAdapter, file: MessagingAnswerFile) {
    const size = yield* Effect.tryPromise({
      try: () => stat(file.path).then((info) => info.size),
      catch: (cause) => new MessagingAdapterError({ cause }),
    });
    if (size === 0 || size > WHATSAPP_FILE_BYTES_LIMIT) return null;
    const image = IMAGE_TYPES[extname(file.name).toLowerCase()];
    const dimensions = image ? yield* Effect.promise(() => imageSize(file.path).catch(() => null)) : null;
    const content: AnyMessageContent = image
      ? { image: { url: file.path }, mimetype: image, ...dimensions }
      : {
          document: { url: file.path },
          fileName: file.name.slice(0, 255) || "file",
          mimetype: DOCUMENT_TYPES[extname(file.name).toLowerCase()] ?? file.mimeType,
        };
    return content;
  });

  history(
    platformChannelId: string,
    threadKey: string,
    afterId: string | null,
    beforeId: string,
  ): Effect.Effect<ContextEntry[], MessagingAdapterError> {
    return Effect.try({
      try: () => this.#handle.chats.history(platformChannelId, threadKey, afterId, beforeId),
      catch: (cause) => new MessagingAdapterError({ cause }),
    });
  }

  recent(
    platformChannelId: string,
    threadKey: string | null,
    limit: number,
    filter?: HistoryFilter,
  ): Effect.Effect<RecentMessages, MessagingAdapterError> {
    return Effect.try({
      try: () => {
        const messages = this.#handle.chats.recent(platformChannelId, threadKey, limit, filter);
        return messages.length < limit ? { messages, note: SAVED_HISTORY_NOTE } : { messages };
      },
      catch: (cause) => new MessagingAdapterError({ cause }),
    });
  }

  readonly download = Effect.fnUntraced(function* (
    this: WhatsAppAdapter,
    file: InboundFile,
    destination: string,
    maxBytes: number,
  ) {
    if (file.size > maxBytes) return yield* new MessagingAdapterError({ cause: new Error("file_too_large") });
    const chats = this.#handle.chats;
    const saved = yield* Effect.promise(() => chats.savedFile(file));
    if (saved) {
      const copied = yield* Effect.tryPromise(() => copySaved(saved, destination, maxBytes)).pipe(
        Effect.orElseSucceed(() => false),
      );
      if (copied) return;
    }
    const message = this.#handle.chats.media(file.url);
    if (!message) return yield* new MessagingAdapterError({ cause: new Error("file_unavailable") });
    const session = this.#handle.session;
    yield* Effect.tryPromise({
      try: () => downloadWhatsAppMedia(session, message, destination, maxBytes),
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
      const metadata = yield* this.#handle.session.groupMetadata(platformChannelId).pipe(
        Effect.timeoutOrElse({ duration: PLACE_NAME_TIMEOUT_MS, orElse: () => Effect.succeed(null) }),
        Effect.orElseSucceed(() => null),
      );
      this.#handle.chats.rememberGroup(platformChannelId, metadata?.subject);
      return this.#handle.chats.groupName(platformChannelId) ?? "WhatsApp group";
    });
  }

  places(): Effect.Effect<MessagingPlaces, MessagingAdapterError> {
    return Effect.gen({ self: this }, function* () {
      const identity = whatsAppIdentity(this.#handle);
      if (!identity) return { places: [] };
      const rules = this.#runtime.policy.rules(identity.number);
      const places: MessagingPlace[] = [
        { id: userJid(identity.number), name: sourceText("status.messaging.whatsappOwnChat"), kind: "chat" },
      ];
      for (const [contact, savedName] of rules.contacts)
        places.push({
          id: userJid(contact),
          name: savedName || (this.#handle.chats.name(contact) ?? maskedNumber(contact)),
          kind: "chat",
          ...(rules.readOnly.has(contact) ? { readOnly: true as const } : {}),
        });
      for (const group of rules.groups)
        places.push({
          id: group,
          name: yield* this.placeName(group),
          kind: "channel",
          ...(rules.readOnly.has(group) ? { readOnly: true as const } : {}),
        });
      return { places };
    });
  }

  placeId(placeId: string): string {
    const [user = "", domain] = placeId.split("@");
    if (domain !== undefined && domain !== "s.whatsapp.net") return placeId;
    const number = parseWhatsAppPhoneNumber(user.split(":")[0]);
    const identity = whatsAppIdentity(this.#handle);
    if (!number || !identity) return placeId;
    const rules = this.#runtime.policy.rules(identity.number);
    const saved = whatsAppNumberForms(number).find((form) => form === identity.number || rules.contacts.has(form));
    return saved ? userJid(saved) : placeId;
  }

  directChat(target: MessageTarget): { userId: string; threadKey: string } | null {
    if (isJidGroup(target.platformChannelId)) return null;
    const userId = userPart(target.platformChannelId);
    return userId ? { userId, threadKey: WHATSAPP_DIRECT_THREAD } : null;
  }

  mention(userId: string): string {
    return /^[0-9]+$/u.test(userId) ? `@${userId}` : userId;
  }

  #session() {
    return this.#handle.session;
  }

  #send(target: MessageTarget, content: AnyMessageContent): Effect.Effect<string, MessagingAdapterError> {
    return Effect.gen({ self: this }, function* () {
      yield* this.#allowPlace(target.platformChannelId);
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
      this.#handle.store.putPost(id, { chatJid: target.platformChannelId, threadKey: this.#threadKey(target, id) });
      this.#handle.chats.rememberKey(id, { fromMe: true, participant: null, text: "" });
      return id;
    });
  }

  #threadKey(target: MessageTarget, postId: string): string {
    if (!isJidGroup(target.platformChannelId)) return WHATSAPP_DIRECT_THREAD;
    return target.replyThreadId ? whatsAppThreadKey(target) : postId;
  }

  rememberPost(target: MessageTarget, postId: string, text: string): void {
    this.#handle.chats.rememberMessage({
      id: postId,
      chatJid: target.platformChannelId,
      threadKey: this.#threadKey(target, postId),
      authorId: whatsAppIdentity(this.#handle)?.number ?? "",
      authorName: "OpenBot",
      text,
      sentAt: new Date().toISOString(),
    });
  }

  #checkPlace(chatJid: string): Effect.Effect<void, MessagingAdapterError> {
    return this.#allowPlace(chatJid).pipe(
      Effect.flatMap(() => {
        const identity = whatsAppIdentity(this.#handle);
        const user = isJidGroup(chatJid) ? null : userPart(chatJid);
        const contact = user !== null && user !== identity?.number && chatJid.endsWith("@s.whatsapp.net");
        return contact ? this.#checkAccount(user) : Effect.void;
      }),
    );
  }

  #allowPlace(chatJid: string): Effect.Effect<void, MessagingAdapterError> {
    return Effect.suspend(() => {
      const identity = whatsAppIdentity(this.#handle);
      if (!identity) return Effect.fail(new MessagingAdapterError({ cause: new Error("not_linked") }));
      const rules = this.#runtime.policy.rules(identity.number);
      const user = isJidGroup(chatJid) ? null : userPart(chatJid);
      const allowed = isJidGroup(chatJid)
        ? rules.groups.has(chatJid)
        : user === identity.number || (user !== null && allowsContact(rules, user));
      if (!allowed) return Effect.fail(new MessagingAdapterError({ cause: new Error("place_not_allowed") }));
      return isReadOnlyChat(rules, chatJid)
        ? Effect.fail(new MessagingAdapterError({ cause: new Error("place_read_only") }))
        : Effect.void;
    });
  }

  #checkAccount(number: string): Effect.Effect<void, MessagingAdapterError> {
    const socket = this.#session().socket();
    if (!socket) return Effect.void;
    if (this.#accounts?.socket !== socket) this.#accounts = { socket, numbers: new Set() };
    const known = this.#accounts.numbers;
    if (known.has(number)) return Effect.void;
    return this.#session()
      .registered(whatsAppNumberForms(number))
      .pipe(
        Effect.timeoutOrElse({ duration: ACCOUNT_CHECK_TIMEOUT_MS, orElse: () => Effect.succeed(null) }),
        Effect.orElseSucceed(() => null),
        Effect.flatMap((jids) => {
          if (jids === null) return Effect.void;
          if (jids.length === 0) return Effect.fail(new MessagingAdapterError({ cause: new Error("no_account") }));
          known.add(number);
          return Effect.void;
        }),
      );
  }

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

  #statusText(body: MessageBody): string {
    const actions = new Set(body.buttons?.map((button) => button.action));
    const menu = [
      actions.has("accept") && actions.has("decline") ? sourceText("status.messaging.whatsappApprovalMenu") : "",
      actions.has("stop") ? sourceText("status.messaging.whatsappStopMenu") : "",
    ].filter(Boolean);
    return [whatsAppText(body.text), ...menu].join("\n\n");
  }

  #mentions(text: string): { mentions?: string[] } {
    const prose = text.replace(/```[\s\S]*?(?:```|$)|`[^`\n]+`/gu, "");
    const numbers = [...prose.matchAll(/(?<![\w@])@([0-9]{5,20})\b/gu)].map((match) => userJid(match[1] ?? ""));
    return numbers.length ? { mentions: [...new Set(numbers)] } : {};
  }
}

export interface WhatsAppDriverOptions {
  runtime: WhatsAppRuntime;
}

export function whatsAppDriver(options: WhatsAppDriverOptions): MessagingDriver {
  const { runtime } = options;
  return {
    platform: "whatsapp",
    requiredCredential: "whatsappStoreKey",
    createAdapter(credentials) {
      return new WhatsAppAdapter(runtime, whatsAppCredentials(credentials));
    },
    createTransport(credentials, identity) {
      const values = whatsAppCredentials(credentials);
      const handle = runtime.open(values.storeId, values.storeKey);
      const me = whatsAppIdentity(handle) ?? { number: identity.workspaceId, lid: null };
      const history = runtime.policy.history(identity.workspaceId);
      if (history)
        handle.chats.attach(
          new WhatsAppArchive({
            ...history,
            folder: runtime.filesPath(history.connectionId),
            session: handle.session,
          }),
        );
      return new WhatsAppTransport({ runtime, handle, identity: me, workspaceId: identity.workspaceId });
    },
  };
}

function userPart(jid: string): string | null {
  return jid.split("@")[0]?.split(":")[0] ?? null;
}

async function copySaved(path: string, destination: string, maxBytes: number): Promise<boolean> {
  const { size } = await stat(path);
  if (size > maxBytes) return false;
  await copyFile(path, destination);
  await chmod(destination, 0o600);
  return true;
}
