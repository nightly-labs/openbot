import {
  TELEGRAM_FILE_BYTES_LIMIT,
  TELEGRAM_UPDATES_PATH,
  type TelegramCallFailure,
  type TelegramCallMethod,
  type TelegramCallParams,
  type TelegramCallResult,
  type TelegramUploadAnswer,
} from "@openbot/contracts/signal-protocol/telegram-route";
import { Effect, Schema } from "effect";
import { z } from "zod";
import type { TelegramConfig } from "./config";
import type { TelegramCall } from "./protocol";
import {
  type TelegramFileTokens,
  type TelegramUploadGrant,
  telegramWebhookSecret,
  verifyTelegramWebhookSecret,
} from "./tokens";

export type TelegramFetch = (url: string, init: RequestInit) => Promise<Response>;

interface TelegramSetWebhookParams {
  url: string;
  secret_token: string;
  allowed_updates: string[];
}

type TelegramRequestBody =
  | TelegramCallParams[TelegramCallMethod]
  | { file_id: string }
  | TelegramSetWebhookParams
  | FormData;

export type TelegramAnswer<A> = { ok: true; result: A } | ({ ok: false } & TelegramCallFailure);

class TelegramApiError extends Schema.TaggedError<TelegramApiError>()("TelegramApiError", {
  message: Schema.String,
}) {}

const CALL_TIMEOUT_MILLISECONDS = 10_000;
const FILE_TIMEOUT_MILLISECONDS = 60_000;
const ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"];
const FILE_PATH_PATTERN = /^(?!.*\.\.)[A-Za-z0-9_./-]{1,512}$/u;

const answerSchema = z.union([
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error_code: z.int(),
    description: z.string(),
    parameters: z.object({ retry_after: z.int().nonnegative().optional() }).optional(),
  }),
]);
const getMeSchema = z.object({ id: z.int().positive(), username: z.string().min(1).max(64) });
const messageSchema = z.object({ message_id: z.int().positive() });
const fileSchema = z.object({
  file_size: z.int().nonnegative().optional(),
  file_path: z.string().regex(FILE_PATH_PATTERN).optional(),
});

export function telegramFailure(
  errorCode: number,
  description: string,
  retryAfter?: number,
): { ok: false } & TelegramCallFailure {
  return {
    ok: false,
    errorCode,
    description: description.slice(0, 256),
    ...(retryAfter === undefined ? {} : { retryAfter }),
  };
}

const UNAVAILABLE = telegramFailure(502, "Bad Gateway: the Bot API did not answer");
const UNEXPECTED = telegramFailure(502, "Bad Gateway: the Bot API answer is not valid");

export class TelegramBotApi {
  readonly #tokens: ReadonlyMap<string, string>;
  readonly #webhookSecret: string;
  readonly #webhookOrigin: string | null;
  readonly #fetch: TelegramFetch;
  readonly #apiOrigin: string;

  constructor(config: TelegramConfig, options: { fetch?: TelegramFetch; apiOrigin?: string } = {}) {
    this.#tokens = new Map(config.bots.map((bot) => [bot.botId, bot.token]));
    this.#webhookSecret = config.webhookSecret;
    this.#webhookOrigin = config.webhookOrigin;
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#apiOrigin = options.apiOrigin ?? config.apiOrigin ?? "https://api.telegram.org";
  }

  hasBot(botId: string): boolean {
    return this.#tokens.has(botId);
  }

