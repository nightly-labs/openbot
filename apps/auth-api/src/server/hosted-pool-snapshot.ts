import { Effect, Schema } from "effect";
import { OPEN_STATUSES_SQL } from "./billing-errors";
import { OPERATOR_HOST_DATA_KEPT_MS, POOL_SEEN_WITHIN_MS } from "./hosted-server-service";

const DAY_MS = 24 * 60 * 60_000;
const UNLISTED = "unknown";
const POOL_TOTAL = "all";

class HostedPoolSnapshotError extends Schema.TaggedError<HostedPoolSnapshotError>()("HostedPoolSnapshotError", {}) {}

export interface HostedPoolGroup {
  location: string;
  product: string;
  machines: number;
  free: number;
  ready: number;
  to_reinstall: number;
  plan_ended: number;
  cancel_scheduled: number;
  in_use: number;
  free_in_7d: number;
  free_in_30d: number;
}

interface PoolRow {
  location: string;
  product: string;
  offered: number;
  server_id: string | null;
  desired_state: string | null;
  observed_state: string | null;
  plan_ended_at: number | null;
  deletion_scheduled_at: number | null;
  cancel_period_end: number | null;
  renewing: number;
  open_plan: number;
  any_plan: number;
}

const PLAN_COLUMNS = `h.server_id, h.desired_state, h.observed_state, h.plan_ended_at, h.deletion_scheduled_at,
  (SELECT MAX(s.current_period_end) FROM billing_subscriptions s
    WHERE s.server_id = h.server_id AND s.status IN ${OPEN_STATUSES_SQL} AND s.cancel_at_period_end = 1) AS cancel_period_end,
  EXISTS(SELECT 1 FROM billing_subscriptions s
    WHERE s.server_id = h.server_id AND s.status IN ${OPEN_STATUSES_SQL} AND s.cancel_at_period_end = 0) AS renewing,
  EXISTS(SELECT 1 FROM billing_subscriptions s
    WHERE s.server_id = h.server_id AND s.status IN ${OPEN_STATUSES_SQL}) AS open_plan,
  EXISTS(SELECT 1 FROM billing_subscriptions s WHERE s.server_id = h.server_id) AS any_plan`;

export const readHostedPool = Effect.fn("HostedPool.read")(function* (database: D1Database, now: number) {
  const rows = yield* Effect.tryPromise({
    try: () =>
      database
        .prepare(
          `SELECT p.location, p.product,
           (p.assign_token_hash IS NOT NULL AND COALESCE(p.seen_at, 0) > ?) AS offered, ${PLAN_COLUMNS}
         FROM operator_hosts p LEFT JOIN hosted_servers h ON h.operator_host = p.host_id
         WHERE p.removed_at IS NULL
         UNION ALL
         SELECT '${UNLISTED}', '${UNLISTED}', 0, ${PLAN_COLUMNS}
         FROM hosted_servers h
         WHERE h.operator_host IS NOT NULL AND NOT EXISTS(
           SELECT 1 FROM operator_hosts p WHERE p.host_id = h.operator_host AND p.removed_at IS NULL)`,
        )
        .bind(now - POOL_SEEN_WITHIN_MS)
        .all<PoolRow>(),
    catch: () => new HostedPoolSnapshotError({}),
  });
  if (rows.results.length === 0) return [];
  const groups = new Map<string, HostedPoolGroup>();
  const group = (location: string, product: string) => {
    const key = `${location}\n${product}`;
    const existing = groups.get(key);
    if (existing) return existing;
    const created: HostedPoolGroup = {
      location,
      product,
      machines: 0,
      free: 0,
      ready: 0,
      to_reinstall: 0,
      plan_ended: 0,
      cancel_scheduled: 0,
      in_use: 0,
      free_in_7d: 0,
      free_in_30d: 0,
    };
    groups.set(key, created);
    return created;
  };
  const total = group(POOL_TOTAL, POOL_TOTAL);
  for (const row of rows.results) {
    const { state, freeAt } = machineState(row, now);
    for (const target of [group(row.location, row.product), total]) {
      target.machines += 1;
      target[state] += 1;
      if (state === "free" && row.offered) target.ready += 1;
      if (freeAt !== null && freeAt <= now + 7 * DAY_MS) target.free_in_7d += 1;
      if (freeAt !== null && freeAt <= now + 30 * DAY_MS) target.free_in_30d += 1;
    }
  }
  return [...groups.values()];
});

type MachineState = "free" | "to_reinstall" | "plan_ended" | "cancel_scheduled" | "in_use";

function machineState(row: PoolRow, now: number): { state: MachineState; freeAt: number | null } {
  if (row.server_id === null) return { state: "free", freeAt: now };
  if (row.desired_state === "deleted" || row.observed_state === "deleted")
    return { state: "to_reinstall", freeAt: now };
  if (row.desired_state === "stopped") {
    return {
      state: "plan_ended",
      freeAt: row.open_plan || !row.any_plan ? null : (row.plan_ended_at ?? now) + OPERATOR_HOST_DATA_KEPT_MS,
    };
  }
  if (row.deletion_scheduled_at !== null) return { state: "cancel_scheduled", freeAt: row.deletion_scheduled_at };
  if (row.cancel_period_end !== null && !row.renewing) {
    return { state: "cancel_scheduled", freeAt: row.cancel_period_end + OPERATOR_HOST_DATA_KEPT_MS };
  }
  return { state: "in_use", freeAt: null };
}
