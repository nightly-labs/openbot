import { parseRemoteDesktopTest } from "../ipc/server-inputs";
// Remote control of this machine's screen: capabilities, a session, and the display it shows.
//
// Every failure here is a `RemoteScreenError`, not an `HttpError`, because the codes it carries
// (`host_unavailable`, `session_expired`) are part of the frozen protocol and the viewer branches
// on them. A missing gateway is one of those failures rather than an unmatched route: the paths
// exist on every host, and answering 404 would tell a client the host is too old instead of
// telling it remote control is switched off.

import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { sourceText } from "@openbot/i18n/source";
import { RemoteScreenError } from "../remote-screen-gateway";
import type { TeamStore } from "../team-store";
import type { TeamApiRemoteScreen } from "./dependencies";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { pathIdentifier, publicHttpBaseUrl, readJson, stringField } from "./request-helpers";

export interface RemoteScreenRouteDependencies {
  store: Pick<TeamStore, "getIdentity">;
  remoteScreen?: Pick<
    TeamApiRemoteScreen,
    "capabilities" | "createSession" | "selectDisplay" | "closeMemberSession" | "checkSetup" | "test"
  >;
}

export async function routeRemoteScreen(
  context: TeamApiRequestContext,
  { store, remoteScreen }: RemoteScreenRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, request, member, sessionId, sessionExpiresAt, json, empty } = context;

  if (
    method === "POST" &&
    (url.pathname === TEAM_API_ROUTES.remoteScreen.setup || url.pathname === TEAM_API_ROUTES.remoteScreen.test) &&
    context.protocol < 4
  ) {
    throw new RemoteScreenError(426, "protocol_mismatch", sourceText("error.remote.desktopSetupClientUpdate"));
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.remoteScreen.setup) {
    if (!remoteScreen?.checkSetup)
      throw new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.desktopSetupUnavailable"));
    const body = await readJson(request);
    if (Object.keys(body).length !== 0)
      throw new RemoteScreenError(400, "protocol_mismatch", "Invalid remote desktop setup request.");
    return json(200, await remoteScreen.checkSetup());
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.remoteScreen.test) {
    if (!remoteScreen?.test)
      throw new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.desktopTestUnavailable"));
    const body = await readJson(request);
    const input = parseRemoteDesktopTest({ ...body, serverId: "host" });
    return json(200, await remoteScreen.test(input.sessionId, member.id, input.action));
  }

  if (method === "GET" && url.pathname === TEAM_API_ROUTES.remoteScreen.capabilities) {
    if (!remoteScreen)
      throw new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.controlUnavailable"));
    return json(200, remoteScreen.capabilities());
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.remoteScreen.sessions) {
    const identity = store.getIdentity();
    if (!identity || !remoteScreen) {
      throw new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.controlUnavailable"));
    }
    return json(
      201,
      await remoteScreen.createSession({
        serverId: identity.serverId,
        memberId: member.id,
        teamSessionId: sessionId,
        teamSessionExpiresAt: sessionExpiresAt,
        publicHttpBaseUrl: publicHttpBaseUrl(request),
      }),
    );
  }
  if (method === "PUT" && url.pathname === TEAM_API_ROUTES.remoteScreen.display) {
    if (!remoteScreen) {
      throw new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.controlUnavailable"));
    }
    const body = await readJson(request);
    await remoteScreen.selectDisplay(stringField(body, "displayId"));
    return empty(204);
  }
  const remoteScreenSessionMatch = url.pathname.match(/^\/v1\/remote-screen\/sessions\/([^/]+)$/);
  if (method === "DELETE" && remoteScreenSessionMatch) {
    if (!remoteScreen) {
      throw new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.controlUnavailable"));
    }
    const closedSessionId = pathIdentifier(remoteScreenSessionMatch[1], "sessionId");
    if (!(await remoteScreen.closeMemberSession(closedSessionId, member.id))) {
      throw new RemoteScreenError(404, "session_expired", sourceText("error.remote.controlSessionNotFound"));
    }
    return empty(204);
  }

  return "unmatched";
}
