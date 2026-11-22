import { creditTenths } from "@openbot/contracts/credits";
import { Effect } from "effect";
import { BillingError, type BillingOperationError, billingCall } from "./billing-errors";

export const CREDIT_AUDIT_RETENTION_MS = 400 * 24 * 60 * 60 * 1_000;
const PRUNE_BATCH = 500;
const DETAIL_LIMIT = 1_000;
const TEXT_LIMIT = 120;
const CODE_LIMIT = 60;

export type CreditAuditEvent =
  | "checkout"
  | "transfer"
  | "purchase"
  | "reversal"
  | "media_submit"
  | "media_job"
  | "media_output"
  | "media_check";

export type CreditAuditDetailValue = string | number | boolean | null;

interface CreditAuditWallet {
  userId: string | null;
  serverId: string | null;
}

export interface CreditAuditFailure {
  event: CreditAuditEvent;
  code: string;
  wallet?: CreditAuditWallet;
  actorUserId?: string | null;
  credits?: number;
  modelId?: string;
  reference?: string;
  detail?: Readonly<Record<string, CreditAuditDetailValue | undefined>>;
}

interface CreditAuditUpstream {
  operation: string;
  status: number;
  code: string;
}

export interface CreditAuditTrace {
  upstream: CreditAuditUpstream | null;
}

export function creditAuditTrace(): CreditAuditTrace {
  return { upstream: null };
}

export function creditAuditCode(error: BillingError | BillingOperationError): string {
  return error instanceof BillingError ? error.code : "operation_failed";
}

function clipped(value: string, limit = TEXT_LIMIT): string {
  return value.length > limit ? value.slice(0, limit) : value;
}

function reported(event: CreditAuditEvent) {
  return Effect.catch(() => Effect.sync(() => console.error("credits: audit record failed", { event })));
}

function detailJson(detail: CreditAuditFailure["detail"]): string | null {
  if (!detail) return null;
  const entries = Object.entries(detail).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, typeof value === "string" ? clipped(value) : value] as const],
  );
  if (entries.length === 0) return null;
  const text = JSON.stringify(Object.fromEntries(entries));
  return text.length > DETAIL_LIMIT ? null : text;
}

export function upstreamDetail(trace: CreditAuditTrace): Record<string, CreditAuditDetailValue> {
  const upstream = trace.upstream;
  if (!upstream) return {};
  return { operation: upstream.operation, upstream_status: upstream.status, upstream_code: upstream.code };
}

export class CreditAudit {
  readonly #database: D1Database;
  readonly #now: () => number;

  constructor(database: D1Database, now: () => number) {
    this.#database = database;
    this.#now = now;
  }

  failed(entry: CreditAuditFailure): Effect.Effect<void> {
    return Effect.tryPromise(() =>
      this.#database
        .prepare(
          `INSERT INTO credit_audit(
             audit_id, created_at, event, result, code, user_id, server_id, actor_user_id, credits_tenths, model_id,
             reference, detail
           )
           VALUES (
             ?1, ?2, ?3, 'failed', ?4, (SELECT id FROM users WHERE id = ?5), ?6, (SELECT id FROM users WHERE id = ?7),
             ?8, ?9, ?10, ?11
           )`,
        )
        .bind(
          crypto.randomUUID(),
          this.#now(),
          entry.event,
          clipped(entry.code, CODE_LIMIT),
          entry.wallet?.userId ?? null,
          entry.wallet?.serverId ?? null,
          entry.actorUserId ?? null,
          entry.credits === undefined ? null : creditTenths(entry.credits),
          entry.modelId === undefined ? null : clipped(entry.modelId),
          entry.reference === undefined ? null : clipped(entry.reference),
          detailJson(entry.detail),
        )
        .run(),
    ).pipe(Effect.asVoid, reported(entry.event));
  }

  failedHold(event: CreditAuditEvent, jobId: string, code: string, trace: CreditAuditTrace): Effect.Effect<void> {
    return Effect.tryPromise(() =>
      this.#database
        .prepare(
          `INSERT INTO credit_audit(
             audit_id, created_at, event, result, code, user_id, server_id, actor_user_id, credits_tenths, model_id,
             reference, detail
           )
           SELECT ?1, ?2, ?3, 'failed', ?4, user_id, server_id, actor_user_id, credits_tenths, model_id, job_id, ?6
             FROM credit_holds WHERE job_id = ?5`,
        )
        .bind(
          crypto.randomUUID(),
          this.#now(),
          event,
          clipped(code, CODE_LIMIT),
          jobId,
          detailJson(upstreamDetail(trace)),
        )
        .run(),
    ).pipe(Effect.asVoid, reported(event));
  }

  prune(): Effect.Effect<number, BillingError | BillingOperationError> {
    return billingCall(() =>
      this.#database
        .prepare(
          `DELETE FROM credit_audit WHERE audit_id IN (
             SELECT audit_id FROM credit_audit WHERE created_at < ?1 ORDER BY created_at LIMIT ?2
           )`,
        )
        .bind(this.#now() - CREDIT_AUDIT_RETENTION_MS, PRUNE_BATCH)
        .run(),
    ).pipe(Effect.map((result) => result.meta.changes ?? 0));
  }
}
