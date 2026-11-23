import type {
  AgentEvent,
  AgentModelId,
  AgentNotificationLevelsSnapshot,
  AgentProviderId,
  CentralAuthUser,
  DirectMessageRealtimeEvent,
  DirectTypingRealtimeEvent,
  McpAccessLevel,
  RemoteControlAccess,
  RoutineResultConnectionOption,
  RoutineResultDestination,
  RoutineResultRoutineInput,
  SaveSetupInput,
  ServerNotificationLevel,
  SetAgentNotificationLevelInput,
  SetRoutineResultDestinationInput,
  SidebarLayoutSnapshot,
  SidebarPin,
  SidebarPinsSnapshot,
  TeamPresenceSnapshot,
  UpdateHostIdentityInput,
  VoiceLiveEvent,
  VoiceTranscriptionResult,
} from "@openbot/contracts/ipc";
import type { Logger } from "@openbot/logging";
import type { Effect } from "effect";
import type { AgentService } from "../../backend/agent-service";
import type { BrowserHost } from "../../backend/browser-host";
import type { ChannelService } from "../../backend/channel-service";
import type { CrmPeopleOperations } from "../../backend/crm/crm-handle";
import type { MailboxStore } from "../../backend/mailbox-store";
import type { MessagingService } from "../../backend/messaging/messaging-service";
import type { RoutineFlowsHandle } from "../../backend/routine-flows/routine-flows";
import type { SidebarLayoutStore } from "../../backend/sidebar-layout-store";
import type { StorageUsageService } from "../../backend/storage-usage";
import type { TeamChatStore } from "../../backend/team-chat-store";
import type { WorkflowsHandle } from "../../backend/workflows/workflows";
import type { AcpRegistry } from "../acp-registry";
import type { AgentAccessStore } from "../agent-access-store";
import type { AgentAdminSettingsService } from "../agent-admin-settings";
import type { AgentDefaultsSettingsService } from "../agent-defaults-settings";
import type { AgentFolders } from "../agent-folders";
import type { AgentHostSettingsService } from "../agent-host-settings";
import type { AgentImportService } from "../agent-import-service";
import type { AgentInstructionsFiles } from "../agent-instructions-files";
import type { AgentMarketplaceService } from "../agent-marketplace-service";
import type { AgentMemoryLimitSetting } from "../agent-memory-limit-preference-store";
import type { AgentTemplateService } from "../agent-template-service";
import type { PreviewFile } from "../attachment-previews";
import type { listBackgroundProcesses, stopBackgroundProcess } from "../background-processes";
import type { BitwardenConnectorService } from "../bitwarden-connector-service";
import type { BrowserProfileService } from "../browser-profile-service";
import type { BrowserViewGateway } from "../browser-view-gateway";
import type { BrowsingMemoryPreferenceStore } from "../browsing-memory-preference-store";
import type { CacheExpiryCompactionControl } from "../cache-expiry-compaction-preference-store";
import type { ChannelFolders } from "../channel-folders";
import type { ClaudeCompactWindowControl } from "../claude-compact-window-preference-store";
import type { ClaudeUserSetupControl } from "../claude-user-setup-preference-store";
import type { ClientBrowserHub } from "../client-browser-hub";
import type { CustomAgentChanges } from "../custom-agent-changes";
import type { PeerCustomProviderChanges } from "../custom-provider-changes";
import type { GitHubConnectorService } from "../github-connector-service";
import type { WorkflowGitHubDirectory } from "../github-rest";
import type { HermesImportService } from "../hermes-import-service";
import type { HostEventsApi } from "../host-events-api";
import type { HostEventsService } from "../host-events-service";
import type { HostReleaseService } from "../host-release-service";
import type { HostService } from "../host-service";
import type { HostSignalHomeService } from "../host-signal-home";
import type { HostTurnLimitsPreferenceStore } from "../host-turn-limits-preference-store";
import type { HostVoiceModelService } from "../host-voice-model";
import type { HostedSiteDesktopService } from "../hosted-site-service";
import type { InstanceTransferService } from "../instance-transfer-service";
import type { McpToolRuntimePreparation } from "../ipc/mcp-server-handlers";
import type { LibraryFoldersService } from "../library-folders-service";
import type { LiveActivityPushService } from "../live-activity-push";
import type { MachineAlertMonitor } from "../machine-alerts";
import type { McpAccessControl } from "../mcp-access-store";
import type { McpHostSignIns } from "../mcp-host-sign-ins";
import type { McpServerOwnersStore } from "../mcp-server-owners-store";
import type { MemoryReviewPreferenceStore } from "../memory-review-preference-store";
import type { ModelVisibility } from "../model-visibility";
import type { OnePasswordConnectorService } from "../onepassword-connector-service";
import type { PasswordManagersService } from "../password-managers/password-managers-service";
import type { PreferenceFileFailure } from "../preference-file";
import type { PromptCacheTtlPreferenceStore } from "../prompt-cache-ttl-preference-store";
import type { ProviderAccountsHost } from "../provider-accounts-host";
import type { ProviderCredentialStore } from "../provider-credential-store";
import type { ProviderDetection } from "../provider-detection";
import type { ProviderDetectionSettingsStore } from "../provider-detection-settings-store";
import type { ProviderEnvironmentControl } from "../provider-environment-store";
import type { ProviderHostSignIns } from "../provider-host-sign-ins";
import type { ProviderRuntimeManager } from "../provider-runtime-manager";
import type { PushNotificationService } from "../push-notifications";
import type { RemoteScreenGateway } from "../remote-screen-gateway";
import type { RemoteWorkflowError } from "../remote-service-effects";
import type { RequestedUpdate } from "../requested-update";
import type { ServerAuditStore } from "../server-audit-store";
import type { ServerPersonalityPreferenceStore } from "../server-personality-preference-store";
import type { ServerTimezonePreferenceStore } from "../server-timezone-preference-store";
import type { SignInRelayHost } from "../sign-in-relay-host";
import type { SkillLearningPreferenceStore } from "../skill-learning-preference-store";
import type { SkillMarketplaceService } from "../skill-marketplace-service";
import type { TeamStore } from "../team-store";
import type { VaultService } from "../vault-service";
import type { VoiceOperationError } from "../voice-model-service";
import type { WorkflowFileExporter } from "../workflow-file-export";
import type { WorkflowFoldersService } from "../workflow-folders-service";

