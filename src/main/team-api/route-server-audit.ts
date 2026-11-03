import { SERVER_AUDIT_CAPABILITY, SERVER_AUDIT_ROUTES } from "@openbot/contracts/team-protocol/server-audit-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiServerAudit } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/** The changes to the access of this server, newest first. Owners and admins only. Frozen by `server-audit-v1`. */
export async function routeServerAudit(
  context: TeamApiRequestContext,
  audit: TeamApiServerAudit | undefined,
  serverId: string | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== SERVER_AUDIT_ROUTES.read) return "unmatched";
  requireAdmin(member);
  if (!audit || !serverId || !capabilities.has(SERVER_AUDIT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.serverAuditUnsupported"));
  await readJson(request);
  return json(200, audit.read(serverId));
}
