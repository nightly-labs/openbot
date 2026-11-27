import {
  type RemoteControlAccess,
  type RemoteDesktopSession,
  remoteControlAllowsRole,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseRemoteDesktopTest } from "../ipc/server-inputs";
import { RemoteScreenError } from "../remote-screen-gateway";
import type { TeamStore } from "../team-store";
import type { TeamApiRemoteScreen } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { pathIdentifier, publicHttpBaseUrl, readJson, stringField } from "./request-helpers";

export interface RemoteScreenRouteDependencies {
  store: Pick<TeamStore, "getIdentity">;
  remoteScreen?:
    | Pick<
        TeamApiRemoteScreen,
        "capabilities" | "createSession" | "selectDisplay" | "closeMemberSession" | "checkSetup" | "test"
      >
    | undefined;
  remoteControlAccess?: (() => RemoteControlAccess) | undefined;
}

export async function routeRemoteScreen(
  context: TeamApiRequestContext,
  { store, remoteScreen, remoteControlAccess }: RemoteScreenRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, request, response, member, sessionId, sessionExpiresAt, json, empty } = context;
  const requireControlRole = (target: Pick<TeamMemberSummary, "role">) => {
    if (remoteControlAccess && !remoteControlAllowsRole(remoteControlAccess(), target.role))
      throw new HttpError(403, sourceText("error.remote.controlNotAllowed"));
  };

  if (
    method === "POST" &&
    (url.pathname === TEAM_API_ROUTES.remoteScreen.setup || url.pathname === TEAM_API_ROUTES.remoteScreen.test) &&
    context.protocol < 4
  ) {
    throw new RemoteScreenError(426, "protocol_mismatch", sourceText("error.remote.desktopSetupClientUpdate"));
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.remoteScreen.setup) {
    requireControlRole(member);
    if (!remoteScreen?.checkSetup)
      throw new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.desktopSetupUnavailable"));
    const body = await readJson(request);
    if (Object.keys(body).length !== 0)
      throw new RemoteScreenError(400, "protocol_mismatch", "Invalid remote desktop setup request.");
    return json(200, await runCauseEffect(remoteScreen.checkSetup()));
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.remoteScreen.test) {
    requireControlRole(member);
    if (!remoteScreen?.test)
      throw new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.desktopTestUnavailable"));
    const body = await readJson(request);
    const input = parseRemoteDesktopTest({ ...body, serverId: "host" });
    return json(200, await runCauseEffect(remoteScreen.test(input.sessionId, member.id, input.action)));
  }

  if (method === "GET" && url.pathname === TEAM_API_ROUTES.remoteScreen.capabilities) {
    if (!remoteScreen)
      throw new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.controlUnavailable"));
    return json(200, remoteScreen.capabilities());
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.remoteScreen.sessions) {
    requireControlRole(member);
    const identity = store.getIdentity();
    if (!identity || !remoteScreen) {
      throw new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.controlUnavailable"));
    }
    const requestClosed = new AbortController();
    const closed = () => requestClosed.abort();
    response.once("close", closed);
    let session: RemoteDesktopSession;
    try {
      session = await runCauseEffect(
        remoteScreen.createSession({
          serverId: identity.serverId,
          memberId: member.id,
          teamSessionId: sessionId,
          teamSessionExpiresAt: sessionExpiresAt,
          publicHttpBaseUrl: publicHttpBaseUrl(request),
          signal: requestClosed.signal,
        }),
      );
    } finally {
      response.off("close", closed);
    }
    return json(201, session);
  }
  if (method === "PUT" && url.pathname === TEAM_API_ROUTES.remoteScreen.display) {
    requireControlRole(member);
    if (!remoteScreen) {
      throw new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.controlUnavailable"));
    }
    const body = await readJson(request);
    await runCauseEffect(remoteScreen.selectDisplay(stringField(body, "displayId")));
    return empty(204);
  }
  const remoteScreenSessionMatch = url.pathname.match(/^\/v1\/remote-screen\/sessions\/([^/]+)$/);
  if (method === "DELETE" && remoteScreenSessionMatch) {
    if (!remoteScreen) {
      throw new RemoteScreenError(503, "host_unavailable", sourceText("error.remote.controlUnavailable"));
    }
    const closedSessionId = pathIdentifier(remoteScreenSessionMatch[1], "sessionId");
    if (!(await runCauseEffect(remoteScreen.closeMemberSession(closedSessionId, member.id)))) {
      throw new RemoteScreenError(404, "session_expired", sourceText("error.remote.controlSessionNotFound"));
    }
    return empty(204);
  }

  return "unmatched";
}