type TeamApiAgentMethods = Pick<
  AgentService,
  | "preferredProvider"
  | "newAgentProvider"
  | "getStatus"
  | "getRuntimeSnapshot"
  | "getUsage"
  | "getAnalytics"
  | "getHostAnalytics"
  | "listModels"
  | "listAgents"
  | "sidebarChatIds"
  | "listConversationReads"
  | "generateProfile"
  | "askSideQuestion"
  | "saveSkillSuggestion"
  | "withdrawFeedback"
  | "saveProfile"
  | "createAgent"
  | "committedAgentDuplication"
  | "duplicateAgent"
  | "commitAgentDuplication"
  | "updateAgent"
  | "deleteAgent"
  | "getMemorySelection"
  | "setMemoryInclusion"
  | "listMemories"
  | "createMemory"
  | "updateMemory"
  | "deleteMemory"
  | "clearMemories"
  | "listRoutines"
  | "createRoutine"
  | "updateRoutine"
  | "deleteRoutine"
  | "testRoutine"
  | "listRoutineRuns"
  | "listChannelMemories"
  | "createChannelMemory"
  | "updateChannelMemory"
  | "deleteChannelMemory"
  | "clearChannelMemories"
  | "listChannelRoutines"
  | "createChannelRoutine"
  | "updateChannelRoutine"
  | "deleteChannelRoutine"
  | "testChannelRoutine"
  | "listChannelRoutineRuns"
  | "setAvatar"
  | "resolveAvatar"
  | "readConversation"
  | "readConversationFor"
  | "readConversationPageFor"
  | "searchConversationMessages"
  | "searchConversationFiles"
  | "markConversationRead"
  | "markConversationUnread"
  | "prepareImportedAttachments"
  | "discardDraftAttachment"
  | "resolveSharedFile"
  | "resolveWorkspaceFile"
  | "resolveLocalWorkspaceFile"
  | "listWorkspaceDirectory"
  | "sendMessage"
  | "listQueue"
  | "listActiveQueues"
  | "acknowledgeFailedTurn"
  | "setMessageReaction"
  | "deleteConversationMessage"
  | "listPinnedMessages"
  | "setMessagePinned"
  | "cancelQueuedMessage"
  | "listWaits"
  | "cancelWait"
  | "steerQueuedMessage"
  | "updateQueuedMessage"
  | "editQueuedMessage"
  | "reorderQueue"
  | "interrupt"
  | "clearAgentContext"
  | "deleteAgentHistory"
  | "clearChannelContext"
  | "compactChannelContext"
  | "deleteChannelHistory"
  | "compactAgentContext"
  | "compactTaskContext"
  | "agentIdForRequest"
  | "pendingApproval"
  | "pendingPrompts"
  | "respondToPrompt"
  | "respondToApproval"
  | "respondToBrowserSecret"
  | "respondToBrowserTakeover"
