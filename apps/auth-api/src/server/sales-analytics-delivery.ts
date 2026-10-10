import { isDynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import { ACCOUNT_ANALYTICS_SCHEMA_VERSION } from "./account-analytics";

const OPENPANEL_API_URL = "https://analytics.openbot.run/api";
const SEND_TIMEOUT_MS = 5_000;
const CLAIM_TIMEOUT_MS = 5 * 60_000;
const MAX_BATCH_SIZE = 50;
const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_RETRY_DELAY_MS = 60_000;

const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const SOURCE_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,512}$/u;
const SAFE_VALUE_PATTERN = /^[A-Za-z0-9_.:/+-]{1,128}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const BILLING_ACTIONS = [
  "checkout_started",
  "checkout_returned",
  "checkout_expired",
  "plan_started",
  "payment_succeeded",
  "payment_failed",
  "payment_recovered",
  "plan_changed",
  "cancel_scheduled",
  "cancel_withdrawn",
  "plan_ended",
  "portal_opened",
  "server_ready",
  "server_setup_failed",
] as const;
const BILLING_PLANS = ["starter", "standard", "pro"] as const;
const BILLING_INTERVALS = ["month", "year"] as const;
const BILLING_CURRENCIES = ["eur", "usd", "pln"] as const;
const BILLING_PAYMENT_KINDS = ["first_purchase", "renewal", "adjustment"] as const;
const BILLING_RECOVERY_KINDS = ["invoice", "checkout", "invoice_recovery", "checkout_recovery", "none"] as const;
const BILLING_FLOWS = ["manage", "update", "cancel"] as const;
const BILLING_SUBSCRIPTION_STATUSES = [
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "trialing",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;

const SALES_ANALYTICS_EVENT_NAMES = ["billing_action", "revenue", "billing_snapshot"] as const;
type SalesAnalyticsEventName = (typeof SALES_ANALYTICS_EVENT_NAMES)[number];

/** The only event properties that the account Worker may send to OpenPanel. */
const SALES_ANALYTICS_EVENT_PROPERTIES = {
  billing_action: [
    "action",
    "plan",
    "interval",
    "currency",
    "amount",
    "original_amount",
    "amount_usd",
    "fx_rate",
    "fx_date",
    "flow",
    "checkout_status",
    "failure_reason",
    "recovery",
    "subscription_status",
    "server_status",
  ],
  revenue: [
    "__revenue",
    "amount_usd",
    "original_amount",
    "currency",
    "original_currency",
    "fx_rate",
    "fx_date",
    "plan",
    "interval",
    "payment_kind",
    "recovery",
  ],
  billing_snapshot: [
    "snapshot_date",
    "as_of",
    "reported_at",
    "currency",
    "mrr",
    "arr",
    "overdue_mrr",
    "paying_accounts",
    "paid_servers",
    "cancellations_scheduled",
    "checkout_mature_accounts",
    "checkout_converted_accounts",
    "checkout_pending_accounts",
  ],
} as const satisfies Record<SalesAnalyticsEventName, readonly string[]>;

export type SalesAnalyticsProperties = Record<string, string | number>;

export interface SalesAnalyticsDrainSummary {
  claimed: number;
  sent: number;
  rejected: number;
  uncertain: number;
  pending: number;
}

export class SalesAnalyticsDeliveryError extends Schema.TaggedError<SalesAnalyticsDeliveryError>()(
  "SalesAnalyticsDeliveryError",
  {
    code: Schema.Literals(["invalid_event", "database", "delivery"]),
  },
) {}

export interface SalesAnalyticsDeliveryOptions {
  database: D1Database;
  clientId: string | undefined;
  clientSecret: string | undefined;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
}

interface LedgerEvent {
  source_key: string;
  profile_id: string | null;
  event_name: SalesAnalyticsEventName;
  properties_json: string;
  event_timestamp: number;
  attempts: number;
  claim_token: string;
}

interface DeliveryOutcome {
  status: "sent" | "rejected" | "uncertain";
  httpStatus: number | null;
  retryAt: number | null;
  error: string | null;
}

/**
 * Durable, server-side delivery for account sales events.
 *
 * The ledger is deliberately separate from the existing account analytics sender. It keeps the
 * source key forever and never retries an outcome for which the HTTP result is unknown.
 */
export class SalesAnalyticsDelivery {
  readonly #database: D1Database;
  readonly #clientId: string | undefined;
  readonly #clientSecret: string | undefined;
  readonly #fetch: (input: string, init: RequestInit) => Promise<Response>;
  readonly #now: () => number;

  constructor(options: SalesAnalyticsDeliveryOptions) {
    this.#database = options.database;
    this.#clientId = options.clientId?.trim() || undefined;
    this.#clientSecret = options.clientSecret?.trim() || undefined;
    this.#fetch = options.fetch;
    this.#now = options.now ?? Date.now;
  }

  enqueue(
    sourceKey: string,
    profileId: string | null,
    name: string,
    properties: SalesAnalyticsProperties,
    timestamp: number,
  ): Effect.Effect<void, SalesAnalyticsDeliveryError> {
    return Effect.tryPromise({
      try: async () => {
        const event = validateEvent(sourceKey, profileId, name, properties, timestamp);
        const now = this.#now();
        await this.#database
          .prepare(
            `INSERT OR IGNORE INTO billing_analytics_events(
               source_key, profile_id, event_name, properties_json, event_timestamp, status, attempts,
               next_attempt_at, claimed_at, claim_token, last_status, last_error, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 'pending', 0, 0, NULL, NULL, NULL, NULL, ?, ?)`,
          )
          .bind(sourceKey, profileId, event.name, JSON.stringify(event.properties), timestamp, now, now)
          .run();
      },
      catch: (error) =>
        error instanceof SalesAnalyticsDeliveryError ? error : new SalesAnalyticsDeliveryError({ code: "database" }),
    });
  }

  drain(): Effect.Effect<SalesAnalyticsDrainSummary, SalesAnalyticsDeliveryError> {
    return Effect.tryPromise({
      try: async () => {
        const now = this.#now();
        await this.#recoverExpiredClaims(now);
        const rows = await this.#readyEvents(now);
        const summary: SalesAnalyticsDrainSummary = {
          claimed: 0,
          sent: 0,
          rejected: 0,
          uncertain: 0,
          pending: rows.length,
        };
        if (!this.#clientId || !this.#clientSecret) return summary;

        for (const row of rows) {
          const claimed = await this.#claim(row.source_key, now);
          if (!claimed) continue;
          summary.claimed += 1;
          const outcome = await this.#send(claimed);
          await this.#recordOutcome(claimed, outcome, now);
          summary[outcome.status] += 1;
        }
        return summary;
      },
      catch: (error) =>
        error instanceof SalesAnalyticsDeliveryError ? error : new SalesAnalyticsDeliveryError({ code: "database" }),
    });
  }

  async #send(row: LedgerEvent): Promise<DeliveryOutcome> {
    let properties: SalesAnalyticsProperties;
    try {
      const parsed = JSON.parse(row.properties_json);
      if (!isEventProperties(parsed))
        return { status: "rejected", httpStatus: null, retryAt: null, error: "invalid_properties" };
      if (!Number.isFinite(new Date(row.event_timestamp).getTime())) {
        return { status: "rejected", httpStatus: null, retryAt: null, error: "invalid_timestamp" };
      }
      properties = parsed;
    } catch {
      return { status: "rejected", httpStatus: null, retryAt: null, error: "invalid_properties" };
    }

    const payload: {
      name: string;
      profileId?: string;
      properties: SalesAnalyticsProperties;
    } = {
      name: row.event_name,
      properties: { ...properties, __timestamp: new Date(row.event_timestamp).toISOString() },
    };
    if (row.profile_id) payload.profileId = row.profile_id;

    let response: Response;
    try {
      const clientId = this.#clientId;
      const clientSecret = this.#clientSecret;
      if (!clientId || !clientSecret) {
        return { status: "uncertain", httpStatus: null, retryAt: null, error: "credentials_unavailable" };
      }
      response = await this.#fetch(`${OPENPANEL_API_URL}/track`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "openpanel-client-id": clientId,
          "openpanel-client-secret": clientSecret,
          "openpanel-sdk-name": "openbot-account-api",
        },
        body: JSON.stringify({ type: "track", payload }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      return { status: "uncertain", httpStatus: null, retryAt: null, error: "transport_unknown" };
    }

    if (response.ok) return { status: "sent", httpStatus: response.status, retryAt: null, error: null };
    if (response.status === 429) {
      const retryAt = row.attempts <= MAX_RATE_LIMIT_RETRIES ? this.#now() + RATE_LIMIT_RETRY_DELAY_MS : null;
      return { status: "rejected", httpStatus: response.status, retryAt, error: "rate_limited" };
    }
    if (response.status >= 400 && response.status < 500) {
      return { status: "rejected", httpStatus: response.status, retryAt: null, error: "http_rejected" };
    }
    return { status: "uncertain", httpStatus: response.status, retryAt: null, error: "http_unknown" };
  }

  async #claim(sourceKey: string, now: number): Promise<LedgerEvent | null> {
    const token = crypto.randomUUID();
    const results = await this.#database.batch<unknown>([
      this.#database
        .prepare(
          `UPDATE billing_analytics_events
             SET status = 'sending', attempts = attempts + 1, claimed_at = ?, claim_token = ?, updated_at = ?
           WHERE source_key = ? AND (status = 'pending' OR (status = 'rejected' AND next_attempt_at > 0 AND next_attempt_at <= ? AND attempts < ?))`,
        )
        .bind(now, token, now, sourceKey, now, MAX_RATE_LIMIT_RETRIES),
      this.#database
        .prepare(
          `SELECT source_key, profile_id, event_name, properties_json, event_timestamp, attempts, claim_token
             FROM billing_analytics_events
            WHERE source_key = ? AND status = 'sending' AND claim_token = ?`,
        )
        .bind(sourceKey, token),
    ]);
    const candidate = results[1]?.results[0];
    return isLedgerEvent(candidate) ? candidate : null;
  }

  async #recordOutcome(row: LedgerEvent, outcome: DeliveryOutcome, now: number): Promise<void> {
    await this.#database
      .prepare(
        `UPDATE billing_analytics_events
            SET status = ?, next_attempt_at = ?, claimed_at = NULL, claim_token = NULL,
                last_status = ?, last_error = ?, updated_at = ?
          WHERE source_key = ? AND status = 'sending' AND claim_token = ?`,
      )
      .bind(
        outcome.status,
        outcome.retryAt ?? 0,
        outcome.httpStatus,
        outcome.error,
        now,
        row.source_key,
        row.claim_token,
      )
      .run();
  }

  async #recoverExpiredClaims(now: number): Promise<void> {
    await this.#database
      .prepare(
        `UPDATE billing_analytics_events
            SET status = 'uncertain', claimed_at = NULL, claim_token = NULL,
                last_error = 'claim_expired', updated_at = ?
          WHERE status = 'sending' AND claimed_at IS NOT NULL AND claimed_at <= ?`,
      )
      .bind(now, now - CLAIM_TIMEOUT_MS)
      .run();
  }

  async #readyEvents(now: number): Promise<LedgerEvent[]> {
    const result = await this.#database
      .prepare(
        `SELECT source_key, profile_id, event_name, properties_json, event_timestamp, attempts, '' AS claim_token
           FROM billing_analytics_events
          WHERE status = 'pending' OR (status = 'rejected' AND next_attempt_at > 0 AND next_attempt_at <= ? AND attempts < ?)
          ORDER BY created_at ASC LIMIT ?`,
      )
      .bind(now, MAX_RATE_LIMIT_RETRIES, MAX_BATCH_SIZE)
      .all<unknown>();
    return result.results.filter(isLedgerEvent);
  }
}

