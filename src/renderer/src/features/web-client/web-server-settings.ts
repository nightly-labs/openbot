import type {
  AvatarImageInput,
  InviteSummary,
  McpServerConfig,
  McpTestResult,
  ServerSummary,
  TeamInviteSummary,
  TeamPresenceMember,
  TeamPresenceSnapshot,
  UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import {
  listMcpServers,
  removeMcpServer as removeMcpServerRequest,
  saveMcpServer as saveMcpServerRequest,
  setMcpServerEnabled as setMcpServerEnabledRequest,
  testMcpServer as testMcpServerRequest,
  updateHostIdentity,
} from "@openbot/team-client/team-admin-requests";
import { errorMessage } from "@openbot/ui/error-message";
import { createEffect, createStore } from "solid-js";
import { serverCanAdminister, serverRoleCanAdminister } from "../servers/server-capabilities";
import type { WebAdminRuntime } from "./web-runtime";

interface WebServerSettingsState {
  open: boolean;
  members: TeamPresenceMember[];
  invites: TeamInviteSummary[];
  loading: boolean;
  error: string | null;
  mcp: McpServerConfig[];
  mcpError: string | null;
}

/**
 * The settings dialog of the connected host, as the desktop `server-settings.tsx` shows it for a
 * remote server. The web connects to one host at a time, so the dialog is for that host only.
 *
 * Every mutation ends in a new read rather than a patch of the lists: the account service and the
 * host are the authority, and a failed write must not leave a row that they did not accept.
 */
export function createWebServerSettings(options: {
  server: () => ServerSummary | undefined;
  admin: () => WebAdminRuntime | undefined;
  presence: () => TeamPresenceSnapshot | null;
  refreshHosts: () => Promise<void>;
}) {
  const [state, setState] = createStore<WebServerSettingsState>({
    open: false,
    members: [],
    invites: [],
    loading: false,
    error: null,
    mcp: [],
    mcpError: null,
  });
  /** Bumped by every open and refresh, so a slower earlier load cannot paint over a newer one. */
  let request = 0;
  /** The same guard for the MCP list. It loads from a different event, so it has its own counter. */
  let mcpRequest = 0;
  let restoreTarget: HTMLElement | null = null;

  function requireAdmin(): { server: ServerSummary; admin: WebAdminRuntime } {
    const server = options.server();
    const admin = options.admin();
    if (!server || !admin || server.state !== "online") throw new Error("Connect to this server first.");
    return { server, admin };
  }

  // Typing updates do not read the account service again. Membership and online changes are enough
  // to show an accepted invitation.
  let previousPresence = "";
  createEffect(
    () => (state.open ? options.presence() : null),
    (presence) => {
      if (!presence) return;
      const signature = JSON.stringify(
        presence.members.map((member) => [member.id, member.role, member.disabled, member.online]),
      );
      if (signature === previousPresence) return;
      previousPresence = signature;
      void refresh();
    },
  );

  // A member change revokes every session on the host, this one too. Load again after it reconnects.
  let previousState: ServerSummary["state"] | undefined;
  createEffect(
    () => (state.open ? options.server()?.state : undefined),
    (serverState) => {
      const reconnected = serverState === "online" && previousState !== undefined && previousState !== "online";
      previousState = serverState;
      if (reconnected) void refresh();
    },
  );

  async function refresh(): Promise<void> {
    const current = ++request;
    setState((draft) => {
      draft.loading = true;
      draft.error = null;
    });
    try {
      const { server, admin } = requireAdmin();
      const canManage = serverRoleCanAdminister(server);
      const [presence, members, invites] = await Promise.all([
        admin.team.getPresence(),
        canManage ? admin.team.listMembers() : Promise.resolve(null),
        canManage ? admin.team.listInvites() : Promise.resolve([]),
      ]);
      if (current !== request) return;
      const presenceById = new Map(presence.members.map((member) => [member.id, member]));
      setState((draft) => {
        draft.members = (members ?? presence.members).map((member) => ({
          ...member,
          online: presenceById.get(member.id)?.online ?? false,
          typingAgentId: presenceById.get(member.id)?.typingAgentId ?? null,
        }));
        draft.invites = invites;
      });
    } catch (error) {
      if (current === request)
        setState((draft) => {
          draft.error = errorMessage(error, "The server settings could not load.");
        });
    } finally {
      if (current === request)
        setState((draft) => {
          draft.loading = false;
        });
    }
  }

  function open(trigger: HTMLElement | null): void {
    request += 1;
    mcpRequest += 1;
    restoreTarget = trigger;
    previousPresence = "";
    setState((draft) => {
      draft.open = true;
      draft.members = [];
      draft.invites = [];
      draft.mcp = [];
      draft.mcpError = null;
      draft.error = null;
    });
    void refresh();
  }

  function setOpen(value: boolean): void {
    setState((draft) => {
      draft.open = value;
    });
  }

  async function saveIdentity(input: { serverName: string; logo?: AvatarImageInput | null }): Promise<void> {
    const { server, admin } = requireAdmin();
    if (!serverCanAdminister(server, "host-admin-v1"))
      throw new Error("The name and logo of this server can only change on the computer that runs it.");
    await updateHostIdentity(admin.request, input);
    await options.refreshHosts();
    await refresh();
  }

  async function mutateTeam<T>(mutate: (admin: WebAdminRuntime) => Promise<T>): Promise<T> {
    const result = await mutate(requireAdmin().admin);
    await refresh();
    return result;
  }

  async function refreshMcp(): Promise<void> {
    const current = ++mcpRequest;
    try {
      const configs = await listMcpServers(requireAdmin().admin.request);
      if (current !== mcpRequest) return;
      setState((draft) => {
        draft.mcp = configs;
        draft.mcpError = null;
      });
    } catch (error) {
      // Shown in the panel: nothing waits for this promise when a section opens.
      if (current === mcpRequest)
        setState((draft) => {
          draft.mcpError = errorMessage(error, "The MCP servers could not load.");
        });
    }
  }

  /** The host answers each change with the whole list. A read still in flight has the old list. */
  async function mutateMcp(mutate: (admin: WebAdminRuntime) => Promise<McpServerConfig[]>): Promise<void> {
    const configs = await mutate(requireAdmin().admin);
    mcpRequest += 1;
    setState((draft) => {
      draft.mcp = configs;
      draft.mcpError = null;
    });
  }

  return {
    state,
    restoreTarget: () => restoreTarget,
    open,
    setOpen,
    refresh,
    saveIdentity,
    createInvite: (input: { role: "admin" | "member"; email?: string; permanent?: boolean }): Promise<InviteSummary> =>
      mutateTeam((admin) => admin.team.createInvite(input)),
    updateMember: async (input: UpdateTeamMemberInput): Promise<void> => {
      await mutateTeam((admin) => admin.team.updateMember(input));
    },
    removeMember: (memberId: string): Promise<void> => mutateTeam((admin) => admin.team.removeMember(memberId)),
    revokeInvite: (inviteId: string): Promise<void> => mutateTeam((admin) => admin.team.revokeInvite(inviteId)),
    refreshMcp,
    saveMcpServer: (config: McpServerConfig) => mutateMcp((admin) => saveMcpServerRequest(admin.request, { config })),
    removeMcpServer: (mcpServerId: string) =>
      mutateMcp((admin) => removeMcpServerRequest(admin.request, { mcpServerId })),
    setMcpServerEnabled: (mcpServerId: string, enabled: boolean) =>
      mutateMcp((admin) => setMcpServerEnabledRequest(admin.request, { mcpServerId, enabled })),
    testMcpServer: (config: McpServerConfig): Promise<McpTestResult> =>
      testMcpServerRequest(requireAdmin().admin.request, { config }),
  };
}
