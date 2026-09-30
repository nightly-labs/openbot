import type { CentralAuthUser, ServerSummary } from "@openbot/contracts/ipc";
import type { CustomAgentSettingsApi } from "@openbot/ui/features/custom-providers/CustomAgentSettings";
import type { HostedSiteDeleteResult } from "@openbot/ui/features/settings/stores/hosted-sites-store";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, Loading, Show } from "solid-js";
import { desktopAnalytics } from "./analytics";
import { appPort } from "./app-port";
import { useAuth } from "./features/account/account-context";
import { useAgents } from "./features/agents/agents-context";
import { createGitHubConnector } from "./features/connectors/github-connector";
import { useCustomAgents } from "./features/custom-agents/custom-agents-context";
import { useCustomProviders } from "./features/custom-providers/custom-providers-context";
import { useProviderDetection } from "./features/custom-providers/provider-detection-context";
import type { ServerStorageOptions } from "./features/files/ServerStoragePanel";
import { useSetup } from "./features/onboarding/onboarding-context";
import { useSetupProviderProps } from "./features/onboarding/setup-provider-props";
import { useRemoteDesktop } from "./features/remote-desktop/remote-desktop-context";
import { AddServerOverlay } from "./features/servers/AddServerOverlay";
import { mcpToolRuntimeNote } from "./features/servers/mcp-servers";
import { useServerActions } from "./features/servers/server-actions";
import { serverSupportsCapability } from "./features/servers/server-capabilities";
import { useServerSelection } from "./features/servers/server-selection";
import { useServerSettings } from "./features/servers/server-settings";
import { useServerSwitch } from "./features/servers/server-switch";
import { useServers } from "./features/servers/servers-context";
import { useSettings } from "./features/settings/settings-context";
import { useUpdates } from "./features/updates/updates-context";
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
  return (
    <>
      <PermissionsReview account={props.account} />
      <SkillsMarketplace />
      <SharedAgentInstall />
      <JoinServer account={props.account} />
      <AddServer />
      <ServerSettings />
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
function SkillsMarketplace() {
  const { skillsMarketplaceOpen, setSkillsMarketplaceOpen, pendingPluginSlug, setPendingPluginSlug } = useSettings();
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
      onPluginSlugConsumed={() => setPendingPluginSlug(null)}
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
function ServerSettings() {
  const platform = usePlatform();
  const { hostStatus, setServerMuted, setServerNotificationLevel } = useServers();
  const { selectAgent, selectGlobalSearchMessage } = useNavigation();
  const { selectServer } = useServerSelection();
  const { setPendingAgentSelection } = useServerSwitch();
  const { toolRuntimeStatuses, providerAdminServerId } = useProviders();
  const github = createGitHubConnector();
  /**
   * Whether the tool runtimes the providers context holds are this server's: this computer's, or,
   * over `providers-v1`, those of the host of the joined server on screen.
   */
  const holdsToolRuntimes = (server: ServerSummary) =>
    server.kind === "local" ? providerAdminServerId() === undefined : server.id === providerAdminServerId();
  const {
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
  // The overlay mounts with the app. A first read that failed then must not hide GitHub for good.
  createEffect(serverSettingsOpen, (open) => {
    if (open) github.reload();
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
          // The GitHub connection belongs to this computer, and a build with no GitHub App has none.
          githubConnector={server().kind === "local" && github.status().available ? github : undefined}
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
  const { agentStatus } = useAgents();
  const { activeServer, setAddServerOpen } = useServers();
  const {
    appSettingsOpen,
    setAppSettingsOpen,
    appSettingsTab,
    generalSettings,
    updateGeneralSettings,
    appSettingsRestoreTarget,
    turboModePending,
    sendTestNotification,
    openNotificationSettings,
  } = useSettings();
  const {
    providerRuntimeStatuses,
    providerAvailableVersions,
    providerRuntimeDownloadsAvailable,
    downloadProviderRuntime,
    startProviderUpdate,
    cancelProviderRuntimeDownload,
    connectProvider,
    openProviderInstallGuide,
    codeLogin,
    providerAdminServerId,
    providerKeys,
    hostCustomProviders,
  } = useProviders();
  const localEndpoints = useCustomProviders();
  const localAgents = useCustomAgents();
  const detection = useProviderDetection();
  /** A custom agent is a command on this computer, so only the local host lists or runs one. */
  const customAgents: CustomAgentSettingsApi = {
    get agents() {
      return localAgents.customAgents();
    },
    save: localAgents.saveCustomAgent,
    remove: localAgents.deleteCustomAgent,
    check: localAgents.checkCustomAgent,
  };
  const local = () => activeServer()?.kind === "local";
  /**
   * The providers of the computer the agents run on: this one, or the host of a joined server the
   * account administers over `providers-v1`. Any other server shows none of these controls.
   */
  const providerDownloads = createMemo(
    () => (local() || providerAdminServerId() !== undefined) && providerRuntimeDownloadsAvailable(),
  );
  /** The browser sign-in and the install guide open on this computer, so they stay local. */
  const localProviderDownloads = createMemo(() => local() && providerRuntimeDownloadsAvailable());
  /**
   * A named endpoint merges into the `opencode acp` process of the computer the agents run on, so a
   * server this window cannot manage shows no custom row, no list and no Add. This is not
   * `providerDownloads()`: that one also needs `providerRuntimeDownloadsAvailable()`, which is about
   * managed runtime downloads and would hide this feature on a build without them.
   */
  const endpoints = createMemo(() =>
    local() ? localEndpoints : providerAdminServerId() !== undefined ? hostCustomProviders : undefined,
  );

  return (
    <Loading>
      <SettingsModal
        open={appSettingsOpen()}
        onOpenChange={setAppSettingsOpen}
        value={generalSettings()}
        onValueChange={updateGeneralSettings}
        appInfo={platform.appInfo()}
        updateStatus={updates.status()}
        onUpdateAction={updates.runAction}
        onCancelScheduledRestart={updates.cancelScheduledRestart}
        account={props.account()}
        onUpdateAccountName={auth.updateAccountName}
        onUpdateAccountAvatar={auth.updateAccountAvatar}
        onCreateMobileConnect={auth.createMobileConnect}
        onListMobileConnectedDevices={auth.listMobileConnectedDevices}
        onRevokeMobileConnectedDevice={auth.revokeMobileConnectedDevice}
        onListAccountSessions={auth.listAccountSessions}
        onRevokeAccountSession={auth.revokeAccountSession}
        agentStatus={agentStatus()}
        providerRuntimeStatuses={providerDownloads() ? providerRuntimeStatuses() : undefined}
        providerAvailableVersions={providerDownloads() ? providerAvailableVersions() : undefined}
        onUpdateProvider={providerDownloads() ? startProviderUpdate : undefined}
        onDownloadProvider={providerDownloads() ? downloadProviderRuntime : undefined}
        onCancelProviderDownload={providerDownloads() ? cancelProviderRuntimeDownload : undefined}
        onConnectProvider={localProviderDownloads() ? connectProvider : undefined}
        onInstallProvider={localProviderDownloads() ? openProviderInstallGuide : undefined}
        customProviders={endpoints()?.customProviders()}
        onAddCustomProvider={endpoints()?.saveCustomProvider}
        onDeleteCustomProvider={endpoints()?.deleteCustomProvider}
        customAgents={local() ? customAgents : undefined}
        // The scan is of this computer, so a joined server's tab shows no found list and no Edit.
        providerDetection={local() ? detection.detection() : undefined}
        detectedProviderApi={local() ? detection.api : undefined}
        takenAgentIds={detection.takenAgentIds()}
        detectionSettings={local() ? (detection.settingsValue() ?? undefined) : undefined}
        onDetectionSettingsChange={detection.setSettings}
        detectionSettingsError={detection.settingsError()}
        onProvidersShown={() => {
          if (local()) void detection.scan();
        }}
        providerKeys={providerDownloads() ? providerKeys() : undefined}
        providerHostName={providerAdminServerId() === undefined ? undefined : activeServer()?.name}
        codeLogin={providerDownloads() ? codeLogin : undefined}
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

/** Search across every conversation on the active server. */
function GlobalMessageSearch() {
  const { agentList } = useAgents();
  const { globalSearchOpen, searchGlobalMessages, setGlobalSearchVisibility, selectAgent, selectGlobalSearchMessage } =
    useNavigation();

  return (
    <GlobalSearchOverlay
      open={globalSearchOpen()}
      agents={agentList()}
      onSearchMessages={searchGlobalMessages}
      onOpenChange={setGlobalSearchVisibility}
      onSelectAgent={selectAgent}
      onSelectMessage={selectGlobalSearchMessage}
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
