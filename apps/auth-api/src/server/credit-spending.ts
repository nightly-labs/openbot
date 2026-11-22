import { CREDIT_MEDIA_KINDS } from "@openbot/contracts/credit-media";
import { creditsFromTenths, creditTenths } from "@openbot/contracts/credits";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit } from "effect";
import { type AccountAnalytics, type CreditActionEvent, NO_ACCOUNT_ANALYTICS } from "./account-analytics";
import { BillingError, type BillingOperationError, billingCall } from "./billing-errors";
import { consumeGrantsSql } from "./credit-grants";

type Failure = BillingError | BillingOperationError;
type WalletColumn = "user_id" | "server_id";

export const CREDIT_HOLD_START_GRACE_MS = 10 * 60 * 1_000;
export const CREDIT_HOLD_FIRST_CHECK_MS = 15 * 60 * 1_000;
const CREDIT_HOLD_MAX_CHECK_GAP_MS = 60 * 60 * 1_000;
export const CREDIT_HOLD_LIMIT_MS = 24 * 60 * 60 * 1_000;
const SWEEP_BATCH = 50;

export type CreditWallet = { userId: string } | { serverId: string };
type CreditHoldStatus = "held" | "charged" | "released";
export type CreditHoldOutcome = "completed" | "failed" | "canceled" | "refused" | "abandoned" | "expired";
export type CreditJobResult =
  | { outcome: "completed"; charged?: number }
  | { outcome: "failed" | "canceled" | "refused" };
export type CreditJobCheck =
  | { status: "running" }
  | { status: "completed"; charged?: number }
  | { status: "failed" | "canceled" };
export type CreditJobChecker = (providerJobId: string, jobId: string) => Effect.Effect<CreditJobCheck, Failure>;

export interface CreditHoldInput {
  jobId: string;
  wallet: CreditWallet;
  actorUserId: string | null;
  modelId: string;
  credits: number;
}

export interface CreditHold {
  jobId: string;
  userId: string | null;
  serverId: string | null;
  actorUserId: string | null;
  modelId: string;
  credits: number;
  status: CreditHoldStatus;
  outcome: CreditHoldOutcome | null;
  charged: number | null;
  providerJobId: string | null;
}

export interface CreditSweepResult {
  abandoned: number;
  settled: number;
  rechecked: number;
  expired: number;
}

export interface CreditSpendingOptions {
  database: D1Database;
  now: () => number;
  analytics?: AccountAnalytics;
}

export type CreditMediaDetails = Pick<CreditActionEvent, "resolution" | "duration" | "count" | "audio">;

interface TrackedHoldRow {
  account_id: string | null;
  server_id: string | null;
  model_id: string;
  kind: string | null;
  credits_tenths: number;
  charged_tenths: number | null;
  outcome: string | null;
}

const TRACKED_HOLD_SQL = `RETURNING server_id, model_id, credits_tenths, charged_tenths, outcome,
  COALESCE(actor_user_id, user_id, (SELECT owner_user_id FROM remote_hosts WHERE host_id = credit_holds.server_id))
    AS account_id,
  (SELECT kind FROM credit_media_models WHERE model_id = credit_holds.model_id) AS kind`;

interface HoldRow {
  job_id: string;
  user_id: string | null;
  server_id: string | null;
  actor_user_id: string | null;
  model_id: string;
  credits_tenths: number;
  status: string;
  outcome: string | null;
  charged_tenths: number | null;
  provider_job_id: string | null;
}

interface DueRow {
  job_id: string;
  provider_job_id: string;
  created_at: number;
  expires_at: number;
}

const HOLD_STATUSES: readonly CreditHoldStatus[] = ["held", "charged", "released"];
const HOLD_OUTCOMES: readonly CreditHoldOutcome[] = [
  "completed",
  "failed",
  "canceled",
  "refused",
  "abandoned",
  "expired",
];

export function availableTenthsSql(column: WalletColumn, idParam: string): string {
  return `((SELECT COALESCE(SUM(amount_tenths), 0) FROM credit_ledger WHERE ${column} = ${idParam})
    - (SELECT COALESCE(SUM(credits_tenths), 0) FROM credit_holds WHERE ${column} = ${idParam} AND status = 'held'))`;
}

