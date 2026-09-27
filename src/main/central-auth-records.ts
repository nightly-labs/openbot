import { inviteUseCount, isPermanentInvite } from "@openbot/contracts/invite-links";
import type { CentralAuthUser, MobileConnectedDevice } from "@openbot/contracts/ipc";
import { decodeRecord, requiredString } from "@openbot/contracts/ipc-decoding";
import { type DynamicRecord, isBoolean, isNumber, isString } from "@openbot/contracts/runtime-values";

/** The account API's answers, and the decoders that `CentralAuthManager` checks them with. */

export interface RegisteredRemoteHost {
  hostId: string;
  name: string;
  membershipId: string;
  authEpoch: number;
  machineToken: string | null;
}

export interface RemoteHostSummary {
  hostId: string;
  name: string;
  logoKey: string | null;
  devicePublicKey: string | null;
  authEpoch: number;
  membershipId: string;
  role: "owner" | "admin" | "member";
}

export interface RemoteInviteRecord {
  inviteId: string;
  email: string | null;
  role: "admin" | "member";
  expiresAt: number;
  usedAt: number | null;
  revokedAt: number | null;
  permanent: boolean;
  useCount: number;
}

export interface RemoteInvitePreview {
  inviteId: string;
  hostId: string;
  hostName: string;
  role: "admin" | "member";
  expiresAt: number;
  emailBound: boolean;
  permanent: boolean;
  devicePublicKey: string | null;
}

export interface RemoteMemberRecord {
  membershipId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: "owner" | "admin" | "member";
  status: "active" | "revoked";
  createdAt: number;
}

interface SessionResponse {
  sessionToken: string;
  user: CentralAuthUser;
}

export function decodeVoid(value: unknown): undefined {
  if (value !== undefined && value !== null) throw new Error("The account service returned data.");
  return undefined;
}

export function decodeRecordHealth(value: unknown): DynamicRecord {
  return decodeRecord(value, "health response");
}

export function decodeCentralAuthUser(value: unknown): CentralAuthUser {
  const record = decodeRecord(value, "account user");
  const name = record.name;
  const avatarUrl = record.avatarUrl;
  if (name !== null && !isString(name)) throw new Error("Invalid account name.");
  if (avatarUrl !== null && !isString(avatarUrl)) throw new Error("Invalid account avatar.");
  return {
    id: requiredString(record, "id"),
    email: requiredString(record, "email"),
    name,
    avatarUrl,
  };
}

export function decodeTicketResponse(value: unknown): { ticket: string; expiresAt: number } {
  const record = decodeRecord(value, "team ticket");
  if (!isNumber(record.expiresAt)) throw new Error("Invalid team ticket expiration.");
  return { ticket: requiredString(record, "ticket"), expiresAt: record.expiresAt };
}

export function decodeMobileConnectedDevices(value: unknown): { devices: MobileConnectedDevice[] } {
  const record = decodeRecord(value, "mobile devices");
  if (!Array.isArray(record.devices)) throw new Error("Invalid mobile device list.");
  return { devices: record.devices.map(decodeMobileConnectedDevice) };
}

function decodeMobileConnectedDevice(value: unknown): MobileConnectedDevice {
  const record = decodeRecord(value, "mobile device");
  if (!isNumber(record.connectedAt) || !isNumber(record.lastActiveAt)) {
    throw new Error("Invalid mobile device timestamps.");
  }
  const platform = record.platform;
  if (platform !== "ios" && platform !== "android" && platform !== "unknown") {
    throw new Error("Invalid mobile device platform.");
  }
  return {
    sessionId: requiredString(record, "sessionId"),
    name: requiredString(record, "name"),
    platform,
    connectedAt: record.connectedAt,
    lastActiveAt: record.lastActiveAt,
  };
}

export function decodeRegisteredRemoteHost(value: unknown): RegisteredRemoteHost {
  const record = decodeRecord(value, "remote host registration");
  if (!isNumber(record.authEpoch) || !Number.isSafeInteger(record.authEpoch) || record.authEpoch < 1) {
    throw new Error("Invalid remote host auth epoch.");
  }
  return {
    hostId: requiredString(record, "hostId"),
    name: requiredString(record, "name"),
    membershipId: requiredString(record, "membershipId"),
    authEpoch: record.authEpoch,
    machineToken: record.machineToken === null ? null : requiredString(record, "machineToken"),
  };
}

export function decodeRemoteHosts(value: unknown): RemoteHostSummary[] {
  const record = decodeRecord(value, "remote hosts");
  if (!Array.isArray(record.hosts)) throw new Error("Invalid remote host list.");
  return record.hosts.map((item) => {
    const host = decodeRecord(item, "remote host");
    if (!isNumber(host.authEpoch) || !Number.isSafeInteger(host.authEpoch) || host.authEpoch < 1)
      throw new Error("Invalid remote auth epoch.");
    if (host.logoKey !== null && !isString(host.logoKey)) throw new Error("Invalid remote host logo.");
    if (host.devicePublicKey !== null && !isString(host.devicePublicKey)) throw new Error("Invalid remote host key.");
    if (host.role !== "owner" && host.role !== "admin" && host.role !== "member")
      throw new Error("Invalid remote host role.");
    return {
      hostId: requiredString(host, "hostId"),
      name: requiredString(host, "name"),
      logoKey: host.logoKey,
      devicePublicKey: host.devicePublicKey,
      authEpoch: host.authEpoch,
      membershipId: requiredString(host, "membershipId"),
      role: host.role,
    };
  });
}

