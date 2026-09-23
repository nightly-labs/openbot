// What main answers for the team host, its members and invites, and remote desktop sessions.
//
// Each decoder checks every field the contract type requires and keeps each optional field it
// carries, so a value the renderer reads always has the shape its type says.

import {
  type HostStatus,
  type InviteSummary,
  REMOTE_DESKTOP_ERROR_CODES,
  type RemoteDesktopConnectResult,
  type RemoteDesktopDisplay,
  type RemoteDesktopSession,
  type TeamInviteSummary,
  type TeamMemberSummary,
  type TeamPresenceMember,
  type TeamPresenceSnapshot,
  type TeamRole,
  type TeamSessionSummary,
} from "@openbot/contracts/ipc";
import {
  decodeList,
  decodeRecord,
  nullableString,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from "@openbot/contracts/ipc-decoding";
import { type DynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";

const HOST_PHASES = ["unconfigured", "idle", "starting", "online", "stopping", "error"] as const;
const TEAM_ROLES = ["owner", "admin", "member"] as const;
const INVITE_ROLES = ["admin", "member"] as const;
const REMOTE_DESKTOP_PHASES = ["starting_host", "connecting", "connected", "disconnecting", "error"] as const;
const REMOTE_DESKTOP_TRANSPORTS = ["unknown", "p2p", "relay"] as const;

export function decodeHostStatus(value: unknown): HostStatus {
  const status = decodeRecord(value, "host status");
  if (!isOneOf(HOST_PHASES, status.phase)) throw new Error("Invalid phase.");
  return {
    phase: status.phase,
    configured: requiredBoolean(status, "configured"),
    enabledOnLaunch: requiredBoolean(status, "enabledOnLaunch"),
    serverId: nullableString(status, "serverId"),
    serverName: nullableString(status, "serverName"),
    apiUrl: nullableString(status, "apiUrl"),
    logoUrl: nullableString(status, "logoUrl"),
    apiOnline: requiredBoolean(status, "apiOnline"),
    remoteDesktopReady: requiredBoolean(status, "remoteDesktopReady"),
    remoteDesktopScreenRecordingDenied: requiredBoolean(status, "remoteDesktopScreenRecordingDenied"),
    remoteDesktopUnattended: requiredBoolean(status, "remoteDesktopUnattended"),
    remoteDesktopActiveSessions: requiredNumber(status, "remoteDesktopActiveSessions"),
    remoteDesktopMaxSessions: requiredNumber(status, "remoteDesktopMaxSessions"),
    message: nullableString(status, "message"),
  };
}

export function decodeTeamMember(value: unknown): TeamMemberSummary {
  return teamMember(decodeRecord(value, "team member"));
}

export function decodeTeamMembers(value: unknown): TeamMemberSummary[] {
  return decodeList(value, "team member list", teamMember);
}

export function decodeTeamPresenceSnapshot(value: unknown): TeamPresenceSnapshot {
  const snapshot = decodeRecord(value, "team presence");
  return {
    serverId: nullableString(snapshot, "serverId"),
    members: decodeList(snapshot.members, "team presence member list", presenceMember),
    updatedAt: requiredString(snapshot, "updatedAt"),
  };
}

export function decodeTeamSessions(value: unknown): TeamSessionSummary[] {
  return decodeList(value, "team session list", (session) => ({
    id: requiredString(session, "id"),
    memberId: requiredString(session, "memberId"),
    username: requiredString(session, "username"),
    createdAt: requiredString(session, "createdAt"),
    expiresAt: requiredString(session, "expiresAt"),
  }));
}

export function decodeTeamInvites(value: unknown): TeamInviteSummary[] {
  return decodeList(value, "team invite list", teamInvite);
}

export function decodeInviteSummary(value: unknown): InviteSummary {
  const invite = decodeRecord(value, "invite");
  return { ...teamInvite(invite), inviteUrl: requiredString(invite, "inviteUrl") };
}

export function decodeRemoteDesktopSessions(value: unknown): RemoteDesktopSession[] {
  return decodeList(value, "remote desktop session list", remoteDesktopSession);
}

export function decodeRemoteDesktopConnectResult(value: unknown): RemoteDesktopConnectResult {
  const result = decodeRecord(value, "remote desktop connection");
  switch (result.status) {
    case "connected":
      return {
        status: "connected",
        session: remoteDesktopSession(decodeRecord(result.session, "remote desktop session")),
      };
    case "refused":
      if (!isOneOf(REMOTE_DESKTOP_ERROR_CODES, result.errorCode)) throw new Error("Invalid errorCode.");
      return { status: "refused", errorCode: result.errorCode, message: requiredString(result, "message") };
    default:
      throw new Error("Invalid remote desktop connection status.");
  }
}

function teamMember(member: DynamicRecord): TeamMemberSummary {
  const { avatarUrl } = member;
  if (avatarUrl !== undefined && avatarUrl !== null && !isString(avatarUrl)) {
    throw new Error("Invalid avatarUrl.");
  }
  return {
    id: requiredString(member, "id"),
    username: requiredString(member, "username"),
    email: nullableString(member, "email"),
    name: nullableString(member, "name"),
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
    role: teamRole(member.role),
    createdAt: requiredString(member, "createdAt"),
    disabled: requiredBoolean(member, "disabled"),
  };
}

function presenceMember(member: DynamicRecord): TeamPresenceMember {
  return {
    ...teamMember(member),
    online: requiredBoolean(member, "online"),
    typingAgentId: nullableString(member, "typingAgentId"),
  };
}

function teamInvite(invite: DynamicRecord): TeamInviteSummary {
  if (!isOneOf(INVITE_ROLES, invite.role)) throw new Error("Invalid role.");
  return {
    id: requiredString(invite, "id"),
    role: invite.role,
    expiresAt: requiredString(invite, "expiresAt"),
    usedAt: nullableString(invite, "usedAt"),
    email: nullableString(invite, "email"),
    permanent: requiredBoolean(invite, "permanent"),
    useCount: requiredNumber(invite, "useCount"),
  };
}

function remoteDesktopSession(session: DynamicRecord): RemoteDesktopSession {
  const { phase, transport, errorCode } = session;
  if (!isOneOf(REMOTE_DESKTOP_PHASES, phase)) throw new Error("Invalid phase.");
  if (!isOneOf(REMOTE_DESKTOP_TRANSPORTS, transport)) throw new Error("Invalid transport.");
  if (errorCode !== null && !isOneOf(REMOTE_DESKTOP_ERROR_CODES, errorCode)) throw new Error("Invalid errorCode.");
  return {
    id: requiredString(session, "id"),
    serverId: requiredString(session, "serverId"),
    viewerUrl: requiredString(session, "viewerUrl"),
    viewerGrant: requiredString(session, "viewerGrant"),
    displays: decodeList(session.displays, "remote desktop display list", remoteDesktopDisplay),
    selectedDisplayId: nullableString(session, "selectedDisplayId"),
    phase,
    transport,
    errorCode,
    message: nullableString(session, "message"),
    createdAt: requiredString(session, "createdAt"),
    grantExpiresAt: requiredString(session, "grantExpiresAt"),
  };
}

function remoteDesktopDisplay(display: DynamicRecord): RemoteDesktopDisplay {
  return {
    id: requiredString(display, "id"),
    label: requiredString(display, "label"),
    width: requiredNumber(display, "width"),
    height: requiredNumber(display, "height"),
    primary: requiredBoolean(display, "primary"),
  };
}

function teamRole(value: unknown): TeamRole {
  if (!isOneOf(TEAM_ROLES, value)) throw new Error("Invalid role.");
  return value;
}
