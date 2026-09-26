import type { OpenBotDesktopApi, ServerSummary } from "@openbot/contracts/ipc";

/**
 * What the servers domain reaches in main: the server list and selection, the local host, the
 * settings dialog of one server, the name and logo of a joined server's host, and the remote desktop
 * setup of a server.
 */
export interface ServersPort {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    | "getStatus"
    | "listAgents"
    | "listConversationReads"
    | "listMcpServers"
    | "listModels"
    | "removeMcpServer"
    | "saveMcpServer"
    | "setMcpServerEnabled"
    | "testMcpServer"
  >;
  browser: Pick<OpenBotDesktopApi["browser"], "setVisible">;
  hostAdmin: Pick<OpenBotDesktopApi["hostAdmin"], "updateIdentity">;
  host: Pick<
    OpenBotDesktopApi["host"],
    "configure" | "getStatus" | "onEvent" | "recheckScreenRecording" | "start" | "stop" | "updateIdentity"
  >;
  notifications: Pick<OpenBotDesktopApi["notifications"], "onOpened">;
  remoteDesktop: Pick<
    OpenBotDesktopApi["remoteDesktop"],
    "checkSetup" | "connect" | "disconnect" | "list" | "openSetup" | "test"
  >;
  servers: Pick<
    OpenBotDesktopApi["servers"],
    | "getPresence"
    | "join"
    | "list"
    | "onEvent"
    | "onPresence"
    | "refreshIdentity"
    | "reorder"
    | "retryConnection"
    | "select"
    | "setMuted"
    | "setNotificationLevel"
  >;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function serversPort(): ServersPort {
  return window.openbot;
}

/**
 * The member and invite calls for one server. This computer answers them for the local server
 * through `host`; a remote server answers them through `servers`, addressed by its id.
 */
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

/** The server main marks active. A test teardown can remove the bridge while a join is pending. */
export async function activeServerId(): Promise<string> {
  if (!window.openbot) return "local";
  return (await window.openbot.servers.list()).find((item) => item.active)?.id ?? "local";
}
