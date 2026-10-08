import type { CentralAuthUser, ServerSummary } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import type { CustomAgentSettingsApi } from "@openbot/ui/features/custom-providers/CustomAgentSettings";
import { providerDiagnosticsText } from "@openbot/ui/features/provider-diagnostics/provider-diagnostics";
import type { BitwardenConnectorPanelProps } from "@openbot/ui/features/settings/BitwardenConnectorPanel";
import type { HostedSiteDeleteResult } from "@openbot/ui/features/settings/stores/hosted-sites-store";
import { currentText } from "@openbot/ui/text";
import { createEffect, Loading, Show } from "solid-js";
import { actionToast } from "./action-toast";
import { desktopAnalytics } from "./analytics";
import { appPort } from "./app-port";
import { useAuth } from "./features/account/account-context";
import { resolveCreationModel } from "./features/agents/agent-creation-model";
import { useAgents } from "./features/agents/agents-context";
import { createBitwardenConnector } from "./features/connectors/bitwarden-connector";
import { createDiscordConnector } from "./features/connectors/discord-connector";
import { createGitHubConnector, type GitHubConnectorController } from "./features/connectors/github-connector";
import {
  createOnePasswordConnector,
  type OnePasswordConnectorController,
} from "./features/connectors/onepassword-connector";
import { createSlackConnector } from "./features/connectors/slack-connector";
import { useCustomAgents } from "./features/custom-agents/custom-agents-context";
import { useCustomProviders } from "./features/custom-providers/custom-providers-context";
import { useProviderDetection } from "./features/custom-providers/provider-detection-context";
import type { ServerStorageOptions } from "./features/files/ServerStoragePanel";
import { useSetup } from "./features/onboarding/onboarding-context";
import { useSetupProviderProps } from "./features/onboarding/setup-provider-props";
import { useRemoteDesktop } from "./features/remote-desktop/remote-desktop-context";
import { AddServerOverlay } from "./features/servers/AddServerOverlay";
import { mcpToolRuntimeNote } from "./features/servers/mcp-servers";
import type { ServerTailscaleSetupApi } from "./features/servers/ServerTailscaleSetup";
import { useServerActions } from "./features/servers/server-actions";
import {
  ownedRemoteServerSupportsTailscaleSetup,
  serverCanAdminister,
  serverSupportsCapability,
} from "./features/servers/server-capabilities";
import { useServerSelection } from "./features/servers/server-selection";
import { useServerSettings } from "./features/servers/server-settings";
import { useServerSwitch } from "./features/servers/server-switch";
import { useServers } from "./features/servers/servers-context";
import { serversPort } from "./features/servers/servers-port";
import type { HostProviderSettings } from "./features/settings/ProviderSettingsSection";
import { useSettings } from "./features/settings/settings-context";
import { useSidebar } from "./features/sidebar/sidebar-context";
import { useUpdates } from "./features/updates/updates-context";
import { useGlobalSearchSources } from "./global-search-sources";
import { InitialSetup, RemoteDesktopWorkspace, SettingsModal } from "./lazy-views";
import { useNavigation } from "./navigation";
import { usePlatform } from "./platform";
import { useProviders } from "./providers";
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
  const { activeServer } = useServers();
  const { skillsMarketplaceOpen } = useSettings();
  const { serverSettingsOpen, serverSettingsTarget } = useServerSettings();
  /* One GitHub connection of this computer, which Server settings and the Marketplace both show.
     A build with no GitHub App has none. */
  const github = createGitHubConnector();
  const githubFor = (server: ServerSummary | undefined) =>
    server?.kind === "local" && github.status().available ? github : undefined;
  /* The 1Password connection of this computer. The browser that fills its logins runs here too. */
  const onePassword = createOnePasswordConnector();
  const bitwarden = createBitwardenConnector();
  const bitwardenFor = (server: ServerSummary | undefined) => (server?.kind === "local" ? bitwarden : undefined);
  const onePasswordFor = (server: ServerSummary | undefined) => (server?.kind === "local" ? onePassword : undefined);
  /* The overlays mount with the app. A first read that failed then must not hide GitHub for good, and
     the sign-in can change outside this window, so each window reads the status again when it opens. */
  createEffect(
    () => skillsMarketplaceOpen() || serverSettingsOpen(),
    (open) => {
      if (open) github.reload();
    },
  );
  return (
    <>
      <PermissionsReview account={props.account} />
      <SkillsMarketplace
        githubConnector={githubFor(activeServer())}
        onePasswordConnector={onePasswordFor(activeServer())}
        bitwardenConnector={bitwardenFor(activeServer())}
      />
      <SharedAgentInstall />
      <JoinServer account={props.account} />
      <AddServer />
      <ServerSettings
        githubConnector={githubFor(serverSettingsTarget())}
        onePasswordConnector={onePasswordFor(serverSettingsTarget())}
        bitwardenConnector={bitwardenFor(serverSettingsTarget())}
      />
      <AppSettings account={props.account} />
      <GlobalMessageSearch />
      <RemoteDesktop />
      <ChannelCreateOverlay />
    </>
  );
}

