import type {
  DirectConversationPage,
  DirectConversationReadState,
  DirectConversationSnapshot,
  DirectMessage,
  DirectThreadSummary,
  HostStatus,
  InvitePreview,
  InviteSummary,
  RemoteDesktopConnectResult,
  RemoteDesktopSession,
  ScopedDirectMessageEvent,
  ScopedDirectTypingEvent,
  ScopedTeamPresenceSnapshot,
  ServerSummary,
  TeamInviteSummary,
  TeamMemberSummary,
  TeamPresenceSnapshot,
  TeamSessionSummary,
} from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  decodeDirectConversation,
  decodeDirectConversationPage,
  decodeDirectMessage,
  decodeDirectReadState,
  decodeDirectThreads,
  decodeHostStatus,
  decodeInvitePreview,
  decodeInviteSummary,
  decodeInviteUrl,
  decodePendingInvite,
  decodeRemoteDesktopConnectResult,
  decodeRemoteDesktopSessions,
  decodeScopedDirectMessage,
  decodeScopedDirectTyping,
  decodeScopedTeamPresence,
  decodeServer,
  decodeServers,
  decodeTeamInvites,
  decodeTeamMember,
  decodeTeamMembers,
  decodeTeamPresenceSnapshot,
  decodeTeamSessions,
} from "./team-decoding";

const hostStatus = {
  phase: "online",
  configured: true,
  enabledOnLaunch: false,
  serverId: "server-1",
  serverName: "Studio",
  apiUrl: "https://studio.example.test",
  logoUrl: null,
  apiOnline: true,
  remoteDesktopReady: false,
  remoteDesktopScreenRecordingDenied: false,
  remoteDesktopUnattended: false,
  remoteDesktopActiveSessions: 0,
  remoteDesktopMaxSessions: 4,
  message: null,
} satisfies HostStatus;

const member = {
  id: "member-1",
  username: "ada",
  email: "ada@example.test",
  name: null,
  role: "admin",
  createdAt: "2026-09-23T10:00:00.000Z",
  disabled: false,
} satisfies TeamMemberSummary;

const memberWithAvatar = { ...member, avatarUrl: "https://example.test/ada.png" } satisfies TeamMemberSummary;

const presence = {
  serverId: null,
  members: [{ ...member, online: true, typingAgentId: null }],
  updatedAt: "2026-09-23T10:00:00.000Z",
} satisfies TeamPresenceSnapshot;

const teamInvite = {
  id: "invite-1",
  role: "member",
  expiresAt: "2026-09-30T10:00:00.000Z",
  usedAt: null,
  email: null,
  permanent: false,
  useCount: 0,
} satisfies TeamInviteSummary;

const invite = { ...teamInvite, inviteUrl: "openbot://join/invite-1" } satisfies InviteSummary;

const session = {
  id: "session-1",
  memberId: "member-1",
  username: "ada",
  createdAt: "2026-09-23T10:00:00.000Z",
  expiresAt: "2026-10-23T10:00:00.000Z",
} satisfies TeamSessionSummary;

const remoteSession = {
  id: "screen-1",
  serverId: "server-1",
  viewerUrl: "https://viewer.example.test",
  viewerGrant: "grant",
  displays: [{ id: "display-1", label: "Built-in", width: 1512, height: 982, primary: true }],
  selectedDisplayId: "display-1",
  phase: "connected",
  transport: "p2p",
  errorCode: null,
  message: null,
  createdAt: "2026-09-23T10:00:00.000Z",
  grantExpiresAt: "2026-09-23T11:00:00.000Z",
} satisfies RemoteDesktopSession;

const localServer = {
  notificationsMuted: false,
  notificationsMutedUntil: null,
  notificationLevel: "all",
  id: "local",
  name: "This computer",
  kind: "local",
  state: "online",
  apiUrl: null,
  remoteDesktopAvailable: false,
  logoUrl: null,
  role: null,
  active: true,
} satisfies ServerSummary;

