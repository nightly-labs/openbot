import { open, rm } from "node:fs/promises";
import { type DynamicRecord, isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { registerSecretValue } from "@openbot/logging";
import { MessagingConnectionError } from "../messaging-types";

const TELEGRAM_API_ORIGIN = "https://api.telegram.org";

/** Telegram error codes that mean the bot token is invalid or revoked. */
const AUTH_ERROR_CODES = new Set([401, 404]);
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_NOTICE_MS = 5_000;
const REDIRECT_LIMIT = 3;

export interface TelegramResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: {
    retry_after?: number;
    migrate_to_chat_id?: number;
  };
}

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: string,
    readonly description?: string,
  ) {
    super(`Telegram ${method} failed: ${code}${description ? ` (${description})` : ""}`);
  }
}

export interface TelegramWebApiOptions {
  token: string;
  /** Only tests change this. The token is never sent to another origin. */
  origin?: string | undefined;
  rateLimited?(retryAt: string): void;
  /** Waits between rate-limit retries. Only tests replace it. */
  delay?(milliseconds: number): Promise<void>;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_forum?: boolean;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

/**
 * The Telegram Bot API over `fetch`, with one token. Nothing here logs a request, response, or the
 * token. In case of error, the token in the URL is never exposed.
 */
export class TelegramWebApi {
  readonly #token: string;
  readonly #origin: string;
  readonly #rateLimited: (retryAt: string) => void;
  readonly #delay: (milliseconds: number) => Promise<void>;

  constructor(options: TelegramWebApiOptions) {
    this.#token = options.token;
    registerSecretValue(this.#token);
    this.#origin = (options.origin ?? TELEGRAM_API_ORIGIN).replace(/\/+$/, "");
    this.#rateLimited = options.rateLimited ?? (() => undefined);
    this.#delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  get token(): string {
    return this.#token;
  }

  get origin(): string {
    return this.#origin;
  }

  async call<T = DynamicRecord>(method: string, params: DynamicRecord = {}, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${this.#origin}/bot${this.#token}/${method}`, {
          method: "POST",
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          body: JSON.stringify(params),
          redirect: "error",
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new TelegramApiError(method, "network_error", error instanceof Error ? error.message : undefined);
      }

      if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
        const payload = await response.json().catch(() => null);
        const retryAfterSec =
          isDynamicRecord(payload) && isDynamicRecord(payload.parameters) && isNumber(payload.parameters.retry_after)
            ? payload.parameters.retry_after
            : Number(response.headers.get("retry-after") ?? "1");
        const waitMs = Math.max(1, retryAfterSec) * 1000;
        if (waitMs > RATE_LIMIT_NOTICE_MS) this.#rateLimited(new Date(Date.now() + waitMs).toISOString());
        await this.#delay(waitMs);
        continue;
      }

      const payload = await response.json().catch(() => null);
      if (!isDynamicRecord(payload)) throw new TelegramApiError(method, `http_${response.status}`);
      if (payload.ok !== true) {
        const code = isNumber(payload.error_code) ? `error_${payload.error_code}` : `http_${response.status}`;
        if (
          AUTH_ERROR_CODES.has(response.status) ||
          (isNumber(payload.error_code) && AUTH_ERROR_CODES.has(payload.error_code)) ||
          (typeof payload.description === "string" && payload.description.toLowerCase().includes("unauthorized"))
        ) {
          throw new MessagingConnectionError("invalid_token");
        }
        throw new TelegramApiError(
          method,
          code,
          typeof payload.description === "string" ? payload.description : undefined,
        );
      }
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: telegram api returns typed payload.result
      return payload.result as T;
    }
  }

