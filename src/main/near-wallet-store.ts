// The NEAR Intents wallet of this computer: the partner key, the owner, the agent account, the payment
// grant of this app, the payment rules and the payments in flight. Encrypted at rest by the operating system.

import { readFile, rm } from "node:fs/promises";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Result, Semaphore } from "effect";
import { z } from "zod";
import { writeJsonFileAtomically } from "../backend/atomic-json-file";
import { NearOperationError, nearCall, nearDecode, nearFailure, toNearOperationError } from "./near-wallet-effects";
import type { SecretCipher } from "./provider-credential-store";

/** The owner wallet as the Agent API takes it. OpenBot offers a passkey or an EVM wallet. */
const ownerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("evm"),
    address: z.string().regex(/^0x[0-9a-f]{40}$/u),
    chain_id: z.number().int().positive(),
    public_key: z.string().regex(/^0x[0-9a-f]{128}$/u),
  }),
  z.object({
    type: z.literal("passkey"),
    credential_id: z.string().regex(/^[A-Za-z0-9_-]+$/u),
    public_key: z.string().regex(/^MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE[A-Za-z0-9_-]{85}[AQgw]$/u),
    rp_id: z.string().min(1).max(253),
    origin: z.string().url(),
  }),
]);

export type NearOwner = z.infer<typeof ownerSchema>;

const grantSchema = z.object({
  /** The `ngt_` token. Only main reads it; it goes to the Agent API in `X-Grant-Token` only. */
  token: z.string().min(1),
  /** ISO time. */
  expiresAt: z.string(),
  grantId: z.string().nullable(),
  /** The `grant_issue` intent, while it is not applied. */
  correlationId: z.string().nullable(),
  /** False until the Agent API reports the grant. */
  active: z.boolean(),
});

const walletSchema = z.object({
  /** The Agent API id of the agent account, 64 hex. Stored as soon as `agent_create` returns it. */
  agentId: z.string().regex(/^[0-9a-f]{64}$/u),
  accountId: z.string().nullable(),
  /** The `agent_create` intent, while the account is not active. */
  createCorrelationId: z.string().nullable(),
  dailyBudgetUsd: z.string(),
  ownerApproval: z.boolean(),
  frozen: z.boolean(),
  grant: grantSchema.nullable(),
});

const ruleSchema = z.object({
  domain: z.string().min(1),
  recipients: z.array(z.string().min(1)),
  dailyUsd: z.number(),
});

/**
 * A payment that was sent, or may have been sent, to the Agent API. It is written before the request
 * goes out, so a crash cannot send it a second time with a new idempotency key.
 */
const paymentSchema = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u),
  kind: z.enum(["transfer", "withdraw"]),
  assetId: z.string().min(1),
  /** Integer text in the smallest unit of the asset. */
  atomicAmount: z.string().regex(/^[1-9]\d*$/u),
  recipient: z.string().min(1),
  chain: z.string().nullable(),
  domain: z.string(),
  agentId: z.string(),
  amountCents: z.number().int().nonnegative().nullable(),
  /** Epoch milliseconds. */
  createdAt: z.number(),
  /** The Agent API execution, after the request was answered. */
  correlationId: z.string().nullable(),
});

export type NearStoredPayment = z.infer<typeof paymentSchema>;

const recordSchema = z.object({
  partnerKey: z.string().min(1).nullable(),
  owner: ownerSchema.nullable(),
  wallet: walletSchema.nullable(),
  /** The OpenBot agents that can ask to pay. */
  agentIds: z.array(z.string()),
  rules: z.array(ruleSchema),
  /** Cents paid today under each rule. `day` is the local date, `YYYY-MM-DD`. */
  spend: z.object({ day: z.string(), byDomainCents: z.record(z.string(), z.number().int().nonnegative()) }),
  payments: z.array(paymentSchema),
});

export type NearWalletRecord = z.infer<typeof recordSchema>;
export type NearWalletAccountRecord = z.infer<typeof walletSchema>;
export type NearGrantRecord = z.infer<typeof grantSchema>;

export const EMPTY_NEAR_WALLET_RECORD: NearWalletRecord = {
  partnerKey: null,
  owner: null,
  wallet: null,
  agentIds: [],
  rules: [],
  spend: { day: "", byDomainCents: {} },
  payments: [],
};

/** A version that this build cannot read is reported as unreadable. */
const envelopeSchema = z.object({ version: z.literal(1), record: z.string() });

/** 64 rules with 8 recipients each and the payments in flight stay far under this. */
const MAX_ENVELOPE_BYTES = 512 * 1024;

/** Registers each secret of the record for redaction before any code can log it. */
export function registerNearSecrets(record: NearWalletRecord): void {
  if (record.partnerKey) registerSecretValue(record.partnerKey);
  if (record.wallet?.grant) registerSecretValue(record.wallet.grant.token);
}

/**
 * Reads and writes the wallet record. The decrypted record is kept in memory only. Writes run one at
 * a time and are not interrupted, so a payment key is never half written.
 */
export class NearWalletStore {
  readonly #path: string;
  readonly #cipher: SecretCipher;
  #record: NearWalletRecord = EMPTY_NEAR_WALLET_RECORD;
  /** The file is there and cannot be read. Writes stop, so they cannot replace the agent account id. */
  #unreadable: Error | null = null;
  readonly #queue = Semaphore.makeUnsafe(1);

  constructor(path: string, cipher: SecretCipher) {
    this.#path = path;
    this.#cipher = cipher;
  }

  /**
   * Reads the file. Returns the error when the file is there but cannot be read. The file then stays,
   * so a later build or the owner can still recover the agent account id from it.
   */
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

  /** The read failure of `load`, until `clear` removes the file. */
  unreadable(): Error | null {
    return this.#unreadable;
  }

  /** Writes `change(current)`. The memory copy changes only after the file is written. */
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
