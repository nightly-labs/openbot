import type { AppLanguagePreference, SetAppLanguagePreferenceInput } from "./app-language";
import type { AgentAnalytics, AgentAnalyticsInput } from "./ipc-agent-analytics";
import type { AgentEvent, ScopedAgentEvent } from "./ipc-agent-events";
import type { AgentModelOption } from "./ipc-agent-identity";
import type {
  AgentProfileDraft,
  GenerateAgentProfileInput,
  SaveAgentProfileInput,
  SaveAgentProfileResult,
} from "./ipc-agent-profile";
import type { AccountUsage, AgentProviderId, AgentStatus } from "./ipc-agent-status";
import type {
  AgentSummary,
  CreateAgentInput,
  DuplicateAgentResult,
  SetAgentAvatarInput,
  UpdateAgentInput,
} from "./ipc-agents";
import type {
  AnalyticsPreference,
  AppInfo,
  AppSetupState,
  CentralAuthDesktopApi,
  ComputerUseHighlightPlacement,
  ComputerUsePermissionApp,
  ComputerUseState,
  ExternalDestination,
  MacPermissionId,
  ProviderRuntimeSnapshot,
  SaveSetupInput,
  SetAnalyticsPreferenceInput,
  UpdatePreference,
  UpdateStatus,
} from "./ipc-app-auth";
import type {
  ApprovalAutomationPreference,
  RespondToApprovalInput,
  RespondToBrowserTakeoverInput,
  SetApprovalAutomationInput,
} from "./ipc-approvals";
import type {
  AttachmentImportEvent,
  ChooseAttachmentsInput,
  DownloadAttachmentsInput,
  DraftAttachment,
  FilePreview,
  OpenAttachmentInput,
  OpenSharedFileInput,
  OpenWorkspaceFileInput,
} from "./ipc-attachments";
import type {
  BrowserBounds,
  BrowserControlState,
  BrowserDisplayState,
  BrowserLiveViewEvent,
  BrowserLiveViewInput,
  BrowserNavigateInput,
  BrowserOpenInput,
  BrowserPictureInPictureEvent,
  BrowserPreview,
  BrowserTab,
  BrowserVisibilityInput,
} from "./ipc-browser";
import type { RespondToBrowserSecretInput } from "./ipc-browser-secret";
import type { Channel, ChannelCommand, ChannelPage, ChannelReadInput, ChannelSummary } from "./ipc-chat-channels";
import type {
  ConversationPage,
  ConversationReadState,
  ConversationSearchPage,
  ConversationWithReadState,
  MarkConversationReadInput,
  ReadConversationPageInput,
  RespondToPromptInput,
  SearchConversationMessagesInput,
  SendMessageInput,
  SetMessageReactionInput,
} from "./ipc-conversations";
import type {
  DynamicIslandAction,
  DynamicIslandGeometry,
  DynamicIslandPreference,
  DynamicIslandPresentation,
  SetDynamicIslandInteractiveInput,
  SetDynamicIslandPreferenceInput,
} from "./ipc-dynamic-island";
import type { Invoke, IPC_ENDPOINTS, Subscribe } from "./ipc-endpoints";
import type { HostAnalytics, HostAnalyticsInput } from "./ipc-host-analytics";
import type {
  AgentPublicationPreview,
  AgentSubmission,
  InstallMarketplaceAgentInput,
  InstallMarketplaceAgentResult,
  MarketplaceAgentDetail,
  MarketplaceAgentPage,
  MarketplaceAgentQuery,
  SubmitMarketplaceAgentInput,
} from "./ipc-marketplace-agents";
import type {
  McpServerConfig,
  McpTestResult,
  RemoveMcpServerInput,
  SaveMcpServerInput,
  SetMcpServerEnabledInput,
  TestMcpServerInput,
} from "./ipc-mcp-servers";
import type { NotificationOpenedEvent, NotificationPreference } from "./ipc-notifications";
import type {
  AcknowledgeFailedTurnInput,
  CancelQueuedMessageInput,
  InterruptTurnInput,
  QueuedMessageReceipt,
  QueueSnapshot,
  ReorderQueueInput,
  SteerQueuedMessageInput,
  UpdateQueuedMessageInput,
} from "./ipc-queue";
import type {
  RemoteDesktopSetupAction,
  RemoteDesktopSetupStatus,
  RemoteDesktopTestInput,
  RemoteDesktopTestStatus,
} from "./ipc-remote-desktop-setup";
import type { SidebarLayoutAction, SidebarLayoutSnapshot } from "./ipc-sidebar-layout";
import type {
  CreateLocalSkillInput,
  InstalledSkill,
  InstallSkillInput,
  LocalSkillRevisionInput,
  MarketplaceSkillDetail,
  MarketplaceSkillPage,
  MarketplaceSkillQuery,
  ReviseLocalSkillInput,
  SetEnabledSkillInput,
  SkillPackagePreview,
  SkillSubmission,
  SubmitSkillInput,
  UninstallSkillInput,
} from "./ipc-skills";
import type {
  ClearStorageInput,
  DeleteStoredFileInput,
  GetStorageUsageInput,
  OpenStorageLocationInput,
  OpenStoredFileInput,
  StorageUsage,
} from "./ipc-storage";
import type {
  ConfigureHostInput,
  CreateTeamInviteInput,
  DirectConversationPage,
  DirectConversationReadState,
  DirectConversationSnapshot,
  DirectMessage,
  DirectMessageRealtimeEvent,
  DirectThreadSummary,
  DirectTypingInput,
  DirectTypingRealtimeEvent,
  HostStatus,
  InvitePreview,
  InviteSummary,
  JoinServerInput,
  LoginServerInput,
  MarkDirectReadInput,
  ReadDirectConversationPageInput,
  RemoteDesktopConnectInput,
  RemoteDesktopConnectResult,
  RemoteDesktopSelectDisplayInput,
  RemoteDesktopSession,
  ReorderServersInput,
  SendDirectMessageInput,
  ServerSummary,
  SetServerMutedInput,
  SetServerNotificationLevelInput,
  SetTeamTypingInput,
  TeamInviteSummary,
  TeamMemberSummary,
  TeamPresenceSnapshot,
  TeamSessionSummary,
  UpdateHostIdentityInput,
  UpdateTeamMemberInput,
} from "./ipc-team-host";
import type { QueueEditRequest } from "./team-protocol/queue-edit-v1";

