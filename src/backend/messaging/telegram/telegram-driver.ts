import { stat } from "node:fs/promises";
import {
  TELEGRAM_FILE_BYTES_LIMIT,
  TELEGRAM_TEXT_LIMIT,
  type TelegramCallMethod,
  type TelegramCallParams,
  type TelegramCallResult,
  type TelegramInlineKeyboard,
} from "@openbot/contracts/signal-protocol/telegram-route";
import { sourceText } from "@openbot/i18n/source";
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
  type MessagingDriver,
  type MessagingDriverOptions,
  type MessagingIngress,
  type StatusReaction,
  TelegramCallError,
  type TelegramGateway,
} from "../messaging-types";
import { type TelegramChatState, TelegramChats } from "./telegram-chats";
import { escapeHtml, telegramChunks, telegramHtml, telegramPlainText } from "./telegram-render";
import { TelegramTransport } from "./telegram-transport";
import { TELEGRAM_CALLBACK_PREFIXES, telegramPlacement, telegramThreadKey } from "./telegram-updates";

/** Emoji that the Bot API accepts as a reaction. A bot sets one reaction on a message. */
/** As the Slack client: a rate-limited call waits and tries again, up to this many times. */
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT_LIMIT_S = 60;
/** A shorter wait does not change the connection's state. */
const RATE_LIMIT_NOTICE_S = 5;

const REACTIONS: Record<StatusReaction, string> = {
  received: "👀",
  done: "👌",
  failed: "💔",
  stopped: "🫡",
};

/** The credentials of one Telegram connection. None is secret: the bot token is in Signal. */
interface TelegramCredentials {
  botId: string;
  chatId: string;
  botUsername?: string;
  chatTitle?: string;
}

/** The Bot API side of one chat, through Signal. It never logs message text. */
class TelegramAdapter implements MessagingAdapter {
  readonly platform = "telegram" as const;
  readonly #gateway: TelegramGateway;
  readonly #botId: string;
  readonly #chatId: string;
  readonly #state: TelegramChatState;
  readonly #rateLimited: (retryAt: string) => void;

  constructor(
    gateway: TelegramGateway,
    credentials: TelegramCredentials,
    state: TelegramChatState,
    options: MessagingDriverOptions,
  ) {
    this.#gateway = gateway;
    this.#botId = credentials.botId;
    this.#chatId = credentials.chatId;
    this.#state = state;
    this.#rateLimited = options.rateLimited;
  }

  /** The chat was linked through Signal, which checked it. Nothing here needs the network. */
  identify(): Effect.Effect<ConnectionIdentity, MessagingAdapterError> {
    return Effect.succeed({
      workspaceId: this.#chatId,
      workspaceName: this.#state.title || this.#chatId,
      botUserId: this.#botId,
      appId: this.#botId,
      missingScopes: [],
    });
  }

