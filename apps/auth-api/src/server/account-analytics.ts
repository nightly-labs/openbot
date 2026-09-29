import {
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  BILLING_PLAN_IDS,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  isBillingAmount,
} from "@openbot/contracts/billing";
import {
  HOSTED_SERVER_ERRORS,
  HOSTED_SERVER_SIZE_NAMES,
  type HostedServerError,
  type HostedServerSize,
} from "@openbot/contracts/hosted-servers";
import { isOneOf } from "@openbot/contracts/runtime-values";

/** The same OpenPanel project as the desktop app and the website. ANALYTICS.md is the contract. */
const OPENPANEL_API_URL = "https://analytics.openbot.run/api";
/** The current generation. The `account_api` events are new and change no older event. */
const ANALYTICS_SCHEMA_VERSION = 8;
const SEND_TIMEOUT_MS = 5_000;
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

const BILLING_ACTIONS = [
  "checkout_started",
  "checkout_expired",
  "plan_started",
  "payment_succeeded",
  "payment_failed",
  "plan_changed",
  "cancel_scheduled",
  "cancel_withdrawn",
  "plan_ended",
  "portal_opened",
] as const;
export type BillingAction = (typeof BILLING_ACTIONS)[number];

const HOSTED_SERVER_ACTIONS = [
  "provisioned",
  "setup_failed",
  "idle_stopped",
  "woken",
  "resized",
  "plan_stopped",
  "renewed",
  "deleted",
] as const;
type HostedServerAction = (typeof HOSTED_SERVER_ACTIONS)[number];

const PORTAL_FLOWS = ["manage", "update", "cancel"] as const;
const WAKE_REASONS = ["message", "restart", "schedule"] as const;

export type AccountAnalyticsEvent =
  | {
      name: "billing_action";
      action: BillingAction;
      plan?: BillingPlanId;
      interval?: BillingInterval;
      currency?: BillingCurrency;
      /** Minor units of `currency`, from Stripe. */
      amount?: number | null;
      flow?: (typeof PORTAL_FLOWS)[number];
    }
  | {
      name: "hosted_server_action";
      action: HostedServerAction;
      plan?: BillingPlanId;
      size?: HostedServerSize;
      reason?: (typeof WAKE_REASONS)[number];
      error?: HostedServerError | null;
    };

/** Account events that only the Worker sees: payments and the lifecycle of hosted servers. */
export interface AccountAnalytics {
  /** Never throws and never waits: a failed send loses the event, not the request. */
  track(accountId: string, event: AccountAnalyticsEvent): void;
}

export const NO_ACCOUNT_ANALYTICS: AccountAnalytics = { track: () => undefined };

export interface AccountAnalyticsOptions {
  /**
   * A server client of the OpenPanel project and its write-only secret. The desktop and website
   * client has no secret. Without both, no event is sent.
   */
  clientId: string | undefined;
  clientSecret: string | undefined;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** Keeps the Worker alive until the send ends (`waitUntil`). */
  schedule: (send: Promise<void>) => void;
}

export function createAccountAnalytics(options: AccountAnalyticsOptions): AccountAnalytics {
  const clientId = options.clientId?.trim();
  const clientSecret = options.clientSecret?.trim();
  if (!clientId || !clientSecret) return NO_ACCOUNT_ANALYTICS;
  return {
    track(accountId, event) {
      const properties = accountEventProperties(event);
      if (!properties || !ACCOUNT_ID_PATTERN.test(accountId)) return;
      const send = options
        .fetch(`${OPENPANEL_API_URL}/track`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "openpanel-client-id": clientId,
            "openpanel-client-secret": clientSecret,
          },
          body: JSON.stringify({ type: "track", payload: { name: event.name, profileId: accountId, properties } }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        })
        .then(
          (response) => {
            if (!response.ok) console.warn("Account analytics send failed.", { status: response.status });
          },
          () => console.warn("Account analytics send failed."),
        );
      options.schedule(send);
    },
  };
}

/**
 * The properties of one event, checked at runtime against the allowlists. A value that is not on a
 * list is dropped, and an unknown action drops the event.
 */
export function accountEventProperties(event: AccountAnalyticsEvent): Record<string, string | number> | null {
  const properties: Record<string, string | number> = {
    surface: "account_api",
    environment: "production",
    event_schema_version: ANALYTICS_SCHEMA_VERSION,
  };
  if (event.name === "billing_action") {
    if (!isOneOf(BILLING_ACTIONS, event.action)) return null;
    properties.action = event.action;
    if (isOneOf(BILLING_PLAN_IDS, event.plan)) properties.plan = event.plan;
    if (isOneOf(BILLING_INTERVALS, event.interval)) properties.interval = event.interval;
    if (isOneOf(BILLING_CURRENCIES, event.currency)) {
      properties.currency = event.currency;
      if (isBillingAmount(event.amount)) properties.amount = event.amount;
    }
    if (isOneOf(PORTAL_FLOWS, event.flow)) properties.flow = event.flow;
    return properties;
  }
  if (event.name !== "hosted_server_action" || !isOneOf(HOSTED_SERVER_ACTIONS, event.action)) return null;
  properties.action = event.action;
  if (isOneOf(BILLING_PLAN_IDS, event.plan)) properties.plan = event.plan;
  if (isOneOf(HOSTED_SERVER_SIZE_NAMES, event.size)) properties.size = event.size;
  if (isOneOf(WAKE_REASONS, event.reason)) properties.reason = event.reason;
  if (isOneOf(HOSTED_SERVER_ERRORS, event.error)) properties.error = event.error;
  return properties;
}