export interface AgentDesktopApi {
  listChannels: () => Promise<ChannelSummary[]>;
  readChannel: (input: ChannelReadInput) => Promise<ChannelPage>;
  channelCommand: (input: ChannelCommand) => Promise<Channel>;
  deleteChannel: (channelId: string) => Promise<void>;
  getStatus: () => Promise<AgentStatus>;
  getAnalytics: (input: AgentAnalyticsInput, serverId: string) => Promise<AgentAnalytics | null>;
  getHostAnalytics: (input: HostAnalyticsInput, serverId: string) => Promise<HostAnalytics | null>;
  getUsage: (agentId?: string) => Promise<AccountUsage>;
  listModels: () => Promise<AgentModelOption[]>;
  listAgents: (serverId?: string) => Promise<AgentSummary[]>;
  listInstalledSkills: (agentId: string) => Promise<InstalledSkill[]>;
  getSidebarLayout: () => Promise<SidebarLayoutSnapshot>;
  mutateSidebarLayout: (action: SidebarLayoutAction) => Promise<SidebarLayoutSnapshot>;
  generateProfile: (input: GenerateAgentProfileInput) => Promise<AgentProfileDraft>;
  saveProfile: (input: SaveAgentProfileInput) => Promise<SaveAgentProfileResult>;
  createAgent: (input: CreateAgentInput) => Promise<AgentSummary>;
  duplicateAgent: (agentId: string) => Promise<DuplicateAgentResult>;
  updateAgent: (input: UpdateAgentInput) => Promise<AgentSummary>;
  setAvatar: (input: SetAgentAvatarInput) => Promise<AgentSummary>;
  deleteAgent: (agentId: string) => Promise<void>;
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
  readConversation: (agentId: string) => Promise<ConversationWithReadState>;
  readConversationPage: (input: ReadConversationPageInput, serverId?: string) => Promise<ConversationPage>;
  searchConversationMessages: (input: SearchConversationMessagesInput) => Promise<ConversationSearchPage>;
  listConversationReads: () => Promise<Record<string, ConversationReadState>>;
  markConversationRead: (input: MarkConversationReadInput, serverId?: string) => Promise<ConversationReadState>;
  chooseAttachments: (input: ChooseAttachmentsInput) => Promise<DraftAttachment[]>;
  onAttachmentImport: (listener: (event: AttachmentImportEvent) => void) => () => void;
  discardDraftAttachment: (attachmentId: string, serverId?: string) => Promise<void>;
  downloadAttachments: (input: DownloadAttachmentsInput) => Promise<void>;
  openAttachment: (input: OpenAttachmentInput) => Promise<void>;
  openSharedFile: (input: OpenSharedFileInput) => Promise<void>;
  openWorkspaceFile: (input: OpenWorkspaceFileInput) => Promise<void>;
  previewSharedFile: (input: OpenSharedFileInput) => Promise<FilePreview>;
  previewWorkspaceFile: (input: OpenWorkspaceFileInput) => Promise<FilePreview>;
  sendMessage: (input: SendMessageInput, serverId?: string) => Promise<QueuedMessageReceipt>;
  setMessageReaction: (input: SetMessageReactionInput) => Promise<void>;
  listQueue: (agentId: string) => Promise<QueueSnapshot>;
  acknowledgeFailedTurn: (input: AcknowledgeFailedTurnInput) => Promise<void>;
  cancelQueuedMessage: (input: CancelQueuedMessageInput) => Promise<void>;
  steerQueuedMessage: (input: SteerQueuedMessageInput) => Promise<void>;
  editQueuedMessage: (input: QueueEditRequest & { agentId: string }, serverId?: string) => Promise<QueueSnapshot>;
  updateQueuedMessage: (input: UpdateQueuedMessageInput, serverId?: string) => Promise<void>;
  reorderQueue: (input: ReorderQueueInput) => Promise<void>;
  interrupt: (input: InterruptTurnInput) => Promise<void>;
  respondToPrompt: (input: RespondToPromptInput) => Promise<void>;
  respondToApproval: (input: RespondToApprovalInput) => Promise<void>;
  respondToBrowserSecret: (input: RespondToBrowserSecretInput) => Promise<void>;
  respondToBrowserTakeover: (input: RespondToBrowserTakeoverInput) => Promise<void>;
  onEvent: (listener: (event: AgentEvent) => void) => () => void;
  onScopedEvent: (listener: (event: ScopedAgentEvent) => void) => () => void;
}

