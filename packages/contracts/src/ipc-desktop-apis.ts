import type { AgentAnalytics, AgentAnalyticsInput } from "./ipc-agent-analytics";
import type { AgentEvent } from "./ipc-agent-events";
import type { AccountUsage } from "./ipc-agent-status";
import type { AgentSummary } from "./ipc-agents";
import type { CentralAuthState } from "./ipc-app-auth";
import type { AttachmentImportEvent } from "./ipc-attachments";
import type { BrowserBounds, BrowserLiveViewInput } from "./ipc-browser";
import type {
  ConversationPage,
  ConversationReadState,
  MarkConversationReadInput,
  ReadConversationPageInput,
  SendMessageInput,
} from "./ipc-conversations";
import type { Invoke, IPC_ENDPOINTS, Subscribe } from "./ipc-endpoints";
import type { HostAnalytics, HostAnalyticsInput } from "./ipc-host-analytics";
import type { MarketplaceAgentPage, MarketplaceAgentQuery } from "./ipc-marketplace-agents";
import type {
  McpServerConfig,
  McpTestResult,
  RemoveMcpServerInput,
  SaveMcpServerInput,
  SetMcpServerEnabledInput,
  TestMcpServerInput,
} from "./ipc-mcp-servers";
import type {
  EditQueuedMessageInput,
  QueuedMessageReceipt,
  QueueSnapshot,
  UpdateQueuedMessageInput,
} from "./ipc-queue";
import type { MarketplaceSkillPage, MarketplaceSkillQuery } from "./ipc-skills";
import type {
  ClearStorageInput,
  DeleteStoredFileInput,
  GetStorageUsageInput,
  OpenStoredFileInput,
  StorageUsage,
} from "./ipc-storage";
import type {
  CreateTeamInviteInput,
  DirectMessageRealtimeEvent,
  DirectTypingRealtimeEvent,
  InviteSummary,
  TeamMemberSummary,
  TeamPresenceSnapshot,
  UpdateTeamMemberInput,
} from "./ipc-team-host";

