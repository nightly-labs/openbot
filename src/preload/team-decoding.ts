// What main answers for team servers, the team host, its members and invites, direct messages, and
// remote desktop sessions.
//
// Each decoder checks every field the contract type requires and keeps each optional field it
// carries, so a value the renderer reads always has the shape its type says.

import {
  type DirectConversationPage,
  type DirectConversationReadState,
  type DirectConversationSnapshot,
  type DirectMessage,
  type DirectThreadSummary,
  type HostStatus,
  type InvitePreview,
  type InviteSummary,
  REMOTE_DESKTOP_ERROR_CODES,
  type RemoteDesktopConnectResult,
  type RemoteDesktopDisplay,
  type RemoteDesktopSession,
  type ScopedDirectMessageEvent,
  type ScopedDirectTypingEvent,
  type ScopedTeamPresenceSnapshot,
  SERVER_NOTIFICATION_LEVELS,
  type ServerCompatibility,
  type ServerConnectionIssue,
  type ServerSummary,
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
  nullableNumber,
  nullableString,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from "@openbot/contracts/ipc-decoding";
import { type DynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";

const HOST_PHASES = ["unconfigured", "idle", "starting", "online", "stopping", "error"] as const;
const TEAM_ROLES = ["owner", "admin", "member"] as const;
const INVITE_ROLES = ["admin", "member"] as const;
const REMOTE_DESKTOP_PHASES = ["starting_host", "connecting", "connected", "disconnecting", "error"] as const;
const REMOTE_DESKTOP_TRANSPORTS = ["unknown", "p2p", "relay"] as const;
const SERVER_KINDS = ["local", "remote"] as const;
const SERVER_STATES = ["online", "connecting", "offline", "error", "incompatible"] as const;
const SERVER_ISSUE_CODES = [
  "client_update_required",
  "host_update_required",
  "protocol_error",
  "authentication_required",
  "network_unavailable",
] as const;

export function decodeServer(value: unknown): ServerSummary {
  return server(decodeRecord(value, "server"));
}

export function decodeServers(value: unknown): ServerSummary[] {
  return decodeList(value, "server list", server);
}

export function decodeInvitePreview(value: unknown): InvitePreview {
  const preview = decodeRecord(value, "invite preview");
  if (!isOneOf(INVITE_ROLES, preview.role)) throw new Error("Invalid role.");
  return {
    serverId: requiredString(preview, "serverId"),
    serverName: requiredString(preview, "serverName"),
    apiHostname: requiredString(preview, "apiHostname"),
    role: preview.role,
    expiresAt: requiredString(preview, "expiresAt"),
    emailBound: requiredBoolean(preview, "emailBound"),
    permanent: requiredBoolean(preview, "permanent"),
  };
}

export function decodeInviteUrl(value: unknown): string {
  if (!isString(value)) throw new Error("Invalid invite link.");
  return value;
}

export function decodePendingInvite(value: unknown): string | null {
  return value === null ? null : decodeInviteUrl(value);
}

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

export function decodeScopedTeamPresence(value: unknown): ScopedTeamPresenceSnapshot {
  const scoped = decodeRecord(value, "server presence");
  return { serverId: requiredString(scoped, "serverId"), snapshot: decodeTeamPresenceSnapshot(scoped.snapshot) };
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

export function decodeDirectThreads(value: unknown): DirectThreadSummary[] {
  return decodeList(value, "direct thread list", (thread) => ({
    threadId: requiredString(thread, "threadId"),
    otherMemberId: requiredString(thread, "otherMemberId"),
    lastMessage: decodeDirectMessage(thread.lastMessage),
    unreadCount: requiredNumber(thread, "unreadCount"),
    updatedAt: requiredString(thread, "updatedAt"),
  }));
}

export function decodeDirectConversation(value: unknown): DirectConversationSnapshot {
  const conversation = decodeRecord(value, "direct conversation");
  return {
    threadId: requiredString(conversation, "threadId"),
    otherMemberId: requiredString(conversation, "otherMemberId"),
    messages: decodeList(conversation.messages, "direct message list", directMessage),
    revision: requiredNumber(conversation, "revision"),
    ...optionalReadState(conversation),
  };
}

export function decodeDirectConversationPage(value: unknown): DirectConversationPage {
  const page = decodeRecord(value, "direct conversation page");
  const pageInfo = decodeRecord(page.pageInfo, "direct conversation page info");
  return {
    threadId: requiredString(page, "threadId"),
    otherMemberId: requiredString(page, "otherMemberId"),
    messages: decodeList(page.messages, "direct message list", directMessage),
    revision: requiredNumber(page, "revision"),
    pageInfo: { hasOlder: requiredBoolean(pageInfo, "hasOlder"), olderCursor: nullableString(pageInfo, "olderCursor") },
    ...optionalReadState(page),
  };
}

export function decodeDirectMessage(value: unknown): DirectMessage {
  return directMessage(decodeRecord(value, "direct message"));
}

export function decodeDirectReadState(value: unknown): DirectConversationReadState {
  const state = decodeRecord(value, "direct read state");
  return {
    unreadCount: requiredNumber(state, "unreadCount"),
    firstUnreadMessageId: nullableString(state, "firstUnreadMessageId"),
    throughSequence: requiredNumber(state, "throughSequence"),
  };
}

export function decodeScopedDirectMessage(value: unknown): ScopedDirectMessageEvent {
  const scoped = decodeRecord(value, "direct message event");
  const event = decodeRecord(scoped.event, "direct message event");
  if (event.type !== "team-direct-message") throw new Error("Invalid direct message event.");
  const memberIds = Array.isArray(event.memberIds) ? event.memberIds : [];
  const [senderMemberId, recipientMemberId] = memberIds;
  if (memberIds.length !== 2 || !isString(senderMemberId) || !isString(recipientMemberId)) {
    throw new Error("Invalid memberIds.");
  }
  return {
    serverId: requiredString(scoped, "serverId"),
    event: {
      type: event.type,
      message: decodeDirectMessage(event.message),
      memberIds: [senderMemberId, recipientMemberId],
    },
  };
}

export function decodeScopedDirectTyping(value: unknown): ScopedDirectTypingEvent {
  const scoped = decodeRecord(value, "direct typing event");
  const event = decodeRecord(scoped.event, "direct typing event");
  if (event.type !== "team-direct-typing") throw new Error("Invalid direct typing event.");
  return {
    serverId: requiredString(scoped, "serverId"),
    event: {
      type: event.type,
      senderMemberId: requiredString(event, "senderMemberId"),
      recipientMemberId: requiredString(event, "recipientMemberId"),
      typing: requiredBoolean(event, "typing"),
    },
  };
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

function server(summary: DynamicRecord): ServerSummary {
  const { notificationLevel, kind, state, role, compatibility, issue, connectionSequence } = summary;
  if (!isOneOf(SERVER_NOTIFICATION_LEVELS, notificationLevel)) throw new Error("Invalid notificationLevel.");
  if (!isOneOf(SERVER_KINDS, kind)) throw new Error("Invalid kind.");
  if (!isOneOf(SERVER_STATES, state)) throw new Error("Invalid state.");
  if (connectionSequence !== undefined && !isNumber(connectionSequence)) throw new Error("Invalid connectionSequence.");
  return {
    notificationsMuted: requiredBoolean(summary, "notificationsMuted"),
    notificationsMutedUntil: nullableNumber(summary, "notificationsMutedUntil"),
    notificationLevel,
    id: requiredString(summary, "id"),
    name: requiredString(summary, "name"),
    kind,
    state,
    apiUrl: nullableString(summary, "apiUrl"),
    remoteDesktopAvailable: requiredBoolean(summary, "remoteDesktopAvailable"),
    logoUrl: nullableString(summary, "logoUrl"),
    role: role === null ? null : teamRole(role),
    active: requiredBoolean(summary, "active"),
    ...(compatibility === undefined
      ? {}
      : { compatibility: compatibility === null ? null : serverCompatibility(compatibility) }),
    ...(issue === undefined ? {} : { issue: issue === null ? null : serverIssue(issue) }),
    ...(connectionSequence === undefined ? {} : { connectionSequence }),
  };
}

function serverCompatibility(value: unknown): ServerCompatibility {
  const compatibility = decodeRecord(value, "server compatibility");
  const { capabilities, hostProtocol } = compatibility;
  if (!Array.isArray(capabilities) || !capabilities.every(isString)) throw new Error("Invalid capabilities.");
  return {
    localAppVersion: requiredString(compatibility, "localAppVersion"),
    hostAppVersion: nullableString(compatibility, "hostAppVersion"),
    localProtocol: protocolRange(compatibility.localProtocol),
    hostProtocol: hostProtocol === null ? null : protocolRange(hostProtocol),
    negotiatedProtocol: nullableNumber(compatibility, "negotiatedProtocol"),
    capabilities,
  };
}

function protocolRange(value: unknown): { minimum: number; maximum: number } {
  const range = decodeRecord(value, "protocol range");
  return { minimum: requiredNumber(range, "minimum"), maximum: requiredNumber(range, "maximum") };
}

function serverIssue(value: unknown): ServerConnectionIssue {
  const issue = decodeRecord(value, "server connection issue");
  if (!isOneOf(SERVER_ISSUE_CODES, issue.code)) throw new Error("Invalid code.");
  return {
    code: issue.code,
    message: requiredString(issue, "message"),
    retryable: requiredBoolean(issue, "retryable"),
  };
}

function directMessage(message: DynamicRecord): DirectMessage {
  return {
    id: requiredString(message, "id"),
    threadId: requiredString(message, "threadId"),
    senderMemberId: requiredString(message, "senderMemberId"),
    recipientMemberId: requiredString(message, "recipientMemberId"),
    text: requiredString(message, "text"),
    createdAt: requiredString(message, "createdAt"),
    sequence: requiredNumber(message, "sequence"),
  };
}

function optionalReadState(conversation: DynamicRecord): { readState?: DirectConversationReadState } {
  return conversation.readState === undefined ? {} : { readState: decodeDirectReadState(conversation.readState) };
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
