// The Bitwarden connection of this computer, encrypted at rest by the operating system.
// Version 1 is a joined-server API key and master password (`bitwarden-connector-v1`). Version 2 is a
// session key pasted on this computer. Each unlocks again after a restart. Disconnect removes the file.

import { readFile, rm } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema, Semaphore } from "effect";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { causeHelpers } from "../backend/effect-boundary";
import { PasswordVaultError } from "../backend/password-vault";
import type { SecretCipher } from "./provider-credential-store";

const { io: vaultCall, sync: vaultDecode } = causeHelpers(PasswordVaultError);

const hostRecordSchema = Schema.Struct({
  /** The Bitwarden or Vaultwarden server, an `https:` origin. */
  serverUrl: Schema.String,
  /** The personal API key. It signs in; it cannot unlock the vault. */
  clientId: Schema.String,
  clientSecret: Schema.String,
  /** Unlocks the vault on this host. It goes only to the `bw` process, in its environment. */
  masterPassword: Schema.String,
  connectedAt: Schema.Number,
});
const sessionRecordSchema = Schema.Struct({
  type: Schema.Literal("session"),
  /** `BW_SESSION` from `bw unlock --raw` on this computer. */
  key: Schema.String,
  connectedAt: Schema.Number,
});

export type BitwardenHostRecord = typeof hostRecordSchema.Type;
export type BitwardenSessionRecord = typeof sessionRecordSchema.Type;
export type BitwardenConnectorRecord = BitwardenHostRecord | BitwardenSessionRecord;

export function isBitwardenSessionRecord(record: BitwardenConnectorRecord): record is BitwardenSessionRecord {
  return "type" in record && record.type === "session";
}

/** `version` is checked: an envelope that this build cannot read is reported as unreadable. */
const envelopeSchema = Schema.Union([
  Schema.Struct({ version: Schema.Literal(1), record: Schema.String }),
  Schema.Struct({ version: Schema.Literal(2), record: Schema.String }),
]);

/** One record is small; a larger file is not one that this app wrote. */
const MAX_ENVELOPE_BYTES = 64 * 1024;

/**
 * Reads and writes the connection. The decrypted record is kept in memory only. Writes run one at a
 * time, because a connect and a disconnect can arrive together.
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
        const version = isBitwardenSessionRecord(record) ? 2 : 1;
        const encrypted = yield* vaultDecode(() => this.#cipher.encrypt(JSON.stringify(record)).toString("base64"));
        yield* writeJsonFileAtomically(this.#path, { version, record: encrypted }, { createDirectory: true }).pipe(
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
      const decrypted = JSON.parse(this.#cipher.decrypt(Buffer.from(envelope.record, "base64")));
      return envelope.version === 2
        ? Schema.decodeUnknownSync(sessionRecordSchema)(decrypted)
        : Schema.decodeUnknownSync(hostRecordSchema)(decrypted);
    }).pipe(
      Effect.mapError(
        () => new PasswordVaultError({ cause: new Error(sourceText("error.connector.bitwardenFileUnreadable")) }),
      ),
    );
  });
}