function walletIds(wallet: CreditWallet): { userId: string | null; serverId: string | null } {
  return "userId" in wallet ? { userId: wallet.userId, serverId: null } : { userId: null, serverId: wallet.serverId };
}

function spenderSql(wallet: CreditWallet): string {
  if ("userId" in wallet) return "?4 IS NOT NULL AND ?4 = ?2 AND EXISTS (SELECT 1 FROM users WHERE id = ?2)";
  return `EXISTS (SELECT 1 FROM remote_hosts WHERE host_id = ?3) AND (?4 IS NULL OR EXISTS (
    SELECT 1 FROM remote_memberships m WHERE m.host_id = ?3 AND m.user_id = ?4 AND m.status = 'active'
  ))`;
}

function toHold(row: HoldRow): CreditHold {
  return {
    jobId: row.job_id,
    userId: row.user_id,
    serverId: row.server_id,
    actorUserId: row.actor_user_id,
    modelId: row.model_id,
    credits: creditsFromTenths(row.credits_tenths),
    status: isOneOf(HOLD_STATUSES, row.status) ? row.status : "held",
    outcome: isOneOf(HOLD_OUTCOMES, row.outcome) ? row.outcome : null,
    charged: row.charged_tenths === null ? null : creditsFromTenths(row.charged_tenths),
    providerJobId: row.provider_job_id,
  };
}

function sameRequest(hold: CreditHold, input: CreditHoldInput): boolean {
  const ids = walletIds(input.wallet);
  return (
    hold.userId === ids.userId &&
    hold.serverId === ids.serverId &&
    hold.actorUserId === input.actorUserId &&
    hold.modelId === input.modelId &&
    creditTenths(hold.credits) === creditTenths(input.credits)
  );
}

function holdEvent(row: TrackedHoldRow): CreditActionEvent {
  return {
    name: "credit_action",
    action: "media_started",
    wallet: row.server_id === null ? "personal" : "server",
    credits: creditsFromTenths(row.credits_tenths),
    modelId: row.model_id,
    kind: isOneOf(CREDIT_MEDIA_KINDS, row.kind) ? row.kind : null,
  };
}

function settledEvent(row: TrackedHoldRow): CreditActionEvent {
  const held = creditsFromTenths(row.credits_tenths);
  return {
    ...holdEvent(row),
    action: row.charged_tenths === null ? "media_released" : "media_charged",
    credits: row.charged_tenths === null ? held : creditsFromTenths(row.charged_tenths),
    creditsHeld: held,
    outcome: isOneOf(HOLD_OUTCOMES, row.outcome) ? row.outcome : null,
  };
}

function nextCheckAt(now: number, createdAt: number): number {
  return now + Math.min(CREDIT_HOLD_MAX_CHECK_GAP_MS, Math.max(CREDIT_HOLD_FIRST_CHECK_MS, now - createdAt));
}

function checkResult(check: CreditJobCheck): CreditJobResult | null {
  if (check.status === "running") return null;
  if (check.status !== "completed") return { outcome: check.status };
  return check.charged === undefined ? { outcome: "completed" } : { outcome: "completed", charged: check.charged };
}

export class CreditSpending {
  readonly #database: D1Database;
  readonly #now: () => number;
  readonly #analytics: AccountAnalytics;

  constructor(options: CreditSpendingOptions) {
    this.#database = options.database;
    this.#now = options.now;
    this.#analytics = options.analytics ?? NO_ACCOUNT_ANALYTICS;
  }

