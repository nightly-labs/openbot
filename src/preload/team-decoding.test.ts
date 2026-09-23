import type {
  HostStatus,
  InviteSummary,
  RemoteDesktopConnectResult,
  RemoteDesktopSession,
  TeamInviteSummary,
  TeamMemberSummary,
  TeamPresenceSnapshot,
  TeamSessionSummary,
} from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  decodeHostStatus,
  decodeInviteSummary,
  decodeRemoteDesktopConnectResult,
  decodeRemoteDesktopSessions,
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
  ] as const)("rejects a %s", (_name, decode: (value: unknown) => unknown, value) => {
    expect(() => decode(value)).toThrow(/^Invalid /);
  });
});
