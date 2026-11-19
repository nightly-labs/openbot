import { readFile } from "node:fs/promises";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { TeamPresenceSnapshot } from "@openbot/contracts/ipc";
import { isBoolean } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { memberAuditName } from "../server-audit-store";
import type { TeamStore } from "../team-store";
import type { TeamApiBrowser, TeamApiBrowserView, TeamApiOptions, TeamApiRemoteScreen } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { nullableString, pathIdentifier, readJson, requireAdmin, stringField } from "./request-helpers";

export interface TeamRouteDependencies {
  store: Pick<
    TeamStore,
    | "logout"
    | "changePassword"
    | "resolveLogo"
    | "listMembers"
    | "updateMember"
    | "removeMember"
    | "listInvites"
    | "revokeInvite"
    | "listSessions"
    | "revokeSession"
  >;
  remoteScreen?: Pick<TeamApiRemoteScreen, "revokeTeamSession" | "revokeMember">;
  browser?: Pick<TeamApiBrowser, "releaseUserControlHeldBy">;
  browserView?: Pick<TeamApiBrowserView, "revokeTeamSession">;
  createInvite?: TeamApiOptions["createInvite"];
  updateMember?: TeamApiOptions["updateMember"];
  removeMember?: TeamApiOptions["removeMember"];
  onSessionRevoked?: TeamApiOptions["onSessionRevoked"];
  getPresence: () => TeamPresenceSnapshot;
  refreshPresence: () => void;
}

