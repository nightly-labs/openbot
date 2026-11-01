// One MTProto client of the user's Telegram account, through GramJS. The connector service loads this
// module only when it needs Telegram, so GramJS is not loaded at startup on a computer that never
// connects. Every call is an Effect; GramJS asks for sign-in values through callbacks, which stay
// native Promises.

import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { release, type } from "node:os";
import { join } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { Api, Logger, TelegramClient, utils } from "telegram";
import { LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";
import type { Dialog } from "telegram/tl/custom/dialog.js";
import type { TelegramAccountRecordAccount } from "./telegram-account-connector-store";
import {
  TELEGRAM_SESSION_ENDED,
  type TelegramAccountOperationError,
  telegramAccountCall,
  telegramErrorMessage,
  telegramToolFailure,
} from "./telegram-account-effects";
import {
  accountFromUser,
  attachmentFileName,
  chatTitle,
  chatType,
  chatUsername,
  clip,
  entityName,
  isoDate,
  messageAttachment,
  messageRecord,
  type TelegramAttachment,
  type TelegramChatSummary,
  type TelegramChatType,
  type TelegramMessageRecord,
} from "./telegram-account-format";

const gramLogger = createOpenBotLogger("telegram-account-connector");

/**
 * GramJS logs with `console.log`. This keeps its lines in the OpenBot log, which redacts the
 * registered secrets, and at warn level: its info lines name every connection and data center.
 */
class OpenBotGramLogger extends Logger {
  constructor() {
    super(LogLevel.WARN);
  }

  override log(level: LogLevel, message: string): void {
    if (level === LogLevel.ERROR) gramLogger.error(`GramJS: ${message}`);
    else gramLogger.warn(`GramJS: ${message}`);
  }
}

export interface TelegramAccountCredentials {
  apiId: number;
  apiHash: string;
}

/** The callbacks of a QR sign-in, as GramJS calls them. */
export interface TelegramQrSignInParams {
  qrCode: (code: { token: Buffer; expires: number }) => Promise<void>;
  password: (hint?: string) => Promise<string>;
  onError: (error: Error) => Promise<boolean>;
}

/** The callbacks of a sign-in with the phone number, as GramJS calls them. */
export interface TelegramPhoneSignInParams {
  phoneNumber: () => Promise<string>;
  phoneCode: (isCodeViaApp?: boolean) => Promise<string>;
  password: (hint?: string) => Promise<string>;
  firstAndLastNames: () => Promise<[string, string?]>;
  onError: (error: Error) => Promise<boolean>;
}

export interface TelegramChatListItem extends TelegramChatSummary {
  unread_count: number;
  unread_mentions: number;
  pinned: boolean;
  archived: boolean;
  last_message: { date: string; from: string; text: string } | null;
}

interface KnownChat extends TelegramChatSummary {
  input: Api.TypeInputPeer;
}

const DIALOG_SCAN_LIMIT = 500;
const DIALOG_CACHE_MS = 60_000;

export interface TelegramAccountClientOptions {
  credentials: TelegramAccountCredentials;
  /** The stored session string, or "" for a sign-in. */
  session: string;
  appVersion: string;
}

/** Whether Telegram refused a call because the session itself is no longer valid. */
function sessionEnded(failure: TelegramAccountOperationError): boolean {
  return TELEGRAM_SESSION_ENDED.has(telegramErrorMessage(failure.cause));
}

function summary(chat: KnownChat): TelegramChatSummary {
  return { id: chat.id, title: chat.title, type: chat.type, username: chat.username };
}

/**
 * The GramJS client of one session. The connector service owns it: it decides when to connect, when
 * a session has ended, and whether sending is allowed. This class only talks to Telegram.
 */
export class TelegramAccountClient {
  readonly #client: TelegramClient;
  readonly #credentials: TelegramAccountCredentials;
  readonly #chats = new Map<string, KnownChat>();
  #chatsLoadedAt = 0;

  constructor({ credentials, session, appVersion }: TelegramAccountClientOptions) {
    this.#credentials = credentials;
    this.#client = new TelegramClient(new StringSession(session), credentials.apiId, credentials.apiHash, {
      connectionRetries: 5,
      autoReconnect: true,
      floodSleepThreshold: 60,
      baseLogger: new OpenBotGramLogger(),
      deviceModel: "OpenBot",
      systemVersion: `${type()} ${release()}`,
      appVersion: `OpenBot ${appVersion}`,
    });
  }

  connect(): Effect.Effect<void, TelegramAccountOperationError> {
    return telegramAccountCall(() => this.#client.connect()).pipe(Effect.asVoid);
  }

  /**
   * Asks Telegram for the update state, which only a valid session can read. `checkAuthorization`
   * would report any failure, such as a timeout or a long flood wait, as signed out; this keeps
   * Telegram's own answer, so only its session errors mean that the session is gone.
   */
  checkSession(): Effect.Effect<void, TelegramAccountOperationError> {
    return telegramAccountCall(() => this.#client.invoke(new Api.updates.GetState())).pipe(Effect.asVoid);
  }

  signInWithQrCode(params: TelegramQrSignInParams): Effect.Effect<void, TelegramAccountOperationError> {
    return telegramAccountCall(() => this.#client.signInUserWithQrCode(this.#credentials, params)).pipe(Effect.asVoid);
  }

  signInWithPhone(params: TelegramPhoneSignInParams): Effect.Effect<void, TelegramAccountOperationError> {
    return telegramAccountCall(() => this.#client.signInUser(this.#credentials, params)).pipe(Effect.asVoid);
  }

  account(): Effect.Effect<TelegramAccountRecordAccount, TelegramAccountOperationError> {
    return telegramAccountCall(() => this.#client.getMe()).pipe(Effect.map(accountFromUser));
  }

  exportSession(): string {
    const session = this.#client.session;
    return session instanceof StringSession ? session.save() : "";
  }

  /** Ends the session at Telegram, so it disappears from Settings > Devices. */
  logOut(): Effect.Effect<void, TelegramAccountOperationError> {
    return telegramAccountCall(() => this.#client.invoke(new Api.auth.LogOut())).pipe(Effect.asVoid);
  }

  /** Closes the connection. A failure is not reported: the client is not used again. */
  destroy(): Effect.Effect<void> {
    return telegramAccountCall(() => this.#client.destroy()).pipe(Effect.ignore);
  }

  #remember(dialog: Dialog): KnownChat | null {
    if (!dialog.id || !dialog.entity) return null;
    const chat: KnownChat = {
      id: dialog.id.toString(),
      title: chatTitle(dialog.entity),
      type: chatType(dialog.entity),
      username: chatUsername(dialog.entity),
      input: dialog.inputEntity,
    };
    this.#chats.set(chat.id, chat);
    return chat;
  }

  readonly #loadChats = Effect.fn("TelegramAccountClient.loadChats")(function* (
    this: TelegramAccountClient,
    force = false,
  ): Effect.fn.Return<void, TelegramAccountOperationError> {
    if (!force && Date.now() - this.#chatsLoadedAt < DIALOG_CACHE_MS && this.#chats.size > 0) return;
    const dialogs = yield* telegramAccountCall(() =>
      this.#client.getDialogs({ limit: DIALOG_SCAN_LIMIT, ignoreMigrated: true }),
    );
    for (const dialog of dialogs) this.#remember(dialog);
    this.#chatsLoadedAt = Date.now();
  });

  readonly #fromEntity = Effect.fn("TelegramAccountClient.fromEntity")(function* (
    this: TelegramAccountClient,
    reference: string,
  ): Effect.fn.Return<KnownChat, TelegramAccountOperationError> {
    const entity = yield* telegramAccountCall(() => this.#client.getEntity(reference));
    const id = utils.getPeerId(entity);
    const known = this.#chats.get(id);
    if (known) return known;
    const chat: KnownChat = {
      id,
      title: chatTitle(entity),
      type: chatType(entity),
      username: chatUsername(entity),
      input: yield* telegramAccountCall(() => this.#client.getInputEntity(entity)),
    };
    this.#chats.set(id, chat);
    return chat;
  });

  /** `#fromEntity`, with a failure reported to the agent as `message`. */
  #lookUp(reference: string, message: string): Effect.Effect<KnownChat, TelegramAccountOperationError> {
    return this.#fromEntity(reference).pipe(
      Effect.catch((failure) => Effect.fail(sessionEnded(failure) ? failure : telegramToolFailure(message))),
    );
  }

  /**
   * Finds a chat from what the agent passes: an id from telegram_list_chats, "me" for Saved Messages,
   * an @username or t.me link, a phone number of a contact, or the chat's title. Part of a title is
   * accepted only for reading (`exact: false`); sending and marking as read need the whole title, so
   * an action cannot land in a chat whose name merely contains the words.
   */
  readonly resolveChat = Effect.fn("TelegramAccountClient.resolveChat")(function* (
    this: TelegramAccountClient,
    reference: string,
    { exact }: { exact: boolean },
  ): Effect.fn.Return<KnownChat, TelegramAccountOperationError> {
    let ref = reference.trim();
    if (!ref)
      return yield* telegramToolFailure("Name the chat: its id from telegram_list_chats, an @username, or its title.");
    const link = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{4,32})\/?$/iu.exec(ref);
    if (link?.[1]) ref = `@${link[1]}`;

    if (/^(me|self|saved|saved messages)$/iu.test(ref)) return yield* this.#fromEntity("me");

    if (/^-?\d+$/u.test(ref)) {
      yield* this.#loadChats();
      let known = this.#chats.get(ref);
      if (!known) {
        yield* this.#loadChats(true);
        known = this.#chats.get(ref);
      }
      if (known) return known;
      return yield* telegramToolFailure(
        `No chat with id ${ref} among this account's chats. Use an id from telegram_list_chats.`,
      );
    }

    const phone = ref.replace(/[\s-]/gu, "");
    if (/^\+\d{6,16}$/u.test(phone)) {
      return yield* this.#lookUp(
        phone,
        `${ref} is not in this account's contacts, so Telegram will not look it up by number.`,
      );
    }

    if (ref.startsWith("@")) {
      return yield* this.#lookUp(ref, `Telegram has no user, group or channel named ${ref}.`);
    }

    yield* this.#loadChats();
    const wanted = ref.toLowerCase();
    const all = [...this.#chats.values()];
    const exactMatches = all.filter(
      (chat) => chat.title.toLowerCase() === wanted || chat.username?.toLowerCase() === wanted,
    );
    if (exactMatches.length === 1 && exactMatches[0]) return exactMatches[0];
    const candidates =
      exactMatches.length > 1
        ? exactMatches
        : exact
          ? []
          : all.filter((chat) => chat.title.toLowerCase().includes(wanted));
    if (candidates.length === 1 && candidates[0]) return candidates[0];
    if (candidates.length > 1) {
      const choices = candidates
        .slice(0, 8)
        .map((chat) => `${chat.title} (id ${chat.id}, ${chat.type})`)
        .join("; ");
      return yield* telegramToolFailure(
        `Several chats match "${reference}": ${choices}. Pass the id of the one you mean.`,
      );
    }
    // A bare word may be a username, but only for reading: to send, a username needs its "@", so a
    // word that is part of a contact's name cannot reach a stranger who owns that username.
    if (!exact && /^[A-Za-z][A-Za-z0-9_]{3,31}$/u.test(ref)) {
      // Not a username either: reported as an unknown title below.
      const byUsername = yield* this.#fromEntity(`@${ref}`).pipe(
        Effect.catch((failure) => (sessionEnded(failure) ? Effect.fail(failure) : Effect.succeed(null))),
      );
      if (byUsername) return byUsername;
    }
    if (exact) {
      const near = all.filter((chat) => chat.title.toLowerCase().includes(wanted)).slice(0, 8);
      if (near.length > 0) {
        const choices = near.map((chat) => `${chat.title} (id ${chat.id})`).join("; ");
        return yield* telegramToolFailure(
          `To send or mark as read, name the chat exactly or by id. Chats whose title contains "${reference}": ${choices}.`,
        );
      }
    }
    return yield* telegramToolFailure(
      `No chat matches "${reference}". Call telegram_list_chats to see the chats and their ids.`,
    );
  });

  readonly listChats = Effect.fn("TelegramAccountClient.listChats")(function* (
    this: TelegramAccountClient,
    options: {
      limit: number;
      unreadOnly: boolean;
      archived: boolean;
      type: TelegramChatType | "all";
      query: string | null;
    },
  ): Effect.fn.Return<TelegramChatListItem[], TelegramAccountOperationError> {
    const filtering = options.unreadOnly || options.type !== "all" || Boolean(options.query);
    const dialogs = yield* telegramAccountCall(() =>
      this.#client.getDialogs({
        limit: filtering ? DIALOG_SCAN_LIMIT : options.limit,
        folder: options.archived ? 1 : 0,
        ignoreMigrated: true,
      }),
    );
    const query = options.query?.toLowerCase() ?? null;
    const items: TelegramChatListItem[] = [];
    for (const dialog of dialogs) {
      const chat = this.#remember(dialog);
      if (!chat) continue;
      if (options.unreadOnly && dialog.unreadCount === 0 && !dialog.dialog.unreadMark) continue;
      if (options.type !== "all" && chat.type !== options.type) continue;
      if (query && !chat.title.toLowerCase().includes(query) && !chat.username?.toLowerCase().includes(query)) continue;
      const last = dialog.message;
      items.push({
        ...summary(chat),
        unread_count: dialog.unreadCount,
        unread_mentions: dialog.dialog.unreadMentionsCount ?? 0,
        pinned: dialog.pinned,
        archived: dialog.archived,
        last_message: last
          ? {
              date: isoDate(last.date),
              from: last.out ? "you" : entityName(last.sender),
              text: clip(last.message || messageRecord(last).media || "", 160),
            }
          : null,
      });
      if (items.length >= options.limit) break;
    }
    return items;
  });

  /**
   * Messages from one chat, returned oldest to newest. With only `afterId` it pages forward (the next
   * messages after that id); otherwise it counts back from the newest, or from `beforeId`.
   */
  readonly readMessages = Effect.fn("TelegramAccountClient.readMessages")(function* (
    this: TelegramAccountClient,
    options: { chat: string; limit: number; beforeId: number | null; afterId: number | null; since: Date | null },
  ): Effect.fn.Return<
    { chat: TelegramChatSummary; messages: TelegramMessageRecord[]; has_more: boolean },
    TelegramAccountOperationError
  > {
    const chat = yield* this.resolveChat(options.chat, { exact: false });
    const forward = options.afterId !== null && options.beforeId === null;
    const since = options.since?.getTime() ?? null;
    const { messages, hasMore } = yield* telegramAccountCall(async () => {
      const read: TelegramMessageRecord[] = [];
      let more = false;
      const iterator = this.#client.iterMessages(chat.input, {
        limit: options.limit + 1,
        reverse: forward,
        ...(options.beforeId ? { offsetId: options.beforeId } : {}),
        ...(options.afterId ? { minId: options.afterId } : {}),
      });
      for await (const message of iterator) {
        const older = since !== null && message.date * 1000 < since;
        if (!forward && older) break;
        if (forward && older) continue;
        if (read.length >= options.limit) {
          more = true;
          break;
        }
        read.push(messageRecord(message));
      }
      return { messages: forward ? read : read.reverse(), hasMore: more };
    });
    return { chat: summary(chat), messages, has_more: hasMore };
  });

  readonly searchMessages = Effect.fn("TelegramAccountClient.searchMessages")(function* (
    this: TelegramAccountClient,
    options: { query: string; chat: string | null; limit: number },
  ): Effect.fn.Return<
    {
      scope: TelegramChatSummary | "all chats";
      results: Array<TelegramMessageRecord & { chat: { id: string; title: string } }>;
    },
    TelegramAccountOperationError
  > {
    const chat = options.chat ? yield* this.resolveChat(options.chat, { exact: false }) : null;
    const found = yield* telegramAccountCall(() =>
      this.#client.getMessages(chat?.input, { search: options.query, limit: options.limit }),
    );
    const results = found.map((message) => {
      const entity = message.chat;
      return {
        ...messageRecord(message),
        chat: chat
          ? { id: chat.id, title: chat.title }
          : { id: message.chatId?.toString() ?? "", title: entity ? chatTitle(entity) : "Unknown" },
      };
    });
    return { scope: chat ? summary(chat) : "all chats", results };
  });

  readonly sendMessage = Effect.fn("TelegramAccountClient.sendMessage")(function* (
    this: TelegramAccountClient,
    options: { chat: string; text: string; replyToId: number | null },
  ): Effect.fn.Return<{ chat: TelegramChatSummary; message: TelegramMessageRecord }, TelegramAccountOperationError> {
    const chat = yield* this.resolveChat(options.chat, { exact: true });
    const sent = yield* telegramAccountCall(() =>
      this.#client.sendMessage(chat.input, {
        message: options.text,
        parseMode: false,
        ...(options.replyToId ? { replyTo: options.replyToId } : {}),
      }),
    );
    return { chat: summary(chat), message: messageRecord(sent) };
  });

  /**
   * Saves the file of one message in `directory`/<chat id>/, as `<message id>-<file name>`, and answers
   * its path. A file that is already there with the same size is not downloaded again. The download
   * goes to a temporary name first, so a stopped download leaves no partial file under the final name.
   */
  readonly downloadMedia = Effect.fn("TelegramAccountClient.downloadMedia")(function* (
    this: TelegramAccountClient,
    options: { chat: string; messageId: number; directory: string; maxBytes: number },
  ): Effect.fn.Return<
    { chat: TelegramChatSummary; message: TelegramMessageRecord; attachment: TelegramAttachment; path: string },
    TelegramAccountOperationError
  > {
    const chat = yield* this.resolveChat(options.chat, { exact: false });
    const found = yield* telegramAccountCall(() => this.#client.getMessages(chat.input, { ids: [options.messageId] }));
    const message = found.find((item) => item instanceof Api.Message && item.id === options.messageId);
    if (!message) return yield* telegramToolFailure(`No message with id ${options.messageId} in ${chat.title}.`);
    const attachment = messageAttachment(message);
    if (!attachment) {
      const label = messageRecord(message).media;
      return yield* telegramToolFailure(
        label
          ? `Message ${options.messageId} has no file to download: it is a ${label}.`
          : `Message ${options.messageId} has no file.`,
      );
    }
    const megabytes = (bytes: number) => Math.ceil(bytes / (1024 * 1024));
    if (attachment.size_bytes !== null && attachment.size_bytes > options.maxBytes)
      return yield* telegramToolFailure(
        `The file is ${megabytes(attachment.size_bytes)} MB, more than max_mb (${megabytes(options.maxBytes)}). Pass a larger max_mb to download it.`,
      );
    const folder = join(options.directory, chat.id);
    const path = join(folder, attachmentFileName(message, attachment));
    const existing = yield* telegramAccountCall(() => stat(path)).pipe(Effect.orElseSucceed(() => null));
    if (existing?.isFile() && (attachment.size_bytes === null || existing.size === attachment.size_bytes))
      return { chat: summary(chat), message: messageRecord(message), attachment, path };
    yield* telegramAccountCall(() => mkdir(folder, { recursive: true }));
    const partial = `${path}.${randomBytes(4).toString("hex")}.part`;
    yield* telegramAccountCall(async () => {
      try {
        const written = await this.#client.downloadMedia(message, { outputFile: partial });
        if (written === undefined) throw new Error("Telegram sent no file for this message.");
        await rename(partial, path);
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
    });
    return { chat: summary(chat), message: messageRecord(message), attachment, path };
  });

  /**
   * Sends a file from this computer. `kind` chooses how Telegram shows it: `auto` lets Telegram
   * choose (a photo for an image, else a file), `photo` compresses an image, `document` keeps the file
   * as it is, `voice` sends audio as a voice message (OGG/Opus plays best), and `video_note` sends a
   * square video as a round video message. The caller checks the path.
   */
  readonly sendFile = Effect.fn("TelegramAccountClient.sendFile")(function* (
    this: TelegramAccountClient,
    options: {
      chat: string;
      path: string;
      caption: string | null;
      kind: "auto" | "photo" | "document" | "voice" | "audio" | "video" | "video_note";
      replyToId: number | null;
    },
  ): Effect.fn.Return<{ chat: TelegramChatSummary; message: TelegramMessageRecord }, TelegramAccountOperationError> {
    const chat = yield* this.resolveChat(options.chat, { exact: true });
    const sent = yield* telegramAccountCall(() =>
      this.#client.sendFile(chat.input, {
        file: options.path,
        ...(options.caption ? { caption: options.caption } : {}),
        parseMode: false,
        forceDocument: options.kind === "document",
        voiceNote: options.kind === "voice",
        videoNote: options.kind === "video_note",
        supportsStreaming: options.kind === "video",
        workers: 4,
        ...(options.replyToId ? { replyTo: options.replyToId } : {}),
      }),
    );
    return { chat: summary(chat), message: messageRecord(sent) };
  });

  readonly markRead = Effect.fn("TelegramAccountClient.markRead")(function* (
    this: TelegramAccountClient,
    reference: string,
  ): Effect.fn.Return<{ chat: TelegramChatSummary }, TelegramAccountOperationError> {
    const chat = yield* this.resolveChat(reference, { exact: true });
    yield* telegramAccountCall(() => this.#client.markAsRead(chat.input));
    return { chat: summary(chat) };
  });
}
