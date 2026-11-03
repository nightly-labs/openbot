// The one Link sign-in of this computer, encrypted at rest by the operating system.

import { readFile, rm } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Semaphore } from "effect";
import { z } from "zod";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { LinkOperationError, linkCall, linkDecode, toLinkOperationError } from "./link-effects";
import type { SecretCipher } from "./provider-credential-store";

const linkAccountRecordSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.number().nullable(),
  /** Null after Link refused it: the panel then shows the sign-in as expired. */
  refreshToken: z.string().min(1).nullable(),
  email: z.string().nullable(),
});

export type LinkAccountRecord = z.infer<typeof linkAccountRecordSchema>;

/** A version that this build cannot read is reported as unreadable; a new sign-in replaces the file. */
const envelopeSchema = z.object({ version: z.literal(1), record: z.string() });

/** One token set is small; a larger file is not one that this app wrote. */
const MAX_ENVELOPE_BYTES = 64 * 1024;

/**
 * Reads and writes the Link sign-in. The decrypted record is kept in memory only. Writes run one at a
 * time, because a refresh and a disconnect can arrive together.
 */
export class LinkAccountStore {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #record: LinkAccountRecord | null = null;
  readonly #queue = Semaphore.makeUnsafe(1);

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  /** Reads the file. Returns the error when the file is there but cannot be read. */
  readonly load = Effect.fn("LinkAccountStore.load")(function* (this: LinkAccountStore) {
    this.#record = null;
    const result = yield* this.#readEffect().pipe(Effect.result);
    if (Result.isFailure(result)) {
      const error = result.failure.cause;
      return error instanceof Error ? error : new Error(sourceText("error.connector.linkFileUnreadable"));
    }
    this.#record = result.success;
    return null;
  });

  read(): LinkAccountRecord | null {
    return this.#record;
  }

  readonly write = Effect.fn("LinkAccountStore.write")(
    function* (this: LinkAccountStore, record: LinkAccountRecord) {
      const encrypted = yield* linkDecode(() => this.#cipher.encrypt(JSON.stringify(record)).toString("base64"));
      yield* writeJsonFileAtomically(this.#path, { version: 1, record: encrypted }, { createDirectory: true }).pipe(
        toLinkOperationError,
      );
      this.#record = record;
    },
    (operation) => this.#queue.withPermit(operation).pipe(Effect.uninterruptible),
  );

  readonly clear = Effect.fn("LinkAccountStore.clear")(
    function* (this: LinkAccountStore) {
      yield* linkCall(() => rm(this.#path, { force: true }));
      this.#record = null;
    },
    (operation) => this.#queue.withPermit(operation).pipe(Effect.uninterruptible),
  );

  readonly #readEffect = Effect.fn("LinkAccountStore.read")(function* (
    this: LinkAccountStore,
  ): Effect.fn.Return<LinkAccountRecord | null, LinkOperationError> {
    const result = yield* linkCall(() => readFile(this.#path, "utf8")).pipe(Effect.result);
    if (Result.isFailure(result)) {
      const error = result.failure.cause;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      return yield* result.failure;
    }
    const source = result.success;
    if (source.length > MAX_ENVELOPE_BYTES)
      return yield* new LinkOperationError({ cause: new Error(sourceText("error.connector.linkFileTooLarge")) });
    return yield* linkDecode(() => {
      const envelope = envelopeSchema.parse(JSON.parse(source));
      return linkAccountRecordSchema.parse(JSON.parse(this.#cipher.decrypt(Buffer.from(envelope.record, "base64"))));
    }).pipe(
      Effect.mapError(
        () => new LinkOperationError({ cause: new Error(sourceText("error.connector.linkFileUnreadable")) }),
      ),
    );
  });
}
