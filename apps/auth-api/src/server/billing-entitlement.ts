import { Effect, Schema } from "effect";

class BillingEntitlementError extends Schema.TaggedError<BillingEntitlementError>()("BillingEntitlementError", {}) {}

import {
  BILLING_PLANS,
  type BillingPlanId,
  type BillingSubscriptionStatus,
  LEGACY_MEMBER_LIMITS,
  memberLimitForPlan,
} from "@openbot/contracts/billing";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { OPEN_STATUSES_SQL } from "./billing-errors";

const ENTITLED_STATUSES: readonly BillingSubscriptionStatus[] = ["active", "trialing", "past_due"];
const ENTITLED_STATUSES_SQL = `(${ENTITLED_STATUSES.map((status) => `'${status}'`).join(", ")})`;

export interface BillingEntitlement {
  plan: BillingPlanId;
  storageGb: number;
  memberLimit: number;
  status: BillingSubscriptionStatus;
  currentPeriodEnd: number | null;
  hosted: boolean;
}

export function subscriptionPaysForOwnerSql(subscription: string, owner: string): string {
  return `(${subscription}.user_id = ${owner} OR EXISTS(SELECT 1 FROM remote_owner_transfers paid_transfer
    WHERE paid_transfer.host_id = ${subscription}.server_id AND paid_transfer.from_user_id = ${subscription}.user_id
      AND paid_transfer.status = 'accepted'))`;
}

export interface ServerEntitlementRow {
  plan: string;
  status: BillingSubscriptionStatus;
  current_period_end: number | null;
  legacy_member_limits: number | null;
  hosted: number;
}

function serverEntitlementSourceSql(server: string): string {
  return `FROM billing_subscriptions s
       LEFT JOIN remote_hosts sh ON sh.host_id = s.server_id AND ${subscriptionPaysForOwnerSql("s", "sh.owner_user_id")}
       LEFT JOIN hosted_servers hs ON hs.server_id = s.server_id AND hs.owner_user_id = s.user_id
       WHERE s.server_id = ${server} AND s.status IN ${ENTITLED_STATUSES_SQL}
         AND (sh.host_id IS NOT NULL OR hs.server_id IS NOT NULL)`;
}

function serverEntitlementStatement(database: D1Database, serverId: string): D1PreparedStatement {
  return database
    .prepare(
      `SELECT s.plan, s.status, s.current_period_end, hs.legacy_member_limits, hs.server_id IS NOT NULL AS hosted
         ${serverEntitlementSourceSql("?")}
       ORDER BY s.updated_at DESC`,
    )
    .bind(serverId);
}

export interface ServerEntitlementJsonRow extends ServerEntitlementRow {
  updated_at: number;
}

export function serverEntitlementsJsonSql(server: string): string {
  return `(SELECT json_group_array(json_object('plan', s.plan, 'status', s.status,
      'current_period_end', s.current_period_end, 'legacy_member_limits', hs.legacy_member_limits,
      'hosted', hs.server_id IS NOT NULL, 'updated_at', s.updated_at))
    ${serverEntitlementSourceSql(server)})`;
}

export function serverEntitlementFromRows(
  rows: readonly ServerEntitlementRow[],
  now: number,
): BillingEntitlement | null {
  for (const row of rows) {
    const plan = BILLING_PLANS.find((candidate) => candidate.id === row.plan);
    if (!plan) continue;
    if (!entitled(row, now)) continue;
    return {
      plan: plan.id,
      storageGb: plan.storageGb,
      memberLimit: memberLimit(plan.id, row.legacy_member_limits),
      status: row.status,
      currentPeriodEnd: row.current_period_end,
      hosted: row.hosted === 1,
    };
  }
  return null;
}

export const getServerEntitlement = Effect.fn("Billing.getServerEntitlement")(function* (
  database: D1Database,
  serverId: string,
  now = Date.now(),
): Effect.fn.Return<BillingEntitlement | null, BillingEntitlementError> {
  const rows = yield* Effect.tryPromise({
    try: () => serverEntitlementStatement(database, serverId).all<ServerEntitlementRow>(),
    catch: () => new BillingEntitlementError({}),
  });
  return serverEntitlementFromRows(rows.results, now);
});

export const accountHasServerPlan = Effect.fn("Billing.accountHasServerPlan")(function* (
  database: D1Database,
  userId: string,
  now = Date.now(),
): Effect.fn.Return<boolean, BillingEntitlementError> {
  const rows = yield* Effect.tryPromise({
    try: () =>
      database
        .prepare(
          `SELECT s.status, s.current_period_end FROM billing_subscriptions s
       JOIN hosted_servers hs ON hs.server_id = s.server_id AND hs.owner_user_id = s.user_id
       WHERE s.user_id = ? AND s.status IN ${ENTITLED_STATUSES_SQL}`,
        )
        .bind(userId)
        .all<{ status: BillingSubscriptionStatus; current_period_end: number | null }>(),
    catch: () => new BillingEntitlementError({}),
  });
  return rows.results.some((row) => entitled(row, now));
});

