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
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import { Effect, Schema } from "effect";
import type { HostedPoolGroup } from "./hosted-pool-snapshot";

const OPENPANEL_API_URL = "https://analytics.openbot.run/api";
export const ACCOUNT_ANALYTICS_SCHEMA_VERSION = 17;
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
const PAID_BILLING_ACTIONS = [
  "plan_started",
  "payment_succeeded",
  "plan_changed",
  "cancel_scheduled",
  "cancel_withdrawn",
] as const satisfies readonly BillingAction[];

const HOSTED_SERVER_ACTIONS = [
  "provisioned",
  "ready",
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
export const BILLING_PRODUCTS = ["server", "license"] as const;
export type BillingProduct = (typeof BILLING_PRODUCTS)[number];
export const PLAN_CHANGE_DIRECTIONS = ["up", "down"] as const;
export type PlanChangeDirection = (typeof PLAN_CHANGE_DIRECTIONS)[number];
const ANALYTICS_MAX_LICENSE_USERS = 10_000;

export function isAnalyticsLicenseUsers(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= ANALYTICS_MAX_LICENSE_USERS;
}
const WAKE_REASONS = ["create", "message", "restart", "schedule", "retention"] as const;
const HOSTED_MACHINES = ["pool", "boat"] as const;
export const MAX_HOSTED_START_MS = 2 * 60 * 60 * 1000;
const PLAN_END_REASONS = ["canceled", "unpaid"] as const;
export type PlanEndReason = (typeof PLAN_END_REASONS)[number];
const ACCOUNT_SURFACES = ["desktop", "mobile", "web"] as const;
export type AccountSurface = (typeof ACCOUNT_SURFACES)[number];
const ATTRIBUTION_SOURCES = ["sign_in", "checkout"] as const;
export type AttributionSource = (typeof ATTRIBUTION_SOURCES)[number];

const EMAIL_KINDS = ["sign_in_code", "team_invite", "contact", "welcome", "license", "owner_transfer"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
const EMAIL_RESULTS = ["accepted", "rate_limited", "unknown", "failed"] as const;
export type EmailResult = (typeof EMAIL_RESULTS)[number];

type AnalyticsProperties = Record<string, string | number | boolean>;

export type AccountAnalyticsEvent =
  | {
      name: "billing_action";
      action: BillingAction;
      product?: BillingProduct;
      plan?: BillingPlanId;
      users?: number;
      direction?: PlanChangeDirection;
      entryPoint?: HostedServerEntryPoint;
      interval?: BillingInterval;
      currency?: BillingCurrency;
      amount?: number | null;
      flow?: (typeof PORTAL_FLOWS)[number];
      reactivated?: boolean;
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
      durationMs?: number;
      machine?: (typeof HOSTED_MACHINES)[number];
    }
  | { name: "email_sent" | "email_fallback_sent"; kind: EmailKind; result: EmailResult }
  | { name: "hosted_pool_snapshot"; group: HostedPoolGroup };

export interface AccountAnalytics {
  track(accountId: string | null, event: AccountAnalyticsEvent): void;
}

export const NO_ACCOUNT_ANALYTICS: AccountAnalytics = { track: () => undefined };

export interface AccountAnalyticsOptions {
  clientId: string | undefined;
  clientSecret: string | undefined;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  schedule: (send: Effect.Effect<void>) => void;
  database: D1Database;
}

class AnalyticsDeliveryError extends Schema.TaggedError<AnalyticsDeliveryError>()("AnalyticsDeliveryError", {}) {}

type OpenPanelBody =
  | { type: "track"; payload: { name: string; profileId?: string; properties: AnalyticsProperties } }
  | { type: "identify"; payload: { profileId: string; email: string } };

export async function readAccountEmail(database: D1Database, accountId: string): Promise<string | null> {
  const row = await database
    .prepare("SELECT email FROM users WHERE id = ?")
    .bind(accountId)
    .first<{ email: unknown }>();
  return typeof row?.email === "string" ? normalizeEmailAddress(row.email) : null;
}

export function createAccountAnalytics(options: AccountAnalyticsOptions): AccountAnalytics {
  const clientId = options.clientId?.trim();
  const clientSecret = options.clientSecret?.trim();
  if (!clientId || !clientSecret) return NO_ACCOUNT_ANALYTICS;
  const post = Effect.fn("AccountAnalytics.post")(function* (body: OpenPanelBody) {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        options.fetch(`${OPENPANEL_API_URL}/track`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "openpanel-client-id": clientId,
            "openpanel-client-secret": clientSecret,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.any([signal, AbortSignal.timeout(SEND_TIMEOUT_MS)]),
        }),
      catch: () => new AnalyticsDeliveryError({}),
    });
    if (!response.ok) {
      console.warn(body.type === "track" ? "Account analytics send failed." : "Account analytics identify failed.", {
        status: response.status,
      });
    }
  });
  const identify = Effect.fn("AccountAnalytics.identify")(function* (accountId: string) {
    const email = yield* Effect.tryPromise({
      try: () => readAccountEmail(options.database, accountId),
      catch: () => new AnalyticsDeliveryError({}),
    });
    if (email) yield* post({ type: "identify", payload: { profileId: accountId, email } });
  });
  return {
    track(accountId, event) {
      const properties = accountEventProperties(event);
      if (!properties || (accountId !== null && !ACCOUNT_ID_PATTERN.test(accountId))) return;
      const send = post({
        type: "track",
        payload: { name: event.name, ...(accountId === null ? {} : { profileId: accountId }), properties },
      }).pipe(Effect.catch(() => Effect.sync(() => console.warn("Account analytics send failed."))));
      const paid = accountId !== null && event.name === "billing_action" && isOneOf(PAID_BILLING_ACTIONS, event.action);
      options.schedule(
        paid
          ? Effect.all(
              [
                send,
                identify(accountId).pipe(
                  Effect.catch(() => Effect.sync(() => console.warn("Account analytics identify failed."))),
                ),
              ],
              { concurrency: 2, discard: true },
            )
          : send,
      );
    },
  };
}

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
  if (event.name === "email_sent" || event.name === "email_fallback_sent") {
    if (!isOneOf(EMAIL_KINDS, event.kind) || !isOneOf(EMAIL_RESULTS, event.result)) return null;
    return { ...properties, kind: event.kind, result: event.result };
  }
  if (event.name === "hosted_pool_snapshot") return hostedPoolProperties(properties, event.group);
  if (event.name !== "hosted_server_action" || !isOneOf(HOSTED_SERVER_ACTIONS, event.action)) return null;
  properties.action = event.action;
  if (isOneOf(BILLING_PLAN_IDS, event.plan)) properties.plan = event.plan;
  if (isOneOf(HOSTED_SERVER_SIZE_NAMES, event.size)) properties.size = event.size;
  if (isOneOf(WAKE_REASONS, event.reason)) properties.reason = event.reason;
  if (isOneOf(HOSTED_SERVER_ERRORS, event.error)) properties.error = event.error;
  if (isOneOf(HOSTED_MACHINES, event.machine)) properties.machine = event.machine;
  const duration = event.durationMs;
  if (
    event.action === "ready" &&
    typeof duration === "number" &&
    Number.isInteger(duration) &&
    duration >= 0 &&
    duration <= MAX_HOSTED_START_MS
  )
    properties.duration_ms = duration;
  return properties;
}

