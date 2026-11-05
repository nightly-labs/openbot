// One encrypted record of a password-manager driver, such as the access key that the host keeps.
// The operating system encrypts the record at rest; the decrypted record is kept in memory only.

import { readFile, rm } from "node:fs/promises";
import { Effect, Result, Schema, Semaphore } from "effect";
import { writeJsonFileAtomically } from "../../backend/atomic-json-file";
import { causeHelpers } from "../../backend/effect-boundary";
import type { SecretCipher } from "../provider-credential-store";
import { PasswordManagerError, passwordManagerFailure } from "./driver";

const { io, sync } = causeHelpers(PasswordManagerError);

/** `version` is checked: an envelope that this build cannot read is reported as unreadable. */
const envelopeSchema = Schema.Struct({ version: Schema.Literal(1), record: Schema.String });

/** One record is small; a larger file is not one that this app wrote. */
const MAX_ENVELOPE_BYTES = 64 * 1024;

export interface EncryptedRecordStoreOptions<A> {
  path: string;
  cipher: SecretCipher;
  /** Decodes the decrypted JSON value. Throws for a value that is not a record. */
  decode: (value: unknown) => A;
  /** The catalog text for a file that is there but cannot be read. */
  unreadable: string;
}

/** Writes run one at a time, because a connect and a disconnect can arrive together. */
export class EncryptedRecordStore<A> {
  readonly #options: EncryptedRecordStoreOptions<A>;
  #record: A | null = null;
  readonly #queue = Semaphore.makeUnsafe(1);

  constructor(options: EncryptedRecordStoreOptions<A>) {
    this.#options = options;
  }

  /** Reads the file. Returns the error when the file is there but cannot be read. */
  load(): Effect.Effect<Error | null> {
    return Effect.gen({ self: this }, function* () {
      this.#record = null;
      const result = yield* Effect.result(this.#read());
      if (Result.isFailure(result)) {
        const error = result.failure.cause;
        return error instanceof Error ? error : new Error(this.#options.unreadable);
      }
      this.#record = result.success;
      return null;
    });
  }

  read(): A | null {
    return this.#record;
  }

  /**
   * Stores `record` while `current()` holds. It is asked again after the file is written: for an attempt
   * that was stopped during the write, the file gets the earlier record again. True when the record was kept.
   */
  write(record: A, current: () => boolean): Effect.Effect<boolean, PasswordManagerError> {
    return this.#serialize(
      Effect.gen({ self: this }, function* () {
        if (!current()) return false;
        yield* this.#writeFile(record);
        if (!current()) {
          // The stopped attempt does not replace the record that was kept before it.
          const kept = this.#record;
          if (kept === null) yield* io(() => rm(this.#options.path, { force: true }));
          else yield* this.#writeFile(kept);
          return false;
        }
        this.#record = record;
        return true;
      }),
    );
  }

  #writeFile(record: A): Effect.Effect<void, PasswordManagerError> {
    return Effect.gen({ self: this }, function* () {
      const encrypted = yield* sync(() => this.#options.cipher.encrypt(JSON.stringify(record)).toString("base64"));
      yield* writeJsonFileAtomically(
        this.#options.path,
        { version: 1, record: encrypted },
        { createDirectory: true },
      ).pipe(Effect.mapError(({ cause }) => new PasswordManagerError({ cause })));
    });
  }

  /** Forgets the record at once, so no later call uses it, then removes the file. */
  clear(): Effect.Effect<void, PasswordManagerError> {
    return Effect.suspend(() => {
      this.#record = null;
      return this.#serialize(
        Effect.gen({ self: this }, function* () {
          yield* io(() => rm(this.#options.path, { force: true }));
          this.#record = null;
        }),
      );
    });
  }

  #serialize<B>(change: Effect.Effect<B, PasswordManagerError>): Effect.Effect<B, PasswordManagerError> {
    return this.#queue.withPermit(change).pipe(Effect.uninterruptible);
  }

  #read(): Effect.Effect<A | null, PasswordManagerError> {
    const { path, cipher, decode, unreadable } = this.#options;
    return Effect.gen(function* () {
      const source = yield* io(() => readFile(path, "utf8")).pipe(
        Effect.catch(({ cause }) =>
          cause instanceof Error && "code" in cause && cause.code === "ENOENT"
            ? Effect.succeed(null)
            : Effect.fail(new PasswordManagerError({ cause })),
        ),
      );
      if (source === null) return null;
      if (source.length > MAX_ENVELOPE_BYTES) return yield* passwordManagerFailure(unreadable);
      return yield* sync(() => {
        const envelope = Schema.decodeUnknownSync(envelopeSchema)(JSON.parse(source));
        return decode(JSON.parse(cipher.decrypt(Buffer.from(envelope.record, "base64"))));
      }).pipe(Effect.mapError(() => passwordManagerFailure(unreadable)));
    }).pipe(Effect.withSpan("EncryptedRecordStore.read"));
  }
}