const remoteServer = {
  ...localServer,
  notificationsMuted: true,
  notificationsMutedUntil: 1_790_000_000_000,
  notificationLevel: "needs-me",
  id: "server-1",
  name: "Studio",
  kind: "remote",
  state: "incompatible",
  apiUrl: "https://studio.example.test",
  role: "member",
  active: false,
  compatibility: {
    localAppVersion: "1.4.0",
    hostAppVersion: null,
    localProtocol: { minimum: 1, maximum: 3 },
    hostProtocol: null,
    negotiatedProtocol: null,
    capabilities: ["direct-messages"],
  },
  issue: { code: "host_update_required", message: "The host must update.", retryable: false },
  connectionSequence: 2,
} satisfies ServerSummary;

const invitePreview = {
  serverId: "server-1",
  serverName: "Studio",
  apiHostname: "studio.example.test",
  role: "member",
  expiresAt: "2026-09-30T10:00:00.000Z",
  emailBound: false,
  permanent: true,
} satisfies InvitePreview;

const directMessage = {
  id: "message-1",
  threadId: "thread-1",
  senderMemberId: "member-1",
  recipientMemberId: "member-2",
  text: "Hello",
  createdAt: "2026-09-23T10:00:00.000Z",
  sequence: 1,
} satisfies DirectMessage;

const readState = {
  unreadCount: 1,
  firstUnreadMessageId: "message-1",
  throughSequence: 0,
} satisfies DirectConversationReadState;

const conversation = {
  threadId: "thread-1",
  otherMemberId: "member-2",
  messages: [directMessage],
  revision: 3,
} satisfies DirectConversationSnapshot;

const page = {
  ...conversation,
  pageInfo: { hasOlder: true, olderCursor: "cursor-1" },
  readState,
} satisfies DirectConversationPage;

const directEvent = {
  serverId: "server-1",
  event: { type: "team-direct-message", message: directMessage, memberIds: ["member-1", "member-2"] },
} satisfies ScopedDirectMessageEvent;

const typingEvent = {
  serverId: "server-1",
  event: { type: "team-direct-typing", senderMemberId: "member-1", recipientMemberId: "member-2", typing: true },
} satisfies ScopedDirectTypingEvent;

