import { readFile, rm } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Result, Schema, Semaphore } from "effect";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { causeHelpers } from "../backend/effect-boundary";
import { PasswordVaultError } from "../backend/password-vault";
import type { SecretCipher } from "./provider-credential-store";

const { io: vaultCall, sync: vaultDecode } = causeHelpers(PasswordVaultError);

const addedBy = Schema.optionalKey(Schema.String);

const agents = Schema.optionalKey(Schema.Array(Schema.String));

const loginSchema = Schema.Struct({
  id: Schema.String,
  website: Schema.String,
  username: Schema.String,
  password: Schema.String,
  notes: Schema.String,
  twoStepKey: Schema.optionalKey(Schema.String),
  addedBy,
  agents,
});

const cardSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  nameOnCard: Schema.String,
  number: Schema.String,
  expMonth: Schema.Number,
  expYear: Schema.Number,
  securityCode: Schema.String,
  billingContactId: Schema.NullOr(Schema.String),
  fillSites: Schema.optionalKey(
    Schema.Array(Schema.Struct({ page: Schema.String, frames: Schema.Array(Schema.String) })),
  ),
  addedBy,
  agents,
});

const contactSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  fullName: Schema.String,
  address: Schema.String,
  address2: Schema.String,
  city: Schema.String,
  region: Schema.String,
  postalCode: Schema.String,
  country: Schema.String,
  phone: Schema.String,
  email: Schema.String,
  addedBy,
  agents,
});

const apiKeySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  key: Schema.String,
  notes: Schema.String,
  addedBy,
  agents,
});

const recordSchema = Schema.Struct({
  logins: Schema.Array(loginSchema),
  cards: Schema.Array(cardSchema),
  contacts: Schema.Array(contactSchema),
  apiKeys: Schema.Array(apiKeySchema).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
});

export type StoredLogin = typeof loginSchema.Type;
export type StoredCard = typeof cardSchema.Type;
export type StoredContact = typeof contactSchema.Type;
export type StoredApiKey = typeof apiKeySchema.Type;
export type VaultRecord = typeof recordSchema.Type;

const EMPTY_VAULT_RECORD: VaultRecord = { logins: [], cards: [], contacts: [], apiKeys: [] };

const envelopeSchema = Schema.Struct({ version: Schema.Literal(1), record: Schema.String });

const MAX_VAULT_ENVELOPE_BYTES = 4 * 1024 * 1024;

const logger = createOpenBotLogger("vault");

function unreadable() {
  return new PasswordVaultError({ cause: new Error(sourceText("error.vault.unreadable")) });
}

function errorKind(cause: unknown): string {
  if (!(cause instanceof Error)) return typeof cause;
  return "code" in cause && typeof cause.code === "string" ? cause.code : cause.name;
}

function logUnreadable(step: "open" | "envelope" | "decrypt" | "items") {
  return ({ cause }: PasswordVaultError) =>
    Effect.sync(() => logger.warn("OpenBot cannot read the Vault file.", { step, error: errorKind(cause) }));
}

export class VaultStore {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #record: VaultRecord = EMPTY_VAULT_RECORD;
  readonly #queue = Semaphore.makeUnsafe(1);

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  load(): Effect.Effect<boolean> {
    return Effect.gen({ self: this }, function* () {
      this.#record = EMPTY_VAULT_RECORD;
      const result = yield* Effect.result(this.#read());
      if (Result.isFailure(result)) return false;
      this.#record = result.success ?? EMPTY_VAULT_RECORD;
      return true;
    });
  }

  read(): VaultRecord {
    return this.#record;
  }

  update(change: (current: VaultRecord) => VaultRecord): Effect.Effect<VaultRecord, PasswordVaultError> {
    return this.#serialize(
      Effect.gen({ self: this }, function* () {
        const next = yield* vaultDecode(() => change(this.#record));
        if (next === this.#record) return next;
        const encrypted = yield* vaultDecode(() => this.#cipher.encrypt(JSON.stringify(next)).toString("base64"));
        if (encrypted.length + 32 > MAX_VAULT_ENVELOPE_BYTES)
          return yield* new PasswordVaultError({ cause: new Error(sourceText("error.vault.tooLarge")) });
        yield* writeJsonFileAtomically(this.#path, { version: 1, record: encrypted }, { createDirectory: true }).pipe(
          Effect.mapError(({ cause }) => new PasswordVaultError({ cause })),
        );
        this.#record = next;
        return next;
      }),
    );
  }

  clear(): Effect.Effect<void, PasswordVaultError> {
    return this.#serialize(
      Effect.gen({ self: this }, function* () {
        yield* vaultCall(() => rm(this.#path, { force: true }));
        this.#record = EMPTY_VAULT_RECORD;
      }),
    );
  }

  #serialize<A>(change: Effect.Effect<A, PasswordVaultError>): Effect.Effect<A, PasswordVaultError> {
    return this.#queue.withPermit(change).pipe(Effect.uninterruptible);
  }

  readonly #read = Effect.fn("VaultStore.read")(function* (
    this: VaultStore,
  ): Effect.fn.Return<VaultRecord | null, PasswordVaultError> {
    const source = yield* vaultCall(() => readFile(this.#path, "utf8")).pipe(
      Effect.catch(({ cause }) =>
        cause instanceof Error && "code" in cause && cause.code === "ENOENT"
          ? Effect.succeed(null)
          : Effect.fail(new PasswordVaultError({ cause })),
      ),
      Effect.tapError(logUnreadable("open")),
    );
    if (source === null) return null;
    if (source.length > MAX_VAULT_ENVELOPE_BYTES) return yield* unreadable();
    const envelope = yield* vaultDecode(() => Schema.decodeUnknownSync(envelopeSchema)(JSON.parse(source))).pipe(
      Effect.tapError(logUnreadable("envelope")),
      Effect.mapError(unreadable),
    );
    const text = yield* vaultDecode(() => this.#cipher.decrypt(Buffer.from(envelope.record, "base64"))).pipe(
      Effect.tapError(logUnreadable("decrypt")),
      Effect.mapError(unreadable),
    );
    return yield* vaultDecode(() => Schema.decodeUnknownSync(recordSchema)(JSON.parse(text))).pipe(
      Effect.tapError(logUnreadable("items")),
      Effect.mapError(unreadable),
    );
  });
}
