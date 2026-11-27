import { type ConversationNearPayment, isConversationNearPayment } from "../ipc-near-wallet";
import { isDynamicRecord, isString } from "../runtime-values";
import { decodeTeamProtocolV2Json } from "./webrtc-framing";

export const TEAM_NEAR_PAYMENT_CAPABILITY = "near-payment-v1";

const MAXIMUM_DEPTH = 12;

function nearPaymentCopy(payment: ConversationNearPayment): ConversationNearPayment {
  return {
    domain: payment.domain,
    amount: payment.amount,
    symbol: payment.symbol,
    reason: payment.reason,
    state: payment.state,
    automatic: payment.automatic,
    transactionHash: payment.transactionHash,
    detail: payment.detail,
  };
}

function collect(value: unknown, into: Map<string, ConversationNearPayment>, depth: number): void {
  if (depth > MAXIMUM_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into, depth + 1);
    return;
  }
  if (!isDynamicRecord(value)) return;
  if (isString(value.id) && isConversationNearPayment(value.nearPayment))
    into.set(value.id, nearPaymentCopy(value.nearPayment));
  for (const child of Object.values(value)) collect(child, into, depth + 1);
}

function apply(value: unknown, payments: ReadonlyMap<string, ConversationNearPayment>, depth: number): void {
  if (depth > MAXIMUM_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) apply(item, payments, depth + 1);
    return;
  }
  if (!isDynamicRecord(value)) return;
  const payment = isString(value.id) && isString(value.text) ? payments.get(value.id) : undefined;
  if (payment) Object.assign(value, { nearPayment: nearPaymentCopy(payment) });
  for (const child of Object.values(value)) apply(child, payments, depth + 1);
}

export function addNearPayments(target: unknown, source: unknown): void {
  const payments = new Map<string, ConversationNearPayment>();
  collect(source, payments, 0);
  if (payments.size > 0) apply(target, payments, 0);
}

export function withNearPayments(encoded: string, source: unknown): string {
  const payments = new Map<string, ConversationNearPayment>();
  collect(source, payments, 0);
  if (payments.size === 0) return encoded;
  const value = decodeTeamProtocolV2Json(JSON.parse(encoded));
  apply(value, payments, 0);
  return JSON.stringify(value);
}
