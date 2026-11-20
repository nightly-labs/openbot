import { readFile, rm } from "node:fs/promises";
import { Effect, Result, Schema, Semaphore } from "effect";
import { writeJsonFileAtomically } from "../../backend/atomic-json-file";
import { causeHelpers } from "../../backend/effect-boundary";
import type { SecretCipher } from "../provider-credential-store";
import { PasswordManagerError, passwordManagerFailure } from "./driver";

const { io, sync } = causeHelpers(PasswordManagerError);

const envelopeSchema = Schema.Struct({ version: Schema.Literal(1), record: Schema.String });

const MAX_ENVELOPE_BYTES = 64 * 1024;

export interface EncryptedRecordStoreOptions<A> {
  path: string;
  cipher: SecretCipher;
  decode: (value: unknown) => A;
  unreadable: string;
}

export class EncryptedRecordStore<A> {
  readonly #options: EncryptedRecordStoreOptions<A>;
  #record: A | null = null;
  readonly #queue = Semaphore.makeUnsafe(1);

  constructor(options: EncryptedRecordStoreOptions<A>) {
    this.#options = options;
  }

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

  write(record: A, current: () => boolean): Effect.Effect<boolean, PasswordManagerError> {
    return this.#serialize(
      Effect.gen({ self: this }, function* () {
        if (!current()) return false;
        yield* this.#writeFile(record);
        if (!current()) {
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