  readonly post = Effect.fnUntraced(function* (this: TelegramAdapter, target: MessageTarget, body: MessageBody) {
    const result = yield* this.#call("sendMessage", {
      chat_id: this.#chatNumber(target),
      ...this.#content(body),
      ...telegramPlacement(target),
    });
    return yield* this.#posted(target, result.messageId);
  });

  readonly edit = Effect.fnUntraced(function* (
    this: TelegramAdapter,
    target: MessageTarget,
    messageId: string,
    body: MessageBody,
  ) {
    yield* this.#call("editMessageText", {
      chat_id: this.#chatNumber(target),
      message_id: Number(messageId),
      ...this.#content(body),
    }).pipe(Effect.catch((failure) => (notModified(failure) ? Effect.void : Effect.fail(failure))));
  });

  /** Telegram has no private message in a group, so the text is a reply that everyone in the chat sees. */
  postPrivate(target: MessageTarget, _userId: string, text: string): Effect.Effect<void, MessagingAdapterError> {
    return this.post(target, { text }).pipe(Effect.asVoid);
  }

  readonly react = Effect.fnUntraced(function* (
    this: TelegramAdapter,
    target: MessageTarget,
    messageId: string,
    reaction: StatusReaction,
    on: boolean,
  ) {
    yield* this.#call("setMessageReaction", {
      chat_id: this.#chatNumber(target),
      message_id: Number(messageId),
      reaction: on ? [{ type: "emoji", emoji: REACTIONS[reaction] }] : [],
    });
  });

  readonly postAnswer = Effect.fnUntraced(function* (
    this: TelegramAdapter,
    target: MessageTarget,
    markdown: string,
    replaceMessageId: string | null,
  ) {
    const [first = "", ...rest] = telegramChunks(markdown);
    if (replaceMessageId) {
      const updated = yield* Effect.result(
        this.#answerPart(first, (text) => this.#editText(target, replaceMessageId, text)),
      );
      if (Result.isFailure(updated)) {
        yield* this.#call("deleteMessage", {
          chat_id: this.#chatNumber(target),
          message_id: Number(replaceMessageId),
        }).pipe(Effect.catch(() => Effect.void));
        yield* this.#answerPart(first, (text) => this.#postText(target, text));
      }
    } else yield* this.#answerPart(first, (text) => this.#postText(target, text));
    for (const chunk of rest) yield* this.#answerPart(chunk, (text) => this.#postText(target, text));
  });

  readonly upload = Effect.fnUntraced(function* (
    this: TelegramAdapter,
    target: MessageTarget,
    files: MessagingAnswerFile[],
  ) {
    const skipped: string[] = [];
    for (const file of files) {
      const sent = yield* Effect.result(
        Effect.gen({ self: this }, function* () {
          const size = yield* Effect.tryPromise({
            try: () => stat(file.path).then((info) => info.size),
            catch: (cause) => new MessagingAdapterError({ cause }),
          });
          if (size === 0 || size > TELEGRAM_FILE_BYTES_LIMIT) return false;
          const ticket = yield* this.#call("sendDocument", {
            chat_id: this.#chatNumber(target),
            file_name: file.name.slice(0, 255) || "file",
            ...telegramPlacement(target),
          });
          if (!ticket.uploadToken) return yield* new MessagingAdapterError({ cause: new Error("no_upload_token") });
          const messageId = yield* this.#gateway.upload(ticket.uploadToken, file.path);
          this.#state.rememberThread(messageId, telegramThreadKey(target));
          return true;
        }),
      );
      if (Result.isFailure(sent) || !sent.success) skipped.push(file.name);
    }
    return skipped;
  });

  history(
    _platformChannelId: string,
    threadKey: string,
    afterId: string | null,
    beforeId: string,
  ): Effect.Effect<ContextEntry[], MessagingAdapterError> {
    return Effect.sync(() => this.#state.history(threadKey, afterId, beforeId));
  }

  readonly download = Effect.fnUntraced(function* (
    this: TelegramAdapter,
    file: InboundFile,
    destination: string,
    maxBytes: number,
  ) {
    const ticket = yield* this.#call("getFile", { chat_id: Number(this.#chatId), file_id: file.url });
    if (!ticket.fileToken) return yield* new MessagingAdapterError({ cause: new Error("no_file_token") });
    if ((ticket.fileSize ?? 0) > maxBytes)
      return yield* new MessagingAdapterError({ cause: new Error("file_too_large") });
    yield* this.#gateway.download(ticket.fileToken, destination, maxBytes);
  });

  authorName(userId: string): Effect.Effect<string, MessagingAdapterError> {
    return Effect.sync(() => this.#state.name(userId) ?? userId);
  }

  placeName(platformChannelId: string): Effect.Effect<string, MessagingAdapterError> {
    return Effect.sync(() => this.#state.title || platformChannelId);
  }

  /**
   * A marker, not markup: status text is escaped as a whole, which would make a link inert.
   * `#statusHtml` turns the marker back into a mention after the escape. The answer of an agent never
   * goes through it, so an answer cannot mention anyone.
   */
  mention(userId: string): string {
    return /^[0-9]+$/u.test(userId) ? `@${userId}` : userId;
  }

  #statusHtml(text: string): string {
    return telegramHtml(text).replace(/@⁠?([0-9]+)/gu, (_match, userId: string) => {
      const name = this.#state.name(userId) ?? userId;
      return `<a href="tg://user?id=${userId}">${escapeHtml(name)}</a>`;
    });
  }

  /** Status text is written by the host. Buttons become an inline keyboard. */
  #content(body: MessageBody): {
    text: string;
    parse_mode: "HTML";
    link_preview_options: { is_disabled: true };
    reply_markup?: TelegramInlineKeyboard;
  } {
    return {
      text: this.#statusHtml(body.text),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(body.buttons?.length
        ? {
            reply_markup: {
              inline_keyboard: [
                body.buttons.map((button) => ({
                  text: button.label,
                  callback_data: `${TELEGRAM_CALLBACK_PREFIXES[button.action]}${button.token}`,
                })),
              ],
            },
          }
        : {}),
    };
  }

  /** One part of an answer as HTML, or as plain text when Telegram cannot parse the HTML. */
  #answerPart(
    markdown: string,
    send: (text: { text: string; html: boolean }) => Effect.Effect<void, MessagingAdapterError>,
  ): Effect.Effect<void, MessagingAdapterError> {
    const html = telegramHtml(markdown);
    const plain = () => send({ text: telegramPlainText(markdown), html: false });
    // Escapes make HTML longer than its text. Signal refuses a longer call and closes the socket.
    if (new TextEncoder().encode(html).byteLength > TELEGRAM_TEXT_LIMIT) return plain();
    return send({ text: html, html: true }).pipe(
      Effect.catch((failure) => (unparsable(failure) ? plain() : Effect.fail(failure))),
    );
  }

  readonly #postText = Effect.fnUntraced(function* (
    this: TelegramAdapter,
    target: MessageTarget,
    text: { text: string; html: boolean },
  ) {
    const result = yield* this.#call("sendMessage", {
      chat_id: this.#chatNumber(target),
      text: text.text,
      ...(text.html ? { parse_mode: "HTML" as const } : {}),
      link_preview_options: { is_disabled: true },
      ...telegramPlacement(target),
    });
    yield* this.#posted(target, result.messageId);
  });

  #editText(
    target: MessageTarget,
    messageId: string,
    text: { text: string; html: boolean },
  ): Effect.Effect<void, MessagingAdapterError> {
    return this.#call("editMessageText", {
      chat_id: this.#chatNumber(target),
      message_id: Number(messageId),
      text: text.text,
      ...(text.html ? { parse_mode: "HTML" as const } : {}),
      link_preview_options: { is_disabled: true },
    }).pipe(Effect.asVoid);
  }

  /** Remembers the conversation of a post, so a reply to it in a basic group finds the conversation. */
  #posted(target: MessageTarget, messageId: number | undefined): Effect.Effect<string, MessagingAdapterError> {
    if (messageId === undefined) return Effect.fail(new MessagingAdapterError({ cause: new Error("no_message_id") }));
    this.#state.rememberThread(messageId, telegramThreadKey(target));
    return Effect.succeed(String(messageId));
  }

  #chatNumber(target: MessageTarget): number {
    return Number(target.platformChannelId);
  }

  #call<M extends TelegramCallMethod>(
    method: M,
    params: TelegramCallParams[M],
    attempt = 0,
  ): Effect.Effect<TelegramCallResult, MessagingAdapterError> {
    return this.#gateway.call(this.#botId, method, params).pipe(
      Effect.catch((failure) => {
        const error = failure.cause;
        if (!(error instanceof TelegramCallError) || error.errorCode !== 429 || attempt >= RATE_LIMIT_RETRIES)
          return Effect.fail(failure);
        const waitS = Math.min(Math.max(error.retryAfter ?? 1, 1), RATE_LIMIT_WAIT_LIMIT_S);
        if (waitS > RATE_LIMIT_NOTICE_S) this.#rateLimited(new Date(Date.now() + waitS * 1_000).toISOString());
        return Effect.sleep(waitS * 1_000).pipe(Effect.andThen(this.#call(method, params, attempt + 1)));
      }),
    );
  }
}