export function decodeCreatedRemoteInvite(value: unknown): {
  inviteId: string;
  token: string;
  expiresAt: number;
  permanent: boolean;
  useCount: number;
} {
  const record = decodeRecord(value, "remote invitation");
  if (!isNumber(record.expiresAt)) throw new Error("Invalid remote invitation expiration.");
  return {
    inviteId: requiredString(record, "inviteId"),
    token: requiredString(record, "token"),
    expiresAt: record.expiresAt,
    permanent: isPermanentInvite(record.permanent, record.expiresAt),
    useCount: inviteUseCount(record.useCount),
  };
}

function decodeRemoteInvite(value: unknown): RemoteInviteRecord {
  const record = decodeRecord(value, "remote invitation");
  if (record.role !== "admin" && record.role !== "member") throw new Error("Invalid remote invitation role.");
  if (!isNumber(record.expiresAt)) throw new Error("Invalid remote invitation expiration.");
  if (record.usedAt !== null && !isNumber(record.usedAt)) throw new Error("Invalid remote invitation use time.");
  if (record.revokedAt !== null && !isNumber(record.revokedAt))
    throw new Error("Invalid remote invitation revocation time.");
  if (record.email !== null && !isString(record.email)) throw new Error("Invalid remote invitation email.");
  return {
    inviteId: requiredString(record, "inviteId"),
    email: record.email,
    role: record.role,
    expiresAt: record.expiresAt,
    usedAt: record.usedAt,
    revokedAt: record.revokedAt,
    permanent: isPermanentInvite(record.permanent, record.expiresAt),
    useCount: inviteUseCount(record.useCount),
  };
}

export function decodeRemoteInvites(value: unknown): RemoteInviteRecord[] {
  const record = decodeRecord(value, "remote invitation list");
  if (!Array.isArray(record.invites)) throw new Error("Invalid remote invitation list.");
  return record.invites.map(decodeRemoteInvite);
}

export function decodeRemoteInvitePreview(value: unknown): RemoteInvitePreview {
  const record = decodeRecord(value, "remote invitation preview");
  if (record.role !== "admin" && record.role !== "member") throw new Error("Invalid remote invitation role.");
  if (!isNumber(record.expiresAt) || !isBoolean(record.emailBound))
    throw new Error("Invalid remote invitation preview.");
  if (record.devicePublicKey !== null && !isString(record.devicePublicKey))
    throw new Error("Invalid remote invitation host key.");
  return {
    inviteId: requiredString(record, "inviteId"),
    hostId: requiredString(record, "hostId"),
    hostName: requiredString(record, "hostName"),
    role: record.role,
    expiresAt: record.expiresAt,
    emailBound: record.emailBound,
    permanent: isPermanentInvite(record.permanent, record.expiresAt),
    devicePublicKey: record.devicePublicKey,
  };
}

export function decodeAcceptedRemoteInvite(value: unknown): {
  hostId: string;
  membershipId: string;
  role: "admin" | "member";
} {
  const record = decodeRecord(value, "accepted remote invitation");
  if (record.role !== "admin" && record.role !== "member") throw new Error("Invalid remote membership role.");
  return {
    hostId: requiredString(record, "hostId"),
    membershipId: requiredString(record, "membershipId"),
    role: record.role,
  };
}

function decodeRemoteMember(value: unknown): RemoteMemberRecord {
  const record = decodeRecord(value, "remote member");
  if (record.role !== "owner" && record.role !== "admin" && record.role !== "member")
    throw new Error("Invalid remote member role.");
  if (record.status !== "active" && record.status !== "revoked") throw new Error("Invalid remote member status.");
  if (!isNumber(record.createdAt)) throw new Error("Invalid remote member creation time.");
  if (record.name !== null && !isString(record.name)) throw new Error("Invalid remote member name.");
  if (record.avatarUrl !== null && !isString(record.avatarUrl)) throw new Error("Invalid remote member avatar.");
  return {
    membershipId: requiredString(record, "membershipId"),
    email: requiredString(record, "email"),
    name: record.name,
    avatarUrl: record.avatarUrl,
    role: record.role,
    status: record.status,
    createdAt: record.createdAt,
  };
}

export function decodeRemoteMembers(value: unknown): RemoteMemberRecord[] {
  const record = decodeRecord(value, "remote member list");
  if (!Array.isArray(record.members)) throw new Error("Invalid remote member list.");
  return record.members.map(decodeRemoteMember);
}

export function decodeEmailChallenge(value: unknown): {
  challengeId: string;
  expiresAt: number;
  resendAt?: number;
  developmentCode?: string;
} {
  const record = decodeRecord(value, "email challenge");
  if (!isNumber(record.expiresAt)) throw new Error("Invalid email challenge expiration.");
  const developmentCode = record.developmentCode;
  const resendAt = record.resendAt;
  if (developmentCode !== undefined && !isString(developmentCode)) {
    throw new Error("Invalid development code.");
  }
  if (resendAt !== undefined && !isNumber(resendAt)) throw new Error("Invalid email resend time.");
  return {
    challengeId: requiredString(record, "challengeId"),
    expiresAt: record.expiresAt,
    ...(resendAt === undefined ? {} : { resendAt }),
    ...(developmentCode === undefined ? {} : { developmentCode }),
  };
}

export function decodeSessionResponse(value: unknown): SessionResponse {
  const record = decodeRecord(value, "session");
  return {
    sessionToken: requiredString(record, "sessionToken"),
    user: decodeCentralAuthUser(record.user),
  };
}
