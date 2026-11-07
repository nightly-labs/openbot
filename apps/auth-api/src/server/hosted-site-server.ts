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

/**
 * The sites that one request can see and change.
 *
 * - `server`: the request proved a registered server with its machine token. It sees and changes only
 *   that server's sites, and new sites count against the server's plan.
 * - `unlinked`: a desktop that is not a registered server asked for its own list (`?scope=unlinked`).
 * - `account`: a request with no server and no scope, as every released desktop sends. It keeps the
 *   meaning that `/v1/sites` had before sites belonged to servers: it lists and deletes every site of
 *   the account. It creates and replaces only unlinked sites.
 */
export type HostedSiteScope =
  | { kind: "server"; userId: string; serverId: string }
  | { kind: "unlinked"; userId: string }
  | { kind: "account"; userId: string };

/** The server of a scope, or null for the unlinked bucket, which `account` also creates into. */
export function scopeServerId(scope: HostedSiteScope): string | null {
  return scope.kind === "server" ? scope.serverId : null;
}

/**
 * Reads the server headers of a site request. A request that names a server must prove it: a wrong
 * token is refused, and never falls back to the unlinked bucket, so a forged host id cannot use
 * another server's slots.
 */

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
  // The server's sites belong to its owner. A member's account cannot publish into another owner's server.
  if (!host || !expected || difference !== 0 || host.owner_user_id !== userId) return yield* hostUnauthorized();
  return { kind: "server", userId, serverId: hostId };
});

/**
 * The SQL condition that the `hosted_sites` row `alias` holds a slot of its bucket. Bind `now` two times. A new
 * site holds a slot only while its upload is live: the list does not show an abandoned upload, so no count may
 * include one before the cleanup removes it. Every slot count uses this condition, so that the list, a new
 * site, an activation and an adoption agree.
 */
function holdsSiteSlotSql(alias: string): string {
  return `${alias}.status IN ('uploading', 'active', 'blocked')
    AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > ?)
    AND (${alias}.status != 'uploading' OR EXISTS (
      SELECT 1 FROM site_deployments d
      WHERE d.site_id = ${alias}.id AND d.status IN ('uploading', 'activating') AND d.upload_expires_at > ?
    ))`;
}

/**
 * The custom site limit of a server (one `?`: the server ID). As with `getServerEntitlement`, a row
 * applies only while its account owns the remote host or the hosted server.
 */
export const SERVER_SITE_LIMIT_SQL = `SELECT l.site_limit FROM server_site_limits l
  LEFT JOIN remote_hosts h ON h.host_id = l.server_id AND h.owner_user_id = l.owner_user_id
  LEFT JOIN hosted_servers hs ON hs.server_id = l.server_id AND hs.owner_user_id = l.owner_user_id
 WHERE l.server_id = ? AND (h.host_id IS NOT NULL OR hs.server_id IS NOT NULL)`;

/** The SQL condition that the server `server` of the account `owner` has a custom site limit row. */
function customSiteLimitSql(server: string, owner: string): string {
  return `EXISTS (SELECT 1 FROM server_site_limits l WHERE l.server_id = ${server} AND l.owner_user_id = ${owner})`;
}

/**
 * The slots that a new or activating site counts against.
 *
 * - `unlinked`: the account's sites with no server.
 * - `server`: one server with its own limit: a custom row, else a plan that it can use now.
 * - `shared`: every other server of the account. They share one pool: the license sites, else
 *   `HOSTED_SITE_SHARED_FREE_LIMIT`. So more servers with no plan do not give more sites.
 *
 * Every bucket except a custom limit also counts against `HOSTED_SITE_LIMITS.accountSites`.
 */
export type HostedSiteBucket =
  | { kind: "unlinked"; limit: number }
  | { kind: "server"; serverId: string; limit: number; custom: boolean }
  | { kind: "shared"; serverId: string; limit: number };

/** The server of a bucket, or null for the unlinked bucket. */
export function bucketServerId(bucket: HostedSiteBucket): string | null {
  return bucket.kind === "unlinked" ? null : bucket.serverId;
}

/** Reads the bucket of a server, or of the unlinked bucket when `serverId` is null. */
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

/** A SQL fragment and its binds, in order. */
export interface SqlPart {
  sql: string;
  binds: (string | number | null)[];
}

/**
 * The SQL condition that the `hosted_sites` row `alias` is in the bucket. The shared pool holds the sites of
 * the account's servers with no own limit, by the same rules as `resolveHostedSiteBucket`.
 */
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

/** The SQL count of the account's sites that hold a slot of the bucket, except `excludeSiteId`. */
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

/** The SQL count of the account's sites that count against `HOSTED_SITE_LIMITS.accountSites`. */
function accountSlotCountSql(userId: string, excludeSiteId: string | null, now: number): SqlPart {
  return {
    sql: `(SELECT COUNT(*) FROM hosted_sites y
      WHERE y.user_id = ? AND NOT ${customSiteLimitSql("y.server_id", "y.user_id")}
        AND y.id IS NOT ? AND ${holdsSiteSlotSql("y")})`,
    binds: [userId, excludeSiteId, now, now],
  };
}

/**
 * The SQL condition that the bucket has a free slot for one more site of the account. Put it in the statement
 * that adds or activates the site, so that two requests at the same time cannot both take the last slot.
 */
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

/**
 * The slots of a bucket. `limit` is what the server can hold now: its own sites and the free slots of
 * the bucket and the account, but not more than the bucket's limit. `used` is the server's own sites.
 * So `limit` and `used` keep the meaning of the frozen `hosted-sites-v1` list ("the host's site
 * limit and the slots in use") when the server shares a pool.
 */
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

/** The account cap comes first: when it is full, a site on any server of the account frees a slot. */
function limitReason(bucket: HostedSiteBucket, accountFull: boolean): HostedSiteLimitReason | null {
  if (accountFull) return "account";
  return bucket.kind === "shared" ? "shared" : null;
}

export interface HostedSiteSlots {
  limit: number;
  used: number;
  /** True when the account cap, not the bucket, has no free slot. */
  accountFull: boolean;
  /** The list's `limitReason`: why other sites can take the slots of this list. */
  reason: HostedSiteLimitReason | null;
}

/**
 * Moves the owner's unlinked sites into a self-hosted server that has just registered, up to the free slots of
 * its bucket (its plan, or the account's shared pool). A computer that publishes before it is a registered server puts its sites in the unlinked bucket,
 * and the server's own list never showed them. Only sites created before the server first registered move, so
 * a later site of another unregistered computer of the account stays unlinked. A hosted server never moves
 * sites: it registers at its first start, so an unlinked site is from another computer. Active sites only: an
 * upload in progress keeps the bucket it started in.
 */
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
