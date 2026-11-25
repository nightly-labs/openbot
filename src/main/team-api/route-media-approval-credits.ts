import { parseMediaApprovalCreditsUpdate } from "@openbot/contracts/ipc";
import {
  MEDIA_APPROVAL_CREDITS_CAPABILITY,
  MEDIA_APPROVAL_CREDITS_ROUTES,
} from "@openbot/contracts/team-protocol/media-approval-credits-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

export async function routeMediaApprovalCredits(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== MEDIA_APPROVAL_CREDITS_ROUTES.settings && url.pathname !== MEDIA_APPROVAL_CREDITS_ROUTES.update)
  )
    return "unmatched";
  const setting = admin?.mediaApprovalCredits;
  if (!setting || !capabilities.has(MEDIA_APPROVAL_CREDITS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.mediaApprovalCreditsUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  if (url.pathname === MEDIA_APPROVAL_CREDITS_ROUTES.settings) return json(200, setting.get());
  const update = parseMediaApprovalCreditsUpdate(body);
  if (!update) throw new HttpError(400, sourceText("error.team.mediaApprovalCreditsInvalid"));
  return json(200, await runCauseEffect(setting.set(update)));
}