export interface AgentDesktopApi {
  listChannels: Invoke<typeof IPC_ENDPOINTS.agent.listChannels>;
  readChannel: Invoke<typeof IPC_ENDPOINTS.agent.readChannel>;
  channelCommand: Invoke<typeof IPC_ENDPOINTS.agent.channelCommand>;
  deleteChannel: Invoke<typeof IPC_ENDPOINTS.agent.deleteChannel>;
  getStatus: Invoke<typeof IPC_ENDPOINTS.agent.getStatus>;
  getAnalytics: (input: AgentAnalyticsInput, serverId: string) => Promise<AgentAnalytics | null>;
  getHostAnalytics: (input: HostAnalyticsInput, serverId: string) => Promise<HostAnalytics | null>;
  getUsage: (agentId?: string) => Promise<AccountUsage>;
  listModels: Invoke<typeof IPC_ENDPOINTS.agent.listModels>;
  listAgents: (serverId?: string) => Promise<AgentSummary[]>;
  listInstalledSkills: Invoke<typeof IPC_ENDPOINTS.agent.listInstalledSkills>;
  getSidebarLayout: Invoke<typeof IPC_ENDPOINTS.agent.getSidebarLayout>;
  mutateSidebarLayout: Invoke<typeof IPC_ENDPOINTS.agent.mutateSidebarLayout>;
  generateProfile: Invoke<typeof IPC_ENDPOINTS.agent.generateProfile>;
  saveProfile: Invoke<typeof IPC_ENDPOINTS.agent.saveProfile>;
  createAgent: Invoke<typeof IPC_ENDPOINTS.agent.create>;
  duplicateAgent: Invoke<typeof IPC_ENDPOINTS.agent.duplicate>;
  updateAgent: Invoke<typeof IPC_ENDPOINTS.agent.update>;
  setAvatar: Invoke<typeof IPC_ENDPOINTS.agent.setAvatar>;
  deleteAgent: Invoke<typeof IPC_ENDPOINTS.agent.delete>;
  listMemories: Invoke<typeof IPC_ENDPOINTS.agentMemories.listMemories>;
  createMemory: Invoke<typeof IPC_ENDPOINTS.agentMemories.createMemory>;
  updateMemory: Invoke<typeof IPC_ENDPOINTS.agentMemories.updateMemory>;
  deleteMemory: Invoke<typeof IPC_ENDPOINTS.agentMemories.deleteMemory>;
  clearMemories: Invoke<typeof IPC_ENDPOINTS.agentMemories.clearMemories>;
  /**
   * Shared tables are not scoped to an agent: there is no `agentId` on either call. The list is
   * every table in the one shared database, and the user's delete is not owner-gated.
   */
  listTables: Invoke<typeof IPC_ENDPOINTS.sharedTables.listTables>;
  deleteTable: Invoke<typeof IPC_ENDPOINTS.sharedTables.deleteTable>;
  listRoutines: Invoke<typeof IPC_ENDPOINTS.agentRoutines.listRoutines>;
  createRoutine: Invoke<typeof IPC_ENDPOINTS.agentRoutines.createRoutine>;
  updateRoutine: Invoke<typeof IPC_ENDPOINTS.agentRoutines.updateRoutine>;
  deleteRoutine: Invoke<typeof IPC_ENDPOINTS.agentRoutines.deleteRoutine>;
  testRoutine: Invoke<typeof IPC_ENDPOINTS.agentRoutines.testRoutine>;
  listRoutineRuns: Invoke<typeof IPC_ENDPOINTS.agentRoutines.listRoutineRuns>;
  listChannelMemories: Invoke<typeof IPC_ENDPOINTS.channelMemories.listChannelMemories>;
  createChannelMemory: Invoke<typeof IPC_ENDPOINTS.channelMemories.createChannelMemory>;
  updateChannelMemory: Invoke<typeof IPC_ENDPOINTS.channelMemories.updateChannelMemory>;
  deleteChannelMemory: Invoke<typeof IPC_ENDPOINTS.channelMemories.deleteChannelMemory>;
  clearChannelMemories: Invoke<typeof IPC_ENDPOINTS.channelMemories.clearChannelMemories>;
  listChannelRoutines: Invoke<typeof IPC_ENDPOINTS.channelRoutines.listChannelRoutines>;
  createChannelRoutine: Invoke<typeof IPC_ENDPOINTS.channelRoutines.createChannelRoutine>;
  updateChannelRoutine: Invoke<typeof IPC_ENDPOINTS.channelRoutines.updateChannelRoutine>;
  deleteChannelRoutine: Invoke<typeof IPC_ENDPOINTS.channelRoutines.deleteChannelRoutine>;
  testChannelRoutine: Invoke<typeof IPC_ENDPOINTS.channelRoutines.testChannelRoutine>;
  listChannelRoutineRuns: Invoke<typeof IPC_ENDPOINTS.channelRoutines.listChannelRoutineRuns>;
  // Every MCP method names its server, because the settings modal can be open for a server the user
  // has not switched to. Each mutation answers with the whole list, so the panel never merges.
  listMcpServers: (serverId: string) => Promise<McpServerConfig[]>;
  saveMcpServer: (input: SaveMcpServerInput, serverId: string) => Promise<McpServerConfig[]>;
  removeMcpServer: (input: RemoveMcpServerInput, serverId: string) => Promise<McpServerConfig[]>;
  setMcpServerEnabled: (input: SetMcpServerEnabledInput, serverId: string) => Promise<McpServerConfig[]>;
  /** A test connects once and reports what it found. Nothing is stored, and no agent uses it. */
  testMcpServer: (input: TestMcpServerInput, serverId: string) => Promise<McpTestResult>;
  readConversation: Invoke<typeof IPC_ENDPOINTS.agent.readConversation>;
  readConversationPage: (input: ReadConversationPageInput, serverId?: string) => Promise<ConversationPage>;
  searchConversationMessages: Invoke<typeof IPC_ENDPOINTS.agent.searchConversationMessages>;
  listConversationReads: Invoke<typeof IPC_ENDPOINTS.agent.listConversationReads>;
  markConversationRead: (input: MarkConversationReadInput, serverId?: string) => Promise<ConversationReadState>;
  chooseAttachments: Invoke<typeof IPC_ENDPOINTS.agentAttachments.chooseAttachments>;
  onAttachmentImport: (listener: (event: AttachmentImportEvent) => void) => () => void;
  discardDraftAttachment: (attachmentId: string, serverId?: string) => Promise<void>;
  downloadAttachments: Invoke<typeof IPC_ENDPOINTS.agentAttachments.downloadAttachments>;
  openAttachment: Invoke<typeof IPC_ENDPOINTS.agentAttachments.openAttachment>;
  openSharedFile: Invoke<typeof IPC_ENDPOINTS.agentAttachments.openSharedFile>;
  openWorkspaceFile: Invoke<typeof IPC_ENDPOINTS.agentAttachments.openWorkspaceFile>;
  previewSharedFile: Invoke<typeof IPC_ENDPOINTS.agentAttachments.previewSharedFile>;
  previewWorkspaceFile: Invoke<typeof IPC_ENDPOINTS.agentAttachments.previewWorkspaceFile>;
  sendMessage: (input: SendMessageInput, serverId?: string) => Promise<QueuedMessageReceipt>;
  setMessageReaction: Invoke<typeof IPC_ENDPOINTS.agent.setMessageReaction>;
  listQueue: Invoke<typeof IPC_ENDPOINTS.agent.listQueue>;
  acknowledgeFailedTurn: Invoke<typeof IPC_ENDPOINTS.agent.acknowledgeFailedTurn>;
  cancelQueuedMessage: Invoke<typeof IPC_ENDPOINTS.agent.cancelQueuedMessage>;
  steerQueuedMessage: Invoke<typeof IPC_ENDPOINTS.agent.steerQueuedMessage>;
  editQueuedMessage: (input: EditQueuedMessageInput, serverId?: string) => Promise<QueueSnapshot>;
  updateQueuedMessage: (input: UpdateQueuedMessageInput, serverId?: string) => Promise<void>;
  reorderQueue: Invoke<typeof IPC_ENDPOINTS.agent.reorderQueue>;
  interrupt: Invoke<typeof IPC_ENDPOINTS.agent.interrupt>;
  respondToPrompt: Invoke<typeof IPC_ENDPOINTS.agent.respondToPrompt>;
  respondToApproval: Invoke<typeof IPC_ENDPOINTS.agent.respondToApproval>;
  respondToBrowserSecret: Invoke<typeof IPC_ENDPOINTS.agent.respondToBrowserSecret>;
  respondToBrowserTakeover: Invoke<typeof IPC_ENDPOINTS.agent.respondToBrowserTakeover>;
  onEvent: (listener: (event: AgentEvent) => void) => () => void;
  onScopedEvent: Subscribe<typeof IPC_ENDPOINTS.agent.event>;
}