>;

export type TeamApiAgents = TeamApiAgentMethods & {
  on: (event: "event", listener: (event: AgentEvent, memberId?: string) => void) => void;
  off: (event: "event", listener: (event: AgentEvent, memberId?: string) => void) => void;
};

export type TeamApiMcpServers = Pick<
  AgentService,
  "listMcpServers" | "saveMcpServer" | "removeMcpServer" | "setMcpServerEnabled" | "testMcpServer"
>;

export type TeamApiMcpServerOwners = Pick<McpServerOwnersStore, "addedBy" | "add" | "remove"> & {
  level?(mcpServerId: string, memberId: string): McpAccessLevel;
};

export type TeamApiMcpAccess = McpAccessControl;

export type TeamApiMcpSignIns = Pick<
  McpHostSignIns,
  "start" | "status" | "cancel" | "signOut" | "list" | "app" | "saveApp" | "removeApp"
>;

export interface TeamApiConnectors {
  github: Pick<GitHubConnectorService, "status" | "pages" | "connect" | "cancel" | "disconnect" | "repositories">;
  messaging: Pick<
    MessagingService,
    | "slackOverview"
    | "discordOverview"
    | "telegramOverview"
    | "connectSlackWorkspace"
    | "connectDiscordGuild"
    | "connectTelegramChat"
    | "completeSlackWorkspace"
    | "completeDiscordGuild"
    | "disconnectSlackWorkspace"
    | "disconnectDiscordGuild"
    | "disconnectTelegramChat"
    | "reconnect"
    | "setEnabled"
    | "addOrchestrator"
    | "addTelegramOrchestrator"
    | "discordAccess"
    | "listDiscordRoles"
    | "setDiscordAccess"
    | "whatsappOverview"
    | "whatsappLinkState"
    | "startWhatsAppLink"
    | "cancelWhatsAppLink"
    | "disconnectWhatsAppNumber"
    | "addWhatsAppOrchestrator"
    | "listWhatsAppGroups"
    | "addWhatsAppSender"
    | "removeWhatsAppSender"
    | "answerWhatsAppRequest"
    | "setWhatsAppOwnNumber"
    | "setWhatsAppWorkingMessage"
    | "setWhatsAppStatusReactions"
  >;
}

export type TeamApiSignInRelay = Pick<
  SignInRelayHost,
  "startMcp" | "startProvider" | "startProviderAccount" | "startLink" | "status" | "complete" | "cancel"
>;

export type TeamApiProviderHostSignIns = Pick<ProviderHostSignIns, "start" | "status" | "cancel">;

export type TeamApiProviderAccounts = Pick<
  ProviderAccountsHost,
  | "list"
  | "models"
  | "pools"
  | "setPool"
  | "liveVoiceAccount"
  | "setLiveVoiceAccount"
  | "usage"
  | "startSignIn"
  | "signInStatus"
  | "cancelSignIn"
  | "connectKey"
  | "startCodeSignIn"
  | "submitCodeSignIn"
  | "codeSignInStatus"
  | "cancelCodeSignIn"
  | "rename"
  | "remove"
  | "setAgentAccount"
>;

export type TeamApiProviderUsageResets = Pick<AgentService, "providerUsageResets" | "resetProviderUsage">;

export type TeamApiProviderSignOut = Pick<AgentService, "signOutProvider">;

export type TeamApiStorage = Pick<StorageUsageService, "usage" | "deleteFile" | "clear" | "disk" | "diskUse">;
export type TeamApiLibraryFolders = Pick<
  LibraryFoldersService,
  "snapshot" | "change" | "removeAgent" | "removeFiles" | "workflowFiles"
