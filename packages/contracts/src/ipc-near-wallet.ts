import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isFiniteNumber, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

export type NearWalletState = "signed-out" | "no-wallet" | "ready" | "frozen";
export const NEAR_WALLET_STATES = ["signed-out", "no-wallet", "ready", "frozen"] as const satisfies NearWalletState[];

export type NearOwnerAction =
  | "register"
  | "create"
  | "grant"
  | "budget"
  | "freeze"
  | "unfreeze"
  | "auto-pay"
  | "approve-payment"
  | "check-backup";
export const NEAR_OWNER_ACTIONS = [
  "register",
  "create",
  "grant",
  "budget",
  "freeze",
  "unfreeze",
  "auto-pay",
  "approve-payment",
  "check-backup",
] as const satisfies NearOwnerAction[];

export type NearPasskeyBackup = "synced" | "notSynced" | "deviceOnly";
export const NEAR_PASSKEY_BACKUPS = ["synced", "notSynced", "deviceOnly"] as const satisfies NearPasskeyBackup[];

export type NearPasskeyChoice = "keep" | "replace";
export const NEAR_PASSKEY_CHOICES = ["keep", "replace"] as const satisfies NearPasskeyChoice[];

export interface NearOwnerBackup {
  state: NearPasskeyBackup | null;
  checkedAt: string;
}

export const NEAR_RULE_DAILY_USD = [5, 10, 25, 50, 100] as const;

export const NEAR_WALLET_LIMITS = {
  recipient: 128,
  recipientsPerRule: 8,
  rules: 64,
  assets: 1024,
  asset: 160,
  amount: 80,
  reason: 500,
  usd: 32,
  requestId: 128,
} as const;

export interface NearBalance {
  assetId: string;
  symbol: string;
  amount: string;
  usd: string | null;
}

export interface NearPayRule {
  domain: string;
  recipients: string[];
  dailyUsd: number;
  spentTodayUsd: number;
}

export interface NearPendingPayment {
  requestId: string;
  threadId: string;
  agentId: string;
  domain: string;
  recipient: string;
  amount: string;
  symbol: string;
  amountUsd: number | null;
  reason: string;
  overLimit: boolean;
}

export const NEAR_PAYMENT_ITEM_TYPE = "near_payment";

export type NearPaymentState = "sending" | "paid" | "rejected" | "failed" | "uncertain";
export const NEAR_PAYMENT_STATES = [
  "sending",
  "paid",
  "rejected",
  "failed",
  "uncertain",
] as const satisfies NearPaymentState[];

export interface ConversationNearPayment {
  domain: string;
  amount: string;
  symbol: string;
  reason: string;
  state: NearPaymentState;
  automatic: boolean;
  transactionHash: string | null;
  detail: string | null;
}

const NEAR_TRANSACTION_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;
const NEAR_PAYMENT_DETAIL = 1000;

export function isNearTransactionHash(value: unknown): value is string {
  return typeof value === "string" && NEAR_TRANSACTION_HASH.test(value);
}

export function isConversationNearPayment(value: unknown): value is ConversationNearPayment {
  return (
    isDynamicRecord(value) &&
    isNearRuleDomain(value.domain) &&
    isBoundedString(value.amount, NEAR_WALLET_LIMITS.amount) &&
    isBoundedString(value.symbol, NEAR_WALLET_LIMITS.asset) &&
    isBoundedString(value.reason, NEAR_WALLET_LIMITS.reason) &&
    isOneOf(NEAR_PAYMENT_STATES, value.state) &&
    isBoolean(value.automatic) &&
    (value.transactionHash === null || isNearTransactionHash(value.transactionHash)) &&
    isNullableBoundedString(value.detail, NEAR_PAYMENT_DETAIL)
  );
}

export interface NearWalletAccount {
  accountId: string;
  ownerApproval: boolean;
  dailyBudgetUsd: string;
  spentTodayUsd: string | null;
  policyChangeAvailableAt: string | null;
  grantExpiresAt: string | null;
}

export interface NearDepositAsset {
  assetId: string;
  symbol: string;
  blockchain: string;
}

export interface NearSigning {
  action: NearOwnerAction;
  requestId: string | null;
}

