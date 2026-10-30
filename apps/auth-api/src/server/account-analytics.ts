import {
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  BILLING_PLAN_IDS,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  isBillingAmount,
} from "@openbot/contracts/billing";
import { FIRST_TOUCH_CAMPAIGN_FIELDS, type FirstTouch, parseFirstTouch } from "@openbot/contracts/first-touch";
import {
  HOSTED_SERVER_ENTRY_POINTS,
  HOSTED_SERVER_ERRORS,
  HOSTED_SERVER_SIZE_NAMES,
  type HostedServerEntryPoint,
  type HostedServerError,
  type HostedServerSize,
} from "@openbot/contracts/hosted-servers";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";

/** The same OpenPanel project as the desktop app and the website. ANALYTICS.md is the contract. */
const OPENPANEL_API_URL = "https://analytics.openbot.run/api";
/**
 * The current generation. Generation 10 adds the account events, first-touch properties, and
 * `reactivated` and `end_reason` on plan events. Generation 11 adds the license to the billing events
 * (`product`, `users`, `direction`), `entry_point` on `checkout_started`, and the license totals of
 * `billing_snapshot`. A billing event without `product` is from a server plan. No generation 10
 * property changes. Generation 12 adds `email_sent`.
 */
export const ACCOUNT_ANALYTICS_SCHEMA_VERSION = 12;
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
/** What a billing event is for: a hosted server plan or the commercial license. */
export const BILLING_PRODUCTS = ["server", "license"] as const;
export type BillingProduct = (typeof BILLING_PRODUCTS)[number];
/** On `plan_changed`: the new plan or user count costs more (`up`) or less (`down`). */
export const PLAN_CHANGE_DIRECTIONS = ["up", "down"] as const;
export type PlanChangeDirection = (typeof PLAN_CHANGE_DIRECTIONS)[number];
/**
 * The largest license user count that analytics accepts. The app sells up to 10 users; a license
 * from the Stripe Dashboard can have more, so the bound only stops a value that is not a count.
 */
const ANALYTICS_MAX_LICENSE_USERS = 10_000;

/** True for a license user count that analytics can send. */
export function isAnalyticsLicenseUsers(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= ANALYTICS_MAX_LICENSE_USERS;
}
const WAKE_REASONS = ["message", "restart", "schedule", "retention"] as const;
/** Why a plan ended: the account cancelled it, or Stripe ended it after unpaid invoices. */
const PLAN_END_REASONS = ["canceled", "unpaid"] as const;
export type PlanEndReason = (typeof PLAN_END_REASONS)[number];
/** The client that verified the sign-in code that created the account. */
const ACCOUNT_SURFACES = ["desktop", "mobile", "web"] as const;
export type AccountSurface = (typeof ACCOUNT_SURFACES)[number];
/** Where the account service learned the first touch of an account. */
const ATTRIBUTION_SOURCES = ["sign_in", "checkout"] as const;
export type AttributionSource = (typeof ATTRIBUTION_SOURCES)[number];

/** The kinds of email that the Worker sends from the shared SMTP mailbox. */
const EMAIL_KINDS = ["sign_in_code", "team_invite", "contact", "welcome"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
/** `unknown`: the server got the message but did not confirm it, so it can count against the quota. */
const EMAIL_RESULTS = ["accepted", "rate_limited", "unknown", "failed"] as const;
export type EmailResult = (typeof EMAIL_RESULTS)[number];

type AnalyticsProperties = Record<string, string | number | boolean>;

export type AccountAnalyticsEvent =
  | {
      name: "billing_action";
      action: BillingAction;
      /** Absent means `server`, as in generation 10. */
      product?: BillingProduct;
      plan?: BillingPlanId;
      /** For a license: the number of users that it pays for. */
      users?: number;
      /** On `plan_changed`. */
      direction?: PlanChangeDirection;
      /** On `checkout_started`: where the journey started in the app. */
      entryPoint?: HostedServerEntryPoint;
      interval?: BillingInterval;
      currency?: BillingCurrency;
      /** Minor units of `currency`, from Stripe. */
      amount?: number | null;
      flow?: (typeof PORTAL_FLOWS)[number];
      /** On `plan_started`: the account had a plan before that ended. */
      reactivated?: boolean;
      /** On `plan_ended`. */
      endReason?: PlanEndReason;
    }
  | { name: "account_created"; surface: AccountSurface; firstTouch: FirstTouch | null }
  | { name: "account_attributed"; via: AttributionSource; firstTouch: FirstTouch }
  | {
      name: "hosted_server_action";
      action: HostedServerAction;
      plan?: BillingPlanId;
      size?: HostedServerSize;
      reason?: (typeof WAKE_REASONS)[number];
      error?: HostedServerError | null;
    }
  | { name: "email_sent"; kind: EmailKind; result: EmailResult };

/** Account events that only the Worker sees: new accounts, payments, hosted servers and email sends. */
export interface AccountAnalytics {
  /**
   * Never throws and never waits: a failed send loses the event, not the request. `null` is for an
   * event with no account, such as `email_sent`: it has no `profileId`, as `billing_snapshot`.
   */
  track(accountId: string | null, event: AccountAnalyticsEvent): void;
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
  schedule: (send: Effect.Effect<void>) => void;
}

class AnalyticsDeliveryError extends Schema.TaggedError<AnalyticsDeliveryError>()("AnalyticsDeliveryError", {}) {}

export function createAccountAnalytics(options: AccountAnalyticsOptions): AccountAnalytics {
  const clientId = options.clientId?.trim();
  const clientSecret = options.clientSecret?.trim();
  if (!clientId || !clientSecret) return NO_ACCOUNT_ANALYTICS;
  const send = Effect.fn("AccountAnalytics.send")(function* (
    accountId: string | null,
    event: AccountAnalyticsEvent,
    properties: AnalyticsProperties,
  ) {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        options.fetch(`${OPENPANEL_API_URL}/track`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "openpanel-client-id": clientId,
            "openpanel-client-secret": clientSecret,
          },
          body: JSON.stringify({
            type: "track",
            payload: { name: event.name, ...(accountId === null ? {} : { profileId: accountId }), properties },
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(SEND_TIMEOUT_MS)]),
        }),
      catch: () => new AnalyticsDeliveryError({}),
    });
    if (!response.ok) console.warn("Account analytics send failed.", { status: response.status });
  });
  return {
    track(accountId, event) {
      const properties = accountEventProperties(event);
      if (!properties || (accountId !== null && !ACCOUNT_ID_PATTERN.test(accountId))) return;
      options.schedule(
        send(accountId, event, properties).pipe(
          Effect.catch(() => Effect.sync(() => console.warn("Account analytics send failed."))),
        ),
      );
    },
  };
}