>;
export type TeamApiWorkflowFolders = Pick<WorkflowFoldersService, "read" | "change">;
export type TeamApiMachine = Pick<
  MachineAlertMonitor,
  "metrics" | "alerts" | "setAlerts" | "canBeResponsible" | "pending" | "subscribe"
>;
export interface TeamApiBackgroundProcesses {
  list(): ReturnType<typeof listBackgroundProcesses>;
  stop(id: string): ReturnType<typeof stopBackgroundProcess>;
}
export type TeamApiHostedSites = Pick<HostedSiteDesktopService, "listServerSites" | "deleteServerSite">;

export type TeamApiHiddenAgents = Pick<AgentService, "listHiddenAgents" | "setAgentHidden">;

export type TeamApiRoutineRunPlaces = Pick<AgentService["routineRecords"], "list" | "get" | "save">;

export interface TeamApiAgentNotificationLevels {
  snapshot(memberId: string, hidden: ReadonlySet<string>): AgentNotificationLevelsSnapshot;
  set(memberId: string, input: SetAgentNotificationLevelInput): Effect.Effect<unknown, PreferenceFileFailure>;
  setServer(memberId: string, level: ServerNotificationLevel | null): Effect.Effect<unknown, PreferenceFileFailure>;
  subscribe(listener: (memberId: string) => void): () => void;
}

export interface TeamApiSidebarPins {
  snapshot(memberId: string, hidden: ReadonlySet<string>): SidebarPinsSnapshot;
  set(
    memberId: string,
    items: SidebarPin[],
    hidden: ReadonlySet<string>,
  ): Effect.Effect<SidebarPinsSnapshot, PreferenceFileFailure>;
  seed(
    memberId: string,
    items: SidebarPin[],
    hidden: ReadonlySet<string>,
  ): Effect.Effect<SidebarPinsSnapshot, PreferenceFileFailure>;
  subscribe(listener: (memberId: string) => void): () => void;
}

export type TeamApiAgentTasks = Pick<
  AgentService,
  | "listAgents"
  | "listTasks"
  | "listArchivedTasks"
  | "readTask"
  | "readTaskPage"
  | "readTaskAround"
  | "startTask"
  | "sendMessage"
  | "stopTask"
  | "closeTask"
  | "reopenTask"
  | "renameTask"
  | "deleteTask"
  | "listTaskReads"
  | "markTaskRead"
  | "branchTask"
  | "runQueuedMessageAsTask"
>;

export type TeamApiBrowserProfiles = BrowserProfileService;

export type TeamApiAgentImport = Pick<
  AgentImportService,
  "stageUpload" | "openUpload" | "writeUpload" | "stageParts" | "apply" | "discard"
>;

export interface TeamApiHermesImport extends Pick<HermesImportService, "apply" | "discard"> {
  read: () => ReturnType<HermesImportService["stage"]>;
}

export type TeamApiInstanceTransfer = Pick<
  InstanceTransferService,
  "summary" | "exportForMember" | "stageUpload" | "apply" | "discard" | "chunks"
>;

export type TeamApiRoutineFlows = Pick<
  RoutineFlowsHandle,
  "canvas" | "savePosition" | "removePosition" | "connect" | "disconnect" | "updateLink" | "agentsOf" | "stopRun"
>;

export type TeamApiWorkflows = Pick<
  WorkflowsHandle,
  | "list"
  | "listWithGraphs"
  | "get"
  | "create"
  | "rename"
  | "setPaused"
  | "remove"
  | "saveGraph"
  | "versions"
  | "restoreVersion"
  | "versionGraph"
  | "startRun"
  | "runStep"
  | "stopStep"
  | "stopRun"
  | "retryStep"
  | "decide"
  | "runs"
  | "run"
  | "stepSettings"
  | "workflowOf"
  | "githubHistory"
  | "githubLastEvent"
  | "keepPicture"
  | "mediaProviders"
  | "mediaCredits"
  | "mediaCatalog"
  | "mediaPrice"
> &
  Pick<HostEventsService, "rotateWorkflowSecret"> & {
    github?: WorkflowGitHubDirectory;
    files?: Pick<WorkflowFileExporter, "source">;
  };

export type TeamApiCrm = CrmPeopleOperations;

interface TeamApiDefaultProvider {
  get(): Effect.Effect<ProviderDefaultSetting, { readonly cause: unknown }>;
  set(input: SaveSetupInput): Effect.Effect<ProviderDefaultSetting, { readonly cause: unknown }>;
}

