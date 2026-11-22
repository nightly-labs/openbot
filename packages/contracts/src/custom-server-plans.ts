import {
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  type BillingCurrency,
  type BillingInterval,
  isStripeCheckoutUrl,
} from "./billing";
import { INPUT_LIMITS } from "./input-limits";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export interface CustomServerPlan {
  name: string;
  amount: number;
  currency: BillingCurrency;
  interval: BillingInterval;
  vcpu: number;
  memoryGb: number;
  storageGb: number;
  personalizedSupport: boolean;
}

export interface CustomServerCheckout {
  checkoutUrl: string | null;
}

export interface CustomServerCheckoutResult {
  opened: boolean;
}

export interface CustomServerCheckoutRequest {
  serverId: string;
  earlyStart?: true;
}

export function parseCustomServerCheckoutRequest(value: unknown): CustomServerCheckoutRequest | null {
  if (
    !isDynamicRecord(value) ||
    !isString(value.serverId) ||
    !value.serverId ||
    value.serverId.length > INPUT_LIMITS.identifier ||
    (value.earlyStart !== undefined && value.earlyStart !== true)
  )
    return null;
  return value.earlyStart === true ? { serverId: value.serverId, earlyStart: true } : { serverId: value.serverId };
}

export function parseCustomServerCheckoutResult(value: unknown): CustomServerCheckoutResult | null {
  return isDynamicRecord(value) && isBoolean(value.opened) ? { opened: value.opened } : null;
}

export const CUSTOM_SERVER_METADATA_KIND = "custom_server";
export const CUSTOM_SERVER_PLAN_NAME_MAX_LENGTH = 60;
export const CUSTOM_SERVER_AMOUNT_MIN = 100;
export const CUSTOM_SERVER_AMOUNT_MAX = 10_000_000;
export const CUSTOM_SERVER_SPEC_MAX = 100_000;
export const CUSTOM_SERVER_PAID_STATUSES = ["active", "trialing", "past_due"] as const;

function isSpec(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 1 && value <= CUSTOM_SERVER_SPEC_MAX;
}

export function parseCustomServerPlan(value: unknown): CustomServerPlan | null {
  if (!isDynamicRecord(value)) return null;
  const { name, amount, currency, interval, vcpu, memoryGb, storageGb, personalizedSupport } = value;
  if (
    !isString(name) ||
    name.trim().length === 0 ||
    name.length > CUSTOM_SERVER_PLAN_NAME_MAX_LENGTH ||
    !isNumber(amount) ||
    !Number.isSafeInteger(amount) ||
    amount < CUSTOM_SERVER_AMOUNT_MIN ||
    amount > CUSTOM_SERVER_AMOUNT_MAX ||
    !isOneOf(BILLING_CURRENCIES, currency) ||
    !isOneOf(BILLING_INTERVALS, interval) ||
    !isSpec(vcpu) ||
    !isSpec(memoryGb) ||
    !isSpec(storageGb) ||
    !isBoolean(personalizedSupport)
  ) {
    return null;
  }
  return { name, amount, currency, interval, vcpu, memoryGb, storageGb, personalizedSupport };
}

export function parseCustomServerCheckout(value: unknown): CustomServerCheckout | null {
  if (!isDynamicRecord(value)) return null;
  const { checkoutUrl } = value;
  if (checkoutUrl === null) return { checkoutUrl: null };
  return isStripeCheckoutUrl(checkoutUrl) ? { checkoutUrl } : null;
}

export interface CustomServerPayment {
  paymentRequired?: true;
  customPlan?: CustomServerPlan;
}

export function optionalCustomServerPayment(value: {
  paymentRequired?: unknown;
  customPlan?: unknown;
}): CustomServerPayment {
  if (value.paymentRequired !== true) return {};
  const customPlan = parseCustomServerPlan(value.customPlan);
  return customPlan ? { paymentRequired: true, customPlan } : { paymentRequired: true };
}