export interface MarketplaceAgentsDesktopApi {
  list: (query?: MarketplaceAgentQuery) => Promise<MarketplaceAgentPage>;
  get: Invoke<typeof IPC_ENDPOINTS.marketplaceAgents.get>;
  listMine: Invoke<typeof IPC_ENDPOINTS.marketplaceAgents.listMine>;
  preview: Invoke<typeof IPC_ENDPOINTS.marketplaceAgents.preview>;
  submit: Invoke<typeof IPC_ENDPOINTS.marketplaceAgents.submit>;
  install: Invoke<typeof IPC_ENDPOINTS.marketplaceAgents.install>;
}

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

export interface CentralAuthDesktopApi {
  getState: Invoke<typeof IPC_ENDPOINTS.auth.getState>;
  retry: Invoke<typeof IPC_ENDPOINTS.auth.retry>;
  requestEmailCode: Invoke<typeof IPC_ENDPOINTS.auth.requestEmailCode>;
  verifyEmailCode: (challengeId: string, code: string) => Promise<CentralAuthState>;
  updateName: Invoke<typeof IPC_ENDPOINTS.auth.updateName>;
  updateAvatar: Invoke<typeof IPC_ENDPOINTS.auth.updateAvatar>;
  createMobileConnect: Invoke<typeof IPC_ENDPOINTS.auth.createMobileConnect>;
  listMobileConnectedDevices: Invoke<typeof IPC_ENDPOINTS.auth.listMobileConnectedDevices>;
  listAccountSessions: Invoke<typeof IPC_ENDPOINTS.auth.listAccountSessions>;
  revokeAccountSession: Invoke<typeof IPC_ENDPOINTS.auth.revokeAccountSession>;
  revokeMobileConnectedDevice: Invoke<typeof IPC_ENDPOINTS.auth.revokeMobileConnectedDevice>;
  logout: Invoke<typeof IPC_ENDPOINTS.auth.logout>;
  onEvent: Subscribe<typeof IPC_ENDPOINTS.auth.event>;
}

