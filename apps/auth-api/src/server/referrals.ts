import { BILLING_CURRENCIES } from "@openbot/contracts/billing";
import {
  isReferralCode,
  parseReferralPageRequest,
  REFERRAL_CODE_PARAM,
  REFERRAL_FRIEND_STATUSES,
  REFERRAL_PAGE_SIZE,
  type ReferralFilter,
  type ReferralFriend,
  type ReferralFriendStatus,
  type ReferralMoney,
  type ReferralPageRequest,
  type ReferralState,
  referralMinimum,
} from "@openbot/contracts/referral";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { type BillingError, BillingOperationError, billingCall, OPEN_STATUSES_SQL } from "./billing-errors";

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 8;
const CODE_ATTEMPTS = 4;
export interface ReferralInviter {
  firstName: string | null;
}

export interface ReferralPage {
  link: string;
  earned: ReferralMoney[];
  pending: ReferralMoney[];
  ready: ReferralMoney[];
  minimum: ReferralMoney[];
  counts: Record<ReferralFilter, number>;
  filter: ReferralFilter;
  page: number;
  friends: ReferralFriend[];
}

interface FriendRow {
  id: string;
  name: string | null;
  joined_at: number;
  paid_since: number | null;
  last_change: number | null;
  status: string;
}

interface FriendCreditRow {
  id: string;
  currency: string;
  waiting: number;
  amount: number;
}

const FRIENDS_SQL = `
  WITH friends AS (
    SELECT r.referred_user_id AS id, u.name AS name, r.created_at AS joined_at,
      (SELECT MIN(c.created_at) FROM referral_credits c WHERE c.referred_user_id = r.referred_user_id) AS paid_since,
      (SELECT MAX(changed) FROM (
        SELECT s.updated_at AS changed FROM billing_subscriptions s WHERE s.user_id = r.referred_user_id
        UNION ALL
        SELECT l.updated_at AS changed FROM licenses l WHERE l.user_id = r.referred_user_id
      )) AS last_change,
      EXISTS (
        SELECT 1 FROM billing_subscriptions s WHERE s.user_id = r.referred_user_id AND s.status IN ${OPEN_STATUSES_SQL}
        UNION ALL
        SELECT 1 FROM licenses l WHERE l.user_id = r.referred_user_id AND l.status IN ${OPEN_STATUSES_SQL}
      ) AS open,
      EXISTS (
        SELECT 1 FROM billing_subscriptions s WHERE s.user_id = r.referred_user_id AND s.status = 'canceled'
        UNION ALL
        SELECT 1 FROM licenses l WHERE l.user_id = r.referred_user_id AND l.status = 'canceled'
      ) AS ended
    FROM referrals r JOIN users u ON u.id = r.referred_user_id
    WHERE r.referrer_user_id = ?1 AND r.blocked_at IS NULL
  )
  SELECT id, name, joined_at, paid_since, last_change,
    CASE WHEN open THEN 'paying' WHEN ended OR paid_since IS NOT NULL THEN 'stopped' ELSE 'no-plan' END AS status
  FROM friends`;

export class Referrals {
  readonly #database: D1Database;
  readonly #now: () => number;

  constructor(options: { database: D1Database; now?: () => number }) {
    this.#database = options.database;
    this.#now = options.now ?? Date.now;
  }

