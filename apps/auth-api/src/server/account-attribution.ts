import { FIRST_TOUCH_CAMPAIGN_FIELDS, type FirstTouch, parseFirstTouch } from "@openbot/contracts/first-touch";
import { Effect, Schema } from "effect";
import { safeScreenPath } from "../lib/analytics";
import type { AccountAnalytics, AttributionSource } from "./account-analytics";

const CHECKOUT_ATTRIBUTION_WINDOW_MS = 24 * 60 * 60_000;
const CHECKOUT_SESSION_PATTERN = /^cs_[A-Za-z0-9_]{1,250}$/u;

const CAMPAIGN_COLUMNS = {
  utmSource: "utm_source",
  utmMedium: "utm_medium",
  utmCampaign: "utm_campaign",
  utmContent: "utm_content",
  utmTerm: "utm_term",
} as const satisfies Record<(typeof FIRST_TOUCH_CAMPAIGN_FIELDS)[number], string>;

interface AttributionRow {
  acquisition_source: string;
  source_platform: string;
  landing_page: string;
  first_visit_on: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
}

export class AccountAttributionError extends Schema.TaggedError<AccountAttributionError>()(
  "AccountAttributionError",
  {},
) {}

export function requestFirstTouch(value: unknown): FirstTouch | null {
  const touch = parseFirstTouch(value);
  return touch && safeScreenPath(touch.landingPage) === touch.landingPage ? touch : null;
}

export class AccountAttribution {
  readonly #database: D1Database;
  readonly #analytics: AccountAnalytics;
  readonly #now: () => number;

  constructor(options: { database: D1Database; analytics: AccountAnalytics; now?: () => number }) {
    this.#database = options.database;
    this.#analytics = options.analytics;
    this.#now = options.now ?? Date.now;
  }

  readonly record = Effect.fn("AccountAttribution.record")(function* (
    this: AccountAttribution,
    userId: string,
    touch: FirstTouch,
    via: AttributionSource,
  ): Effect.fn.Return<boolean, AccountAttributionError> {
    const result = yield* d1(() =>
      this.#database
        .prepare(
          `INSERT INTO account_attribution(
             user_id, acquisition_source, source_platform, landing_page, first_visit_on,
             utm_source, utm_medium, utm_campaign, utm_content, utm_term, recorded_via, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO NOTHING`,
        )
        .bind(
          userId,
          touch.acquisitionSource,
          touch.sourcePlatform,
          touch.landingPage,
          touch.firstVisitOn,
          touch.utmSource ?? null,
          touch.utmMedium ?? null,
          touch.utmCampaign ?? null,
          touch.utmContent ?? null,
          touch.utmTerm ?? null,
          via,
          this.#now(),
        )
        .run(),
    );
    const saved = result.meta.changes === 1;
    if (saved) this.#analytics.track(userId, { name: "account_attributed", via, firstTouch: touch });
    return saved;
  }).bind(this);

  readonly recordCheckout = Effect.fn("AccountAttribution.recordCheckout")(function* (
    this: AccountAttribution,
    sessionId: string,
    touch: FirstTouch,
  ): Effect.fn.Return<boolean, AccountAttributionError> {
    if (!CHECKOUT_SESSION_PATTERN.test(sessionId)) return false;
    const checkout = yield* d1(() =>
      this.#database
        .prepare("SELECT user_id FROM billing_sales_checkouts WHERE session_id = ? AND created_at > ?")
        .bind(sessionId, this.#now() - CHECKOUT_ATTRIBUTION_WINDOW_MS)
        .first<{ user_id: string }>(),
    );
    if (!checkout) return false;
    return yield* this.record(checkout.user_id, touch, "checkout");
  }).bind(this);

  readonly read = Effect.fn("AccountAttribution.read")(function* (
    this: AccountAttribution,
    userId: string,
  ): Effect.fn.Return<FirstTouch | null, AccountAttributionError> {
    const row = yield* d1(() =>
      this.#database
        .prepare(
          `SELECT acquisition_source, source_platform, landing_page, first_visit_on,
                  utm_source, utm_medium, utm_campaign, utm_content, utm_term
             FROM account_attribution WHERE user_id = ?`,
        )
        .bind(userId)
        .first<AttributionRow>(),
    );
    if (!row) return null;
    const stored: Record<string, string> = {
      acquisitionSource: row.acquisition_source,
      sourcePlatform: row.source_platform,
      landingPage: row.landing_page,
      firstVisitOn: row.first_visit_on,
    };
    for (const field of FIRST_TOUCH_CAMPAIGN_FIELDS) {
      const value = row[CAMPAIGN_COLUMNS[field]];
      if (value) stored[field] = value;
    }
    return parseFirstTouch(stored);
  }).bind(this);
}

function d1<A>(operation: () => Promise<A>): Effect.Effect<A, AccountAttributionError> {
  return Effect.tryPromise({ try: operation, catch: () => new AccountAttributionError({}) });
}