  #trackSettled(rows: readonly TrackedHoldRow[]): void {
    for (const row of rows) this.#analytics.track(row.account_id, settledEvent(row));
  }

  readonly hold = Effect.fn("CreditSpending.hold")(function* (
    this: CreditSpending,
    input: CreditHoldInput,
  ): Effect.fn.Return<CreditHold, Failure> {
    const ids = walletIds(input.wallet);
    const column: WalletColumn = ids.userId === null ? "server_id" : "user_id";
    const now = this.#now();
    yield* billingCall(() =>
      this.#database
        .prepare(
          `INSERT INTO credit_holds(
             job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at
           )
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
            WHERE ${spenderSql(input.wallet)}
              AND ${availableTenthsSql(column, "?10")} >= ?6
           ON CONFLICT(job_id) DO NOTHING`,
        )
        .bind(
          input.jobId,
          ids.userId,
          ids.serverId,
          input.actorUserId,
          input.modelId,
          creditTenths(input.credits),
          now,
          now + CREDIT_HOLD_FIRST_CHECK_MS,
          now + CREDIT_HOLD_LIMIT_MS,
          ids.userId ?? ids.serverId,
        )
        .run(),
    );
    const stored = yield* this.find(input.jobId);
    if (stored) {
      if (sameRequest(stored, input)) return stored;
      return yield* new BillingError(409, "credits_job_conflict", sourceText("error.billing.creditsJobConflict"));
    }
    const allowed = yield* billingCall(() =>
      this.#database
        .prepare(`SELECT 1 AS allowed WHERE ${spenderSql(input.wallet)}`)
        .bind(null, ids.userId, ids.serverId, input.actorUserId)
        .first<{ allowed: number }>(),
    );
    if (!allowed)
      return yield* new BillingError(403, "credits_spend_member", sourceText("error.billing.creditsSpendMember"));
    return yield* new BillingError(409, "credits_spend_not_enough", sourceText("error.billing.creditsSpendNotEnough"));
  }).bind(this);

  readonly start = Effect.fn("CreditSpending.start")(function* (
    this: CreditSpending,
    jobId: string,
    providerJobId: string,
    details: CreditMediaDetails = {},
  ): Effect.fn.Return<CreditHold | null, Failure> {
    const started = yield* billingCall(() =>
      this.#database
        .prepare(
          `UPDATE credit_holds SET provider_job_id = ?2 WHERE job_id = ?1 AND provider_job_id IS NULL
           ${TRACKED_HOLD_SQL}`,
        )
        .bind(jobId, providerJobId)
        .all<TrackedHoldRow>(),
    );
    for (const row of started.results) {
      if (row.outcome === null) this.#analytics.track(row.account_id, { ...holdEvent(row), ...details });
    }
    return yield* this.find(jobId);
  }).bind(this);

  readonly submitting = Effect.fn("CreditSpending.submitting")(function* (
    this: CreditSpending,
    jobId: string,
  ): Effect.fn.Return<void, Failure> {
    yield* billingCall(() =>
      this.#database
        .prepare(
          "UPDATE credit_holds SET submitted_at = COALESCE(submitted_at, ?2) WHERE job_id = ?1 AND status = 'held'",
        )
        .bind(jobId, this.#now())
        .run(),
    );
  }).bind(this);

  readonly settle = Effect.fn("CreditSpending.settle")(function* (
    this: CreditSpending,
    jobId: string,
    result: CreditJobResult,
  ): Effect.fn.Return<CreditHold | null, Failure> {
    const completed = result.outcome === "completed";
    const charged =
      result.outcome === "completed" && result.charged !== undefined ? creditTenths(result.charged) : null;
    const now = this.#now();
    const [settled] = yield* billingCall(() =>
      this.#database.batch<TrackedHoldRow>([
        this.#database
          .prepare(
            `UPDATE credit_holds
                SET status = ?2, outcome = ?3,
                    charged_tenths = CASE
                      WHEN ?2 = 'charged' THEN MAX(0, MIN(COALESCE(?4, credits_tenths), credits_tenths))
                    END,
                    settled_at = ?5
              WHERE job_id = ?1 AND status = 'held'
             ${TRACKED_HOLD_SQL}`,
          )
          .bind(jobId, completed ? "charged" : "released", result.outcome, charged, now),
        this.#database
          .prepare(
            consumeGrantsSql(
              `SELECT user_id, server_id, charged_tenths AS tenths FROM credit_holds
                WHERE job_id = ?1 AND status = 'charged'
                  AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE entry_id = 'spend:' || ?1)`,
            ),
          )
          .bind(jobId),
        this.#database
          .prepare(
            `INSERT INTO credit_ledger(
               entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at
             )
             SELECT 'spend:' || job_id, user_id, server_id, -charged_tenths, 'spend', actor_user_id, job_id, ?2
               FROM credit_holds
              WHERE job_id = ?1 AND status = 'charged' AND charged_tenths > 0
             ON CONFLICT(entry_id) DO NOTHING`,
          )
          .bind(jobId, now),
      ]),
    );
    this.#trackSettled(settled?.results ?? []);
    return yield* this.find(jobId);
  }).bind(this);

  readonly find = Effect.fn("CreditSpending.find")(function* (
    this: CreditSpending,
    jobId: string,
  ): Effect.fn.Return<CreditHold | null, Failure> {
    const row = yield* billingCall(() =>
      this.#database
        .prepare(
          `SELECT job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, status, outcome, charged_tenths,
                  provider_job_id
             FROM credit_holds WHERE job_id = ?`,
        )
        .bind(jobId)
        .first<HoldRow>(),
    );
    return row ? toHold(row) : null;
  }).bind(this);

  readonly sweep = Effect.fn("CreditSpending.sweep")(function* (
    this: CreditSpending,
    checkJob: CreditJobChecker | null,
  ): Effect.fn.Return<CreditSweepResult, Failure> {
    const now = this.#now();
    const abandoned = yield* billingCall(() =>
      this.#database
        .prepare(
          `UPDATE credit_holds SET status = 'released', outcome = 'abandoned', settled_at = ?1
            WHERE status = 'held' AND provider_job_id IS NULL AND submitted_at IS NULL AND created_at <= ?2
           ${TRACKED_HOLD_SQL}`,
        )
        .bind(now, now - CREDIT_HOLD_START_GRACE_MS)
        .all<TrackedHoldRow>(),
    );
    this.#trackSettled(abandoned.results);
    let settled = 0;
    let rechecked = 0;
    const runningPastLimit: string[] = [];
    if (checkJob) {
      const due = yield* billingCall(() =>
        this.#database
          .prepare(
            `SELECT job_id, provider_job_id, created_at, expires_at FROM credit_holds
              WHERE status = 'held' AND provider_job_id IS NOT NULL AND (check_at <= ?1 OR expires_at <= ?1)
              ORDER BY MIN(check_at, expires_at) LIMIT ?2`,
          )
          .bind(now, SWEEP_BATCH)
          .all<DueRow>(),
      );
      for (const row of due.results) {
        const check = yield* Effect.exit(checkJob(row.provider_job_id, row.job_id));
        const result = Exit.isSuccess(check) ? checkResult(check.value) : null;
        if (result) {
          yield* this.settle(row.job_id, result);
          settled += 1;
          continue;
        }
        if (Exit.isSuccess(check) && row.expires_at <= now) {
          runningPastLimit.push(row.job_id);
          continue;
        }
        yield* billingCall(() =>
          this.#database
            .prepare("UPDATE credit_holds SET check_at = ?2 WHERE job_id = ?1 AND status = 'held'")
            .bind(row.job_id, nextCheckAt(now, row.created_at))
            .run(),
        );
        rechecked += 1;
      }
    }
    const expired = yield* billingCall(() =>
      this.#database
        .prepare(
          `UPDATE credit_holds SET status = 'released', outcome = 'expired', settled_at = ?1
            WHERE status = 'held' AND expires_at <= ?1
              AND (?2 = 0 OR provider_job_id IS NULL OR expires_at <= ?3
                OR job_id IN (SELECT value FROM json_each(?4)))
           ${TRACKED_HOLD_SQL}`,
        )
        .bind(now, checkJob ? 1 : 0, now - CREDIT_HOLD_LIMIT_MS, JSON.stringify(runningPastLimit))
        .all<TrackedHoldRow>(),
    );
    this.#trackSettled(expired.results);
    return { abandoned: abandoned.results.length, settled, rechecked, expired: expired.results.length };
  }).bind(this);
}