export interface MarketplaceAgentsDesktopApi {
  list: (query?: MarketplaceAgentQuery) => Promise<MarketplaceAgentPage>;
  get: (agentId: string) => Promise<MarketplaceAgentDetail>;
  listMine: () => Promise<AgentSubmission[]>;
  preview: (agentId: string) => Promise<AgentPublicationPreview>;
  submit: (input: SubmitMarketplaceAgentInput) => Promise<AgentSubmission>;
  install: (input: InstallMarketplaceAgentInput) => Promise<InstallMarketplaceAgentResult>;
}

export interface BrowserDesktopApi {
  open: (input: BrowserOpenInput) => Promise<BrowserTab>;
  activate: (tabId: string) => Promise<void>;
  navigate: (input: BrowserNavigateInput) => Promise<void>;
  reload: (tabId: string) => Promise<void>;
  close: (tabId: string) => Promise<void>;
  listTabs: () => Promise<BrowserTab[]>;
  getDisplayState: () => Promise<BrowserDisplayState>;
  getControlState: () => Promise<BrowserControlState>;
  capturePreview: (tabId: string) => Promise<BrowserPreview>;
  setVisible: (input: BrowserVisibilityInput) => Promise<void>;
  /** Starts a live view of a tab on the active remote server. A local tab is already on screen. */
  startLiveView: (tabId: string) => Promise<void>;
  stopLiveView: () => Promise<void>;
  sendLiveViewInput: (input: BrowserLiveViewInput) => Promise<void>;
  onLiveViewEvent: (listener: (event: BrowserLiveViewEvent) => void) => () => void;
  onDisplayState: (listener: (state: BrowserDisplayState) => void) => () => void;
  openPictureInPicture: (bounds?: BrowserBounds) => Promise<BrowserBounds>;
  closePictureInPicture: () => Promise<void>;
  dockPictureInPicture: () => Promise<void>;
  hidePictureInPicture: () => Promise<void>;
  onPictureInPictureEvent: (listener: (event: BrowserPictureInPictureEvent) => void) => () => void;
}

