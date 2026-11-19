import { readFile, rm } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Semaphore } from "effect";
import { z } from "zod";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { OnePasswordOperationError, onePasswordCall, onePasswordDecode } from "./onepassword-effects";
import type { SecretCipher } from "./provider-credential-store";

const onePasswordConnectorRecordSchema = z.object({
  token: z.string().min(1),
  accountId: z.string().min(1).nullable(),
  connectedAt: z.number(),
});

export type OnePasswordConnectorRecord = z.infer<typeof onePasswordConnectorRecordSchema>;

const envelopeSchema = z.object({ version: z.literal(1), record: z.string() });

const MAX_ENVELOPE_BYTES = 64 * 1024;

export class OnePasswordConnectorStore {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #record: OnePasswordConnectorRecord | null = null;
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
        return error instanceof Error ? error : new Error(sourceText("error.connector.onePasswordFileUnreadable"));
      }
      this.#record = result.success;
      return null;
    });
  }

  read(): OnePasswordConnectorRecord | null {
    return this.#record;
  }

  write(
    record: OnePasswordConnectorRecord,
    current: () => boolean = () => true,
  ): Effect.Effect<boolean, OnePasswordOperationError> {
    return this.#serialize(
      Effect.gen({ self: this }, function* () {
        if (!current()) return false;
        const encrypted = yield* onePasswordDecode(() =>
          this.#cipher.encrypt(JSON.stringify(record)).toString("base64"),
        );
        yield* writeJsonFileAtomically(this.#path, { version: 1, record: encrypted }, { createDirectory: true }).pipe(
          Effect.mapError(({ cause }) => new OnePasswordOperationError({ cause })),
        );
        if (!current()) {
          yield* onePasswordCall(() => rm(this.#path, { force: true }));
          this.#record = null;
          return false;
        }
        this.#record = record;
        return true;
      }),
    );
  }

  clear(): Effect.Effect<void, OnePasswordOperationError> {
    return Effect.suspend(() => {
      this.#record = null;
      return this.#serialize(
        Effect.gen({ self: this }, function* () {
          yield* onePasswordCall(() => rm(this.#path, { force: true }));
          this.#record = null;
        }),
      );
    });
  }

  #serialize<A>(change: Effect.Effect<A, OnePasswordOperationError>): Effect.Effect<A, OnePasswordOperationError> {
    return this.#queue.withPermit(change).pipe(Effect.uninterruptible);
  }

  readonly #read = Effect.fn("OnePasswordConnectorStore.read")(function* (
    this: OnePasswordConnectorStore,
  ): Effect.fn.Return<OnePasswordConnectorRecord | null, OnePasswordOperationError> {
    const source = yield* onePasswordCall(() => readFile(this.#path, "utf8")).pipe(
      Effect.catch(({ cause }) =>
        cause instanceof Error && "code" in cause && cause.code === "ENOENT"
          ? Effect.succeed(null)
          : Effect.fail(new OnePasswordOperationError({ cause })),
      ),
    );
    if (source === null) return null;
    if (source.length > MAX_ENVELOPE_BYTES)
      return yield* new OnePasswordOperationError({
        cause: new Error(sourceText("error.connector.onePasswordFileTooLarge")),
      });
    return yield* onePasswordDecode(() => {
      const envelope = envelopeSchema.parse(JSON.parse(source));
      return onePasswordConnectorRecordSchema.parse(
        JSON.parse(this.#cipher.decrypt(Buffer.from(envelope.record, "base64"))),
      );
    }).pipe(
      Effect.mapError(
        () =>
          new OnePasswordOperationError({ cause: new Error(sourceText("error.connector.onePasswordFileUnreadable")) }),
      ),
    );
  });
}
