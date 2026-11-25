import { parseHostedServerName } from "@openbot/contracts/hosted-servers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AvatarImageInput,
  CentralAuthUser,
  InviteSummary,
  ServerAppearance,
  ServerSummary,
  TeamInviteSummary,
  TeamPresenceMember,
  UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import { accountRestartsServer } from "@openbot/ui/features/servers/ServerActionItems";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, flush, onCleanup } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { createSimpleContext } from "../../simple-context";
import { useAuth } from "../account/account-context";
import type { ServerSettingsSection } from "./ServerSettingsModal";
import {
  serverCanAdminister,
  serverRoleCanAdminister,
  serverRotatesHostKey,
  serverSupportsCapability,
} from "./server-capabilities";
import { useServers } from "./servers-context";
import { serverAdminPort, serversPort } from "./servers-port";

const FALLBACK_SERVER_NAME = "OpenBot";

function generatedServerName(user: CentralAuthUser | null): string {
  const person = (user?.name?.trim() || user?.email.split("@")[0] || "").split(/\s+/u)[0] ?? "";
  if (!person) return FALLBACK_SERVER_NAME;
  const { t } = currentText();
  const characters = Array.from(person);
  let name = t("server.settings.generatedName", { name: person });
  for (let length = characters.length - 1; name.length > INPUT_LIMITS.serverName && length > 0; length--)
    name = t("server.settings.generatedName", { name: characters.slice(0, length).join("") });
  return parseHostedServerName(name) ?? FALLBACK_SERVER_NAME;
}