export interface UpdateDesktopApi {
  getStatus: () => Promise<UpdateStatus>;
  check: () => Promise<UpdateStatus>;
  download: () => Promise<UpdateStatus>;
  install: () => Promise<void>;
  getPreference: () => Promise<UpdatePreference>;
  setPreference: (input: UpdatePreference) => Promise<UpdatePreference>;
  onEvent: (listener: (status: UpdateStatus) => void) => () => void;
}

export interface NotificationsDesktopApi {
  getPreference: () => Promise<NotificationPreference>;
  setPreference: (input: NotificationPreference) => Promise<NotificationPreference>;
  // Shows one OS notification now, even when the window has focus, so the user can check that the
  // operating system lets OpenBot show them.
  test: () => Promise<void>;
  // Opens the operating system page where the user allows OpenBot notifications. It rejects on a
  // system that has no such page.
  openSettings: () => Promise<void>;
  onOpened: (listener: (event: NotificationOpenedEvent) => void) => () => void;
}

export interface SetProviderApiKeyInput {
  provider: AgentProviderId;
  key: string;
}

/**
 * Whether a key is stored. `unreadable` is a key file OpenBot could not decrypt or parse: the
 * provider then runs with no key, and the file stays on disk until the user replaces or removes it.
 */
export type ProviderApiKeyStatus = "missing" | "saved" | "unreadable";

/** What the renderer may know about a stored key: its status. Never the key. */
export interface ProviderApiKeyState {
  provider: AgentProviderId;
  status: ProviderApiKeyStatus;
}

/**
 * What a started code sign-in gives the renderer: a code to show, or nothing left to do.
 *
 * `connected` is the provider that turned out to be signed in already, which the user reaches by
 * asking for a code on a computer where the account arrived some other way. The token traded for
 * the code never crosses this boundary; how the sign-in ends arrives as a provider status, the same
 * way the browser sign-in's does.
 */
export type ProviderCodeLoginStart =
  | {
      kind: "code";
      /** The one-time code the user types on the other device. Safe to show and to read out. */
      userCode: string;
      /** The page to type it on. Always https. */
      verificationUrl: string;
      /** Epoch milliseconds. When OpenBot gives up on this code, which is what the dialog counts down to. */
      expiresAt: number;
    }
  | { kind: "connected" };

export interface ProviderRuntimesDesktopApi {
  getStatus: () => Promise<ProviderRuntimeSnapshot>;
  download: (provider: AgentProviderId) => Promise<ProviderRuntimeSnapshot>;
  cancel: (provider: AgentProviderId) => Promise<ProviderRuntimeSnapshot>;
  /** Asks each provider's upstream for its latest release. Rejects when no source answered. */
  checkForUpdates: () => Promise<ProviderRuntimeSnapshot>;
  onEvent: (listener: (snapshot: ProviderRuntimeSnapshot) => void) => () => void;
}

