// The Bitwarden API key and master password of this host, encrypted at rest by the operating system.
// Only a connection made through `bitwarden-connector-v1` is stored: the host unlocks again with it
// after a restart. A session key that the user pastes on their own computer stays in memory only.

import { readFile, rm } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema, Semaphore } from "effect";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { causeHelpers } from "../backend/effect-boundary";
import { PasswordVaultError } from "../backend/password-vault";
import type { SecretCipher } from "./provider-credential-store";

const { io: vaultCall, sync: vaultDecode } = causeHelpers(PasswordVaultError);

const recordSchema = Schema.Struct({
  /** The Bitwarden or Vaultwarden server, an `https:` origin. */
  serverUrl: Schema.String,
  /** The personal API key. It signs in; it cannot unlock the vault. */
  clientId: Schema.String,
  clientSecret: Schema.String,
  /** Unlocks the vault on this host. It goes only to the `bw` process, in its environment. */
  masterPassword: Schema.String,
  connectedAt: Schema.Number,
});

export type BitwardenConnectorRecord = typeof recordSchema.Type;

/** `version` is checked: an envelope that this build cannot read is reported as unreadable. */
const envelopeSchema = Schema.Struct({ version: Schema.Literal(1), record: Schema.String });

/** One record is small; a larger file is not one that this app wrote. */
const MAX_ENVELOPE_BYTES = 64 * 1024;

/**
 * Reads and writes the host connection. The decrypted record is kept in memory only. Writes run one
 * at a time, because a connect and a disconnect can arrive together.
 */
export class BitwardenConnectorStore {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #record: BitwardenConnectorRecord | null = null;
  readonly #queue = Semaphore.makeUnsafe(1);

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  /** Reads the file. Returns the error when the file is there but cannot be read. */
  load(): Effect.Effect<Error | null> {
    return Effect.gen({ self: this }, function* () {
      this.#record = null;
      const result = yield* Effect.result(this.#read());
      if (Result.isFailure(result)) {
        const error = result.failure.cause;
        return error instanceof Error ? error : new Error(sourceText("error.connector.bitwardenFileUnreadable"));
      }
      this.#record = result.success;
      return null;
    });
  }

  read(): BitwardenConnectorRecord | null {
    return this.#record;
  }

  /**
   * Stores `record` while `current()` holds. It is asked again after the file is written: an attempt
   * that was stopped during the write removes the file again. True when the record was kept.
   */
  write(record: BitwardenConnectorRecord, current: () => boolean): Effect.Effect<boolean, PasswordVaultError> {
    return this.#serialize(
      Effect.gen({ self: this }, function* () {
        if (!current()) return false;
        const encrypted = yield* vaultDecode(() => this.#cipher.encrypt(JSON.stringify(record)).toString("base64"));
        yield* writeJsonFileAtomically(this.#path, { version: 1, record: encrypted }, { createDirectory: true }).pipe(
          Effect.mapError(({ cause }) => new PasswordVaultError({ cause })),
        );
        if (!current()) {
          yield* vaultCall(() => rm(this.#path, { force: true }));
          this.#record = null;
          return false;
        }
        this.#record = record;
        return true;
      }),
    );
  }

  /** Forgets the record at once, so no unlock starts with it, then removes the file. */
  clear(): Effect.Effect<void, PasswordVaultError> {
    return Effect.suspend(() => {
      this.#record = null;
      return this.#serialize(
        Effect.gen({ self: this }, function* () {
          yield* vaultCall(() => rm(this.#path, { force: true }));
          this.#record = null;
        }),
      );
    });
  }

  #serialize<A>(change: Effect.Effect<A, PasswordVaultError>): Effect.Effect<A, PasswordVaultError> {
    return this.#queue.withPermit(change).pipe(Effect.uninterruptible);
  }

  readonly #read = Effect.fn("BitwardenConnectorStore.read")(function* (
    this: BitwardenConnectorStore,
  ): Effect.fn.Return<BitwardenConnectorRecord | null, PasswordVaultError> {
    const source = yield* vaultCall(() => readFile(this.#path, "utf8")).pipe(
      Effect.catch(({ cause }) =>
        cause instanceof Error && "code" in cause && cause.code === "ENOENT"
          ? Effect.succeed(null)
          : Effect.fail(new PasswordVaultError({ cause })),
      ),
    );
    if (source === null) return null;
    if (source.length > MAX_ENVELOPE_BYTES)
      return yield* new PasswordVaultError({ cause: new Error(sourceText("error.connector.bitwardenFileUnreadable")) });
    return yield* vaultDecode(() => {
      const envelope = Schema.decodeUnknownSync(envelopeSchema)(JSON.parse(source));
      return Schema.decodeUnknownSync(recordSchema)(
        JSON.parse(this.#cipher.decrypt(Buffer.from(envelope.record, "base64"))),
      );
    }).pipe(
      Effect.mapError(
        () => new PasswordVaultError({ cause: new Error(sourceText("error.connector.bitwardenFileUnreadable")) }),
      ),
    );
  });
}
