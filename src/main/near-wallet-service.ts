// The NEAR Intents wallet of this computer: the agent account on the NEAR Intents Agent API, the payment
// grant of this app, the owner's signatures, the payment rules, and the payments that agents ask for.

import { randomUUID } from "node:crypto";
import {
  type AgentApi,
  AgentApiError,
  type AgentApiOptions,
  AgentApiRequestError,
  AgentApiResponseTooLargeError,
  createAgentApi,
  createGrantCredential,
  type GenerateIntentRequest,
  type GenerateIntentResponse,
  type IntentType,
  type Policy,
  type PolicyView,
  type SignedData,
  type StatusResponse,
  type TokenView,
} from "@near-intents-agent-api/sdk";
import {
  NEAR_WALLET_LIMITS,
  type NearAllowPaymentInput,
  type NearBalance,
  type NearDepositAddress,
  type NearDepositAsset,
  type NearDepositInput,
  type NearOwnerAction,
  type NearPendingPayment,
  type NearRuleInput,
  type NearSigning,
  type NearWalletCreateInput,
  type NearWalletState,
  type NearWalletStatus,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText, registerSecretValue, toLogValue } from "@openbot/logging";
import { Duration, Effect, Exit, Result, Scope, Semaphore } from "effect";
import {
  type NearPaymentRequest,
  type NearPaymentResult,
  type NearWallet,
  NearWalletError,
} from "../backend/near-wallet";
import { type NearOperationError, nearCall, nearFailure, nearMessage } from "./near-wallet-effects";
import type { NearIntentToSign, NearOwnerSigning, NearSigningRequest } from "./near-wallet-signing";
import type { NearOwner, NearStoredPayment, NearWalletRecord, NearWalletStore } from "./near-wallet-store";

const logger = createOpenBotLogger("near-wallet");

/** The grant of this app. The Agent API checks the token on each payment; it is renewed in the panel. */
const GRANT_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;
/** A grant this close to its end is reported as expired, so a payment does not fail halfway. */
const GRANT_MARGIN_MS = 5 * 60_000;
/** The longest wait of one status request; the API allows 30 s. */
const STATUS_WAIT_MS = 25_000;
/** An owner intent that is not done after this is reported as pending. */
const INTENT_TIMEOUT_MS = 3 * 60_000;
/** A payment that is not done after this is reported as uncertain; it stays stored. */
const PAYMENT_TIMEOUT_MS = 5 * 60_000;
/** A policy change is applied and synced to the provider in this time. */
const POLICY_SYNC_TIMEOUT_MS = 3 * 60_000;
const POLICY_POLL_MS = 3_000;
/** Prices and the token list change slowly. */
const TOKEN_CACHE_MS = 60_000;
const BALANCE_CACHE_MS = 30_000;
/** A payment without an answer is sent again with its key only while the API surely keeps the key. */
const REPLAY_WINDOW_MS = 60 * 60_000;
/** Retries of a `retryable` Agent API answer, with the same idempotency key. */
const SEND_ATTEMPTS = 3;
/** Payments that wait for the owner at one time. */
const MAX_PREPARED = 32;
const MAX_ACTIONS_PER_HOUR = 20;
const AGENT_NAME = "OpenBot";

/** A NEAR account id: named (`bob.near`) or implicit (64 hex, or `0x` and 40 hex). */
const NEAR_ACCOUNT =
  /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$|^[0-9a-f]{64}$|^0x[0-9a-f]{40}$/u;
const CHAIN = /^[a-z][a-z0-9-]{1,31}$/u;
const CHAIN_ADDRESS = /^[A-Za-z0-9._-]{2,128}$/u;
const AMOUNT = /^(0|[1-9]\d*)(\.\d+)?$/u;

const TERMINAL_FAILURES = new Set(["FAILED", "REFUNDED"]);
const UNCLEAR = new Set(["UNCERTAIN", "NEEDS_REVIEW"]);

export interface NearWalletServiceOptions {
  store: NearWalletStore;
  signing: NearOwnerSigning;
  /** Development and tests only: another Agent API origin. HTTP is accepted for localhost only. */
  baseUrl?: string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
}

/** A payment that `prepare` checked. It waits for `pay` or `drop`. */
interface PreparedPayment {
  request: NearPaymentRequest;
  kind: "transfer" | "withdraw";
  chain: string | null;
  address: string;
  assetId: string;
  symbol: string;
  atomicAmount: string;
  amountCents: number | null;
  auto: boolean;
  /** Shown in the status while the owner decides. Null for a payment that a rule allows. */
  pending: NearPendingPayment | null;
}

/**
 * Owns the wallet. The partner key and the grant token stay in this class and the encrypted store:
 * no status, event, log or agent answer carries them. Agents reach the wallet only through `NearWallet`,
 * which checks each payment against the owner's agents, rules and limits.
 */
export class NearWalletService implements NearWallet {
  readonly #store: NearWalletStore;
  readonly #signing: NearOwnerSigning;
  readonly #baseUrl: string | undefined;
  readonly #fetch: typeof fetch | undefined;
  readonly #now: () => number;
  readonly #scope = Scope.makeUnsafe();
  readonly #listeners = new Set<(status: NearWalletStatus) => void>();
  /** Owner actions, one at a time: each can wait for a signature in the browser. */
  readonly #ownerQueue = Semaphore.makeUnsafe(1);
  readonly #prepared = new Map<string, PreparedPayment>();
  #signingState: NearSigning | null = null;
  #error: string | null = null;
  #balances: { at: number; list: NearBalance[]; raw: BalanceRow[] } | null = null;
  #tokens: { at: number; list: TokenView[] } | null = null;
  #policy: PolicyView | null = null;
  #disposed = false;

  constructor(options: NearWalletServiceOptions) {
    this.#store = options.store;
    this.#signing = options.signing;
    this.#baseUrl = options.baseUrl;
    this.#fetch = options.fetch;
    this.#now = options.now ?? Date.now;
  }