  verifyWebhook(botId: string, secretToken: string): boolean {
    return (
      this.hasBot(botId) && verifyTelegramWebhookSecret(secretToken, telegramWebhookSecret(this.#webhookSecret, botId))
    );
  }

  readonly call = Effect.fn("TelegramBotApi.call")(
    (botId: string, method: string, body: TelegramRequestBody, timeoutMilliseconds = CALL_TIMEOUT_MILLISECONDS) =>
      Effect.gen({ self: this }, function* () {
        const token = this.#tokens.get(botId);
        if (!token) return telegramFailure(403, "forbidden");
        const answer = yield* Effect.tryPromise({
          try: async (signal) => {
            const response = await this.#fetch(`${this.#apiOrigin}/bot${token}/${method}`, {
              method: "POST",
              ...(body instanceof FormData
                ? { body }
                : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
              signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMilliseconds)]),
            });
            return answerSchema.safeParse(await response.json());
          },
          catch: () => new TelegramApiError({ message: "The Bot API request failed." }),
        }).pipe(Effect.catch(() => Effect.succeed(null)));
        if (!answer) return UNAVAILABLE;
        if (!answer.success) return UNEXPECTED;
        if (answer.data.ok) return { ok: true as const, result: answer.data.result };
        return telegramFailure(answer.data.error_code, answer.data.description, answer.data.parameters?.retry_after);
      }),
  );

  readonly download = Effect.fn("TelegramBotApi.download")((botId: string, filePath: string) =>
    Effect.gen({ self: this }, function* () {
      const token = this.#tokens.get(botId);
      if (!token) return yield* new TelegramApiError({ message: "The bot is not configured." });
      return yield* Effect.tryPromise({
        try: () =>
          this.#fetch(`${this.#apiOrigin}/file/bot${token}/${filePath}`, {
            method: "GET",
            signal: AbortSignal.timeout(FILE_TIMEOUT_MILLISECONDS),
          }),
        catch: () => new TelegramApiError({ message: "The Bot API download failed." }),
      });
    }),
  );

  readonly sendDocument = Effect.fn("TelegramBotApi.sendDocument")(
    (grant: TelegramUploadGrant, bytes: Uint8Array<ArrayBuffer>) =>
      Effect.gen({ self: this }, function* () {
        const form = new FormData();
        form.set("chat_id", String(grant.chatId));
        form.set("document", new Blob([bytes]), grant.fileName);
        if (grant.messageThreadId !== undefined) form.set("message_thread_id", String(grant.messageThreadId));
        if (grant.replyParameters) form.set("reply_parameters", JSON.stringify(grant.replyParameters));
        const answer = yield* this.call(grant.botId, "sendDocument", form, FILE_TIMEOUT_MILLISECONDS);
        if (!answer.ok) return answer;
        const message = messageSchema.safeParse(answer.result);
        const upload: TelegramUploadAnswer = message.success
          ? { ok: true, messageId: message.data.message_id }
          : UNEXPECTED;
        return upload;
      }),
  );

  readonly setWebhooks = Effect.fn("TelegramBotApi.setWebhooks")(() =>
    Effect.gen({ self: this }, function* () {
      const origin = this.#webhookOrigin;
      if (!origin) return;
      for (const botId of this.#tokens.keys()) {
        const answer = yield* this.call(botId, "setWebhook", {
          url: `${origin}${TELEGRAM_UPDATES_PATH}/${botId}`,
          secret_token: telegramWebhookSecret(this.#webhookSecret, botId),
          allowed_updates: ALLOWED_UPDATES,
        });
        if (!answer.ok)
          console.error(`OpenBot Remote API could not set the webhook of Telegram bot ${botId} (${answer.errorCode}).`);
      }
    }),
  );
}

export interface SignalTelegram {
  bot: TelegramBotApi;
  files: TelegramFileTokens;
}

export const runTelegramCall = Effect.fn("Telegram.runCall")(function* (telegram: SignalTelegram, call: TelegramCall) {
  const { botId } = call;
  switch (call.method) {
    case "getMe":
      return reduced(yield* telegram.bot.call(botId, "getMe", {}), getMeSchema, (bot) => ({
        botId: String(bot.id),
        username: bot.username,
      }));
    case "sendMessage":
      return reduced(yield* telegram.bot.call(botId, "sendMessage", call.params), messageSchema, (message) => ({
        messageId: message.message_id,
      }));
    case "getFile": {
      const answer = yield* telegram.bot.call(botId, "getFile", { file_id: call.params.file_id });
      if (!answer.ok) return answer;
      const file = fileSchema.safeParse(answer.result);
      if (!file.success) return UNEXPECTED;
      const { file_path: filePath, file_size: fileSize } = file.data;
      if (fileSize !== undefined && fileSize > TELEGRAM_FILE_BYTES_LIMIT)
        return telegramFailure(400, "Bad Request: file is too big");
      if (!filePath) return telegramFailure(400, "Bad Request: file is not available");
      const result: TelegramCallResult = {
        fileToken: telegram.files.issueFile({ botId, filePath }),
        ...(fileSize === undefined ? {} : { fileSize }),
      };
      return { ok: true as const, result };
    }
    case "sendDocument": {
      const { chat_id, file_name, message_thread_id, reply_parameters } = call.params;
      const result: TelegramCallResult = {
        uploadToken: telegram.files.issueUpload({
          botId,
          chatId: chat_id,
          fileName: file_name,
          ...(message_thread_id === undefined ? {} : { messageThreadId: message_thread_id }),
          ...(reply_parameters === undefined ? {} : { replyParameters: reply_parameters }),
        }),
      };
      return { ok: true as const, result };
    }
    default:
      return reduced(yield* telegram.bot.call(botId, call.method, call.params), z.unknown(), () => ({}));
  }
});

function reduced<S extends z.ZodType>(
  answer: TelegramAnswer<unknown>,
  schema: S,
  pick: (value: z.output<S>) => TelegramCallResult,
): TelegramAnswer<TelegramCallResult> {
  if (!answer.ok) return answer;
  const parsed = schema.safeParse(answer.result);
  return parsed.success ? { ok: true, result: pick(parsed.data) } : UNEXPECTED;
}
