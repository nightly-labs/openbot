import { isString } from "@openbot/contracts/runtime-values";
import { LOCAL_SERVERS_CAPABILITY, LOCAL_SERVERS_ROUTES } from "@openbot/contracts/team-protocol/local-servers-v1";
import { matchingSourceKeys, sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireOwner } from "./request-helpers";

const LOCAL_SERVER_PATHS: ReadonlySet<string> = new Set(Object.values(LOCAL_SERVERS_ROUTES));

/**
 * The owner lists, creates and deletes the servers that the desktop app runs on this computer, from another
 * device. Frozen by `local-servers-v1`. The desktop app makes and registers the server as it does from
 * its own server rail.
 */
export async function routeLocalServers(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !LOCAL_SERVER_PATHS.has(url.pathname)) return "unmatched";
  const localServers = admin?.localServers;
  if (!localServers || !capabilities.has(LOCAL_SERVERS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.localServersUnsupported"));
  requireOwner(member);
  const body = await readJson(request);
  if (url.pathname === LOCAL_SERVERS_ROUTES.list) return json(200, await runCauseEffect(localServers.list()));
  if (url.pathname === LOCAL_SERVERS_ROUTES.delete) {
    if (!isString(body.serverId)) throw new HttpError(400, sourceText("error.remote.localServerNotFound"));
    try {
      await runCauseEffect(localServers.delete(body.serverId));
    } catch (error) {
      // A server that is not on this computer is a sentence for the owner, not a host fault.
      if (error instanceof Error && matchingSourceKeys(error.message).length > 0)
        throw new HttpError(409, error.message);
      throw error;
    }
    return json(200, {});
  }
  try {
    // The server name check refuses a missing name with the same sentence as an empty one.
    return json(200, await runCauseEffect(localServers.create(isString(body.name) ? body.name : "")));
  } catch (error) {
    // A name that is too short, or a computer at its limit, is a sentence for the owner, not a host fault.
    // Its placeholders hold only the name limits and the server limit.
    if (error instanceof Error && matchingSourceKeys(error.message).length > 0) throw new HttpError(409, error.message);
    throw error;
  }
}