/** The permissions half of first-run setup, reopened after the fact. */
function PermissionsReview(props: AccountProps) {
  const platform = usePlatform();
  const auth = useAuth();
  const setup = useSetup();
  const { activeServer } = useServers();
  const { joinRemoteDuringSetup } = useServerSelection();
  const setupProviders = useSetupProviderProps(() => activeServer()?.kind === "local");

  return (
    <Show when={setup.permissionsOpen()}>
      <Loading>
        <InitialSetup
          {...setupProviders}
          reviewing
          state={setup.setupState() ?? { completed: true, preferredProvider: "codex", preferredModel: null }}
          platform={platform.appInfo()?.platform ?? "darwin"}
          accountEmail={props.account().email}
          onSave={setup.saveSetup}
          onPreviewInvite={setup.previewInvite}
          onJoinRemote={joinRemoteDuringSetup}
          onLogout={platform.landingPreview ? undefined : auth.logoutCentralAccount}
          onClose={() => setup.setPermissionsOpen(false)}
        />
      </Loading>
    </Show>
  );
}

/**
 * Skills and marketplace agents, which install into an Agent's workspace on the host. The picker
 * lists the agents of this computer, or of a joined server this account administers; a member
 * browses and installs nothing. A marketplace agent is added to that joined server when its host
 * serves `agent-install-v1`, otherwise to this computer. An agent of a joined server is updated from
 * its listing only when its host serves `agent-update-v1`.
 */