const POOL_LOCATION_PATTERN = /^(?:[A-Z]{3}-\d{2}|all|unknown)$/u;
const POOL_PRODUCT_PATTERN = /^(?:VPS\d{2}|all|unknown)$/u;
const POOL_COUNTS = [
  "machines",
  "free",
  "ready",
  "to_reinstall",
  "plan_ended",
  "cancel_scheduled",
  "in_use",
  "free_in_7d",
  "free_in_30d",
] as const satisfies readonly (keyof HostedPoolGroup)[];
const MAX_POOL_COUNT = 100_000;

function hostedPoolProperties(properties: AnalyticsProperties, group: HostedPoolGroup): AnalyticsProperties | null {
  if (!POOL_LOCATION_PATTERN.test(group.location) || !POOL_PRODUCT_PATTERN.test(group.product)) return null;
  const result: AnalyticsProperties = { ...properties, location: group.location, product: group.product };
  for (const key of POOL_COUNTS) {
    const count = group[key];
    if (!Number.isInteger(count) || count < 0 || count > MAX_POOL_COUNT) return null;
    result[key] = count;
  }
  return result;
}

const FIRST_TOUCH_CAMPAIGN_PROPERTIES = {
  utmSource: "first_touch_utm_source",
  utmMedium: "first_touch_utm_medium",
  utmCampaign: "first_touch_utm_campaign",
  utmContent: "first_touch_utm_content",
  utmTerm: "first_touch_utm_term",
} as const satisfies Record<(typeof FIRST_TOUCH_CAMPAIGN_FIELDS)[number], string>;

export const FIRST_TOUCH_PROPERTIES = [
  "first_touch_source",
  "first_touch_platform",
  "first_touch_landing_page",
  "first_touch_date",
  ...Object.values(FIRST_TOUCH_CAMPAIGN_PROPERTIES),
];

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
