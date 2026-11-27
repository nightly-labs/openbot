import { CREDIT_MEDIA_KINDS } from "@openbot/contracts/credit-media";
import { creditsFromTenths, creditTenths } from "@openbot/contracts/credits";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit } from "effect";
import { type AccountAnalytics, type CreditActionEvent, NO_ACCOUNT_ANALYTICS } from "./account-analytics";
import { BillingError, type BillingOperationError, billingCall } from "./billing-errors";
import { consumeGrantsSql, type WalletColumn, welcomeTenthsSql } from "./credit-grants";

type Failure = BillingError | BillingOperationError;

export const CREDIT_HOLD_START_GRACE_MS = 10 * 60 * 1_000;
export const CREDIT_HOLD_FIRST_CHECK_MS = 15 * 60 * 1_000;
const CREDIT_HOLD_MAX_CHECK_GAP_MS = 60 * 60 * 1_000;
export const CREDIT_HOLD_LIMIT_MS = 24 * 60 * 60 * 1_000;
const CREDIT_HOLD_SUBMIT_LEASE_MS = 3 * 60 * 1_000;
const SWEEP_BATCH = 50;

export type CreditWallet = { userId: string } | { serverId: string };
type CreditHoldStatus = "held" | "charged" | "released";
type CreditHoldFunding = "paid" | "welcome";
export type CreditHoldOutcome = "completed" | "failed" | "canceled" | "refused" | "abandoned" | "expired";
export type CreditJobRelease = { outcome: "failed" | "canceled" | "refused"; reason?: string };
export type CreditJobResult = { outcome: "completed"; charged?: number } | CreditJobRelease;
export type CreditJobCheck =
  | { status: "running" }
  | { status: "completed"; charged?: number }
  | { status: "failed" | "canceled" | "refused"; reason?: string };
export type CreditJobChecker = (
  providerJobId: string,
  jobId: string,
  upstream: string | null,
) => Effect.Effect<CreditJobCheck, Failure>;

export interface CreditHoldInput {
  jobId: string;
  wallet: CreditWallet;
  actorUserId: string | null;
  modelId: string;
  credits: number;
  welcome?: boolean;
  viaServerId?: string;
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
  upstream: string | null;
  funding: CreditHoldFunding;
  viaServerId: string | null;
  failureReason: string | null;
}

export interface CreditSubmitTarget {
  upstream: string;
  model: string;
  params: string;
  fields: string;
}

interface SubmitTargetRow {
  upstream: string;
  upstream_model: string;
  upstream_params: string;
  upstream_fields: string | null;
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
  failure_reason: string | null;
}

const TRACKED_HOLD_SQL = `RETURNING server_id, model_id, credits_tenths, charged_tenths, outcome, failure_reason,
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
  upstream: string | null;
  funding: string;
  via_server_id: string | null;
  failure_reason: string | null;
}

interface DueRow {
  job_id: string;
  provider_job_id: string;
  upstream: string | null;
  created_at: number;
  expires_at: number;
}

const HOLD_FUNDINGS: readonly CreditHoldFunding[] = ["paid", "welcome"];
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

export function paidTenthsSql(column: WalletColumn, idParam: string): string {
  return `(${availableTenthsSql(column, idParam)} - ${welcomeTenthsSql(column, idParam)})`;
}

export function overdueGrantTenthsSql(column: WalletColumn, idParam: string, nowParam: string): string {
  return `(SELECT COALESCE(SUM(remaining_tenths), 0) FROM credit_grants
    WHERE ${column} = ${idParam} AND status = 'active' AND expires_at <= ${nowParam})`;
}

function walletIds(wallet: CreditWallet): { userId: string | null; serverId: string | null } {
  return "userId" in wallet ? { userId: wallet.userId, serverId: null } : { userId: null, serverId: wallet.serverId };
}

interface SpenderParams {
  user: string;
  server: string;
  actor: string;
  via: string;
}

const HOLD_SPENDER: SpenderParams = { user: "?2", server: "?3", actor: "?4", via: "?12" };
const CHECK_SPENDER: SpenderParams = { user: "?1", server: "?2", actor: "?3", via: "?4" };

function spenderSql(wallet: CreditWallet, { user, server, actor, via }: SpenderParams): string {
  if ("userId" in wallet)
    return `EXISTS (SELECT 1 FROM users WHERE id = ${user}) AND CASE
      WHEN ${via} IS NULL THEN ${actor} IS NOT NULL AND ${actor} = ${user}
      ELSE EXISTS (SELECT 1 FROM remote_hosts WHERE host_id = ${via} AND owner_user_id = ${user}) AND (${actor} IS NULL OR ${actor} = ${user} OR EXISTS (
        SELECT 1 FROM remote_memberships m WHERE m.host_id = ${via} AND m.user_id = ${actor} AND m.status = 'active'
      ))
    END`;
  return `${via} IS NULL AND EXISTS (SELECT 1 FROM remote_hosts WHERE host_id = ${server}) AND (${actor} IS NULL OR EXISTS (
    SELECT 1 FROM remote_memberships m WHERE m.host_id = ${server} AND m.user_id = ${actor} AND m.status = 'active'
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
    upstream: row.upstream,
    funding: isOneOf(HOLD_FUNDINGS, row.funding) ? row.funding : "paid",
    viaServerId: row.via_server_id,
    failureReason: row.failure_reason,
  };
}

function sameRequest(hold: CreditHold, input: CreditHoldInput): boolean {
  const ids = walletIds(input.wallet);
  return (
    hold.userId === ids.userId &&
    hold.serverId === ids.serverId &&
    hold.actorUserId === input.actorUserId &&
    hold.viaServerId === (input.viaServerId ?? null) &&
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
    ...(row.charged_tenths === null && row.failure_reason !== null ? { reason: row.failure_reason } : {}),
  };
}