describe("team decoders", () => {
  it.each([
    ["host status", decodeHostStatus, hostStatus],
    ["team member", decodeTeamMember, member],
    ["team member with an avatar", decodeTeamMember, memberWithAvatar],
    ["team member list", decodeTeamMembers, [member, memberWithAvatar]],
    ["team presence", decodeTeamPresenceSnapshot, presence],
    ["team session list", decodeTeamSessions, [session]],
    ["team invite list", decodeTeamInvites, [teamInvite]],
    ["created invite", decodeInviteSummary, invite],
    ["remote desktop session list", decodeRemoteDesktopSessions, [remoteSession]],
    [
      "connected remote desktop",
      decodeRemoteDesktopConnectResult,
      { status: "connected", session: remoteSession } satisfies RemoteDesktopConnectResult,
    ],
    [
      "refused remote desktop",
      decodeRemoteDesktopConnectResult,
      {
        status: "refused",
        errorCode: "host_permissions_required",
        message: "The host must allow screen recording.",
      } satisfies RemoteDesktopConnectResult,
    ],
    ["local server", decodeServer, localServer],
    ["server list", decodeServers, [localServer, remoteServer]],
    ["server without a connection issue", decodeServer, { ...remoteServer, compatibility: null, issue: null }],
    ["invite preview", decodeInvitePreview, invitePreview],
    ["invite link", decodeInviteUrl, "openbot://join/invite-1"],
    ["pending invite", decodePendingInvite, "openbot://join/invite-1"],
    ["missing pending invite", decodePendingInvite, null],
    [
      "server presence",
      decodeScopedTeamPresence,
      { serverId: "server-1", snapshot: presence } satisfies ScopedTeamPresenceSnapshot,
    ],
    [
      "direct thread list",
      decodeDirectThreads,
      [
        {
          threadId: "thread-1",
          otherMemberId: "member-2",
          lastMessage: directMessage,
          unreadCount: 0,
          updatedAt: "2026-09-23T10:00:00.000Z",
        },
      ] satisfies DirectThreadSummary[],
    ],
    ["direct conversation", decodeDirectConversation, conversation],
    ["direct conversation with a read state", decodeDirectConversation, { ...conversation, readState }],
    ["direct conversation page", decodeDirectConversationPage, page],
    ["direct message", decodeDirectMessage, directMessage],
    ["direct read state", decodeDirectReadState, readState],
    ["direct message event", decodeScopedDirectMessage, directEvent],
    ["direct typing event", decodeScopedDirectTyping, typingEvent],
  ] as const)("keeps a valid %s", (_name, decode: (value: unknown) => unknown, value) => {
    expect(decode(value)).toEqual(value);
  });

  it.each([
    ["host status with an unknown phase", decodeHostStatus, { ...hostStatus, phase: "sleeping" }],
    ["team member with an unknown role", decodeTeamMember, { ...member, role: "guest" }],
    ["team member with a numeric avatar", decodeTeamMember, { ...member, avatarUrl: 1 }],
    ["team member list that is not an array", decodeTeamMembers, member],
    ["team presence without typing state", decodeTeamPresenceSnapshot, { ...presence, members: [member] }],
    ["team session without a member", decodeTeamSessions, [{ ...session, memberId: null }]],
    ["team invite for an owner", decodeTeamInvites, [{ ...teamInvite, role: "owner" }]],
    ["created invite without a link", decodeInviteSummary, teamInvite],
    [
      "remote desktop session with an unknown transport",
      decodeRemoteDesktopSessions,
      [{ ...remoteSession, transport: "tcp" }],
    ],
    [
      "refused remote desktop with an unknown code",
      decodeRemoteDesktopConnectResult,
      { status: "refused", errorCode: "busy", message: "No." },
    ],
    ["remote desktop connection with an unknown status", decodeRemoteDesktopConnectResult, { status: "pending" }],
    ["server with an unknown state", decodeServers, [{ ...localServer, state: "asleep" }]],
    ["server without a role", decodeServer, { ...localServer, role: undefined }],
    [
      "server with an unknown issue code",
      decodeServer,
      { ...remoteServer, issue: { ...remoteServer.issue, code: "x" } },
    ],
    [
      "server with a malformed protocol range",
      decodeServer,
      { ...remoteServer, compatibility: { ...remoteServer.compatibility, localProtocol: { minimum: 1 } } },
    ],
    ["server with a text connection sequence", decodeServer, { ...remoteServer, connectionSequence: "2" }],
    ["invite preview for an owner", decodeInvitePreview, { ...invitePreview, role: "owner" }],
    ["invite link that is not text", decodeInviteUrl, 1],
    ["pending invite that is not text", decodePendingInvite, undefined],
    ["server presence without a server", decodeScopedTeamPresence, { snapshot: presence }],
    ["direct thread without a last message", decodeDirectThreads, [{ threadId: "thread-1" }]],
    ["direct conversation with a malformed read state", decodeDirectConversation, { ...conversation, readState: {} }],
    ["direct conversation page without page info", decodeDirectConversationPage, conversation],
    ["direct message without a sequence", decodeDirectMessage, { ...directMessage, sequence: undefined }],
    ["direct read state without a sequence", decodeDirectReadState, { unreadCount: 0, firstUnreadMessageId: null }],
    [
      "direct message event with one member",
      decodeScopedDirectMessage,
      { ...directEvent, event: { ...directEvent.event, memberIds: ["member-1"] } },
    ],
    ["direct message event of another type", decodeScopedDirectMessage, typingEvent],
    [
      "direct typing event without a typing state",
      decodeScopedDirectTyping,
      { ...typingEvent, event: { ...typingEvent.event, typing: "yes" } },
    ],
  ] as const)("rejects a %s", (_name, decode: (value: unknown) => unknown, value) => {
    expect(() => decode(value)).toThrow(/^Invalid /);
  });
});
