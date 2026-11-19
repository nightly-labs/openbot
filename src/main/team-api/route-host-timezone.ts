import { HOST_TIMEZONE_CAPABILITY, HOST_TIMEZONE_ROUTES } from "@openbot/contracts/team-protocol/host-timezone-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseServerTimezone } from "../server-timezone-preference-store";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

export async function routeHostTimezone(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== HOST_TIMEZONE_ROUTES.settings && url.pathname !== HOST_TIMEZONE_ROUTES.update)
  )
    return "unmatched";
  const timezone = admin?.timezone;
  if (!timezone || !capabilities.has(HOST_TIMEZONE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.hostTimezoneUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  if (url.pathname === HOST_TIMEZONE_ROUTES.settings) return json(200, timezone.get());
  let zone: string | null;
  try {
    zone = parseServerTimezone(body.timezone);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : sourceText("error.host.timezoneInvalid"));
  }
  return json(200, await runCauseEffect(timezone.set(zone)));
}
