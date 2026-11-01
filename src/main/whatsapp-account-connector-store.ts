// The WhatsApp account connection of this computer, encrypted at rest by the operating system. This
// small record says whether the computer is linked and what the user allowed. The keys of the linked
// device and the chats are in their own encrypted files (`whatsapp-account-data-file.ts`).

import { readFile, rm } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Result, Semaphore } from "effect";
import { z } from "zod";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import type { SecretCipher } from "./provider-credential-store";
import {
  registerPhoneNumber,
  WhatsAppAccountOperationError,
  whatsappAccountCall,
  whatsappAccountDecode,
} from "./whatsapp-account-effects";

const whatsappAccountSchema = z.object({
  /** The WhatsApp id of the account, such as `48123456789@s.whatsapp.net`. */
  id: z.string().min(1),
  /** The name that the user set in WhatsApp, or "" when WhatsApp did not send one. */
  name: z.string(),
  /** The digits of the number. Only this computer keeps them; every status masks them. */
  phone: z.string().nullable(),
});

export type WhatsAppAccountRecordAccount = z.infer<typeof whatsappAccountSchema>;

const whatsappAccountConnectorRecordSchema = z.object({
  /** The linked account, or null while this computer is not linked. */
  account: whatsappAccountSchema.nullable(),
  sendingEnabled: z.boolean(),
  connectedAt: z.number().nullable(),
  /**
   * The loopback MCP server that agents reach. Its port and bearer stay the same across restarts,
   * because a resumed Codex session keeps the URL and header that it started with.
   */
  mcpServer: z.object({ port: z.number().int().min(1).max(65_535), secret: z.string().min(32) }).nullish(),
});

export type WhatsAppAccountConnectorRecord = z.infer<typeof whatsappAccountConnectorRecordSchema>;

/**
 * `version` is checked, not tolerated: an envelope that this build cannot read is reported as
 * unreadable. The file stays on disk until a new connection replaces it.
 */
const envelopeSchema = z.object({ version: z.literal(1), record: z.string() });

/** The record is small; a larger file is not one that this app wrote. */
const MAX_ENVELOPE_BYTES = 64 * 1024;

function registerWhatsAppAccountSecrets(record: WhatsAppAccountConnectorRecord): void {
  if (record.account?.phone) registerPhoneNumber(record.account.phone);
  if (record.mcpServer) registerSecretValue(record.mcpServer.secret);
}

/**
 * Reads and writes the WhatsApp account connection. The decrypted record is kept in memory only.
 *
 * `electron` is not imported: the cipher arrives as an argument, so a test can use a fake one.
 * Writes run one at a time, because a link, an unlink and a device that WhatsApp removed can arrive
 * together.
 */
export class WhatsAppAccountConnectorStore {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #record: WhatsAppAccountConnectorRecord | null = null;
  readonly #queue = Semaphore.makeUnsafe(1);

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  /** Reads the file. Returns the error when the file is there but cannot be read. */
  readonly load = Effect.fn("WhatsAppAccountConnectorStore.load")(function* (
    this: WhatsAppAccountConnectorStore,
  ): Effect.fn.Return<Error | null> {
    this.#record = null;
    const result = yield* Effect.result(this.#read());
    if (Result.isFailure(result)) {
      const error = result.failure.cause;
      return error instanceof Error ? error : new Error(sourceText("error.connector.whatsappAccountFileUnreadable"));
    }
    if (result.success) registerWhatsAppAccountSecrets(result.success);
    this.#record = result.success;
    return null;
  });

  read(): WhatsAppAccountConnectorRecord | null {
    return this.#record;
  }

  /** Stores the record that `change` makes from the current one. Answers the record that is kept. */
  update(
    change: (record: WhatsAppAccountConnectorRecord | null) => WhatsAppAccountConnectorRecord | null,
  ): Effect.Effect<WhatsAppAccountConnectorRecord | null, WhatsAppAccountOperationError> {
    return this.#queue
      .withPermit(
        Effect.gen({ self: this }, function* () {
          const previous = this.#record;
          const record = change(previous);
          if (record === previous) return record;
          if (record === null) {
            yield* whatsappAccountCall(() => rm(this.#path, { force: true }));
            this.#record = null;
            return null;
          }
          registerWhatsAppAccountSecrets(record);
          const encrypted = yield* whatsappAccountDecode(() =>
            this.#cipher.encrypt(JSON.stringify(record)).toString("base64"),
          );
          // Write then rename, so a crash leaves the previous connection readable.
          yield* writeJsonFileAtomically(this.#path, { version: 1, record: encrypted }, { createDirectory: true }).pipe(
            Effect.mapError(({ cause }) => new WhatsAppAccountOperationError({ cause })),
          );
          this.#record = record;
          return record;
        }),
      )
      .pipe(Effect.uninterruptible);
  }

  readonly #read = Effect.fn("WhatsAppAccountConnectorStore.read")(function* (
    this: WhatsAppAccountConnectorStore,
  ): Effect.fn.Return<WhatsAppAccountConnectorRecord | null, WhatsAppAccountOperationError> {
    const source = yield* whatsappAccountCall(() => readFile(this.#path, "utf8")).pipe(
      Effect.catch(({ cause }) =>
        cause instanceof Error && "code" in cause && cause.code === "ENOENT"
          ? Effect.succeed(null)
          : Effect.fail(new WhatsAppAccountOperationError({ cause })),
      ),
    );
    if (source === null) return null;
    if (source.length > MAX_ENVELOPE_BYTES)
      return yield* new WhatsAppAccountOperationError({
        cause: new Error(sourceText("error.connector.whatsappAccountFileUnreadable")),
      });
    return yield* whatsappAccountDecode(() => {
      const envelope = envelopeSchema.parse(JSON.parse(source));
      return whatsappAccountConnectorRecordSchema.parse(
        JSON.parse(this.#cipher.decrypt(Buffer.from(envelope.record, "base64"))),
      );
    }).pipe(
      Effect.mapError(
        () =>
          new WhatsAppAccountOperationError({
            cause: new Error(sourceText("error.connector.whatsappAccountFileUnreadable")),
          }),
      ),
    );
  });
}
