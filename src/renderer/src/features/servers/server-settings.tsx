import type {
  AvatarImageInput,
  InviteSummary,
  McpServerConfig,
  McpTestResult,
  TeamInviteSummary,
  TeamPresenceMember,
  UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, flush } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { createSimpleContext } from "../../simple-context";
import { serverCanAdminister, serverRoleCanAdminister } from "./server-capabilities";
import { useServers } from "./servers-context";
import { serverAdminPort, serversPort } from "./servers-port";

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
    const [serverSettingsMcp, setServerSettingsMcp] = createSignal<McpServerConfig[]>([]);
    const [serverSettingsMcpError, setServerSettingsMcpError] = createSignal<string | null>(null);
    /** Bumped by every open and refresh, so a slower earlier load cannot paint over a newer one. */
    let serverSettingsRequest = 0;
    /**
     * The same guard for the MCP list, counted separately. The two loads start from different
     * events - a presence update refreshes the settings, opening the section reads the MCP list -
     * so one counter would let either one discard the other's reply and its cleanup.
     */
    let serverSettingsMcpRequest = 0;
    let serverSettingsRestoreTarget: HTMLElement | null = null;

    const serverSettingsTarget = createMemo(() => servers().find((server) => server.id === serverSettingsTargetId()));

    createEffect(
      () => ({ open: serverSettingsOpen(), id: serverSettingsTargetId() }),
      ({ open, id }) => {
        if (!open || !id) return;
        let previous = "";
        return serversPort().servers.onPresence((presence) => {
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

    async function refreshServerSettings(serverId = serverSettingsTargetId()): Promise<void> {
      if (!serverId) return;
      const request = ++serverSettingsRequest;
      setServerSettingsLoading(true);
      setServerSettingsError(null);
      try {
        let server = servers().find((item) => item.id === serverId);
        if (!server) throw new Error(currentText().t("server.settings.unavailable"));
        let identityError: string | null = null;
        if (server.kind === "remote") {
          try {
            const refreshed = await serversPort().servers.refreshIdentity(serverId);
            setServers((current) => current.map((item) => (item.id === serverId ? refreshed : item)));
            server = refreshed;
          } catch (error) {
            const text = currentText();
            identityError = text.errorMessage(error, text.t("server.settings.identityRefreshFailed"));
          }
        }
        const canManage = server.kind === "local" ? hostStatus().configured : serverRoleCanAdminister(server);
        const canUseNetwork = server.kind === "local" || server.state === "online";
        const admin = serverAdminPort(server);
        const [presence, members, invites] = await Promise.all([
          admin.getPresence(),
          canManage && canUseNetwork ? admin.listMembers() : Promise.resolve(null),
          canManage && canUseNetwork ? admin.listInvites() : Promise.resolve([]),
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
          const text = currentText();
          setServerSettingsError(text.errorMessage(error, text.t("server.settings.loadFailed")));
        }
      } finally {
        if (request === serverSettingsRequest) setServerSettingsLoading(false);
      }
    }

    function openServerSettings(serverId: string, trigger: HTMLElement | null): void {
      serverSettingsRequest += 1;
      serverSettingsMcpRequest += 1;
      serverSettingsRestoreTarget = trigger;
      setServerSettingsTargetId(serverId);
      setServerSettingsOpen(true);
      setServerSettingsMembers([]);
      setServerSettingsInvites([]);
      setServerSettingsMcp([]);
      setServerSettingsMcpError(null);
      setServerSettingsError(null);
      void refreshServerSettings(serverId);
    }

    async function saveServerIdentity(input: { serverName: string; logo?: AvatarImageInput | null }): Promise<void> {
      const server = serverSettingsTarget();
      if (!serverCanAdminister(server, "host-admin-v1"))
        throw new Error(currentText().t("server.settings.identityLocalOnly"));
      const analytics = desktopAnalytics.scope();
      const serverKind = server.kind;
      let operationSucceeded = false;
      try {
        if (serverKind === "local") {
          const status = hostStatus().configured
            ? await serversPort().host.updateIdentity(input)
            : await serversPort().host.configure(input);
          setHostStatus(status);
        } else {
          await serversPort().hostAdmin.updateIdentity(input, server.id);
        }
        analytics.track("team_action", {
          action: "identity_saved",
          result: "succeeded",
          server_kind: serverKind,
        });
        operationSucceeded = true;
        setServers(await serversPort().servers.list());
        await refreshServerSettings(server.id);
      } catch (error) {
        if (!operationSucceeded) {
          analytics.track("team_action", {
            action: "identity_saved",
            result: "failed",
            server_kind: serverKind,
            failure_code: "identity_save_failed",
          });
        }
        throw error;
      }
    }

    /**
     * Asks the host whether the screen recording grant it was refused is now in place.
     *
     * The member who was refused cannot answer this: the grant is given on the host, and the status
     * that carries the answer is the host's own.
     */
    async function recheckScreenRecording(): Promise<void> {
      setHostStatus(await serversPort().host.recheckScreenRecording());
    }

    async function setServerPublished(published: boolean): Promise<void> {
      const server = serverSettingsTarget();
      if (server?.kind !== "local") throw new Error(currentText().t("server.settings.publicationLocalOnly"));
      const analytics = desktopAnalytics.scope();
      const action = published ? ("published" as const) : ("unpublished" as const);
      let operationSucceeded = false;
      try {
        const status = published ? await serversPort().host.start() : await serversPort().host.stop();
        if (published && status.phase !== "online") throw new Error("publish_failed");
        analytics.track("team_action", { action, result: "succeeded", server_kind: "local" });
        operationSucceeded = true;
        setHostStatus(status);
        setServers(await serversPort().servers.list());
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

    async function createServerInvite(input: {
      role: "admin" | "member";
      email?: string;
      permanent?: boolean;
    }): Promise<InviteSummary> {
      const server = serverSettingsTarget();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      const analytics = desktopAnalytics.scope();
      let operationSucceeded = false;
      try {
        const invite = await serverAdminPort(server).createInvite(input);
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
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      const analytics = desktopAnalytics.scope();
      let operationSucceeded = false;
      try {
        await serverAdminPort(server).updateMember(input);
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
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      const analytics = desktopAnalytics.scope();
      let operationSucceeded = false;
      try {
        await serverAdminPort(server).removeMember(memberId);
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
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      const analytics = desktopAnalytics.scope();
      let operationSucceeded = false;
      try {
        await serverAdminPort(server).revokeInvite(inviteId);
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
     * The MCP list.
     *
     * It is read when the MCP section opens, not when the dialog opens, because most visits to this
     * dialog never reach that section. Nothing connects here: OpenBot connects only when the user
     * asks for a test, and the providers make their own connections when an agent starts.
     */
    async function refreshMcpServers(): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) return;
      const request = ++serverSettingsMcpRequest;
      const current = (): boolean => request === serverSettingsMcpRequest && serverSettingsTargetId() === server.id;
      try {
        const configs = await serversPort().agent.listMcpServers(server.id);
        if (!current()) return;
        setServerSettingsMcp(configs);
        setServerSettingsMcpError(null);
      } catch (error) {
        // Reported in the panel rather than thrown: the callers ask for this list on a section
        // change, where nothing is waiting for the promise and an unreported failure would leave
        // the panel saying the server has no MCP servers at all.
        if (current()) {
          const text = currentText();
          setServerSettingsMcpError(text.errorMessage(error, text.t("mcp.server.loadFailed")));
        }
      }
    }

    /**
     * One test connection, for the configuration the user is looking at. The configuration is sent
     * whole rather than by id, so the form can test a draft that was never saved. The answer is not
     * stored: the panel holds it while it is open, and it says nothing about any later moment.
     */
    async function testMcpServer(config: McpServerConfig): Promise<McpTestResult> {
      const server = serverSettingsTarget();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      const analytics = desktopAnalytics.scope();
      const result = await serversPort().agent.testMcpServer({ config }, server.id);
      analytics.track("team_action", {
        action: "mcp_server_tested",
        result: result.error ? "failed" : "succeeded",
        server_kind: server.kind,
        ...(result.error ? { failure_code: "mcp_server_test_failed" } : {}),
      });
      return result;
    }

    async function saveMcpServer(config: McpServerConfig): Promise<void> {
      await runMcpMutation("mcp_server_saved", "mcp_server_save_failed", (serverId) =>
        serversPort().agent.saveMcpServer({ config }, serverId),
      );
    }

    async function removeMcpServer(mcpServerId: string): Promise<void> {
      await runMcpMutation("mcp_server_removed", "mcp_server_remove_failed", (serverId) =>
        serversPort().agent.removeMcpServer({ mcpServerId }, serverId),
      );
    }

    async function setMcpServerEnabled(mcpServerId: string, enabled: boolean): Promise<void> {
      await runMcpMutation("mcp_server_toggled", "mcp_server_toggle_failed", (serverId) =>
        serversPort().agent.setMcpServerEnabled({ mcpServerId, enabled }, serverId),
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
      mutate: (serverId: string) => Promise<McpServerConfig[]>,
    ): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      const analytics = desktopAnalytics.scope();
      let operationSucceeded = false;
      try {
        const configs = await mutate(server.id);
        analytics.track("team_action", { action, result: "succeeded", server_kind: server.kind });
        operationSucceeded = true;
        if (serverSettingsTargetId() !== server.id) return;
        // A read that is still in flight started before this write and would answer with the list
        // as it was, putting a removed server back or showing the old enabled state. The reply
        // carries the whole list, so nothing is lost by dropping that read.
        serverSettingsMcpRequest += 1;
        setServerSettingsMcp(configs);
        setServerSettingsMcpError(null);
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
      recheckScreenRecording,
      setServerPublished,
      createServerInvite,
      updateServerMember,
      removeServerMember,
      revokeServerInvite,
      serverSettingsMcp,
      serverSettingsMcpError,
      refreshMcpServers,
      saveMcpServer,
      removeMcpServer,
      setMcpServerEnabled,
      testMcpServer,
    };
  },
});

export const ServerSettingsProvider = ServerSettings.provider;
export const useServerSettings = ServerSettings.use;