export async function routeTeam(
  context: TeamApiRequestContext,
  {
    store,
    remoteScreen,
    browser,
    browserView,
    createInvite,
    updateMember,
    removeMember: removeHostMember,
    onSessionRevoked,
    getPresence,
    refreshPresence,
  }: TeamRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, request, response, member, token, sessionId, json, empty } = context;

  function hostChanges(memberId: string): boolean {
    const target = store.listMembers().find((candidate) => candidate.id === memberId);
    return target !== undefined && target.role !== "owner";
  }

  async function removeMember(memberId: string): Promise<void> {
    if (removeHostMember && hostChanges(memberId))
      return runCauseEffect(removeHostMember(memberId, memberAuditName(member)));
    await runCauseEffect(store.removeMember(memberId));
    await (remoteScreen ? runCauseEffect(remoteScreen.revokeMember(memberId)) : undefined);
    browser?.releaseUserControlHeldBy({ kind: "member", memberId });
    refreshPresence();
  }

  if (method === "POST" && url.pathname === TEAM_API_ROUTES.team.leave) {
    await removeMember(member.id);
    return empty(204);
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.auth.logout) {
    await runCauseEffect(store.logout(token));
    await (remoteScreen ? runCauseEffect(remoteScreen.revokeTeamSession(sessionId)) : undefined);
    browser?.releaseUserControlHeldBy({ kind: "session", sessionId });
    await (browserView ? runCauseEffect(browserView.revokeTeamSession(sessionId)) : undefined);
    refreshPresence();
    return empty(204);
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.auth.password) {
    const body = await readJson(request);
    await runCauseEffect(
      store.changePassword(
        member.id,
        stringField(body, "currentPassword", false, 256),
        stringField(body, "newPassword", false, 256),
      ),
    );
    await (remoteScreen ? runCauseEffect(remoteScreen.revokeMember(member.id)) : undefined);
    browser?.releaseUserControlHeldBy({ kind: "member", memberId: member.id });
    refreshPresence();
    return empty(204);
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.me) {
    return json(200, member);
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.team.presence) {
    return json(200, getPresence());
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.team.logo) {
    const logo = store.resolveLogo();
    if (!logo || (url.searchParams.get("v") && url.searchParams.get("v") !== logo.version)) {
      return json(404, { error: sourceText("error.team.logoNotFound") });
    }
    const bytes = await readFile(logo.path);
    response.writeHead(200, {
      "Content-Type": logo.mimeType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(bytes);
    return "handled";
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.events) {
    return json(426, { error: "Use WebSocket for remote events." });
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.host.remoteMac) {
    return json(426, { error: sourceText("error.team.updateRequired"), code: "protocol_mismatch" });
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.host.remoteDesktopAccess) {
    return json(426, { error: sourceText("error.team.updateRequired"), code: "protocol_mismatch" });
  }

  if (method === "GET" && url.pathname === TEAM_API_ROUTES.team.members) {
    requireAdmin(member);
    return json(200, store.listMembers());
  }
  const memberMatch = url.pathname.match(/^\/v1\/team\/members\/([^/]+)$/);
  if (method === "PATCH" && memberMatch) {
    requireAdmin(member);
    const body = await readJson(request);
    const role = body.role;
    const disabled = body.disabled;
    if (role !== undefined && role !== "admin" && role !== "member") {
      throw new HttpError(400, "Invalid role.");
    }
    if (disabled !== undefined && !isBoolean(disabled)) {
      throw new HttpError(400, "disabled must be a boolean.");
    }
    const memberId = pathIdentifier(memberMatch[1], "memberId");
    const patch: { role?: "admin" | "member"; disabled?: boolean } = {
      ...(role ? { role } : {}),
      ...(disabled === undefined ? {} : { disabled }),
    };
    if (updateMember && hostChanges(memberId))
      return json(200, await runCauseEffect(updateMember({ memberId, ...patch }, memberAuditName(member))));
    const updated = await runCauseEffect(store.updateMember(memberId, patch));
    if (updated.disabled) {
      await (remoteScreen ? runCauseEffect(remoteScreen.revokeMember(updated.id)) : undefined);
      browser?.releaseUserControlHeldBy({ kind: "member", memberId: updated.id });
    }
    refreshPresence();
    return json(200, updated);
  }
  if (method === "DELETE" && memberMatch) {
    requireAdmin(member);
    await removeMember(pathIdentifier(memberMatch[1], "memberId"));
    return empty(204);
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.team.invites) {
    requireAdmin(member);
    const body = await readJson(request);
    const role = stringField(body, "role");
    if (role !== "admin" && role !== "member") throw new HttpError(400, "Invalid role.");
    const email = nullableString(body, "email", INPUT_LIMITS.email) ?? undefined;
    const permanent = body.permanent === undefined ? undefined : body.permanent === true;
    if (body.permanent !== undefined && !isBoolean(body.permanent)) throw new HttpError(400, "Invalid invitation.");
    if (!createInvite) throw new HttpError(503, sourceText("error.team.inviteServiceUnavailable"));
    return json(
      201,
      await runCauseEffect(createInvite({ role, ...(email ? { email } : {}), ...(permanent ? { permanent } : {}) })),
    );
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.team.invites) {
    requireAdmin(member);
    return json(200, store.listInvites());
  }
  const inviteMatch = url.pathname.match(/^\/v1\/team\/invites\/([^/]+)$/);
  if (method === "DELETE" && inviteMatch) {
    requireAdmin(member);
    await runCauseEffect(store.revokeInvite(pathIdentifier(inviteMatch[1], "inviteId")));
    return empty(204);
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.team.sessions) {
    requireAdmin(member);
    return json(200, store.listSessions());
  }
  const sessionMatch = url.pathname.match(/^\/v1\/team\/sessions\/([^/]+)$/);
  if (method === "DELETE" && sessionMatch) {
    requireAdmin(member);
    const revokedSessionId = pathIdentifier(sessionMatch[1], "sessionId");
    const target = store.listSessions().find((session) => session.id === revokedSessionId);
    const targetMember = target && store.listMembers().find((candidate) => candidate.id === target.memberId);
    if (member.role !== "owner" && targetMember?.role === "owner") {
      throw new HttpError(400, sourceText("error.team.ownerCannotChange"));
    }
    await runCauseEffect(store.revokeSession(revokedSessionId));
    await (onSessionRevoked ? runCauseEffect(onSessionRevoked(revokedSessionId)) : undefined);
    await (remoteScreen ? runCauseEffect(remoteScreen.revokeTeamSession(revokedSessionId)) : undefined);
    browser?.releaseUserControlHeldBy({ kind: "session", sessionId: revokedSessionId });
    await (browserView ? runCauseEffect(browserView.revokeTeamSession(revokedSessionId)) : undefined);
    refreshPresence();
    return empty(204);
  }

  return "unmatched";
}
