import {
  type CentralAuthUser,
  LOCAL_SERVER_ID,
  LOCAL_SERVER_LIMIT,
  type RoutineFields,
  type ServerSummary,
} from "@openbot/contracts/ipc";
import { BROWSER_PROFILES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { VAULT_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v2";
import { classifyFailure } from "@openbot/telemetry";
import { isAgentAccount } from "@openbot/ui/components/provider-accounts";
import type { AcpRegistrySettingsApi } from "@openbot/ui/features/custom-providers/AcpRegistrySettings";
import type { CustomAgentSettingsApi } from "@openbot/ui/features/custom-providers/CustomAgentSettings";
import { providerDiagnosticsText } from "@openbot/ui/features/provider-diagnostics/provider-diagnostics";
import { LeaveServerDialog } from "@openbot/ui/features/servers/LeaveServerDialog";
import { RestartServerDialog } from "@openbot/ui/features/servers/RestartServerDialog";
import type { HostedSiteDeleteResult } from "@openbot/ui/features/settings/stores/hosted-sites-store";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, Loading, Show, untrack } from "solid-js";
import { actionToast } from "./action-toast";
import { desktopAnalytics } from "./analytics";
import { appPort } from "./app-port";
import { useAuth } from "./features/account/account-context";
import { useAgents } from "./features/agents/agents-context";
import { desktopBrowserProfileCalls } from "./features/browser/browser-profiles-port";
import { createBrowserProfilesStore } from "./features/browser/stores/browser-profiles-store";
import { useConnectors } from "./features/connectors/connectors-context";
import { conversationPort } from "./features/conversation/conversation-port";
import { useCustomAgents } from "./features/custom-agents/custom-agents-context";
import { useCustomProviders } from "./features/custom-providers/custom-providers-context";
import { useProviderDetection } from "./features/custom-providers/provider-detection-context";
import type { ServerStorageOptions } from "./features/files/ServerStoragePanel";
import { useSetup } from "./features/onboarding/onboarding-context";
import { useRemoteDesktop } from "./features/remote-desktop/remote-desktop-context";
import { desktopScheduleSource } from "./features/schedule/schedule-port";
import { AddServerOverlay } from "./features/servers/AddServerOverlay";
import {
  createdRoutines,
  HostedServerUpsell,
  hostedUpsellRoutineCreated,
} from "./features/servers/hosted-server-upsell-controller";
import { mcpToolRuntimeNote } from "./features/servers/mcp-servers";
import { useServerActions } from "./features/servers/server-actions";
import { remoteMcpSignIn, serverCanAdminister, serverSupportsCapability } from "./features/servers/server-capabilities";
import { useServerSelection } from "./features/servers/server-selection";
import { useServerSettings } from "./features/servers/server-settings";
import { useServerSwitch } from "./features/servers/server-switch";
import { useServers } from "./features/servers/servers-context";
import type { HostProviderSettings } from "./features/settings/ProviderSettingsSection";
import { useSettings } from "./features/settings/settings-context";
import { settingsPort } from "./features/settings/settings-port";
import { useUpdates } from "./features/updates/updates-context";
import { useWhatsNew } from "./features/updates/whats-new-context";
import { usePlanLimitRows } from "./features/usage/plan-limit-rows";
import { createVaultStore } from "./features/vault/stores/vault-store";
import { desktopVaultCalls, hostVaultCalls } from "./features/vault/vault-port";
import { useWindowPage } from "./features/window/window-page-context";
import { useGlobalSearchSources } from "./global-search-sources";
import { CreateLocalServerDialog, RemoteDesktopWorkspace, SettingsModal } from "./lazy-views";
import { useNavigation } from "./navigation";
import { usePlatform } from "./platform";
import { useProviders } from "./providers";
import { useTurns } from "./turns";
import {
  ChannelCreateOverlay,
  GlobalSearchOverlay,
  JoinServerOverlay,
  MarketplaceOverlay,
  ServerSettingsOverlay,
  SharedAgentInstallOverlay,
} from "./WorkspaceOverlayViews";

interface AccountProps {
  account: () => CentralAuthUser;
}

/**
 * Everything the workspace raises over itself: modals, dialogs and the two
 * full-window takeovers.
 *
 * They are one module because they share a shape rather than a domain - each is
 * one open flag over one lazily loaded chunk, none of them is laid out by the
 * frame, and none of them reads another - and separate components inside it for
 * the same reason the panes are separate files: an overlay should see the
 * domains it opens over and no others. They stay here rather than in seven
 * single-use modules at the renderer root because each is a dozen lines of
 * wiring, and the list of what can cover the workspace is worth reading in one
 * place.
 *
 * The overlays the web client also raises are views in `WorkspaceOverlayViews`, which take props:
 * the components here read the desktop contexts and pass them on.
 */
export function WorkspaceOverlays(props: AccountProps) {
  const { skillsMarketplaceOpen } = useSettings();
  const connectors = useConnectors();
  /* The overlays mount with the app. A first read that failed then must not hide a connector for
     good, and a sign-in can change outside this window, so the Marketplace reads them again when it opens. */
  createEffect(skillsMarketplaceOpen, (open) => {
    if (!open) return;
    connectors.active.reload();
  });
  return (
    <>
      <SharedAgentInstall />
      <JoinServer account={props.account} />
      <AddServer />
      <CreateLocalServer />
      <HostedUpsell account={props.account} />
      <LeaveServer />
      <RestartServer />
      <ServerSettings />
      <AppSettings account={props.account} />
      <GlobalMessageSearch />
      <RemoteDesktop />
      <ChannelCreateOverlay />
    </>
  );
}

/**
 * Skills and marketplace agents, which install into an Agent's workspace on the host. The picker
 * lists the agents of this computer, or of a joined server this account administers; a member
 * browses and installs nothing. A marketplace agent is added to that joined server when its host
 * serves `agent-install-v1`, otherwise to this computer. An agent of a joined server is updated from
 * its listing only when its host serves `agent-update-v1`.
 *
 * It is a page of the window, so the shell shows it in the card rather than over the workspace.
 */
export function SkillsMarketplace() {
  const {
    skillsMarketplaceOpen,
    setSkillsMarketplaceOpen,
    pendingPluginSlug,
    setPendingPluginSlug,
    pendingPluginConnect,
    setPendingPluginConnect,
    pendingMarketplaceListing,
    setPendingMarketplaceListing,
  } = useSettings();
  const { agentList, activeAgent, agentStatus, agentSetupOpen, creatingAgent } = useAgents();
  const { selectAgent } = useNavigation();
  const { activeServer } = useServers();
  const { openInstalledMarketplaceAgent } = useServerSelection();
  const { openMcpAdd } = useServerSettings();
  const connectors = useConnectors();
  const platform = usePlatform();
  const { remoteDesktopWorkspaceVisible, hideRemoteDesktopWorkspace } = useRemoteDesktop();
  // The remote desktop covers the window card, so a link or a search that opens the page hides it.
  // The remote desktop session stays.
  createEffect(skillsMarketplaceOpen, (open) => {
    if (open && untrack(remoteDesktopWorkspaceVisible)) hideRemoteDesktopWorkspace();
  });

  return (
    <MarketplaceOverlay
      open={skillsMarketplaceOpen()}
      onOpenChange={setSkillsMarketplaceOpen}
      server={activeServer()}
      agents={agentList()}
      activeAgentId={activeAgent()?.id ?? ""}
      composerAvailable={agentStatus().phase === "ready" && !(agentSetupOpen() && creatingAgent())}
      onOpenAgent={selectAgent}
      onAgentInstalled={openInstalledMarketplaceAgent}
      pluginSlug={pendingPluginSlug()}
      pluginConnect={pendingPluginConnect()}
      onPluginSlugConsumed={() => {
        setPendingPluginSlug(null);
        setPendingPluginConnect(false);
      }}
      marketplaceListing={pendingMarketplaceListing()}
      onMarketplaceListingConsumed={() => setPendingMarketplaceListing(null)}
      connectors={connectors.active}
      macOS={platform.appInfo()?.platform === "darwin"}
      onAddServer={(serverId) => {
        setSkillsMarketplaceOpen(false);
        openMcpAdd(serverId, null);
      }}
    />
  );
}

/**
 * A shared agent from an `openbot://agents/<id>` link. It is added where a marketplace agent is: on
 * the selected joined server when this account administers it, otherwise on this computer.
 */
function SharedAgentInstall() {
  const { pendingAgentTemplateId, setPendingAgentTemplateId } = useSettings();
  const { openInstalledMarketplaceAgent } = useServerSelection();
  const { activeServer } = useServers();

  return (
    <SharedAgentInstallOverlay
      templateId={pendingAgentTemplateId()}
      server={activeServer()}
      onOpenLink={(url) => void appPort().openUrl(url)}
      onClose={() => setPendingAgentTemplateId(null)}
      onInstalled={openInstalledMarketplaceAgent}
    />
  );
}

/** Joining a team server from an invite link. */
function JoinServer(props: AccountProps) {
  const setup = useSetup();
  const { joinServerOpen, setJoinServerOpen } = useServers();
  const { joinServer } = useServerSelection();

  return (
    <JoinServerOverlay
      open={joinServerOpen()}
      inviteUrl={setup.pendingInviteUrl()}
      accountEmail={props.account().email}
      onClose={() => {
        setJoinServerOpen(false);
        setup.setPendingInviteUrl("");
      }}
      onPreview={setup.previewInvite}
      onJoin={joinServer}
    />
  );
}

/** A new server on this computer, with its own agents, chats and files. */
function CreateLocalServer() {
  const { servers, createLocalServerOpen, setCreateLocalServerOpen } = useServers();
  const { createLocalServer } = useServerSelection();
  // Main refuses one more server too. This only tells the user before they type a name.
  const limitReached = () => servers().filter((server) => server.thisComputer).length >= LOCAL_SERVER_LIMIT;
  return (
    <Show when={createLocalServerOpen()}>
      <Loading>
        <CreateLocalServerDialog
          limitReached={limitReached()}
          onClose={() => setCreateLocalServerOpen(false)}
          onCreate={createLocalServer}
        />
      </Loading>
    </Show>
  );
}

/** A hosted server: the plans, the payment, then the setup. */
function AddServer() {
  const { servers, addServerOpen, addServerEntryPoint, setAddServerOpen, setJoinServerOpen } = useServers();
  const { select, createLocal } = useServerActions();
  const { openAppSettings } = useSettings();
  const onCreateLocal =
    createLocal &&
    (() => {
      setAddServerOpen(false);
      createLocal();
    });

  return (
    <AddServerOverlay
      open={addServerOpen()}
      entryPoint={addServerEntryPoint() ?? undefined}
      calls={appPort().hostedServers}
      license={appPort().license}
      servers={servers()}
      onClose={() => setAddServerOpen(false)}
      onOpenServer={(serverId) => {
        setAddServerOpen(false);
        void select(serverId);
      }}
      onContactUs={() => void appPort().openExternal("hosted-server-contact")}
      onJoinWithInvite={() => {
        setAddServerOpen(false);
        setJoinServerOpen(true);
      }}
      onCreateLocal={onCreateLocal}
      onManageServers={() => openAppSettings(null, "hosted-servers")}
    />
  );
}

/**
 * The offer of a hosted server when routines depend on this computer or on the user's own remote
 * computer. The modal opens only after the first routine on this computer, when the turn of the agent
 * that made it ends.
 */
function HostedUpsell(props: AccountProps) {
  const { activeServer, hostedServersAvailable, hostedServersLoaded, hostedServerIds, setAddServerOpen } = useServers();
  const { activeTurns, routinesByConversation } = useTurns();
  const platform = usePlatform();
  // The last current list of each conversation. A list that is loading again keeps the previous one.
  const seen = new Map<string, readonly RoutineFields[]>();
  createEffect(routinesByConversation, (snapshots) => {
    for (const [key, snapshot] of Object.entries(snapshots)) {
      if (!snapshot?.current || seen.get(key) === snapshot.routines) continue;
      const created = createdRoutines(seen.get(key), snapshot.routines);
      seen.set(key, snapshot.routines);
      const agentId = key.slice(key.indexOf("\0") + 1);
      for (const routine of created) {
        hostedUpsellRoutineCreated({ id: routine.id, name: routine.name, agentId });
      }
    }
  });
  // Named functions, not conditional props: the controller reads these props in an effect callback,
  // where the memo of a conditional prop halts the renderer.
  function canOfferHostedServer(): boolean {
    return (
      !platform.landingPreview &&
      hostedServersAvailable() &&
      hostedServersLoaded() &&
      hostedServerIds().size === 0 &&
      (activeServer()?.kind === "local" || activeServer()?.role === "owner") &&
      activeServer()?.hosted !== true
    );
  }
  function upsellServerId(): string {
    return activeServer()?.id ?? "local";
  }
  function upsellHost() {
    const server = activeServer();
    return server?.kind === "remote" ? { name: server.name ?? "" } : ("this-computer" as const);
  }
  // The calendar lists every routine of the host. A range in the future reads no run history.
  function localActiveRoutineIds(): Promise<readonly string[] | null> {
    if (untrack(activeServer)?.kind !== "local") return Promise.resolve(null);
    const from = Date.now() + 60_000;
    return desktopScheduleSource()
      .calendar({ from: new Date(from).toISOString(), to: new Date(from + 60_000).toISOString() }, LOCAL_SERVER_ID)
      .then((calendar) => calendar.routines.filter((routine) => routine.active).map((routine) => routine.id));
  }
  return (
    <HostedServerUpsell
      accountId={props.account().id}
      canOffer={canOfferHostedServer()}
      serverId={upsellServerId()}
      activeHostRoutineIds={localActiveRoutineIds}
      host={upsellHost()}
      busy={(agentId) => Boolean(activeTurns()[agentId])}
      openPlans={() => setAddServerOpen(true, "upsell")}
      track={(action, entryPoint) =>
        desktopAnalytics.track("hosted_server_upsell", { action, entry_point: entryPoint })
      }
    />
  );
}

/** The leave or owner removal confirmation that the server menu opens. */
function LeaveServer() {
  const { leaveConfirmServer, leaveRestoreTarget, cancelLeaveServer, leaveConfirmedServer } = useServerSettings();
  return (
    <LeaveServerDialog
      server={leaveConfirmServer()}
      removeOwned={leaveConfirmServer()?.role === "owner"}
      deleteLocal={leaveConfirmServer()?.thisComputer === true}
      onClose={cancelLeaveServer}
      onLeave={leaveConfirmedServer}
      restoreFocusTarget={leaveRestoreTarget()}
    />
  );
}

/** The restart of a hosted server, or of a server on this computer, that the server menu opens. */
function RestartServer() {
  const { servers } = useServers();
  const { restartConfirmServer, restartRestoreTarget, cancelRestartServer, restartConfirmedServer } =
    useServerSettings();
  return (
    <RestartServerDialog
      server={restartConfirmServer()}
      servers={servers()}
      onClose={cancelRestartServer}
      onRestart={restartConfirmedServer}
      restoreFocusTarget={restartRestoreTarget()}
    />
  );
}

/**
 * Settings for one server, which is any server on the rail rather than the
 * active one - hence the target held by the domain instead of `activeServer()`.
 */
function ServerSettings() {
  const windowPage = useWindowPage();
  const usageRows = usePlanLimitRows();
  const platform = usePlatform();
  const { hostStatus, hostedServerIds, hostedServersAvailable, hostedServersLoaded, setAddServerOpen } = useServers();
  const { selectAgent, selectGlobalSearchMessage } = useNavigation();
  const { selectServer } = useServerSelection();
  const { setPendingAgentSelection } = useServerSwitch();
  const { agentList, agentStatus } = useAgents();
  const { setupState, saveSetup } = useSetup();
  const {
    toolRuntimeStatuses,
    providerAdminServerId,
    providerRuntimeStatuses,
    providerAvailableVersions,
    providerRuntimeDownloadsAvailable,
    downloadProviderRuntime,
    startProviderUpdate,
    cancelProviderRuntimeDownload,
    cancelProviderSignIn,
    openProviderInstallGuide,
    setProviderOn,
    measureProviderDownload,
    removeProviderDownload,
    providerAccounts,
    restartProvider,
    cancelProviderRestart,
    connection,
    providerKeys,
    hostCustomProviders,
  } = useProviders();
  const localEndpoints = useCustomProviders();
  const localAgents = useCustomAgents();
  const detection = useProviderDetection();
  /** A custom agent is a command on this computer, so only the local server lists or runs one. */
  const customAgents: CustomAgentSettingsApi = {
    get agents() {
      return localAgents.customAgents();
    },
    save: localAgents.saveCustomAgent,
    remove: localAgents.deleteCustomAgent,
    check: localAgents.checkCustomAgent,
    // One process group runs every custom agent, so its restart is the restart of all of them.
    get restartPending() {
      return agentStatus().providers?.some((provider) => provider.id === "acp" && provider.restartPending) === true;
    },
    get lastError() {
      return agentStatus().providers?.find((provider) => provider.id === "acp")?.lastError;
    },
    get diagnostics() {
      const status = agentStatus().providers?.find((provider) => provider.id === "acp");
      return status ? providerDiagnosticsText(status) : undefined;
    },
    restart: () => restartProvider("acp"),
    cancelRestart: () => cancelProviderRestart("acp"),
  };
  /**
   * Whether the tool runtimes the providers context holds are this server's: this computer's, or,
   * over `providers-v1`, those of the host of the joined server on screen.
   */
  const holdsToolRuntimes = (server: ServerSummary) =>
    server.kind === "local" ? providerAdminServerId() === undefined : server.id === providerAdminServerId();
  const {
    openServerSettings,
    serverSettingsTarget,
    serverSettingsSection,
    serverSettingsOpen,
    setServerSettingsOpen,
    serverSettingsRestoreTarget,
    serverSettingsMembers,
    serverSettingsInvites,
    serverSettingsLoading,
    serverSettingsError,
    refreshServerSettings,
    saveServerIdentity,
    recheckScreenRecording,
    rotateHostKey,
    setServerPublished,
    createServerInvite,
    updateServerMember,
    removeServerMember,
    leaveServer,
    revokeServerInvite,
    serverSettingsMcp,
    serverSettingsMcpError,
    serverSettingsMcpSignIns,
    serverSettingsMcpSignInRequest,
    clearMcpSignInRequest,
    serverSettingsMcpAddRequest,
    clearMcpAddRequest,
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
  } = useServerSettings();
  /**
   * The named browser profiles of the selected server: this computer, or a joined server whose host
   * serves `browser-profiles-v1` to this owner or admin. One store per server, so the list of the
   * last server never shows for the next. The section lists them each time it opens.
   */
  const browserProfileServerId = createMemo(() => serverSettingsTarget()?.id);
  const browserProfiles = createMemo(() => {
    const calls = desktopBrowserProfileCalls(browserProfileServerId());
    return createBrowserProfilesStore(() => calls);
  });
  /**
   * The Vault of the selected server: this computer, or a joined server whose host serves `vault-v1`
   * to this owner or admin. One store per server, so the items of the last server never show for the next.
   */
  const vaultServerId = createMemo(() => {
    const target = serverSettingsTarget();
    return serverCanAdminister(target, VAULT_CAPABILITY) ? target.id : undefined;
  });
  // A host that updates or rolls back keeps its id, so the API key kind follows this capability too.
  const vaultApiKeys = createMemo(() => serverCanAdminister(serverSettingsTarget(), VAULT_V2_CAPABILITY));
  const vault = createMemo(() => {
    const serverId = vaultServerId();
    if (serverId === undefined) return undefined;
    const local = untrack(serverSettingsTarget)?.kind === "local";
    return {
      store: createVaultStore(local ? desktopVaultCalls() : hostVaultCalls(serverId)),
      apiKeys: vaultApiKeys(),
    };
  });
  // The workspace belongs to the selected server. For another server, the switch comes first and
  // the agent is published for the scope it lands in; a message there opens as its agent's chat.
  const openOnServer = (server: ServerSummary, agentId: string, open: () => void) => {
    setServerSettingsOpen(false);
    if (server.active) return open();
    void selectServer(server.id).then((selected) => {
      if (selected) setPendingAgentSelection(agentId);
    });
  };

  /**
   * The providers of the computer the agents of `server` run on: this one, or the host of a joined
   * server that the account administers over `providers-v1`. The provider state belongs to the
   * selected server only, so it is read only while `server` is the selected one.
   */
  const registryApis = new Map<string, AcpRegistrySettingsApi>();
  function registryFor(server: ServerSummary): AcpRegistrySettingsApi {
    const existing = registryApis.get(server.id);
    if (existing) return existing;
    const api: AcpRegistrySettingsApi = {
      search: (query) => appPort().acpRegistry.search(query, server.id),
      status: () => appPort().acpRegistry.status(server.id),
      install: async (input) => {
        const result = await appPort().acpRegistry.install(input, server.id);
        if (server.kind === "local") await localAgents.refreshCustomAgents();
        return result;
      },
      cancel: (id) => appPort().acpRegistry.cancel(id, server.id),
      remove: (id) => appPort().acpRegistry.remove(id, server.id),
    };
    registryApis.set(server.id, api);
    return api;
  }
  const providerSettings = (server: ServerSummary): HostProviderSettings | undefined => {
    const local = server.kind === "local";
    if (!server.active || (!local && server.id !== providerAdminServerId())) return undefined;
    /**
     * A named endpoint merges into the `opencode acp` process of that computer. This does not need
     * `providerRuntimeDownloadsAvailable()`: a build without managed runtime downloads still has custom endpoints.
     */
    const endpoints = local ? localEndpoints : hostCustomProviders;
    return {
      get defaultProvider() {
        const state = setupState();
        return local && state ? { ...state, save: saveSetup } : undefined;
      },
      get agentStatus() {
        return agentStatus();
      },
      get providerRuntimeStatuses() {
        return providerRuntimeDownloadsAvailable() ? providerRuntimeStatuses() : undefined;
      },
      get providerAvailableVersions() {
        return providerRuntimeDownloadsAvailable() ? providerAvailableVersions() : undefined;
      },
      get onUpdateProvider() {
        return providerRuntimeDownloadsAvailable() ? startProviderUpdate : undefined;
      },
      get onDownloadProvider() {
        return providerRuntimeDownloadsAvailable() ? downloadProviderRuntime : undefined;
      },
      get onCancelProviderDownload() {
        return providerRuntimeDownloadsAvailable() ? cancelProviderRuntimeDownload : undefined;
      },
      get customProviders() {
        return endpoints.customProviders();
      },
      onAddCustomProvider: endpoints.saveCustomProvider,
      onDeleteCustomProvider: endpoints.deleteCustomProvider,
      // The Team API has no edit route, so only this computer's endpoints have Edit.
      onUpdateCustomProvider: local ? localEndpoints.updateCustomProvider : undefined,
      get providerKeys() {
        return providerRuntimeDownloadsAvailable() ? providerKeys() : undefined;
      },
      get connection() {
        return providerRuntimeDownloadsAvailable() ? connection : undefined;
      },
      // The browser sign-in, the install guide, the scan and custom agents are of this computer.
      get onCancelProviderSignIn() {
        return local && providerRuntimeDownloadsAvailable() ? cancelProviderSignIn : undefined;
      },
      get onInstallProvider() {
        return local && providerRuntimeDownloadsAvailable() ? openProviderInstallGuide : undefined;
      },
      onSetProviderOn: local ? setProviderOn : undefined,
      onMeasureProviderDownload: local ? measureProviderDownload : undefined,
      onRemoveProviderDownload: local ? removeProviderDownload : undefined,
      get providerUsers() {
        return Object.fromEntries(
          (agentStatus().providers ?? []).map((provider) => [
            provider.id,
            agentList()
              .filter((agent) => agent.provider === provider.id)
              .map((agent) => agent.name),
          ]),
        );
      },
      get providerAccountUsers() {
        return Object.fromEntries(
          (agentStatus().providers ?? []).map((provider) => [
            provider.id,
            Object.fromEntries(
              (provider.accounts ?? []).map((account) => [
                account.id,
                agentList()
                  .filter(
                    (agent) => agent.provider === provider.id && isAgentAccount(agent.providerAccountId, account.id),
                  )
                  .map((agent) => agent.name),
              ]),
            ),
          ]),
        );
      },
      // The active server's accounts: a joined host offers them only with `provider-accounts-v1`.
      get accountActions() {
        return providerAccounts();
      },
      // The readings are of the active server, which is the only server with a Providers tab.
      get usage() {
        return usageRows();
      },
      onRestartProvider: local ? restartProvider : undefined,
      onCancelProviderRestart: local ? cancelProviderRestart : undefined,
      get providerDetection() {
        return local ? detection.detection() : undefined;
      },
      detectedProviderApi: local ? detection.api : undefined,
      get takenAgentIds() {
        return detection.takenAgentIds();
      },
      customAgents: local ? customAgents : undefined,
      acpRegistry: serverCanAdminister(server, "acp-registry-v1") ? registryFor(server) : undefined,
      get detectionSettings() {
        return local ? (detection.settingsValue() ?? undefined) : undefined;
      },
      onDetectionSettingsChange: detection.setSettings,
      get detectionSettingsError() {
        return detection.settingsError();
      },
      onShown: local ? () => void detection.scan() : undefined,
    };
  };

  /**
   * Another server's providers are managed after a switch to it, in its own Providers section. A
   * failed switch shows the error and opens the section again, with its switch button.
   */
  const switchToManageProviders = (server: ServerSummary) => {
    setServerSettingsOpen(false);
    void selectServer(server.id).then(
      (selected) => {
        if (selected) openServerSettings(server.id, null, "providers");
      },
      (error: unknown) => {
        const text = currentText();
        actionToast.error(text.t("server.select.failedTitle"), {
          ...{
            description: text.errorMessage(error, text.t("server.select.failedDescription")),
          },
          report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
        });
        openServerSettings(server.id, null, "providers");
      },
    );
  };

  /** A server at its site limit offers the server plans, which have more sites, to its owner. */
  function canOfferServerPlans(server: ServerSummary): boolean {
    return (
      !platform.landingPreview &&
      hostedServersAvailable() &&
      hostedServersLoaded() &&
      (server.kind === "local" || server.role === "owner") &&
      server.hosted !== true
    );
  }
  function openServerPlans(): void {
    setServerSettingsOpen(false);
    setAddServerOpen(true, "upsell");
  }

  const storageOptions = (server: ServerSummary): Omit<ServerStorageOptions, "canManage"> => ({
    hostName:
      server.kind === "local"
        ? platform.appInfo()?.platform === "darwin"
          ? currentText().t("app.host.thisMac")
          : currentText().t("app.host.thisComputer")
        : server.name,
    onOpenAgent: (agentId) => openOnServer(server, agentId, () => selectAgent(agentId)),
    onShowMessage: (agentId, messageId) =>
      openOnServer(server, agentId, () => selectGlobalSearchMessage(agentId, messageId)),
  });

  return (
    <Show when={serverSettingsTarget()}>
      {(server) => (
        <ServerSettingsOverlay
          // The settings show only as a page of the window, so they wait for the page.
          open={serverSettingsOpen() && windowPage.settingsPlacement("server") !== undefined}
          page={windowPage.settingsPlacement("server")}
          restoreFocusTarget={serverSettingsRestoreTarget()}
          platform={platform.appInfo()?.platform ?? "darwin"}
          server={server()}
          hostStatus={server().kind === "local" ? hostStatus() : null}
          members={serverSettingsMembers()}
          invites={serverSettingsInvites()}
          loading={serverSettingsLoading()}
          loadError={serverSettingsError()}
          onRetry={() => refreshServerSettings(server().id)}
          onSaveIdentity={saveServerIdentity}
          onSetPublished={setServerPublished}
          onRotateHostKey={server().kind === "local" ? rotateHostKey : undefined}
          onCreateInvite={createServerInvite}
          license={appPort().license}
          onContactUs={() => void appPort().openExternal("hosted-server-contact")}
          onUpdateMember={updateServerMember}
          onRemoveMember={removeServerMember}
          onRevokeInvite={revokeServerInvite}
          onLeaveServer={leaveServer}
          // Billing deletes a hosted server, so its owner does not remove it here.
          onRemoveServer={hostedServersLoaded() && !hostedServerIds().has(server().id) ? leaveServer : undefined}
          onOpenScreenRecordingSettings={() => appPort().openExternal("mac-screen-recording")}
          onRecheckScreenRecording={recheckScreenRecording}
          mcpServers={serverSettingsMcp()}
          // Only for the computer whose runtimes this window holds: another host starts its servers
          // with its own runtime, which this window has not read.
          mcpToolRuntimeNote={holdsToolRuntimes(server()) ? mcpToolRuntimeNote(toolRuntimeStatuses().bun) : null}
          mcpLoadError={serverSettingsMcpError()}
          onMcpSectionShown={() => void refreshMcpServers()}
          onRetryMcpServers={() => void refreshMcpServers()}
          onSaveMcpServer={saveMcpServer}
          onRemoveMcpServer={removeMcpServer}
          onSetMcpServerEnabled={setMcpServerEnabled}
          onTestMcpServer={testMcpServer}
          mcpAddRequest={serverSettingsMcpAddRequest()}
          onMcpAddRequestHandled={clearMcpAddRequest}
          // A remote host with `sign-in-relay-v1` opens the page in this computer's browser. An older
          // host's page shows here through the live view, which streams the active server only.
          mcpSignInRequest={serverSettingsMcpSignInRequest()}
          onMcpSignInRequestHandled={clearMcpSignInRequest}
          mcpSignIn={
            server().kind === "local" || remoteMcpSignIn(server())
              ? {
                  states: serverSettingsMcpSignIns(),
                  remote:
                    server().kind === "remote"
                      ? {
                          hostName: server().name,
                          runtime: conversationPort().browser,
                          clipboard: serverSupportsCapability(server(), "browser-view-clipboard"),
                          pages: serverSettingsMcpSignInPages(),
                          relay: serverSupportsCapability(server(), "sign-in-relay-v1")
                            ? {
                                pages: serverSettingsMcpSignInRelays(),
                                open: openMcpSignInRelay,
                                paste: pasteMcpSignInRelay,
                              }
                            : undefined,
                        }
                      : undefined,
                  start: signInMcpServer,
                  cancel: cancelMcpSignIn,
                  signOut: signOutMcpServer,
                  app: serverSupportsCapability(server(), "mcp-sign-in-app-v1")
                    ? { load: mcpSignInApp, save: saveMcpSignInApp, remove: removeMcpSignInApp }
                    : undefined,
                }
              : undefined
          }
          storage={storageOptions(server())}
          providers={providerSettings(server())}
          onSwitchToManageProviders={
            !server().active && serverCanAdminister(server(), "providers-v1")
              ? () => switchToManageProviders(server())
              : undefined
          }
          // This computer, or a remote host with `hosted-sites-v1`. Every member lists; the host deletes
          // only for an owner or admin.
          hostedSites={
            serverSupportsCapability(server(), "hosted-sites-v1")
              ? {
                  api: appPort().hostedSites,
                  onOpenSite: (url) => void appPort().openUrl(url),
                  trackDelete: trackHostedSiteDelete,
                  onSeePlans: canOfferServerPlans(server()) ? openServerPlans : undefined,
                }
              : undefined
          }
          hostUpdate={{}}
          hostTimezone={{}}
          hostMemoryLimit={{}}
          memoryReview={{}}
          hostPromptCacheTtl={{}}
          agentAccess={{ listAgents: () => appPort().agent.listAgents(server().id) }}
          initialSection={serverSettingsSection()}
          // Any member imports into this computer or a remote host with `agent-import-v1`.
          agentImport={
            serverSupportsCapability(server(), "agent-import-v1")
              ? {
                  onOpenAgent: (agentId) => openOnServer(server(), agentId, () => selectAgent(agentId)),
                  onClose: () => setServerSettingsOpen(false),
                }
              : undefined
          }
          // Owners and admins move this computer's server, or a remote host with `instance-transfer-v1`.
          instanceTransfer={
            server().kind === "local"
              ? { onSignIn: (provider) => void connection.connect(provider) }
              : serverCanAdminister(server(), "instance-transfer-v1")
                ? {}
                : undefined
          }
          // The feed listens on this computer, so a calendar app on another one cannot read it.
          routineFeed={
            server().kind === "local"
              ? { api: appPort().routineFeed, listAgents: () => appPort().agent.listAgents(server().id) }
              : undefined
          }
          browserProfiles={
            serverCanAdminister(server(), BROWSER_PROFILES_CAPABILITY)
              ? { store: browserProfiles(), listAgents: () => appPort().agent.listAgents(server().id) }
              : undefined
          }
          vault={vault()}
        />
      )}
    </Show>
  );
}

/** The account that starts a deletion gets its result event, as the scope is taken at the start. */
function trackHostedSiteDelete(): (result: HostedSiteDeleteResult) => void {
  const analytics = desktopAnalytics.scope();
  return (result) =>
    analytics.track("hosted_site_action", {
      action: "delete",
      entry_point: "settings",
      result,
      ...(result === "failed" ? { failure_code: "delete_failed" } : {}),
    });
}

/**
 * Application settings, shown as a page of the window. The only overlay without a
 * `<Show>`: the settings own their open state and wait for the page placement.
 */
function AppSettings(props: AccountProps) {
  const windowPage = useWindowPage();
  const platform = usePlatform();
  const auth = useAuth();
  const updates = useUpdates();
  const whatsNew = useWhatsNew();
  const { servers, setAddServerOpen, setServerMuted, setServerNotificationLevel } = useServers();
  const {
    appSettingsOpen,
    notificationFocusRequest,
    setAppSettingsOpen,
    appSettingsTab,
    hostedServerDeleteRequest,
    generalSettings,
    builtInDisplayGeometry,
    updateGeneralSettings,
    appSettingsRestoreTarget,
    sendTestNotification,
    openNotificationSettings,
    preferencesLoadFailed,
    reloadPreferences,
  } = useSettings();
  return (
    <Loading>
      <SettingsModal
        // The settings show only as a page of the window, so they wait for the page.
        open={appSettingsOpen() && windowPage.settingsPlacement("personal") !== undefined}
        page={windowPage.settingsPlacement("personal")}
        value={generalSettings()}
        onValueChange={updateGeneralSettings}
        preferencesLoadFailed={preferencesLoadFailed()}
        onRetryPreferencesLoad={reloadPreferences}
        appInfo={platform.appInfo()}
        chatWindow={platform.chatWindow !== null}
        builtInDisplayGeometry={builtInDisplayGeometry()}
        servers={servers()}
        updateStatus={updates.status()}
        onUpdateAction={updates.runAction}
        onOpenWhatsNew={
          whatsNew.state.version
            ? () => {
                setAppSettingsOpen(false);
                whatsNew.reopen();
              }
            : undefined
        }
        onCancelScheduledRestart={updates.cancelScheduledRestart}
        onRestartWhenIdle={updates.restartWhenIdle}
        onCancelIdleRestart={updates.cancelIdleRestart}
        account={props.account()}
        onUpdateAccountName={auth.updateAccountName}
        onUpdateAccountAvatar={auth.updateAccountAvatar}
        onCreateMobileConnect={auth.createMobileConnect}
        onCancelMobileConnect={auth.cancelMobileConnect}
        onGetMobileConnectLink={auth.getMobileConnectLink}
        onCreateMobileConnectLink={auth.createMobileConnectLink}
        onRevokeMobileConnectLink={auth.revokeMobileConnectLink}
        onListMobileConnectedDevices={auth.listMobileConnectedDevices}
        onRevokeMobileConnectedDevice={auth.revokeMobileConnectedDevice}
        onGetRemoteNetworkRoute={() => settingsPort().getRemoteNetworkRoute()}
        onSetRemoteNetworkRoute={(route) => settingsPort().setRemoteNetworkRoute({ route })}
        onListAccountSessions={auth.listAccountSessions}
        onRevokeAccountSession={auth.revokeAccountSession}
        onSignOut={platform.landingPreview ? undefined : auth.logoutCentralAccount}
        billingApi={appPort().billing}
        licenseApi={appPort().license}
        onContactUs={() => void appPort().openExternal("hosted-server-contact")}
        hostedServersApi={appPort().hostedServers}
        onAddHostedServer={() => {
          setAppSettingsOpen(false);
          setAddServerOpen(true, "settings_billing");
        }}
        onTestNotification={sendTestNotification}
        onOpenNotificationSettings={openNotificationSettings}
        onSetServerNotificationLevel={setServerNotificationLevel}
        onSetServerMuted={setServerMuted}
        notificationFocusRequest={notificationFocusRequest()}
        restoreFocusTarget={appSettingsRestoreTarget()}
        openTab={appSettingsTab()}
        hostedServerDeleteRequest={hostedServerDeleteRequest()}
      />
    </Loading>
  );
}

/** Search across the agents, channels, conversations, routines and commands of the active server. */
function GlobalMessageSearch() {
  const { agentList } = useAgents();
  const { globalSearchOpen, searchGlobalMessages, setGlobalSearchVisibility, selectAgent, selectGlobalSearchMessage } =
    useNavigation();
  const sources = useGlobalSearchSources(globalSearchOpen);

  return (
    <GlobalSearchOverlay
      open={globalSearchOpen()}
      agents={agentList()}
      channels={sources.channels()}
      routines={sources.routines()}
      routinesLoading={sources.routinesLoading()}
      actions={sources.actions()}
      onSearchMessages={searchGlobalMessages}
      onSearchFiles={sources.searchFiles()}
      onOpenChange={setGlobalSearchVisibility}
      onSelectAgent={selectAgent}
      onSelectChannel={sources.openChannel}
      onSelectMessage={selectGlobalSearchMessage}
      onSelectRoutine={sources.selectRoutine}
    />
  );
}

/**
 * The remote-desktop takeover. Keyed on the server so that connecting to a
 * different one rebuilds the viewer instead of repainting the previous
 * machine's last frame into it.
 */
function RemoteDesktop() {
  const platform = usePlatform();
  const {
    remoteDesktopWorkspaceServer,
    remoteDesktopWorkspaceVisible,
    remoteDesktopWorkspaceSession,
    remoteDesktopConnectingServerId,
    remoteDesktopConnectionError,
    remoteDesktopConnectionErrorCode,
    hideRemoteDesktopWorkspace,
    reportRemoteDesktopViewerFailed,
    disconnectRemoteDesktopWorkspace,
    retryRemoteDesktopWorkspace,
    selectRemoteDesktopDisplay,
  } = useRemoteDesktop();

  return (
    // Keyed by id: each server list update is a new object, and a new viewer frame cannot reuse the one-time grant.
    <Show when={!platform.landingPreview && remoteDesktopWorkspaceServer()?.id} keyed>
      <Show when={remoteDesktopWorkspaceServer()}>
        {(server) => (
          <Loading>
            <RemoteDesktopWorkspace
              visible={remoteDesktopWorkspaceVisible()}
              platform={platform.appInfo()?.platform ?? "darwin"}
              server={server()}
              session={remoteDesktopWorkspaceSession()}
              connecting={remoteDesktopConnectingServerId() === server().id}
              connectionError={remoteDesktopConnectionError()}
              connectionErrorCode={remoteDesktopConnectionErrorCode()}
              onHide={hideRemoteDesktopWorkspace}
              onViewerState={(state) => reportRemoteDesktopViewerFailed(state === "error")}
              onDisconnect={() => disconnectRemoteDesktopWorkspace()}
              onRetry={retryRemoteDesktopWorkspace}
              onSelectDisplay={selectRemoteDesktopDisplay}
            />
          </Loading>
        )}
      </Show>
    </Show>
  );
}
