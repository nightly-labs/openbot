import { HOST_RESTART_CAPABILITY, HOST_RESTART_ROUTES } from "@openbot/contracts/team-protocol/host-restart-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/** An owner or admin restarts this self-hosted server now. Frozen by `host-restart-v1`. */
export async function routeHostRestart(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== HOST_RESTART_ROUTES.restart) return "unmatched";
  const restart = admin?.restart;
  if (!restart || !capabilities.has(HOST_RESTART_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.hostRestartUnsupported"));
  requireAdmin(member);
  await readJson(request);
  restart.request(member.id);
  return json(200, {});
}