export interface NearWalletStatus {
  state: NearWalletState;
  account: NearWalletAccount | null;
  balances: NearBalance[];
  depositAssets: NearDepositAsset[];
  allAgents: boolean;
  agentIds: string[];
  rules: NearPayRule[];
  payments: NearPendingPayment[];
  signing: NearSigning | null;
  ownerBackup: NearOwnerBackup | null;
  error: string | null;
}

export const NO_NEAR_WALLET: NearWalletStatus = {
  state: "no-wallet",
  account: null,
  balances: [],
  depositAssets: [],
  allAgents: true,
  agentIds: [],
  rules: [],
  payments: [],
  signing: null,
  ownerBackup: null,
  error: null,
};

export interface NearWalletCreateInput {
  dailyBudgetUsd: string;
  passkey?: NearPasskeyChoice;
}

export interface NearAgentsInput {
  allAgents: boolean;
  agentIds: string[];
}

export interface NearDepositInput {
  assetId: string;
}

export interface NearDepositAddress {
  address: string;
  memo: string | null;
  minAmount: string | null;
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

export function isNearBudgetText(value: unknown): value is string {
  return typeof value === "string" && USD_TEXT.test(value) && Number(value) > 0;
}

function isRuleDailyUsd(value: unknown): value is number {
  return isFiniteNumber(value) && NEAR_RULE_DAILY_USD.some((option) => option === value);
}

export function isNearRuleDomain(value: unknown): value is string {
  return (
    isBoundedString(value, INPUT_LIMITS.hostname) &&
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)
  );
}

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

export function parseNearWalletCreateInput(value: unknown): NearWalletCreateInput | null {
  if (
    !isDynamicRecord(value) ||
    !isNearBudgetText(value.dailyBudgetUsd) ||
    !(value.passkey === undefined || isOneOf(NEAR_PASSKEY_CHOICES, value.passkey))
  ) {
    return null;
  }
  const input = { dailyBudgetUsd: value.dailyBudgetUsd };
  return value.passkey === undefined ? input : { ...input, passkey: value.passkey };
}

export function parseNearBudgetInput(value: unknown): { dailyBudgetUsd: string } | null {
  return isDynamicRecord(value) && isNearBudgetText(value.dailyBudgetUsd)
    ? { dailyBudgetUsd: value.dailyBudgetUsd }
    : null;
}

export function parseNearAgentsInput(value: unknown): NearAgentsInput | null {
  return isDynamicRecord(value) && typeof value.allAgents === "boolean" && isIdList(value.agentIds)
    ? { allAgents: value.allAgents, agentIds: [...value.agentIds] }
    : null;
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

function isNearOwnerBackup(value: unknown): value is NearOwnerBackup {
  return (
    isDynamicRecord(value) &&
    (value.state === null || isOneOf(NEAR_PASSKEY_BACKUPS, value.state)) &&
    isBoundedString(value.checkedAt, NEAR_WALLET_LIMITS.usd)
  );
}

function listOf<T>(value: unknown, limit: number, check: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.length <= limit && value.every(check);
}

export function parseNearWalletStatus(value: unknown): NearWalletStatus | null {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(NEAR_WALLET_STATES, value.state) ||
    !(value.account === null || isNearWalletAccount(value.account)) ||
    !listOf(value.balances, NEAR_WALLET_LIMITS.assets, isNearBalance) ||
    !listOf(value.depositAssets, NEAR_WALLET_LIMITS.assets, isNearDepositAsset) ||
    typeof value.allAgents !== "boolean" ||
    !isIdList(value.agentIds) ||
    !listOf(value.rules, NEAR_WALLET_LIMITS.rules, isNearPayRule) ||
    !listOf(value.payments, NEAR_WALLET_LIMITS.rules, isNearPendingPayment) ||
    !(value.signing === null || isNearSigning(value.signing)) ||
    !(value.ownerBackup === null || isNearOwnerBackup(value.ownerBackup)) ||
    !isNullableBoundedString(value.error, INPUT_LIMITS.messageText)
  ) {
    return null;
  }
  return {
    state: value.state,
    account: value.account,
    balances: value.balances,
    depositAssets: value.depositAssets,
    allAgents: value.allAgents,
    agentIds: value.agentIds,
    rules: value.rules,
    payments: value.payments,
    signing: value.signing,
    ownerBackup: value.ownerBackup,
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
