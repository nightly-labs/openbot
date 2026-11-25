import { siteLimitForPlan } from "@openbot/contracts/billing";
import {
  HOSTED_SITE_HOST_ID_HEADER,
  HOSTED_SITE_HOST_TOKEN_HEADER,
  HOSTED_SITE_SHARED_FREE_LIMIT,
  HOSTED_SITE_UNLINKED_LIMIT,
  type HostedSiteLimitReason,
} from "@openbot/contracts/hosted-sites";
import { LICENSE_SITES_PER_USER } from "@openbot/contracts/license";
import { Effect } from "effect";
import { accountLicense, getServerEntitlement, serverPlanEntitledSql } from "./billing-entitlement";
import { sha256 } from "./crypto";
import { HOSTED_SITE_LIMITS, HostedSiteInputError } from "./hosted-site-contract";
import { siteCall, siteFailure } from "./hosted-site-effects";

export type HostedSiteScope =
  | { kind: "server"; userId: string; serverId: string }
  | { kind: "unlinked"; userId: string }
  | { kind: "account"; userId: string };

export function scopeServerId(scope: HostedSiteScope): string | null {
  return scope.kind === "server" ? scope.serverId : null;
}

export const resolveHostedSiteScope = Effect.fn("HostedSites.resolveScope")(function* (
  database: D1Database,
  userId: string,
  request: Request,
): Effect.fn.Return<HostedSiteScope, import("./hosted-site-effects").HostedSiteFailure> {
  const hostId = request.headers.get(HOSTED_SITE_HOST_ID_HEADER)?.trim() ?? "";
  const machineToken = request.headers.get(HOSTED_SITE_HOST_TOKEN_HEADER) ?? "";
  if (!hostId && !machineToken) {
    const unlinked = new URL(request.url).searchParams.get("scope") === "unlinked";
    return unlinked ? { kind: "unlinked", userId } : { kind: "account", userId };
  }
  if (!hostId || !machineToken || hostId.length > 128 || machineToken.length > 512) return yield* hostUnauthorized();
  const host = yield* siteCall(() =>
    database
      .prepare("SELECT owner_user_id, machine_token_hash FROM remote_hosts WHERE host_id = ?")
      .bind(hostId)
      .first<{ owner_user_id: string; machine_token_hash: string | null }>(),
  );
  const expected = host?.machine_token_hash ?? "";
  const provided = yield* sha256(machineToken).pipe(Effect.mapError(siteFailure));
  let difference = expected.length ^ provided.length;
  for (let index = 0; index < provided.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  if (!host || !expected || difference !== 0 || host.owner_user_id !== userId) return yield* hostUnauthorized();
  return { kind: "server", userId, serverId: hostId };
});

function holdsSiteSlotSql(alias: string): string {
  return `${alias}.status IN ('uploading', 'active', 'blocked')
    AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > ?)
    AND (${alias}.status != 'uploading' OR EXISTS (
      SELECT 1 FROM site_deployments d
      WHERE d.site_id = ${alias}.id AND d.status IN ('uploading', 'activating') AND d.upload_expires_at > ?
    ))`;
}

export const SERVER_SITE_LIMIT_SQL = `SELECT l.site_limit FROM server_site_limits l
  LEFT JOIN remote_hosts h ON h.host_id = l.server_id AND h.owner_user_id = l.owner_user_id
  LEFT JOIN hosted_servers hs ON hs.server_id = l.server_id AND hs.owner_user_id = l.owner_user_id
 WHERE l.server_id = ? AND (h.host_id IS NOT NULL OR hs.server_id IS NOT NULL)`;

function customSiteLimitSql(server: string, owner: string): string {
  return `EXISTS (SELECT 1 FROM server_site_limits l WHERE l.server_id = ${server} AND l.owner_user_id = ${owner})`;
}

export type HostedSiteBucket =
  | { kind: "unlinked"; limit: number }
  | { kind: "server"; serverId: string; limit: number; custom: boolean }
  | { kind: "shared"; serverId: string; limit: number };

export function bucketServerId(bucket: HostedSiteBucket): string | null {
  return bucket.kind === "unlinked" ? null : bucket.serverId;
}

export const resolveHostedSiteBucket = Effect.fn("HostedSites.resolveBucket")(function* (
  database: D1Database,
  userId: string,
  serverId: string | null,
  now: number,
): Effect.fn.Return<HostedSiteBucket, import("./hosted-site-effects").HostedSiteFailure> {
  if (serverId === null) return { kind: "unlinked", limit: HOSTED_SITE_UNLINKED_LIMIT };
  const custom = yield* siteCall(() =>
    database.prepare(SERVER_SITE_LIMIT_SQL).bind(serverId).first<{ site_limit: number }>(),
  );
  if (custom) return { kind: "server", serverId, limit: custom.site_limit, custom: true };
  const entitlement = yield* getServerEntitlement(database, serverId, now).pipe(Effect.mapError(siteFailure));
  if (entitlement) return { kind: "server", serverId, limit: siteLimitForPlan(entitlement.plan), custom: false };
  const license = yield* accountLicense(database, userId, now).pipe(Effect.mapError(siteFailure));
  const limit = license?.entitled ? license.users * LICENSE_SITES_PER_USER : HOSTED_SITE_SHARED_FREE_LIMIT;
  return { kind: "shared", serverId, limit };
});

export interface SqlPart {
  sql: string;
  binds: (string | number | null)[];
}

function bucketMemberSql(bucket: HostedSiteBucket, alias: string, now: number): SqlPart {
  if (bucket.kind === "unlinked") return { sql: `${alias}.server_id IS NULL`, binds: [] };
  if (bucket.kind === "server") return { sql: `${alias}.server_id = ?`, binds: [bucket.serverId] };
  const server = `${alias}.server_id`;
  const owner = `${alias}.user_id`;
  return {
    sql: `${server} IS NOT NULL AND NOT ${customSiteLimitSql(server, owner)}
      AND NOT ${serverPlanEntitledSql(server, owner)}`,
    binds: [now],
  };
}

function bucketSlotCountSql(
  bucket: HostedSiteBucket,
  userId: string,
  excludeSiteId: string | null,
  now: number,
): SqlPart {
  const member = bucketMemberSql(bucket, "x", now);
  return {
    sql: `(SELECT COUNT(*) FROM hosted_sites x
      WHERE x.user_id = ? AND ${member.sql} AND x.id IS NOT ? AND ${holdsSiteSlotSql("x")})`,
    binds: [userId, ...member.binds, excludeSiteId, now, now],
  };
}

function accountSlotCountSql(userId: string, excludeSiteId: string | null, now: number): SqlPart {
  return {
    sql: `(SELECT COUNT(*) FROM hosted_sites y
      WHERE y.user_id = ? AND NOT ${customSiteLimitSql("y.server_id", "y.user_id")}
        AND y.id IS NOT ? AND ${holdsSiteSlotSql("y")})`,
    binds: [userId, excludeSiteId, now, now],
  };
}

export function idleNewSiteUploadsSql(
  bucket: HostedSiteBucket,
  userId: string,
  now: number,
  idleBefore: number,
  count: number,
): SqlPart {
  const member = bucketMemberSql(bucket, "x", now);
  return {
    sql: `SELECT d.id, d.site_id FROM site_deployments d JOIN hosted_sites x ON x.id = d.site_id
      WHERE d.user_id = ? AND d.status = 'uploading' AND d.base_deployment_id IS NULL AND d.in_flight_uploads = 0
        AND d.upload_expires_at > ? AND x.user_id = ? AND x.status = 'uploading' AND ${member.sql}
        AND MAX(d.created_at, COALESCE(
          (SELECT MAX(f.uploaded_at) FROM site_upload_files f WHERE f.deployment_id = d.id), 0)) <= ?
      ORDER BY d.created_at LIMIT ?`,
    binds: [userId, now, userId, ...member.binds, idleBefore, count],
  };
}

export function bucketHasRoomSql(
  bucket: HostedSiteBucket,
  userId: string,
  excludeSiteId: string | null,
  now: number,
): SqlPart {
  const count = bucketSlotCountSql(bucket, userId, excludeSiteId, now);
  if (bucket.kind === "server" && bucket.custom) {
    return { sql: `${count.sql} < ?`, binds: [...count.binds, bucket.limit] };
  }
  const account = accountSlotCountSql(userId, excludeSiteId, now);
  return {
    sql: `${count.sql} < ? AND ${account.sql} < ?`,
    binds: [...count.binds, bucket.limit, ...account.binds, HOSTED_SITE_LIMITS.accountSites],
  };
}

export const hostedSiteSlots = Effect.fn("HostedSites.slots")(function* (
  database: D1Database,
  userId: string,
  bucket: HostedSiteBucket,
  now: number,
): Effect.fn.Return<HostedSiteSlots, import("./hosted-site-effects").HostedSiteFailure> {
  const bucketCount = bucketSlotCountSql(bucket, userId, null, now);
  const account = accountSlotCountSql(userId, null, now);
  const serverId = bucketServerId(bucket);
  const row = yield* siteCall(() =>
    database
      .prepare(
        `SELECT ${bucketCount.sql} AS bucket_used, ${account.sql} AS account_used,
          (SELECT COUNT(*) FROM hosted_sites z
            WHERE z.user_id = ? AND z.server_id IS ? AND ${holdsSiteSlotSql("z")}) AS server_used`,
      )
      .bind(...bucketCount.binds, ...account.binds, userId, serverId, now, now)
      .first<{ bucket_used: number; account_used: number; server_used: number }>(),
  );
  const bucketUsed = row?.bucket_used ?? 0;
  const accountUsed = row?.account_used ?? 0;
  const used = row?.server_used ?? 0;
  const custom = bucket.kind === "server" && bucket.custom;
  const accountFree = custom ? Number.POSITIVE_INFINITY : HOSTED_SITE_LIMITS.accountSites - accountUsed;
  const free = Math.max(0, Math.min(bucket.limit - bucketUsed, accountFree));
  const accountFull = !custom && accountFree <= 0;
  return {
    limit: Math.min(bucket.limit, used + free),
    used,
    accountFull,
    reason: limitReason(bucket, accountFull),
  };
});

function limitReason(bucket: HostedSiteBucket, accountFull: boolean): HostedSiteLimitReason | null {
  if (accountFull) return "account";
  return bucket.kind === "shared" ? "shared" : null;
}

export interface HostedSiteSlots {
  limit: number;
  used: number;
  accountFull: boolean;
  reason: HostedSiteLimitReason | null;
}

export const adoptUnlinkedHostedSites = Effect.fn("HostedSites.adoptUnlinked")(function* (
  database: D1Database,
  userId: string,
  serverId: string,
  now: number,
) {
  const bucket = yield* resolveHostedSiteBucket(database, userId, serverId, now);
  const count = bucketSlotCountSql(bucket, userId, null, now);
  const result = yield* siteCall(() =>
    database
      .prepare(
        `UPDATE hosted_sites SET server_id = ?
         WHERE id IN (
           SELECT s.id FROM hosted_sites s
           WHERE s.user_id = ? AND s.server_id IS NULL AND s.status = 'active' AND s.expires_at > ?
             AND s.created_at <= (SELECT h.created_at FROM remote_hosts h WHERE h.host_id = ? AND h.owner_user_id = ?)
             AND NOT EXISTS (SELECT 1 FROM hosted_servers hs WHERE hs.server_id = ?)
           ORDER BY s.updated_at DESC
           LIMIT max(0, ? - ${count.sql})
         )`,
      )
      .bind(serverId, userId, now, serverId, userId, serverId, bucket.limit, ...count.binds)
      .run(),
  );
  return result.meta.changes ?? 0;
});

function hostUnauthorized(): HostedSiteInputError {
  return new HostedSiteInputError(401, "host_unauthorized", "The server credential is invalid.");
}
