// The Telegram account connection of this computer, encrypted at rest by the operating system.

import { readFile, rm } from "node:fs/promises";
import { TELEGRAM_ACCOUNT_API_HASH_PATTERN } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Result, Semaphore } from "effect";
import { z } from "zod";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import type { SecretCipher } from "./provider-credential-store";
import { TelegramAccountOperationError, telegramAccountCall, telegramAccountDecode } from "./telegram-account-effects";

const telegramAccountSchema = z.object({
  id: z.string().min(1),
  firstName: z.string(),
  lastName: z.string(),
  username: z.string().nullable(),
  /** The whole number, as Telegram gives it. Only this computer keeps it; every status masks it. */
  phone: z.string().nullable(),
});

export type TelegramAccountRecordAccount = z.infer<typeof telegramAccountSchema>;

const telegramAccountConnectorRecordSchema = z.object({
  /** The Telegram app of the user, from my.telegram.org. Kept after a sign-out. */
  apiId: z.number().int().positive(),
  apiHash: z.string().regex(TELEGRAM_ACCOUNT_API_HASH_PATTERN),
  /** The GramJS session string. It grants full access to the account. Empty while signed out. */
  session: z.string(),
  account: telegramAccountSchema.nullable(),
  sendingEnabled: z.boolean(),
  connectedAt: z.number().nullable(),
  /**
   * The loopback MCP server that agents reach. Its port and bearer stay the same across restarts,
   * because a resumed Codex session keeps the URL and header that it started with.
   */
  mcpServer: z.object({ port: z.number().int().min(1).max(65_535), secret: z.string().min(32) }).nullish(),
});

export type TelegramAccountConnectorRecord = z.infer<typeof telegramAccountConnectorRecordSchema>;

/**
 * `version` is checked, not tolerated: an envelope that this build cannot read is reported as
 * unreadable. The file stays on disk until a new connection replaces it.
 */
const envelopeSchema = z.object({ version: z.literal(1), record: z.string() });

/** One session string is small; a larger file is not one that this app wrote. */
const MAX_ENVELOPE_BYTES = 64 * 1024;

/** Masks the secrets of `record` in every later log line, before any line can name them. */
function registerTelegramAccountSecrets(record: TelegramAccountConnectorRecord): void {
  registerSecretValue(record.apiHash);
  if (record.session) registerSecretValue(record.session);
  if (record.mcpServer) registerSecretValue(record.mcpServer.secret);
}

/**
 * Reads and writes the Telegram account connection. The decrypted record is kept in memory only.
 *
 * `electron` is not imported: the cipher arrives as an argument, so a test can use a fake one.
 * Writes run one at a time, because a sign-in, a sign-out and a session that Telegram ended can
 * arrive together.
 */
export class TelegramAccountConnectorStore {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #record: TelegramAccountConnectorRecord | null = null;
  readonly #queue = Semaphore.makeUnsafe(1);

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  /** Reads the file. Returns the error when the file is there but cannot be read. */
  readonly load = Effect.fn("TelegramAccountConnectorStore.load")(function* (
    this: TelegramAccountConnectorStore,
  ): Effect.fn.Return<Error | null> {
    this.#record = null;
    const result = yield* Effect.result(this.#read());
    if (Result.isFailure(result)) {
      const error = result.failure.cause;
      return error instanceof Error ? error : new Error(sourceText("error.connector.telegramAccountFileUnreadable"));
    }
    if (result.success) registerTelegramAccountSecrets(result.success);
    this.#record = result.success;
    return null;
  });

  read(): TelegramAccountConnectorRecord | null {
    return this.#record;
  }

  /**
   * Stores the record that `change` makes from the current one, while `current()` holds. It is asked
   * again after the file is written, in the same queued change: a change that was stopped during the
   * write puts the previous record back. Answers the record that is kept, or null when the change
   * was dropped.
   */
  update(
    change: (record: TelegramAccountConnectorRecord | null) => TelegramAccountConnectorRecord | null,
    current: () => boolean = () => true,
  ): Effect.Effect<TelegramAccountConnectorRecord | null, TelegramAccountOperationError> {
    return this.#serialize(
      Effect.gen({ self: this }, function* () {
        if (!current()) return null;
        const previous = this.#record;
        const record = change(previous);
        if (record === previous) return record;
        if (record === null) {
          yield* telegramAccountCall(() => rm(this.#path, { force: true }));
          this.#record = null;
          return null;
        }
        registerTelegramAccountSecrets(record);
        yield* this.#write(record);
        if (!current()) {
          yield* previous ? this.#write(previous) : telegramAccountCall(() => rm(this.#path, { force: true }));
          return null;
        }
        this.#record = record;
        return record;
      }),
    );
  }

  #write(record: TelegramAccountConnectorRecord): Effect.Effect<void, TelegramAccountOperationError> {
    return Effect.gen({ self: this }, function* () {
      const encrypted = yield* telegramAccountDecode(() =>
        this.#cipher.encrypt(JSON.stringify(record)).toString("base64"),
      );
      // Write then rename, so a crash leaves the previous connection readable.
      yield* writeJsonFileAtomically(this.#path, { version: 1, record: encrypted }, { createDirectory: true }).pipe(
        Effect.mapError(({ cause }) => new TelegramAccountOperationError({ cause })),
      );
    });
  }

  #serialize<A>(
    change: Effect.Effect<A, TelegramAccountOperationError>,
  ): Effect.Effect<A, TelegramAccountOperationError> {
    return this.#queue.withPermit(change).pipe(Effect.uninterruptible);
  }

  readonly #read = Effect.fn("TelegramAccountConnectorStore.read")(function* (
    this: TelegramAccountConnectorStore,
  ): Effect.fn.Return<TelegramAccountConnectorRecord | null, TelegramAccountOperationError> {
    const source = yield* telegramAccountCall(() => readFile(this.#path, "utf8")).pipe(
      Effect.catch(({ cause }) =>
        cause instanceof Error && "code" in cause && cause.code === "ENOENT"
          ? Effect.succeed(null)
          : Effect.fail(new TelegramAccountOperationError({ cause })),
      ),
    );
    if (source === null) return null;
    if (source.length > MAX_ENVELOPE_BYTES)
      return yield* new TelegramAccountOperationError({
        cause: new Error(sourceText("error.connector.telegramAccountFileTooLarge")),
      });
    return yield* telegramAccountDecode(() => {
      const envelope = envelopeSchema.parse(JSON.parse(source));
      return telegramAccountConnectorRecordSchema.parse(
        JSON.parse(this.#cipher.decrypt(Buffer.from(envelope.record, "base64"))),
      );
    }).pipe(
      Effect.mapError(
        () =>
          new TelegramAccountOperationError({
            cause: new Error(sourceText("error.connector.telegramAccountFileUnreadable")),
          }),
      ),
    );
  });
}
