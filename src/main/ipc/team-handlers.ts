import { type HostStatus, LOCAL_SERVER_ID, type ServerSummary } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { HostService } from "../host-service";
import type { RemoteDesktopManager } from "../remote-desktop-manager";
import type { RemoteServerManager } from "../remote-server-manager";
import type { RemoteWorkflowError } from "../remote-service-effects";
import { agentRequest } from "./agent-inputs";
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
  parseRemoteDesktopSetupAction,
  parseRemoteDesktopTest,
  parseReorderServers,
  parseSendDirectMessage,
  parseSetServerMuted,
  parseSetServerNotificationLevel,
  parseSetTeamTyping,
  parseUpdateTeamMember,
} from "./server-inputs";
import { stringPayload } from "./validation";

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
      setMuted: payloadHandler(parseSetServerMuted, ({ serverId, muted, durationMs }) =>
        Effect.runPromise(
          remoteServers
            .setMuted(serverId, muted, durationMs)
            .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ).then((servers) => withLocalHostSummary(servers, host.getStatus())),
      ),
      setNotificationLevel: payloadHandler(parseSetServerNotificationLevel, ({ serverId, level }) =>
        Effect.runPromise(
          remoteServers
            .setNotificationLevel(serverId, level)
            .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ).then((servers) => withLocalHostSummary(servers, host.getStatus())),
      ),
      list: handler(() => withLocalHostSummary(remoteServers.list(), host.getStatus())),
      select: payloadHandler(stringPayload("serverId"), (serverId) =>
        Effect.runPromise(
          remoteServers.select(serverId).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ).then((servers) => withLocalHostSummary(servers, host.getStatus())),
      ),
      reorder: payloadHandler(parseReorderServers, (request) =>
        Effect.runPromise(
          remoteServers.reorder(request.serverIds).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ).then((servers) => withLocalHostSummary(servers, host.getStatus())),
      ),
      join: payloadHandler(parseJoinServer, (request) =>
        Effect.runPromise(
          remoteServers.join(request).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ),
      ),
      previewInvite: payloadHandler(parseJoinServer, (request) =>
        Effect.runPromise(
          remoteServers.previewInvite(request).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ),
      ),
      takePendingInvite: handler(takePendingInvite),
      login: payloadHandler(parseLoginServer, (request) =>
        Effect.runPromise(
          remoteServers.login(request).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ),
      ),
      retryConnection: payloadHandler(stringPayload("serverId"), (serverId) =>
        Effect.runPromise(
          remoteServers.retryConnection(serverId).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ),
      ),
      remove: payloadHandler(stringPayload("serverId"), (serverId) =>
        Effect.runPromise(
          remoteServers.remove(serverId).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ),
      ),
      getPresence: handler(() =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.getPresence(),
          remote: () => remoteServers.getPresence(),
        }),
      ),
      getPresenceFor: payloadHandler(stringPayload("serverId"), (serverId) =>
        routeToServer(serverId, {
          local: () => host.getPresence(),
          remote: (target) =>
            Effect.runPromise(
              remoteServers.getPresenceFor(target).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
            ),
        }),
      ),
      refreshIdentity: payloadHandler(stringPayload("serverId"), (serverId) =>
        Effect.runPromise(
          remoteServers.refreshIdentity(serverId).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ),
      ),
      listMembers: payloadHandler(stringPayload("serverId"), (serverId) =>
        Effect.runPromise(
          remoteServers.listMembers(serverId).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ),
      ),
      updateMember: payloadHandler(agentRequest(parseUpdateTeamMember), ({ serverId, payload }) =>
        Effect.runPromise(
          remoteServers
            .updateMember(serverId, payload)
            .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ),
      ),
      removeMember: payloadHandler(agentRequest(stringPayload("memberId")), ({ serverId, payload }) =>
        Effect.runPromise(
          remoteServers
            .removeMember(serverId, payload)
            .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ),
      ),
      listInvites: payloadHandler(stringPayload("serverId"), (serverId) =>
        Effect.runPromise(
          remoteServers.listInvites(serverId).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ),
      ),
      revokeInvite: payloadHandler(agentRequest(stringPayload("inviteId")), ({ serverId, payload }) =>
        Effect.runPromise(
          remoteServers
            .revokeInvite(serverId, payload)
            .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ),
      ),
      createInvite: payloadHandler(agentRequest(parseCreateTeamInvite), ({ serverId, payload }) =>
        Effect.runPromise(
          remoteServers
            .createInvite(serverId, payload)
            .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ),
      ),
      setTyping: payloadHandler(parseSetTeamTyping, (parsed) =>
        routeToServer<void>(remoteServers.activeServerId, {
          local: () => host.setTyping(parsed),
          remote: () =>
            Effect.runPromise(
              remoteServers.setTyping(parsed).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
            ),
        }),
      ),
      listDirectThreads: handler(() =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.listDirectThreads(),
          remote: () =>
            Effect.runPromise(
              remoteServers.listDirectThreads().pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
            ),
        }),
      ),
      readDirectConversation: payloadHandler(stringPayload("memberId"), (memberId) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.readDirectConversation(memberId),
          remote: () =>
            Effect.runPromise(
              remoteServers
                .readDirectConversation(memberId)
                .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
            ),
        }),
      ),
      readDirectConversationPage: payloadHandler(parseReadDirectConversationPage, (parsed) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.readDirectConversationPage(parsed.memberId, parsed.anchor, parsed.limit),
          remote: () =>
            Effect.runPromise(
              remoteServers
                .readDirectConversationPage(parsed.memberId, parsed.anchor, parsed.limit)
                .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
            ),
        }),
      ),
      sendDirectMessage: payloadHandler(parseSendDirectMessage, (parsed) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.sendDirectMessage(parsed),
          remote: () =>
            Effect.runPromise(
              remoteServers
                .sendDirectMessage(parsed)
                .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
            ),
        }),
      ),
      markDirectRead: payloadHandler(parseMarkDirectRead, (parsed) =>
        routeToServer(remoteServers.activeServerId, {
          local: () => host.markDirectRead(parsed),
          remote: () =>
            Effect.runPromise(
              remoteServers.markDirectRead(parsed).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
            ),
        }),
      ),
      setDirectTyping: payloadHandler(parseDirectTyping, (parsed) =>
        routeToServer<void>(remoteServers.activeServerId, {
          local: () => host.setDirectTyping(parsed),
          remote: () =>
            Effect.runPromise(
              remoteServers.setDirectTyping(parsed).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
            ),
        }),
      ),
    },
    host: {
      getStatus: handler(() => host.getStatus()),
      configure: payloadHandler(parseHostConfig, (config) =>
        Effect.runPromise(host.configure(config).pipe(Effect.mapError((error) => error.cause))),
      ),
      updateIdentity: payloadHandler(parseHostIdentity, (identity) =>
        Effect.runPromise(host.updateIdentity(identity).pipe(Effect.mapError((error) => error.cause))),
      ),
      getPresence: handler(() => host.getPresence()),
      start: handler(() => Effect.runPromise(host.start().pipe(Effect.mapError((error) => error.cause)))),
      stop: handler(() => Effect.runPromise(host.stop().pipe(Effect.mapError((error) => error.cause)))),
      recheckScreenRecording: handler(() =>
        Effect.runPromise(host.recheckScreenRecording().pipe(Effect.mapError((error) => error.cause))),
      ),
      listMembers: handler(() => Effect.runPromise(host.listMembers().pipe(Effect.mapError((error) => error.cause)))),
      updateMember: payloadHandler(parseUpdateTeamMember, (update) =>
        Effect.runPromise(host.updateMember(update).pipe(Effect.mapError((error) => error.cause))),
      ),
      removeMember: payloadHandler(stringPayload("memberId"), (memberId) =>
        Effect.runPromise(host.removeMember(memberId).pipe(Effect.mapError((error) => error.cause))),
      ),
      listSessions: handler(() => host.listSessions()),
      revokeSession: payloadHandler(stringPayload("sessionId"), (sessionId) =>
        Effect.runPromise(host.revokeSession(sessionId).pipe(Effect.mapError((error) => error.cause))),
      ),
      listInvites: handler(() => Effect.runPromise(host.listInvites().pipe(Effect.mapError((error) => error.cause)))),
      revokeInvite: payloadHandler(stringPayload("inviteId"), (inviteId) =>
        Effect.runPromise(host.revokeInvite(inviteId).pipe(Effect.mapError((error) => error.cause))),
      ),
      createInvite: payloadHandler(parseCreateTeamInvite, (invite) =>
        Effect.runPromise(host.createInvite(invite).pipe(Effect.mapError((error) => error.cause))),
      ),
    },
    remoteDesktop: {
      checkSetup: payloadHandler(stringPayload("serverId"), (serverId) =>
        routeToServer(serverId, {
          local: () => Effect.runPromise(host.checkRemoteDesktopSetup().pipe(Effect.mapError((error) => error.cause))),
          remote: (target) =>
            Effect.runPromise(
              remoteServers.checkRemoteDesktopSetup(target).pipe(Effect.mapError((error) => error.cause)),
            ),
        }),
      ),
      openSetup: payloadHandler(parseRemoteDesktopSetupAction, (action) =>
        Effect.runPromise(host.openRemoteDesktopSetup(action).pipe(Effect.mapError((error) => error.cause))),
      ),
      test: payloadHandler(parseRemoteDesktopTest, (input) =>
        routeToServer(input.serverId, {
          local: () =>
            Effect.runPromise(
              host.testLocalRemoteDesktop(input.sessionId, input.action).pipe(Effect.mapError((error) => error.cause)),
            ),
          remote: () =>
            Effect.runPromise(remoteServers.testRemoteDesktop(input).pipe(Effect.mapError((error) => error.cause))),
        }),
      ),
      list: handler(() => remoteDesktop.list()),
      connect: payloadHandler(parseRemoteDesktopConnect, (request) =>
        Effect.runPromise(
          remoteDesktop.connect(request).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ),
      ),
      selectDisplay: payloadHandler(parseRemoteDesktopDisplay, (request) =>
        Effect.runPromise(
          remoteDesktop
            .selectDisplay(request.serverId, request.displayId)
            .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ),
      ),
      disconnect: payloadHandler(stringPayload("sessionId"), (sessionId) =>
        Effect.runPromise(
          remoteDesktop.disconnect(sessionId).pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
        ),
      ),
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
