import { hostMemoryReview, isMemoryReviewInterval } from "@openbot/contracts/ipc";
import { MEMORY_REVIEW_CAPABILITY, MEMORY_REVIEW_ROUTES } from "@openbot/contracts/team-protocol/memory-review-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/** How often the agents of this computer review their memories, read and set from a joined server. Frozen by `memory-review-v1`. */
export async function routeMemoryReview(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== MEMORY_REVIEW_ROUTES.settings && url.pathname !== MEMORY_REVIEW_ROUTES.update)
  )
    return "unmatched";
  const setting = admin?.memoryReview;
  if (!setting || !capabilities.has(MEMORY_REVIEW_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.memoryReviewUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  if (url.pathname === MEMORY_REVIEW_ROUTES.settings) return json(200, hostMemoryReview(setting.get()));
  // The snapshot names every value this host permits, so only a malformed request sends another.
  if (!isMemoryReviewInterval(body.interval)) throw new HttpError(400, "Memory review interval is required.");
  return json(200, hostMemoryReview(await runCauseEffect(setting.set({ interval: body.interval }))));
}