  /** Reads the record, then reads the account and finishes stored payments in the background. */
  readonly load = Effect.fn("NearWallet.load")(function* (this: NearWalletService) {
    const error = yield* this.#store.load();
    if (error) {
      logger.warn("The NEAR wallet file could not be read.", { cause: toLogValue(error) });
      this.#error = sourceText("error.connector.nearFileUnreadable");
    }
    if (this.#store.read().wallet) yield* Effect.forkIn(this.#background(this.#startup()), this.#scope);
  }).bind(this);

  status(): NearWalletStatus {
    const record = this.#store.read();
    const wallet = record.wallet;
    const owner = record.owner;
    const today = this.#today();
    const spend = record.spend.day === today ? record.spend.byDomainCents : {};
    return {
      state: this.#state(),
      account:
        wallet?.accountId && owner && wallet.grant?.active
          ? {
              accountId: wallet.accountId,
              ownerMethod: owner.type,
              ownerApproval: wallet.ownerApproval,
              dailyBudgetUsd: wallet.dailyBudgetUsd,
              spentTodayUsd: this.#policy?.usage.budget.daily.spent_usd ?? null,
              policyChangeAvailableAt: this.#policy?.cooldowns.policy_change_available_at ?? null,
              grantExpiresAt: this.#grantValid(record) ? (wallet.grant?.expiresAt ?? null) : null,
            }
          : null,
      balances: this.#balances?.list ?? [],
      depositAssets: depositAssets(this.#tokens?.list ?? []),
      agentIds: record.agentIds,
      rules: record.rules.map((rule) => ({ ...rule, spentTodayUsd: (spend[rule.domain] ?? 0) / 100 })),
      payments: [...this.#prepared.values()].flatMap((payment) => (payment.pending ? [payment.pending] : [])),
      signing: this.#signingState,
      error: this.#error,
    };
  }

  onChanged(listener: (status: NearWalletStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  ready(): boolean {
    return this.#state() === "ready" && this.#grantValid(this.#store.read());
  }

  /** Reads the balances, the policy and the token list again. A failure is shown, not thrown. */
  readonly refresh = Effect.fn("NearWallet.refresh")(function* (this: NearWalletService) {
    yield* this.#background(this.#refresh(true));
    return this.status();
  }).bind(this);

  /** Checks a partner key with the Agent API, then stores it. Only main sees it. */
  readonly setKey = Effect.fn("NearWallet.setKey")(function* (this: NearWalletService, key: string) {
    registerSecretValue(key);
    return yield* this.#ownerStep(
      Effect.gen({ self: this }, function* () {
        if (this.#store.read().wallet) return yield* nearFailure(sourceText("error.connector.nearWalletExists"));
        yield* nearCall((signal) => this.#client(key).whoami({ signal }));
        yield* this.#store.update((record) => ({ ...record, partnerKey: key }));
      }),
    );
  }).bind(this);

  /**
   * Sets the wallet up: the owner's passkey or EVM wallet, the agent account with its policy, and the
   * grant of this app. Each step is stored as soon as the Agent API gives it, so a restart continues
   * and never makes a second account. Runs in the background; the status reports each signature.
   */
  readonly create = Effect.fn("NearWallet.create")(function* (this: NearWalletService, input: NearWalletCreateInput) {
    if (this.#disposed) return this.status();
    const record = this.#store.read();
    if (!record.partnerKey) {
      this.#error = sourceText("error.connector.nearNoKey");
      this.#emitStatus();
      return this.status();
    }
    if (record.wallet?.grant?.active) {
      this.#error = sourceText("error.connector.nearWalletExists");
      this.#emitStatus();
      return this.status();
    }
    yield* Effect.forkIn(this.#ownerStep(this.#create(input)), this.#scope);
    return this.status();
  }).bind(this);

  /** Changes the daily budget that the Agent API keeps. The owner signs it. */
  readonly setBudget = Effect.fn("NearWallet.setBudget")(function* (this: NearWalletService, dailyBudgetUsd: string) {
    return yield* this.#ownerStep(
      Effect.gen({ self: this }, function* () {
        const wallet = yield* this.#activeWallet();
        yield* this.#updatePolicy(
          "budget",
          (policy) => ({ ...policy, budget: { ...policy.budget, daily_usd: dailyBudgetUsd } }),
          sourceText("status.agent.nearSummaryBudget", { amount: dailyBudgetUsd }),
        );
        yield* this.#store.update((current) =>
          current.wallet?.agentId === wallet.agentId
            ? { ...current, wallet: { ...current.wallet, dailyBudgetUsd } }
            : current,
        );
      }),
    );
  }).bind(this);

  /** The OpenBot agents that can ask to pay. Kept on this computer only, so no signature is needed. */
  readonly setAgents = Effect.fn("NearWallet.setAgents")(function* (this: NearWalletService, agentIds: string[]) {
    return yield* this.#ownerStep(this.#store.update((record) => ({ ...record, agentIds })));
  }).bind(this);

  /** Issues a new 30-day grant. The old one ends at its own time. */
  readonly renewGrant = Effect.fn("NearWallet.renewGrant")(function* (this: NearWalletService) {
    return yield* this.#ownerStep(
      Effect.gen({ self: this }, function* () {
        yield* this.#activeWallet();
        yield* this.#issueGrant(true);
      }),
    );
  }).bind(this);

  /**
   * Stops all payments. This computer stops at once; then the owner signs the freeze, so the Agent API
   * also refuses the grant. A signature that fails leaves the local freeze in place.
   */
  readonly freeze = Effect.fn("NearWallet.freeze")(function* (this: NearWalletService) {
    const wallet = this.#store.read().wallet;
    if (!wallet) return this.status();
    const frozen = yield* this.#store
      .update((record) => (record.wallet ? { ...record, wallet: { ...record.wallet, frozen: true } } : record))
      .pipe(Effect.result);
    if (Result.isFailure(frozen)) {
      this.#error = redactText(nearMessage(frozen.failure));
      this.#emitStatus();
      return this.status();
    }
    this.#emitStatus();
    return yield* this.#ownerStep(
      Effect.gen({ self: this }, function* () {
        const intent = yield* this.#generate({ type: "agent_freeze", agent_id: wallet.agentId });
        yield* this.#signAndSubmit("freeze", intent, wallet.accountId ?? wallet.agentId, null);
      }),
    );
  }).bind(this);

  /** The owner signs the unfreeze first; this computer pays again only after the Agent API applied it. */
  readonly unfreeze = Effect.fn("NearWallet.unfreeze")(function* (this: NearWalletService) {
    return yield* this.#ownerStep(
      Effect.gen({ self: this }, function* () {
        const wallet = this.#store.read().wallet;
        if (!wallet) return yield* nearFailure(sourceText("error.connector.nearNoWallet"));
        const intent = yield* this.#generate({ type: "agent_unfreeze", agent_id: wallet.agentId });
        yield* this.#signAndSubmit("unfreeze", intent, wallet.accountId ?? wallet.agentId, null);
        yield* this.#store.update((record) =>
          record.wallet ? { ...record, wallet: { ...record.wallet, frozen: false } } : record,
        );
      }),
    );
  }).bind(this);

  /** A deposit address for one asset. The funds arrive in the agent account. */
  readonly deposit = Effect.fn("NearWallet.deposit")(
    function* (this: NearWalletService, input: NearDepositInput) {
      const wallet = yield* this.#activeWallet();
      const api = yield* this.#grantClient();
      const answer = yield* nearCall((signal) =>
        api.deposit(wallet.agentId, { origin_asset: input.assetId }, { idempotencyKey: newKey(), signal }),
      );
      const details = answer.details;
      const address = typeof details.deposit_address === "string" ? details.deposit_address : null;
      if (!address) return yield* nearFailure(sourceText("error.connector.nearUnexpected", { detail: "deposit" }));
      return {
        address,
        memo: details.memo ?? null,
        minAmount: details.min_amount ?? null,
        expiresAt: details.expires_at ?? null,
      } satisfies NearDepositAddress;
    },
    (operation) => operation.pipe(Effect.mapError((error) => nearFailure(redactText(failureText(error.cause))))),
  ).bind(this);

  /**
   * Saves a payment rule. The first rule turns off the owner's signature for each payment: the owner
   * signs that once, and OpenBot then checks the rules and the daily limits itself.
   */
  readonly saveRule = Effect.fn("NearWallet.saveRule")(function* (this: NearWalletService, input: NearRuleInput) {
    return yield* this.#ownerStep(
      Effect.gen({ self: this }, function* () {
        const record = this.#store.read();
        if (
          !record.rules.some((rule) => rule.domain === input.domain) &&
          record.rules.length >= NEAR_WALLET_LIMITS.rules
        )
          return yield* nearFailure(sourceText("error.connector.nearRulesFull", { limit: NEAR_WALLET_LIMITS.rules }));
        yield* this.#activeWallet();
        yield* this.#allowAutoPay();
        yield* this.#store.update((current) => ({
          ...current,
          rules: [...current.rules.filter((rule) => rule.domain !== input.domain), input],
        }));
      }),
    );
  }).bind(this);

  readonly removeRule = Effect.fn("NearWallet.removeRule")(function* (this: NearWalletService, domain: string) {
    return yield* this.#ownerStep(
      this.#store.update((record) => ({ ...record, rules: record.rules.filter((rule) => rule.domain !== domain) })),
    );
  }).bind(this);

  /**
   * "Always allow" on a payment card: the recipient of the waiting payment is added to the rule of its
   * domain, with the daily limit that the owner chose. The renderer then approves the payment.
   */
  readonly allowPayment = Effect.fn("NearWallet.allowPayment")(function* (
    this: NearWalletService,
    input: NearAllowPaymentInput,
  ) {
    return yield* this.#ownerStep(
      Effect.gen({ self: this }, function* () {
        const payment = this.#prepared.get(input.requestId);
        if (!payment?.pending) return yield* nearFailure(sourceText("error.connector.nearPaymentUnknown"));
        const { domain } = payment.request;
        const recipient = payment.request.recipient;
        const record = this.#store.read();
        const rule = record.rules.find((candidate) => candidate.domain === domain);
        if (!rule && record.rules.length >= NEAR_WALLET_LIMITS.rules)
          return yield* nearFailure(sourceText("error.connector.nearRulesFull", { limit: NEAR_WALLET_LIMITS.rules }));
        const recipients = rule?.recipients.includes(recipient)
          ? rule.recipients
          : [...(rule?.recipients ?? []), recipient];
        if (recipients.length > NEAR_WALLET_LIMITS.recipientsPerRule)
          return yield* nearFailure(
            sourceText("error.connector.nearRuleFull", { limit: NEAR_WALLET_LIMITS.recipientsPerRule }),
          );
        yield* this.#allowAutoPay();
        yield* this.#store.update((current) => ({
          ...current,
          rules: [
            ...current.rules.filter((candidate) => candidate.domain !== domain),
            { domain, recipients, dailyUsd: input.dailyUsd },
          ],
        }));
      }),
    );
  }).bind(this);

  /** Opens the signing page again, when the owner closed the tab. */
  readonly openSigning = Effect.fn("NearWallet.openSigning")(function* (this: NearWalletService) {
    yield* nearCall(() => this.#signing.reopen()).pipe(
      Effect.catch(({ cause }) =>
        Effect.sync(() => logger.warn("The NEAR signing page could not be opened.", { cause: toLogValue(cause) })),
      ),
    );
  }).bind(this);

  cancelSigning(): NearWalletStatus {
    this.#signing.cancel();
    return this.status();
  }

  /** The result of the signing page, from an `openbot://near-signature` link or the dev loopback. */
  receiveSignature(nonce: string, data: string): boolean {
    return this.#signing.receive(nonce, data);
  }

  /**
   * Forgets the wallet on this computer. The agent account and its funds stay on the Agent API; the
   * grant ends at its own time. Waiting payments are dropped.
   */
  readonly disconnect = Effect.fn("NearWallet.disconnect")(function* (this: NearWalletService) {
    this.#signing.cancel();
    return yield* this.#ownerStep(
      Effect.gen({ self: this }, function* () {
        yield* this.#store.clear();
        this.#prepared.clear();
        this.#balances = null;
        this.#policy = null;
      }),
    );
  }).bind(this);

  readonly dispose = Effect.fn("NearWallet.dispose")(function* (this: NearWalletService) {
    this.#disposed = true;
    this.#listeners.clear();
    yield* Effect.promise(() => this.#signing.dispose());
    yield* Scope.close(this.#scope, Exit.void);
  }).bind(this);

  readonly prepare = Effect.fn("NearWallet.prepare")(
    function* (this: NearWalletService, request: NearPaymentRequest) {
      const record = this.#store.read();
      const wallet = record.wallet;
      if (!wallet?.grant?.active) return yield* nearFailure(sourceText("error.connector.nearNoWallet"));
      if (wallet.frozen) return yield* nearFailure(sourceText("error.connector.nearFrozen"));
      if (!this.#grantValid(record)) return yield* nearFailure(sourceText("error.connector.nearGrantExpired"));
      if (!record.agentIds.includes(request.agentId))
        return yield* nearFailure(sourceText("error.connector.nearAgentNotAllowed"));
      if (this.#prepared.has(request.requestId) || this.#prepared.size >= MAX_PREPARED)
        return yield* nearFailure(sourceText("error.connector.nearSigningBusy"));
      const target = parseRecipient(request.recipient);
      if (!target)
        return yield* nearFailure(sourceText("error.connector.nearRecipientInvalid", { recipient: request.recipient }));
      yield* this.#refresh(false);
      const balance = findAsset(this.#balances?.raw ?? [], request.asset, request.amount);
      if (!balance) return yield* nearFailure(sourceText("error.connector.nearUnknownAsset", { asset: request.asset }));
      const token = (this.#tokens?.list ?? []).find((candidate) => candidate.asset_id === balance.asset_id);
      const decimals = balance.decimals ?? token?.decimals ?? null;
      const atomicAmount = decimals === null ? null : toAtomic(request.amount, decimals);
      if (!atomicAmount)
        return yield* nearFailure(
          sourceText("error.connector.nearAmountInvalid", { amount: request.amount, asset: request.asset }),
        );
      const price = token?.price ?? balance.price ?? null;
      const amountCents = price === null ? null : usdCents(request.amount, price);
      const rule = record.rules.find((candidate) => candidate.domain === request.domain);
      const known = rule?.recipients.includes(request.recipient) === true;
      const withinLimit =
        rule !== undefined &&
        amountCents !== null &&
        this.#spentCents(record, rule.domain) + amountCents <= rule.dailyUsd * 100;
      const auto = known && withinLimit && !wallet.ownerApproval;
      const symbol = balance.symbol ?? token?.symbol ?? balance.asset_id;
      const pending: NearPendingPayment | null = auto
        ? null
        : {
            requestId: request.requestId,
            threadId: request.threadId,
            agentId: request.agentId,
            domain: request.domain,
            recipient: request.recipient,
            amount: request.amount,
            symbol,
            amountUsd: amountCents === null ? null : amountCents / 100,
            reason: request.reason,
            overLimit: known && !withinLimit,
          };
      this.#prepared.set(request.requestId, {
        request,
        kind: target.chain ? "withdraw" : "transfer",
        chain: target.chain,
        address: target.address,
        assetId: balance.asset_id,
        symbol,
        atomicAmount,
        amountCents,
        auto,
        pending,
      });
      if (pending) this.#emitStatus();
      return auto ? ({ kind: "auto" } as const) : ({ kind: "ask", amount: request.amount, symbol } as const);
    },
    (operation) => operation.pipe(Effect.mapError(walletError)),
  ).bind(this);

  drop(requestId: string): void {
    if (this.#prepared.delete(requestId)) this.#emitStatus();
  }

  readonly pay = Effect.fn("NearWallet.pay")(
    function* (this: NearWalletService, requestId: string): Effect.fn.Return<NearPaymentResult, NearOperationError> {
      const payment = this.#prepared.get(requestId);
      if (!payment) return yield* nearFailure(sourceText("error.connector.nearPaymentUnknown"));
      this.#prepared.delete(requestId);
      if (payment.pending) this.#emitStatus();
      const record = this.#store.read();
      const wallet = record.wallet;
      if (!wallet?.grant?.active) return yield* nearFailure(sourceText("error.connector.nearNoWallet"));
      if (wallet.frozen) return yield* nearFailure(sourceText("error.connector.nearFrozen"));
      if (!this.#grantValid(record)) return yield* nearFailure(sourceText("error.connector.nearGrantExpired"));
      const rule = record.rules.find((candidate) => candidate.domain === payment.request.domain);
      // A rule payment is checked again: another payment can have used the limit in the meantime.
      if (
        payment.auto &&
        (!rule ||
          payment.amountCents === null ||
          this.#spentCents(record, rule.domain) + payment.amountCents > rule.dailyUsd * 100)
      )
        return { status: "declined", correlationId: null, detail: sourceText("error.connector.nearDeclined") };
      const stored: NearStoredPayment = {
        idempotencyKey: newKey(),
        kind: payment.kind,
        assetId: payment.assetId,
        atomicAmount: payment.atomicAmount,
        recipient: payment.address,
        chain: payment.chain,
        domain: payment.request.domain,
        agentId: payment.request.agentId,
        amountCents: rule ? payment.amountCents : null,
        createdAt: this.#now(),
        correlationId: null,
      };
      const sent = yield* this.#dispatch(wallet.agentId, stored);
      if (sent.status !== "sent") return sent.result;
      const summary = sourceText("status.agent.nearSummaryPayment", {
        amount: `${payment.request.amount} ${payment.symbol}`,
        recipient: payment.request.recipient,
      });
      const result = yield* this.#follow(wallet.agentId, stored, sent.correlationId, PAYMENT_TIMEOUT_MS, summary);
      yield* this.#background(this.#refresh(true));
      return result;
    },
    (operation) => operation.pipe(Effect.mapError(walletError)),
  ).bind(this);

  // --- Setup -------------------------------------------------------------------------------------

  readonly #create = Effect.fn("NearWallet.createSteps")(function* (
    this: NearWalletService,
    input: NearWalletCreateInput,
  ) {
    let record = this.#store.read();
    if (!record.owner || (record.owner.type !== input.ownerMethod && !record.wallet)) {
      const result = yield* this.#sign(
        { kind: "register", method: input.ownerMethod, action: "register", summary: "" },
        input.ownerMethod,
        null,
        null,
      );
      if (result.kind !== "owner") return yield* nearFailure(sourceText("error.connector.nearSigningInvalid"));
      record = yield* this.#store.update((current) => ({ ...current, owner: result.owner, agentIds: input.agentIds }));
    } else {
      record = yield* this.#store.update((current) => ({ ...current, agentIds: input.agentIds }));
    }
    const owner = record.owner;
    if (!owner) return yield* nearFailure(sourceText("error.connector.nearSigningInvalid"));
    yield* this.#createAccount(owner, input.dailyBudgetUsd);
    yield* this.#issueGrant(false);
    yield* this.#refresh(true);
  });

  /** Makes the agent account, or continues the one that the record names. */
  readonly #createAccount = Effect.fn("NearWallet.createAccount")(function* (
    this: NearWalletService,
    owner: NearOwner,
    dailyBudgetUsd: string,
  ): Effect.fn.Return<void, NearOperationError> {
    const api = yield* this.#partnerClient();
    const stored = this.#store.read().wallet;
    if (stored) {
      const agent = yield* nearCall((signal) => api.getAgent(stored.agentId, { signal }));
      if (agent.status === "ACTIVE" && agent.wallet) {
        const accountId = agent.wallet.near_account_id;
        yield* this.#store.update((record) =>
          record.wallet ? { ...record, wallet: { ...record.wallet, accountId, createCorrelationId: null } } : record,
        );
        return;
      }
      if (agent.status === "PENDING" && stored.createCorrelationId) {
        const status = yield* this.#waitIntent(stored.createCorrelationId);
        if (status === "SUCCESS") return yield* this.#createAccount(owner, dailyBudgetUsd);
      }
      // The account was never made: it can be made again.
      yield* this.#store.update((record) => ({ ...record, wallet: null }));
    }
    const intent = yield* this.#generate({
      type: "agent_create",
      name: AGENT_NAME,
      owner,
      policy: createPolicy(dailyBudgetUsd),
    });
    yield* this.#store.update((record) => ({
      ...record,
      wallet: {
        agentId: intent.agent_id,
        accountId: null,
        createCorrelationId: intent.correlation_id,
        dailyBudgetUsd,
        ownerApproval: true,
        frozen: false,
        grant: null,
      },
    }));
    const signed = yield* this.#signIntent(
      "create",
      intent,
      sourceText("status.agent.nearSummaryCreate", { amount: dailyBudgetUsd }),
      null,
    ).pipe(Effect.result);
    if (Result.isFailure(signed)) {
      // Nothing was submitted, so no account exists. A new setup starts from the beginning.
      yield* this.#store.update((record) => ({ ...record, wallet: null }));
      return yield* signed.failure;
    }
    yield* this.#submit(intent, signed.success);
    const agent = yield* nearCall((signal) => api.getAgent(intent.agent_id, { signal }));
    const accountId = agent.wallet?.near_account_id ?? null;
    if (!accountId) return yield* nearFailure(sourceText("error.connector.nearPolicyPending"));
    yield* this.#store.update((record) =>
      record.wallet ? { ...record, wallet: { ...record.wallet, accountId, createCorrelationId: null } } : record,
    );
  });

  /**
   * Issues the grant of this app. The token is stored before the owner signs, so a grant that the Agent
   * API applies always has its token on this computer.
   */
  readonly #issueGrant = Effect.fn("NearWallet.issueGrant")(function* (this: NearWalletService, renew: boolean) {
    const wallet = this.#store.read().wallet;
    if (!wallet) return yield* nearFailure(sourceText("error.connector.nearNoWallet"));
    const current = wallet.grant;
    if (!renew && current?.active) return;
    if (!renew && current && !current.active && current.correlationId) {
      const status = yield* this.#waitIntent(current.correlationId).pipe(Effect.orElseSucceed(() => "FAILED"));
      if (status === "SUCCESS") return yield* this.#activateGrant(current.correlationId, current.token);
    }
    const credential = createGrantCredential();
    registerSecretValue(credential.token);
    const expiresAt = new Date(this.#now() + GRANT_DAYS * DAY_MS).toISOString();
    const intent = yield* this.#generate({
      type: "grant_issue",
      agent_id: wallet.agentId,
      label: AGENT_NAME,
      credential: credential.commitment,
      expires_at: expiresAt,
    });
    const grant = {
      token: credential.token,
      expiresAt,
      grantId: null,
      correlationId: intent.correlation_id,
      active: false,
    };
    // A renewal keeps the grant in force until the new one is applied.
    if (!current?.active)
      yield* this.#store.update((record) =>
        record.wallet ? { ...record, wallet: { ...record.wallet, grant } } : record,
      );
    yield* this.#signAndSubmit(
      "grant",
      intent,
      sourceText("status.agent.nearSummaryGrant", { days: GRANT_DAYS }),
      null,
    );
    yield* this.#activateGrant(intent.correlation_id, credential.token, expiresAt);
  });

  readonly #activateGrant = Effect.fn("NearWallet.activateGrant")(function* (
    this: NearWalletService,
    correlationId: string,
    token: string,
    expiresAt?: string,
  ) {
    const api = yield* this.#partnerClient();
    const status = yield* nearCall((signal) => api.getStatus(correlationId, { signal }));
    const grant = status.type === "grant_issue" ? status.details.grant : null;
    yield* this.#store.update((record) =>
      record.wallet
        ? {
            ...record,
            wallet: {
              ...record.wallet,
              grant: {
                token,
                expiresAt:
                  grant?.expires_at ??
                  expiresAt ??
                  record.wallet.grant?.expiresAt ??
                  new Date(this.#now()).toISOString(),
                grantId: grant?.grant_id ?? null,
                correlationId: null,
                active: true,
              },
            },
          }
        : record,
    );
  });

  // --- Policy ------------------------------------------------------------------------------------

  /** Turns off the owner's signature for each payment, once. Rules then decide what pays without asking. */
  readonly #allowAutoPay = Effect.fn("NearWallet.allowAutoPay")(function* (this: NearWalletService) {
    if (!this.#store.read().wallet?.ownerApproval) return;
    yield* this.#updatePolicy(
      "auto-pay",
      (policy) => ({ ...policy, owner_approval: false }),
      sourceText("status.agent.nearSummaryAutoPay"),
    );
    yield* this.#store.update((record) =>
      record.wallet ? { ...record, wallet: { ...record.wallet, ownerApproval: false } } : record,
    );
  });

  /** A signed policy change. It waits until the Agent API applied it and synced it to the provider. */
  readonly #updatePolicy = Effect.fn("NearWallet.updatePolicy")(function* (
    this: NearWalletService,
    action: "budget" | "auto-pay",
    change: (policy: Policy) => Policy,
    summary: string,
  ) {
    const wallet = yield* this.#activeWallet();
    const api = yield* this.#partnerClient();
    const view = yield* nearCall((signal) => api.getPolicy(wallet.agentId, { signal }));
    this.#policy = view;
    const availableAt = view.cooldowns.policy_change_available_at;
    if (availableAt && Date.parse(availableAt) > this.#now())
      return yield* nearFailure(sourceText("error.connector.nearPolicyCooldown", { time: availableAt }));
    if (!view.policy || view.revision === null || view.status === "SIGNED")
      return yield* nearFailure(sourceText("error.connector.nearPolicyPending"));
    const intent = yield* this.#generate({
      type: "policy_update",
      agent_id: wallet.agentId,
      policy: change(view.policy),
      expected_revision: view.revision,
    });
    yield* this.#signAndSubmit(action, intent, summary, null);
    const deadline = this.#now() + POLICY_SYNC_TIMEOUT_MS;
    while (this.#now() < deadline) {
      const next = yield* nearCall((signal) => api.getPolicy(wallet.agentId, { signal }));
      this.#policy = next;
      if (next.status === "APPLIED" && next.provider_policy_synced && next.revision !== view.revision) return;
      if (next.status === "FAILED")
        return yield* nearFailure(sourceText("error.connector.nearRefused", { detail: "policy" }));
      yield* Effect.sleep(Duration.millis(POLICY_POLL_MS));
    }
    return yield* nearFailure(sourceText("error.connector.nearPolicyPending"));
  });

  // --- Owner intents -----------------------------------------------------------------------------

  #generate<Type extends IntentType>(
    request: Extract<GenerateIntentRequest, { type: Type }>,
  ): Effect.Effect<GenerateIntentResponse, NearOperationError> {
    return Effect.gen({ self: this }, function* () {
      const api = yield* this.#partnerClient();
      return yield* nearCall((signal) => api.generateIntent<Type>(request, { idempotencyKey: newKey(), signal }));
    });
  }

  readonly #signAndSubmit = Effect.fn("NearWallet.signAndSubmit")(function* (
    this: NearWalletService,
    action: Exclude<NearOwnerAction, "register">,
    intent: GenerateIntentResponse,
    summary: string,
    requestId: string | null,
  ) {
    const signed = yield* this.#signIntent(action, intent, summary, requestId);
    yield* this.#submit(intent, signed);
  });

  /** The owner signs the intent in the browser. Returns the `signed_data` for the Agent API. */
  readonly #signIntent = Effect.fn("NearWallet.signIntent")(function* (
    this: NearWalletService,
    action: Exclude<NearOwnerAction, "register">,
    intent: GenerateIntentResponse,
    summary: string,
    requestId: string | null,
  ): Effect.fn.Return<SignedData, NearOperationError> {
    const owner = this.#store.read().owner;
    if (!owner) return yield* nearFailure(sourceText("error.connector.nearNoWallet"));
    const toSign = intentToSign(intent);
    if (!toSign)
      return yield* nearFailure(sourceText("error.connector.nearUnexpected", { detail: intent.intent.standard }));
    const result = yield* this.#sign({ kind: "sign", action, summary, intent: toSign }, owner.type, owner, requestId);
    if (result.kind === "eip712" && intent.intent.standard === "eip712")
      return { standard: "eip712", payload: intent.intent.payload, signature: result.signature };
    if (result.kind === "webauthn" && intent.intent.standard === "webauthn")
      return { standard: "webauthn", payload: intent.intent.payload, credential: result.credential };
    return yield* nearFailure(sourceText("error.connector.nearSigningInvalid"));
  });

  /** Opens the signing page and waits. The status names the action while the page waits. */
  readonly #sign = Effect.fn("NearWallet.sign")(function* (
    this: NearWalletService,
    request: NearSigningRequest,
    method: NearOwner["type"],
    owner: NearOwner | null,
    requestId: string | null,
  ) {
    this.#signingState = { action: request.action, requestId };
    this.#emitStatus();
    return yield* nearCall(() => this.#signing.sign(request, method, owner)).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#signingState = null;
          this.#emitStatus();
        }),
      ),
    );
  });

  readonly #submit = Effect.fn("NearWallet.submit")(function* (
    this: NearWalletService,
    intent: GenerateIntentResponse,
    signed: SignedData,
  ) {
    const api = yield* this.#partnerClient();
    yield* nearCall((signal) =>
      api.submitIntent({ type: intent.type, correlation_id: intent.correlation_id, signed_data: signed }, { signal }),
    );
    const status = yield* this.#waitIntent(intent.correlation_id);
    if (status !== "SUCCESS") return yield* nearFailure(sourceText("error.connector.nearPolicyPending"));
  });

  /** Waits for an owner intent. Gives the last status; a failure is an error with its code. */
  readonly #waitIntent = Effect.fn("NearWallet.waitIntent")(function* (this: NearWalletService, correlationId: string) {
    const api = yield* this.#partnerClient();
    const deadline = this.#now() + INTENT_TIMEOUT_MS;
    let status: StatusResponse | null = null;
    while (this.#now() < deadline) {
      status = yield* nearCall((signal) => api.getStatus(correlationId, { waitMs: STATUS_WAIT_MS, signal }));
      if (status.status === "SUCCESS") return status.status;
      if (TERMINAL_FAILURES.has(status.status) || UNCLEAR.has(status.status))
        return yield* nearFailure(
          sourceText("error.connector.nearRefused", { detail: status.failure_code ?? status.status }),
        );
      if (status.status === "PENDING_SIGNATURE" && Date.parse(status.updated_at) + INTENT_TIMEOUT_MS < this.#now())
        return status.status;
    }
    return status?.status ?? "PENDING_SIGNATURE";
  });

  // --- Payments ----------------------------------------------------------------------------------

  /**
   * Stores the payment with its idempotency key, then sends it. A refusal removes it; a lost answer
   * keeps it, so a later try uses the same key and the payment is never made twice. Not interrupted.
   */
  readonly #dispatch = Effect.fn("NearWallet.dispatch")(function* (
    this: NearWalletService,
    agentId: string,
    payment: NearStoredPayment,
  ) {
    const today = this.#today();
    yield* this.#store.update((record) => {
      const byDomainCents = record.spend.day === today ? record.spend.byDomainCents : {};
      return {
        ...record,
        payments: [...record.payments, payment],
        spend: {
          day: today,
          byDomainCents:
            payment.amountCents === null
              ? byDomainCents
              : { ...byDomainCents, [payment.domain]: (byDomainCents[payment.domain] ?? 0) + payment.amountCents },
        },
      };
    });
    let attempt = 0;
    while (true) {
      attempt += 1;
      const sent = yield* this.#send(agentId, payment).pipe(Effect.result);
      if (Result.isSuccess(sent)) {
        yield* this.#updatePayment(payment.idempotencyKey, { correlationId: sent.success });
        return { status: "sent" as const, correlationId: sent.success };
      }
      const cause = sent.failure.cause;
      if (cause instanceof AgentApiError && !cause.retryable) {
        // A proven refusal: nothing was sent, so the key and the counted spend go.
        yield* this.#removePayment(payment, true);
        return {
          status: "done" as const,
          result: {
            status: "failed",
            correlationId: null,
            detail: sourceText("error.connector.nearPaymentFailed", { detail: apiDetail(cause) }),
          } satisfies NearPaymentResult,
        };
      }
      if (cause instanceof AgentApiError && attempt < SEND_ATTEMPTS) {
        yield* Effect.sleep(Duration.seconds(Math.min(cause.retryAfterSeconds ?? attempt * 2, 10)));
        continue;
      }
      logger.warn("A NEAR payment has no answer; it stays stored.", { cause: toLogValue(cause) });
      return {
        status: "done" as const,
        result: {
          status: "uncertain",
          correlationId: null,
          detail: sourceText("error.connector.nearUncertain"),
        } satisfies NearPaymentResult,
      };
    }
  }, Effect.uninterruptible);

  #send(agentId: string, payment: NearStoredPayment): Effect.Effect<string, NearOperationError> {
    return Effect.gen({ self: this }, function* () {
      const api = yield* this.#grantClient();
      const options = { idempotencyKey: payment.idempotencyKey };
      const answer =
        payment.kind === "withdraw"
          ? yield* nearCall(() =>
              api.withdraw(
                agentId,
                {
                  asset: payment.assetId,
                  amount: payment.atomicAmount,
                  chain: payment.chain ?? "",
                  recipient: payment.recipient,
                },
                options,
              ),
            )
          : yield* nearCall(() =>
              api.transfer(
                agentId,
                { asset: payment.assetId, amount: payment.atomicAmount, recipient: payment.recipient },
                options,
              ),
            );
      return answer.correlation_id;
    });
  }

  /**
   * Waits for a sent payment. A payment that needs the owner's vote is signed in the browser. A final
   * answer removes the stored payment; no answer keeps it for the next start.
   */
  readonly #follow = Effect.fn("NearWallet.follow")(function* (
    this: NearWalletService,
    agentId: string,
    payment: NearStoredPayment,
    correlationId: string,
    timeoutMs: number,
    /** The text of the owner's vote, or null when no signing page may open (a restart). */
    voteSummary: string | null,
  ): Effect.fn.Return<NearPaymentResult, NearOperationError> {
    const api = yield* this.#partnerClient();
    const deadline = this.#now() + timeoutMs;
    let voted = false;
    while (this.#now() < deadline) {
      const read = yield* nearCall((signal) => api.getStatus(correlationId, { waitMs: STATUS_WAIT_MS, signal })).pipe(
        Effect.result,
      );
      if (Result.isFailure(read)) {
        const cause = read.failure.cause;
        if (cause instanceof AgentApiError && !cause.retryable) break;
        yield* Effect.sleep(Duration.millis(POLICY_POLL_MS));
        continue;
      }
      const status = read.success;
      if (status.status === "SUCCESS") {
        yield* this.#removePayment(payment, false);
        return { status: "paid", correlationId, detail: null };
      }
      if (TERMINAL_FAILURES.has(status.status)) {
        yield* this.#removePayment(payment, false);
        return {
          status: "failed",
          correlationId,
          detail: sourceText("error.connector.nearPaymentFailed", { detail: status.failure_code ?? status.status }),
        };
      }
      if (UNCLEAR.has(status.status)) break;
      if (status.status === "PENDING_APPROVAL" && !voted) {
        voted = true;
        const approvalId = approvalIdOf(status);
        if (!approvalId || voteSummary === null) break;
        const summary = voteSummary;
        const vote = yield* this.#ownerQueue
          .withPermit(
            Effect.gen({ self: this }, function* () {
              const intent = yield* this.#generate({
                type: "approval_vote",
                agent_id: agentId,
                approval_id: approvalId,
                verdict: "approve",
              });
              yield* this.#signAndSubmit("approve-payment", intent, summary, null);
            }),
          )
          .pipe(Effect.result);
        if (Result.isFailure(vote))
          return {
            status: "declined",
            correlationId,
            detail: redactText(nearMessage(vote.failure)),
          };
      }
    }
    return { status: "uncertain", correlationId, detail: sourceText("error.connector.nearUncertain") };
  });

  /** Payments of an earlier run: read their result, or send them again with the same key. */
  readonly #resume = Effect.fn("NearWallet.resume")(function* (this: NearWalletService) {
    const record = this.#store.read();
    const wallet = record.wallet;
    if (!wallet?.grant?.active || !this.#grantValid(record)) return;
    for (const payment of record.payments) {
      if (payment.correlationId) {
        yield* this.#follow(wallet.agentId, payment, payment.correlationId, STATUS_WAIT_MS, null);
        continue;
      }
      if (payment.createdAt + REPLAY_WINDOW_MS < this.#now() || wallet.frozen) {
        logger.warn("A NEAR payment of an earlier run has no answer and is too old to send again.");
        yield* this.#removePayment(payment, false);
        continue;
      }
      const sent = yield* this.#send(wallet.agentId, payment).pipe(Effect.result);
      if (Result.isSuccess(sent)) {
        yield* this.#updatePayment(payment.idempotencyKey, { correlationId: sent.success });
        yield* this.#follow(wallet.agentId, payment, sent.success, STATUS_WAIT_MS, null);
      } else if (sent.failure.cause instanceof AgentApiError && !sent.failure.cause.retryable) {
        yield* this.#removePayment(payment, true);
      }
    }
  });

  #updatePayment(idempotencyKey: string, change: Partial<NearStoredPayment>) {
    return this.#store.update((record) => ({
      ...record,
      payments: record.payments.map((payment) =>
        payment.idempotencyKey === idempotencyKey ? { ...payment, ...change } : payment,
      ),
    }));
  }

  /** Forgets a stored payment. `refund` gives back its counted spend, for a refused payment only. */
  #removePayment(payment: NearStoredPayment, refund: boolean) {
    const today = this.#today();
    return this.#store.update((record) => {
      const byDomainCents = { ...record.spend.byDomainCents };
      if (refund && payment.amountCents !== null && record.spend.day === today && byDomainCents[payment.domain]) {
        byDomainCents[payment.domain] = Math.max(0, (byDomainCents[payment.domain] ?? 0) - payment.amountCents);
      }
      return {
        ...record,
        spend: { ...record.spend, byDomainCents },
        payments: record.payments.filter((candidate) => candidate.idempotencyKey !== payment.idempotencyKey),
      };
    });
  }

  // --- Reads -------------------------------------------------------------------------------------

  readonly #startup = Effect.fn("NearWallet.startup")(function* (this: NearWalletService) {
    yield* this.#refresh(true);
    yield* this.#resume();
  });

  readonly #refresh = Effect.fn("NearWallet.refreshReads")(function* (this: NearWalletService, force: boolean) {
    const wallet = this.#store.read().wallet;
    if (!wallet?.accountId) return;
    const api = yield* this.#partnerClient();
    const now = this.#now();
    if (force || !this.#tokens || this.#tokens.at + TOKEN_CACHE_MS < now) {
      const list = yield* nearCall((signal) => api.getTokens({ signal }));
      this.#tokens = { at: now, list };
    }
    if (force || !this.#balances || this.#balances.at + BALANCE_CACHE_MS < now) {
      const view = yield* nearCall((signal) => api.getBalances(wallet.agentId, {}, { signal }));
      const raw = view.balances.filter((entry) => entry.balance_raw !== "0");
      this.#balances = { at: now, raw, list: raw.map(balanceView) };
    }
    if (force) this.#policy = yield* nearCall((signal) => api.getPolicy(wallet.agentId, { signal }));
    this.#emitStatus();
  });

  // --- Helpers -----------------------------------------------------------------------------------

  /** Runs an owner action: one at a time, its failure shown in the status. Gives the status. */
  #ownerStep(operation: Effect.Effect<unknown, NearOperationError>): Effect.Effect<NearWalletStatus> {
    return this.#ownerQueue
      .withPermit(
        Effect.gen({ self: this }, function* () {
          this.#error = null;
          this.#emitStatus();
          const result = yield* operation.pipe(Effect.result);
          if (Result.isFailure(result)) {
            this.#error = redactText(failureText(result.failure.cause));
            if (!isOwnerFailure(result.failure.cause))
              logger.warn("A NEAR wallet action failed.", { cause: toLogValue(result.failure.cause) });
          }
          this.#emitStatus();
          return this.status();
        }),
      )
      .pipe(Effect.catchDefect((defect) => Effect.sync(() => this.#defect(defect))));
  }

  /** A background read: its failure is shown, not thrown. */
  #background(operation: Effect.Effect<unknown, NearOperationError>): Effect.Effect<void> {
    return operation.pipe(
      Effect.catch((failure) =>
        Effect.sync(() => {
          this.#error = redactText(failureText(failure.cause));
          this.#emitStatus();
        }),
      ),
      Effect.catchDefect((defect) => Effect.sync(() => void this.#defect(defect))),
      Effect.asVoid,
    );
  }

  #defect(defect: unknown): NearWalletStatus {
    logger.error("The NEAR wallet failed.", { cause: toLogValue(defect) });
    this.#error = sourceText("error.connector.nearUnexpected", { detail: "internal" });
    this.#emitStatus();
    return this.status();
  }

  #activeWallet() {
    const record = this.#store.read();
    const wallet = record.wallet;
    if (!wallet?.accountId || !wallet.grant?.active) return nearFailure(sourceText("error.connector.nearNoWallet"));
    return Effect.succeed(wallet);
  }

  #client(apiKey: string): AgentApi {
    const options: AgentApiOptions = { apiKey };
    if (this.#baseUrl) options.baseUrl = this.#baseUrl;
    if (this.#fetch) options.fetch = this.#fetch;
    return createAgentApi(options);
  }

  #partnerClient(): Effect.Effect<AgentApi, NearOperationError> {
    const key = this.#store.read().partnerKey;
    return key ? Effect.succeed(this.#client(key)) : nearFailure(sourceText("error.connector.nearNoKey"));
  }

  #grantClient(): Effect.Effect<AgentApi, NearOperationError> {
    const record = this.#store.read();
    const grant = record.wallet?.grant;
    if (!record.partnerKey) return nearFailure(sourceText("error.connector.nearNoKey"));
    if (!grant?.active || !this.#grantValid(record)) return nearFailure(sourceText("error.connector.nearGrantExpired"));
    return Effect.succeed(this.#client(record.partnerKey).forGrant(grant.token));
  }

  #grantValid(record: NearWalletRecord): boolean {
    const grant = record.wallet?.grant;
    return grant?.active === true && Date.parse(grant.expiresAt) - GRANT_MARGIN_MS > this.#now();
  }

  #state(): NearWalletState {
    const record = this.#store.read();
    if (!record.partnerKey) return "no-key";
    const wallet = record.wallet;
    if (!wallet?.accountId || !wallet.grant?.active) return "no-wallet";
    return wallet.frozen ? "frozen" : "ready";
  }

  #spentCents(record: NearWalletRecord, domain: string): number {
    return record.spend.day === this.#today() ? (record.spend.byDomainCents[domain] ?? 0) : 0;
  }

  /** The local date, `YYYY-MM-DD`. A rule's daily limit starts again at local midnight. */
  #today(): string {
    const date = new Date(this.#now());
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  #emitStatus(): void {
    if (this.#disposed) return;
    const status = this.status();
    for (const listener of this.#listeners) listener(status);
  }
}

type BalanceRow = Awaited<ReturnType<AgentApi["getBalances"]>>["balances"][number];

function createPolicy(dailyUsd: string): Policy {
  return {
    frozen: false,
    actions: ["transfer", "withdraw"],
    confidential: false,
    owner_approval: true,
    assets: "any",
    limits: {},
    max_actions_per_hour: MAX_ACTIONS_PER_HOUR,
    destinations: { mode: "any", list: [] },
    budget: { daily_usd: dailyUsd, weekly_usd: null, monthly_usd: null },
    timelock_ms: 0,
  };
}

function intentToSign(intent: GenerateIntentResponse): NearIntentToSign | null {
  const value = intent.intent;
  return value.standard === "eip712" || value.standard === "webauthn" ? value : null;
}

function approvalIdOf(status: StatusResponse): string | null {
  if (status.type !== "transfer" && status.type !== "withdraw") return null;
  return status.details.approval_id ?? null;
}

/** A NEAR account, or `chain:address` for a payment on another chain. */
function parseRecipient(value: string): { chain: string | null; address: string } | null {
  const split = value.indexOf(":");
  if (split < 0) return NEAR_ACCOUNT.test(value) ? { chain: null, address: value } : null;
  const chain = value.slice(0, split);
  const address = value.slice(split + 1);
  if (chain === "near") return NEAR_ACCOUNT.test(address) ? { chain: null, address } : null;
  return CHAIN.test(chain) && CHAIN_ADDRESS.test(address) ? { chain, address } : null;
}

/** The balance entry of a symbol or asset id. With many chains for one symbol, the one that covers the amount. */
function findAsset(balances: BalanceRow[], asset: string, amount: string): BalanceRow | null {
  const exact = balances.find((entry) => entry.asset_id === asset);
  if (exact) return exact;
  const symbol = asset.toUpperCase();
  const matches = balances.filter((entry) => entry.symbol?.toUpperCase() === symbol);
  return matches.find((entry) => Number(entry.available ?? entry.balance ?? 0) >= Number(amount)) ?? matches[0] ?? null;
}

/** Decimal text in whole units to integer text in the smallest unit. Null when it does not fit. */
function toAtomic(amount: string, decimals: number): string | null {
  if (!AMOUNT.test(amount) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const [whole = "0", fraction = ""] = amount.split(".");
  if (fraction.length > decimals) return null;
  const atomic = BigInt(whole + fraction.padEnd(decimals, "0"));
  return atomic > 0n ? atomic.toString() : null;
}

/** USD cents, rounded up, so a limit is never passed by rounding. */
function usdCents(amount: string, price: number): number | null {
  const cents = Math.ceil(Number(amount) * price * 100 - 1e-6);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function balanceView(entry: BalanceRow): NearBalance {
  const amount = entry.available ?? entry.balance ?? "0";
  const usd = entry.price === null ? null : (Number(amount) * entry.price).toFixed(2);
  return { assetId: entry.asset_id, symbol: entry.symbol ?? entry.asset_id, amount, usd };
}

function depositAssets(tokens: TokenView[]): NearDepositAsset[] {
  return tokens.map((token) => ({ assetId: token.asset_id, symbol: token.symbol, blockchain: token.blockchain }));
}

function newKey(): string {
  return `openbot-${randomUUID()}`;
}

function apiDetail(error: AgentApiError): string {
  return error.detail ? `${error.code}: ${error.detail}` : error.code;
}

/** A sentence for the owner or the agent. API error codes and details stay; nothing else of a body does. */
function failureText(cause: unknown): string {
  if (cause instanceof AgentApiError) {
    if (cause.status === 401) return sourceText("error.connector.nearKeyRejected");
    return sourceText("error.connector.nearRefused", { detail: apiDetail(cause) });
  }
  if (cause instanceof AgentApiRequestError)
    return sourceText("error.connector.nearUnreachable", { detail: cause.message });
  if (cause instanceof AgentApiResponseTooLargeError)
    return sourceText("error.connector.nearUnexpected", { detail: cause.code });
  if (cause instanceof Error) return cause.message;
  return sourceText("error.connector.nearUnexpected", { detail: String(cause) });
}

/** Failures that the owner caused or can fix: no log entry. */
function isOwnerFailure(cause: unknown): boolean {
  return cause instanceof AgentApiError ? cause.status < 500 : !(cause instanceof AgentApiRequestError);
}

/** The agent reads this sentence. Keys and tokens are masked in it. */
function walletError(error: NearOperationError): NearWalletError {
  return new NearWalletError({ message: redactText(failureText(error.cause)) });
}
