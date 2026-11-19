import { readFile, rm } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema, Semaphore } from "effect";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { causeHelpers } from "../backend/effect-boundary";
import { PasswordVaultError } from "../backend/password-vault";
import type { SecretCipher } from "./provider-credential-store";

const { io: vaultCall, sync: vaultDecode } = causeHelpers(PasswordVaultError);

const recordSchema = Schema.Struct({
  serverUrl: Schema.String,
  clientId: Schema.String,
  clientSecret: Schema.String,
  masterPassword: Schema.String,
  connectedAt: Schema.Number,
});

export type BitwardenConnectorRecord = typeof recordSchema.Type;

const envelopeSchema = Schema.Struct({ version: Schema.Literal(1), record: Schema.String });

const MAX_ENVELOPE_BYTES = 64 * 1024;

export class BitwardenConnectorStore {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #record: BitwardenConnectorRecord | null = null;
  readonly #queue = Semaphore.makeUnsafe(1);

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

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