export interface MaintenanceDesktopApi {
  exportData: Invoke<typeof IPC_ENDPOINTS.maintenance.exportData>;
  exportDiagnostics: Invoke<typeof IPC_ENDPOINTS.maintenance.exportDiagnostics>;
}

export interface DynamicIslandDesktopApi {
  getPreference: () => Promise<DynamicIslandPreference>;
  setPreference: (input: SetDynamicIslandPreferenceInput) => Promise<DynamicIslandPreference>;
  publishPresentation: (presentation: DynamicIslandPresentation) => Promise<void>;
  getPresentation: () => Promise<DynamicIslandPresentation>;
  onPreference: (listener: (preference: DynamicIslandPreference) => void) => () => void;
  onPresentation: (listener: (presentation: DynamicIslandPresentation) => void) => () => void;
  onGeometry: (listener: (geometry: DynamicIslandGeometry) => void) => () => void;
  performAction: (action: DynamicIslandAction) => Promise<void>;
  performHaptic: () => Promise<void>;
  onAction: (listener: (action: DynamicIslandAction) => void) => () => void;
  setInteractive: (input: SetDynamicIslandInteractiveInput) => Promise<void>;
}

export interface ServersDesktopApi {
  setMuted: (input: SetServerMutedInput) => Promise<ServerSummary[]>;
  setNotificationLevel: (input: SetServerNotificationLevelInput) => Promise<ServerSummary[]>;
  list: () => Promise<ServerSummary[]>;
  select: (serverId: string) => Promise<ServerSummary[]>;
  reorder: (input: ReorderServersInput) => Promise<ServerSummary[]>;
  join: (input: JoinServerInput) => Promise<ServerSummary>;
  previewInvite: (input: JoinServerInput) => Promise<InvitePreview>;
  takePendingInvite: () => Promise<string | null>;
  login: (input: LoginServerInput) => Promise<ServerSummary>;
  retryConnection: (serverId: string) => Promise<ServerSummary>;
  remove: (serverId: string) => Promise<void>;
  getPresence: () => Promise<TeamPresenceSnapshot>;
  getPresenceFor: (serverId: string) => Promise<TeamPresenceSnapshot>;
  refreshIdentity: (serverId: string) => Promise<ServerSummary>;
  listMembers: (serverId: string) => Promise<TeamMemberSummary[]>;
  updateMember: (serverId: string, input: UpdateTeamMemberInput) => Promise<TeamMemberSummary>;
  removeMember: (serverId: string, memberId: string) => Promise<void>;
  listInvites: (serverId: string) => Promise<TeamInviteSummary[]>;
  revokeInvite: (serverId: string, inviteId: string) => Promise<void>;
  createInvite: (serverId: string, input: CreateTeamInviteInput) => Promise<InviteSummary>;
  setTyping: (input: SetTeamTypingInput) => Promise<void>;
  onPresence: (listener: (snapshot: TeamPresenceSnapshot) => void, serverId?: string) => () => void;
  listDirectThreads: () => Promise<DirectThreadSummary[]>;
  readDirectConversation: (memberId: string) => Promise<DirectConversationSnapshot>;
  readDirectConversationPage: (input: ReadDirectConversationPageInput) => Promise<DirectConversationPage>;
  sendDirectMessage: (input: SendDirectMessageInput) => Promise<DirectMessage>;
  markDirectRead: (input: MarkDirectReadInput) => Promise<DirectConversationReadState>;
  setDirectTyping: (input: DirectTypingInput) => Promise<void>;
  onDirectMessage: (listener: (event: DirectMessageRealtimeEvent) => void) => () => void;
  onDirectTyping: (listener: (event: DirectTypingRealtimeEvent) => void) => () => void;
  onEvent: (listener: (servers: ServerSummary[]) => void) => () => void;
  onInvite: (listener: (inviteUrl: string) => void) => () => void;
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
  getStatus: () => Promise<HostStatus>;
  configure: (input: ConfigureHostInput) => Promise<HostStatus>;
  updateIdentity: (input: UpdateHostIdentityInput) => Promise<HostStatus>;
  getPresence: () => Promise<TeamPresenceSnapshot>;
  start: () => Promise<HostStatus>;
  stop: () => Promise<HostStatus>;
  /**
   * Asks the screen sharing runtime again whether the operating system lets it record, and answers
   * the status that holds the result.
   *
   * The refusal is remembered, because the runtime that reported it is dropped so that the next
   * attempt reads a new grant. Without this call only another member's attempt could clear it, and
   * the host owner who just gave the grant would keep reading that they had not.
   */
  recheckScreenRecording: () => Promise<HostStatus>;
  listMembers: () => Promise<TeamMemberSummary[]>;
  updateMember: (input: UpdateTeamMemberInput) => Promise<TeamMemberSummary>;
  removeMember: (memberId: string) => Promise<void>;
  listSessions: () => Promise<TeamSessionSummary[]>;
  revokeSession: (sessionId: string) => Promise<void>;
  listInvites: () => Promise<TeamInviteSummary[]>;
  revokeInvite: (inviteId: string) => Promise<void>;
  createInvite: (input: CreateTeamInviteInput) => Promise<InviteSummary>;
  onEvent: (listener: (status: HostStatus) => void) => () => void;
}