  async upload<T = DynamicRecord>(
    method: string,
    params: Record<string, string | number>,
    file: { field: string; name: string; type: string; bytes: Uint8Array },
    signal?: AbortSignal,
  ): Promise<T> {
    const body = new FormData();
    for (const [key, value] of Object.entries(params)) {
      body.set(key, String(value));
    }
    body.set(file.field, new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);

    let response: Response;
    try {
      response = await fetch(`${this.#origin}/bot${this.#token}/${method}`, {
        method: "POST",
        body,
        redirect: "error",
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new TelegramApiError(method, "network_error", error instanceof Error ? error.message : undefined);
    }

    const payload = await response.json().catch(() => null);
    if (!isDynamicRecord(payload)) throw new TelegramApiError(method, `http_${response.status}`);
    if (payload.ok !== true) {
      const code = isNumber(payload.error_code) ? `error_${payload.error_code}` : `http_${response.status}`;
      if (
        AUTH_ERROR_CODES.has(response.status) ||
        (isNumber(payload.error_code) && AUTH_ERROR_CODES.has(payload.error_code)) ||
        (typeof payload.description === "string" && payload.description.toLowerCase().includes("unauthorized"))
      ) {
        throw new MessagingConnectionError("invalid_token");
      }
      throw new TelegramApiError(
        method,
        code,
        typeof payload.description === "string" ? payload.description : undefined,
      );
    }
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: telegram api returns typed payload.result
    return payload.result as T;
  }

  async getMe(signal?: AbortSignal): Promise<TelegramUser> {
    return this.call<TelegramUser>("getMe", {}, signal);
  }

  async getChat(chatId: string | number, signal?: AbortSignal): Promise<TelegramChat> {
    return this.call<TelegramChat>("getChat", { chat_id: chatId }, signal);
  }

  async getFile(fileId: string, signal?: AbortSignal): Promise<TelegramFile> {
    return this.call<TelegramFile>("getFile", { file_id: fileId }, signal);
  }

  #trusted(value: string): boolean {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    if (this.#origin !== TELEGRAM_API_ORIGIN) return url.origin === new URL(this.#origin).origin;
    return url.protocol === "https:" && (url.hostname === "api.telegram.org" || url.hostname.endsWith(".telegram.org"));
  }

  async download(filePathOrUrl: string, destination: string, maxBytes: number, signal?: AbortSignal): Promise<void> {
    let currentUrl =
      filePathOrUrl.startsWith("http://") || filePathOrUrl.startsWith("https://")
        ? filePathOrUrl
        : `${this.#origin}/file/bot${this.#token}/${filePathOrUrl}`;
    if (!this.#trusted(currentUrl)) throw new TelegramApiError("download", "untrusted_file_url");
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(destination, "w", 0o600);
      for (let redirect = 0; redirect < REDIRECT_LIMIT; redirect += 1) {
        const response = await fetch(currentUrl, {
          redirect: "manual",
          signal,
        });
        if (response.status >= 300 && response.status < 400) {
          const next = response.headers.get("location");
          if (!next) throw new TelegramApiError("download", "redirect_without_location");
          currentUrl = new URL(next, currentUrl).href;
          await response.body?.cancel();
          if (!this.#trusted(currentUrl)) throw new TelegramApiError("download", "untrusted_file_url");
          continue;
        }
        if (!response.ok) throw new TelegramApiError("download", `http_${response.status}`);
        const stream = response.body;
        if (!stream) throw new TelegramApiError("download", "no_body");
        let bytesWritten = 0;
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytesWritten += value.byteLength;
            if (bytesWritten > maxBytes) {
              await reader.cancel();
              throw new TelegramApiError("download", "file_too_large");
            }
            await handle.write(value);
          }
        } finally {
          reader.releaseLock();
        }
        await handle.sync();
        return;
      }
      throw new TelegramApiError("download", "too_many_redirects");
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      handle = null;
      await rm(destination, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      if (handle) await handle.close().catch(() => undefined);
    }
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string, signal?: AbortSignal): Promise<boolean> {
    const params: DynamicRecord = {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    };
    return this.call<boolean>("answerCallbackQuery", params, signal).catch(() => false);
  }
}