export interface ProviderDefaultSetting {
  provider: AgentProviderId | null;
  model: AgentModelId | null;
}

interface TeamApiLocalServer {
  serverId: string;
  name: string;
  published: boolean;
}

interface TeamApiLocalServerList {
  servers: TeamApiLocalServer[];
  limit: number;
}

export interface TeamApiAdmin {
  acpRegistry?: {
    [Method in "search" | "listInstalled" | "status" | "install" | "cancel" | "uninstall"]: OmitThisParameter<
      AcpRegistry[Method]
    >;
  };
  customAgents?: Pick<CustomAgentChanges, "list" | "save" | "remove">;
  release?: Pick<HostReleaseService, "snapshot" | "check">;
  agents?: AgentAdminSettingsService;
  agentHost?: AgentHostSettingsService;
  agentDefaults?: AgentDefaultsSettingsService;
  folders?: Omit<AgentFolders, "requireAgent">;
  channelFolders?: Pick<ChannelFolders, "hasChannel" | "list" | "add" | "remove" | "browse">;
  instructions?: Pick<AgentInstructionsFiles, "listAgents" | "read" | "save">;
  sessionSettings?: Pick<
    AgentService,
    "readAgentSessionSettings" | "setAgentSessionSetting" | "resetAgentSessionSetting"
  >;
  skills?: Pick<SkillMarketplaceService, "listInstalled" | "install" | "uninstall" | "setEnabled" | "readGithub">;
  sharedTables?: Pick<AgentService, "listTables" | "deleteTable">;
  marketplaceAgents?: Pick<AgentMarketplaceService, "install">;
  agentTemplates?: Pick<AgentTemplateService, "install" | "preview" | "publish" | "unpublish">;
  providers?: TeamApiProviders;
  identity?: TeamApiHostIdentity;
  update?: Pick<RequestedUpdate, "snapshot" | "check" | "start" | "requestWhenIdle" | "cancel" | "changeSettings">;
  restart?: { request(memberId: string): void };
  ownerTransfer?: true;
  timezone?: Pick<ServerTimezonePreferenceStore, "get" | "set">;
  voiceModel?: Pick<HostVoiceModelService, "snapshot" | "change">;
  signalHome?: Pick<HostSignalHomeService, "snapshot" | "set">;
  turnLimits?: Pick<HostTurnLimitsPreferenceStore, "get" | "set">;
  personality?: Pick<ServerPersonalityPreferenceStore, "get" | "set">;
  hostKey?: { rotate(): Effect.Effect<{ publicKey: string }, RemoteWorkflowError> };
  localServers?: {
    list(): Effect.Effect<TeamApiLocalServerList, RemoteWorkflowError>;
    create(name: string): Effect.Effect<TeamApiLocalServer, RemoteWorkflowError>;
    delete(serverId: string): Effect.Effect<void, RemoteWorkflowError>;
  };
  memoryLimit?: AgentMemoryLimitSetting;
  memoryReview?: MemoryReviewPreferenceStore;
  skillLearning?: SkillLearningPreferenceStore;
  browsingMemory?: BrowsingMemoryPreferenceStore;
  promptCacheTtl?: Pick<PromptCacheTtlPreferenceStore, "get" | "set">;
  claudeUserSetup?: ClaudeUserSetupControl;
  cacheExpiryCompaction?: CacheExpiryCompactionControl;
  claudeCompactWindow?: ClaudeCompactWindowControl;
  providerEnvironment?: Pick<ProviderEnvironmentControl, "get" | "set">;
  providerDetection?: {
    detection: Pick<ProviderDetection, "scanModelServers" | "scanAgents" | "discoverModels">;
    settings: Pick<ProviderDetectionSettingsStore, "get" | "set">;
  };
  modelVisibility?: Pick<ModelVisibility, "settings" | "set" | "picker" | "listings" | "kept">;
  defaultProvider?: TeamApiDefaultProvider;
  routineResults?: TeamApiRoutineResults;
  routineRunCommand?: Pick<AgentService, "listAgents" | "automationRunCommand">;
}

