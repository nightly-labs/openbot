import type { OpenBotDesktopApi, ServerSummary } from "@openbot/contracts/ipc";

export interface ServersPort {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    | "getStatus"
    | "listAgents"
    | "listConversationReads"
    | "listHiddenAgents"
    | "listAgentNotificationLevels"
    | "listMcpServers"
    | "listModels"
    | "removeMcpServer"
    | "saveMcpServer"
    | "setMcpServerEnabled"
    | "testMcpServer"
    | "signInMcpServer"
    | "mcpSignInPage"
    | "mcpSignInRelay"
    | "openMcpSignInRelay"
    | "completeMcpSignInRelay"
    | "cancelMcpSignIn"
    | "signOutMcpServer"
    | "listMcpSignIns"
    | "mcpSignInApp"
    | "saveMcpSignInApp"
    | "removeMcpSignInApp"
  >;
  events: OpenBotDesktopApi["events"];
  auth: Pick<OpenBotDesktopApi["auth"], "onEvent">;
  browser: Pick<OpenBotDesktopApi["browser"], "setVisible">;
  hostAdmin: Pick<
    OpenBotDesktopApi["hostAdmin"],
    "cancelUpdate" | "getUpdateStatus" | "restartHost" | "rotateHostKey" | "startUpdate" | "updateIdentity"
  >;
  hostedServers: Pick<
    OpenBotDesktopApi["hostedServers"],
    "list" | "openCheckout" | "openCustomCheckout" | "restart" | "wake"
  >;
  localServers: OpenBotDesktopApi["localServers"];
  host: Pick<
    OpenBotDesktopApi["host"],
    | "configure"
    | "getRemoteControlPolicy"
    | "getStatus"
    | "onEvent"
    | "recheckScreenRecording"
    | "rotateIdentityKey"
    | "setRemoteControlPolicy"
    | "start"
    | "stop"
    | "stopRemoteControl"
    | "updateIdentity"
  >;
  notifications: Pick<OpenBotDesktopApi["notifications"], "onOpened" | "onWorkflowOpened">;
  remoteDesktop: Pick<
    OpenBotDesktopApi["remoteDesktop"],
    "checkSetup" | "connect" | "disconnect" | "list" | "openSetup" | "test"
  >;
  servers: Pick<
    OpenBotDesktopApi["servers"],
    | "getPresenceFor"
    | "join"
    | "list"
    | "onEvent"
    | "onPresence"
    | "refreshIdentity"
    | "remove"
    | "reorder"
    | "retryConnection"
    | "select"
    | "setMuted"
    | "setNotificationLevel"
  >;
}

export function serversPort(): ServersPort {
  return window.openbot;
}

export type ServerAdminPort = Pick<
  OpenBotDesktopApi["host"],
  "getPresence" | "listMembers" | "listInvites" | "createInvite" | "updateMember" | "removeMember" | "revokeInvite"
>;

export function serverAdminPort(server: Pick<ServerSummary, "id" | "kind">): ServerAdminPort {
  if (server.kind === "local") return window.openbot.host;
  const serverId = server.id;
  return {
    getPresence: () => window.openbot.servers.getPresenceFor(serverId),
    listMembers: () => window.openbot.servers.listMembers(serverId),
    listInvites: () => window.openbot.servers.listInvites(serverId),
    createInvite: (input) => window.openbot.servers.createInvite(input, serverId),
    updateMember: (input) => window.openbot.servers.updateMember(input, serverId),
    removeMember: (memberId) => window.openbot.servers.removeMember(memberId, serverId),
    revokeInvite: (inviteId) => window.openbot.servers.revokeInvite(inviteId, serverId),
  };
}

export async function activeServerId(): Promise<string> {
  if (!window.openbot) return "local";
  return (await window.openbot.servers.list()).find((item) => item.active)?.id ?? "local";
}
