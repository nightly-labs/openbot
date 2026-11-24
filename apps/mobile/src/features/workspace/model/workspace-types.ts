import type { AttachmentSupport } from "@openbot/contracts/attachment-files";
import type {
  AddAgentFolderInput,
  AddedAgent,
  AddMessagingOrchestratorResult,
  AgentAccessChange,
  AgentAccessSnapshot,
  AgentAdminSettings,
  AgentAnalytics,
  AgentAnalyticsInput,
  AgentBackupModelSettings,
  AgentBrowserProfile,
  AgentBuiltinMemorySettings,
  AgentDefaultsOverview,
  AgentExclusionChange,
  AgentFolderBrowse,
  AgentFolderChange,
  AgentFolderInput,
  AgentFolderList,
  AgentHostSettings,
  AgentImportPreview,
  AgentInstructionsFile,
  AgentMemory,
  AgentMemorySelectionState,
  AgentModelId,
  AgentModelOption,
  AgentNewChatSettings,
  AgentNotificationLevelsSnapshot,
  AgentPlanCardSettings,
  AgentProviderId,
  AgentReasoningEffort,
  AgentSessionSettings,
  AgentSpeedSettings,
  AgentTask,
  AgentTaskInput,
  AgentTaskLimitSettings,
  AgentTaskReadState,
  AgentTasksSnapshot,
  AgentTemplatePreview,
  AgentTemplatePublication,
  AnswerWhatsAppRequestInput,
  ApplyAgentImportInput,
  ApplyInstanceTransferInput,
  AskSideQuestionInput,
  AvatarColor,
  AvatarHue,
  AvatarImageInput,
  BackgroundProcess,
  BitwardenConnectorStatus,
  BitwardenHostConnectInput,
  BranchAgentTaskInput,
  BrowserProfileList,
  BrowserProfileSummary,
  BrowserProxyList,
  BrowserProxySummary,
  ChannelFolderChange,
  ChannelFolderInput,
  ChannelFolderList,
  ClearableStorageCategory,
  ClearBrowserDataInput,
  ConnectorMessagingPlatform,
  ConversationFileSearchPage,
  ConversationSearchPage,
  ConversationSnapshot,
  CreateRoutineInput,
  CreateWorkflowInput,
  DecideWorkflowStepInput,
  DeleteBrowserProxyInput,
  DraftAttachment,
  ExportInstanceInput,
  ForeignProviderId,
  GitHubConnectorRepositories,
  HostAddMessagingOrchestratorInput,
  HostAgentMemoryLimit,
  HostAnalytics,
  HostAnalyticsInput,
  HostBrowsingMemory,
  HostedSiteList,
  HostGitHubConnectorStatus,
  HostMemoryReview,
  HostMessagingConnectInput,
  HostMessagingWorkspaceInput,
  HostPersonality,
  HostProviderAccounts,
  HostReleaseStatus,
  HostSetMessagingEnabledInput,
  HostSignalHomeSettings,
  HostSkillLearning,
  HostTimezoneSettings,
  HostUpdateSettingsChange,
  HostUpdateStatus,
  HostVoiceModel,
  HostVoiceModelChange,
  InstallAgentTemplateInput,
  InstalledSkill,
  InstallMarketplaceAgentInput,
  InstallSkillInput,
  InstanceTransferPreview,
  InstanceTransferSummary,
  LibraryFolderAction,
  LibraryFoldersSnapshot,
  MachineMetrics,
  MarkAgentTaskReadInput,
  McpAccessSnapshot,
  McpServerConfig,
  McpSignInState,
  McpTestResult,
  MessagingOverview,
  MessagingWorkspaceInput,
  OnePasswordConnectorStatus,
  PasswordManagerConnectInput,
  PasswordManagerId,
  PasswordManagerStatus,
  PinnedMessagesSnapshot,
  QueuedMessageReceipt,
  QueueSnapshot,
  RemoteAgentImportResult,
  RemoteInstanceTransferResult,
  RemoveWhatsAppSenderInput,
  RenameWorkflowInput,
  ResetAgentSessionSettingInput,
  RespondToApprovalInput,
  RespondToBrowserSecretInput,
  RespondToPromptInput,
  Routine,
  RoutineCalendar,
  RoutineCalendarInput,
  RoutineCalendarOwner,
  RoutineResultConnectionOption,
  RoutineResultDestination,
  RoutineResultRoutineInput,
  SaveAgentInstructionsInput,
  SaveBrowserProxyInput,
  SaveWorkflowGraphInput,
  ServerAuditLog,
  ServerNotificationLevel,
  SetAgentDefaultChoiceInput,
  SetAgentMemoryInclusionInput,
  SetAgentNotificationLevelInput,
  SetAgentProviderAccountInput,
  SetAgentSessionSettingInput,
  SetBrowserProfileProxyInput,
  SetEnabledSkillInput,
  SetMcpAccessInput,
  SetMessagePinnedInput,
  SetMessagingEnabledInput,
  SetRoutineResultDestinationInput,
  SetWhatsAppOwnNumberInput,
  SetWhatsAppSenderReadOnlyInput,
  SetWhatsAppStatusReactionsInput,
  SetWhatsAppWorkingMessageInput,
  SetWorkflowPausedInput,
  SharedTable,
  SidebarLayoutAction,
  SidebarLayoutSnapshot,
  SidebarPin,
  SignInRelayStatus,
  StartWhatsAppLinkInput,
  StorageDisk,
  StorageUsage,
  UninstallSkillInput,
  UpdateAgentAdminSettingsInput,
  UpdateAgentBackupModelsInput,
  UpdateAgentBrowserProfileInput,
  UpdateAgentBuiltinMemoryInput,
  UpdateAgentDefaultsInput,
  UpdateAgentHostSettingsInput,
  UpdateAgentInput,
  UpdateAgentNewChatInput,
  UpdateAgentPlanCardInput,
  UpdateAgentSpeedInput,
  UpdateAgentTaskLimitInput,
  UpdateBrowserProfileInput,
  UpdateRestartMode,
  UpdateRoutineInput,
  VaultHostImportResult,
  VaultSaveInput,
  VaultState,
  VaultTwoStepCodes,
  WhatsAppGroupList,
  WhatsAppLinkState,
  WhatsAppOverview,
  WhatsAppSenderInput,
  WorkflowDetail,
  WorkflowGitHubCatalog,
  WorkflowGitHubHistory,
  WorkflowGitHubRepositoryOptions,
  WorkflowGraph,
  WorkflowMediaModel,
  WorkflowMediaPriceRequest,
  WorkflowMediaUnavailableModel,
  WorkflowRunDetail,
  WorkflowRunPage,
  WorkflowSaveResult,
  WorkflowStep,
  WorkflowSummary,
  WorkflowTriggerInput,
  WorkflowVersion,
  WorkflowVersionInput,
  WorkflowWebhookSecret,
} from "@openbot/contracts/ipc";
import type {
  AgentWebhookSecret,
  EventActivity,
  EventRoutine,
  EventRoutineOwner,
  EventRoutineRef,
  ListEventActivityInput,
  SaveEventRoutineInput,
  SaveEventRoutineResult,
  WebhookSecret,
} from "@openbot/contracts/ipc-events";
import type { ServerAppearance } from "@openbot/contracts/team-protocol/host-appearance-v1";
import type { LiveVoiceSessionResponse, LiveVoiceStartRequest } from "@openbot/contracts/team-protocol/live-voice-v1";
import type { QueueEditRequest } from "@openbot/contracts/team-protocol/queue-edit-v1";
import type { RemoteConnectionFailure, RemoteRecoveryStatus, RemoteTeamDirectoryClient } from "@openbot/team-client";
import type { PlanLimits } from "@openbot/team-client/plan-limits";
import type { RemoteDownloadWatch, RemoteFileUpload, RemoteLargeDownload } from "@openbot/team-client/remote-peer";
import type {
  HostLocalServer,
  HostLocalServerList,
  MessagingConnectorPage,
} from "@openbot/team-client/team-admin-requests";
import type { AgentExportParts } from "@openbot/team-client/team-api-requests";
import type { NewAgentInput } from "@/features/agents/model/agent-initial-message";
import type { MobileBrowserTab } from "@/features/browser/model/browser-tabs";
import type { BrowserViewBridgeEvent, RemoteBrowserViewSession } from "@/features/browser/model/browser-view-bridge";
import type { MobileChannelStore } from "@/features/channels/model/channel-store";
import type { MessageFileTarget } from "@/features/chat/model/message-file-target";
import type { ProviderAdmin } from "@/features/servers/model/provider-admin";
import type { RemoteDesktopConnection } from "@/features/workspace/components/remote-team-transport";
import type { MobileConversationStore } from "./conversation-store";
import type { LiveWorkspaceStore } from "./live-workspace-store";
import type { PendingApproval } from "./pending-approvals";

