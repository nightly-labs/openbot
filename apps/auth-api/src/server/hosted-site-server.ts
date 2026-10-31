import { siteLimitForPlan } from "@openbot/contracts/billing";
import {
  HOSTED_SITE_HOST_ID_HEADER,
  HOSTED_SITE_HOST_TOKEN_HEADER,
  HOSTED_SITE_UNLINKED_LIMIT,
} from "@openbot/contracts/hosted-sites";
import { Effect } from "effect";
import { getServerEntitlement } from "./billing-entitlement";
import { sha256 } from "./crypto";
import { HostedSiteInputError } from "./hosted-site-contract";
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
export function holdsSiteSlotSql(alias: string): string {
  return `${alias}.status IN ('uploading', 'active', 'blocked')
    AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > ?)
    AND (${alias}.status != 'uploading' OR EXISTS (
      SELECT 1 FROM site_deployments d
      WHERE d.site_id = ${alias}.id AND d.status IN ('uploading', 'activating') AND d.upload_expires_at > ?
    ))`;
}

/** The active-site limit of a server's plan, or of the unlinked bucket. Plan limits read only the entitlement. */

export const hostedSiteLimit = Effect.fn("HostedSites.limit")(function* (
  database: D1Database,
  serverId: string | null,
  now: number,
) {
  if (serverId === null) return HOSTED_SITE_UNLINKED_LIMIT;
  const entitlement = yield* getServerEntitlement(database, serverId, now).pipe(Effect.mapError(siteFailure));
  return siteLimitForPlan(entitlement?.plan ?? null);
});

/**
 * Moves the owner's unlinked sites into a self-hosted server that has just registered, up to the free slots of
 * its plan. A computer that publishes before it is a registered server puts its sites in the unlinked bucket,
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
  const siteLimit = yield* hostedSiteLimit(database, serverId, now);
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
           LIMIT max(0, ? - (
             SELECT COUNT(*) FROM hosted_sites x
             WHERE x.user_id = ? AND x.server_id = ? AND ${holdsSiteSlotSql("x")}
           ))
         )`,
      )
      .bind(serverId, userId, now, serverId, userId, serverId, siteLimit, userId, serverId, now, now)
      .run(),
  );
  return result.meta.changes ?? 0;
});

function hostUnauthorized(): HostedSiteInputError {
  return new HostedSiteInputError(401, "host_unauthorized", "The server credential is invalid.");
}
