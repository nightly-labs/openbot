import { isDynamicRecord, isString } from "../runtime-values";
import { adminRoute, boolean, empty, fields, identifier, list, type OptionalRouteCodec, string } from "./admin-wire";
import type { TeamProtocolV7BaseJsonObject, TeamProtocolV7BaseJsonValue } from "./v7-base";

export const REMOTE_AGENT_BRIDGE_CAPABILITY = "remote-agent-bridge-v1";

export const REMOTE_AGENT_BRIDGE_INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export const REMOTE_AGENT_BRIDGE_ROUTES = {
  invites: "/v1/admin/host/remote-agent-bridge/invites",
  createInvite: "/v1/admin/host/remote-agent-bridge/invites/create",
  revokeInvite: "/v1/admin/host/remote-agent-bridge/invites/revoke",
  redeem: "/v1/admin/host/remote-agent-bridge/redeem",
  links: "/v1/admin/host/remote-agent-bridge/links",
  revokeLink: "/v1/admin/host/remote-agent-bridge/links/revoke",
  prepareReach: "/v1/admin/host/remote-agent-bridge/reach/prepare",
  reachStatus: "/v1/admin/host/remote-agent-bridge/reach/status",
  accept: "/v1/remote-agent-bridge/accept",
  agents: "/v1/remote-agent-bridge/agents",
  message: "/v1/remote-agent-bridge/message",
  peerRevoke: "/v1/remote-agent-bridge/revoke",
} as const;

export interface RemoteAgentBridgeReachStatus {
  ready: boolean;
  reach: string;
  tailscaleConnected: boolean;
  serveConfigured: boolean;
  dnsName: string;
}

const PEER_PATHS = new Set<string>([
  REMOTE_AGENT_BRIDGE_ROUTES.accept,
  REMOTE_AGENT_BRIDGE_ROUTES.agents,
  REMOTE_AGENT_BRIDGE_ROUTES.message,
  REMOTE_AGENT_BRIDGE_ROUTES.peerRevoke,
]);

export function isRemoteAgentBridgePeerPath(pathname: string): boolean {
  return PEER_PATHS.has(pathname);
}

const name = string(120);
const reach = string(2048);
const code = string(4096);
const text = string(100_000);
const fileData = string(140_000_000);
const invite = fields({
  inviteId: identifier,
  code,
  expiresAt: string(40),
  serverName: name,
});
const link = fields({
  linkId: identifier,
  peerName: name,
  peerReach: reach,
  createdAt: string(40),
});
const agent = fields({ id: identifier, name });
const file = fields({ name: string(255), data: fileData });

const reachStatus = fields({
  ready: boolean,
  reach,
  tailscaleConnected: boolean,
  serveConfigured: boolean,
  dnsName: string(255),
});

export const REMOTE_AGENT_BRIDGE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [REMOTE_AGENT_BRIDGE_ROUTES.invites, adminRoute(empty, fields({ invites: list(invite, 64) }))],
  [REMOTE_AGENT_BRIDGE_ROUTES.createInvite, adminRoute(empty, invite)],
  [REMOTE_AGENT_BRIDGE_ROUTES.revokeInvite, adminRoute(fields({ inviteId: identifier }), empty)],
  [REMOTE_AGENT_BRIDGE_ROUTES.redeem, adminRoute(fields({ code }), link)],
  [REMOTE_AGENT_BRIDGE_ROUTES.links, adminRoute(empty, fields({ links: list(link, 64) }))],
  [REMOTE_AGENT_BRIDGE_ROUTES.revokeLink, adminRoute(fields({ linkId: identifier }), empty)],
  [REMOTE_AGENT_BRIDGE_ROUTES.prepareReach, adminRoute(empty, reachStatus)],
  [REMOTE_AGENT_BRIDGE_ROUTES.reachStatus, adminRoute(empty, reachStatus)],
  [
    REMOTE_AGENT_BRIDGE_ROUTES.accept,
    adminRoute(
      fields({
        secret: string(128),
        peerReach: reach,
        peerName: name,
        peerToken: string(128),
      }),
      fields({ token: string(128), serverName: name, linkId: identifier }),
    ),
  ],
  [REMOTE_AGENT_BRIDGE_ROUTES.agents, adminRoute(empty, fields({ agents: list(agent, 512) }))],
  [
    REMOTE_AGENT_BRIDGE_ROUTES.message,
    adminRoute(
      fields(
        {
          senderAgentId: identifier,
          senderAgentName: name,
          senderServerName: name,
          recipientAgentId: identifier,
          text,
        },
        {
          replyToMessageId: identifier,
          files: list(file, 32),
        },
      ),
      fields({ messageId: identifier }),
    ),
  ],
  [REMOTE_AGENT_BRIDGE_ROUTES.peerRevoke, adminRoute(empty, empty)],
]);

export interface RemoteSender {
  agentId: string;
  agentName: string;
  serverName: string;
}

export function isRemoteSender(value: unknown): value is RemoteSender {
  return (
    isDynamicRecord(value) &&
    isString(value.agentId) &&
    value.agentId.length > 0 &&
    value.agentId.length <= 128 &&
    isString(value.agentName) &&
    value.agentName.length > 0 &&
    value.agentName.length <= 120 &&
    isString(value.serverName) &&
    value.serverName.length > 0 &&
    value.serverName.length <= 120
  );
}

function knownRemoteSender(value: RemoteSender): TeamProtocolV7BaseJsonObject {
  return { agentId: value.agentId, agentName: value.agentName, serverName: value.serverName };
}

export function withConversationRemoteSender(
  projected: TeamProtocolV7BaseJsonValue,
  source: unknown,
): TeamProtocolV7BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const fromMessages = Array.isArray(source.messages) ? source.messages : [];
  const fromReferences = isDynamicRecord(source.references) ? Object.values(source.references) : [];
  const values = new Map<string, TeamProtocolV7BaseJsonValue>();
  for (const message of [...fromMessages, ...fromReferences]) {
    if (!isDynamicRecord(message) || !isString(message.id) || message.remoteSender === undefined) continue;
    if (!isRemoteSender(message.remoteSender)) throw new Error("Invalid conversation remote sender.");
    values.set(message.id, knownRemoteSender(message.remoteSender));
  }
  if (values.size === 0) return projected;
  const withSender = (message: TeamProtocolV7BaseJsonValue): TeamProtocolV7BaseJsonValue => {
    if (!isDynamicRecord(message) || !isString(message.id)) return message;
    const remoteSender = values.get(message.id);
    return remoteSender === undefined ? message : { ...message, remoteSender };
  };
  const result: TeamProtocolV7BaseJsonObject = { ...projected };
  if (Array.isArray(result.messages)) result.messages = result.messages.map(withSender);
  if (isDynamicRecord(result.references)) {
    result.references = Object.fromEntries(
      Object.entries(result.references).map(([id, value]) => [id, withSender(value)]),
    );
  }
  return result;
}
