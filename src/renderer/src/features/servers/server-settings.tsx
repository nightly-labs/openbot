import type {
  AvatarImageInput,
  InviteSummary,
  McpServerConfig,
  McpServerEntry,
  McpServerStatus,
  TeamInviteSummary,
  TeamPresenceMember,
  UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal, flush } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { errorMessage } from "../../error-message";
import { createSimpleContext } from "../../simple-context";
import { useServers } from "./servers-context";

/**
 * The settings dialog for one server: its identity, whether it is published,
 * and who can reach it.
 *
 * Global rather than scoped to the active server, and deliberately so - the
 * server rail opens this for *any* server in the list, so `openServerSettings`
 * takes an id. Scoping it to the active server would break opening the settings
 * of a server the user has not switched to.
 *
 * Ungated - the dialog is closed until someone opens it, and `refreshServerSettings`
 * carries its own loading and error signals for what happens after that.
 *
 * Every mutation ends in `refreshServerSettings(server.id)` rather than patching
 * the lists it just changed: main is the authority on membership, and a failed
 * write must not leave a row the server never accepted. The `operationSucceeded`
 * latch in each is what keeps a failure *after* the write from being reported as
 * a failed write.
 */
const ServerSettings = createSimpleContext({
  name: "Server settings",
  init: () => {
    const { servers, setServers, hostStatus, setHostStatus } = useServers();
    const [serverSettingsTargetId, setServerSettingsTargetId] = createSignal<string | null>(null);
    const [serverSettingsOpen, setServerSettingsOpen] = createSignal(false);
    const [serverSettingsMembers, setServerSettingsMembers] = createSignal<TeamPresenceMember[]>([]);
    const [serverSettingsInvites, setServerSettingsInvites] = createSignal<TeamInviteSummary[]>([]);
    const [serverSettingsLoading, setServerSettingsLoading] = createSignal(false);
    const [serverSettingsError, setServerSettingsError] = createSignal<string | null>(null);
    const [serverSettingsMcp, setServerSettingsMcp] = createSignal<McpServerEntry[]>([]);
    const [serverSettingsMcpWatching, setServerSettingsMcpWatching] = createSignal(false);
    /**
     * The last states main published, kept beside the list rather than only inside it.
     *
     * A list reply is built before it is sent, so a state that settles while it is in flight would
     * be painted over by the older snapshot it carries - the row would then read `Connecting…`
     * until the next state change, which for a settled server never comes. The event order is main's
     * own, so these win over any reply.
     */
    let serverSettingsMcpStatuses = new Map<string, McpServerStatus>();
    /** Bumped by every open and refresh, so a slower earlier load cannot paint over a newer one. */
    let serverSettingsRequest = 0;
    let serverSettingsRestoreTarget: HTMLElement | null = null;

    const serverSettingsTarget = createMemo(() => servers().find((server) => server.id === serverSettingsTargetId()));

    createEffect(
      () => ({ open: serverSettingsOpen(), id: serverSettingsTargetId() }),
      ({ open, id }) => {
        if (!open || !id) return;
        let previous = "";
        return window.openbot.servers.onPresence((presence) => {
          // Typing updates must not read the account API again. Membership and
          // online changes are enough to refresh an accepted invitation.
          const signature = JSON.stringify(
            presence.members.map((member) => [member.id, member.role, member.disabled, member.online]),
          );
          if (signature === previous) return;
          previous = signature;
          flush(() => setServerSettingsMembers(presence.members));
          void refreshServerSettings(id);
        }, id);
      },
    );

    /**
     * While the MCP tab is open, the monitor probes each server and pushes the states as they
     * settle. Only the states ride the event - a configuration carries `env` values and headers -
     * so the rows are patched here rather than replaced.
     */
    createEffect(
      () => ({ watching: serverSettingsMcpWatching(), id: serverSettingsTargetId() }),
      ({ watching, id }) => {
        if (!watching || !id) return;
        return window.openbot.agent.onScopedEvent(({ serverId, event }) => {
          if (serverId !== id || event.type !== "mcp-servers-changed") return;
          serverSettingsMcpStatuses = new Map(event.statuses.map((status) => [status.id, status]));
          setServerSettingsMcp(withMcpStatuses);
        });
      },
    );

    async function refreshServerSettings(serverId = serverSettingsTargetId()): Promise<void> {
      if (!serverId) return;
      const request = ++serverSettingsRequest;
      setServerSettingsLoading(true);
      setServerSettingsError(null);
      try {
        let server = servers().find((item) => item.id === serverId);
        if (!server) throw new Error("This server is not available.");
        let identityError: string | null = null;
        if (server.kind === "remote") {
          try {
            const refreshed = await window.openbot.servers.refreshIdentity(serverId);
            setServers((current) => current.map((item) => (item.id === serverId ? refreshed : item)));
            server = refreshed;
          } catch (error) {
            identityError = errorMessage(error, "The server identity could not refresh.");
          }
        }
        const canManage =
          server.kind === "local" ? hostStatus().configured : server.role === "admin" || server.role === "owner";
        const canUseNetwork = server.kind === "local" || server.state === "online";
        const [presence, members, invites] = await Promise.all([
          server.kind === "local" ? window.openbot.host.getPresence() : window.openbot.servers.getPresenceFor(serverId),
          canManage && canUseNetwork
            ? server.kind === "local"
              ? window.openbot.host.listMembers()
              : window.openbot.servers.listMembers(serverId)
            : Promise.resolve(null),
          canManage && canUseNetwork
            ? server.kind === "local"
              ? window.openbot.host.listInvites()
              : window.openbot.servers.listInvites(serverId)
            : Promise.resolve([]),
        ]);
        if (request !== serverSettingsRequest || serverSettingsTargetId() !== serverId) return;
        const presenceById = new Map(presence.members.map((member) => [member.id, member]));
        setServerSettingsMembers(
          (members ?? presence.members).map((member) => ({
            ...member,
            online: presenceById.get(member.id)?.online ?? false,
            typingAgentId: presenceById.get(member.id)?.typingAgentId ?? null,
          })),
        );
        setServerSettingsInvites(invites);
        if (identityError) setServerSettingsError(identityError);
      } catch (error) {
        if (request === serverSettingsRequest && serverSettingsTargetId() === serverId) {
          setServerSettingsError(errorMessage(error, "The server settings could not load."));
        }
      } finally {
        if (request === serverSettingsRequest) setServerSettingsLoading(false);
      }
    }

    function openServerSettings(serverId: string, trigger: HTMLElement | null): void {
      serverSettingsRequest += 1;
      serverSettingsRestoreTarget = trigger;
      setServerSettingsTargetId(serverId);
      setServerSettingsOpen(true);
      setServerSettingsMembers([]);
      setServerSettingsInvites([]);
      setServerSettingsMcp([]);
      serverSettingsMcpStatuses = new Map();
      setServerSettingsError(null);
      void refreshServerSettings(serverId);
    }

    async function saveServerIdentity(input: { serverName: string; logo?: AvatarImageInput | null }): Promise<void> {
      const server = serverSettingsTarget();
      if (server?.kind !== "local") throw new Error("Only the local server identity can change here.");
      const analytics = desktopAnalytics.scope();
      let operationSucceeded = false;
      try {
        const status = hostStatus().configured
          ? await window.openbot.host.updateIdentity(input)
          : await window.openbot.host.configure(input);
        analytics.track("team_action", {
          action: "identity_saved",
          result: "succeeded",
          server_kind: "local",
        });
        operationSucceeded = true;
        setHostStatus(status);
        setServers(await window.openbot.servers.list());
        await refreshServerSettings(server.id);
      } catch (error) {
        if (!operationSucceeded) {
          analytics.track("team_action", {
            action: "identity_saved",
            result: "failed",
            server_kind: "local",
            failure_code: "identity_save_failed",
          });
        }
        throw error;
      }
    }

    async function setServerPublished(published: boolean): Promise<void> {
      const server = serverSettingsTarget();
      if (server?.kind !== "local") throw new Error("Only the local server can change publication.");
      const analytics = desktopAnalytics.scope();
      const action = published ? ("published" as const) : ("unpublished" as const);
      let operationSucceeded = false;
      try {
        const status = published ? await window.openbot.host.start() : await window.openbot.host.stop();
        if (published && status.phase !== "online") throw new Error("publish_failed");
        analytics.track("team_action", { action, result: "succeeded", server_kind: "local" });
        operationSucceeded = true;
        setHostStatus(status);
        setServers(await window.openbot.servers.list());
        await refreshServerSettings(server.id);
      } catch (error) {
        if (!operationSucceeded) {
          analytics.track("team_action", {
            action,
            result: "failed",
            server_kind: "local",
            failure_code: published ? "publish_failed" : "unpublish_failed",
          });
        }
        throw error;
      }
    }

    async function createServerInvite(input: { role: "admin" | "member"; email?: string }): Promise<InviteSummary> {
      const server = serverSettingsTarget();
      if (!server) throw new Error("This server is not available.");
      const analytics = desktopAnalytics.scope();
      let operationSucceeded = false;
      try {
        const invite =
          server.kind === "local"
            ? await window.openbot.host.createInvite(input)
            : await window.openbot.servers.createInvite(server.id, input);
        analytics.track("team_action", {
          action: "invite_created",
          result: "succeeded",
          server_kind: server.kind,
          role: input.role,
          email_bound: Boolean(input.email),
        });
        operationSucceeded = true;
        await refreshServerSettings(server.id);
        return invite;
      } catch (error) {
        if (!operationSucceeded) {
          analytics.track("team_action", {
            action: "invite_created",
            result: "failed",
            server_kind: server.kind,
            role: input.role,
            email_bound: Boolean(input.email),
            failure_code: "invite_create_failed",
          });
        }
        throw error;
      }
    }

    async function updateServerMember(input: UpdateTeamMemberInput): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) throw new Error("This server is not available.");
      const analytics = desktopAnalytics.scope();
      let operationSucceeded = false;
      try {
        if (server.kind === "local") await window.openbot.host.updateMember(input);
        else await window.openbot.servers.updateMember(server.id, input);
        analytics.track("team_action", { action: "member_updated", result: "succeeded", server_kind: server.kind });
        operationSucceeded = true;
        await refreshServerSettings(server.id);
      } catch (error) {
        if (!operationSucceeded) {
          analytics.track("team_action", {
            action: "member_updated",
            result: "failed",
            server_kind: server.kind,
            failure_code: "member_update_failed",
          });
        }
        throw error;
      }
    }

    async function removeServerMember(memberId: string): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) throw new Error("This server is not available.");
      const analytics = desktopAnalytics.scope();
      let operationSucceeded = false;
      try {
        if (server.kind === "local") await window.openbot.host.removeMember(memberId);
        else await window.openbot.servers.removeMember(server.id, memberId);
        analytics.track("team_action", { action: "member_removed", result: "succeeded", server_kind: server.kind });
        operationSucceeded = true;
        await refreshServerSettings(server.id);
      } catch (error) {
        if (!operationSucceeded) {
          analytics.track("team_action", {
            action: "member_removed",
            result: "failed",
            server_kind: server.kind,
            failure_code: "member_remove_failed",
          });
        }
        throw error;
      }
    }

    async function revokeServerInvite(inviteId: string): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) throw new Error("This server is not available.");
      const analytics = desktopAnalytics.scope();
      let operationSucceeded = false;
      try {
        if (server.kind === "local") await window.openbot.host.revokeInvite(inviteId);
        else await window.openbot.servers.revokeInvite(server.id, inviteId);
        analytics.track("team_action", { action: "invite_revoked", result: "succeeded", server_kind: server.kind });
        operationSucceeded = true;
        await refreshServerSettings(server.id);
      } catch (error) {
        if (!operationSucceeded) {
          analytics.track("team_action", {
            action: "invite_revoked",
            result: "failed",
            server_kind: server.kind,
            failure_code: "invite_revoke_failed",
          });
        }
        throw error;
      }
    }

    /**
     * The MCP list, and the connections behind it.
     *
     * `watchMcpServers` is what "connect while the modal is open" means: opening the tab asks main
     * to handshake each enabled server, and leaving it asks main to disconnect. Nothing here keeps a
     * connection an agent uses - the providers make their own when an agent starts.
     */
    async function watchMcpServers(visible: boolean): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) return;
      if (!visible) {
        setServerSettingsMcpWatching(false);
        // A closed panel holds no connection, so main drops its states: keeping them here would
        // report a connection that no longer exists the next time the panel opens.
        serverSettingsMcpStatuses = new Map();
        await window.openbot.agent.closeMcpStatus(server.id);
        return;
      }
      const request = ++serverSettingsRequest;
      const entries = await window.openbot.agent.openMcpStatus(server.id);
      if (request !== serverSettingsRequest || serverSettingsTargetId() !== server.id) return;
      setServerSettingsMcp(withMcpStatuses(entries));
      setServerSettingsMcpWatching(true);
    }

    async function refreshMcpServers(): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) return;
      const request = ++serverSettingsRequest;
      const entries = await window.openbot.agent.listMcpServers(server.id);
      if (request !== serverSettingsRequest || serverSettingsTargetId() !== server.id) return;
      setServerSettingsMcp(withMcpStatuses(entries));
    }

    /** The rows a reply carries, with any state that has arrived since it was built. */
    function withMcpStatuses(entries: McpServerEntry[]): McpServerEntry[] {
      return entries.map((entry) => {
        const status = serverSettingsMcpStatuses.get(entry.config.id);
        return status ? { ...entry, state: status.state, toolCount: status.toolCount, error: status.error } : entry;
      });
    }

    async function saveMcpServer(config: McpServerConfig): Promise<void> {
      await runMcpMutation("mcp_server_saved", "mcp_server_save_failed", (serverId) =>
        window.openbot.agent.saveMcpServer({ config }, serverId),
      );
    }

    async function removeMcpServer(mcpServerId: string): Promise<void> {
      await runMcpMutation("mcp_server_removed", "mcp_server_remove_failed", (serverId) =>
        window.openbot.agent.removeMcpServer({ mcpServerId }, serverId),
      );
    }

    async function setMcpServerEnabled(mcpServerId: string, enabled: boolean): Promise<void> {
      await runMcpMutation("mcp_server_toggled", "mcp_server_toggle_failed", (serverId) =>
        window.openbot.agent.setMcpServerEnabled({ mcpServerId, enabled }, serverId),
      );
    }

    /**
     * Main answers every mutation with the whole list, so the rows are taken from the reply rather
     * than patched. The `operationSucceeded` latch keeps a failure after the write from being
     * reported as a failed write, as every other mutation in this file does.
     */
    async function runMcpMutation(
      action: "mcp_server_saved" | "mcp_server_removed" | "mcp_server_toggled",
      failureCode: string,
      mutate: (serverId: string) => Promise<McpServerEntry[]>,
    ): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) throw new Error("This server is not available.");
      const analytics = desktopAnalytics.scope();
      let operationSucceeded = false;
      try {
        const entries = await mutate(server.id);
        analytics.track("team_action", { action, result: "succeeded", server_kind: server.kind });
        operationSucceeded = true;
        if (serverSettingsTargetId() === server.id) setServerSettingsMcp(withMcpStatuses(entries));
      } catch (error) {
        if (!operationSucceeded) {
          analytics.track("team_action", {
            action,
            result: "failed",
            server_kind: server.kind,
            failure_code: failureCode,
          });
        }
        throw error;
      }
    }
    return {
      serverSettingsTarget,
      serverSettingsOpen,
      setServerSettingsOpen,
      serverSettingsRestoreTarget: () => serverSettingsRestoreTarget,
      serverSettingsMembers,
      serverSettingsInvites,
      serverSettingsLoading,
      serverSettingsError,
      openServerSettings,
      refreshServerSettings,
      saveServerIdentity,
      setServerPublished,
      createServerInvite,
      updateServerMember,
      removeServerMember,
      revokeServerInvite,
      serverSettingsMcp,
      watchMcpServers,
      refreshMcpServers,
      saveMcpServer,
      removeMcpServer,
      setMcpServerEnabled,
    };
  },
});

export const ServerSettingsProvider = ServerSettings.provider;
export const useServerSettings = ServerSettings.use;