const ServerSettings = createSimpleContext({
  name: "Server settings",
  init: () => {
    const { servers, setServers, hostStatus, setHostStatus, setHostUpdateOpener } = useServers();
    const { signedInAccount } = useAuth();
    const [serverSettingsTargetId, setServerSettingsTargetId] = createSignal<string | null>(null);
    const [serverSettingsSection, setServerSettingsSection] = createSignal<ServerSettingsSection | null>(null);
    const [serverSettingsShownSection, setServerSettingsShownSection] = createSignal<ServerSettingsSection | null>(
      null,
    );
    const [serverSettingsOpen, setServerSettingsOpen] = createSignal(false);
    const [serverSettingsOpenRequest, setServerSettingsOpenRequest] = createSignal(0);
    const [serverSettingsMembers, setServerSettingsMembers] = createSignal<TeamPresenceMember[]>([]);
    const [serverSettingsInvites, setServerSettingsInvites] = createSignal<TeamInviteSummary[]>([]);
    const [serverSettingsLoading, setServerSettingsLoading] = createSignal(false);
    const [serverSettingsError, setServerSettingsError] = createSignal<string | null>(null);
    let serverSettingsRequest = 0;
    let serverSettingsRestoreTarget: HTMLElement | null = null;

    const serverSettingsTarget = createMemo(() => servers().find((server) => server.id === serverSettingsTargetId()));
    const [leaveRequest, setLeaveRequest] = createSignal<{ serverId: string; trigger: HTMLElement | null } | null>(
      null,
    );
    const leaveConfirmServer = createMemo(
      () => servers().find((server) => server.id === leaveRequest()?.serverId) ?? null,
    );
    createEffect(
      () => leaveRequest() !== null && leaveConfirmServer() === null,
      (gone) => {
        if (gone) setLeaveRequest(null);
      },
    );
    const [restartRequest, setRestartRequest] = createSignal<{ serverId: string; trigger: HTMLElement | null } | null>(
      null,
    );
    const restartConfirmServer = createMemo(
      () => servers().find((server) => server.id === restartRequest()?.serverId) ?? null,
    );
    createEffect(
      () => restartRequest() !== null && restartConfirmServer() === null,
      (gone) => {
        if (gone) setRestartRequest(null);
      },
    );

    createEffect(
      () => ({ open: serverSettingsOpen(), id: serverSettingsTargetId() }),
      ({ open, id }) => {
        if (!open || !id) return;
        let previous = "";
        return serversPort().servers.onPresence((presence) => {
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

    function openServerSettings(
      serverId: string,
      trigger: HTMLElement | null,
      section: ServerSettingsSection | null = null,
    ): void {
      serverSettingsRequest += 1;
      setServerSettingsSection(section);
      serverSettingsRestoreTarget = trigger;
      setServerSettingsTargetId(serverId);
      setServerSettingsOpen(true);
      setServerSettingsOpenRequest((count) => count + 1);
      setServerSettingsMembers([]);
      setServerSettingsInvites([]);
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

    async function saveServerAppearance(appearance: ServerAppearance | null): Promise<void> {
      const server = serverSettingsTarget();
      if (!serverCanAdminister(server, "host-appearance-v1"))
        throw new Error(currentText().t("error.team.hostIdentityUnsupported"));
      const serverId = server.id;
      const previous = server.appearance;
      const patch = (value: ServerAppearance | null | undefined) =>
        setServers((current) =>
          current.map((item) => {
            if (item.id !== serverId) return item;
            const { appearance: _previous, ...rest } = item;
            return value === undefined ? rest : { ...rest, appearance: value };
          }),
        );
      patch(appearance);
      try {
        if (server.kind === "local") setHostStatus(await serversPort().host.updateIdentity({ appearance }));
        else {
          const updated = await serversPort().hostAdmin.updateIdentity({ appearance }, serverId);
          setServers((current) => current.map((item) => (item.id === serverId ? updated : item)));
        }
      } catch (error) {
        patch(previous);
        throw error;
      }
      setServers(await serversPort().servers.list());
    }

    async function recheckScreenRecording(): Promise<void> {
      setHostStatus(await serversPort().host.recheckScreenRecording());
    }

    async function rotateHostKey(): Promise<void> {
      const server = serverSettingsTarget();
      if (server?.kind === "local") {
        setHostStatus(await serversPort().host.rotateIdentityKey());
        return;
      }
      if (!serverRotatesHostKey(server)) throw new Error(currentText().t("server.settings.hostKeyOwnerOnly"));
      await serversPort().hostAdmin.rotateHostKey(server.id);
      setServers(await serversPort().servers.list());
    }

    async function setServerPublished(published: boolean): Promise<void> {
      if (serverSettingsTarget()?.kind !== "local")
        throw new Error(currentText().t("server.settings.publicationLocalOnly"));
      await setLocalServerPublished(published);
    }

    async function setLocalServerPublished(published: boolean): Promise<void> {
      const server = servers().find((candidate) => candidate.kind === "local");
      if (!server) throw new Error(currentText().t("server.settings.publicationLocalOnly"));
      const analytics = desktopAnalytics.scope();
      const action = published ? ("published" as const) : ("unpublished" as const);
      let operationSucceeded = false;
      try {
        if (published && !hostStatus().configured)
          setHostStatus(await serversPort().host.configure({ serverName: generatedServerName(signedInAccount()) }));
        const status = published ? await serversPort().host.start() : await serversPort().host.stop();
        if (published && status.phase !== "online") throw new Error("publish_failed");
        analytics.track("team_action", { action, result: "succeeded", server_kind: "local" });
        operationSucceeded = true;
        setHostStatus(status);
        setServers(await serversPort().servers.list());
        if (serverSettingsTargetId() === server.id) await refreshServerSettings(server.id);
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

    async function leaveServer(): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      await removeMembership(server);
      setServerSettingsOpen(false);
    }

    async function leaveConfirmedServer(): Promise<void> {
      const server = leaveConfirmServer();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      if (server.thisComputer) await serversPort().localServers.delete(server.id);
      else await removeMembership(server);
      if (serverSettingsTarget()?.id === server.id) setServerSettingsOpen(false);
    }

    async function restartConfirmedServer(): Promise<void> {
      const server = restartConfirmServer();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      if (server.thisComputer) await serversPort().localServers.restart(server.id);
      else if (!accountRestartsServer(server) && serverSupportsCapability(server, "host-restart-v1"))
        await serversPort().hostAdmin.restartHost(server.id);
      else await serversPort().hostedServers.restart(server.id);
    }

    async function removeMembership(server: ServerSummary): Promise<void> {
      const analytics = desktopAnalytics.scope();
      const action = server.role === "owner" ? "server_removed" : "server_left";
      try {
        await serversPort().servers.remove(server.id);
      } catch (error) {
        analytics.track("team_action", {
          action,
          result: "failed",
          server_kind: server.kind,
          failure_code: "server_leave_failed",
        });
        throw error;
      }
      analytics.track("team_action", { action, result: "succeeded", server_kind: server.kind });
    }

    setHostUpdateOpener((serverId) => openServerSettings(serverId, null, "updates"));
    onCleanup(() => setHostUpdateOpener(undefined));

    return {
      serverSettingsTarget,
      serverSettingsSection,
      serverSettingsShownSection,
      setServerSettingsShownSection,
      serverSettingsOpen,
      setServerSettingsOpen,
      serverSettingsOpenRequest,
      serverSettingsRestoreTarget: () => serverSettingsRestoreTarget,
      serverSettingsMembers,
      serverSettingsInvites,
      serverSettingsLoading,
      serverSettingsError,
      openServerSettings,
      refreshServerSettings,
      saveServerIdentity,
      saveServerAppearance,
      recheckScreenRecording,
      rotateHostKey,
      setServerPublished,
      publishLocalServer: () => setLocalServerPublished(true),
      createServerInvite,
      updateServerMember,
      removeServerMember,
      revokeServerInvite,
      leaveServer,
      leaveConfirmServer,
      leaveRestoreTarget: () => leaveRequest()?.trigger ?? null,
      requestLeaveServer: (serverId: string, trigger: HTMLElement | null) => setLeaveRequest({ serverId, trigger }),
      cancelLeaveServer: () => setLeaveRequest(null),
      leaveConfirmedServer,
      restartConfirmServer,
      restartRestoreTarget: () => restartRequest()?.trigger ?? null,
      requestRestartServer: (serverId: string, trigger: HTMLElement | null) => setRestartRequest({ serverId, trigger }),
      cancelRestartServer: () => setRestartRequest(null),
      restartConfirmedServer,
      serverSettingsTargetId,
    };
  },
});

export const ServerSettingsProvider = ServerSettings.provider;
export const useServerSettings = ServerSettings.use;
