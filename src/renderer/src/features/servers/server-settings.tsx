import { parseHostedServerName } from "@openbot/contracts/hosted-servers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AvatarImageInput,
  CentralAuthUser,
  InviteSummary,
  McpServerConfig,
  McpSignInAppState,
  McpSignInRelayPage,
  McpSignInState,
  McpTestResult,
  SaveMcpSignInAppInput,
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
import { mcpSignInRecord } from "./mcp-servers";
import type { ServerSettingsSection } from "./ServerSettingsModal";
import { serverCanAdminister, serverRoleCanAdminister, serverSupportsCapability } from "./server-capabilities";
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
/** How often the panel asks which host tab shows a remote sign-in page. */
const MCP_SIGN_IN_PAGE_POLL_MS = 1_000;

function withMcpSignInPage(pages: Record<string, string>, url: string, tabId: string | null): Record<string, string> {
  if (pages[url] === (tabId ?? undefined)) return pages;
  const { [url]: _previous, ...rest } = pages;
  return tabId ? { ...rest, [url]: tabId } : rest;
}

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
    const [serverSettingsOpen, setServerSettingsOpen] = createSignal(false);
    /** Counts each open request, so the settings page can tell a new request for the open server. */
    const [serverSettingsOpenRequest, setServerSettingsOpenRequest] = createSignal(0);
    const [serverSettingsMembers, setServerSettingsMembers] = createSignal<TeamPresenceMember[]>([]);
    const [serverSettingsInvites, setServerSettingsInvites] = createSignal<TeamInviteSummary[]>([]);
    const [serverSettingsLoading, setServerSettingsLoading] = createSignal(false);
    const [serverSettingsError, setServerSettingsError] = createSignal<string | null>(null);
    const [serverSettingsMcp, setServerSettingsMcp] = createSignal<McpServerConfig[]>([]);
    const [serverSettingsMcpError, setServerSettingsMcpError] = createSignal<string | null>(null);
    /** Which http rows the server holds a sign-in for, by id. Empty for a host without `mcp-sign-in-v1`. */
    const [serverSettingsMcpSignIns, setServerSettingsMcpSignIns] = createSignal<Record<string, McpSignInState>>({});
    /** The host tab of each remote sign-in page, by the address it signs in to, while the sign-in waits. */
    const [serverSettingsMcpSignInPages, setServerSettingsMcpSignInPages] = createSignal<Record<string, string>>({});
    /** The relayed sign-in page of each remote sign-in that waits in this computer's browser (`sign-in-relay-v1`). */
    const [serverSettingsMcpSignInRelays, setServerSettingsMcpSignInRelays] = createSignal<
      Record<string, McpSignInRelayPage>
    >({});
    /** The MCP row whose sign-in an agent's card asked for, until the MCP section starts it. */
    const [serverSettingsMcpSignInRequest, setServerSettingsMcpSignInRequest] = createSignal<string | null>(null);
    /** Set when the Marketplace asked for the form that adds a server, until the MCP section opens it. */
    const [serverSettingsMcpAddRequest, setServerSettingsMcpAddRequest] = createSignal(false);
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
      serverSettingsMcpRequest += 1;
      serverSettingsRestoreTarget = trigger;
      setServerSettingsTargetId(serverId);
      setServerSettingsOpen(true);
      setServerSettingsOpenRequest((count) => count + 1);
      setServerSettingsMembers([]);
      setServerSettingsInvites([]);
      setServerSettingsMcp([]);
      setServerSettingsMcpError(null);
      setServerSettingsMcpSignIns({});
      setServerSettingsMcpSignInRequest(null);
      setServerSettingsMcpAddRequest(false);
      setServerSettingsError(null);
      void refreshServerSettings(serverId);
    }

    /** Opens the MCP section of a server and signs in to one of its rows, as its Sign in button does. */
    function openMcpSignIn(serverId: string, mcpServerId: string, trigger: HTMLElement | null): void {
      openServerSettings(serverId, trigger, "mcp");
      setServerSettingsMcpSignInRequest(mcpServerId);
    }

    /** Opens the MCP section of a server on the form that adds a server, as its Add button does. */
    function openMcpAdd(serverId: string, trigger: HTMLElement | null): void {
      openServerSettings(serverId, trigger, "mcp");
      setServerSettingsMcpAddRequest(true);
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

    /** Changes the key of the server on this computer. Paired devices follow the signed handover. */
    async function rotateHostKey(): Promise<void> {
      if (serverSettingsTarget()?.kind !== "local")
        throw new Error(currentText().t("server.settings.hostKeyLocalOnly"));
      setHostStatus(await serversPort().host.rotateIdentityKey());
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

    /** Restarts the hosted server, or the server on this computer, that the confirmation from the server menu asks about. */
    async function restartConfirmedServer(): Promise<void> {
      const server = restartConfirmServer();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      if (server.thisComputer) await serversPort().localServers.restart(server.id);
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
        const [configs, signIns] = await Promise.all([
          serversPort().agent.listMcpServers(server.id),
          listMcpSignIns(server),
        ]);
        if (!current()) return;
        setServerSettingsMcp(configs);
        setServerSettingsMcpSignIns(signIns);
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

    /** Which http rows the server holds a sign-in for. A host without `mcp-sign-in-v1` answers none. */
    async function listMcpSignIns(server: ServerSummary): Promise<Record<string, McpSignInState>> {
      // A badge beside the list, not the list: a failed read shows no badge rather than failing the
      // list read, or reporting a save that already landed as failed.
      return serversPort()
        .agent.listMcpSignIns(server.id)
        .then(mcpSignInRecord, () => ({}));
    }

    /**
     * Opens the browser when the server asks; the answer comes once the browser came back. A remote
     * host opens the page in its own browser, and the panel shows that tab while the sign-in waits.
     */
    async function signInMcpServer(config: McpServerConfig): Promise<McpTestResult> {
      const server = serverSettingsTarget();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      let waiting = true;
      const signIn = serversPort().agent.signInMcpServer({ config }, server.id);
      if (server.kind === "remote") {
        if (serverSupportsCapability(server, "sign-in-relay-v1"))
          void followMcpSignInRelay(server.id, config.url, () => waiting);
        else void followMcpSignInPage(server.id, config.url, () => waiting);
      }
      const result = await signIn.finally(() => {
        waiting = false;
      });
      const signIns = await listMcpSignIns(server);
      if (serverSettingsTargetId() === server.id) setServerSettingsMcpSignIns(signIns);
      return result;
    }

    /** Reads which host tab shows the sign-in page until the sign-in ends; the host opens it a moment after start. */
    async function followMcpSignInPage(serverId: string, url: string, waiting: () => boolean): Promise<void> {
      try {
        while (waiting()) {
          const tabId = await serversPort()
            .agent.mcpSignInPage({ url }, serverId)
            .catch(() => null);
          if (!waiting()) return;
          setServerSettingsMcpSignInPages((pages) => withMcpSignInPage(pages, url, tabId));
          await new Promise((resolve) => setTimeout(resolve, MCP_SIGN_IN_PAGE_POLL_MS));
        }
      } finally {
        setServerSettingsMcpSignInPages((pages) => withMcpSignInPage(pages, url, null));
      }
    }

    /** Reads the relayed page of a sign-in until it ends. The page opens when the user asks. */
    async function followMcpSignInRelay(serverId: string, url: string, waiting: () => boolean): Promise<void> {
      const set = (page: McpSignInRelayPage | null) =>
        setServerSettingsMcpSignInRelays((pages) => {
          const { [url]: _previous, ...rest } = pages;
          return page ? { ...rest, [url]: page } : rest;
        });
      try {
        while (waiting()) {
          const page = await serversPort()
            .agent.mcpSignInRelay({ url }, serverId)
            .catch(() => null);
          if (!waiting()) return;
          const current = serverSettingsMcpSignInRelays()[url];
          if (current?.authorizeHost !== page?.authorizeHost || current?.listening !== page?.listening) set(page);
          await new Promise((resolve) => setTimeout(resolve, MCP_SIGN_IN_PAGE_POLL_MS));
        }
      } finally {
        set(null);
      }
    }

    /** Opens a relayed sign-in page in this computer's browser, after the user checked its host name. */
    async function openMcpSignInRelay(url: string): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      await serversPort().agent.openMcpSignInRelay({ url }, server.id);
    }

    /** The address the browser shows at the end of a relayed sign-in. Main sends only its query to the host. */
    async function pasteMcpSignInRelay(url: string, address: string): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      await serversPort().agent.completeMcpSignInRelay({ url, address }, server.id);
    }

    async function cancelMcpSignIn(url: string): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      await serversPort().agent.cancelMcpSignIn({ url }, server.id);
    }

    async function signOutMcpServer(mcpServerId: string): Promise<void> {
      const server = serverSettingsTarget();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      const states = await serversPort().agent.signOutMcpServer({ mcpServerId }, server.id);
      if (serverSettingsTargetId() === server.id) setServerSettingsMcpSignIns(mcpSignInRecord(states));
    }

    /** The OAuth app of a saved http row. The answer says only whether a secret is saved. */
    async function mcpSignInApp(mcpServerId: string): Promise<McpSignInAppState> {
      const server = serverSettingsTarget();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      return serversPort().agent.mcpSignInApp({ mcpServerId }, server.id);
    }

    async function saveMcpSignInApp(input: SaveMcpSignInAppInput): Promise<McpSignInAppState> {
      return changeMcpSignInApp((serverId) => serversPort().agent.saveMcpSignInApp(input, serverId));
    }

    async function removeMcpSignInApp(mcpServerId: string): Promise<McpSignInAppState> {
      return changeMcpSignInApp((serverId) => serversPort().agent.removeMcpSignInApp({ mcpServerId }, serverId));
    }

    /** A changed or removed app drops the sign-in that the old client held, so the badges are read again. */
    async function changeMcpSignInApp(
      change: (serverId: string) => Promise<McpSignInAppState>,
    ): Promise<McpSignInAppState> {
      const server = serverSettingsTarget();
      if (!server) throw new Error(currentText().t("server.settings.unavailable"));
      const state = await change(server.id);
      const signIns = await listMcpSignIns(server);
      if (serverSettingsTargetId() === server.id) setServerSettingsMcpSignIns(signIns);
      return state;
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
        // A saved row can name an address this computer is already signed in to.
        const signIns = await listMcpSignIns(server);
        if (serverSettingsTargetId() === server.id) setServerSettingsMcpSignIns(signIns);
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
    setHostUpdateOpener((serverId) => openServerSettings(serverId, null, "updates"));
    onCleanup(() => setHostUpdateOpener(undefined));

    return {
      serverSettingsTarget,
      serverSettingsSection,
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
      serverSettingsMcp,
      serverSettingsMcpError,
      serverSettingsMcpSignIns,
      serverSettingsTargetId,
      serverSettingsMcpSignInRequest,
      clearMcpSignInRequest: () => setServerSettingsMcpSignInRequest(null),
      openMcpSignIn,
      serverSettingsMcpAddRequest,
      clearMcpAddRequest: () => setServerSettingsMcpAddRequest(false),
      openMcpAdd,
      serverSettingsMcpSignInPages,
      serverSettingsMcpSignInRelays,
      openMcpSignInRelay,
      pasteMcpSignInRelay,
      signInMcpServer,
      cancelMcpSignIn,
      signOutMcpServer,
      mcpSignInApp,
      saveMcpSignInApp,
      removeMcpSignInApp,
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
