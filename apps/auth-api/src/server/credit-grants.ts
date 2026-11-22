import { type CreditExpiring, creditsFromTenths, creditTenths } from "@openbot/contracts/credits";
import { LICENSE_TIERS, licenseMonthlyCredits } from "@openbot/contracts/license";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { type AccountAnalytics, NO_ACCOUNT_ANALYTICS } from "./account-analytics";
import { type BillingError, type BillingOperationError, billingCall } from "./billing-errors";

type Failure = BillingError | BillingOperationError;
type WalletColumn = "user_id" | "server_id";

const ISSUE_BATCH = 100;
const EXPIRE_BATCH = 50;

export interface CreditGrantsOptions {
  database: D1Database;
  now: () => number;
  analytics?: AccountAnalytics;
}

interface ExpiredGrantRow {
  account_id: string | null;
  server_id: string | null;
  tenths: number;
}

export interface CreditGrantSweepResult {
  issued: number;
  expired: number;
}

export interface CreditGrantSlot {
  startsAt: number;
  expiresAt: number;
}

interface LicenseRow {
  stripe_subscription_id: string;
  user_id: string;
  users: number;
  tier: string | null;
  billing_interval: string | null;
  current_period_end: number;
}

interface DueGrantRow {
  grant_id: string;
}

function addUtcMonths(at: number, months: number): number {
  const date = new Date(at);
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(
    first.getUTCFullYear(),
    first.getUTCMonth(),
    Math.min(date.getUTCDate(), lastDay),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );
}

export function licenseCreditSlot(periodEnd: number, interval: string | null, now: number): CreditGrantSlot | null {
  const months = interval === "year" ? 12 : 1;
  for (let slot = 0; slot < months; slot += 1) {
    const startsAt = addUtcMonths(periodEnd, slot - months);
    const expiresAt = slot === months - 1 ? periodEnd : addUtcMonths(periodEnd, slot + 1 - months);
    if (startsAt <= now && now < expiresAt) return { startsAt, expiresAt };
  }
  return null;
}

function licenseGrantTenths(row: LicenseRow): number {
  return creditTenths(
    licenseMonthlyCredits(isOneOf(LICENSE_TIERS, row.tier) ? row.tier : "team", Math.max(1, row.users)),
  );
}

function licenseSource(subscriptionId: string): string {
  return `license:${subscriptionId}`;
}

function orderedGrantsSql(spent: string): string {
  return `WITH spent AS (${spent}),
  ordered AS (
    SELECT g.grant_id, g.remaining_tenths AS remaining, g.starts_at, g.expires_at, spent.tenths AS amount,
           COALESCE(SUM(g.remaining_tenths) OVER (
             ORDER BY g.expires_at, g.grant_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0) AS before
      FROM credit_grants g, spent
     WHERE g.status = 'active' AND g.remaining_tenths > 0 AND spent.tenths > 0
       AND (g.user_id = spent.user_id OR g.server_id = spent.server_id)
  )`;
}

export function consumeGrantsSql(spent: string): string {
  return `${orderedGrantsSql(spent)}
  UPDATE credit_grants
     SET remaining_tenths = credit_grants.remaining_tenths - MIN(ordered.remaining, ordered.amount - ordered.before)
    FROM ordered
   WHERE credit_grants.grant_id = ordered.grant_id AND ordered.before < ordered.amount`;
}

export function moveGrantsSql(
  spent: string,
  target: { user: string; server: string; transfer: string; now: string },
): string {
  return `${orderedGrantsSql(spent)}
  INSERT INTO credit_grants(
    grant_id, user_id, server_id, credits_tenths, remaining_tenths, source, starts_at, expires_at, created_at
  )
  SELECT grant_id || ':' || ${target.transfer}, ${target.user}, ${target.server},
         MIN(remaining, amount - before), MIN(remaining, amount - before), grant_id, starts_at, expires_at, ${target.now}
    FROM ordered
   WHERE before < amount
  ON CONFLICT(grant_id) DO NOTHING`;
}

export function expiringGrantsSql(column: WalletColumn, idParam: string, nowParam: string): string {
  const live = `${column} = ${idParam} AND status = 'active' AND remaining_tenths > 0`;
  const firstExpiry = `(SELECT MIN(expires_at) FROM credit_grants WHERE ${live} AND expires_at > ${nowParam})`;
  return `(SELECT COALESCE(SUM(remaining_tenths), 0) FROM credit_grants WHERE ${live} AND expires_at = ${firstExpiry}) AS expiring_tenths,
    ${firstExpiry} AS expiring_at`;
}

export function creditExpiring(
  row: { expiring_tenths: number; expiring_at: number | null },
  balanceTenths: number,
): CreditExpiring | null {
  const tenths = Math.min(row.expiring_tenths, balanceTenths);
  return row.expiring_at === null || tenths <= 0
    ? null
    : { credits: creditsFromTenths(tenths), expiresAt: row.expiring_at };
}

export class CreditGrants {
  readonly #database: D1Database;
  readonly #now: () => number;
  readonly #analytics: AccountAnalytics;

  constructor(options: CreditGrantsOptions) {
    this.#database = options.database;
    this.#now = options.now;
    this.#analytics = options.analytics ?? NO_ACCOUNT_ANALYTICS;
  }