export interface RemoteDesktopDesktopApi {
  checkSetup: (serverId: string) => Promise<RemoteDesktopSetupStatus>;
  openSetup: (action: RemoteDesktopSetupAction) => Promise<void>;
  test: (input: RemoteDesktopTestInput) => Promise<RemoteDesktopTestStatus>;
  list: () => Promise<RemoteDesktopSession[]>;
  connect: (input: RemoteDesktopConnectInput) => Promise<RemoteDesktopConnectResult>;
  selectDisplay: (input: RemoteDesktopSelectDisplayInput) => Promise<void>;
  disconnect: (sessionId: string) => Promise<void>;
  onEvent: (listener: (sessions: RemoteDesktopSession[]) => void) => () => void;
}

export interface VoiceDesktopApi {
  getModelStatus: Invoke<typeof IPC_ENDPOINTS.voice.getModelStatus>;
  prepareModel: Invoke<typeof IPC_ENDPOINTS.voice.prepareModel>;
  transcribe: Invoke<typeof IPC_ENDPOINTS.voice.transcribe>;
  onModelStatus: Subscribe<typeof IPC_ENDPOINTS.voice.modelStatus>;
}

export interface SkillsDesktopApi {
  localList: () => Promise<MarketplaceSkillDetail[]>;
  localGet: (input: LocalSkillRevisionInput) => Promise<MarketplaceSkillDetail>;
  localCreate: (input: CreateLocalSkillInput) => Promise<MarketplaceSkillDetail>;
  localRevise: (input: ReviseLocalSkillInput) => Promise<MarketplaceSkillDetail>;
  localInstall: (input: LocalSkillRevisionInput & { agentId: string; revision: number }) => Promise<InstalledSkill>;

  list: (query?: MarketplaceSkillQuery) => Promise<MarketplaceSkillPage>;
  get: (skillId: string) => Promise<MarketplaceSkillDetail>;
  listMine: () => Promise<SkillSubmission[]>;
  choosePackage: () => Promise<SkillPackagePreview | null>;
  submit: (input: SubmitSkillInput) => Promise<SkillSubmission>;
  listInstalled: (agentId: string) => Promise<InstalledSkill[]>;
  install: (input: InstallSkillInput) => Promise<InstalledSkill>;
  uninstall: (input: UninstallSkillInput) => Promise<void>;
  setEnabled: (input: SetEnabledSkillInput) => Promise<InstalledSkill>;
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
  openLocation: (input: OpenStorageLocationInput) => Promise<void>;
}

