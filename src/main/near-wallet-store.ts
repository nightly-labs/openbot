import { readFile, rm } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Result, Semaphore } from "effect";
import { z } from "zod";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { NearOperationError, nearCall, nearDecode, nearFailure, toNearOperationError } from "./near-wallet-effects";
import type { SecretCipher } from "./provider-credential-store";

const ownerSchema = z.object({
  type: z.literal("passkey"),
  credential_id: z.string().regex(/^[A-Za-z0-9_-]+$/u),
  public_key: z.string().regex(/^MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE[A-Za-z0-9_-]{85}[AQgw]$/u),
  rp_id: z.string().min(1).max(253),
  origin: z.string().url(),
});

export type NearOwner = z.infer<typeof ownerSchema>;

const ownerBackupSchema = z.object({
  state: z.enum(["synced", "notSynced", "deviceOnly"]).nullable(),
  checkedAt: z.number(),
});

export type NearOwnerBackupRecord = z.infer<typeof ownerBackupSchema>;

const grantSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string(),
  grantId: z.string().nullable(),
  correlationId: z.string().nullable(),
  active: z.boolean(),
});

const walletSchema = z.object({
  agentId: z.string().regex(/^[0-9a-f]{64}$/u),
  accountId: z.string().nullable(),
  createCorrelationId: z.string().nullable(),
  dailyBudgetUsd: z.string(),
  ownerApproval: z.boolean(),
  frozen: z.boolean(),
  grant: grantSchema.nullable(),
  gatewayOwner: z.enum(["server", "personal"]).default("personal"),
});

const ruleSchema = z.object({
  domain: z.string().min(1),
  recipients: z.array(z.string().min(1)),
  dailyUsd: z.number(),
});

const paymentSchema = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u),
  kind: z.enum(["transfer", "withdraw"]),
  assetId: z.string().min(1),
  atomicAmount: z.string().regex(/^[1-9]\d*$/u),
  recipient: z.string().min(1),
  chain: z.string().nullable(),
  domain: z.string(),
  agentId: z.string(),
  amountCents: z.number().int().nonnegative().nullable(),
  createdAt: z.number(),
  correlationId: z.string().nullable(),
});

export type NearStoredPayment = z.infer<typeof paymentSchema>;

const recordSchema = z.object({
  owner: ownerSchema.nullable(),
  ownerBackup: ownerBackupSchema.nullable().default(null),
  wallet: walletSchema.nullable(),
  allAgents: z.boolean().default(false),
  agentIds: z.array(z.string()),
  rules: z.array(ruleSchema),
  spend: z.object({ day: z.string(), byDomainCents: z.record(z.string(), z.number().int().nonnegative()) }),
  payments: z.array(paymentSchema),
});

export type NearWalletRecord = z.infer<typeof recordSchema>;
export type NearWalletAccountRecord = z.infer<typeof walletSchema>;
export type NearGrantRecord = z.infer<typeof grantSchema>;

export const EMPTY_NEAR_WALLET_RECORD: NearWalletRecord = {
  owner: null,
  ownerBackup: null,
  wallet: null,
  allAgents: true,
  agentIds: [],
  rules: [],
  spend: { day: "", byDomainCents: {} },
  payments: [],
};

const envelopeSchema = z.object({ version: z.literal(1), record: z.string() });

const MAX_ENVELOPE_BYTES = 512 * 1024;

export function registerNearSecrets(record: NearWalletRecord): void {
  if (record.wallet?.grant) registerSecretValue(record.wallet.grant.token);
}

export class NearWalletStore {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #record: NearWalletRecord = EMPTY_NEAR_WALLET_RECORD;
  #unreadable: Error | null = null;
  readonly #queue = Semaphore.makeUnsafe(1);

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  readonly load = Effect.fn("NearWalletStore.load")(function* (this: NearWalletStore) {
    this.#record = EMPTY_NEAR_WALLET_RECORD;
    this.#unreadable = null;
    const result = yield* this.#readEffect().pipe(Effect.result);
    if (Result.isFailure(result)) {
      const error = result.failure.cause;
      this.#unreadable = error instanceof Error ? error : new Error(sourceText("error.connector.nearFileUnreadable"));
      return this.#unreadable;
    }
    if (result.success) {
      registerNearSecrets(result.success);
      this.#record = result.success;
    }
    return null;
  });

  read(): NearWalletRecord {
    return this.#record;
  }

  unreadable(): Error | null {
    return this.#unreadable;
  }

  readonly update = Effect.fn("NearWalletStore.update")(
    function* (this: NearWalletStore, change: (record: NearWalletRecord) => NearWalletRecord) {
      if (this.#unreadable) return yield* new NearOperationError({ cause: this.#unreadable });
      const next = yield* nearDecode(() => recordSchema.parse(change(this.#record)));
      registerNearSecrets(next);
      const encrypted = yield* nearDecode(() => this.#cipher.encrypt(JSON.stringify(next)).toString("base64"));
      yield* writeJsonFileAtomically(this.#path, { version: 1, record: encrypted }, { createDirectory: true }).pipe(
        toNearOperationError,
      );
      this.#record = next;
      return next;
    },
    (operation) => this.#queue.withPermit(operation).pipe(Effect.uninterruptible),
  );

  readonly clear = Effect.fn("NearWalletStore.clear")(
    function* (this: NearWalletStore) {
      yield* nearCall(() => rm(this.#path, { force: true }));
      this.#record = EMPTY_NEAR_WALLET_RECORD;
      this.#unreadable = null;
    },
    (operation) => this.#queue.withPermit(operation).pipe(Effect.uninterruptible),
  );

  readonly #readEffect = Effect.fn("NearWalletStore.read")(function* (
    this: NearWalletStore,
  ): Effect.fn.Return<NearWalletRecord | null, NearOperationError> {
    const result = yield* nearCall(() => readFile(this.#path, "utf8")).pipe(Effect.result);
    if (Result.isFailure(result)) {
      const error = result.failure.cause;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      return yield* result.failure;
    }
    const source = result.success;
    if (source.length > MAX_ENVELOPE_BYTES) return yield* nearFailure(sourceText("error.connector.nearFileTooLarge"));
    return yield* nearDecode(() => {
      const envelope = envelopeSchema.parse(JSON.parse(source));
      return recordSchema.parse(JSON.parse(this.#cipher.decrypt(Buffer.from(envelope.record, "base64"))));
    }).pipe(Effect.mapError(() => nearFailure(sourceText("error.connector.nearFileUnreadable"))));
  });
}
