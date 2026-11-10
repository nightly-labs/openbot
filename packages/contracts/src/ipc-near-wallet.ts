import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isFiniteNumber, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

/**
 * The NEAR Intents wallet of this computer, for agent payments. It is one agent account on the NEAR
 * Intents Agent API. The partner key and the grant tokens stay in main: no status, event or answer
 * carries them.
 *
 * - `no-key`: no partner key is stored.
 * - `no-wallet`: a partner key is stored, and no wallet is made yet.
 * - `ready`: agents with a grant can ask to pay.
 * - `frozen`: the owner stopped all payments.
 */
export type NearWalletState = "no-key" | "no-wallet" | "ready" | "frozen";
export const NEAR_WALLET_STATES = ["no-key", "no-wallet", "ready", "frozen"] as const satisfies NearWalletState[];

/** How the owner signs. The Agent API also takes a NEAR account, which OpenBot does not offer yet. */
export type NearOwnerMethod = "passkey" | "evm";
export const NEAR_OWNER_METHODS = ["passkey", "evm"] as const satisfies NearOwnerMethod[];

/**
 * The owner action that waits for the browser. `register` makes the passkey or connects the EVM wallet;
 * the others sign one Agent API intent. `grant` gives this app the right to pay, for 30 days.
 * `auto-pay` turns `owner_approval` off when the first payment rule is saved.
 */
export type NearOwnerAction =
  | "register"
  | "create"
  | "grant"
  | "budget"
  | "freeze"
  | "unfreeze"
  | "auto-pay"
  | "approve-payment";
export const NEAR_OWNER_ACTIONS = [
  "register",
  "create",
  "grant",
  "budget",
  "freeze",
  "unfreeze",
  "auto-pay",
  "approve-payment",
] as const satisfies NearOwnerAction[];

/** The daily USD limits that a payment rule can have. */
export const NEAR_RULE_DAILY_USD = [5, 10, 25, 50, 100] as const;

export const NEAR_WALLET_LIMITS = {
  /** A partner key of the Agent API. */
  partnerKey: 512,
  /** A NEAR account id is at most 64 characters; an EVM or other chain address is shorter. */
  recipient: 128,
  recipientsPerRule: 8,
  rules: 64,
  asset: 160,
  amount: 80,
  reason: 500,
  usd: 32,
  /** The id of an approval, as text. */
  requestId: 128,
} as const;

/** One asset of the wallet. Amounts are decimal text in whole units, as the Agent API gives them. */
export interface NearBalance {
  assetId: string;
  symbol: string;
  amount: string;
  /** Null when the API has no price. */
  usd: string | null;
}

/**
 * Payments that an agent makes without asking. The domain is what the agent says it pays for, so it is
 * a label only: a payment goes without asking only to a recipient that the owner approved for it.
 */
export interface NearPayRule {
  domain: string;
  recipients: string[];
  dailyUsd: number;
  /** USD paid under this rule since the start of today, local time. */
  spentTodayUsd: number;
}

/** A payment that waits for the owner in the chat. `requestId` is the id of its approval, as text. */
export interface NearPendingPayment {
  requestId: string;
  /** The thread of the chat that shows the approval. */
  threadId: string;
  agentId: string;
  domain: string;
  recipient: string;
  amount: string;
  symbol: string;
  /** Null when the API has no price; such a payment always asks. */
  amountUsd: number | null;
  reason: string;
  /** The recipient is already approved for this domain, and the payment is over the daily limit. */
  overLimit: boolean;
}

export interface NearWalletAccount {
  /** The NEAR account of the agent wallet, which deposits go to. */
  accountId: string;
  ownerMethod: NearOwnerMethod;
  /** Each payment needs the owner's signature. True while no payment rule exists. */
  ownerApproval: boolean;
  /** The cap of all payments in a day, in USD. The Agent API keeps it. */
  dailyBudgetUsd: string;
  spentTodayUsd: string | null;
  /** ISO time. The Agent API refuses an ordinary policy change before it. */
  policyChangeAvailableAt: string | null;
  /** ISO time when the payment grant of this app ends. Null when no grant is in force. */
  grantExpiresAt: string | null;
}

/** An asset that the wallet can take as a deposit. */
export interface NearDepositAsset {
  assetId: string;
  symbol: string;
  blockchain: string;
}

export interface NearSigning {
  action: NearOwnerAction;
  /** The approval of the payment that waits for this signature, for `approve-payment`. */
  requestId: string | null;
}

export interface NearWalletStatus {
  state: NearWalletState;
  account: NearWalletAccount | null;
  balances: NearBalance[];
  depositAssets: NearDepositAsset[];
  /** The OpenBot agents that can ask to pay. This list is kept on this computer only. */
  agentIds: string[];
  rules: NearPayRule[];
  payments: NearPendingPayment[];
  signing: NearSigning | null;
  /** The last failure, as a sentence. Null after a success. */
  error: string | null;
}