interface TeamApiRoutineResults {
  options(): Effect.Effect<RoutineResultConnectionOption[]>;
  destination(
    input: RoutineResultRoutineInput,
  ): Effect.Effect<RoutineResultDestination | null, { readonly cause: unknown }>;
  setDestination(
    input: SetRoutineResultDestinationInput,
  ): Effect.Effect<RoutineResultDestination | null, { readonly cause: unknown }>;
}

interface TeamApiHostIdentity {
  updateIdentity(input: UpdateHostIdentityInput): Effect.Effect<void, RemoteWorkflowError>;
}

interface TeamApiProviders {
  service: Pick<
    AgentService,
    | "startProviderCodeLogin"
    | "submitProviderCodeLogin"
    | "cancelProviderCodeLogin"
    | "changeProviderCredential"
    | "clearProviderCredential"
    | "signInCodexWithApiKey"
    | "getStatus"
    | "setProviderOn"
  >;
  credentials: Pick<ProviderCredentialStore, "status" | "set" | "clear">;
  runtimes: Pick<
    ProviderRuntimeManager,
    "getStatus" | "download" | "cancel" | "checkForUpdates" | "startKeyProviderCli"
  >;
  customProviders: PeerCustomProviderChanges;
  pasteSignIn: boolean;
}

export type TeamApiMailbox = Pick<MailboxStore, "resolveAttachment">;
export interface TeamApiAttachmentPreviews {
  file(attachmentId: string, source: PreviewFile): Effect.Effect<PreviewFile | null>;
}
export type TeamApiSidebarLayout = Pick<
  SidebarLayoutStore,
  "getSnapshot" | "mutate" | "removeAgent" | "placeDuplicateAfter" | "withProfileAssignment"
> & {
  on: (event: "changed", listener: (layout: SidebarLayoutSnapshot) => void) => void;
  off: (event: "changed", listener: (layout: SidebarLayoutSnapshot) => void) => void;
};
export type TeamApiBrowser = Pick<
  BrowserHost,
  | "listTabs"
  | "getControlState"
  | "open"
  | "activate"
  | "navigate"
  | "reload"
  | "close"
  | "capturePreview"
  | "setVisible"
  | "getDisplayState"
  | "loadUrl"
  | "isPrivate"
  | "takeUserControl"
  | "releaseUserControl"
  | "releaseUserControlHeldBy"
  | "releaseUserControlRefused"
  | "startTeach"
  | "stopTeach"
  | "stop"
  | "importSignIn"
  | "startView"
  | "dispatchViewInput"
  | "copyViewSelection"
>;
export type TeamApiBrowserView = Pick<
  BrowserViewGateway,
  | "handlesUpgrade"
  | "handleUpgrade"
  | "stop"
  | "createSession"
  | "closeMemberSession"
  | "revokeTeamSession"
  | "closeRefusedSessions"
>;
export type TeamApiRemoteScreen = Pick<
  RemoteScreenGateway,
  | "handlesUpgrade"
  | "handleUpgrade"
  | "handlesHttp"
  | "handleHttp"
  | "stop"
  | "capabilities"
  | "createSession"
  | "selectDisplay"
  | "closeMemberSession"
  | "revokeTeamSession"
  | "revokeMember"
> &
  Partial<Pick<RemoteScreenGateway, "checkSetup" | "test">>;

export type TeamApiOnePasswordConnector = Pick<
  OnePasswordConnectorService,
  "status" | "refreshLogins" | "connectWithToken" | "disconnect"
>;

export type TeamApiBitwardenConnector = Pick<BitwardenConnectorService, "status" | "connectWithApiKey" | "disconnect">;

export type TeamApiPasswordManagers = Pick<
  PasswordManagersService,
  "list" | "refusal" | "connect" | "cancel" | "disconnect"
>;

export type TeamApiVault = VaultService;

export type TeamApiLiveVoice = Pick<AgentService, "startLiveVoice" | "stopLiveVoice"> & {
  subscribe(listener: (event: VoiceLiveEvent, memberId: string | null) => void): () => void;
};

export interface TeamApiVoiceTranscription {
  transcribe(audio: Uint8Array): Effect.Effect<VoiceTranscriptionResult, VoiceOperationError>;
}

export type TeamApiClientBrowser = Pick<ClientBrowserHub, "setPresence" | "resolve" | "sessionEnded" | "subscribe">;

export type TeamApiAgentAccess = Pick<AgentAccessStore, "copyAgent" | "get" | "levels" | "set" | "subscribe">;
export type TeamApiServerAudit = Pick<ServerAuditStore, "read">;

