import type { CentralAuthUser, ServerSummary } from "@openbot/contracts/ipc";
import { MCP_SERVERS_CAPABILITY } from "@openbot/contracts/ipc";
import { createMemo, Loading, Show } from "solid-js";
import { appPort } from "./app-port";
import { useAuth } from "./features/account/account-context";
import { useAgents } from "./features/agents/agents-context";
import { useConversationController } from "./features/conversation/conversation-controller-context";
import { useCustomProviders } from "./features/custom-providers/custom-providers-context";
import type { ServerStorageOptions } from "./features/files/ServerStoragePanel";
import { canManageStorage, serverHasStorage } from "./features/files/storage-usage";
import { useSetup } from "./features/onboarding/onboarding-context";
import { useRemoteDesktop } from "./features/remote-desktop/remote-desktop-context";
import { mcpToolRuntimeNote } from "./features/servers/mcp-servers";
import { remoteAdminServer, serverCanAdminister } from "./features/servers/server-capabilities";
import { useServerSelection } from "./features/servers/server-selection";
import { useServerSettings } from "./features/servers/server-settings";
import { useServerSwitch } from "./features/servers/server-switch";
import { useServers } from "./features/servers/servers-context";
import { MARKETPLACE_PLUGINS } from "./features/settings/marketplace-plugin-catalog";
import { useSettings } from "./features/settings/settings-context";
import { useUpdates } from "./features/updates/updates-context";
import {
  AgentTemplateInstall,
  GlobalSearch,
  InitialSetup,
  JoinServerDialog,
  RemoteDesktopWorkspace,
  ServerSettingsModal,
  SettingsModal,
  SkillsMarketplaceModal,
} from "./lazy-views";
import { useNavigation } from "./navigation";
import { usePlatform } from "./platform";
import { useProviders } from "./providers";

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
 */
export function WorkspaceOverlays(props: AccountProps) {
  return (
    <>
      <PermissionsReview account={props.account} />
      <SkillsMarketplace />
      <SharedAgentInstall />
      <JoinServer account={props.account} />
      <ServerSettings />
      <AppSettings account={props.account} />
      <GlobalMessageSearch />
      <RemoteDesktop />
    </>
  );
}

