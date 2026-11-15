import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

function invalid(): never {
  throw new Error("Invalid server link.");
}

export function decodeRemoteAgentBridgeInvite(value: unknown): {
  inviteId: string;
  code: string;
  expiresAt: string;
  serverName: string;
} {
  if (!isDynamicRecord(value) || !isString(value.inviteId) || !isString(value.expiresAt) || !isString(value.serverName))
    invalid();
  return {
    inviteId: value.inviteId,
    code: isString(value.code) ? value.code : "",
    expiresAt: value.expiresAt,
    serverName: value.serverName,
  };
}

export function decodeRemoteAgentBridgeLink(value: unknown): {
  linkId: string;
  peerName: string;
  peerReach: string;
  createdAt: string;
} {
  if (!isDynamicRecord(value) || !isString(value.linkId) || !isString(value.peerName) || !isString(value.createdAt))
    invalid();
  return {
    linkId: value.linkId,
    peerName: value.peerName,
    peerReach: isString(value.peerReach) ? value.peerReach : "",
    createdAt: value.createdAt,
  };
}

export function decodeRemoteAgentBridgeReachStatus(value: unknown): {
  ready: boolean;
  reach: string;
  tailscaleConnected: boolean;
  serveConfigured: boolean;
  dnsName: string;
} {
  if (
    !isDynamicRecord(value) ||
    typeof value.ready !== "boolean" ||
    typeof value.tailscaleConnected !== "boolean" ||
    typeof value.serveConfigured !== "boolean" ||
    !isString(value.reach) ||
    !isString(value.dnsName)
  )
    invalid();
  return {
    ready: value.ready,
    reach: value.reach,
    tailscaleConnected: value.tailscaleConnected,
    serveConfigured: value.serveConfigured,
    dnsName: value.dnsName,
  };
}

export function decodeRemoteAgentBridgeSnapshot(value: unknown): {
  invites: ReturnType<typeof decodeRemoteAgentBridgeInvite>[];
  links: ReturnType<typeof decodeRemoteAgentBridgeLink>[];
} {
  if (!isDynamicRecord(value) || !Array.isArray(value.invites) || !Array.isArray(value.links)) invalid();
  return {
    invites: value.invites.map(decodeRemoteAgentBridgeInvite),
    links: value.links.map(decodeRemoteAgentBridgeLink),
  };
}
