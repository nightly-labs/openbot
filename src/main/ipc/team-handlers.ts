import { type HostStatus, LOCAL_SERVER_ID, type ServerSummary } from "@openbot/contracts/ipc";
import type { HostService } from "../host-service";
import type { RemoteDesktopManager } from "../remote-desktop-manager";
import type { RemoteServerManager } from "../remote-server-manager";
import { parseAgentRequest } from "./agent-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";
import {
  parseCreateTeamInvite,
  parseDirectTyping,
  parseHostConfig,
  parseHostIdentity,
  parseJoinServer,
  parseLoginServer,
  parseMarkDirectRead,
  parseReadDirectConversationPage,
  parseRemoteDesktopConnect,
  parseRemoteDesktopDisplay,
  parseReorderServers,
  parseSendDirectMessage,
  parseSetTeamTyping,
  parseUpdateTeamMember,
} from "./server-inputs";
import { requireString, stringPayload } from "./validation";

interface TeamIpcDependencies {
  host: HostService;
  remoteDesktop: RemoteDesktopManager;
  remoteServers: RemoteServerManager;
  takePendingInvite: () => string | null;
}

export function teamIpcHandlers({
  host,
  remoteDesktop,
  remoteServers,
  takePendingInvite,
}: TeamIpcDependencies): Pick<IpcGroupHandlers, "servers" | "host" | "remoteDesktop"> {
  return {
    servers: {
      list: handler(() => withLocalHostSummary(remoteServers.list(), host.getStatus())),
      select: payloadHandler(stringPayload("serverId"), (serverId) =>
        remoteServers.select(serverId).then((servers) => withLocalHostSummary(servers, host.getStatus())),
      ),
      reorder: payloadHandler(parseReorderServers, (request) =>
        remoteServers.reorder(request.serverIds).then((servers) => withLocalHostSummary(servers, host.getStatus())),
      ),
      join: payloadHandler(parseJoinServer, (request) => remoteServers.join(request)),
      previewInvite: payloadHandler(parseJoinServer, (request) => remoteServers.previewInvite(request)),
      takePendingInvite: handler(takePendingInvite),
      login: payloadHandler(parseLoginServer, (request) => remoteServers.login(request)),
      retryConnection: payloadHandler(stringPayload("serverId"), (serverId) => remoteServers.retryConnection(serverId)),
      remove: payloadHandler(stringPayload("serverId"), (serverId) => remoteServers.remove(serverId)),
      getPresence: handler(() =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.getPresence(),
          remote: () => remoteServers.getPresence(),
        }),
      ),
      getPresenceFor: payloadHandler(stringPayload("serverId"), (serverId) =>
        routeToServer(serverId, {
          local: () => host.getPresence(),
          remote: (target) => remoteServers.getPresenceFor(target),
        }),
      ),
      refreshIdentity: payloadHandler(stringPayload("serverId"), (serverId) => remoteServers.refreshIdentity(serverId)),
      listMembers: payloadHandler(stringPayload("serverId"), (serverId) => remoteServers.listMembers(serverId)),
      updateMember: payloadHandler(parseAgentRequest, (request) =>
        remoteServers.updateMember(request.serverId, parseUpdateTeamMember(request.payload)),
      ),
      removeMember: payloadHandler(parseAgentRequest, (request) =>
        remoteServers.removeMember(request.serverId, requireString(request.payload, "memberId")),
      ),
      listInvites: payloadHandler(stringPayload("serverId"), (serverId) => remoteServers.listInvites(serverId)),
      revokeInvite: payloadHandler(parseAgentRequest, (request) =>
        remoteServers.revokeInvite(request.serverId, requireString(request.payload, "inviteId")),
      ),
      createInvite: payloadHandler(parseAgentRequest, (request) =>
        remoteServers.createInvite(request.serverId, parseCreateTeamInvite(request.payload)),
      ),
      setTyping: payloadHandler(parseSetTeamTyping, (parsed) =>
        routeToServer<void>(remoteServers.activeServerId, {
          local: () => host.setTyping(parsed),
          remote: () => remoteServers.setTyping(parsed),
        }),
      ),
      listDirectThreads: handler(() =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.listDirectThreads(),
          remote: () => remoteServers.listDirectThreads(),
        }),
      ),
      readDirectConversation: payloadHandler(stringPayload("memberId"), (memberId) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.readDirectConversation(memberId),
          remote: () => remoteServers.readDirectConversation(memberId),
        }),
      ),
      readDirectConversationPage: payloadHandler(parseReadDirectConversationPage, (parsed) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.readDirectConversationPage(parsed.memberId, parsed.anchor, parsed.limit),
          remote: () => remoteServers.readDirectConversationPage(parsed.memberId, parsed.anchor, parsed.limit),
        }),
      ),
      sendDirectMessage: payloadHandler(parseSendDirectMessage, (parsed) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.sendDirectMessage(parsed),
          remote: () => remoteServers.sendDirectMessage(parsed),
        }),
      ),
      markDirectRead: payloadHandler(parseMarkDirectRead, (parsed) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.markDirectRead(parsed),
          remote: () => remoteServers.markDirectRead(parsed),
        }),
      ),
      setDirectTyping: payloadHandler(parseDirectTyping, (parsed) =>
        routeToServer<void>(remoteServers.activeServerId, {
          local: () => host.setDirectTyping(parsed),
          remote: () => remoteServers.setDirectTyping(parsed),
        }),
      ),
    },
    host: {
      getStatus: handler(() => host.getStatus()),
      configure: payloadHandler(parseHostConfig, (config) => host.configure(config)),
      updateIdentity: payloadHandler(parseHostIdentity, (identity) => host.updateIdentity(identity)),
      getPresence: handler(() => host.getPresence()),
      start: handler(() => host.start()),
      stop: handler(() => host.stop()),
      listMembers: handler(() => host.listMembers()),
      updateMember: payloadHandler(parseUpdateTeamMember, (update) => host.updateMember(update)),
      removeMember: payloadHandler(stringPayload("memberId"), (memberId) => host.removeMember(memberId)),
      listSessions: handler(() => host.listSessions()),
      revokeSession: payloadHandler(stringPayload("sessionId"), (sessionId) => host.revokeSession(sessionId)),
      listInvites: handler(() => host.listInvites()),
      revokeInvite: payloadHandler(stringPayload("inviteId"), (inviteId) => host.revokeInvite(inviteId)),
      createInvite: payloadHandler(parseCreateTeamInvite, (invite) => host.createInvite(invite)),
    },
    remoteDesktop: {
      list: handler(() => remoteDesktop.list()),
      connect: payloadHandler(parseRemoteDesktopConnect, (request) => remoteDesktop.connect(request)),
      selectDisplay: payloadHandler(parseRemoteDesktopDisplay, (request) =>
        remoteDesktop.selectDisplay(request.serverId, request.displayId),
      ),
      disconnect: payloadHandler(stringPayload("sessionId"), (sessionId) => remoteDesktop.disconnect(sessionId)),
    },
  };
}

export function withLocalHostSummary(servers: ServerSummary[], status: HostStatus): ServerSummary[] {
  return servers.map((server) =>
    server.id === LOCAL_SERVER_ID
      ? {
          ...server,
          name: status.serverName ?? "Local",
          logoUrl: status.logoUrl,
          apiUrl: status.apiUrl,
          remoteDesktopAvailable: status.remoteDesktopReady,
          state: status.phase === "error" ? "error" : "online",
          role: status.configured ? "owner" : null,
        }
      : server,
  );
}
