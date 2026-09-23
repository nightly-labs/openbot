import type { CentralAuthUser, ServerSummary } from "@openbot/contracts/ipc";
import { MCP_SERVERS_CAPABILITY } from "@openbot/contracts/ipc";
import { createMemo, Loading, Show } from "solid-js";
import { useAuth } from "./features/account/account-context";
import { useAgents } from "./features/agents/agents-context";
import { useConversationController } from "./features/conversation/conversation-controller-context";
import { useCustomProviders } from "./features/custom-providers/custom-providers-context";
import { useSetup } from "./features/onboarding/onboarding-context";
import { useRemoteDesktop } from "./features/remote-desktop/remote-desktop-context";
import { mcpToolRuntimeNote } from "./features/servers/mcp-servers";
import { serverSupportsCapability } from "./features/servers/server-capabilities";
import { useServerSelection } from "./features/servers/server-selection";
import { useServerSettings } from "./features/servers/server-settings";
import { useServers } from "./features/servers/servers-context";
import { MARKETPLACE_PLUGINS } from "./features/settings/marketplace-plugin-catalog";
import { providerKeyApi } from "./features/settings/provider-key-api";
import { useSettings } from "./features/settings/settings-context";
import { useUpdates } from "./features/updates/updates-context";
import {
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
 * Skills and marketplace agents, which install into an Agent's workspace on this
 * machine, so the picker is empty for a remote server.
 */
function SkillsMarketplace() {
  const { skillsMarketplaceOpen, setSkillsMarketplaceOpen, pendingPluginSlug, setPendingPluginSlug } = useSettings();
  const { agentList, activeAgent, agentStatus, agentSetupOpen, creatingAgent } = useAgents();
  const controller = useConversationController();
  const { selectAgent } = useNavigation();
  const { activeServer } = useServers();
  const { openInstalledMarketplaceAgent } = useServerSelection();
  const local = createMemo(() => activeServer()?.kind === "local");
  /* What both example controls need: a local agent whose composer is free to take another line. */
  const composerFree = createMemo(
    () =>
      local() &&
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
          agents={local() ? agentList() : []}
          activeAgentId={local() ? (activeAgent()?.id ?? "") : ""}
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
                  if (server?.kind !== "local" || !agentList().some((agent) => agent.id === agentId)) return;
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
          /* A plugin's app is an MCP server, which the host holds. Only a local server takes one
             here, as the agents list does, so a remote server browses the listings and installs
             nothing. */
          pluginServerId={local() ? activeServer()?.id : undefined}
          onRunPluginPrompt={
            composerFree()
              ? (agentId, prompt) => {
                  const server = activeServer();
                  if (server?.kind !== "local" || !agentList().some((agent) => agent.id === agentId)) return;
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
  const { hostStatus, setServerMuted } = useServers();
  const { toolRuntimeStatuses } = useProviders();
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
  const canUseMcp = (server: ServerSummary) =>
    server.kind === "local" || (serverSupportsCapability(server, MCP_SERVERS_CAPABILITY) && server.role !== "member");

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
            onCreateInvite={createServerInvite}
            onUpdateMember={updateServerMember}
            onRemoveMember={removeServerMember}
            onRevokeInvite={revokeServerInvite}
            onOpenScreenRecordingSettings={() => window.openbot.openExternal("mac-screen-recording")}
            onRecheckScreenRecording={recheckScreenRecording}
            mcpServers={canUseMcp(server()) ? serverSettingsMcp() : undefined}
            // Only for this computer: the runtime a remote host starts its own servers with is that
            // host's, and this window downloads nothing for it.
            mcpToolRuntimeNote={server().kind === "local" ? mcpToolRuntimeNote(toolRuntimeStatuses().bun) : null}
            mcpLoadError={serverSettingsMcpError()}
            onMcpSectionShown={() => void refreshMcpServers()}
            onRetryMcpServers={() => void refreshMcpServers()}
            onSaveMcpServer={saveMcpServer}
            onRemoveMcpServer={removeMcpServer}
            onSetMcpServerEnabled={setMcpServerEnabled}
            onTestMcpServer={testMcpServer}
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
  } = useProviders();
  const { customProviders, saveCustomProvider, deleteCustomProvider } = useCustomProviders();
  /** Provider downloads are the local machine's business, never a remote host's. */
  const localProviderDownloads = createMemo(
    () => activeServer()?.kind === "local" && providerRuntimeDownloadsAvailable(),
  );
  /**
   * A named endpoint merges into the `opencode acp` process on *this* computer, so a remote server
   * must show no custom row, no list and no Add. This is not `localProviderDownloads()`: that one
   * also needs `providerRuntimeDownloadsAvailable()`, which is about managed runtime downloads and
   * would hide this feature on a build without them.
   */
  const localCustomProviders = createMemo(() => activeServer()?.kind === "local");

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
        providerRuntimeStatuses={localProviderDownloads() ? providerRuntimeStatuses() : undefined}
        providerAvailableVersions={localProviderDownloads() ? providerAvailableVersions() : undefined}
        onUpdateProvider={localProviderDownloads() ? startProviderUpdate : undefined}
        onDownloadProvider={localProviderDownloads() ? downloadProviderRuntime : undefined}
        onCancelProviderDownload={localProviderDownloads() ? cancelProviderRuntimeDownload : undefined}
        onConnectProvider={localProviderDownloads() ? connectProvider : undefined}
        onInstallProvider={localProviderDownloads() ? openProviderInstallGuide : undefined}
        customProviders={localCustomProviders() ? customProviders() : undefined}
        onAddCustomProvider={localCustomProviders() ? saveCustomProvider : undefined}
        onDeleteCustomProvider={localCustomProviders() ? deleteCustomProvider : undefined}
        providerKeys={localProviderDownloads() ? providerKeyApi : undefined}
        codeLogin={localProviderDownloads() ? codeLogin : undefined}
        hostedSitesApi={window.openbot.hostedSites}
        turboModePending={turboModePending()}
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
