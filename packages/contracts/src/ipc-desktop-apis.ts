import type { AgentEvent } from "./ipc-agent-events";
import type { AttachmentImportEvent } from "./ipc-attachments";
import type { BrowserBounds, BrowserLiveViewInput } from "./ipc-browser";
import type { GroupApi, Invoke, IPC_ENDPOINTS, IpcEndpoints, Subscribe } from "./ipc-endpoints";
import type {
  CreateTeamInviteInput,
  DirectMessageRealtimeEvent,
  DirectTypingRealtimeEvent,
  InviteSummary,
  TeamMemberSummary,
  TeamPresenceSnapshot,
  UpdateTeamMemberInput,
} from "./ipc-team-host";

/**
 * Every agent group, spread into one namespace. Each scoped method takes its server last; left out,
 * it is the selected server. `onEvent` is `onScopedEvent` filtered to the selected server, and
 * `onAttachmentImport` reports the files the preload imports from a drop or a paste.
 */
export interface AgentDesktopApi
  extends GroupApi<IpcEndpoints["agent"]>,
    GroupApi<IpcEndpoints["agentMemories"]>,
    GroupApi<IpcEndpoints["sharedTables"]>,
    GroupApi<IpcEndpoints["agentRoutines"]>,
    GroupApi<IpcEndpoints["channelMemories"]>,
    GroupApi<IpcEndpoints["channelRoutines"]>,
    GroupApi<IpcEndpoints["mcpServers"]>,
    GroupApi<IpcEndpoints["agentAttachments"]> {
  onAttachmentImport: (listener: (event: AttachmentImportEvent) => void) => () => void;
  onEvent: (listener: (event: AgentEvent) => void) => () => void;
}

export type AgentTemplatesDesktopApi = GroupApi<IpcEndpoints["agentTemplates"]>;

export type MarketplaceAgentsDesktopApi = GroupApi<IpcEndpoints["marketplaceAgents"]>;

export interface BrowserDesktopApi {
  open: Invoke<typeof IPC_ENDPOINTS.browser.open>;
  activate: Invoke<typeof IPC_ENDPOINTS.browser.activate>;
  navigate: Invoke<typeof IPC_ENDPOINTS.browser.navigate>;
  reload: Invoke<typeof IPC_ENDPOINTS.browser.reload>;
  close: Invoke<typeof IPC_ENDPOINTS.browser.close>;
  listTabs: Invoke<typeof IPC_ENDPOINTS.browser.listTabs>;
  getDisplayState: Invoke<typeof IPC_ENDPOINTS.browser.getDisplayState>;
  getControlState: Invoke<typeof IPC_ENDPOINTS.browser.getControlState>;
  capturePreview: Invoke<typeof IPC_ENDPOINTS.browser.capturePreview>;
  setVisible: Invoke<typeof IPC_ENDPOINTS.browser.setVisible>;
  /** Starts a live view of a tab on the active remote server. A local tab is already on screen. */
  startLiveView: Invoke<typeof IPC_ENDPOINTS.browser.startLiveView>;
  stopLiveView: Invoke<typeof IPC_ENDPOINTS.browser.stopLiveView>;
  sendLiveViewInput: (input: BrowserLiveViewInput) => Promise<void>;
  onLiveViewEvent: Subscribe<typeof IPC_ENDPOINTS.browser.liveViewEvent>;
  onDisplayState: Subscribe<typeof IPC_ENDPOINTS.browser.displayStateEvent>;
  openPictureInPicture: (bounds?: BrowserBounds) => Promise<BrowserBounds>;
  closePictureInPicture: Invoke<typeof IPC_ENDPOINTS.browser.pictureInPictureClose>;
  dockPictureInPicture: Invoke<typeof IPC_ENDPOINTS.browser.pictureInPictureDock>;
  hidePictureInPicture: Invoke<typeof IPC_ENDPOINTS.browser.pictureInPictureHide>;
  onPictureInPictureEvent: Subscribe<typeof IPC_ENDPOINTS.browser.pictureInPictureEvent>;
}