export interface UpdateDesktopApi {
  getStatus: Invoke<typeof IPC_ENDPOINTS.update.getStatus>;
  check: Invoke<typeof IPC_ENDPOINTS.update.check>;
  download: Invoke<typeof IPC_ENDPOINTS.update.download>;
  install: Invoke<typeof IPC_ENDPOINTS.update.install>;
  getPreference: Invoke<typeof IPC_ENDPOINTS.update.getPreference>;
  setPreference: Invoke<typeof IPC_ENDPOINTS.update.setPreference>;
  onEvent: Subscribe<typeof IPC_ENDPOINTS.update.event>;
}

export interface NotificationsDesktopApi {
  getPreference: Invoke<typeof IPC_ENDPOINTS.notifications.getPreference>;
  setPreference: Invoke<typeof IPC_ENDPOINTS.notifications.setPreference>;
  // Shows one OS notification now, even when the window has focus, so the user can check that the
  // operating system lets OpenBot show them.
  test: Invoke<typeof IPC_ENDPOINTS.notifications.test>;
  // Opens the operating system page where the user allows OpenBot notifications. It rejects on a
  // system that has no such page.
  openSettings: Invoke<typeof IPC_ENDPOINTS.notifications.openSettings>;
  onOpened: Subscribe<typeof IPC_ENDPOINTS.notifications.openedEvent>;
}

export interface ProviderRuntimesDesktopApi {
  getStatus: Invoke<typeof IPC_ENDPOINTS.providerRuntimes.getStatus>;
  download: Invoke<typeof IPC_ENDPOINTS.providerRuntimes.download>;
  cancel: Invoke<typeof IPC_ENDPOINTS.providerRuntimes.cancel>;
  /** Asks each provider's upstream for its latest release. Rejects when no source answered. */
  checkForUpdates: Invoke<typeof IPC_ENDPOINTS.providerRuntimes.checkForUpdates>;
  onEvent: Subscribe<typeof IPC_ENDPOINTS.providerRuntimes.event>;
}

export interface MaintenanceDesktopApi {
  exportData: Invoke<typeof IPC_ENDPOINTS.maintenance.exportData>;
  exportDiagnostics: Invoke<typeof IPC_ENDPOINTS.maintenance.exportDiagnostics>;
}