  readonly issue = Effect.fn("CreditGrants.issue")(function* (
    this: CreditGrants,
    subscriptionId: string | null,
  ): Effect.fn.Return<number, Failure> {
    const now = this.#now();
    const licenses = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT l.stripe_subscription_id, l.user_id, l.users, l.tier, l.billing_interval, l.current_period_end
             FROM licenses l
            WHERE l.status = 'active' AND l.current_period_end > ?1
              AND (?2 IS NULL OR l.stripe_subscription_id = ?2)
              AND NOT EXISTS (
                SELECT 1 FROM credit_grants g
                 WHERE g.source = 'license:' || l.stripe_subscription_id AND g.expires_at > ?1
              )
            ORDER BY l.current_period_end
            LIMIT ?3`,
        )
        .bind(now, subscriptionId, ISSUE_BATCH)
        .all<LicenseRow>(),
    );
    let issued = 0;
    for (const license of licenses.results) {
      const slot = licenseCreditSlot(license.current_period_end, license.billing_interval, now);
      if (!slot) continue;
      const source = licenseSource(license.stripe_subscription_id);
      const grantId = `${source}:${slot.startsAt}`;
      const [inserted] = yield* billingCall(() =>
        this.#database.batch([
          this.#database
            .prepare(
              `INSERT INTO credit_grants(
                 grant_id, user_id, server_id, credits_tenths, remaining_tenths, source, starts_at, expires_at,
                 created_at
               )
               SELECT ?1, ?2, NULL, ?3, ?3, ?4, ?5, ?6, ?7
                WHERE EXISTS (SELECT 1 FROM users WHERE id = ?2)
                  AND NOT EXISTS (SELECT 1 FROM credit_grants WHERE source = ?4 AND expires_at > ?7)
               ON CONFLICT(grant_id) DO NOTHING`,
            )
            .bind(grantId, license.user_id, licenseGrantTenths(license), source, slot.startsAt, slot.expiresAt, now),
          this.#database
            .prepare(
              `INSERT INTO credit_ledger(
                 entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at
               )
               SELECT 'grant:' || grant_id, user_id, NULL, credits_tenths, 'grant', NULL, grant_id, created_at
                 FROM credit_grants WHERE grant_id = ?1
               ON CONFLICT(entry_id) DO NOTHING`,
            )
            .bind(grantId),
        ]),
      );
      if (inserted?.meta.changes !== 1) continue;
      issued += 1;
      this.#analytics.track(license.user_id, {
        name: "credit_action",
        action: "granted",
        wallet: "personal",
        credits: creditsFromTenths(licenseGrantTenths(license)),
      });
    }
    return issued;
  }).bind(this);

  readonly expire = Effect.fn("CreditGrants.expire")(function* (this: CreditGrants): Effect.fn.Return<number, Failure> {
    const now = this.#now();
    const due = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT grant_id FROM credit_grants
            WHERE status = 'active' AND expires_at <= ?1
            ORDER BY expires_at LIMIT ?2`,
        )
        .bind(now, EXPIRE_BATCH)
        .all<DueGrantRow>(),
    );
    let expired = 0;
    for (const row of due.results) {
      const [lost, closed] = yield* billingCall(() =>
        this.#database.batch<ExpiredGrantRow>([
          this.#database
            .prepare(
              `WITH wallet AS (
                 SELECT g.grant_id, g.user_id, g.server_id, g.remaining_tenths AS remaining,
                        COALESCE((SELECT SUM(amount_tenths) FROM credit_ledger WHERE user_id = g.user_id), 0)
                          + COALESCE((SELECT SUM(amount_tenths) FROM credit_ledger WHERE server_id = g.server_id), 0)
                          AS ledger,
                        COALESCE((
                          SELECT SUM(credits_tenths) FROM credit_holds WHERE status = 'held' AND user_id = g.user_id
                        ), 0)
                          + COALESCE((
                            SELECT SUM(credits_tenths) FROM credit_holds WHERE status = 'held' AND server_id = g.server_id
                          ), 0)
                          AS held
                   FROM credit_grants g
                  WHERE g.grant_id = ?1 AND g.status = 'active'
               ),
               lost AS (
                 SELECT grant_id, user_id, server_id,
                        MIN(MAX(0, remaining - held), MAX(0, ledger - held)) AS tenths
                   FROM wallet
               )
               INSERT INTO credit_ledger(
                 entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at
               )
               SELECT 'expiry:' || grant_id, user_id, server_id, -tenths, 'expiry', NULL, grant_id, ?2
                 FROM lost WHERE tenths > 0
               ON CONFLICT(entry_id) DO NOTHING
               RETURNING server_id, -amount_tenths AS tenths, COALESCE(
                 user_id, (SELECT owner_user_id FROM remote_hosts WHERE host_id = credit_ledger.server_id)
               ) AS account_id`,
            )
            .bind(row.grant_id, now),
          this.#database
            .prepare("UPDATE credit_grants SET status = 'expired' WHERE grant_id = ?1 AND status = 'active'")
            .bind(row.grant_id),
        ]),
      );
      if (closed?.meta.changes !== 1) continue;
      expired += 1;
      for (const entry of lost?.results ?? []) this.#trackExpired(entry);
    }
    return expired;
  }).bind(this);

  #trackExpired(entry: ExpiredGrantRow): void {
    this.#analytics.track(entry.account_id, {
      name: "credit_action",
      action: "grant_expired",
      wallet: entry.server_id === null ? "personal" : "server",
      credits: creditsFromTenths(entry.tenths),
    });
  }

  readonly sweep = Effect.fn("CreditGrants.sweep")(function* (
    this: CreditGrants,
  ): Effect.fn.Return<CreditGrantSweepResult, Failure> {
    const expired = yield* this.expire();
    const issued = yield* this.issue(null);
    return { issued, expired };
  }).bind(this);
}