function nextCheckAt(now: number, createdAt: number): number {
  return now + Math.min(CREDIT_HOLD_MAX_CHECK_GAP_MS, Math.max(CREDIT_HOLD_FIRST_CHECK_MS, now - createdAt));
}

function checkResult(check: CreditJobCheck): CreditJobResult | null {
  if (check.status === "running") return null;
  if (check.status !== "completed")
    return check.reason === undefined ? { outcome: check.status } : { outcome: check.status, reason: check.reason };
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
    const welcome = `(?11 = 1 AND ${welcomeTenthsSql(column, "?10")} >= ?6)`;
    const viaServerId = "userId" in input.wallet ? (input.viaServerId ?? null) : null;
    yield* billingCall(() =>
      this.#database
        .prepare(
          `INSERT INTO credit_holds(
             job_id, user_id, server_id, actor_user_id, model_id, credits_tenths, created_at, check_at, expires_at,
             funding, via_server_id
           )
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CASE WHEN ${welcome} THEN 'welcome' ELSE 'paid' END, ?12
            WHERE ${spenderSql(input.wallet, HOLD_SPENDER)}
              AND (${welcome} OR (?12 IS NULL
                AND ${paidTenthsSql(column, "?10")} - ${overdueGrantTenthsSql(column, "?10", "?7")} >= ?6))
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
          input.welcome === true ? 1 : 0,
          viaServerId,
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
        .prepare(`SELECT 1 AS allowed WHERE ${spenderSql(input.wallet, CHECK_SPENDER)}`)
        .bind(ids.userId, ids.serverId, input.actorUserId, viaServerId)
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
    upstream: string | null = null,
  ): Effect.fn.Return<CreditHold | null, Failure> {
    const started = yield* billingCall(() =>
      this.#database
        .prepare(
          `UPDATE credit_holds SET provider_job_id = ?2, upstream = ?3, submit_lease_until = NULL
            WHERE job_id = ?1 AND provider_job_id IS NULL
           ${TRACKED_HOLD_SQL}`,
        )
        .bind(jobId, providerJobId, upstream)
        .all<TrackedHoldRow>(),
    );
    for (const row of started.results) {
      if (row.outcome === null) this.#analytics.track(row.account_id, { ...holdEvent(row), ...details });
    }
    return yield* this.find(jobId);
  }).bind(this);

  readonly claimSubmit = Effect.fn("CreditSpending.claimSubmit")(function* (
    this: CreditSpending,
    jobId: string,
    target: CreditSubmitTarget | null,
  ): Effect.fn.Return<CreditSubmitTarget | null, Failure> {
    const now = this.#now();
    const claimed = yield* billingCall(() =>
      this.#database
        .prepare(
          `UPDATE credit_holds
              SET submitted_at = COALESCE(submitted_at, ?2), submit_lease_until = ?3,
                  upstream = COALESCE(upstream, ?4), upstream_model = COALESCE(upstream_model, ?5),
                  upstream_params = COALESCE(upstream_params, ?6),
                  upstream_fields = CASE WHEN upstream IS NULL THEN ?7 ELSE upstream_fields END
            WHERE job_id = ?1 AND status = 'held' AND provider_job_id IS NULL
              AND (submit_lease_until IS NULL OR submit_lease_until <= ?2)
              AND (?4 IS NOT NULL OR upstream IS NOT NULL)
           RETURNING upstream, upstream_model, upstream_params, upstream_fields`,
        )
        .bind(
          jobId,
          now,
          now + CREDIT_HOLD_SUBMIT_LEASE_MS,
          target?.upstream ?? null,
          target?.model ?? null,
          target?.params ?? null,
          target?.fields ?? null,
        )
        .first<SubmitTargetRow>(),
    );
    if (!claimed) return null;
    return {
      upstream: claimed.upstream,
      model: claimed.upstream_model,
      params: claimed.upstream_params,
      fields: claimed.upstream_fields ?? "{}",
    };
  }).bind(this);

  readonly endSubmit = Effect.fn("CreditSpending.endSubmit")(function* (
    this: CreditSpending,
    jobId: string,
  ): Effect.fn.Return<void, Failure> {
    yield* billingCall(() =>
      this.#database
        .prepare("UPDATE credit_holds SET submit_lease_until = NULL WHERE job_id = ?1 AND status = 'held'")
        .bind(jobId)
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
                    settled_at = ?5, failure_reason = ?6
              WHERE job_id = ?1 AND status = 'held'
             ${TRACKED_HOLD_SQL}`,
          )
          .bind(
            jobId,
            completed ? "charged" : "released",
            result.outcome,
            charged,
            now,
            result.outcome === "completed" ? null : (result.reason ?? null),
          ),
        this.#database
          .prepare(
            consumeGrantsSql(
              `SELECT user_id, server_id, funding, charged_tenths AS tenths, created_at FROM credit_holds
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
                  provider_job_id, upstream, funding, via_server_id, failure_reason
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
            `SELECT job_id, provider_job_id, upstream, created_at, expires_at FROM credit_holds
              WHERE status = 'held' AND provider_job_id IS NOT NULL AND (check_at <= ?1 OR expires_at <= ?1)
              ORDER BY MIN(check_at, expires_at) LIMIT ?2`,
          )
          .bind(now, SWEEP_BATCH)
          .all<DueRow>(),
      );
      for (const row of due.results) {
        const check = yield* Effect.exit(checkJob(row.provider_job_id, row.job_id, row.upstream));
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