export type CentralAuthDesktopApi = GroupApi<IpcEndpoints["auth"]>;

export type UpdateDesktopApi = GroupApi<IpcEndpoints["update"]>;

export type NotificationsDesktopApi = GroupApi<IpcEndpoints["notifications"]>;

export type ProviderRuntimesDesktopApi = GroupApi<IpcEndpoints["providerRuntimes"]>;

export type MaintenanceDesktopApi = GroupApi<IpcEndpoints["maintenance"]>;

export type DynamicIslandDesktopApi = GroupApi<IpcEndpoints["dynamicIsland"]>;

export interface ServersDesktopApi {
  setMuted: Invoke<typeof IPC_ENDPOINTS.servers.setMuted>;
  setNotificationLevel: Invoke<typeof IPC_ENDPOINTS.servers.setNotificationLevel>;
  list: Invoke<typeof IPC_ENDPOINTS.servers.list>;
  select: Invoke<typeof IPC_ENDPOINTS.servers.select>;
  reorder: Invoke<typeof IPC_ENDPOINTS.servers.reorder>;
  join: Invoke<typeof IPC_ENDPOINTS.servers.join>;
  previewInvite: Invoke<typeof IPC_ENDPOINTS.servers.previewInvite>;
  takePendingInvite: Invoke<typeof IPC_ENDPOINTS.servers.takePendingInvite>;
  login: Invoke<typeof IPC_ENDPOINTS.servers.login>;
  retryConnection: Invoke<typeof IPC_ENDPOINTS.servers.retryConnection>;
  remove: Invoke<typeof IPC_ENDPOINTS.servers.remove>;
  getPresence: Invoke<typeof IPC_ENDPOINTS.servers.getPresence>;
  getPresenceFor: Invoke<typeof IPC_ENDPOINTS.servers.getPresenceFor>;
  refreshIdentity: Invoke<typeof IPC_ENDPOINTS.servers.refreshIdentity>;
  listMembers: Invoke<typeof IPC_ENDPOINTS.servers.listMembers>;
  updateMember: (serverId: string, input: UpdateTeamMemberInput) => Promise<TeamMemberSummary>;
  removeMember: (serverId: string, memberId: string) => Promise<void>;
  listInvites: Invoke<typeof IPC_ENDPOINTS.servers.listInvites>;
  revokeInvite: (serverId: string, inviteId: string) => Promise<void>;
  createInvite: (serverId: string, input: CreateTeamInviteInput) => Promise<InviteSummary>;
  setTyping: Invoke<typeof IPC_ENDPOINTS.servers.setTyping>;
  onPresence: (listener: (snapshot: TeamPresenceSnapshot) => void, serverId?: string) => () => void;
  listDirectThreads: Invoke<typeof IPC_ENDPOINTS.servers.listDirectThreads>;
  readDirectConversation: Invoke<typeof IPC_ENDPOINTS.servers.readDirectConversation>;
  readDirectConversationPage: Invoke<typeof IPC_ENDPOINTS.servers.readDirectConversationPage>;
  sendDirectMessage: Invoke<typeof IPC_ENDPOINTS.servers.sendDirectMessage>;
  markDirectRead: Invoke<typeof IPC_ENDPOINTS.servers.markDirectRead>;
  setDirectTyping: Invoke<typeof IPC_ENDPOINTS.servers.setDirectTyping>;
  onDirectMessage: (listener: (event: DirectMessageRealtimeEvent) => void) => () => void;
  onDirectTyping: (listener: (event: DirectTypingRealtimeEvent) => void) => () => void;
  onEvent: Subscribe<typeof IPC_ENDPOINTS.servers.event>;
  onInvite: Subscribe<typeof IPC_ENDPOINTS.servers.invite>;
}