interface ValidatedEvent {
  name: SalesAnalyticsEventName;
  properties: SalesAnalyticsProperties;
}

function validateEvent(
  sourceKey: string,
  profileId: string | null,
  name: string,
  properties: SalesAnalyticsProperties,
  timestamp: number,
): ValidatedEvent {
  if (!SOURCE_KEY_PATTERN.test(sourceKey) || (profileId !== null && !PROFILE_ID_PATTERN.test(profileId))) {
    throw new SalesAnalyticsDeliveryError({ code: "invalid_event" });
  }
  if (!isOneOf(SALES_ANALYTICS_EVENT_NAMES, name)) {
    throw new SalesAnalyticsDeliveryError({ code: "invalid_event" });
  }
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !Number.isFinite(new Date(timestamp).getTime())) {
    throw new SalesAnalyticsDeliveryError({ code: "invalid_event" });
  }
  if (!isEventProperties(properties)) throw new SalesAnalyticsDeliveryError({ code: "invalid_event" });
  const allowed = SALES_ANALYTICS_EVENT_PROPERTIES[name];
  for (const key of Object.keys(properties)) {
    if (!allowed.some((candidate) => candidate === key)) {
      throw new SalesAnalyticsDeliveryError({ code: "invalid_event" });
    }
  }
  const output: SalesAnalyticsProperties = {
    surface: "account_api",
    environment: "production",
    event_schema_version: ACCOUNT_ANALYTICS_SCHEMA_VERSION,
    ...properties,
  };
  if (name === "billing_action" && typeof output.action !== "string") {
    throw new SalesAnalyticsDeliveryError({ code: "invalid_event" });
  }
  const revenue = output.__revenue;
  if (name === "revenue" && (typeof revenue !== "number" || !Number.isSafeInteger(revenue) || revenue < 0)) {
    throw new SalesAnalyticsDeliveryError({ code: "invalid_event" });
  }
  if (!eventPropertyValuesAreValid(output)) throw new SalesAnalyticsDeliveryError({ code: "invalid_event" });
  return { name, properties: output };
}

