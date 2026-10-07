import { readFile } from "node:fs/promises";
import { type DynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import type { Effect } from "effect";
import { causeHelpers } from "../../effect-boundary";
import type { MessagingAnswerFile } from "../messaging-threads";
import type {
  ConnectionIdentity,
  ContextEntry,
  InboundFile,
  MessageBody,
  MessageTarget,
  MessagingAdapter,
  MessagingDriver,
  MessagingDriverOptions,
  StatusReaction,
} from "../messaging-types";
import { MessagingAdapterError } from "../messaging-types";
import { TelegramApiError, TelegramWebApi } from "./telegram-api";
import { TELEGRAM_ACTION_PREFIX } from "./telegram-events";
import { TelegramPollingTransport } from "./telegram-polling-transport";
import { telegramChunks, telegramHtml } from "./telegram-render";

const { io: adapterIo, sync: adapterSync } = causeHelpers(MessagingAdapterError);

/** Telegram Bot API file upload limit is 50 MB. */
const UPLOAD_BYTES = 50 * 1024 * 1024;
const HISTORY_LIMIT_PER_CONVERSATION = 100;

const REACTIONS: Record<StatusReaction, string> = {
  received: "👀",
  done: "✅",
  failed: "❌",
  stopped: "⏹",
};

/**
 * Shared context history store for Telegram conversations.
 * Telegram has no Bot API to read chat history, so we remember messages the bot observes.
 */
export class TelegramHistoryStore {
  readonly #entries = new Map<string, ContextEntry[]>();

  add(platformChannelId: string, threadKey: string, entry: ContextEntry): void {
    const key = `${platformChannelId}:${threadKey}`;
    const list = this.#entries.get(key) ?? [];
    if (list.some((e) => e.id === entry.id)) return;
    list.push(entry);
    if (list.length > HISTORY_LIMIT_PER_CONVERSATION) {
      list.shift();
    }
    this.#entries.set(key, list);
  }

  get(platformChannelId: string, threadKey: string, afterId: string | null, beforeId: string): ContextEntry[] {
    const key = `${platformChannelId}:${threadKey}`;
    const list = this.#entries.get(key) ?? [];
    let startIdx = 0;
    if (afterId) {
      const idx = list.findIndex((e) => e.id === afterId);
      if (idx !== -1) startIdx = idx + 1;
    }
    let endIdx = list.length;
    const beforeIdx = list.findIndex((e) => e.id === beforeId);
    if (beforeIdx !== -1) endIdx = beforeIdx;

    return list.slice(startIdx, endIdx);
  }
}

/** The Telegram Bot API adapter for OpenBot. */
export class TelegramAdapter implements MessagingAdapter {
  readonly platform = "telegram" as const;
  readonly #api: TelegramWebApi;
  readonly #historyStore: TelegramHistoryStore;
  readonly #names = new Map<string, string>();
  readonly #places = new Map<string, string>();
  #botUserId = "";
  #botUsername = "";

  constructor(
    botToken: string,
    historyStore: TelegramHistoryStore,
    options: MessagingDriverOptions & { origin?: string | undefined; delay?: (ms: number) => Promise<void> },
  ) {
    this.#api = new TelegramWebApi({
      token: botToken,
      origin: options.origin,
      rateLimited: options.rateLimited,
      delay: options.delay,
    });
    this.#historyStore = historyStore;
  }

  get api(): TelegramWebApi {
    return this.#api;
  }

  readonly identify = (): Effect.Effect<ConnectionIdentity, MessagingAdapterError> =>
    adapterIo(async (signal) => {
      const me = await this.#api.getMe(signal);
      this.#botUserId = String(me.id);
      this.#botUsername = me.username ? `@${me.username}` : "";
      const workspaceId = String(me.id);
      const workspaceName = me.username ? `@${me.username}` : me.first_name || workspaceId;
      return {
        workspaceId,
        workspaceName,
        botUserId: this.#botUserId,
        appId: this.#botUsername,
        missingScopes: [],
      };
    });

  readonly post = (target: MessageTarget, body: MessageBody): Effect.Effect<string, MessagingAdapterError> =>
    adapterIo(async () => {
      const replyMarkup = body.buttons?.length
        ? {
            inline_keyboard: [
              body.buttons.map((button) => ({
                text: button.label,
                callback_data: `${TELEGRAM_ACTION_PREFIX}:${button.action}:${button.token}`,
              })),
            ],
          }
        : undefined;

      const baseParams = {
        chat_id: target.platformChannelId,
        ...(target.replyThreadId ? { message_thread_id: Number(target.replyThreadId) } : {}),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      };

      const htmlText = telegramHtml(body.text);
      try {
        const response = await this.#api.call<DynamicRecord>("sendMessage", {
          ...baseParams,
          text: htmlText,
          parse_mode: "HTML",
        });
        if (isNumber(response.message_id)) return String(response.message_id);
      } catch {
        // Fall back to plain text if formatting is rejected
        const response = await this.#api.call<DynamicRecord>("sendMessage", {
          ...baseParams,
          text: body.text,
        });
        if (isNumber(response.message_id)) return String(response.message_id);
      }
      throw new TelegramApiError("sendMessage", "no_message_id");
    });

  readonly edit = (
    target: MessageTarget,
    messageId: string,
    body: MessageBody,
  ): Effect.Effect<void, MessagingAdapterError> =>
    adapterIo(async () => {
      const replyMarkup = body.buttons?.length
        ? {
            inline_keyboard: [
              body.buttons.map((button) => ({
                text: button.label,
                callback_data: `${TELEGRAM_ACTION_PREFIX}:${button.action}:${button.token}`,
              })),
            ],
          }
        : { inline_keyboard: [] };

      const baseParams = {
        chat_id: target.platformChannelId,
        message_id: Number(messageId),
        reply_markup: replyMarkup,
      };

      const htmlText = telegramHtml(body.text);
      try {
        await this.#api.call("editMessageText", {
          ...baseParams,
          text: htmlText,
          parse_mode: "HTML",
        });
      } catch {
        await this.#api
          .call("editMessageText", {
            ...baseParams,
            text: body.text,
          })
          .catch(() => undefined);
      }
    });

  readonly postPrivate = (
    _target: MessageTarget,
    userId: string,
    text: string,
  ): Effect.Effect<void, MessagingAdapterError> =>
    adapterIo(async () => {
      try {
        await this.#api.call("sendMessage", {
          chat_id: userId,
          text,
        });
      } catch {
        // User might not have started a private conversation with the bot
      }
    });

  readonly react = (
    target: MessageTarget,
    messageId: string,
    reaction: StatusReaction,
    on: boolean,
  ): Effect.Effect<void, MessagingAdapterError> =>
    adapterIo(async () => {
      const emoji = REACTIONS[reaction];
      if (!emoji) return;
      try {
        await this.#api.call("setMessageReaction", {
          chat_id: target.platformChannelId,
          message_id: Number(messageId),
          reaction: on ? [{ type: "emoji", emoji }] : [],
        });
      } catch {
        // Reactions might not be available or enabled in this chat
      }
    });

  readonly postAnswer = (
    target: MessageTarget,
    markdown: string,
    replaceMessageId: string | null,
  ): Effect.Effect<void, MessagingAdapterError> =>
    adapterIo(async () => {
      const [first = "", ...rest] = telegramChunks(markdown);
      if (replaceMessageId) {
        try {
          await this.#api.call("editMessageText", {
            chat_id: target.platformChannelId,
            message_id: Number(replaceMessageId),
            text: telegramHtml(first),
            parse_mode: "HTML",
          });
        } catch {
          try {
            await this.#api.call("editMessageText", {
              chat_id: target.platformChannelId,
              message_id: Number(replaceMessageId),
              text: first,
            });
          } catch {
            await this.#api
              .call("deleteMessage", { chat_id: target.platformChannelId, message_id: Number(replaceMessageId) })
              .catch(() => undefined);
            await this.#postRaw(target, { text: first });
          }
        }
      } else {
        await this.#postRaw(target, { text: first });
      }

      for (const chunk of rest) {
        await this.#postRaw(target, { text: chunk });
      }
    });

  async #postRaw(target: MessageTarget, body: MessageBody): Promise<string> {
    const baseParams = {
      chat_id: target.platformChannelId,
      ...(target.replyThreadId ? { message_thread_id: Number(target.replyThreadId) } : {}),
    };
    const htmlText = telegramHtml(body.text);
    try {
      const response = await this.#api.call<DynamicRecord>("sendMessage", {
        ...baseParams,
        text: htmlText,
        parse_mode: "HTML",
      });
      if (isNumber(response.message_id)) return String(response.message_id);
    } catch {
      const response = await this.#api.call<DynamicRecord>("sendMessage", {
        ...baseParams,
        text: body.text,
      });
      if (isNumber(response.message_id)) return String(response.message_id);
    }
    throw new TelegramApiError("sendMessage", "no_message_id");
  }

  readonly upload = (
    target: MessageTarget,
    files: MessagingAnswerFile[],
  ): Effect.Effect<string[], MessagingAdapterError> =>
    adapterIo(async () => {
      const skipped: string[] = [];
      for (const file of files) {
        try {
          const bytes = await readFile(file.path);
          if (bytes.byteLength > UPLOAD_BYTES || bytes.byteLength === 0) {
            skipped.push(file.name);
            continue;
          }
          const params: Record<string, string | number> = {
            chat_id: target.platformChannelId,
            caption: file.name,
          };
          if (target.replyThreadId) {
            params.message_thread_id = Number(target.replyThreadId);
          }
          await this.#api.upload("sendDocument", params, {
            field: "document",
            name: file.name,
            type: file.mimeType,
            bytes,
          });
        } catch {
          skipped.push(file.name);
        }
      }
      return skipped;
    });

  readonly history = (
    platformChannelId: string,
    threadKey: string,
    afterId: string | null,
    beforeId: string,
  ): Effect.Effect<ContextEntry[], MessagingAdapterError> =>
    adapterSync(() => this.#historyStore.get(platformChannelId, threadKey, afterId, beforeId));

  readonly download = (
    file: InboundFile,
    destination: string,
    maxBytes: number,
  ): Effect.Effect<void, MessagingAdapterError> =>
    adapterIo(async () => {
      const fileInfo = await this.#api.getFile(file.url);
      if (!fileInfo.file_path) {
        throw new TelegramApiError("getFile", "no_file_path");
      }
      await this.#api.download(fileInfo.file_path, destination, maxBytes);
    });

  readonly authorName = (userId: string): Effect.Effect<string, MessagingAdapterError> =>
    adapterIo(async () => {
      const cached = this.#names.get(userId);
      if (cached) return cached;
      try {
        const chat = await this.#api.getChat(userId);
        const fullName = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
        const name = (chat.username ? `@${chat.username}` : null) ?? (fullName || chat.title || userId);
        this.#names.set(userId, name);
        return name;
      } catch {
        return userId;
      }
    });

  readonly placeName = (platformChannelId: string): Effect.Effect<string, MessagingAdapterError> =>
    adapterIo(async () => {
      const cached = this.#places.get(platformChannelId);
      if (cached) return cached;
      try {
        const chat = await this.#api.getChat(platformChannelId);
        const name = chat.title || (chat.username ? `@${chat.username}` : platformChannelId);
        this.#places.set(platformChannelId, name);
        return name;
      } catch {
        return platformChannelId;
      }
    });

  mention(userId: string): string {
    return /^[A-Z0-9_]+$/i.test(userId) ? `@${userId}` : userId;
  }
}