  readonly record = Effect.fn("Referrals.record")(function* (
    this: Referrals,
    referredUserId: string,
    code: string,
  ): Effect.fn.Return<boolean, BillingError | BillingOperationError> {
    if (!isReferralCode(code)) return false;
    const result = yield* billingCall(() =>
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO referrals(referred_user_id, referrer_user_id, created_at)
           SELECT ?1, user_id, ?3 FROM referral_codes WHERE code = ?2 AND user_id <> ?1`,
        )
        .bind(referredUserId, code, this.#now())
        .run(),
    );
    return result.meta.changes === 1;
  }).bind(this);

  readonly isReferred = Effect.fn("Referrals.isReferred")(function* (
    this: Referrals,
    userId: string,
  ): Effect.fn.Return<boolean, BillingError | BillingOperationError> {
    const row = yield* billingCall(() =>
      this.#database
        .prepare("SELECT 1 AS referred FROM referrals WHERE referred_user_id = ? AND blocked_at IS NULL")
        .bind(userId)
        .first<{ referred: number }>(),
    );
    return row !== null;
  }).bind(this);

  readonly inviter = Effect.fn("Referrals.inviter")(function* (
    this: Referrals,
    code: string,
  ): Effect.fn.Return<ReferralInviter | null, BillingError | BillingOperationError> {
    if (!isReferralCode(code)) return null;
    const row = yield* billingCall(() =>
      this.#database
        .prepare("SELECT u.name AS name FROM referral_codes c JOIN users u ON u.id = c.user_id WHERE c.code = ?")
        .bind(code)
        .first<{ name: string | null }>(),
    );
    return row ? { firstName: firstName(row.name) } : null;
  }).bind(this);

  readonly page = Effect.fn("Referrals.page")(function* (
    this: Referrals,
    userId: string,
    request: ReferralPageRequest,
    siteOrigin: string,
  ): Effect.fn.Return<ReferralPage, BillingError | BillingOperationError> {
    const code = yield* this.#code(userId);
    const [countRows, earnedRows, pendingRows, readyRows] = yield* billingCall(() =>
      this.#database.batch<{ status: string; count: number } | { currency: string; amount: number }>([
        this.#database.prepare(`SELECT status, COUNT(*) AS count FROM (${FRIENDS_SQL}) GROUP BY status`).bind(userId),
        this.#database
          .prepare(
            `SELECT currency, SUM(amount - reversed_amount) AS amount FROM referral_credits
             WHERE referrer_user_id = ? AND balance_transaction_id IS NOT NULL GROUP BY currency`,
          )
          .bind(userId),
        this.#database
          .prepare(
            `SELECT currency, SUM(amount - reversed_amount) AS amount FROM referral_credits
             WHERE referrer_user_id = ? AND balance_transaction_id IS NULL AND released_at IS NULL
             GROUP BY currency`,
          )
          .bind(userId),
        this.#database
          .prepare(
            `SELECT currency, SUM(amount - reversed_amount) AS amount FROM referral_credits
             WHERE referrer_user_id = ? AND balance_transaction_id IS NULL AND released_at IS NOT NULL
             GROUP BY currency`,
          )
          .bind(userId),
      ]),
    );
    const counts: Record<ReferralFilter, number> = { all: 0, paying: 0, "no-plan": 0, stopped: 0 };
    for (const row of countRows?.results ?? []) {
      if ("status" in row && isOneOf(REFERRAL_FRIEND_STATUSES, row.status)) {
        counts[row.status] = row.count;
        counts.all += row.count;
      }
    }
    const money = (rows: typeof earnedRows | undefined): ReferralMoney[] => {
      const list: ReferralMoney[] = [];
      for (const row of rows?.results ?? []) {
        if ("currency" in row && isOneOf(BILLING_CURRENCIES, row.currency) && row.amount > 0) {
          list.push({ currency: row.currency, amountMinor: row.amount });
        }
      }
      return list;
    };
    const earned = money(earnedRows);
    const pending = money(pendingRows);
    const ready = money(readyRows);
    const minimum = BILLING_CURRENCIES.map((currency) => ({ currency, amountMinor: referralMinimum(currency) }));
    const total = counts[request.filter];
    const page = Math.min(request.page, Math.max(0, Math.ceil(total / REFERRAL_PAGE_SIZE) - 1));
    const rows =
      total === 0
        ? []
        : ((yield* billingCall(() =>
            this.#database
              .prepare(
                `SELECT * FROM (${FRIENDS_SQL}) WHERE ?2 = 'all' OR status = ?2
                 ORDER BY joined_at DESC, id LIMIT ?3 OFFSET ?4`,
              )
              .bind(userId, request.filter, REFERRAL_PAGE_SIZE, page * REFERRAL_PAGE_SIZE)
              .all<FriendRow>(),
          )).results ?? []);
    const credits = new Map<string, { earned: ReferralMoney[]; pending: ReferralMoney[] }>();
    if (rows.length > 0) {
      const creditRows = yield* billingCall(() =>
        this.#database
          .prepare(
            `SELECT referred_user_id AS id, currency, balance_transaction_id IS NULL AS waiting,
               SUM(amount - reversed_amount) AS amount
             FROM referral_credits
             WHERE referrer_user_id = ?1 AND referred_user_id IN (SELECT value FROM json_each(?2))
               AND (balance_transaction_id IS NOT NULL OR released_at IS NULL)
             GROUP BY referred_user_id, currency, waiting`,
          )
          .bind(userId, JSON.stringify(rows.map((row) => row.id)))
          .all<FriendCreditRow>(),
      );
      for (const row of creditRows.results ?? []) {
        if (!isOneOf(BILLING_CURRENCIES, row.currency) || row.amount <= 0) continue;
        const entry = credits.get(row.id) ?? { earned: [], pending: [] };
        (row.waiting ? entry.pending : entry.earned).push({ currency: row.currency, amountMinor: row.amount });
        credits.set(row.id, entry);
      }
    }
    const friends: ReferralFriend[] = [];
    for (const row of rows) {
      if (!isOneOf(REFERRAL_FRIEND_STATUSES, row.status)) continue;
      friends.push(friend(row, row.status, credits.get(row.id) ?? { earned: [], pending: [] }));
    }
    const link = new URL("/", siteOrigin);
    link.searchParams.set(REFERRAL_CODE_PARAM, code);
    return {
      link: link.toString(),
      earned,
      pending,
      ready,
      minimum,
      counts,
      filter: request.filter,
      page,
      friends,
    };
  }).bind(this);

  readonly #code = Effect.fn("Referrals.code")(function* (
    this: Referrals,
    userId: string,
  ): Effect.fn.Return<string, BillingError | BillingOperationError> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const existing = yield* billingCall(() =>
        this.#database
          .prepare("SELECT code FROM referral_codes WHERE user_id = ?")
          .bind(userId)
          .first<{ code: string }>(),
      );
      if (existing) return existing.code;
      yield* billingCall(() =>
        this.#database
          .prepare("INSERT OR IGNORE INTO referral_codes(user_id, code, created_at) VALUES (?, ?, ?)")
          .bind(userId, randomCode(), this.#now())
          .run(),
      );
    }
    return yield* new BillingOperationError({});
  }).bind(this);
}

export const referralState = Effect.fn("referralState")(function* (
  referrals: Pick<Referrals, "page">,
  credit: ((userId: string) => Effect.Effect<ReferralMoney[], BillingError | BillingOperationError>) | null,
  userId: string,
  request: ReferralPageRequest,
  siteOrigin: string,
): Effect.fn.Return<ReferralState, BillingError | BillingOperationError> {
  const page = yield* referrals.page(userId, request, siteOrigin);
  return { available: credit !== null, credit: credit ? yield* credit(userId) : [], ...page };
});

export function referralPageQuery(url: URL): ReferralPageRequest {
  const page = Number(url.searchParams.get("page") ?? "0");
  return (
    parseReferralPageRequest({ filter: url.searchParams.get("filter") ?? "all", page }) ?? { filter: "all", page: 0 }
  );
}

function friend(
  row: FriendRow,
  status: ReferralFriendStatus,
  credit: Pick<ReferralFriend, "earned" | "pending">,
): ReferralFriend {
  return {
    id: row.id,
    name: shortName(row.name),
    status,
    joinedAt: row.joined_at,
    paidSince: row.paid_since,
    stoppedAt: status === "stopped" ? row.last_change : null,
    ...credit,
  };
}

function firstName(name: string | null): string | null {
  return (name ?? "").trim().split(/\s+/u)[0]?.slice(0, 40) || null;
}

function shortName(name: string | null): string {
  const words = (name ?? "").trim().split(/\s+/u).filter(Boolean);
  const first = firstName(name) ?? "";
  const last = words.length > 1 ? words[words.length - 1]?.[0] : undefined;
  return last ? `${first} ${last.toUpperCase()}.` : first;
}

function randomCode(): string {
  const letters: string[] = [];
  while (letters.length < CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 2))) {
      if (byte < 248 && letters.length < CODE_LENGTH) letters.push(CODE_ALPHABET[byte % CODE_ALPHABET.length] ?? "");
    }
  }
  return letters.join("");
}
