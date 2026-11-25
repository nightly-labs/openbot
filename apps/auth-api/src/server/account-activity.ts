import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import type { AccountAnalytics } from "./account-analytics";

export const ACCOUNT_ACTIVITY_TIME_ZONE = "Europe/Warsaw";
export const MAX_REPORTED_ACCOUNTS = 100;
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: ACCOUNT_ACTIVITY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export class AccountActivityError extends Schema.TaggedError<AccountActivityError>()("AccountActivityError", {}) {}

export function accountActivityDay(now: number): string {
  return DAY_FORMAT.format(new Date(now));
}

export function readReportedAccounts(body: DynamicRecord): string[] | null {
  const accounts = body.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0 || accounts.length > MAX_REPORTED_ACCOUNTS) return null;
  const valid = accounts.filter((account): account is string => isString(account) && ACCOUNT_ID_PATTERN.test(account));
  return valid.length === accounts.length ? [...new Set(valid)] : null;
}

const ownedMembers = Effect.fn("AccountActivity.ownedMembers")(function* (
  database: D1Database,
  ownerId: string,
  accounts: readonly string[],
) {
  if (accounts.length === 0) return new Set<string>();
  const rows = yield* Effect.tryPromise({
    try: () =>
      database
        .prepare(
          `SELECT DISTINCT m.user_id FROM remote_memberships m
           JOIN remote_hosts h ON h.host_id = m.host_id
           WHERE h.owner_user_id = ? AND m.status = 'active' AND m.removed_at IS NULL
             AND m.user_id IN (${accounts.map(() => "?").join(", ")})`,
        )
        .bind(ownerId, ...accounts)
        .all<{ user_id: string }>(),
    catch: () => new AccountActivityError({}),
  });
  return new Set(rows.results.map((row) => row.user_id));
});

export const recordAccountActivity = Effect.fn("AccountActivity.record")(function* (
  database: D1Database,
  callerId: string,
  accounts: readonly string[],
  now: number,
) {
  const members = yield* ownedMembers(
    database,
    callerId,
    accounts.filter((account) => account !== callerId),
  );
  const recorded = accounts.filter((account) => account === callerId || members.has(account));
  if (recorded.length === 0) return { recorded: 0 };
  const day = accountActivityDay(now);
  const insert = database.prepare("INSERT OR IGNORE INTO account_active_days(day, account_id) VALUES (?, ?)");
  yield* Effect.tryPromise({
    try: () => database.batch(recorded.map((account) => insert.bind(day, account))),
    catch: () => new AccountActivityError({}),
  });
  return { recorded: recorded.length };
});

export const sendAccountActivitySnapshots = Effect.fn("AccountActivity.sendSnapshots")(function* (
  database: D1Database,
  analytics: AccountAnalytics,
  now: number,
) {
  const today = accountActivityDay(now);
  const days = yield* Effect.tryPromise({
    try: () =>
      database
        .prepare("SELECT DISTINCT day FROM account_active_days WHERE day < ? ORDER BY day")
        .bind(today)
        .all<{ day: string }>(),
    catch: () => new AccountActivityError({}),
  });
  for (const { day } of days.results) {
    const deleted = yield* Effect.tryPromise({
      try: () => database.prepare("DELETE FROM account_active_days WHERE day = ?").bind(day).run(),
      catch: () => new AccountActivityError({}),
    });
    const activeAccounts = deleted.meta.changes;
    if (activeAccounts > 0) analytics.track(null, { name: "account_activity_snapshot", day, activeAccounts });
  }
});