export interface WorkflowMediaModels {
  models: readonly WorkflowMediaModel[];
  unavailable?: readonly WorkflowMediaUnavailableModel[];
  partial: boolean;
}

export interface AgentExportFile extends AgentExportParts {
  readAll: () => Promise<string>;
}

type MobileServerKind = "local" | "remote";
type MessageDeleteTarget =
  | { kind: "agent"; agentId: string; taskId?: string; messageId: string }
  | { kind: "channel"; channelId: string; messageId: string };

export type ServerUpdateAccess = "admin" | "member";

export type MobileServerState = "unknown" | "connecting" | "online" | "offline" | "error";
export type MobileServerDirectoryState = "loading" | "ready" | "error";

export interface MobileServer {
  id: string;
  name: string;
  logoKey: string | null;
  appearance?: ServerAppearance | null;
  kind: MobileServerKind;
  state: MobileServerState;
  initialConnectionPending: boolean;
  connectionMessage: string | null;
  connectionFailure?: RemoteConnectionFailure | null;
  recoveryStatus?: RemoteRecoveryStatus;
  resuming?: boolean;
  address: string | null;
  accent: string;
  publicKey: string;
  membershipId: string;
  role: "owner" | "admin" | "member";
  memberLimit?: number;
  hosted?: boolean;
  storageGb?: number;
  restartAvailable?: boolean;
  keyChangedAt?: number;
}

export interface MobileAgent {
  provider?: AgentProviderId;
  foreignProvider?: ForeignProviderId | undefined;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
  notifications?: boolean;
  workspacePath?: string;
  id: string;
  serverId: string;
  name: string;
  title: string;
  description: string;
  preview: string;
  updatedLabel: string;
  updatedAt: string | null;
  avatarUrl?: string | null;
  avatarSeed: string;
  avatarHue: AvatarHue | null;
  avatarColor: AvatarColor | null;
  marketplaceSource?: { listingId: string; version: number } | undefined;
}

export type GitHubConnectorRoute = "githubStatus" | "githubConnect" | "githubCancel" | "githubDisconnect";

type ToggleAgentPinResult = "pinned" | "unpinned" | "error";

interface AddRemoteServerInput {
  inviteUrl: string;
}

export interface MobileBrowserViewSupport {
  view: boolean;
  clipboard: boolean;
  contextMenu: boolean;
  viewport: boolean;
  navigation: boolean;
}

type MobileBrowserTabAction =
  | { type: "navigate"; tabId: string; direction: "back" | "forward" }
  | { type: "reload"; tabId: string }
  | { type: "load"; tabId: string; url: string }
  | { type: "open"; url: string; ownerAgentId: string; ownerThreadId: string | null }
  | { type: "close"; tabId: string };

