import { HOSTED_SITES_CAPABILITY, HOSTED_SITES_ROUTES } from "@openbot/contracts/team-protocol/hosted-sites-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiHostedSites } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

/**
 * The openbot.site sites of this server, read from a joined server. Every member can read the list, as
 * every member can open a published site. Deleting a site changes what the server publishes, so only an
 * owner or an admin can. The host calls the account service with its own credential. Frozen by
 * `hosted-sites-v1`.
 */
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
  // `readJson` has already run the body through the hosted-sites wire codec.
  const body = await readJson(request);
  try {
    if (list) return json(200, await hostedSites.list());
    await hostedSites.delete(stringField(body, "siteId"));
    return json(200, {});
  } catch (error) {
    // The account service refuses with a sentence for the person, such as a missing sign-in or a site of
    // another server. The host credential is never part of it.
    if (error instanceof Error && !(error instanceof HttpError)) throw new HttpError(409, error.message);
    throw error;
  }
}
