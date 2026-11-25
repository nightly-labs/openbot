import { isString } from "@openbot/contracts/runtime-values";
import { LOCAL_SERVERS_CAPABILITY, LOCAL_SERVERS_ROUTES } from "@openbot/contracts/team-protocol/local-servers-v1";
import { matchingSourceKeys, sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireOwner } from "./request-helpers";

const LOCAL_SERVER_PATHS: ReadonlySet<string> = new Set(Object.values(LOCAL_SERVERS_ROUTES));

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
      if (error instanceof Error && matchingSourceKeys(error.message).length > 0)
        throw new HttpError(409, error.message);
      throw error;
    }
    return json(200, {});
  }
  try {
    return json(200, await runCauseEffect(localServers.create(isString(body.name) ? body.name : "")));
  } catch (error) {
    if (error instanceof Error && matchingSourceKeys(error.message).length > 0) throw new HttpError(409, error.message);
    throw error;
  }
}
