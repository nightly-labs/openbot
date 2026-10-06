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

function hostUnauthorized(): HostedSiteInputError {
  return new HostedSiteInputError(401, "host_unauthorized", "The server credential is invalid.");
}