/**
 * The properties of one event, checked at runtime against the allowlists. A value that is not on a
 * list is dropped, and an unknown action drops the event.
 */
function accountEventProperties(event: AccountAnalyticsEvent): AnalyticsProperties | null {
  const properties: AnalyticsProperties = {
    surface: "account_api",
    environment: "production",
    event_schema_version: ACCOUNT_ANALYTICS_SCHEMA_VERSION,
  };
  if (event.name === "billing_action") {
    if (!isOneOf(BILLING_ACTIONS, event.action)) return null;
    properties.action = event.action;
    const product = isOneOf(BILLING_PRODUCTS, event.product) ? event.product : "server";
    properties.product = product;
    if (product === "server" && isOneOf(BILLING_PLAN_IDS, event.plan)) properties.plan = event.plan;
    if (product === "license" && isAnalyticsLicenseUsers(event.users)) properties.users = event.users;
    if (event.action === "plan_changed" && isOneOf(PLAN_CHANGE_DIRECTIONS, event.direction))
      properties.direction = event.direction;
    if (event.action === "checkout_started" && isOneOf(HOSTED_SERVER_ENTRY_POINTS, event.entryPoint))
      properties.entry_point = event.entryPoint;
    if (isOneOf(BILLING_INTERVALS, event.interval)) properties.interval = event.interval;
    if (isOneOf(BILLING_CURRENCIES, event.currency)) {
      properties.currency = event.currency;
      if (isBillingAmount(event.amount)) properties.amount = event.amount;
    }
    if (isOneOf(PORTAL_FLOWS, event.flow)) properties.flow = event.flow;
    if (event.action === "plan_started" && typeof event.reactivated === "boolean")
      properties.reactivated = event.reactivated;
    if (event.action === "plan_ended" && isOneOf(PLAN_END_REASONS, event.endReason))
      properties.end_reason = event.endReason;
    return properties;
  }
  if (event.name === "account_created") {
    if (!isOneOf(ACCOUNT_SURFACES, event.surface)) return null;
    return { ...properties, sign_in_surface: event.surface, ...firstTouchProperties(event.firstTouch) };
  }
  if (event.name === "account_attributed") {
    const touch = firstTouchProperties(event.firstTouch);
    if (!isOneOf(ATTRIBUTION_SOURCES, event.via) || !touch.first_touch_source) return null;
    return { ...properties, recorded_via: event.via, ...touch };
  }
  if (event.name === "email_sent") {
    if (!isOneOf(EMAIL_KINDS, event.kind) || !isOneOf(EMAIL_RESULTS, event.result)) return null;
    return { ...properties, kind: event.kind, result: event.result };
  }
  if (event.name !== "hosted_server_action" || !isOneOf(HOSTED_SERVER_ACTIONS, event.action)) return null;
  properties.action = event.action;
  if (isOneOf(BILLING_PLAN_IDS, event.plan)) properties.plan = event.plan;
  if (isOneOf(HOSTED_SERVER_SIZE_NAMES, event.size)) properties.size = event.size;
  if (isOneOf(WAKE_REASONS, event.reason)) properties.reason = event.reason;
  if (isOneOf(HOSTED_SERVER_ERRORS, event.error)) properties.error = event.error;
  return properties;
}

const FIRST_TOUCH_CAMPAIGN_PROPERTIES = {
  utmSource: "first_touch_utm_source",
  utmMedium: "first_touch_utm_medium",
  utmCampaign: "first_touch_utm_campaign",
  utmContent: "first_touch_utm_content",
  utmTerm: "first_touch_utm_term",
} as const satisfies Record<(typeof FIRST_TOUCH_CAMPAIGN_FIELDS)[number], string>;

/** Every property name that `firstTouchProperties` can return. */
export const FIRST_TOUCH_PROPERTIES = [
  "first_touch_source",
  "first_touch_platform",
  "first_touch_landing_page",
  "first_touch_date",
  ...Object.values(FIRST_TOUCH_CAMPAIGN_PROPERTIES),
];

/** The event properties of a first touch, checked again; empty without a valid one. */
export function firstTouchProperties(value: FirstTouch | null): Record<string, string> {
  const touch = parseFirstTouch(value);
  if (!touch) return {};
  const properties: Record<string, string> = {
    first_touch_source: touch.acquisitionSource,
    first_touch_platform: touch.sourcePlatform,
    first_touch_landing_page: touch.landingPage,
    first_touch_date: touch.firstVisitOn,
  };
  for (const field of FIRST_TOUCH_CAMPAIGN_FIELDS) {
    const campaign = touch[field];
    if (campaign) properties[FIRST_TOUCH_CAMPAIGN_PROPERTIES[field]] = campaign;
  }
  return properties;
}