function eventPropertyValuesAreValid(properties: SalesAnalyticsProperties): boolean {
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return false;
      if (
        [
          "__revenue",
          "amount",
          "original_amount",
          "amount_usd",
          "mrr",
          "arr",
          "overdue_mrr",
          "paying_accounts",
          "paid_servers",
          "cancellations_scheduled",
          "checkout_mature_accounts",
          "checkout_converted_accounts",
          "checkout_pending_accounts",
          "as_of",
          "reported_at",
        ].includes(key)
      ) {
        if (!Number.isSafeInteger(value) || value < 0) return false;
      }
      if (["fx_rate"].includes(key) && value <= 0) return false;
      continue;
    }
    if (key === "action" && !isOneOf(BILLING_ACTIONS, value)) return false;
    if (key === "plan" && !isOneOf(BILLING_PLANS, value)) return false;
    if (key === "interval" && !isOneOf(BILLING_INTERVALS, value)) return false;
    if (["currency", "original_currency"].includes(key) && !isOneOf(BILLING_CURRENCIES, value)) return false;
    if (key === "payment_kind" && !isOneOf(BILLING_PAYMENT_KINDS, value)) return false;
    if (key === "recovery" && !isOneOf(BILLING_RECOVERY_KINDS, value)) return false;
    if (key === "flow" && !isOneOf(BILLING_FLOWS, value)) return false;
    if (key === "subscription_status" && !isOneOf(BILLING_SUBSCRIPTION_STATUSES, value)) return false;
    if (["fx_date", "snapshot_date"].includes(key) && !DATE_PATTERN.test(value)) return false;
  }
  return true;
}

function isLedgerEvent(value: unknown): value is LedgerEvent {
  return (
    isDynamicRecord(value) &&
    typeof value.source_key === "string" &&
    (value.profile_id === null || typeof value.profile_id === "string") &&
    isOneOf(SALES_ANALYTICS_EVENT_NAMES, value.event_name) &&
    typeof value.properties_json === "string" &&
    typeof value.event_timestamp === "number" &&
    Number.isFinite(value.event_timestamp) &&
    typeof value.attempts === "number" &&
    Number.isSafeInteger(value.attempts) &&
    typeof value.claim_token === "string"
  );
}

function isEventProperties(value: unknown): value is SalesAnalyticsProperties {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const [key, item] of Object.entries(value)) {
    if (key === "__timestamp") return false;
    if (typeof item === "number") {
      if (!Number.isFinite(item) || Math.abs(item) > Number.MAX_SAFE_INTEGER) return false;
    } else if (typeof item === "string") {
      if (item.length > 256) return false;
      if (!SAFE_VALUE_PATTERN.test(item)) return false;
    } else {
      return false;
    }
  }
  return true;
}
