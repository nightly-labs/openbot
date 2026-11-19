import { readFile, rm } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Semaphore } from "effect";
import { z } from "zod";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { GitHubOperationError, githubCall, githubDecode, toGitHubOperationError } from "./github-effects";
import type { SecretCipher } from "./provider-credential-store";

const githubConnectorRecordSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.number().nullable(),
  refreshToken: z.string().min(1).nullable(),
  refreshTokenExpiresAt: z.number().nullable(),
  login: z.string().min(1),
  userId: z.number(),
  avatarUrl: z.string().nullable(),
  mcpProxy: z.object({ port: z.number().int().min(1).max(65_535), secret: z.string().min(32) }).nullish(),
});

export type GitHubConnectorRecord = z.infer<typeof githubConnectorRecordSchema>;

const envelopeSchema = z.object({ version: z.literal(1), record: z.string() });

const MAX_ENVELOPE_BYTES = 64 * 1024;

export class GitHubConnectorStore {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #record: GitHubConnectorRecord | null = null;
  readonly #queue = Semaphore.makeUnsafe(1);

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  readonly load = Effect.fn("GitHubConnectorStore.load")(function* (this: GitHubConnectorStore) {
    this.#record = null;
    const result = yield* this.#readEffect().pipe(Effect.result);
    if (Result.isFailure(result)) {
      const error = result.failure.cause;
      return error instanceof Error ? error : new Error(sourceText("error.connector.githubFileUnreadable"));
    }
    this.#record = result.success;
    return null;
  });

  read(): GitHubConnectorRecord | null {
    return this.#record;
  }

  readonly write = Effect.fn("GitHubConnectorStore.write")(
    function* (this: GitHubConnectorStore, record: GitHubConnectorRecord) {
      const encrypted = yield* githubDecode(() => this.#cipher.encrypt(JSON.stringify(record)).toString("base64"));
      yield* writeJsonFileAtomically(this.#path, { version: 1, record: encrypted }, { createDirectory: true }).pipe(
        toGitHubOperationError,
      );
      this.#record = record;
    },
    (operation) => this.#queue.withPermit(operation).pipe(Effect.uninterruptible),
  );

  readonly clear = Effect.fn("GitHubConnectorStore.clear")(
    function* (this: GitHubConnectorStore) {
      yield* githubCall(() => rm(this.#path, { force: true }));
      this.#record = null;
    },
    (operation) => this.#queue.withPermit(operation).pipe(Effect.uninterruptible),
  );

  readonly #readEffect = Effect.fn("GitHubConnectorStore.read")(function* (
    this: GitHubConnectorStore,
  ): Effect.fn.Return<GitHubConnectorRecord | null, GitHubOperationError> {
    const result = yield* githubCall(() => readFile(this.#path, "utf8")).pipe(Effect.result);
    if (Result.isFailure(result)) {
      const error = result.failure.cause;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      return yield* result.failure;
    }
    const source = result.success;
    if (source.length > MAX_ENVELOPE_BYTES)
      return yield* new GitHubOperationError({ cause: new Error(sourceText("error.connector.githubFileTooLarge")) });
    return yield* githubDecode(() => {
      const envelope = envelopeSchema.parse(JSON.parse(source));
      return githubConnectorRecordSchema.parse(
        JSON.parse(this.#cipher.decrypt(Buffer.from(envelope.record, "base64"))),
      );
    }).pipe(
      Effect.mapError(
        () => new GitHubOperationError({ cause: new Error(sourceText("error.connector.githubFileUnreadable")) }),
      ),
    );
  });
}