export interface DynamicIslandDesktopApi {
  getPreference: Invoke<typeof IPC_ENDPOINTS.dynamicIsland.getPreference>;
  setPreference: Invoke<typeof IPC_ENDPOINTS.dynamicIsland.setPreference>;
  publishPresentation: Invoke<typeof IPC_ENDPOINTS.dynamicIsland.publishPresentation>;
  getPresentation: Invoke<typeof IPC_ENDPOINTS.dynamicIsland.getPresentation>;
  onPreference: Subscribe<typeof IPC_ENDPOINTS.dynamicIsland.preference>;
  onPresentation: Subscribe<typeof IPC_ENDPOINTS.dynamicIsland.presentation>;
  onGeometry: Subscribe<typeof IPC_ENDPOINTS.dynamicIsland.geometry>;
  performAction: Invoke<typeof IPC_ENDPOINTS.dynamicIsland.performAction>;
  performHaptic: Invoke<typeof IPC_ENDPOINTS.dynamicIsland.performHaptic>;
  onAction: Subscribe<typeof IPC_ENDPOINTS.dynamicIsland.action>;
  setInteractive: Invoke<typeof IPC_ENDPOINTS.dynamicIsland.setInteractive>;
}

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
export interface PluginsDesktopApi {
  takePendingListing: Invoke<typeof IPC_ENDPOINTS.plugins.takePendingListing>;
  onOpenListing: Subscribe<typeof IPC_ENDPOINTS.plugins.openListing>;
}

export interface HostDesktopApi {
  getStatus: Invoke<typeof IPC_ENDPOINTS.host.getStatus>;
  configure: Invoke<typeof IPC_ENDPOINTS.host.configure>;
  updateIdentity: Invoke<typeof IPC_ENDPOINTS.host.updateIdentity>;
  getPresence: Invoke<typeof IPC_ENDPOINTS.host.getPresence>;
  start: Invoke<typeof IPC_ENDPOINTS.host.start>;
  stop: Invoke<typeof IPC_ENDPOINTS.host.stop>;
  /**
   * Asks the screen sharing runtime again whether the operating system lets it record, and answers
   * the status that holds the result.
   *
   * The refusal is remembered, because the runtime that reported it is dropped so that the next
   * attempt reads a new grant. Without this call only another member's attempt could clear it, and
   * the host owner who just gave the grant would keep reading that they had not.
   */
  recheckScreenRecording: Invoke<typeof IPC_ENDPOINTS.host.recheckScreenRecording>;
  listMembers: Invoke<typeof IPC_ENDPOINTS.host.listMembers>;
  updateMember: Invoke<typeof IPC_ENDPOINTS.host.updateMember>;
  removeMember: Invoke<typeof IPC_ENDPOINTS.host.removeMember>;
  listSessions: Invoke<typeof IPC_ENDPOINTS.host.listSessions>;
  revokeSession: Invoke<typeof IPC_ENDPOINTS.host.revokeSession>;
  listInvites: Invoke<typeof IPC_ENDPOINTS.host.listInvites>;
  revokeInvite: Invoke<typeof IPC_ENDPOINTS.host.revokeInvite>;
  createInvite: Invoke<typeof IPC_ENDPOINTS.host.createInvite>;
  onEvent: Subscribe<typeof IPC_ENDPOINTS.host.event>;
}

export interface RemoteDesktopDesktopApi {
  checkSetup: Invoke<typeof IPC_ENDPOINTS.remoteDesktop.checkSetup>;
  openSetup: Invoke<typeof IPC_ENDPOINTS.remoteDesktop.openSetup>;
  test: Invoke<typeof IPC_ENDPOINTS.remoteDesktop.test>;
  list: Invoke<typeof IPC_ENDPOINTS.remoteDesktop.list>;
  connect: Invoke<typeof IPC_ENDPOINTS.remoteDesktop.connect>;
  selectDisplay: Invoke<typeof IPC_ENDPOINTS.remoteDesktop.selectDisplay>;
  disconnect: Invoke<typeof IPC_ENDPOINTS.remoteDesktop.disconnect>;
  onEvent: Subscribe<typeof IPC_ENDPOINTS.remoteDesktop.event>;
}