export interface MobileWorkspaceContextValue {
  browserViewSupport: (serverId: string) => MobileBrowserViewSupport;
  openBrowserView: (
    serverId: string,
    tabId: string,
    listener: (event: BrowserViewBridgeEvent) => void,
  ) => RemoteBrowserViewSession | null;
  controlBrowserTab: (serverId: string, action: MobileBrowserTabAction) => Promise<MobileBrowserTab | null>;
  respondToApproval: (serverId: string, input: RespondToApprovalInput) => Promise<void>;
  readsWholeApprovals: (serverId: string) => boolean;
  readWholeApproval: (serverId: string, approval: PendingApproval) => Promise<void>;
  respondToBrowserTakeover: (
    serverId: string,
    input: { requestId: string | number; decision: "complete" | "cancel" },
  ) => Promise<void>;
  respondToBrowserSecret: (serverId: string, input: RespondToBrowserSecretInput) => Promise<void>;
  sidebarByServer: Record<string, { layout: SidebarLayoutSnapshot | null; error: string | null }>;
  mutateSidebarLayout: (serverId: string, action: SidebarLayoutAction) => Promise<void>;
  moveSidebarChat: (serverId: string, action: Extract<SidebarLayoutAction, { type: "move-agent" }>) => Promise<void>;
  loadQueue: (agentId: string, serverId: string) => Promise<QueueSnapshot>;
  canEditQueue: (serverId: string) => boolean;
  canReadModelSteering: (serverId: string) => boolean;
  canRetryMessage: (serverId: string) => boolean;
  canDeleteMessages: (serverId: string) => boolean;
  canMarkUnreadFrom: (serverId: string) => boolean;
  attachmentSupport: (serverId: string) => AttachmentSupport;
  changeQueue: (
    agentId: string,
    serverId: string,
    action: "cancel" | "steer" | "reorder",
    input: { deliveryId?: string; expectedTurnId?: string; deliveryIds?: string[] },
  ) => Promise<void>;
  editQueue: (agentId: string, serverId: string, input: QueueEditRequest) => Promise<QueueSnapshot>;
  setMessageReaction: (agentId: string, serverId: string, messageId: string, emoji: string | null) => Promise<void>;
  deleteMessage: (serverId: string, target: MessageDeleteTarget) => Promise<void>;
  interruptTurn: (agentId: string, turnId: string, serverId?: string) => Promise<void>;
  channelStore: MobileChannelStore;
  servers: MobileServer[];
  reorderServers: (serverIds: string[]) => boolean;
  memberCountByServer: Readonly<Record<string, number>>;
  teamDirectory: RemoteTeamDirectoryClient;
  serverDirectoryState: MobileServerDirectoryState;
  serverDirectoryError: string | null;
  agents: MobileAgent[];
  activeServer: MobileServer;
  activeAgents: MobileAgent[];
  hiddenAgents: MobileAgent[];
  pinnedAgentIds: string[];
  pinnedChannelIds: string[];
  hiddenChannelIds: string[];
  hideChannel: (channelId: string, serverId: string) => boolean;
  unhideChannel: (channelId: string, serverId: string) => boolean;
  toggleChannelPin: (channelId: string, serverId: string) => ToggleAgentPinResult;
  setChatPins: (serverId: string, items: readonly SidebarPin[]) => boolean;
  readChatPins: (serverId: string) => SidebarPin[];
  pinnedWorkflowIds: Readonly<Record<string, readonly string[]>>;
  toggleWorkflowPin: (workflowId: string, serverId: string) => ToggleAgentPinResult;
  reconcileWorkflowPins: (serverId: string, workflowIds: readonly string[]) => void;
  collapsedSectionIds: ReadonlySet<string>;
  toggleSectionCollapsed: (serverId: string, sectionId: string, sectionIds: readonly string[]) => void;
  conversationStore: MobileConversationStore;
  liveState: LiveWorkspaceStore;
  selectServer: (serverId: string) => void;
  leaveServer: (serverId: string) => Promise<void>;
  removeServer: (serverId: string) => Promise<void>;
  refreshServers: () => Promise<void>;
  refreshServer: (serverId: string) => Promise<void>;
  hostedServerStarting: (serverId: string) => void;
  knownServerChecks: (serverId: string) => ServerChecks | null;
  canEditServerIdentity: (serverId: string) => boolean;
  canEditServerAppearance: (serverId: string) => boolean;
  canSendNotifications: (serverId: string) => boolean;
  canSetAgentNotificationLevel: (serverId: string) => boolean;
  loadAgentNotificationLevels: (serverId: string) => Promise<AgentNotificationLevelsSnapshot>;
  setAgentNotificationLevel: (
    input: SetAgentNotificationLevelInput,
    serverId: string,
  ) => Promise<AgentNotificationLevelsSnapshot>;
  setOwnServerNotificationLevel: (
    level: ServerNotificationLevel | null,
    serverId: string,
  ) => Promise<AgentNotificationLevelsSnapshot>;
  updateServerIdentity: (
    serverId: string,
    input: { serverName?: string; logo?: AvatarImageInput | null },
  ) => Promise<void>;
  setServerAppearance: (serverId: string, appearance: ServerAppearance | null) => Promise<void>;
  canRotateServerKey: (serverId: string) => boolean;
  canTransferOwnership: (serverId: string) => boolean;
  rotateServerKey: (serverId: string) => Promise<{ publicKey: string }>;
  reloadServerList: () => Promise<void>;
  canCreateLocalServers: (serverId: string) => boolean;
  listLocalServers: (serverId: string) => Promise<HostLocalServerList>;
  createLocalServer: (serverId: string, name: string) => Promise<HostLocalServer>;
  localServerKind: (serverId: string) => "computer" | "onComputer" | null;
  deleteLocalServer: (serverId: string) => Promise<void>;
  canRestartServerItself: (serverId: string) => boolean;
  restartServerItself: (serverId: string) => Promise<void>;
  canManageServerTimezone: (serverId: string) => boolean;
  loadServerTimezone: (serverId: string) => Promise<HostTimezoneSettings>;
  setServerTimezone: (timezone: string | null, serverId: string) => Promise<HostTimezoneSettings>;
  canManageServerVoiceModel: (serverId: string) => boolean;
  canManageServerSignalHome: (serverId: string) => boolean;
  servesServerSignalHome: (serverId: string) => boolean;
  loadServerSignalHome: (serverId: string) => Promise<HostSignalHomeSettings>;
  setServerSignalHome: (home: string | null, serverId: string) => Promise<HostSignalHomeSettings>;
  loadServerVoiceModel: (serverId: string) => Promise<HostVoiceModel>;
  changeServerVoiceModel: (change: HostVoiceModelChange, serverId: string) => Promise<HostVoiceModel>;
  canManageAgentMemoryLimit: (serverId: string) => boolean;
  loadAgentMemoryLimit: (serverId: string) => Promise<HostAgentMemoryLimit>;
  setAgentMemoryLimit: (limit: number, serverId: string) => Promise<HostAgentMemoryLimit>;
  canManageMemoryReview: (serverId: string) => boolean;
  loadMemoryReview: (serverId: string) => Promise<HostMemoryReview>;
  setMemoryReview: (interval: number, serverId: string) => Promise<HostMemoryReview>;
  canManageSkillLearning: (serverId: string) => boolean;
  loadSkillLearning: (serverId: string) => Promise<HostSkillLearning>;
  setSkillLearning: (mode: string, serverId: string) => Promise<HostSkillLearning>;
  canManageBrowsingMemory: (serverId: string) => boolean;
  loadBrowsingMemory: (serverId: string) => Promise<HostBrowsingMemory>;
  setBrowsingMemory: (enabled: boolean, serverId: string) => Promise<HostBrowsingMemory>;
  canManageServerPersonality: (serverId: string) => boolean;
  servesServerPersonality: (serverId: string) => boolean;
  loadServerPersonality: (serverId: string) => Promise<HostPersonality>;
  setServerPersonality: (personality: HostPersonality, serverId: string) => Promise<HostPersonality>;
  canManageServerRoles: (serverId: string) => boolean;
  hasAgentAccessLimits: (serverId: string) => boolean;
  loadServerRoles: (serverId: string) => Promise<AgentAccessSnapshot>;
  setServerRoles: (change: AgentAccessChange, serverId: string) => Promise<AgentAccessSnapshot>;
  canReadServerAudit: (serverId: string) => boolean;
  loadServerAuditLog: (serverId: string) => Promise<ServerAuditLog>;
  canManageConnectors: (serverId: string) => boolean;
  canManageOnePasswordConnector: (serverId: string) => boolean;
  canManageBitwardenConnector: (serverId: string) => boolean;
  canManageWhatsAppConnector: (serverId: string) => boolean;
  canManagePasswordManagers: (serverId: string) => boolean;
  canManageVault: (serverId: string) => boolean;
  canSaveVaultRequest: (serverId: string) => boolean;
  canImportVault: (serverId: string) => boolean;
  canImportAgents: (serverId: string) => boolean;
  canTransferServer: (serverId: string) => boolean;
  canManageVaultApiKeys: (serverId: string) => boolean;
  canManageVaultTwoStep: (serverId: string) => boolean;
  canManageBrowserProfiles: (serverId: string) => boolean;
  canManageBrowserProxies: (serverId: string) => boolean;
  githubConnector: (route: GitHubConnectorRoute, serverId: string) => Promise<HostGitHubConnectorStatus>;
  loadGitHubRepositories: (serverId: string) => Promise<GitHubConnectorRepositories>;
  loadOnePasswordConnector: (serverId: string) => Promise<OnePasswordConnectorStatus>;
  connectOnePassword: (token: string, serverId: string) => Promise<OnePasswordConnectorStatus>;
  disconnectOnePassword: (serverId: string) => Promise<OnePasswordConnectorStatus>;
  loadBitwardenConnector: (serverId: string) => Promise<BitwardenConnectorStatus>;
  connectBitwarden: (input: BitwardenHostConnectInput, serverId: string) => Promise<BitwardenConnectorStatus>;
  disconnectBitwarden: (serverId: string) => Promise<BitwardenConnectorStatus>;
  loadPasswordManagers: (serverId: string) => Promise<PasswordManagerStatus[]>;
  connectPasswordManager: (input: PasswordManagerConnectInput, serverId: string) => Promise<PasswordManagerStatus>;
  cancelPasswordManager: (manager: PasswordManagerId, serverId: string) => Promise<PasswordManagerStatus>;
  disconnectPasswordManager: (manager: PasswordManagerId, serverId: string) => Promise<PasswordManagerStatus>;
  loadVault: (serverId: string) => Promise<VaultState>;
  loadVaultCodes: (serverId: string) => Promise<VaultTwoStepCodes>;
  saveVaultItem: (input: VaultSaveInput, serverId: string) => Promise<VaultState>;
  deleteVaultItem: (id: string, serverId: string) => Promise<VaultState>;
  importVaultCsv: (csv: string, serverId: string) => Promise<VaultHostImportResult>;
  checkAgentExport: (size: number, serverId: string) => void;
  stageAgentImport: (
    file: AgentExportFile,
    serverId: string,
    onProgress?: (fraction: number) => void,
  ) => Promise<AgentImportPreview>;
  applyAgentImport: (input: ApplyAgentImportInput, serverId: string) => Promise<RemoteAgentImportResult>;
  discardAgentImport: (token: string, serverId: string) => Promise<void>;
  loadInstanceTransferSummary: (serverId: string) => Promise<InstanceTransferSummary>;
  downloadInstanceTransfer: (input: ExportInstanceInput, serverId: string) => Promise<RemoteFileUpload>;
  stageInstanceTransfer: (
    upload: RemoteFileUpload,
    serverId: string,
    onProgress?: (fraction: number) => void,
  ) => Promise<InstanceTransferPreview>;
  applyInstanceTransfer: (input: ApplyInstanceTransferInput, serverId: string) => Promise<RemoteInstanceTransferResult>;
  discardInstanceTransfer: (token: string, serverId: string) => Promise<void>;
  loadBrowserProfiles: (serverId: string) => Promise<BrowserProfileList>;
  createBrowserProfile: (name: string, serverId: string) => Promise<BrowserProfileSummary>;
  updateBrowserProfile: (input: UpdateBrowserProfileInput, serverId: string) => Promise<BrowserProfileSummary>;
  clearBrowserData: (input: ClearBrowserDataInput, serverId: string) => Promise<void>;
  deleteBrowserProfile: (profileId: string, serverId: string) => Promise<void>;
  loadAgentBrowserProfile: (agentId: string, serverId: string) => Promise<AgentBrowserProfile>;
  updateAgentBrowserProfile: (input: UpdateAgentBrowserProfileInput, serverId: string) => Promise<AgentBrowserProfile>;
  loadBrowserProxies: (serverId: string) => Promise<BrowserProxyList>;
  saveBrowserProxy: (input: SaveBrowserProxyInput, serverId: string) => Promise<BrowserProxySummary>;
  deleteBrowserProxy: (input: DeleteBrowserProxyInput, serverId: string) => Promise<void>;
  setBrowserProfileProxy: (input: SetBrowserProfileProxyInput, serverId: string) => Promise<void>;
  loadMessagingConnections: (platform: ConnectorMessagingPlatform, serverId: string) => Promise<MessagingOverview>;
  connectMessaging: (input: HostMessagingConnectInput, serverId: string) => Promise<MessagingConnectorPage>;
  completeMessagingInstall: (
    input: { platform: "slack" | "discord"; nonce: string; grant: string },
    serverId: string,
  ) => Promise<boolean>;
  reconnectMessaging: (input: HostMessagingWorkspaceInput, serverId: string) => Promise<MessagingConnectorPage>;
  disconnectMessaging: (input: HostMessagingWorkspaceInput, serverId: string) => Promise<void>;
  setMessagingEnabled: (input: HostSetMessagingEnabledInput, serverId: string) => Promise<void>;
  addMessagingOrchestrator: (
    input: HostAddMessagingOrchestratorInput,
    serverId: string,
  ) => Promise<AddMessagingOrchestratorResult>;
  loadWhatsAppConnector: (serverId: string) => Promise<WhatsAppOverview>;
  startWhatsAppLink: (input: StartWhatsAppLinkInput, serverId: string) => Promise<WhatsAppLinkState>;
  loadWhatsAppLinkState: (serverId: string) => Promise<WhatsAppLinkState>;
  cancelWhatsAppLink: (serverId: string) => Promise<void>;
  disconnectWhatsAppNumber: (input: MessagingWorkspaceInput, serverId: string) => Promise<void>;
  reconnectWhatsAppNumber: (input: MessagingWorkspaceInput, serverId: string) => Promise<void>;
  setWhatsAppEnabled: (input: SetMessagingEnabledInput, serverId: string) => Promise<void>;
  addWhatsAppOrchestrator: (serverId: string) => Promise<AddMessagingOrchestratorResult>;
  loadWhatsAppGroups: (input: MessagingWorkspaceInput, serverId: string) => Promise<WhatsAppGroupList>;
  addWhatsAppSender: (input: WhatsAppSenderInput, serverId: string) => Promise<void>;
  removeWhatsAppSender: (input: RemoveWhatsAppSenderInput, serverId: string) => Promise<void>;
  answerWhatsAppRequest: (input: AnswerWhatsAppRequestInput, serverId: string) => Promise<void>;
  setWhatsAppOwnNumber: (input: SetWhatsAppOwnNumberInput, serverId: string) => Promise<void>;
  setWhatsAppWorkingMessage: (input: SetWhatsAppWorkingMessageInput, serverId: string) => Promise<void>;
  setWhatsAppStatusReactions: (input: SetWhatsAppStatusReactionsInput, serverId: string) => Promise<void>;
  setWhatsAppSenderReadOnly: (input: SetWhatsAppSenderReadOnlyInput, serverId: string) => Promise<void>;
  serverUpdateAccess: (serverId: string) => ServerUpdateAccess | null;
  canReadServerRelease: (serverId: string) => boolean;
  loadServerUpdate: (serverId: string, access: ServerUpdateAccess) => Promise<HostUpdateStatus>;
  checkServerUpdate: (serverId: string, access: ServerUpdateAccess) => Promise<HostUpdateStatus>;
  startServerUpdate: (
    serverId: string,
    access: ServerUpdateAccess,
    restart: UpdateRestartMode,
  ) => Promise<HostUpdateStatus>;
  cancelServerUpdate: (serverId: string) => Promise<HostUpdateStatus>;
  setServerUpdateSettings: (settings: HostUpdateSettingsChange, serverId: string) => Promise<HostUpdateStatus>;
  loadServerRelease: (serverId: string) => Promise<HostReleaseStatus>;
  checkServerRelease: (serverId: string) => Promise<HostReleaseStatus>;
  canViewHostedSites: (serverId: string) => boolean;
  canDeleteHostedSites: (serverId: string) => boolean;
  loadHostedSites: (serverId: string) => Promise<HostedSiteList>;
  deleteHostedSite: (siteId: string, serverId: string) => Promise<void>;
  canManageProviders: (serverId: string) => boolean;
  providerAdmin: (serverId: string) => ProviderAdmin;
  canManageMcpServers: (serverId: string) => boolean;
  listMcpServers: (serverId: string) => Promise<McpServerConfig[]>;
  saveMcpServer: (config: McpServerConfig, serverId: string) => Promise<McpServerConfig[]>;
  removeMcpServer: (mcpServerId: string, serverId: string) => Promise<McpServerConfig[]>;
  setMcpServerEnabled: (mcpServerId: string, enabled: boolean, serverId: string) => Promise<McpServerConfig[]>;
  testMcpServer: (config: McpServerConfig, serverId: string) => Promise<McpTestResult>;
  canRelayMcpSignIn: (serverId: string) => boolean;
  macAppsUnavailable: (serverId: string) => boolean;
  canEditUiBlockPreview: (serverId: string) => boolean;
  mcpSignInRelay: (serverId: string) => McpSignInRelay;
  listMcpSignIns: (serverId: string) => Promise<McpSignInState[]>;
  signOutMcpServer: (mcpServerId: string, serverId: string) => Promise<McpSignInState[]>;
  canManageMcpAccess: (serverId: string) => boolean;
  loadMcpAccess: (serverId: string) => Promise<McpAccessSnapshot>;
  setMcpAccess: (input: SetMcpAccessInput, serverId: string) => Promise<McpAccessSnapshot>;
  addRemoteServer: (input: AddRemoteServerInput) => Promise<string>;
  createAgent: (input: NewAgentInput) => Promise<string>;
  updateAgent: (input: UpdateAgentInput, serverId?: string) => Promise<void>;
  setAgentAvatar: (agentId: string, image: RemoteFileUpload | null, serverId: string) => Promise<void>;
  loadAgentAvatar: (agentId: string, avatarUrl: string, serverId: string) => Promise<string>;
  deleteAgent: (agentId: string, serverId?: string) => Promise<void>;
  duplicateAgent: (agentId: string) => Promise<void>;
  saveAgentMemory: (agentId: string, text: string, serverId: string, memoryId?: string) => Promise<void>;
  deleteAgentMemory: (agentId: string, memoryId: string, serverId: string) => Promise<void>;
  createAgentRoutine: (input: CreateRoutineInput, serverId: string) => Promise<void>;
  updateAgentRoutine: (input: UpdateRoutineInput, serverId: string) => Promise<void>;
  deleteAgentRoutine: (agentId: string, routineId: string, serverId: string) => Promise<void>;
  testAgentRoutine: (agentId: string, routineId: string, serverId: string) => Promise<void>;
  canManageEvents: (serverId: string) => boolean;
  canManageMissedRuns: (serverId: string) => boolean;
  canManageRoutineResults: (serverId: string) => boolean;
  canGiveWebhookSecretToAgent: (serverId: string) => boolean;
  loadRoutineResultOptions: (serverId: string) => Promise<RoutineResultConnectionOption[]>;
  loadRoutineResultDestination: (
    input: RoutineResultRoutineInput,
    serverId: string,
  ) => Promise<RoutineResultDestination | null>;
  setRoutineResultDestination: (
    input: SetRoutineResultDestinationInput,
    serverId: string,
  ) => Promise<RoutineResultDestination | null>;
  listEventRoutines: (owner: EventRoutineOwner, serverId: string) => Promise<EventRoutine[]>;
  saveEventRoutine: (input: SaveEventRoutineInput, serverId: string) => Promise<SaveEventRoutineResult>;
  deleteEventRoutine: (input: EventRoutineRef, serverId: string) => Promise<void>;
  testEventRoutine: (input: EventRoutineRef, serverId: string) => Promise<void>;
  rotateEventRoutineSecret: (input: EventRoutineRef, serverId: string) => Promise<WebhookSecret>;
  giveEventRoutineSecretToAgent: (input: EventRoutineRef, serverId: string) => Promise<AgentWebhookSecret>;
  listEventActivity: (input: ListEventActivityInput, serverId: string) => Promise<EventActivity[]>;
  loadAgentModels: (serverId: string) => Promise<AgentModelOption[]>;
  loadAgentMemorySelection: (agentId: string, serverId: string) => Promise<AgentMemorySelectionState | null>;
  setAgentMemoryInclusion: (
    input: SetAgentMemoryInclusionInput,
    serverId: string,
  ) => Promise<AgentMemorySelectionState>;
  loadAgentMemories: (agentId: string, serverId: string) => Promise<AgentMemory[]>;
  loadAgentRoutines: (agentId: string, serverId: string) => Promise<Routine[]>;
  loadRoutineCalendar: (
    input: RoutineCalendarInput,
    serverId: string,
    owners?: readonly RoutineCalendarOwner[],
  ) => Promise<RoutineCalendar>;
  loadAgentAnalytics: (input: AgentAnalyticsInput, serverId: string) => Promise<AgentAnalytics | null>;
  loadHostAnalytics: (input: HostAnalyticsInput, serverId: string) => Promise<HostAnalytics | null>;
  loadAgentSkills: (agentId: string, serverId: string, manage?: boolean) => Promise<InstalledSkill[] | null>;
  canManageAgentSkills: (serverId: string) => boolean;
  installAgentSkill: (input: InstallSkillInput, serverId: string) => Promise<InstalledSkill>;
  setAgentSkillEnabled: (input: SetEnabledSkillInput, serverId: string) => Promise<InstalledSkill>;
  uninstallAgentSkill: (input: UninstallSkillInput, serverId: string) => Promise<void>;
  loadAgentStorage: (agentId: string, serverId: string, force?: boolean) => Promise<StorageUsage | null>;
  canReadServerStorage: (serverId: string) => boolean;
  canOrganizeLibrary: (serverId: string) => boolean;
  canReadMachineMetrics: (serverId: string) => boolean;
  loadMachineMetrics: (serverId: string) => Promise<MachineMetrics>;
  canControlComputer: (serverId: string) => boolean;
  remoteDesktopConnection: (serverId: string) => RemoteDesktopConnection | null;
  loadServerStorage: (serverId: string, force?: boolean) => Promise<StorageUsage>;
  loadLibraryFolders: (serverId: string) => Promise<LibraryFoldersSnapshot>;
  changeLibraryFolders: (action: LibraryFolderAction, serverId: string) => Promise<LibraryFoldersSnapshot>;
  loadServerDisk: (serverId: string) => Promise<StorageDisk | null>;
  clearServerStorage: (category: ClearableStorageCategory, serverId: string) => Promise<void>;
  loadAgentAdminSettings: (agentId: string, serverId: string) => Promise<AgentAdminSettings | null>;
  updateAgentAdminSettings: (input: UpdateAgentAdminSettingsInput, serverId: string) => Promise<AgentAdminSettings>;
  canManageAgentAccess: (serverId: string) => boolean;
  canManageAgentHostSettings: (serverId: string) => boolean;
  loadAgentHostSettings: (agentId: string, serverId: string) => Promise<AgentHostSettings | null>;
  updateAgentHostSettings: (input: UpdateAgentHostSettingsInput, serverId: string) => Promise<AgentHostSettings>;
  canManageAgentBackupModels: (serverId: string) => boolean;
  loadAgentBackupModels: (agentId: string, serverId: string) => Promise<AgentBackupModelSettings | null>;
  updateAgentBackupModels: (input: UpdateAgentBackupModelsInput, serverId: string) => Promise<AgentBackupModelSettings>;
  canManageAgentTaskLimit: (serverId: string) => boolean;
  loadAgentTaskLimit: (agentId: string, serverId: string) => Promise<AgentTaskLimitSettings | null>;
  updateAgentTaskLimit: (input: UpdateAgentTaskLimitInput, serverId: string) => Promise<AgentTaskLimitSettings>;
  canManageAgentNewChat: (serverId: string) => boolean;
  loadAgentNewChat: (agentId: string, serverId: string) => Promise<AgentNewChatSettings | null>;
  updateAgentNewChat: (input: UpdateAgentNewChatInput, serverId: string) => Promise<AgentNewChatSettings>;
  canManageAgentPlanCard: (serverId: string) => boolean;
  loadAgentPlanCard: (agentId: string, serverId: string) => Promise<AgentPlanCardSettings | null>;
  updateAgentPlanCard: (input: UpdateAgentPlanCardInput, serverId: string) => Promise<AgentPlanCardSettings>;
  canManageAgentBuiltinMemory: (serverId: string) => boolean;
  loadAgentBuiltinMemory: (agentId: string, serverId: string) => Promise<AgentBuiltinMemorySettings | null>;
  updateAgentBuiltinMemory: (
    input: UpdateAgentBuiltinMemoryInput,
    serverId: string,
  ) => Promise<AgentBuiltinMemorySettings>;
  canManageAgentDefaults: (serverId: string) => boolean;
  loadAgentDefaults: (serverId: string) => Promise<AgentDefaultsOverview | null>;
  updateAgentDefaults: (input: UpdateAgentDefaultsInput, serverId: string) => Promise<AgentDefaultsOverview>;
  setAgentDefaultChoice: (input: SetAgentDefaultChoiceInput, serverId: string) => Promise<AgentDefaultsOverview>;
  canManageBackgroundProcesses: (serverId: string) => boolean;
  loadBackgroundProcesses: (serverId: string) => Promise<BackgroundProcess[] | null>;
  stopBackgroundProcess: (id: string, serverId: string) => Promise<void>;
  loadAgentSpeed: (agentId: string, serverId: string) => Promise<AgentSpeedSettings | null>;
  updateAgentSpeed: (input: UpdateAgentSpeedInput, serverId: string) => Promise<AgentSpeedSettings>;
  canManageAgentInstructions: (serverId: string) => boolean;
  loadAgentInstructions: (agentId: string, serverId: string) => Promise<AgentInstructionsFile>;
  saveAgentInstructions: (input: SaveAgentInstructionsInput, serverId: string) => Promise<AgentInstructionsFile>;
  canManageProviderAccounts: (serverId: string) => boolean;
  loadProviderAccounts: (serverId: string) => Promise<HostProviderAccounts | null>;
  loadPlanLimits: (serverId: string, accounts: boolean) => Promise<PlanLimits>;
  setAgentProviderAccount: (input: SetAgentProviderAccountInput, serverId: string) => Promise<void>;
  canStartNewChat: (serverId: string) => boolean;
  canChooseNewAgentModel: (serverId: string) => boolean;
  loadAgentSessionSettings: (agentId: string, serverId: string) => Promise<AgentSessionSettings | null>;
  setAgentSessionSetting: (input: SetAgentSessionSettingInput, serverId: string) => Promise<AgentSessionSettings>;
  resetAgentSessionSetting: (input: ResetAgentSessionSettingInput, serverId: string) => Promise<AgentSessionSettings>;
  canManageAgentFolders: (serverId: string) => boolean;
  canNestSidebarFolders: (serverId: string) => boolean;
  loadAgentFolders: (agentId: string, serverId: string) => Promise<AgentFolderList>;
  addAgentFolder: (input: AddAgentFolderInput, serverId: string) => Promise<AgentFolderChange>;
  removeAgentFolder: (input: AgentFolderInput, serverId: string) => Promise<AgentFolderChange>;
  excludeAgentFolder: (input: AgentFolderInput, serverId: string) => Promise<AgentExclusionChange>;
  includeAgentFolder: (input: AgentFolderInput, serverId: string) => Promise<AgentExclusionChange>;
  browseAgentFolders: (agentId: string, path: string | null, serverId: string) => Promise<AgentFolderBrowse>;
  canManageChannelFolders: (serverId: string) => boolean;
  loadChannelFolders: (channelId: string, serverId: string) => Promise<ChannelFolderList>;
  addChannelFolder: (input: ChannelFolderInput, serverId: string) => Promise<ChannelFolderChange>;
  removeChannelFolder: (input: ChannelFolderInput, serverId: string) => Promise<ChannelFolderChange>;
  browseChannelFolders: (channelId: string, path: string | null, serverId: string) => Promise<AgentFolderBrowse>;
  startNewChat: (agentId: string, serverId: string) => Promise<void>;
  canUseLiveVoice: (serverId: string) => boolean;
  startLiveVoice: (input: LiveVoiceStartRequest, serverId: string) => Promise<LiveVoiceSessionResponse>;
  stopLiveVoice: (sessionId: string, serverId: string) => Promise<void>;
  canCompactContext: (serverId: string) => boolean;
  compactContext: (agentId: string, serverId: string, taskId?: string) => Promise<void>;
  canDeleteChatHistory: (serverId: string) => boolean;
  deleteAgentHistory: (agentId: string, serverId: string) => Promise<void>;
  canManageSharedTables: (serverId: string) => boolean;
  listSharedTables: (serverId: string) => Promise<SharedTable[]>;
  deleteSharedTable: (name: string, serverId: string) => Promise<void>;
  canPublishAgent: (serverId: string) => boolean;
  loadAgentTemplatePreview: (agentId: string, serverId: string) => Promise<AgentTemplatePreview>;
  publishAgentTemplate: (agentId: string, serverId: string) => Promise<AgentTemplatePublication>;
  unpublishAgentTemplate: (agentId: string, serverId: string) => Promise<void>;
  canInstallAgentTemplate: (serverId: string) => boolean;
  installAgentTemplate: (input: InstallAgentTemplateInput, serverId: string) => Promise<AddedAgent>;
  canAddMarketplaceAgents: (serverId: string) => boolean;
  canUpdateMarketplaceAgents: (serverId: string) => boolean;
  installMarketplaceAgent: (input: InstallMarketplaceAgentInput, serverId: string) => Promise<AddedAgent>;
  deleteStoredFile: (fileId: string, serverId: string) => Promise<void>;
  searchMessages: (query: string, serverId: string, cursor?: string) => Promise<ConversationSearchPage>;
  canSearchFiles: (serverId: string) => boolean;
  searchFiles: (query: string, serverId: string, cursor?: string) => Promise<ConversationFileSearchPage>;
  canUseTasks: (serverId: string) => boolean;
  canRunQueuedMessageAsTask: (serverId: string) => boolean;
  canEditThreads: (serverId: string) => boolean;
  canReadThreads: (serverId: string) => boolean;
  canAttachThreadFiles: (serverId: string) => boolean;
  canPinMessages: (serverId: string) => boolean;
  canAskSideQuestion: (serverId: string) => boolean;
  canBranchThreads: (serverId: string) => boolean;
  canUseWorkflows: (serverId: string) => boolean;
  listWorkflows: (serverId: string) => Promise<WorkflowSummary[]>;
  loadWorkflow: (workflowId: string, serverId: string) => Promise<WorkflowDetail>;
  createWorkflow: (input: CreateWorkflowInput, serverId: string) => Promise<WorkflowDetail>;
  renameWorkflow: (input: RenameWorkflowInput, serverId: string) => Promise<WorkflowSummary>;
  setWorkflowPaused: (input: SetWorkflowPausedInput, serverId: string) => Promise<WorkflowSummary>;
  deleteWorkflow: (workflowId: string, serverId: string) => Promise<void>;
  saveWorkflowGraph: (input: SaveWorkflowGraphInput, serverId: string) => Promise<WorkflowSaveResult>;
  loadWorkflowRuns: (workflowId: string, serverId: string, before?: string) => Promise<WorkflowRunPage>;
  loadWorkflowRun: (runId: string, serverId: string) => Promise<WorkflowRunDetail>;
  startWorkflowRun: (workflowId: string, serverId: string, fromNodeId?: string) => Promise<WorkflowRunDetail>;
  stopWorkflowRun: (runId: string, serverId: string) => Promise<void>;
  runWorkflowStep: (input: WorkflowTriggerInput, serverId: string) => Promise<WorkflowStep>;
  stopWorkflowStep: (stepId: string, serverId: string) => Promise<void>;
  retryWorkflowStep: (stepId: string, serverId: string) => Promise<WorkflowStep>;
  decideWorkflowStep: (input: DecideWorkflowStepInput, serverId: string) => Promise<void>;
  rotateWorkflowWebhookSecret: (input: WorkflowTriggerInput, serverId: string) => Promise<WorkflowWebhookSecret>;
  loadWorkflowVersions: (workflowId: string, serverId: string) => Promise<WorkflowVersion[]>;
  loadWorkflowVersionGraph: (input: WorkflowVersionInput, serverId: string) => Promise<WorkflowGraph>;
  restoreWorkflowVersion: (input: WorkflowVersionInput, serverId: string) => Promise<WorkflowDetail>;
  canUseWorkflowGitHub: (serverId: string) => boolean;
  canUseWorkflowChats: (serverId: string) => boolean;
  canUseWorkflowMedia: (serverId: string) => boolean;
  canUseWorkflowMediaSize: (serverId: string) => boolean;
  canUseWorkflowAssets: (serverId: string) => boolean;
  canPauseWorkflows: (serverId: string) => boolean;
  loadWorkflowMediaModels: (serverId: string) => Promise<WorkflowMediaModels>;
  loadWorkflowMediaPrice: (input: WorkflowMediaPriceRequest, serverId: string) => Promise<number | null>;
  loadWorkflowCreditBalance: (serverId: string) => Promise<number | null>;
  loadWorkflowGitHubCatalog: (serverId: string) => Promise<WorkflowGitHubCatalog>;
  loadWorkflowGitHubOptions: (repository: string, serverId: string) => Promise<WorkflowGitHubRepositoryOptions>;
  loadWorkflowGitHubHistory: (workflowId: string, serverId: string) => Promise<WorkflowGitHubHistory>;
  runWorkflowGitHubLastEvent: (input: WorkflowTriggerInput, serverId: string) => Promise<WorkflowRunDetail>;
  keepWorkflowPicture: (draftId: string, serverId: string) => Promise<{ fileId: string }>;
  loadAgentTasks: (agentId: string, serverId: string) => Promise<AgentTasksSnapshot>;
  loadAgentTaskConversation: (input: AgentTaskInput, serverId: string) => Promise<ConversationSnapshot>;
  startAgentTask: (
    input: { agentId: string; text: string; attachmentDraftIds?: string[]; clientMessageId: string },
    serverId: string,
  ) => Promise<AgentTask>;
  runQueuedMessageAsTask: (input: { agentId: string; deliveryId: string }, serverId: string) => Promise<AgentTask>;
  sendAgentTaskMessage: (
    input: AgentTaskInput & { text: string; attachmentDraftIds?: string[]; clientMessageId: string },
    serverId: string,
  ) => Promise<QueuedMessageReceipt>;
  controlAgentTask: (action: "stop" | "close" | "reopen", input: AgentTaskInput, serverId: string) => Promise<void>;
  renameAgentThread: (input: AgentTaskInput & { title: string }, serverId: string) => Promise<void>;
  deleteAgentThread: (input: AgentTaskInput, serverId: string) => Promise<void>;
  branchAgentThread: (input: BranchAgentTaskInput, serverId: string) => Promise<AgentTask>;
  loadAgentThreadReads: (agentId: string, serverId: string) => Promise<AgentTaskReadState[]>;
  markAgentThreadRead: (input: MarkAgentTaskReadInput, serverId: string) => Promise<AgentTaskReadState>;
  loadMessagePins: (agentId: string, serverId: string) => Promise<PinnedMessagesSnapshot>;
  setMessagePinned: (input: SetMessagePinnedInput, serverId: string) => Promise<PinnedMessagesSnapshot>;
  askSideQuestion: (input: AskSideQuestionInput, serverId: string) => Promise<string>;
  respondToTaskPrompt: (input: RespondToPromptInput, serverId: string) => Promise<void>;
  loadConversation: (agentId: string, serverId?: string) => Promise<ConversationSnapshot>;
  loadConversationAround: (agentId: string, messageId: string, serverId?: string) => Promise<boolean>;
  loadLatestMessages: (agentId: string, serverId?: string) => Promise<void>;
  loadOlderMessages: (agentId: string, serverId?: string) => Promise<void>;
  respondToPrompt: (agentId: string, input: RespondToPromptInput) => Promise<void>;
  sendMessage: (
    agentId: string,
    text: string,
    attachmentDraftIds?: string[],
    replyToMessageId?: string | null,
    serverId?: string,
    clientMessageId?: string,
  ) => Promise<string>;
  uploadAttachment: (
    agentId: string,
    input: RemoteFileUpload,
    serverId?: string,
    onProgress?: (fraction: number) => void,
  ) => Promise<DraftAttachment>;
  downloadAttachment: (
    serverId: string,
    attachmentId: string,
    largeDownload?: RemoteLargeDownload,
    progress?: RemoteDownloadWatch,
    tapped?: boolean,
    wanted?: () => boolean,
  ) => Promise<RemoteFileUpload>;
  prioritizeAttachmentDownload: (serverId: string, attachmentId: string) => void;
  downloadMessageFile: (serverId: string, file: MessageFileTarget) => Promise<RemoteFileUpload>;
  discardAttachment: (agentId: string, attachmentId: string, serverId?: string) => Promise<void>;
  hidesAgentsOnServer: (serverId: string) => boolean;
  hiddenAgentsWorkOnServer: (serverId: string) => boolean;
  canUnhideAgent: (agentId: string) => boolean;
  hideAgent: (agentId: string) => void;
  unhideAgent: (agentId: string) => void;
  markAgentRead: (agentId: string, throughMessageId?: string, serverId?: string) => void;
  markAgentUnread: (agentId: string) => void;
  markAgentUnreadFrom: (agentId: string, fromMessageId: string, serverId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  toggleAgentPin: (agentId: string) => ToggleAgentPinResult;
}

interface McpSignInRelay {
  start: (config: McpServerConfig) => Promise<string>;
  status: (flowId: string) => Promise<SignInRelayStatus>;
  complete: (flowId: string, query: string) => Promise<SignInRelayStatus>;
  cancel: (flowId: string) => Promise<void>;
}

export type MobileWorkspaceCapabilityCheck =
  | "browserViewSupport"
  | "canEditQueue"
  | "canReadModelSteering"
  | "canRetryMessage"
  | "canDeleteMessages"
  | "canMarkUnreadFrom"
  | "canUseLiveVoice"
  | "attachmentSupport"
  | "canStartNewChat"
  | "canCompactContext"
  | "canDeleteChatHistory"
  | "canChooseNewAgentModel"
  | "canInstallAgentTemplate"
  | "canSearchFiles"
  | "canUseTasks"
  | "canRunQueuedMessageAsTask"
  | "canEditThreads"
  | "canReadThreads"
  | "canAttachThreadFiles"
  | "canPinMessages"
  | "canAskSideQuestion"
  | "canBranchThreads"
  | "canUseWorkflows"
  | "canUseWorkflowGitHub"
  | "canUseWorkflowChats"
  | "canUseWorkflowMedia"
  | "canUseWorkflowMediaSize"
  | "canUseWorkflowAssets"
  | "canPauseWorkflows"
  | "canReadServerStorage"
  | "canOrganizeLibrary"
  | "canControlComputer"
  | "canSetAgentNotificationLevel";

type ServerCheckKey =
  | Exclude<MobileWorkspaceCapabilityCheck, "browserViewSupport">
  | "canEditServerIdentity"
  | "canEditServerAppearance"
  | "canRotateServerKey"
  | "canTransferOwnership"
  | "canCreateLocalServers"
  | "canRestartServerItself"
  | "canManageServerTimezone"
  | "canManageServerVoiceModel"
  | "canManageServerSignalHome"
  | "servesServerSignalHome"
  | "canReadMachineMetrics"
  | "canManageAgentMemoryLimit"
  | "canManageMemoryReview"
  | "canManageSkillLearning"
  | "canManageBrowsingMemory"
  | "canManageServerPersonality"
  | "servesServerPersonality"
  | "canManageServerRoles"
  | "canReadServerAudit"
  | "hasAgentAccessLimits"
  | "canManageConnectors"
  | "canManageOnePasswordConnector"
  | "canManageBitwardenConnector"
  | "canManageWhatsAppConnector"
  | "canManagePasswordManagers"
  | "canManageVault"
  | "canSaveVaultRequest"
  | "canImportVault"
  | "canImportAgents"
  | "canTransferServer"
  | "canManageVaultApiKeys"
  | "canManageVaultTwoStep"
  | "canManageBrowserProfiles"
  | "canManageBrowserProxies"
  | "serverUpdateAccess"
  | "canReadServerRelease"
  | "canViewHostedSites"
  | "canDeleteHostedSites"
  | "canManageProviders"
  | "canManageMcpServers"
  | "canRelayMcpSignIn"
  | "macAppsUnavailable"
  | "canEditUiBlockPreview"
  | "canManageMcpAccess"
  | "canAddMarketplaceAgents"
  | "canUpdateMarketplaceAgents"
  | "canManageEvents"
  | "canManageMissedRuns"
  | "canManageRoutineResults"
  | "canGiveWebhookSecretToAgent"
  | "canManageAgentSkills"
  | "canManageSharedTables"
  | "canManageAgentFolders"
  | "canManageChannelFolders"
  | "canNestSidebarFolders"
  | "canManageAgentAccess"
  | "canManageAgentHostSettings"
  | "canManageAgentBackupModels"
  | "canManageAgentTaskLimit"
  | "canManageAgentNewChat"
  | "canManageAgentPlanCard"
  | "canManageAgentBuiltinMemory"
  | "canManageAgentDefaults"
  | "canManageBackgroundProcesses"
  | "canManageAgentInstructions"
  | "canPublishAgent"
  | "canManageProviderAccounts";

export type ServerChecks = Pick<MobileWorkspaceContextValue, ServerCheckKey>;

type MobileWorkspaceStateKey =
  | MobileWorkspaceCapabilityCheck
  | ServerCheckKey
  | "knownServerChecks"
  | "sidebarByServer"
  | "servers"
  | "memberCountByServer"
  | "serverDirectoryState"
  | "serverDirectoryError"
  | "agents"
  | "activeServer"
  | "activeAgents"
  | "hiddenAgents"
  | "pinnedAgentIds"
  | "pinnedChannelIds"
  | "pinnedWorkflowIds"
  | "collapsedSectionIds"
  | "hiddenChannelIds"
  | "hidesAgentsOnServer"
  | "hiddenAgentsWorkOnServer"
  | "canUnhideAgent"
  | "localServerKind"
  | "canSendNotifications";

export type MobileWorkspaceState = Pick<MobileWorkspaceContextValue, MobileWorkspaceStateKey>;

export type MobileWorkspaceActions = Omit<MobileWorkspaceContextValue, MobileWorkspaceStateKey>;