export interface TeamApiOptions {
  events?: HostEventsApi | undefined;
  channels?: ChannelService | undefined;
  mcpServers?: TeamApiMcpServers | undefined;
  mcpServerOwners?: TeamApiMcpServerOwners | undefined;
  mcpAccess?: TeamApiMcpAccess | undefined;
  mcpSignIns?: TeamApiMcpSignIns | undefined;
  signInRelay?: TeamApiSignInRelay | undefined;
  connectors?: TeamApiConnectors | undefined;
  onePasswordConnector?: TeamApiOnePasswordConnector | undefined;
  bitwardenConnector?: TeamApiBitwardenConnector | undefined;
  passwordManagers?: TeamApiPasswordManagers | undefined;
  vault?: TeamApiVault | undefined;
  providerHostSignIns?: TeamApiProviderHostSignIns | undefined;
  providerAccounts?: TeamApiProviderAccounts | undefined;
  providerUsageResets?: TeamApiProviderUsageResets | undefined;
  providerSignOut?: TeamApiProviderSignOut | undefined;
  mcpToolRuntimePreparation?: McpToolRuntimePreparation;
  storage?: TeamApiStorage;
  libraryFolders?: TeamApiLibraryFolders;
  workflowFolders?: TeamApiWorkflowFolders;
  machine?: TeamApiMachine;
  backgroundProcesses?: TeamApiBackgroundProcesses;
  liveVoice?: TeamApiLiveVoice;
  voiceTranscription?: TeamApiVoiceTranscription;
  clientBrowser?: TeamApiClientBrowser;
  hostedSites?: TeamApiHostedSites;
  agentImport?: TeamApiAgentImport;
  hermesImport?: TeamApiHermesImport;
  instanceTransfer?: TeamApiInstanceTransfer;
  routineFlows?: TeamApiRoutineFlows;
  workflows?: TeamApiWorkflows;
  crm?: TeamApiCrm;
  hiddenAgents?: TeamApiHiddenAgents;
  routineRunPlaces?: TeamApiRoutineRunPlaces;
  agentNotificationLevels?: TeamApiAgentNotificationLevels;
  sidebarPins?: TeamApiSidebarPins;
  agentAccess?: TeamApiAgentAccess;
  serverAudit?: TeamApiServerAudit;
  agentTasks?: TeamApiAgentTasks;
  browserProfiles?: TeamApiBrowserProfiles;
  admin?: TeamApiAdmin;
  appVersion?: string;
  store: TeamStore;
  agents: TeamApiAgents;
  agentsReady?: (() => Effect.Effect<void>) | undefined;
  skills?: Pick<SkillMarketplaceService, "listInstalledForChatTags"> | undefined;
  sidebarLayout?: TeamApiSidebarLayout | undefined;
  mailbox: TeamApiMailbox;
  attachmentPreviews?: TeamApiAttachmentPreviews | undefined;
  browser: TeamApiBrowser;
  browserView?: TeamApiBrowserView | undefined;
  remoteScreen?: TeamApiRemoteScreen | undefined;
  remoteControlAccess?: (() => RemoteControlAccess) | undefined;
  redeemCentralTicket?: (
    ticket: string,
    serverId: string,
  ) => Effect.Effect<CentralAuthUser | null, RemoteWorkflowError>;
  onPresence?: ((snapshot: TeamPresenceSnapshot) => void) | undefined;
  chat?: TeamChatStore | undefined;
  onDirectMessage?: ((event: DirectMessageRealtimeEvent) => void) | undefined;
  onDirectTyping?: ((event: DirectTypingRealtimeEvent) => void) | undefined;
  createInvite?: OmitThisParameter<HostService["createInvite"]> | undefined;
  updateMember?: OmitThisParameter<HostService["updateMember"]> | undefined;
  removeMember?: OmitThisParameter<HostService["removeMember"]> | undefined;
  onSessionRevoked?: ((sessionId: string) => Effect.Effect<void, RemoteWorkflowError>) | undefined;
  liveActivityPush?: LiveActivityPushService | undefined;
  pushNotifications?: PushNotificationService | undefined;
  focusUse?: boolean | undefined;
  rateLimitCapacity?: number | undefined;
  now?: (() => number) | undefined;
  logger?: Logger | undefined;
}