/** The permissions half of first-run setup, reopened after the fact. */
function PermissionsReview(props: AccountProps) {
  const platform = usePlatform();
  const auth = useAuth();
  const setup = useSetup();
  const { agentStatus } = useAgents();
  const { joinRemoteDuringSetup } = useServerSelection();

  return (
    <Show when={setup.permissionsOpen()}>
      <Loading>
        <InitialSetup
          reviewing
          state={setup.setupState() ?? { completed: true, preferredProvider: "codex", preferredModel: null }}
          agentStatus={agentStatus()}
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
 * serves `agent-install-v1`, otherwise to this computer.
 */
function SkillsMarketplace() {
  const { skillsMarketplaceOpen, setSkillsMarketplaceOpen, pendingPluginSlug, setPendingPluginSlug } = useSettings();
  const { agentList, activeAgent, agentStatus, agentSetupOpen, creatingAgent } = useAgents();
  const controller = useConversationController();
  const { selectAgent } = useNavigation();
  const { activeServer } = useServers();
  const { openInstalledMarketplaceAgent } = useServerSelection();
  const manage = createMemo(() => serverCanAdminister(activeServer(), "skills-admin-v1"));
  const hostServerId = () => remoteAdminServer(activeServer(), "skills-admin-v1")?.id;
  const agentServerId = () => remoteAdminServer(activeServer(), "agent-install-v1")?.id;
  /* What both example controls need: a managed agent whose composer is free to take another line. */
  const composerFree = createMemo(
    () =>
      manage() &&
      agentStatus().phase === "ready" &&
      !controller.submitting() &&
      !controller.selectionSending() &&
      controller.voicePhase() === "idle" &&
      !controller.editingDeliveryId() &&
      !(agentSetupOpen() && creatingAgent()),
  );

  return (
    <Show when={skillsMarketplaceOpen()}>
      <Loading>
        <SkillsMarketplaceModal
          open={true}
          agents={manage() ? agentList() : []}
          activeAgentId={manage() ? (activeAgent()?.id ?? "") : ""}
          hostServerId={hostServerId()}
          agentServerId={agentServerId()}
          onOpenChange={(open) => {
            /* The slug is consumed by opening, so closing forgets it: reopening the marketplace by
               hand lands on the catalog rather than on the listing a link once named. */
            if (!open) setPendingPluginSlug(null);
            setSkillsMarketplaceOpen(open);
          }}
          onTrySkill={
            composerFree()
              ? (agentId, skill) => {
                  const server = activeServer();
                  if (
                    !serverCanAdminister(server, "skills-admin-v1") ||
                    !agentList().some((agent) => agent.id === agentId)
                  )
                    return;
                  selectAgent(agentId);
                  controller.appendSkillExample({ serverId: server.id, agentId }, skill);
                  setSkillsMarketplaceOpen(false);
                }
              : undefined
          }
          onAgentInstalled={openInstalledMarketplaceAgent}
          plugins={MARKETPLACE_PLUGINS}
          initialPluginSlug={pendingPluginSlug() ?? undefined}
          onInitialPluginSlugConsumed={() => setPendingPluginSlug(null)}
          /* A plugin's app is an MCP server, which the host holds. A joined server takes one over
             `mcp-servers-v1` from an admin, as the agents list does; a member browses the listings
             and installs nothing. */
          pluginServerId={
            manage() && serverCanAdminister(activeServer(), MCP_SERVERS_CAPABILITY) ? activeServer()?.id : undefined
          }
          pluginHostName={manage() ? remoteAdminServer(activeServer(), MCP_SERVERS_CAPABILITY)?.name : undefined}
          onRunPluginPrompt={
            composerFree()
              ? (agentId, prompt) => {
                  const server = activeServer();
                  if (
                    !serverCanAdminister(server, "skills-admin-v1") ||
                    !agentList().some((agent) => agent.id === agentId)
                  )
                    return;
                  selectAgent(agentId);
                  controller.appendPluginPrompt({ serverId: server.id, agentId }, prompt.text);
                  setSkillsMarketplaceOpen(false);
                }
              : undefined
          }
        />
      </Loading>
    </Show>
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
    <Show when={pendingAgentTemplateId()}>
      <Loading>
        <AgentTemplateInstall
          templateId={pendingAgentTemplateId()}
          server={remoteAdminServer(activeServer(), "agent-install-v1")}
          onClose={() => setPendingAgentTemplateId(null)}
          onInstalled={openInstalledMarketplaceAgent}
        />
      </Loading>
    </Show>
  );
}

/** Joining a team server from an invite link. */
function JoinServer(props: AccountProps) {
  const setup = useSetup();
  const { joinServerOpen, setJoinServerOpen } = useServers();
  const { joinServer } = useServerSelection();

  return (
    <Show when={joinServerOpen()}>
      <Loading>
        <JoinServerDialog
          inviteUrl={setup.pendingInviteUrl()}
          accountEmail={props.account().email}
          onClose={() => {
            setJoinServerOpen(false);
            setup.setPendingInviteUrl("");
          }}
          onPreview={setup.previewInvite}
          onJoin={joinServer}
        />
      </Loading>
    </Show>
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
  /**
   * Whether the tool runtimes the providers context holds are this server's: this computer's, or,
   * over `providers-v1`, those of the host of the joined server on screen.
   */
  const holdsToolRuntimes = (server: ServerSummary) =>
    server.kind === "local" ? providerAdminServerId() === undefined : server.id === providerAdminServerId();
  const {
    serverSettingsTarget,
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
    revokeServerInvite,
    serverSettingsMcp,
    serverSettingsMcpError,
    refreshMcpServers,
    saveMcpServer,
    removeMcpServer,
    setMcpServerEnabled,
    testMcpServer,
  } = useServerSettings();

  /**
   * The gate on the whole feature: the tab and the panel both hang off `mcpServers`. A remote host
   * answers 403 to a `member` and 400 without the capability, so neither ever sees the section.
   */
  const canUseMcp = (server: ServerSummary) => serverCanAdminister(server, MCP_SERVERS_CAPABILITY);

  // The workspace belongs to the selected server. For another server, the switch comes first and
  // the agent is published for the scope it lands in; a message there opens as its agent's chat.
  const openOnServer = (server: ServerSummary, agentId: string, open: () => void) => {
    setServerSettingsOpen(false);
    if (server.active) return open();
    void selectServer(server.id).then((selected) => {
      if (selected) setPendingAgentSelection(agentId);
    });
  };

  /** A remote host without `storage-v1` has no Storage section at all. */
  const storageOptions = (server: ServerSummary): ServerStorageOptions | undefined => {
    if (!serverHasStorage(server)) return undefined;
    return {
      hostName:
        server.kind === "local"
          ? platform.appInfo()?.platform === "darwin"
            ? "This Mac"
            : "This computer"
          : server.name,
      canManage: canManageStorage(server),
      onOpenAgent: (agentId) => openOnServer(server, agentId, () => selectAgent(agentId)),
      onShowMessage: (agentId, messageId) =>
        openOnServer(server, agentId, () => selectGlobalSearchMessage(agentId, messageId)),
    };
  };

  return (
    <Show when={serverSettingsTarget()}>
      {(server) => (
        <Loading>
          <ServerSettingsModal
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
            onOpenScreenRecordingSettings={() => appPort().openExternal("mac-screen-recording")}
            onRecheckScreenRecording={recheckScreenRecording}
            mcpServers={canUseMcp(server()) ? serverSettingsMcp() : undefined}
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
            // Agents import into this computer only; a remote host has no Import section.
            agentImport={
              server().kind === "local"
                ? {
                    onOpenAgent: (agentId) => openOnServer(server(), agentId, () => selectAgent(agentId)),
                    onClose: () => setServerSettingsOpen(false),
                  }
                : undefined
            }
          />
        </Loading>
      )}
    </Show>
  );
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
  const { activeServer } = useServers();
  const {
    appSettingsOpen,
    setAppSettingsOpen,
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
        providerKeys={providerDownloads() ? providerKeys() : undefined}
        providerHostName={providerAdminServerId() === undefined ? undefined : activeServer()?.name}
        codeLogin={providerDownloads() ? codeLogin : undefined}
        hostedSitesApi={appPort().hostedSites}
        turboModePending={turboModePending()}
        onTestNotification={sendTestNotification}
        onOpenNotificationSettings={openNotificationSettings}
        restoreFocusTarget={appSettingsRestoreTarget()}
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
    <Show when={globalSearchOpen()}>
      <Loading>
        <GlobalSearch
          open={true}
          agents={agentList()}
          onSearchMessages={searchGlobalMessages}
          onOpenChange={setGlobalSearchVisibility}
          onSelectAgent={selectAgent}
          onSelectMessage={selectGlobalSearchMessage}
        />
      </Loading>
    </Show>
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