export interface VoiceDesktopApi {
  getModelStatus: Invoke<typeof IPC_ENDPOINTS.voice.getModelStatus>;
  prepareModel: Invoke<typeof IPC_ENDPOINTS.voice.prepareModel>;
  transcribe: Invoke<typeof IPC_ENDPOINTS.voice.transcribe>;
  onModelStatus: Subscribe<typeof IPC_ENDPOINTS.voice.modelStatus>;
}

export interface SkillsDesktopApi {
  localList: Invoke<typeof IPC_ENDPOINTS.skills.localList>;
  localGet: Invoke<typeof IPC_ENDPOINTS.skills.localGet>;
  localCreate: Invoke<typeof IPC_ENDPOINTS.skills.localCreate>;
  localRevise: Invoke<typeof IPC_ENDPOINTS.skills.localRevise>;
  localInstall: Invoke<typeof IPC_ENDPOINTS.skills.localInstall>;

  list: (query?: MarketplaceSkillQuery) => Promise<MarketplaceSkillPage>;
  get: Invoke<typeof IPC_ENDPOINTS.skills.get>;
  listMine: Invoke<typeof IPC_ENDPOINTS.skills.listMine>;
  choosePackage: Invoke<typeof IPC_ENDPOINTS.skills.choosePackage>;
  submit: Invoke<typeof IPC_ENDPOINTS.skills.submit>;
  listInstalled: Invoke<typeof IPC_ENDPOINTS.skills.listInstalled>;
  install: Invoke<typeof IPC_ENDPOINTS.skills.install>;
  uninstall: Invoke<typeof IPC_ENDPOINTS.skills.uninstall>;
  setEnabled: Invoke<typeof IPC_ENDPOINTS.skills.setEnabled>;
}

export interface HostedSitesDesktopApi {
  list: Invoke<typeof IPC_ENDPOINTS.hostedSites.list>;
  chooseDirectory: Invoke<typeof IPC_ENDPOINTS.hostedSites.chooseDirectory>;
  publish: Invoke<typeof IPC_ENDPOINTS.hostedSites.publish>;
  replace: Invoke<typeof IPC_ENDPOINTS.hostedSites.replace>;
  delete: Invoke<typeof IPC_ENDPOINTS.hostedSites.delete>;
}

/**
 * The user's own model endpoints. `save` and `delete` both answer with the whole list plus how the
 * provider restart went, so the renderer replaces its snapshot in one write and can say honestly
 * whether the models are on their way.
 */
export interface CustomProvidersDesktopApi {
  list: Invoke<typeof IPC_ENDPOINTS.customProviders.list>;
  save: Invoke<typeof IPC_ENDPOINTS.customProviders.save>;
  delete: Invoke<typeof IPC_ENDPOINTS.customProviders.delete>;
}

/**
 * Storage and files of one host. Every method names its server, because the settings modal can be
 * open for a server the user has not switched to. A remote host without `storage-v1` answers null.
 */
export interface StorageDesktopApi {
  getUsage: (input: GetStorageUsageInput, serverId: string) => Promise<StorageUsage | null>;
  deleteFile: (input: DeleteStoredFileInput, serverId: string) => Promise<void>;
  clear: (input: ClearStorageInput, serverId: string) => Promise<void>;
  openFile: (input: OpenStoredFileInput, serverId: string) => Promise<void>;
  /** Opens an agent workspace folder. Only the local host has a folder this computer can open. */
  openLocation: Invoke<typeof IPC_ENDPOINTS.storage.openLocation>;
}

/**
 * Agent import into the local host. `choose` opens the file dialog and answers null when the user
 * cancels. A token is used once: `apply` and `discard` both release the staged archive.
 */
