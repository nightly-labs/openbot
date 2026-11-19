import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  REMOTE_AGENT_BRIDGE_CAPABILITY,
  REMOTE_AGENT_BRIDGE_ROUTES,
  type RemoteAgentBridgeReachStatus,
} from "@openbot/contracts/team-protocol/remote-agent-bridge-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type {
  RemoteAgentBridge,
  RemoteAgentBridgeInvite,
  RemoteAgentBridgeLink,
} from "../../backend/remote-agent-bridge";
import type { RemoteAgentBridgeReach } from "../remote-agent-bridge-reach";
import type { RemoteServerManager } from "../remote-server-manager";
import { agentRequest, agentScope } from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";
import { stringPayload } from "./validation";

export interface RemoteAgentBridgeIpcDependencies {
  bridge: RemoteAgentBridge | null;
  bridgeReach: RemoteAgentBridgeReach | null;
  remoteServers: RemoteServerManager;
  serverName: () => string;
}

function decodeReachStatus(value: unknown): RemoteAgentBridgeReachStatus {
  if (!isDynamicRecord(value) || typeof value.ready !== "boolean" || typeof value.tailscaleConnected !== "boolean")
    throw new Error(sourceText("error.remote.invalidData"));
  if (typeof value.serveConfigured !== "boolean" || !isString(value.reach) || !isString(value.dnsName))
    throw new Error(sourceText("error.remote.invalidData"));
  return {
    ready: value.ready,
    reach: value.reach,
    tailscaleConnected: value.tailscaleConnected,
    serveConfigured: value.serveConfigured,
    dnsName: value.dnsName,
  };
}

function decodeInvite(value: unknown): RemoteAgentBridgeInvite {
  if (!isDynamicRecord(value) || !isString(value.inviteId) || !isString(value.expiresAt) || !isString(value.serverName))
    throw new Error(sourceText("error.remote.invalidData"));
  return {
    inviteId: value.inviteId,
    code: isString(value.code) ? value.code : "",
    expiresAt: value.expiresAt,
    serverName: value.serverName,
  };
}

function decodeLink(value: unknown): RemoteAgentBridgeLink {
  if (!isDynamicRecord(value) || !isString(value.linkId) || !isString(value.peerName) || !isString(value.createdAt))
    throw new Error(sourceText("error.remote.invalidData"));
  return {
    linkId: value.linkId,
    peerName: value.peerName,
    peerReach: isString(value.peerReach) ? value.peerReach : "",
    createdAt: value.createdAt,
  };
}

export function remoteAgentBridgeIpcHandlers({
  bridge,
  bridgeReach,
  remoteServers,
  serverName,
}: RemoteAgentBridgeIpcDependencies): Pick<IpcGroupHandlers, "remoteAgentBridge"> {
  const local = (): RemoteAgentBridge => {
    if (!bridge) throw new Error(sourceText("error.backend.remoteAgentBridgeUnsupported"));
    return bridge;
  };
  const localReach = (): RemoteAgentBridgeReach => {
    if (!bridgeReach) throw new Error(sourceText("error.backend.remoteAgentBridgeUnsupported"));
    return bridgeReach;
  };
  function remote<T>(serverId: string, route: string, body: unknown, decode: (value: unknown) => T): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, REMOTE_AGENT_BRIDGE_CAPABILITY))
      throw new Error(sourceText("error.backend.remoteAgentBridgeUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, route, decode, { method: "POST", body }));
  }
  return {
    remoteAgentBridge: {
      list: payloadHandler(agentScope, ({ serverId }) =>
        routeToServer(serverId, {
          local: () => ({ invites: local().listInvites(), links: local().listLinks() }),
          remote: (target) =>
            Promise.all([
              remote(target, REMOTE_AGENT_BRIDGE_ROUTES.invites, {}, (value) => {
                if (!isDynamicRecord(value) || !Array.isArray(value.invites))
                  throw new Error(sourceText("error.remote.invalidData"));
                return value.invites.map(decodeInvite);
              }),
              remote(target, REMOTE_AGENT_BRIDGE_ROUTES.links, {}, (value) => {
                if (!isDynamicRecord(value) || !Array.isArray(value.links))
                  throw new Error(sourceText("error.remote.invalidData"));
                return value.links.map(decodeLink);
              }),
            ]).then(([invites, links]) => ({ invites, links })),
        }),
      ),
      createInvite: payloadHandler(agentScope, ({ serverId }) =>
        routeToServer(serverId, {
          local: () => runCauseEffect(local().createInvite(serverName())),
          remote: (target) => remote(target, REMOTE_AGENT_BRIDGE_ROUTES.createInvite, {}, decodeInvite),
        }),
      ),
      revokeInvite: payloadHandler(agentRequest(stringPayload("inviteId")), ({ serverId, payload }) =>
        routeToServer(serverId, {
          local: () => {
            local().revokeInvite(payload);
          },
          remote: (target) =>
            remote(target, REMOTE_AGENT_BRIDGE_ROUTES.revokeInvite, { inviteId: payload }, () => undefined),
        }),
      ),
      redeem: payloadHandler(agentRequest(stringPayload("code", 4096)), ({ serverId, payload }) =>
        routeToServer(serverId, {
          local: () => runCauseEffect(local().redeem(payload, serverName())),
          remote: (target) => remote(target, REMOTE_AGENT_BRIDGE_ROUTES.redeem, { code: payload }, decodeLink),
        }),
      ),
      revokeLink: payloadHandler(agentRequest(stringPayload("linkId")), ({ serverId, payload }) =>
        routeToServer(serverId, {
          local: () => runCauseEffect(local().revokeLink(payload)),
          remote: (target) =>
            remote(target, REMOTE_AGENT_BRIDGE_ROUTES.revokeLink, { linkId: payload }, () => undefined),
        }),
      ),
      reachStatus: payloadHandler(agentScope, ({ serverId }) =>
        routeToServer(serverId, {
          local: () => localReach().status(),
          remote: (target) => remote(target, REMOTE_AGENT_BRIDGE_ROUTES.reachStatus, {}, decodeReachStatus),
        }),
      ),
      prepareReach: payloadHandler(agentScope, ({ serverId }) =>
        routeToServer(serverId, {
          local: () => runCauseEffect(localReach().prepare()),
          remote: (target) => remote(target, REMOTE_AGENT_BRIDGE_ROUTES.prepareReach, {}, decodeReachStatus),
        }),
      ),
    },
  };
}