export interface OwnerLicense {
  ownerId: string;
  users: number;
  entitled: boolean;
}

export interface OwnerLicenseRow {
  owner_id: string;
  users: number;
  status: string;
  current_period_end: number | null;
}

function ownerLicenseStatement(database: D1Database, hostId: string): D1PreparedStatement {
  return database
    .prepare(
      `SELECT l.user_id AS owner_id, l.users, l.status, l.current_period_end FROM remote_hosts h
             JOIN licenses l ON l.user_id = h.owner_user_id AND l.status IN ${OPEN_STATUSES_SQL}
            WHERE h.host_id = ? ORDER BY l.updated_at DESC`,
    )
    .bind(hostId);
}

export interface OwnerLicenseJsonRow extends OwnerLicenseRow {
  updated_at: number;
}

export function ownerLicensesJsonSql(owner: string): string {
  return `(SELECT json_group_array(json_object('owner_id', l.user_id, 'users', l.users, 'status', l.status,
      'current_period_end', l.current_period_end, 'updated_at', l.updated_at))
    FROM licenses l WHERE l.user_id = ${owner} AND l.status IN ${OPEN_STATUSES_SQL})`;
}

export function ownerLicenseFromRows(rows: readonly OwnerLicenseRow[], now: number): OwnerLicense | null {
  const row = rows.find((license) => licenseEntitled(license, now)) ?? rows[0];
  if (!row) return null;
  return { ownerId: row.owner_id, users: row.users, entitled: licenseEntitled(row, now) };
}

export const ownerLicenseForHost = Effect.fn("Billing.ownerLicenseForHost")(function* (
  database: D1Database,
  hostId: string,
  now = Date.now(),
): Effect.fn.Return<OwnerLicense | null, BillingEntitlementError> {
  const rows = yield* Effect.tryPromise({
    try: () => ownerLicenseStatement(database, hostId).all<OwnerLicenseRow>(),
    catch: () => new BillingEntitlementError({}),
  });
  return ownerLicenseFromRows(rows.results, now);
});

export const accountLicense = Effect.fn("Billing.accountLicense")(function* (
  database: D1Database,
  userId: string,
  now = Date.now(),
): Effect.fn.Return<{ users: number; entitled: boolean } | null, BillingEntitlementError> {
  const rows = yield* Effect.tryPromise({
    try: () =>
      database
        .prepare(
          `SELECT users, status, current_period_end FROM licenses
            WHERE user_id = ? AND status IN ${OPEN_STATUSES_SQL} ORDER BY updated_at DESC`,
        )
        .bind(userId)
        .all<{ users: number; status: string; current_period_end: number | null }>(),
    catch: () => new BillingEntitlementError({}),
  });
  const row = rows.results.find((license) => licenseEntitled(license, now)) ?? rows.results[0];
  return row ? { users: row.users, entitled: licenseEntitled(row, now) } : null;
});

export function serverPlanEntitledSql(server: string, owner: string): string {
  const plans = BILLING_PLANS.map((plan) => `'${plan.id}'`).join(", ");
  return `EXISTS (SELECT 1 FROM billing_subscriptions b
    WHERE b.server_id = ${server} AND ${subscriptionPaysForOwnerSql("b", owner)} AND b.plan IN (${plans})
      AND (b.status IN ('active', 'trialing') OR (b.status = 'past_due' AND b.current_period_end > ?)))`;
}

export function licenseEntitled(license: { status: string; current_period_end: number | null }, now: number): boolean {
  const status = license.status;
  return (
    isOneOf(ENTITLED_STATUSES, status) && entitled({ status, current_period_end: license.current_period_end }, now)
  );
}

function entitled(row: { status: BillingSubscriptionStatus; current_period_end: number | null }, now: number): boolean {
  return row.status !== "past_due" || (row.current_period_end !== null && row.current_period_end > now);
}

function memberLimit(plan: BillingPlanId, legacyMemberLimits: number | null): number {
  return legacyMemberLimits === 0 ? memberLimitForPlan(plan) : LEGACY_MEMBER_LIMITS[plan];
}

function serverMemberLimitSql(server: string): string {
  return `SELECT l.member_limit FROM server_member_limits l
  LEFT JOIN remote_hosts lh ON lh.host_id = l.server_id AND lh.owner_user_id = l.owner_user_id
  LEFT JOIN hosted_servers lhs ON lhs.server_id = l.server_id AND lhs.owner_user_id = l.owner_user_id
 WHERE l.server_id = ${server} AND (lh.host_id IS NOT NULL OR lhs.server_id IS NOT NULL)`;
}

export const SERVER_MEMBER_LIMIT_SQL = serverMemberLimitSql("?");

export function serverMemberLimitValueSql(server: string): string {
  return `(${serverMemberLimitSql(server)} LIMIT 1)`;
}