export interface AgentImportDesktopApi {
  choose: Invoke<typeof IPC_ENDPOINTS.agentImport.choose>;
  apply: Invoke<typeof IPC_ENDPOINTS.agentImport.apply>;
  discard: Invoke<typeof IPC_ENDPOINTS.agentImport.discard>;
}

export interface OpenBotDesktopApi {
  getAppInfo: Invoke<typeof IPC_ENDPOINTS.app.getAppInfo>;
  getSetupState: Invoke<typeof IPC_ENDPOINTS.app.getSetupState>;
  saveSetup: Invoke<typeof IPC_ENDPOINTS.app.saveSetup>;
  getAnalyticsPreference: Invoke<typeof IPC_ENDPOINTS.app.getAnalyticsPreference>;
  setAnalyticsPreference: Invoke<typeof IPC_ENDPOINTS.app.setAnalyticsPreference>;
  getApprovalAutomation: Invoke<typeof IPC_ENDPOINTS.app.getApprovalAutomation>;
  setApprovalAutomation: Invoke<typeof IPC_ENDPOINTS.app.setApprovalAutomation>;
  getAppLanguagePreference: Invoke<typeof IPC_ENDPOINTS.app.getAppLanguagePreference>;
  setAppLanguagePreference: Invoke<typeof IPC_ENDPOINTS.app.setAppLanguagePreference>;
  onAppLanguagePreference: Subscribe<typeof IPC_ENDPOINTS.app.appLanguagePreference>;
  onOpenSettings: Subscribe<typeof IPC_ENDPOINTS.app.openSettings>;
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
  openExternal: Invoke<typeof IPC_ENDPOINTS.app.openExternal>;
  connectProvider: Invoke<typeof IPC_ENDPOINTS.providers.connectProvider>;
  refreshAgentProviders: Invoke<typeof IPC_ENDPOINTS.providers.refreshAgentProviders>;
  /**
   * Runs the provider CLI's own updater, for a CLI the user installed themselves. It is their copy,
   * so the version they end on is whatever that updater fetches, which owes nothing to the version
   * OpenBot pins for the runtime it manages.
   */
  updateProviderCli: Invoke<typeof IPC_ENDPOINTS.providers.updateProviderCli>;
  /**
   * Stores the optional API key a provider's paid catalog needs, and reconnects the provider.
   *
   * The key only ever travels towards main. There is no getter for it, and
   * `getProviderApiKeyState` answers with a status, because a renderer that can read a key back
   * puts it in every crash report, export and screenshot that follows.
   */
  setProviderApiKey: Invoke<typeof IPC_ENDPOINTS.providers.setProviderApiKey>;
  clearProviderApiKey: Invoke<typeof IPC_ENDPOINTS.providers.clearProviderApiKey>;
  getProviderApiKeyState: Invoke<typeof IPC_ENDPOINTS.providers.getProviderApiKeyState>;
  /**
   * Starts a sign-in the user finishes on another device, for a provider whose descriptor says
   * `codeSignIn`. Cancel it with `cancelProviderCodeLogin`; leaving it running holds one provider
   * process open until the code expires.
   */
  startProviderCodeLogin: Invoke<typeof IPC_ENDPOINTS.providers.startProviderCodeLogin>;
  /** Abandons a code sign-in: the provider is told, the code is dead, and the provider goes idle. */
  cancelProviderCodeLogin: Invoke<typeof IPC_ENDPOINTS.providers.cancelProviderCodeLogin>;
  providerRuntimes: ProviderRuntimesDesktopApi;
  openUrl: Invoke<typeof IPC_ENDPOINTS.app.openUrl>;
  voice: VoiceDesktopApi;
  skills: SkillsDesktopApi;
  customProviders: CustomProvidersDesktopApi;
  storage: StorageDesktopApi;
  agentImport: AgentImportDesktopApi;
  hostedSites: HostedSitesDesktopApi;
  marketplaceAgents: MarketplaceAgentsDesktopApi;
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