export interface TelegramDriverOptions {
  /** Only tests change this. */
  origin?: string;
  pollTimeoutSec?: number;
  delay?: (milliseconds: number) => Promise<void>;
}

/** Creates the Telegram messaging driver. */
export function telegramDriver(options: TelegramDriverOptions = {}): MessagingDriver {
  const historyStore = new TelegramHistoryStore();
  const adapters = new Map<string, TelegramAdapter>();

  return {
    platform: "telegram",
    requiredCredential: "botToken",
    createAdapter(credentials, driverOptions) {
      const token = credentials.botToken ?? "";
      let adapter = adapters.get(token);
      if (!adapter) {
        adapter = new TelegramAdapter(token, historyStore, {
          ...driverOptions,
          origin: options.origin,
          delay: options.delay,
        });
        adapters.set(token, adapter);
      }
      return adapter;
    },
    createTransport(credentials, identity) {
      const token = credentials.botToken ?? "";
      const api = new TelegramWebApi({
        token,
        origin: options.origin,
        delay: options.delay,
      });
      return new TelegramPollingTransport({
        identity,
        api,
        pollTimeoutSec: options.pollTimeoutSec,
        delay: options.delay,
        onInboundMessage: (msg) => {
          if (msg) {
            historyStore.add(msg.platformChannelId, msg.threadKey, {
              id: msg.platformMessageId,
              authorName: msg.authorId,
              text: msg.text,
              sentAt: new Date().toISOString(),
            });
          }
        },
      });
    },
  };
}
