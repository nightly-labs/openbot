import {
  CACHE_EXPIRY_COMPACTION_CAPABILITY,
  CACHE_EXPIRY_COMPACTION_ROUTES,
} from "@openbot/contracts/team-protocol/cache-expiry-compaction-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

export async function routeCacheExpiryCompaction(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== CACHE_EXPIRY_COMPACTION_ROUTES.settings && url.pathname !== CACHE_EXPIRY_COMPACTION_ROUTES.update)
  )
    return "unmatched";
  const setting = admin?.cacheExpiryCompaction;
  if (!setting || !capabilities.has(CACHE_EXPIRY_COMPACTION_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.cacheExpiryCompactionUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  if (url.pathname === CACHE_EXPIRY_COMPACTION_ROUTES.settings) return json(200, setting.get());
  return json(200, await runCauseEffect(setting.set(body.enabled === true)));
}
