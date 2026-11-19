import { HOSTED_SITES_CAPABILITY, HOSTED_SITES_ROUTES } from "@openbot/contracts/team-protocol/hosted-sites-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiHostedSites } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

export async function routeHostedSites(
  context: TeamApiRequestContext,
  hostedSites: TeamApiHostedSites | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const list = method === "POST" && url.pathname === HOSTED_SITES_ROUTES.list;
  const remove = method === "POST" && url.pathname === HOSTED_SITES_ROUTES.remove;
  if (!list && !remove) return "unmatched";
  if (!hostedSites || !capabilities.has(HOSTED_SITES_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.hostedSitesUnsupported"));
  if (remove) requireAdmin(member);
  const body = await readJson(request);
  try {
    if (list) return json(200, await runCauseEffect(hostedSites.listServerSites()));
    await runCauseEffect(hostedSites.deleteServerSite(stringField(body, "siteId")));
    return json(200, {});
  } catch (error) {
    if (error instanceof Error && !(error instanceof HttpError)) throw new HttpError(409, error.message);
    throw error;
  }
}