/**
 * The plugin deep link. Both carry a slug, never a listing: the catalog is already in the renderer,
 * and a link that carried the listing itself would let the address bar describe what gets installed.
 */
export type PluginsDesktopApi = GroupApi<IpcEndpoints["plugins"]>;

export type HostDesktopApi = GroupApi<IpcEndpoints["host"]>;

export type RemoteDesktopDesktopApi = GroupApi<IpcEndpoints["remoteDesktop"]>;

export type VoiceDesktopApi = GroupApi<IpcEndpoints["voice"]>;

export type SkillsDesktopApi = GroupApi<IpcEndpoints["skills"]>;

export type HostedSitesDesktopApi = GroupApi<IpcEndpoints["hostedSites"]>;

/**
 * The user's own model endpoints. `save` and `delete` both answer with the whole list plus how the
 * provider restart went, so the renderer replaces its snapshot in one write and can say honestly
 * whether the models are on their way.
 */
export type CustomProvidersDesktopApi = GroupApi<IpcEndpoints["customProviders"]>;

/**
 * Storage and files of one host. Every scoped method names its server, because the settings modal can
 * be open for a server the user has not switched to. A remote host without `storage-v1` answers null.
 */
export type StorageDesktopApi = GroupApi<IpcEndpoints["storage"]>;

/**
 * Agent import into the local host. `choose` opens the file dialog and answers null when the user
 * cancels. A token is used once: `apply` and `discard` both release the staged archive.
 */
export type AgentImportDesktopApi = GroupApi<IpcEndpoints["agentImport"]>;

// The `app` and `providers` groups sit at the top level, as they did before groups existed.
export interface OpenBotDesktopApi extends GroupApi<IpcEndpoints["app"]>, GroupApi<IpcEndpoints["providers"]> {
  dynamicIsland: DynamicIslandDesktopApi;
  getComputerUseState: Invoke<typeof IPC_ENDPOINTS.computerUse.getState>;
  openComputerUsePermissionPane: Invoke<typeof IPC_ENDPOINTS.computerUse.openPermissionPane>;
  closeComputerUsePermissionHelp: Invoke<typeof IPC_ENDPOINTS.computerUse.closePermissionHelp>;
  getComputerUsePermissionApp: Invoke<typeof IPC_ENDPOINTS.computerUse.getPermissionApp>;
  /** Starts the native drag. Only the help window may call it; every other sender is refused. */
  startComputerUsePermissionAppDrag: Invoke<typeof IPC_ENDPOINTS.computerUse.startPermissionAppDrag>;
  revealComputerUsePermissionApp: Invoke<typeof IPC_ENDPOINTS.computerUse.revealPermissionApp>;
  /**
   * Where to draw the rim over the window an agent works in. Only the overlay surface listens.
   *
   * It is pushed rather than asked for: the overlay carries no control and invokes nothing, so a
   * window that floats over another application's has no channel it could be driven through.
   */
  onComputerUseHighlightPlacement: Subscribe<typeof IPC_ENDPOINTS.computerUse.highlightPlacement>;
  providerRuntimes: ProviderRuntimesDesktopApi;
  voice: VoiceDesktopApi;
  skills: SkillsDesktopApi;
  customProviders: CustomProvidersDesktopApi;
  storage: StorageDesktopApi;
  agentImport: AgentImportDesktopApi;
  hostedSites: HostedSitesDesktopApi;
  marketplaceAgents: MarketplaceAgentsDesktopApi;
  agentTemplates: AgentTemplatesDesktopApi;
  auth: CentralAuthDesktopApi;
  agent: AgentDesktopApi;
  browser: BrowserDesktopApi;
  update: UpdateDesktopApi;
  notifications: NotificationsDesktopApi;
  maintenance: MaintenanceDesktopApi;
  servers: ServersDesktopApi;
  plugins: PluginsDesktopApi;
  host: HostDesktopApi;
  remoteDesktop: RemoteDesktopDesktopApi;
}