export const NO_NEAR_WALLET: NearWalletStatus = {
  state: "no-key",
  account: null,
  balances: [],
  depositAssets: [],
  agentIds: [],
  rules: [],
  payments: [],
  signing: null,
  error: null,
};

export interface NearWalletCreateInput {
  ownerMethod: NearOwnerMethod;
  /** Decimal USD text, more than zero. */
  dailyBudgetUsd: string;
  agentIds: string[];
}

export interface NearDepositInput {
  assetId: string;
}

export interface NearDepositAddress {
  address: string;
  memo: string | null;
  /** Decimal text in whole units. */
  minAmount: string | null;
  /** ISO time. */
  expiresAt: string | null;
}

export interface NearRuleInput {
  domain: string;
  recipients: string[];
  dailyUsd: number;
}

export interface NearAllowPaymentInput {
  requestId: string;
  dailyUsd: number;
}

const USD_TEXT = /^\d{1,9}(\.\d{1,2})?$/;

/** Decimal USD text that is more than zero, such as `25` or `7.50`. */
export function isNearBudgetText(value: unknown): value is string {
  return typeof value === "string" && USD_TEXT.test(value) && Number(value) > 0;
}

function isRuleDailyUsd(value: unknown): value is number {
  return isFiniteNumber(value) && NEAR_RULE_DAILY_USD.some((option) => option === value);
}

/** A lowercase host name, such as `api.exa.ai`. */
export function isNearRuleDomain(value: unknown): value is string {
  return (
    isBoundedString(value, INPUT_LIMITS.hostname) &&
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)
  );
}

/** A NEAR account id or a chain address: letters, digits and `.-_:`. */
export function isNearRecipient(value: unknown): value is string {
  return isBoundedString(value, NEAR_WALLET_LIMITS.recipient) && /^[A-Za-z0-9._:-]+$/.test(value);
}

function isIdList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= INPUT_LIMITS.agents &&
    value.every(isIdentifier) &&
    new Set(value).size === value.length
  );
}

export function parseNearPartnerKey(value: unknown): string | null {
  if (!isBoundedString(value, NEAR_WALLET_LIMITS.partnerKey)) return null;
  const key = value.trim();
  return key.length > 0 && !/\s/.test(key) ? key : null;
}

export function parseNearWalletCreateInput(value: unknown): NearWalletCreateInput | null {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(NEAR_OWNER_METHODS, value.ownerMethod) ||
    !isNearBudgetText(value.dailyBudgetUsd) ||
    !isIdList(value.agentIds)
  ) {
    return null;
  }
  return { ownerMethod: value.ownerMethod, dailyBudgetUsd: value.dailyBudgetUsd, agentIds: [...value.agentIds] };
}

export function parseNearBudgetInput(value: unknown): { dailyBudgetUsd: string } | null {
  return isDynamicRecord(value) && isNearBudgetText(value.dailyBudgetUsd)
    ? { dailyBudgetUsd: value.dailyBudgetUsd }
    : null;
}

export function parseNearAgentsInput(value: unknown): { agentIds: string[] } | null {
  return isDynamicRecord(value) && isIdList(value.agentIds) ? { agentIds: [...value.agentIds] } : null;
}

export function parseNearDepositInput(value: unknown): NearDepositInput | null {
  return isDynamicRecord(value) && isBoundedString(value.assetId, NEAR_WALLET_LIMITS.asset) && value.assetId.length > 0
    ? { assetId: value.assetId }
    : null;
}

export function parseNearRuleInput(value: unknown): NearRuleInput | null {
  if (
    !isDynamicRecord(value) ||
    !isNearRuleDomain(value.domain) ||
    !Array.isArray(value.recipients) ||
    value.recipients.length === 0 ||
    value.recipients.length > NEAR_WALLET_LIMITS.recipientsPerRule ||
    !value.recipients.every(isNearRecipient) ||
    !isRuleDailyUsd(value.dailyUsd)
  ) {
    return null;
  }
  return { domain: value.domain, recipients: [...new Set(value.recipients)], dailyUsd: value.dailyUsd };
}

export function parseNearDomainInput(value: unknown): { domain: string } | null {
  return isDynamicRecord(value) && isNearRuleDomain(value.domain) ? { domain: value.domain } : null;
}

export function parseNearAllowPaymentInput(value: unknown): NearAllowPaymentInput | null {
  return isDynamicRecord(value) &&
    isBoundedString(value.requestId, NEAR_WALLET_LIMITS.requestId) &&
    value.requestId.length > 0 &&
    isRuleDailyUsd(value.dailyUsd)
    ? { requestId: value.requestId, dailyUsd: value.dailyUsd }
    : null;
}

