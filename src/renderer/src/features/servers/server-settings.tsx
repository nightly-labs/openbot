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

/**
 * The settings page for one server: its identity, whether it is published,
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
/** The generated name when the account gives no usable one. Its slug is long enough for a host address. */
const FALLBACK_SERVER_NAME = "OpenBot";

/**
 * A name for a server that the user publishes before naming it, such as "Ann’s server". The first
 * word of the account name or email goes in, shortened by whole characters to fit the length limit.
 * When the name has too few Latin letters or digits for a host address, the fallback is used. This
 * depends on the language: "Анна’s server" is long enough, but "Анна のサーバー" is not.
 */
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
    /** The section an opener asked for, such as Updates from the host version notice. */
    const [serverSettingsSection, setServerSettingsSection] = createSignal<ServerSettingsSection | null>(null);
    /** The section on screen, so the rail marks Providers while it shows. */
    const [serverSettingsShownSection, setServerSettingsShownSection] = createSignal<ServerSettingsSection | null>(
      null,
    );
    const [serverSettingsOpen, setServerSettingsOpen] = createSignal(false);
    /** Counts each open request, so the settings page can tell a new request for the open server. */
    const [serverSettingsOpenRequest, setServerSettingsOpenRequest] = createSignal(0);
    const [serverSettingsMembers, setServerSettingsMembers] = createSignal<TeamPresenceMember[]>([]);
    const [serverSettingsInvites, setServerSettingsInvites] = createSignal<TeamInviteSummary[]>([]);
    const [serverSettingsLoading, setServerSettingsLoading] = createSignal(false);
    const [serverSettingsError, setServerSettingsError] = createSignal<string | null>(null);
    /** Bumped by every open and refresh, so a slower earlier load cannot paint over a newer one. */
    let serverSettingsRequest = 0;
    let serverSettingsRestoreTarget: HTMLElement | null = null;

    const serverSettingsTarget = createMemo(() => servers().find((server) => server.id === serverSettingsTargetId()));
    /** The server that the leave confirmation from the server menu asks about, and the element that asked. */
    const [leaveRequest, setLeaveRequest] = createSignal<{ serverId: string; trigger: HTMLElement | null } | null>(
      null,
    );
    const leaveConfirmServer = createMemo(
      () => servers().find((server) => server.id === leaveRequest()?.serverId) ?? null,
    );
    // A server that leaves the list in another way ends the request, so it does not open again on a rejoin.
    createEffect(
      () => leaveRequest() !== null && leaveConfirmServer() === null,
      (gone) => {
        if (gone) setLeaveRequest(null);
      },
    );
    /** The hosted server that the restart confirmation from the server menu asks about, and the element that asked. */
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

    /**
     * Saves the plush look of the server in the settings. The list shows it before the host answers,
     * so each mark of the server changes at the click; a failure puts the previous look back.
     */
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

    /**
     * Asks the host whether the screen recording grant it was refused is now in place.
     *
     * The member who was refused cannot answer this: the grant is given on the host, and the status
     * that carries the answer is the host's own.
     */
    async function recheckScreenRecording(): Promise<void> {
      setHostStatus(await serversPort().host.recheckScreenRecording());
    }

    /**
     * Changes the server key: this computer's, or a joined server's through `host-key-rotation-v1`,
     * which only its owner may use. Paired devices follow the signed handover.
     */
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

    /** Publishes or unpublishes this computer's server, whichever server the settings show. */
    async function setLocalServerPublished(published: boolean): Promise<void> {
      const server = servers().find((candidate) => candidate.kind === "local");
      if (!server) throw new Error(currentText().t("server.settings.publicationLocalOnly"));
      const analytics = desktopAnalytics.scope();
      const action = published ? ("published" as const) : ("unpublished" as const);
      let operationSucceeded = false;
      try {
        // The host needs a name to publish. One that the user did not set is generated, so the
        // switch works on its own; the user can change it in General later.
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

    /**
     * Ends this account's membership of a joined server, or removes a server that it owns from the
     * account service. Main removes the server from the list and sends the new list, which removes
     * the dialog's target, so the dialog closes here first.
     */
    async function leaveServer(): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      await removeMembership(server);
      setServerSettingsOpen(false);
    }

    /** Leaves the server that the confirmation from the server menu asks about. */
    async function leaveConfirmedServer(): Promise<void> {
      const server = leaveConfirmServer();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      if (server.thisComputer) await serversPort().localServers.delete(server.id);
      else await removeMembership(server);
      if (serverSettingsTarget()?.id === server.id) setServerSettingsOpen(false);
    }

    /**
     * Restarts the server that the confirmation from the server menu asks about: a server on this computer
     * through its supervisor, a hosted server through the account service, and a self-hosted server
     * through its own host (`host-restart-v1`).
     */
    async function restartConfirmedServer(): Promise<void> {
      const server = restartConfirmServer();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      if (server.thisComputer) await serversPort().localServers.restart(server.id);
      else if (server.hosted !== true && serverSupportsCapability(server, "host-restart-v1"))
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
