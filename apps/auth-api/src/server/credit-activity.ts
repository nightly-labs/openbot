import {
  CREDIT_ACTIVITY_LIMIT,
  type CreditActivity,
  type CreditActivityEntry,
  type CreditActivityKind,
  type CreditActivityStatus,
  creditsFromTenths,
} from "@openbot/contracts/credits";
import { Effect } from "effect";
import { type BillingError, type BillingOperationError, billingCall } from "./billing-errors";

interface ActivityRow {
  id: string;
  kind: string;
  at: number;
  tenths: number;
  actor_id: string | null;
  actor_name: string | null;
  server_id: string | null;
  other_server_id: string | null;
  model_name: string | null;
  maker: string | null;
  status: string | null;
  outcome: string | null;
}

const LEDGER_KINDS: Readonly<Record<string, CreditActivityKind>> = {
  purchase: "purchase",
  transfer: "move",
  reversal: "refund",
  grant: "free",
  expiry: "expired",
};

const SERVER_WALLETS_SQL = `
  SELECT h.host_id AS id,
         CASE WHEN h.owner_user_id = ?1 OR m.role = 'admin' THEN 1 ELSE 0 END AS sees_all
    FROM remote_hosts h
    JOIN remote_memberships m ON m.host_id = h.host_id AND m.user_id = ?1 AND m.status = 'active'`;

const COUNTERPART_SQL = `CASE
  WHEN l.kind <> 'transfer' THEN NULL
  WHEN l.entry_id LIKE '%:out' THEN substr(l.entry_id, 1, length(l.entry_id) - 4) || ':in'
  WHEN l.entry_id LIKE '%:in' THEN substr(l.entry_id, 1, length(l.entry_id) - 3) || ':out'
END`;

function ledgerSql(walletFilter: string): string {
  return `SELECT l.entry_id AS id, l.kind AS kind, l.created_at AS at, l.amount_tenths AS tenths,
                 l.actor_user_id AS actor_id, l.server_id AS server_id,
                 (SELECT o.server_id FROM credit_ledger o WHERE o.entry_id = ${COUNTERPART_SQL}) AS other_server_id,
                 NULL AS model_id, NULL AS status, NULL AS outcome
            FROM credit_ledger l
           WHERE l.kind <> 'spend' AND ${walletFilter}
           ORDER BY l.created_at DESC
           LIMIT ?2`;
}

function holdsSql(walletFilter: string): string {
  return `SELECT 'hold:' || h.job_id AS id, 'generation' AS kind, h.created_at AS at,
                 CASE h.status WHEN 'held' THEN -h.credits_tenths WHEN 'charged' THEN -h.charged_tenths ELSE 0 END AS tenths,
                 h.actor_user_id AS actor_id, h.server_id AS server_id, NULL AS other_server_id,
                 h.model_id AS model_id, h.status AS status, h.outcome AS outcome
            FROM credit_holds h
           WHERE ${walletFilter}
           ORDER BY h.created_at DESC
           LIMIT ?2`;
}

function serverFilter(alias: string): string {
  return `${alias}.server_id IN (SELECT id FROM wallets)
      AND (${alias}.actor_user_id = ?1 OR ${alias}.server_id IN (SELECT id FROM wallets WHERE sees_all = 1))`;
}

const ACTIVITY_SQL = `
  WITH wallets AS (${SERVER_WALLETS_SQL}),
  entries AS (
    SELECT * FROM (${ledgerSql("l.user_id = ?1")})
    UNION ALL SELECT * FROM (${ledgerSql(serverFilter("l"))})
    UNION ALL SELECT * FROM (${holdsSql("h.user_id = ?1")})
    UNION ALL SELECT * FROM (${holdsSql(serverFilter("h"))})
  )
  SELECT e.id, e.kind, e.at, e.tenths, e.actor_id, e.server_id, e.other_server_id, e.status, e.outcome,
         CASE WHEN e.actor_id IS NOT NULL AND e.actor_id <> ?1 THEN u.name END AS actor_name,
         COALESCE(mm.name, e.model_id) AS model_name, mm.maker AS maker
    FROM entries e
    LEFT JOIN users u ON u.id = e.actor_id
    LEFT JOIN credit_media_models mm ON mm.model_id = e.model_id
   ORDER BY e.at DESC, e.id DESC
   LIMIT ?2`;

const OPENBOT_KINDS: readonly CreditActivityKind[] = ["free", "expired", "refund"];

function activityActor(row: ActivityRow, kind: CreditActivityKind, userId: string): CreditActivityEntry["actor"] {
  if (row.actor_id === userId) return "you";
  if (row.actor_id === null && OPENBOT_KINDS.includes(kind)) return "openbot";
  return "member";
}

function activityStatus(row: ActivityRow): CreditActivityStatus | undefined {
  if (row.status === "held") return "running";
  if (row.status !== "released") return undefined;
  return row.outcome === "canceled" ? "canceled" : "failed";
}

function activityEntry(row: ActivityRow, userId: string): CreditActivityEntry | null {
  const kind = row.kind === "generation" ? "generation" : LEDGER_KINDS[row.kind];
  if (!kind) return null;
  const entry: CreditActivityEntry = {
    id: row.id,
    kind,
    at: row.at,
    credits: creditsFromTenths(row.tenths),
    actor: activityActor(row, kind, userId),
  };
  if (row.actor_name) entry.actorName = row.actor_name;
  if (row.server_id) entry.serverId = row.server_id;
  if (row.other_server_id) entry.otherServerId = row.other_server_id;
  if (row.model_name) entry.modelName = row.model_name;
  if (row.maker) entry.maker = row.maker;
  const status = activityStatus(row);
  if (status) entry.status = status;
  return entry;
}

export const creditActivity = Effect.fn("CreditActivity.read")(function* (
  database: D1Database,
  userId: string,
): Effect.fn.Return<CreditActivity, BillingError | BillingOperationError> {
  const rows = yield* billingCall(() =>
    database.prepare(ACTIVITY_SQL).bind(userId, CREDIT_ACTIVITY_LIMIT).all<ActivityRow>(),
  );
  return { entries: rows.results.flatMap((row) => activityEntry(row, userId) ?? []) };
});
