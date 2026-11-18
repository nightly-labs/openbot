import { parseRemoteDesktopTest } from "../ipc/server-inputs";
// Remote control of this machine's screen: capabilities, a session, and the display it shows.
//
// Every failure here is a `RemoteScreenError`, not an `HttpError`, because the codes it carries
// (`host_unavailable`, `session_expired`) are part of the frozen protocol and the viewer branches
// on them. A missing gateway is one of those failures rather than an unmatched route: the paths
// exist on every host, and answering 404 would tell a client the host is too old instead of
// telling it remote control is switched off.
//
// The two refusals of the host owner's policy are the exception: a role that may not control this
// computer, and a session that the person at it did not allow. No released protocol has a code for
// them, and each one rejects an error envelope with an unknown code, so they are an `HttpError` 403
// with only a message. Every client shows that message as it shows any failed request.

import {
  type RemoteControlAccess,
  type RemoteDesktopSession,
  remoteControlAllowsRole,
  type TeamMemberSummary,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
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
  /** The roles that may control this computer. Every member when not set. */
  remoteControlAccess?: (() => RemoteControlAccess) | undefined;
}

export async function routeRemoteScreen(
  context: TeamApiRequestContext,
  { store, remoteScreen, remoteControlAccess }: RemoteScreenRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, request, response, member, sessionId, sessionExpiresAt, json, empty } = context;
  // Setup and the test act on this computer as a session does, so the same roles may use them.
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
    // The session can wait for the person at this computer. A client that stops waiting ends the
    // question, so nobody allows a session that nobody will open.
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
    // A new display restarts every open stream, so only a role that may control this computer changes it.
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