function notModified(failure: MessagingAdapterError): boolean {
  const error = failure.cause;
  return error instanceof TelegramCallError && error.errorCode === 400 && /not modified/iu.test(error.message);
}

function unparsable(failure: MessagingAdapterError): boolean {
  const error = failure.cause;
  return error instanceof TelegramCallError && error.errorCode === 400 && /parse entities/iu.test(error.message);
}

export interface TelegramDriverOptions {
  /** The Signal relay, which brings each chat's updates and carries its Bot API calls. Without it, no chat connects. */
  ingress?: MessagingIngress;
}

/** Each chat added the one OpenBot bot. Its updates and calls go through the ingress relay. */
export function telegramDriver(options: TelegramDriverOptions = {}): MessagingDriver {
  const chats = new TelegramChats();
  const state = (credentials: Record<string, string>) => {
    const values = telegramCredentials(credentials);
    return { values, state: chats.get(values.botId, values.chatId, values.chatTitle ?? "", values.botUsername ?? "") };
  };
  return {
    platform: "telegram",
    requiredCredential: "botId",
    createAdapter(credentials, driverOptions) {
      if (!options.ingress) throw new Error(sourceText("error.messaging.telegramUnsupported"));
      const chat = state(credentials);
      return new TelegramAdapter(options.ingress.telegram, chat.values, chat.state, driverOptions);
    },
    createTransport(credentials, identity) {
      if (!options.ingress) throw new Error(sourceText("error.messaging.telegramUnsupported"));
      const chat = state(credentials);
      return new TelegramTransport({
        identity,
        ingress: options.ingress,
        state: chat.state,
        chatId: chat.values.chatId,
      });
    },
  };
}

function telegramCredentials(values: Record<string, string>): TelegramCredentials {
  return {
    botId: values.botId ?? "",
    chatId: values.chatId ?? "",
    ...(values.botUsername ? { botUsername: values.botUsername } : {}),
    ...(values.chatTitle ? { chatTitle: values.chatTitle } : {}),
  };
}