function isNearBalance(value: unknown): value is NearBalance {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.assetId, NEAR_WALLET_LIMITS.asset) &&
    isBoundedString(value.symbol, NEAR_WALLET_LIMITS.asset) &&
    isBoundedString(value.amount, NEAR_WALLET_LIMITS.amount) &&
    isNullableBoundedString(value.usd, NEAR_WALLET_LIMITS.usd)
  );
}

function isNearPayRule(value: unknown): value is NearPayRule {
  return (
    isDynamicRecord(value) &&
    isNearRuleDomain(value.domain) &&
    Array.isArray(value.recipients) &&
    value.recipients.length <= NEAR_WALLET_LIMITS.recipientsPerRule &&
    value.recipients.every(isNearRecipient) &&
    isFiniteNumber(value.dailyUsd) &&
    isFiniteNumber(value.spentTodayUsd)
  );
}

function isNearPendingPayment(value: unknown): value is NearPendingPayment {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.requestId, NEAR_WALLET_LIMITS.requestId) &&
    isIdentifier(value.threadId) &&
    isIdentifier(value.agentId) &&
    isBoundedString(value.domain, INPUT_LIMITS.hostname) &&
    isNearRecipient(value.recipient) &&
    isBoundedString(value.amount, NEAR_WALLET_LIMITS.amount) &&
    isBoundedString(value.symbol, NEAR_WALLET_LIMITS.asset) &&
    (value.amountUsd === null || isFiniteNumber(value.amountUsd)) &&
    isBoundedString(value.reason, NEAR_WALLET_LIMITS.reason) &&
    isBoolean(value.overLimit)
  );
}

function isNearWalletAccount(value: unknown): value is NearWalletAccount {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.accountId, NEAR_WALLET_LIMITS.recipient) &&
    isOneOf(NEAR_OWNER_METHODS, value.ownerMethod) &&
    isBoolean(value.ownerApproval) &&
    isNullableBoundedString(value.dailyBudgetUsd, NEAR_WALLET_LIMITS.usd) &&
    isNullableBoundedString(value.spentTodayUsd, NEAR_WALLET_LIMITS.usd) &&
    isNullableBoundedString(value.policyChangeAvailableAt, NEAR_WALLET_LIMITS.usd) &&
    isNullableBoundedString(value.grantExpiresAt, NEAR_WALLET_LIMITS.usd)
  );
}

function isNearDepositAsset(value: unknown): value is NearDepositAsset {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.assetId, NEAR_WALLET_LIMITS.asset) &&
    isBoundedString(value.symbol, NEAR_WALLET_LIMITS.asset) &&
    isBoundedString(value.blockchain, NEAR_WALLET_LIMITS.asset)
  );
}

function isNearSigning(value: unknown): value is NearSigning {
  return (
    isDynamicRecord(value) &&
    isOneOf(NEAR_OWNER_ACTIONS, value.action) &&
    isNullableBoundedString(value.requestId, NEAR_WALLET_LIMITS.requestId)
  );
}

function listOf<T>(value: unknown, limit: number, check: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.length <= limit && value.every(check);
}

/** Returns null for a value that is not a NEAR wallet status. */
export function parseNearWalletStatus(value: unknown): NearWalletStatus | null {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(NEAR_WALLET_STATES, value.state) ||
    !(value.account === null || isNearWalletAccount(value.account)) ||
    !listOf(value.balances, NEAR_WALLET_LIMITS.rules, isNearBalance) ||
    !listOf(value.depositAssets, NEAR_WALLET_LIMITS.rules, isNearDepositAsset) ||
    !isIdList(value.agentIds) ||
    !listOf(value.rules, NEAR_WALLET_LIMITS.rules, isNearPayRule) ||
    !listOf(value.payments, NEAR_WALLET_LIMITS.rules, isNearPendingPayment) ||
    !(value.signing === null || isNearSigning(value.signing)) ||
    !isNullableBoundedString(value.error, INPUT_LIMITS.messageText)
  ) {
    return null;
  }
  return {
    state: value.state,
    account: value.account,
    balances: value.balances,
    depositAssets: value.depositAssets,
    agentIds: value.agentIds,
    rules: value.rules,
    payments: value.payments,
    signing: value.signing,
    error: value.error,
  };
}

export function parseNearDepositAddress(value: unknown): NearDepositAddress | null {
  if (
    !isDynamicRecord(value) ||
    !isBoundedString(value.address, NEAR_WALLET_LIMITS.recipient) ||
    !isNullableBoundedString(value.memo, NEAR_WALLET_LIMITS.recipient) ||
    !isNullableBoundedString(value.minAmount, NEAR_WALLET_LIMITS.amount) ||
    !isNullableBoundedString(value.expiresAt, NEAR_WALLET_LIMITS.usd)
  ) {
    return null;
  }
  return { address: value.address, memo: value.memo, minAmount: value.minAmount, expiresAt: value.expiresAt };
}