function SkillsMarketplace(props: {
  githubConnector: GitHubConnectorController | undefined;
  onePasswordConnector: OnePasswordConnectorController | undefined;
  bitwardenConnector: BitwardenConnectorPanelProps | undefined;
}) {
  const {
    skillsMarketplaceOpen,
    setSkillsMarketplaceOpen,
    pendingPluginSlug,
    setPendingPluginSlug,
    pendingPluginConnect,
    setPendingPluginConnect,
  } = useSettings();
  const { agentList, activeAgent, agentStatus, agentSetupOpen, creatingAgent } = useAgents();
  const { selectAgent } = useNavigation();
  const { activeServer } = useServers();
  const { openInstalledMarketplaceAgent } = useServerSelection();

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
      githubConnector={props.githubConnector}
      onePasswordConnector={props.onePasswordConnector}
      bitwardenConnector={props.bitwardenConnector}
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

/** A hosted server: the plans, the payment, then the setup. */
function AddServer() {
  const { servers, addServerOpen, setAddServerOpen, setJoinServerOpen } = useServers();
  const { select } = useServerActions();
  const { openAppSettings } = useSettings();

  return (
    <AddServerOverlay
      open={addServerOpen()}
      calls={appPort().hostedServers}
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
      onManageServers={() => openAppSettings(null, "hosted-servers")}
    />
  );
}

/**
 * Settings for one server, which is any server on the rail rather than the
 * active one - hence the target held by the domain instead of `activeServer()`.
 */
/** The owner's Tailscale setup of a joined server; see `ownedRemoteServerSupportsTailscaleSetup`. */
function ownerTailscaleSetup(server: ServerSummary): ServerTailscaleSetupApi | null | undefined {
  const supported = ownedRemoteServerSupportsTailscaleSetup(server);
  if (supported === undefined) return undefined;
  if (!supported) return null;
  const serverId = server.id;
  return {
    getSetup: () => serversPort().hostAdmin.getTailscaleSetup(serverId),
    setDirect: (enabled) => serversPort().hostAdmin.setTailscaleDirect(enabled, serverId),
    signIn: () => serversPort().hostAdmin.startTailscaleSignIn(serverId),
    openLocalTailscale: () => serversPort().host.openTailscale(),
    openLink: (link) => appPort().openExternal(link),
  };
}

function ServerSettings(props: {
  githubConnector: GitHubConnectorController | undefined;
  onePasswordConnector: OnePasswordConnectorController | undefined;
  bitwardenConnector: BitwardenConnectorPanelProps | undefined;
}) {
  const platform = usePlatform();
  const { hostStatus, setServerMuted, setServerNotificationLevel, setServerDirectEnabled, activeServer } = useServers();
  const { selectAgent, selectGlobalSearchMessage } = useNavigation();
  const { selectServer } = useServerSelection();
  const { setPendingAgentSelection } = useServerSwitch();
  const { agentList, agentStatus, modelOptions, serverSetupChoice } = useAgents();
  const { setupState } = useSetup();
  const {
    toolRuntimeStatuses,
    providerAdminServerId,
    providerRuntimeStatuses,
    providerAvailableVersions,
    providerRuntimeDownloadsAvailable,
    downloadProviderRuntime,
    startProviderUpdate,
    cancelProviderRuntimeDownload,
    connectProvider,
    openProviderInstallGuide,
    restartProvider,
    cancelProviderRestart,
    codeLogin,
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
    setServerPublished,
    createServerInvite,
    updateServerMember,
    removeServerMember,
    leaveServer,
    revokeServerInvite,
    serverSettingsMcp,
    serverSettingsMcpError,
    refreshMcpServers,
    saveMcpServer,
    removeMcpServer,
    setMcpServerEnabled,
    testMcpServer,
  } = useServerSettings();
  // The Slack and Discord Orchestrators run on this computer, so their picker lists this computer's
  // models: none while a joined server is on screen, and then it starts on a new agent's default.
  const { collapseSidebarSection } = useSidebar();
  const orchestratorModels = () => {
    const options = modelOptions();
    if (activeServer()?.kind !== "local" || options.length === 0) return undefined;
    return {
      modelOptions: options,
      agentStatus: agentStatus(),
      initial: resolveCreationModel(serverSetupChoice() ?? setupState(), options),
      customProviders: localEndpoints.customProviders(),
      customAgents: localAgents.customAgents(),
    };
  };
  // The Integrations section starts collapsed: the orchestrator is not an agent people chat with
  // every day. The collapse belongs to the local server, the one on screen when Slack or Discord connects.
  const collapseOrchestratorSection = (sectionId: string) => {
    if (activeServer()?.kind === "local") collapseSidebarSection(sectionId);
  };
  const slack = createSlackConnector(undefined, orchestratorModels, collapseOrchestratorSection);
  const discord = createDiscordConnector(undefined, orchestratorModels, collapseOrchestratorSection);
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
  const providerSettings = (server: ServerSummary): HostProviderSettings | undefined => {
    const local = server.kind === "local";
    if (!server.active || (!local && server.id !== providerAdminServerId())) return undefined;
    /**
     * A named endpoint merges into the `opencode acp` process of that computer. This does not need
     * `providerRuntimeDownloadsAvailable()`: a build without managed runtime downloads still has custom endpoints.
     */
    const endpoints = local ? localEndpoints : hostCustomProviders;
    return {
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
      get providerKeys() {
        return providerRuntimeDownloadsAvailable() ? providerKeys() : undefined;
      },
      get codeLogin() {
        return providerRuntimeDownloadsAvailable() ? codeLogin : undefined;
      },
      // The browser sign-in, the install guide, the scan and custom agents are of this computer.
      get onConnectProvider() {
        return local && providerRuntimeDownloadsAvailable() ? connectProvider : undefined;
      },
      get onInstallProvider() {
        return local && providerRuntimeDownloadsAvailable() ? openProviderInstallGuide : undefined;
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
          open={serverSettingsOpen()}
          onOpenChange={setServerSettingsOpen}
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
          onSetMuted={(muted) => setServerMuted(server().id, muted)}
          onSetNotificationLevel={(level) => setServerNotificationLevel(server().id, level)}
          tailscale={server().kind === "local" ? serversPort().host : undefined}
          onSetDirectEnabled={(enabled) => setServerDirectEnabled(server().id, enabled)}
          tailscaleSetup={ownerTailscaleSetup(server())}
          onOpenTailscaleSharing={() => appPort().openExternal("tailscale-sharing")}
          onCreateInvite={createServerInvite}
          onUpdateMember={updateServerMember}
          onRemoveMember={removeServerMember}
          onRevokeInvite={revokeServerInvite}
          onLeaveServer={leaveServer}
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
                }
              : undefined
          }
          hostUpdate={{}}
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
          githubConnector={props.githubConnector}
          onePasswordConnector={props.onePasswordConnector}
          bitwardenConnector={props.bitwardenConnector}
          // Slack and Discord are connected on the computer that runs the agents: they open this
          // computer's browser and return to its `openbot://` link.
          slackConnector={server().kind === "local" ? slack : undefined}
          discordConnector={server().kind === "local" ? discord : undefined}
          connectorAgents={agentList()}
          // The feed listens on this computer, so a calendar app on another one cannot read it.
          routineFeed={
            server().kind === "local"
              ? { api: appPort().routineFeed, listAgents: () => appPort().agent.listAgents(server().id) }
              : undefined
          }
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
 * Application settings. The only overlay without a `<Show>`: the modal owns its
 * own open state and its close animation, so unmounting it on `open` would cut
 * that animation off.
 */
function AppSettings(props: AccountProps) {
  const platform = usePlatform();
  const auth = useAuth();
  const updates = useUpdates();
  const { setAddServerOpen } = useServers();
  const {
    appSettingsOpen,
    setAppSettingsOpen,
    appSettingsTab,
    generalSettings,
    builtInDisplayGeometry,
    updateGeneralSettings,
    appSettingsRestoreTarget,
    turboModePending,
    sendTestNotification,
    openNotificationSettings,
  } = useSettings();
  return (
    <Loading>
      <SettingsModal
        open={appSettingsOpen()}
        onOpenChange={setAppSettingsOpen}
        value={generalSettings()}
        onValueChange={updateGeneralSettings}
        appInfo={platform.appInfo()}
        builtInDisplayGeometry={builtInDisplayGeometry()}
        updateStatus={updates.status()}
        onUpdateAction={updates.runAction}
        onCancelScheduledRestart={updates.cancelScheduledRestart}
        onRestartWhenIdle={updates.restartWhenIdle}
        onCancelIdleRestart={updates.cancelIdleRestart}
        account={props.account()}
        onUpdateAccountName={auth.updateAccountName}
        onUpdateAccountAvatar={auth.updateAccountAvatar}
        onCreateMobileConnect={auth.createMobileConnect}
        onListMobileConnectedDevices={auth.listMobileConnectedDevices}
        onRevokeMobileConnectedDevice={auth.revokeMobileConnectedDevice}
        onListAccountSessions={auth.listAccountSessions}
        onRevokeAccountSession={auth.revokeAccountSession}
        billingApi={appPort().billing}
        hostedServersApi={appPort().hostedServers}
        onAddHostedServer={() => {
          setAppSettingsOpen(false);
          setAddServerOpen(true);
        }}
        turboModePending={turboModePending()}
        onTestNotification={sendTestNotification}
        onOpenNotificationSettings={openNotificationSettings}
        restoreFocusTarget={appSettingsRestoreTarget()}
        openTab={appSettingsTab()}
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
    disconnectRemoteDesktopWorkspace,
    retryRemoteDesktopWorkspace,
    selectRemoteDesktopDisplay,
  } = useRemoteDesktop();

  return (
    <Show when={!platform.landingPreview && remoteDesktopWorkspaceServer()} keyed>
      {(server) => (
        <Loading>
          <RemoteDesktopWorkspace
            visible={remoteDesktopWorkspaceVisible()}
            platform={platform.appInfo()?.platform ?? "darwin"}
            server={server}
            session={remoteDesktopWorkspaceSession()}
            connecting={remoteDesktopConnectingServerId() === server.id}
            connectionError={remoteDesktopConnectionError()}
            connectionErrorCode={remoteDesktopConnectionErrorCode()}
            onHide={hideRemoteDesktopWorkspace}
            onDisconnect={() => disconnectRemoteDesktopWorkspace()}
            onRetry={retryRemoteDesktopWorkspace}
            onSelectDisplay={selectRemoteDesktopDisplay}
          />
        </Loading>
      )}
    </Show>
  );
}