export interface OpenBotDesktopApi {
  getAppInfo: () => Promise<AppInfo>;
  getSetupState: () => Promise<AppSetupState>;
  saveSetup: (input: SaveSetupInput) => Promise<AppSetupState>;
  getAnalyticsPreference: () => Promise<AnalyticsPreference>;
  setAnalyticsPreference: (input: SetAnalyticsPreferenceInput) => Promise<AnalyticsPreference>;
  getApprovalAutomation: () => Promise<ApprovalAutomationPreference>;
  setApprovalAutomation: (input: SetApprovalAutomationInput) => Promise<ApprovalAutomationPreference>;
  getAppLanguagePreference: () => Promise<AppLanguagePreference>;
  setAppLanguagePreference: (input: SetAppLanguagePreferenceInput) => Promise<AppLanguagePreference>;
  onAppLanguagePreference: (listener: (preference: AppLanguagePreference) => void) => () => void;
  onOpenSettings: (listener: () => void) => () => void;
  dynamicIsland: DynamicIslandDesktopApi;
  getComputerUseState: () => Promise<ComputerUseState>;
  openComputerUsePermissionPane: (permission: MacPermissionId) => Promise<ComputerUseState>;
  closeComputerUsePermissionHelp: () => Promise<void>;
  getComputerUsePermissionApp: () => Promise<ComputerUsePermissionApp | null>;
  /** Starts the native drag. Only the help window may call it; every other sender is refused. */
  startComputerUsePermissionAppDrag: () => Promise<void>;
  revealComputerUsePermissionApp: () => Promise<void>;
  /**
   * Where to draw the rim over the window an agent works in. Only the overlay surface listens.
   *
   * It is pushed rather than asked for: the overlay carries no control and invokes nothing, so a
   * window that floats over another application's has no channel it could be driven through.
   */
  onComputerUseHighlightPlacement: (listener: (placement: ComputerUseHighlightPlacement) => void) => () => void;
  openExternal: (destination: ExternalDestination) => Promise<void>;
  connectProvider: (provider: AgentProviderId) => Promise<AgentStatus>;
  refreshAgentProviders: () => Promise<AgentStatus>;
  /**
   * Runs the provider CLI's own updater, for a CLI the user installed themselves. It is their copy,
   * so the version they end on is whatever that updater fetches, which owes nothing to the version
   * OpenBot pins for the runtime it manages.
   */
  updateProviderCli: (provider: AgentProviderId) => Promise<AgentStatus>;
  /**
   * Stores the optional API key a provider's paid catalog needs, and reconnects the provider.
   *
   * The key only ever travels towards main. There is no getter for it, and
   * `getProviderApiKeyState` answers with a status, because a renderer that can read a key back
   * puts it in every crash report, export and screenshot that follows.
   */
  setProviderApiKey: (input: SetProviderApiKeyInput) => Promise<AgentStatus>;
  clearProviderApiKey: (provider: AgentProviderId) => Promise<AgentStatus>;
  getProviderApiKeyState: (provider: AgentProviderId) => Promise<ProviderApiKeyState>;
  /**
   * Starts a sign-in the user finishes on another device, for a provider whose descriptor says
   * `codeSignIn`. Cancel it with `cancelProviderCodeLogin`; leaving it running holds one provider
   * process open until the code expires.
   */
  startProviderCodeLogin: (provider: AgentProviderId) => Promise<ProviderCodeLoginStart>;
  /** Abandons a code sign-in: the provider is told, the code is dead, and the provider goes idle. */
  cancelProviderCodeLogin: (provider: AgentProviderId) => Promise<AgentStatus>;
  providerRuntimes: ProviderRuntimesDesktopApi;
  openUrl: (url: string) => Promise<void>;
  voice: VoiceDesktopApi;
  skills: SkillsDesktopApi;
  customProviders: CustomProvidersDesktopApi;
  storage: StorageDesktopApi;
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
