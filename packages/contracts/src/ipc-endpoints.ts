import type { AgentProviderRef, DownloadableProviderId, ManagedProviderId } from "./agent-providers";
import type { AppAppearancePreference, SetAppAppearancePreferenceInput } from "./app-appearance";
import type { AppInterfaceSizePreference, SetAppInterfaceSizePreferenceInput } from "./app-interface-size";
import type { AppLanguagePreference, SetAppLanguagePreferenceInput } from "./app-language";
import type { AppLogoColorPreference, SetAppLogoColorPreferenceInput } from "./app-logo-color";
import type { BillingPortalRequest, BillingState, BillingStorageRequest } from "./billing";
import type { BillingDetails, BillingDetailsRequest } from "./billing-details";
import type { CreditActivity, CreditCheckoutRequest, CreditsState, CreditTransferRequest } from "./credits";
import type { CustomServerCheckoutRequest, CustomServerCheckoutResult } from "./custom-server-plans";
import type {
  CreateHostedServerInput,
  DeleteHostedServerInput,
  HostedServerCatalog,
  HostedServerLifecycleInput,
  HostedServerList,
  HostedServerSummary,
  ServerClaim,
} from "./hosted-servers";
import type {
  AcpRegistryEntry,
  AcpRegistryInstallation,
  AcpRegistryInstallInput,
  AcpRegistryOperation,
} from "./ipc-acp-registry";
import type { AgentAccessChange, AgentAccessSnapshot } from "./ipc-agent-access";
import type {
  AddedAgent,
  AgentAdminSettings,
  AgentBackupModelSettings,
  AgentBuiltinMemorySettings,
  AgentDefaultsOverview,
  AgentFastModeSettings,
  AgentHostSettings,
  AgentNewChatSettings,
  AgentPlanCardSettings,
  SetAgentDefaultChoiceInput,
  UpdateAgentAdminSettingsInput,
  UpdateAgentBackupModelsInput,
  UpdateAgentBuiltinMemoryInput,
  UpdateAgentDefaultsInput,
  UpdateAgentFastModeInput,
  UpdateAgentHostSettingsInput,
  UpdateAgentNewChatInput,
  UpdateAgentPlanCardInput,
} from "./ipc-agent-admin";
import type { AgentAnalytics, AgentAnalyticsInput } from "./ipc-agent-analytics";
import type {
  AgentDockAction,
  AgentDockDisplayInfo,
  AgentDockDragPhase,
  AgentDockExtent,
  AgentDockInputRect,
  AgentDockOffset,
  AgentDockPresentation,
  SetAgentDockInteractiveInput,
  SetAgentDockXWaylandInput,
} from "./ipc-agent-dock";
import type { AgentIpcRequest, ScopedAgentEvent } from "./ipc-agent-events";
import type {
  AddAgentFolderInput,
  AgentExclusionChange,
  AgentFolderBrowse,
  AgentFolderChange,
  AgentFolderInput,
  AgentFolderList,
  BrowseAgentFoldersInput,
  ChooseAgentFolderInput,
} from "./ipc-agent-folders";
import type { AvatarColor, ClientAgentModelOption } from "./ipc-agent-identity";
import type {
  AgentImportPreview,
  AgentImportResult,
  AgentImportSkillSource,
  ApplyAgentImportInput,
} from "./ipc-agent-import";
import type { AgentInstructionsFile, SaveAgentInstructionsInput } from "./ipc-agent-instructions";
import type {
  AgentMemory,
  AgentMemoryLimitPreference,
  AgentMemorySelectionState,
  CreateAgentMemoryInput,
  DeleteAgentMemoryInput,
  HostAgentMemoryLimit,
  HostBrowsingMemory,
  HostMemoryReview,
  SetAgentMemoryInclusionInput,
  UpdateAgentMemoryInput,
} from "./ipc-agent-memories";
import type { AgentNotificationLevelsSnapshot, SetAgentNotificationLevelInput } from "./ipc-agent-notification-levels";
import type {
  AgentProfileDraft,
  GenerateAgentProfileInput,
  SaveAgentProfileInput,
  SaveAgentProfileResult,
} from "./ipc-agent-profile";
import type { AgentRuntimePrompt, AgentRuntimeSnapshot } from "./ipc-agent-runtime";
import type {
  AgentSessionSettings,
  ResetAgentSessionSettingInput,
  SetAgentSessionSettingInput,
} from "./ipc-agent-session-settings";
import type { AskSideQuestionInput } from "./ipc-agent-side-question";
import type {
  AccountUsage,
  AgentProviderId,
  AgentStatus,
  ConnectProviderAccountInput,
  ConnectProviderAccountKeyInput,
  HostProviderAccounts,
  PasteProviderRelaySignInInput,
  ProviderAccountCodeLoginStart,
  ProviderAccountCodeLoginStatus,
  ProviderApiKeyState,
  ProviderCodeLoginStart,
  ProviderHostSignInStatus,
  ProviderRelaySignInStatus,
  ProviderUsageResetOutcome,
  ProviderUsageResets,
  RemoveProviderAccountInput,
  RenameProviderAccountInput,
  ResetProviderUsageInput,
  SetLiveVoiceAccountInput,
  SetProviderAccountPoolInput,
  SetProviderApiKeyInput,
  SubmitProviderAccountCodeLoginInput,
  SubmitProviderCodeLoginInput,
} from "./ipc-agent-status";
import type {
  AgentTask,
  AgentTaskInput,
  AgentTaskPage,
  AgentTaskReadState,
  AgentTasksSnapshot,
  AgentTaskWindow,
  ArchivedAgentTasksPage,
  BranchAgentTaskInput,
  ListArchivedAgentTasksInput,
  MarkAgentTaskReadInput,
  ReadAgentTaskAroundInput,
  ReadAgentTaskPageInput,
  RenameAgentTaskInput,
  RunQueuedMessageAsTaskInput,
  StartAgentTaskInput,
} from "./ipc-agent-tasks";
import type {
  AgentTemplateDetail,
  AgentTemplatePreview,
  AgentTemplatePublication,
  InstallAgentTemplateInput,
  InstallAgentTemplateResult,
  PublishAgentTemplateInput,
} from "./ipc-agent-templates";
import type { AgentWaitsSnapshot, CancelAgentWaitInput } from "./ipc-agent-waits";
import type {
  AgentDefaults,
  AvatarImageInput,
  ClientAgentSummary,
  CreateAgentInput,
  DuplicateAgentResult,
  SetAgentAvatarInput,
  UpdateAgentInput,
} from "./ipc-agents";
import type {
  AnalyticsPreference,
  AppInfo,
  AppSetupState,
  BackgroundProcess,
  CentralAuthState,
  ChatWindowTarget,
  CompanySignInScimToken,
  CompanySignInSettings,
  ComputerUseHighlightPlacement,
  ComputerUsePermissionApp,
  ComputerUseState,
  ExportResult,
  ExternalDestination,
  HostDefaultProvider,
  HostUpdateSettingsChange,
  HostUpdateStatus,
  IdleRestartTarget,
  MacAutomationResult,
  MacAutomationTarget,
  MacPermissionId,
  ProviderRuntimeSnapshot,
  RendererTimingReport,
  SaveSetupInput,
  SentMessageStats,
  SetAnalyticsPreferenceInput,
  SetCompanySignInEnabledInput,
  TestCompanySignInInput,
  TestCompanySignInResult,
  UpdatePreference,
  UpdatePreferenceChange,
  UpdateRestartMode,
  UpdateStatus,
  VerifyEmailCodeInput,
} from "./ipc-app-auth";
import type { AppBehaviorPreference, AppBehaviorPreferenceChange } from "./ipc-app-behavior";
import type {
  AgentApproval,
  ApprovalAutomationPreference,
  ReadPendingApprovalInput,
  RespondToApprovalInput,
  RespondToBrowserTakeoverInput,
} from "./ipc-approvals";
import type {
  AttachmentDataInput,
  AttachmentDownloadProgress,
  AttachmentImportProgress,
  ChooseAttachmentsInput,
  DownloadAttachmentsInput,
  DraftAttachment,
  FilePreview,
  ImportAttachmentsInput,
  OpenAttachmentInput,
  OpenSharedFileInput,
  OpenWorkspaceFileInput,
  PreviewSharedFileInput,
  PreviewWorkspaceFileInput,
  WorkspaceDirectory,
} from "./ipc-attachments";
import type { BitwardenConnectorStatus, BitwardenHostConnectInput } from "./ipc-bitwarden-connector";
import type {
  BrowserBounds,
  BrowserControlState,
  BrowserDisplayState,
  BrowserLiveViewEvent,
  BrowserLocalSignInEnd,
  BrowserLocalSignInFinish,
  BrowserLocalSignInInput,
  BrowserLocalSignInResult,
  BrowserNavigateInput,
  BrowserOpenInput,
  BrowserPictureInPictureEvent,
  BrowserPreview,
  BrowserTab,
  BrowserTeachStep,
  BrowserTeachStopInput,
  BrowserVisibilityInput,
  BrowserWindowAction,
  BrowserWindowEvent,
  BrowserWindowModel,
} from "./ipc-browser";
import type { BrowserDockAction, BrowserDockFrame, BrowserDockPresentation } from "./ipc-browser-dock";
import type {
  AgentBrowserProfile,
  BrowserProfileList,
  BrowserProfileSummary,
  BrowserTabProfile,
  ClearBrowserDataInput,
  UpdateAgentBrowserProfileInput,
  UpdateBrowserProfileInput,
} from "./ipc-browser-profiles";
import type {
  BrowserComputerSharing,
  BrowserProxyList,
  BrowserProxySummary,
  DeleteBrowserProxyInput,
  SaveBrowserProxyInput,
  SetBrowserProfileProxyInput,
} from "./ipc-browser-proxies";
import type { LocalBrowserSecretResponse } from "./ipc-browser-secret";
import type { CacheExpiryCompactionSetting } from "./ipc-cache-expiry-compaction";
import type {
  BrowseChannelFoldersInput,
  ChannelFolderChange,
  ChannelFolderInput,
  ChannelFolderList,
} from "./ipc-channel-folders";
import type {
  ChannelMemory,
  CreateChannelMemoryInput,
  DeleteChannelMemoryInput,
  UpdateChannelMemoryInput,
} from "./ipc-channel-memories";
import type {
  ChannelRoutine,
  ChannelRoutineRun,
  CreateChannelRoutineInput,
  DeleteChannelRoutineInput,
  ListChannelRoutineRunsInput,
  TestChannelRoutineInput,
  UpdateChannelRoutineInput,
} from "./ipc-channel-routines";
import type {
  Channel,
  ChannelCommand,
  ChannelPage,
  ChannelReadInput,
  ChannelSummary,
  DeleteChannelMessageInput,
  SetChannelImageInput,
} from "./ipc-chat-channels";
import type { ClaudeCompactWindowSetting } from "./ipc-claude-compact-window";
import type { ClaudeUserSetupSetting } from "./ipc-claude-user-setup";
import type {
  CancelMessageLinkInput,
  ConversationFileSearchPage,
  ConversationPage,
  ConversationReadState,
  ConversationSearchPage,
  ConversationSnapshot,
  ConversationWithReadState,
  DeleteConversationMessageInput,
  MarkConversationReadInput,
  MarkConversationUnreadInput,
  OpenMessageLinkInput,
  PasteMessageLinkInput,
  ReadConversationPageInput,
  RespondToPromptInput,
  SearchConversationFilesInput,
  SearchConversationMessagesInput,
  SendMessageInput,
  SetMessageReactionInput,
  WithdrawFeedbackInput,
  WithdrawFeedbackResult,
} from "./ipc-conversations";
import type {
  CrmActivityPage,
  CrmActivityPageInput,
  CrmApplyResult,
  CrmChange,
  CrmCustomerPage,
  CrmCustomerPageInput,
  CrmOverview,
  CrmPaymentPage,
  CrmPaymentPageInput,
  CrmSettings,
  CrmSourceConnectInput,
  CrmSourceInput,
} from "./ipc-crm";
import type {
  CheckCustomAgentInput,
  CustomAgentCheckResult,
  CustomAgentResult,
  CustomAgentSummary,
  CustomAgentUsage,
  DeleteCustomAgentInput,
  DetectedAcpAgent,
  SaveCustomAgentInput,
} from "./ipc-custom-agents";
import type {
  CustomProviderResult,
  CustomProviderSummary,
  DeleteCustomProviderInput,
  SaveCustomProviderInput,
  UpdateCustomProviderInput,
} from "./ipc-custom-providers";
import type {
  BrowserTakeoverPage,
  DynamicIslandAction,
  DynamicIslandGeometry,
  DynamicIslandPreference,
  DynamicIslandPresentation,
  SetDynamicIslandInteractiveInput,
  SetDynamicIslandPreferenceInput,
} from "./ipc-dynamic-island";
import type {
  AgentWebhookSecret,
  EventActivity,
  EventRoutine,
  EventRoutineRef,
  EventRoutineRun,
  EventStatus,
  ListEventActivityInput,
  ListEventRoutineRunsInput,
  ListEventRoutinesInput,
  SaveEventRoutineInput,
  SaveEventRoutineResult,
  SetWebhookSecretInput,
  WebhookSecret,
  WebhookTestResult,
} from "./ipc-events";
import type {
  ExternalLinkBrowser,
  ExternalLinkBrowsers,
  ExternalLinkFallback,
  ExternalLinkPreference,
} from "./ipc-external-links";
import type { GitHubConnectorRepositories, GitHubConnectorStatus } from "./ipc-github-connector";
import type { GithubSkillSource } from "./ipc-github-skills";
import type { ApplyHermesImportInput, HermesImportPreview } from "./ipc-hermes-import";
import type { HiddenAgentsSnapshot, SetAgentHiddenInput } from "./ipc-hidden-agents";
import type { HostAnalytics, HostAnalyticsInput } from "./ipc-host-analytics";
import type { HostPersonality } from "./ipc-host-personality";
import type { HostReleaseStatus } from "./ipc-host-release";
import type { HostSignalHomeSettings } from "./ipc-host-signal-home";
import type { HostTimezoneSettings } from "./ipc-host-timezone";
import type { HostTurnLimits, HostTurnLimitsInput } from "./ipc-host-turn-limits";
import type {
  DeleteHostedSiteInput,
  HostedSiteList,
  HostedSiteSummary,
  PublishHostedSiteInput,
  ReplaceHostedSiteInput,
} from "./ipc-hosted-sites";
import type {
  ApplyInstanceTransferInput,
  CopyInstanceAgentsInput,
  ExportInstanceInput,
  InstanceExportResult,
  InstanceTransferPreview,
  InstanceTransferResult,
  InstanceTransferSummary,
  InstanceTransferUploadProgress,
} from "./ipc-instance-transfer";
import type { LibraryFolderAction, LibraryFoldersSnapshot } from "./ipc-library-folders";
import type { LinkAccountStatus } from "./ipc-link-account";
import type { MachineAlertSettings, MachineMetrics } from "./ipc-machine-resources";
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
import type { McpAccessSnapshot, SetMcpAccessInput } from "./ipc-mcp-access";
import type {
  CancelMcpSignInInput,
  CompleteMcpSignInRelayInput,
  McpServerConfig,
  McpSignInAppInput,
  McpSignInAppState,
  McpSignInRelayPage,
  McpSignInState,
  McpTestResult,
  RemoveMcpServerInput,
  SaveMcpServerInput,
  SaveMcpSignInAppInput,
  SetMcpServerEnabledInput,
  SignOutMcpServerInput,
  TestMcpServerInput,
} from "./ipc-mcp-servers";
import type {
  CreditsHold,
  MediaApprovalRead,
  ReadMediaApprovalInput,
  RespondToCreditsHoldInput,
  RespondToMediaApprovalInput,
} from "./ipc-media-approval";
import type { MediaApprovalCreditsSetting, MediaApprovalCreditsUpdate } from "./ipc-media-approval-credits";
import type { PinnedMessagesSnapshot, SetMessagePinnedInput } from "./ipc-message-pins";
import type {
  AddMessagingOrchestratorInput,
  AddMessagingOrchestratorResult,
  AddSlackOrchestratorInput,
  AddSlackOrchestratorResult,
  AddTelegramOrchestratorInput,
  AddWhatsAppOrchestratorInput,
  AnswerWhatsAppRequestInput,
  ConnectTelegramChatInput,
  DiscordAccess,
  DiscordRoleList,
  HostAddMessagingOrchestratorInput,
  HostDiscordAccessInput,
  HostMessagingConnectInput,
  HostMessagingPlatformInput,
  HostMessagingWorkspaceInput,
  HostSetDiscordAccessInput,
  HostSetMessagingEnabledInput,
  MessagingOverview,
  MessagingWorkspaceInput,
  RemoveWhatsAppSenderInput,
  SetDiscordAccessInput,
  SetMessagingEnabledInput,
  SetSlackEnabledInput,
  SetTelegramEnabledInput,
  SetWhatsAppOwnNumberInput,
  SetWhatsAppSenderReadOnlyInput,
  SetWhatsAppStatusReactionsInput,
  SetWhatsAppWorkingMessageInput,
  SlackOverview,
  SlackWorkspaceInput,
  StartWhatsAppLinkInput,
  TelegramChatInput,
  TelegramOverview,
  WhatsAppGroupList,
  WhatsAppLinkState,
  WhatsAppOverview,
  WhatsAppSenderInput,
} from "./ipc-messaging";
import type { ProviderModelVisibility, ProviderModelVisibilityChange } from "./ipc-model-visibility";
import type {
  NotificationOpenedEvent,
  NotificationPreference,
  WorkflowNotificationOpenedEvent,
} from "./ipc-notifications";
import type {
  OnePasswordConnectInput,
  OnePasswordConnectorStatus,
  OnePasswordHostConnectInput,
} from "./ipc-onepassword-connector";
import type { PasswordManagerConnectInput, PasswordManagerId, PasswordManagerStatus } from "./ipc-password-managers";
import type { PromptCacheTtl, PromptCacheTtlSetting } from "./ipc-prompt-cache";
import type {
  DetectedModelServer,
  DiscoverModelsInput,
  DiscoverModelsResult,
  ProviderDetectionSettings,
} from "./ipc-provider-detection";
import type {
  ProviderEnvironment,
  ProviderEnvironmentProvider,
  ProviderEnvironmentUpdate,
} from "./ipc-provider-environment";
import type {
  AcknowledgeFailedTurnInput,
  BusyMessageModePreference,
  CancelQueuedMessageInput,
  EditQueuedMessageInput,
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
import type {
  RemoteNetworkRoutePreference,
  RemoteNetworkRouteState,
  RemoteSessionReusePreference,
} from "./ipc-remote-sessions";
import type {
  ResendRoutineResultInput,
  RoutineResultConnectionOption,
  RoutineResultDelivery,
  RoutineResultDestination,
  RoutineResultRoutineInput,
  SetRoutineResultDestinationInput,
} from "./ipc-routine-results";
import type {
  CreateRoutineInput,
  DeleteRoutineInput,
  ListRoutineRunsInput,
  Routine,
  RoutineCalendar,
  RoutineCalendarInput,
  RoutineFeed,
  RoutineRun,
  TestRoutineInput,
  UpdateRoutineInput,
} from "./ipc-routines";
import type { ServerAuditLog } from "./ipc-server-audit";
import type { DeleteSharedTableInput, SharedTable } from "./ipc-shared-tables";
import type { SidebarLayoutAction, SidebarLayoutSnapshot } from "./ipc-sidebar-layout";
import type { SetSidebarPinsInput, SidebarPinsSnapshot } from "./ipc-sidebar-pins";
import type {
  CreateLocalSkillInput,
  HostSkillLearning,
  InstalledSkill,
  InstallLocalSkillInput,
  InstallSkillInput,
  LocalSkillRevisionInput,
  MarketplaceSkillDetail,
  MarketplaceSkillPage,
  MarketplaceSkillQuery,
  ReviseLocalSkillInput,
  SaveSkillSuggestionInput,
  SaveSkillSuggestionResult,
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
  ProviderRuntimeDownload,
  RemovableRuntimes,
  StorageDisk,
  StorageUsage,
} from "./ipc-storage";
import type {
  ConfigureHostInput,
  CreateTeamInviteInput,
  DirectConversationPage,
  DirectConversationReadState,
  DirectConversationSnapshot,
  DirectMessage,
  DirectThreadSummary,
  DirectTypingInput,
  HostStatus,
  InvitePreview,
  InviteSummary,
  JoinServerInput,
  LoginServerInput,
  MarkDirectReadInput,
  ReadDirectConversationPageInput,
  RemoteControlPolicy,
  RemoteDesktopConnectInput,
  RemoteDesktopConnectResult,
  RemoteDesktopSelectDisplayInput,
  RemoteDesktopSession,
  ReorderServersInput,
  ScopedDirectMessageEvent,
  ScopedDirectTypingEvent,
  ScopedTeamPresenceSnapshot,
  SendDirectMessageInput,
  ServerSummary,
  SetServerHiddenInput,
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
import type { VaultImportResult, VaultSaveInput, VaultSecretRequest, VaultState, VaultTwoStepCodes } from "./ipc-vault";
import type {
  HostVoiceModel,
  HostVoiceModelChange,
  SpeechApiKeyInput,
  SpeechAudio,
  SpeechInput,
  SpeechModelStatus,
  SpeechSettings,
  VoiceApiKeyInput,
  VoiceLiveEvent,
  VoiceLiveSession,
  VoiceLiveStart,
  VoiceLiveStop,
  VoiceModelRequest,
  VoiceModelStatus,
  VoiceServerConnection,
  VoiceServerProbe,
  VoiceServerSave,
  VoiceServerSettings,
  VoiceSettings,
  VoiceStream,
  VoiceStreamAudio,
  VoiceStreamTranscript,
  VoiceTranscriptionInput,
  VoiceTranscriptionResult,
} from "./ipc-voice";
import type { WorkflowFileSaveResult } from "./ipc-workflow-file";
import type { WorkflowFolderAction, WorkflowFoldersSnapshot } from "./ipc-workflow-folders";
import type {
  WorkflowGitHubCatalog,
  WorkflowGitHubHistory,
  WorkflowGitHubLastEventInput,
  WorkflowGitHubRepositoryInput,
  WorkflowGitHubRepositoryOptions,
} from "./ipc-workflow-github";
import type {
  CreateWorkflowInput,
  DecideWorkflowStepInput,
  RenameWorkflowInput,
  RetryWorkflowStepInput,
  RunWorkflowStepInput,
  SaveWorkflowGraphInput,
  SetWorkflowPausedInput,
  StartWorkflowRunInput,
  WorkflowDetail,
  WorkflowGraph,
  WorkflowMediaCatalog,
  WorkflowMediaCredits,
  WorkflowMediaPrice,
  WorkflowMediaPriceRequest,
  WorkflowMediaProviders,
  WorkflowRunDetail,
  WorkflowRunPage,
  WorkflowRunsInput,
  WorkflowSaveResult,
  WorkflowStep,
  WorkflowStepSettings,
  WorkflowSummary,
  WorkflowTriggerInput,
  WorkflowVersion,
  WorkflowVersionInput,
  WorkflowWebhookSecret,
} from "./ipc-workflows";
import type {
  LicenseCheckoutRequest,
  LicensePlanRequest,
  LicenseRenewalRequest,
  LicenseState,
  LicenseUsersRequest,
} from "./license";
import type { MarketplaceListingLink } from "./marketplace-links";
import type { AccountSession, MobileConnectedDevice, MobileConnectLink, MobileConnectTicket } from "./mobile-connect";
import type { AcceptedOwnerTransfer, OwnerTransfer } from "./owner-transfer";
import type { ReferralPageRequest, ReferralState } from "./referral";
import type { AgentActiveQueues } from "./team-protocol/agent-active-queues-v1";

declare const payloadType: unique symbol;
declare const resultType: unique symbol;
declare const untypedBrand: unique symbol;
declare const serverArgument: unique symbol;

export interface Untyped {
  readonly [untypedBrand]: true;
}

export type ServerScope = "payload" | "empty";

export type ServerArgument = "optional" | "required";

export interface RequestEndpoint<Channel extends string = string, Payload = unknown, Result = unknown> {
  readonly kind: "request";
  readonly channel: Channel;
  readonly scope?: ServerScope;
  readonly [payloadType]?: Payload;
  readonly [resultType]?: Result;
}

export interface ScopedRequestEndpoint<
  Channel extends string = string,
  Inner = unknown,
  Result = unknown,
  Server extends ServerArgument = ServerArgument,
> extends RequestEndpoint<Channel, AgentIpcRequest<Inner>, Result> {
  readonly scope: ServerScope;
  readonly [serverArgument]?: Server;
}

export interface EventEndpoint<Channel extends string = string, Payload = unknown> {
  readonly kind: "event";
  readonly channel: Channel;
  readonly [payloadType]?: Payload;
}

export type IpcEndpoint = RequestEndpoint | EventEndpoint;
export type IpcEndpointGroup = Readonly<Record<string, IpcEndpoint>>;

function request<Payload, Result>(): <Channel extends string>(
  channel: Channel & ([Payload] extends [AgentIpcRequest<unknown>] ? never : unknown),
) => RequestEndpoint<Channel, Payload, Result> {
  return (channel) => ({ kind: "request", channel });
}

function scopedRequest<Inner, Result, Server extends ServerArgument = "optional">(): <Channel extends string>(
  channel: Channel,
) => ScopedRequestEndpoint<Channel, Inner, Result, Server> {
  return (channel) => ({ kind: "request", channel, scope: "payload" });
}

function scopedQuery<Result, Server extends ServerArgument = "optional">(): <Channel extends string>(
  channel: Channel,
) => ScopedRequestEndpoint<Channel, null, Result, Server> {
  return (channel) => ({ kind: "request", channel, scope: "empty" });
}

function event<Payload>(): <Channel extends string>(channel: Channel) => EventEndpoint<Channel, Payload> {
  return (channel) => ({ kind: "event", channel });
}

function untypedRequest<Channel extends string>(channel: Channel): RequestEndpoint<Channel, Untyped, Untyped> {
  return { kind: "request", channel };
}

export const IPC_ENDPOINTS = {
  app: {
    getAppInfo: request<undefined, AppInfo>()("app:get-info"),
    getSetupState: request<undefined, AppSetupState>()("app:get-setup-state"),
    saveSetup: request<SaveSetupInput, AppSetupState>()("app:save-setup"),
    setupState: event<AppSetupState>()("app:setup-state"),
    getAnalyticsPreference: request<undefined, AnalyticsPreference>()("app:get-analytics-preference"),
    getAnalyticsDefault: request<undefined, AnalyticsPreference>()("app:get-analytics-default"),
    analyticsPreference: event<AnalyticsPreference>()("app:analytics-preference"),
    setAnalyticsPreference: request<SetAnalyticsPreferenceInput, AnalyticsPreference>()("app:set-analytics-preference"),
    reportRendererTiming: request<RendererTimingReport, void>()("app:report-renderer-timing"),
    getApprovalAutomation: request<undefined, ApprovalAutomationPreference>()("app:get-approval-automation"),
    approvalAutomation: event<ApprovalAutomationPreference>()("app:approval-automation"),
    getBusyMessageModePreference: request<undefined, BusyMessageModePreference>()("app:get-busy-message-mode"),
    getAgentDefaults: request<undefined, AgentDefaults>()("app:get-agent-defaults"),
    getAgentMemoryLimitPreference: request<undefined, AgentMemoryLimitPreference>()("app:get-agent-memory-limit"),
    agentMemoryLimitPreference: event<AgentMemoryLimitPreference>()("app:agent-memory-limit"),
    getRemoteSessionReusePreference: request<undefined, RemoteSessionReusePreference>()("app:get-remote-session-reuse"),
    setRemoteSessionReusePreference: request<RemoteSessionReusePreference, RemoteSessionReusePreference>()(
      "app:set-remote-session-reuse",
    ),
    getRemoteNetworkRoute: request<undefined, RemoteNetworkRouteState>()("app:get-remote-network-route"),
    setRemoteNetworkRoute: request<RemoteNetworkRoutePreference, RemoteNetworkRouteState>()(
      "app:set-remote-network-route",
    ),
    getAppBehaviorPreference: request<undefined, AppBehaviorPreference>()("app:get-behavior-preference"),
    setAppBehaviorPreference: request<AppBehaviorPreferenceChange, AppBehaviorPreference>()(
      "app:set-behavior-preference",
    ),
    getAppLanguagePreference: request<undefined, AppLanguagePreference>()("app:get-language-preference"),
    setAppLanguagePreference: request<SetAppLanguagePreferenceInput, AppLanguagePreference>()(
      "app:set-language-preference",
    ),
    appLanguagePreference: event<AppLanguagePreference>()("app:language-preference"),
    getAppLogoColorPreference: request<undefined, AppLogoColorPreference>()("app:get-logo-color-preference"),
    setAppLogoColorPreference: request<SetAppLogoColorPreferenceInput, AppLogoColorPreference>()(
      "app:set-logo-color-preference",
    ),
    appLogoColorPreference: event<AppLogoColorPreference>()("app:logo-color-preference"),
    getAppAppearancePreference: request<undefined, AppAppearancePreference>()("app:get-appearance-preference"),
    setAppAppearancePreference: request<SetAppAppearancePreferenceInput, AppAppearancePreference>()(
      "app:set-appearance-preference",
    ),
    appAppearancePreference: event<AppAppearancePreference>()("app:appearance-preference"),
    listInstalledFonts: request<undefined, string[]>()("app:list-installed-fonts"),
    getAppInterfaceSizePreference: request<undefined, AppInterfaceSizePreference>()(
      "app:get-interface-size-preference",
    ),
    setAppInterfaceSizePreference: request<SetAppInterfaceSizePreferenceInput, AppInterfaceSizePreference>()(
      "app:set-interface-size-preference",
    ),
    appInterfaceSizePreference: event<AppInterfaceSizePreference>()("app:interface-size-preference"),
    openSettings: event<undefined>()("app:open-settings"),
    openUpdateSettings: event<undefined>()("app:open-update-settings"),
    openExternal: request<ExternalDestination, void>()("app:open-external"),
    getSentMessageStats: request<undefined, SentMessageStats>()("app:get-sent-message-stats"),
    openUrl: request<string, void>()("app:open-url"),
    getExternalLinkPreference: request<undefined, ExternalLinkPreference>()("app:get-external-link-preference"),
    setExternalLinkPreference: request<ExternalLinkPreference, ExternalLinkPreference>()(
      "app:set-external-link-preference",
    ),
    listExternalLinkBrowsers: request<undefined, ExternalLinkBrowsers>()("app:list-external-link-browsers"),
    chooseExternalLinkApp: request<undefined, ExternalLinkBrowser | null>()("app:choose-external-link-app"),
    externalLinkFallback: event<ExternalLinkFallback>()("app:external-link-fallback"),
    openChatWindow: request<ChatWindowTarget, void>()("app:open-chat-window"),
    getChatWindows: request<undefined, ChatWindowTarget[]>()("app:get-chat-windows"),
    chatWindows: event<ChatWindowTarget[]>()("app:chat-windows"),
    quitShortcutHint: event<ClientAgentSummary[] | null>()("app:quit-shortcut-hint"),
  },
  maintenance: {
    exportData: request<undefined, ExportResult>()("maintenance:export-data"),
    exportDiagnostics: request<undefined, ExportResult>()("maintenance:export-diagnostics"),
  },
  providers: {
    setProviderOn: request<{ provider: AgentProviderId; on: boolean }, AgentStatus>()("app:set-provider-on"),
    connectProvider: request<AgentProviderId, AgentStatus>()("app:connect-provider"),
    connectProviderInMainlandChina: request<AgentProviderId, AgentStatus>()("app:connect-provider-mainland-china"),
    cancelProviderSignIn: request<AgentProviderId, AgentStatus>()("app:cancel-provider-sign-in"),
    refreshAgentProviders: request<{ automatic: boolean } | undefined, AgentStatus>()("app:refresh-agent-providers"),
    restartProvider: request<AgentProviderId, AgentStatus>()("app:restart-provider"),
    cancelProviderRestart: request<AgentProviderId, AgentStatus>()("app:cancel-provider-restart"),
    chooseInstalledCli: request<{ provider: ManagedProviderId; installed: boolean }, AgentStatus>()(
      "app:choose-installed-cli",
    ),
    updateProviderCli: request<ManagedProviderId, AgentStatus>()("app:update-provider-cli"),
    setProviderApiKey: request<SetProviderApiKeyInput, AgentStatus>()("app:set-provider-api-key"),
    clearProviderApiKey: request<AgentProviderId, AgentStatus>()("app:clear-provider-api-key"),
    getProviderApiKeyState: request<AgentProviderId, ProviderApiKeyState>()("app:get-provider-api-key-state"),
    startProviderCodeLogin: request<AgentProviderId, ProviderCodeLoginStart>()("app:start-provider-code-login"),
    cancelProviderCodeLogin: request<AgentProviderId, AgentStatus>()("app:cancel-provider-code-login"),
    connectProviderAccount: request<ConnectProviderAccountInput, AgentStatus>()("app:connect-provider-account"),
    connectProviderAccountKey: request<ConnectProviderAccountKeyInput, AgentStatus>()(
      "app:connect-provider-account-key",
    ),
    cancelProviderAccountSignIn: request<RemoveProviderAccountInput, AgentStatus>()(
      "app:cancel-provider-account-sign-in",
    ),
    renameProviderAccount: request<RenameProviderAccountInput, AgentStatus>()("app:rename-provider-account"),
    removeProviderAccount: request<RemoveProviderAccountInput, AgentStatus>()("app:remove-provider-account"),
    setProviderAccountPool: request<SetProviderAccountPoolInput, AgentStatus>()("app:set-provider-account-pool"),
    setLiveVoiceAccount: request<SetLiveVoiceAccountInput, AgentStatus>()("app:set-live-voice-account"),
    signOutProvider: request<AgentProviderId, AgentStatus>()("app:sign-out-provider"),
    providerUsageResets: request<AgentProviderId, ProviderUsageResets[]>()("app:provider-usage-resets"),
    resetProviderUsage: request<ResetProviderUsageInput, ProviderUsageResetOutcome>()("app:reset-provider-usage"),
  },
  providerRuntimes: {
    getStatus: request<undefined, ProviderRuntimeSnapshot>()("provider-runtimes:get-status"),
    download: request<DownloadableProviderId, ProviderRuntimeSnapshot>()("provider-runtimes:download"),
    cancel: request<DownloadableProviderId, ProviderRuntimeSnapshot>()("provider-runtimes:cancel"),
    measureDownload: request<ManagedProviderId, ProviderRuntimeDownload>()("provider-runtimes:measure-download"),
    removeDownload: request<ManagedProviderId, ProviderRuntimeSnapshot>()("provider-runtimes:remove-download"),
    checkForUpdates: request<undefined, ProviderRuntimeSnapshot>()("provider-runtimes:check-for-updates"),
    event: event<ProviderRuntimeSnapshot>()("provider-runtimes:event"),
  },
  voice: {
    getModelStatus: request<undefined, VoiceModelStatus>()("voice:get-model-status"),
    getModelStatuses: request<undefined, VoiceModelStatus[]>()("voice:get-model-statuses"),
    prepareModel: request<undefined, VoiceModelStatus>()("voice:prepare-model"),
    downloadModel: request<VoiceModelRequest, VoiceModelStatus>()("voice:download-model"),
    cancelModelDownload: request<VoiceModelRequest, VoiceModelStatus>()("voice:cancel-model-download"),
    removeModel: request<VoiceModelRequest, VoiceModelStatus>()("voice:remove-model"),
    getSettings: request<undefined, VoiceSettings>()("voice:get-settings"),
    setSettings: request<VoiceSettings, VoiceSettings>()("voice:set-settings"),
    transcribe: request<VoiceTranscriptionInput, VoiceTranscriptionResult>()("voice:transcribe"),
    setApiKey: request<VoiceApiKeyInput, VoiceModelStatus>()("voice:set-api-key"),
    startStream: request<undefined, VoiceStream>()("voice:start-stream"),
    appendStream: request<VoiceStreamAudio, void>()("voice:append-stream"),
    finishStream: request<VoiceStream, VoiceTranscriptionResult>()("voice:finish-stream"),
    cancelStream: request<VoiceStream, void>()("voice:cancel-stream"),
    modelStatus: event<VoiceModelStatus>()("voice:model-status"),
    streamTranscript: event<VoiceStreamTranscript>()("voice:stream-transcript"),
    getSpeechSettings: request<undefined, SpeechSettings>()("voice:get-speech-settings"),
    setSpeechSettings: request<SpeechSettings, SpeechSettings>()("voice:set-speech-settings"),
    getSpeechModelStatus: request<undefined, SpeechModelStatus>()("voice:get-speech-model-status"),
    setSpeechApiKey: request<SpeechApiKeyInput, SpeechModelStatus>()("voice:set-speech-api-key"),
    downloadSpeechModel: request<undefined, SpeechModelStatus>()("voice:download-speech-model"),
    cancelSpeechModelDownload: request<undefined, SpeechModelStatus>()("voice:cancel-speech-model-download"),
    removeSpeechModel: request<undefined, SpeechModelStatus>()("voice:remove-speech-model"),
    speak: request<SpeechInput, SpeechAudio>()("voice:speak"),
    warmSpeech: request<undefined, void>()("voice:warm-speech"),
    keepRecording: request<VoiceTranscriptionInput, DraftAttachment>()("voice:keep-recording"),
    speechModelStatus: event<SpeechModelStatus>()("voice:speech-model-status"),
    getServer: request<undefined, VoiceServerSettings | null>()("voice:get-server"),
    probeServer: request<VoiceServerConnection, VoiceServerProbe>()("voice:probe-server"),
    setServer: request<VoiceServerSave, VoiceServerSettings | null>()("voice:set-server"),
    serverSettings: event<VoiceServerSettings | null>()("voice:server-settings"),
    startLive: scopedRequest<VoiceLiveStart, VoiceLiveSession>()("voice:start-live"),
    stopLive: request<VoiceLiveStop, void>()("voice:stop-live"),
    liveEvent: event<VoiceLiveEvent>()("voice:live-event"),
  },
  dynamicIsland: {
    getPreference: request<undefined, DynamicIslandPreference>()("dynamic-island:get-preference"),
    setPreference: request<SetDynamicIslandPreferenceInput, DynamicIslandPreference>()("dynamic-island:set-preference"),
    publishPresentation: request<DynamicIslandPresentation, void>()("dynamic-island:publish-presentation"),
    getPresentation: request<undefined, DynamicIslandPresentation>()("dynamic-island:get-presentation"),
    presentation: event<DynamicIslandPresentation>()("dynamic-island:presentation"),
    preference: event<DynamicIslandPreference>()("dynamic-island:preference"),
    geometry: event<DynamicIslandGeometry>()("dynamic-island:geometry"),
    getBuiltInDisplayGeometry: request<undefined, DynamicIslandGeometry>()(
      "dynamic-island:get-built-in-display-geometry",
    ),
    performAction: request<DynamicIslandAction, void>()("dynamic-island:perform-action"),
    performHaptic: request<undefined, void>()("dynamic-island:perform-haptic"),
    action: event<DynamicIslandAction>()("dynamic-island:action"),
    openBrowserTakeover: request<BrowserTakeoverPage, void>()("dynamic-island:open-browser-takeover"),
    setInteractive: request<SetDynamicIslandInteractiveInput, void>()("dynamic-island:set-interactive"),
    setInputRegion: request<AgentDockInputRect[], void>()("dynamic-island:set-input-region"),
    setXWayland: request<SetAgentDockXWaylandInput, void>()("dynamic-island:set-xwayland"),
  },
  browserDock: {
    publishPresentation: request<BrowserDockPresentation | null, void>()("browser-dock:publish-presentation"),
    getPresentation: request<undefined, BrowserDockPresentation | null>()("browser-dock:get-presentation"),
    presentation: event<BrowserDockPresentation | null>()("browser-dock:presentation"),
    performAction: request<BrowserDockAction, void>()("browser-dock:perform-action"),
    action: event<BrowserDockAction>()("browser-dock:action"),
    setFrame: request<BrowserDockFrame, void>()("browser-dock:set-frame"),
    shown: event<boolean>()("browser-dock:shown"),
  },
  agentDock: {
    publishPresentation: request<AgentDockPresentation | null, void>()("agent-dock:publish-presentation"),
    getPresentation: request<undefined, AgentDockPresentation | null>()("agent-dock:get-presentation"),
    presentation: event<AgentDockPresentation | null>()("agent-dock:presentation"),
    performAction: request<AgentDockAction, void>()("agent-dock:perform-action"),
    action: event<AgentDockAction>()("agent-dock:action"),
    setInteractive: request<SetAgentDockInteractiveInput, void>()("agent-dock:set-interactive"),
    setInputRegion: request<AgentDockInputRect[], void>()("agent-dock:set-input-region"),
    setExtent: request<AgentDockExtent | null, void>()("agent-dock:set-extent"),
    setXWayland: request<SetAgentDockXWaylandInput, void>()("agent-dock:set-xwayland"),
    closeChat: event<undefined>()("agent-dock:close-chat"),
    listDisplays: request<undefined, AgentDockDisplayInfo[]>()("agent-dock:list-displays"),
    drag: request<AgentDockDragPhase, void>()("agent-dock:drag"),
    moved: event<AgentDockOffset>()("agent-dock:moved"),
  },
  computerUse: {
    getState: request<undefined, ComputerUseState>()("computer-use:get-state"),
    openPermissionPane: request<MacPermissionId, ComputerUseState>()("computer-use:open-permission-pane"),
    closePermissionHelp: request<undefined, void>()("computer-use:close-permission-help"),
    getPermissionApp: request<undefined, ComputerUsePermissionApp | null>()("computer-use:get-permission-app"),
    startPermissionAppDrag: request<undefined, void>()("computer-use:start-permission-app-drag"),
    revealPermissionApp: request<undefined, void>()("computer-use:reveal-permission-app"),
    highlightPlacement: event<ComputerUseHighlightPlacement>()("computer-use:highlight-placement"),
  },
  macAutomation: {
    request: request<readonly MacAutomationTarget[], MacAutomationResult[]>()("mac-automation:request"),
  },
  backgroundProcesses: {
    list: scopedQuery<BackgroundProcess[] | null, "required">()("background-processes:list"),
    stop: scopedRequest<string, void, "required">()("background-processes:stop"),
  },
  skills: {
    localList: request<undefined, MarketplaceSkillDetail[]>()("skills:local-list"),
    localGet: request<LocalSkillRevisionInput, MarketplaceSkillDetail>()("skills:local-get"),
    localCreate: request<CreateLocalSkillInput, MarketplaceSkillDetail>()("skills:local-create"),
    localRevise: request<ReviseLocalSkillInput, MarketplaceSkillDetail>()("skills:local-revise"),
    localInstall: request<InstallLocalSkillInput, InstalledSkill>()("skills:local-install"),

    list: request<MarketplaceSkillQuery | undefined, MarketplaceSkillPage>()("skills:list"),
    get: request<string, MarketplaceSkillDetail>()("skills:get"),
    getBySlug: request<string, MarketplaceSkillDetail>()("skills:get-by-slug"),
    listMine: request<undefined, SkillSubmission[]>()("skills:list-mine"),
    choosePackage: request<undefined, SkillPackagePreview | null>()("skills:choose-package"),
    submit: request<SubmitSkillInput, SkillSubmission>()("skills:submit"),
    listInstalled: request<string, InstalledSkill[]>()("skills:list-installed"),
    install: request<InstallSkillInput, InstalledSkill>()("skills:install"),
    uninstall: request<UninstallSkillInput, void>()("skills:uninstall"),
    setEnabled: request<SetEnabledSkillInput, InstalledSkill>()("skills:set-enabled"),
  },
  customProviders: {
    list: request<undefined, CustomProviderSummary[]>()("custom-providers:list"),
    save: request<SaveCustomProviderInput, CustomProviderResult>()("custom-providers:save"),
    delete: request<DeleteCustomProviderInput, CustomProviderResult>()("custom-providers:delete"),
    update: request<UpdateCustomProviderInput, CustomProviderResult>()("custom-providers:update"),
  },
  providerDetection: {
    scanModelServers: scopedQuery<DetectedModelServer[], "required">()("provider-detection:scan-model-servers"),
    discoverModels: scopedRequest<DiscoverModelsInput, DiscoverModelsResult, "required">()(
      "provider-detection:discover-models",
    ),
    getSettings: scopedQuery<ProviderDetectionSettings, "required">()("provider-detection:get-settings"),
    setSettings: scopedRequest<ProviderDetectionSettings, ProviderDetectionSettings, "required">()(
      "provider-detection:set-settings",
    ),
    scanAgents: scopedQuery<DetectedAcpAgent[], "required">()("provider-detection:scan-agents"),
  },
  acpRegistry: {
    search: scopedRequest<string, AcpRegistryEntry[]>()("acp-registry:search"),
    installed: scopedQuery<AcpRegistryInstallation[]>()("acp-registry:installed"),
    status: scopedQuery<AcpRegistryOperation[]>()("acp-registry:status"),
    install: scopedRequest<AcpRegistryInstallInput, CustomAgentResult>()("acp-registry:install"),
    cancel: scopedRequest<string, void>()("acp-registry:cancel"),
    remove: scopedRequest<string, void>()("acp-registry:remove"),
  },
  customAgents: {
    list: scopedQuery<CustomAgentSummary[], "required">()("custom-agents:list"),
    save: scopedRequest<SaveCustomAgentInput, CustomAgentResult, "required">()("custom-agents:save"),
    delete: scopedRequest<DeleteCustomAgentInput, CustomAgentResult, "required">()("custom-agents:delete"),
    check: request<CheckCustomAgentInput, CustomAgentCheckResult>()("custom-agents:check"),
    usage: request<undefined, CustomAgentUsage[]>()("custom-agents:usage"),
  },
  providerAdmin: {
    startCodeLogin: scopedRequest<AgentProviderId, ProviderCodeLoginStart, "required">()(
      "provider-admin:start-code-login",
    ),
    submitCodeLogin: scopedRequest<SubmitProviderCodeLoginInput, AgentStatus, "required">()(
      "provider-admin:submit-code-login",
    ),
    cancelCodeLogin: scopedRequest<AgentProviderId, AgentStatus, "required">()("provider-admin:cancel-code-login"),
    startHostSignIn: scopedRequest<AgentProviderId, void, "required">()("provider-admin:start-host-sign-in"),
    hostSignInStatus: scopedRequest<AgentProviderId, ProviderHostSignInStatus, "required">()(
      "provider-admin:host-sign-in-status",
    ),
    cancelHostSignIn: scopedRequest<AgentProviderId, AgentStatus, "required">()("provider-admin:cancel-host-sign-in"),
    accounts: scopedQuery<HostProviderAccounts, "required">()("provider-admin:accounts"),
    accountUsage: scopedQuery<AccountUsage, "required">()("provider-admin:account-usage"),
    startAccountSignIn: scopedRequest<ConnectProviderAccountInput, void, "required">()(
      "provider-admin:start-account-sign-in",
    ),
    accountSignInStatus: scopedRequest<AgentProviderId, ProviderHostSignInStatus, "required">()(
      "provider-admin:account-sign-in-status",
    ),
    cancelAccountSignIn: scopedRequest<AgentProviderId, void, "required">()("provider-admin:cancel-account-sign-in"),
    connectAccountKey: scopedRequest<ConnectProviderAccountKeyInput, void, "required">()(
      "provider-admin:connect-account-key",
    ),
    startAccountCodeLogin: scopedRequest<ConnectProviderAccountInput, ProviderAccountCodeLoginStart, "required">()(
      "provider-admin:start-account-code-login",
    ),
    submitAccountCodeLogin: scopedRequest<SubmitProviderAccountCodeLoginInput, void, "required">()(
      "provider-admin:submit-account-code-login",
    ),
    accountCodeLoginStatus: scopedRequest<RemoveProviderAccountInput, ProviderAccountCodeLoginStatus, "required">()(
      "provider-admin:account-code-login-status",
    ),
    cancelAccountCodeLogin: scopedRequest<RemoveProviderAccountInput, void, "required">()(
      "provider-admin:cancel-account-code-login",
    ),
    hostDefaultProvider: scopedQuery<HostDefaultProvider, "required">()("provider-admin:host-default-provider"),
    setHostDefaultProvider: scopedRequest<SaveSetupInput, HostDefaultProvider, "required">()(
      "provider-admin:set-host-default-provider",
    ),
    renameAccount: scopedRequest<RenameProviderAccountInput, void, "required">()("provider-admin:rename-account"),
    removeAccount: scopedRequest<RemoveProviderAccountInput, void, "required">()("provider-admin:remove-account"),
    setAccountPool: scopedRequest<SetProviderAccountPoolInput, void, "required">()("provider-admin:set-account-pool"),
    setLiveVoiceAccount: scopedRequest<SetLiveVoiceAccountInput, void, "required">()(
      "provider-admin:set-live-voice-account",
    ),
    usageResets: scopedRequest<AgentProviderId, ProviderUsageResets[], "required">()("provider-admin:usage-resets"),
    resetUsage: scopedRequest<ResetProviderUsageInput, ProviderUsageResetOutcome, "required">()(
      "provider-admin:reset-usage",
    ),
    signOut: scopedRequest<AgentProviderId, void, "required">()("provider-admin:sign-out"),
    startRelaySignIn: scopedRequest<AgentProviderId, void, "required">()("provider-admin:start-relay-sign-in"),
    startAccountRelaySignIn: scopedRequest<ConnectProviderAccountInput, void, "required">()(
      "provider-admin:start-account-relay-sign-in",
    ),
    relaySignInStatus: scopedRequest<AgentProviderId, ProviderRelaySignInStatus, "required">()(
      "provider-admin:relay-sign-in-status",
    ),
    openRelaySignIn: scopedRequest<AgentProviderId, void, "required">()("provider-admin:open-relay-sign-in"),
    pasteRelaySignIn: scopedRequest<PasteProviderRelaySignInInput, void, "required">()(
      "provider-admin:paste-relay-sign-in",
    ),
    cancelRelaySignIn: scopedRequest<AgentProviderId, AgentStatus, "required">()("provider-admin:cancel-relay-sign-in"),
    getApiKeyState: scopedRequest<AgentProviderId, ProviderApiKeyState, "required">()(
      "provider-admin:get-api-key-state",
    ),
    setApiKey: scopedRequest<SetProviderApiKeyInput, AgentStatus, "required">()("provider-admin:set-api-key"),
    clearApiKey: scopedRequest<AgentProviderId, AgentStatus, "required">()("provider-admin:clear-api-key"),
    getRuntimes: scopedQuery<ProviderRuntimeSnapshot, "required">()("provider-admin:get-runtimes"),
    downloadRuntime: scopedRequest<DownloadableProviderId, ProviderRuntimeSnapshot, "required">()(
      "provider-admin:download-runtime",
    ),
    cancelRuntime: scopedRequest<DownloadableProviderId, ProviderRuntimeSnapshot, "required">()(
      "provider-admin:cancel-runtime",
    ),
    checkRuntimeUpdates: scopedQuery<ProviderRuntimeSnapshot, "required">()("provider-admin:check-runtime-updates"),
    listCustomProviders: scopedQuery<CustomProviderSummary[], "required">()("provider-admin:list-custom-providers"),
    saveCustomProvider: scopedRequest<SaveCustomProviderInput, CustomProviderResult, "required">()(
      "provider-admin:save-custom-provider",
    ),
    updateCustomProvider: scopedRequest<UpdateCustomProviderInput, CustomProviderResult, "required">()(
      "provider-admin:update-custom-provider",
    ),
    deleteCustomProvider: scopedRequest<DeleteCustomProviderInput, CustomProviderResult, "required">()(
      "provider-admin:delete-custom-provider",
    ),
    providerUse: scopedQuery<AgentProviderId[], "required">()("provider-admin:provider-use"),
    setProviderUse: scopedRequest<{ provider: AgentProviderId; on: boolean }, AgentProviderId[], "required">()(
      "provider-admin:set-provider-use",
    ),
  },
  messaging: {
    getSlackOverview: request<undefined, SlackOverview>()("messaging:get-slack-overview"),
    connectSlackWorkspace: request<undefined, void>()("messaging:connect-slack-workspace"),
    disconnectSlackWorkspace: request<SlackWorkspaceInput, void>()("messaging:disconnect-slack-workspace"),
    reconnectSlackWorkspace: request<SlackWorkspaceInput, void>()("messaging:reconnect-slack-workspace"),
    setSlackEnabled: request<SetSlackEnabledInput, void>()("messaging:set-slack-enabled"),
    addSlackOrchestrator: request<AddSlackOrchestratorInput, AddSlackOrchestratorResult>()(
      "messaging:add-slack-orchestrator",
    ),
    getDiscordOverview: request<undefined, MessagingOverview>()("messaging:get-discord-overview"),
    connectDiscordGuild: request<undefined, void>()("messaging:connect-discord-guild"),
    disconnectDiscordGuild: request<MessagingWorkspaceInput, void>()("messaging:disconnect-discord-guild"),
    reconnectDiscordGuild: request<MessagingWorkspaceInput, void>()("messaging:reconnect-discord-guild"),
    setDiscordEnabled: request<SetMessagingEnabledInput, void>()("messaging:set-discord-enabled"),
    addDiscordOrchestrator: request<AddMessagingOrchestratorInput, AddMessagingOrchestratorResult>()(
      "messaging:add-discord-orchestrator",
    ),
    getDiscordAccess: request<MessagingWorkspaceInput, DiscordAccess>()("messaging:get-discord-access"),
    listDiscordRoles: request<MessagingWorkspaceInput, DiscordRoleList>()("messaging:list-discord-roles"),
    setDiscordAccess: request<SetDiscordAccessInput, DiscordAccess>()("messaging:set-discord-access"),
    getTelegramOverview: request<undefined, TelegramOverview>()("messaging:get-telegram-overview"),
    connectTelegramChat: request<ConnectTelegramChatInput, void>()("messaging:connect-telegram-chat"),
    disconnectTelegramChat: request<TelegramChatInput, void>()("messaging:disconnect-telegram-chat"),
    reconnectTelegramChat: request<TelegramChatInput, void>()("messaging:reconnect-telegram-chat"),
    setTelegramEnabled: request<SetTelegramEnabledInput, void>()("messaging:set-telegram-enabled"),
    addTelegramOrchestrator: request<AddTelegramOrchestratorInput, AddMessagingOrchestratorResult>()(
      "messaging:add-telegram-orchestrator",
    ),
    getWhatsAppOverview: request<undefined, WhatsAppOverview>()("messaging:get-whatsapp-overview"),
    startWhatsAppLink: request<StartWhatsAppLinkInput, WhatsAppLinkState>()("messaging:start-whatsapp-link"),
    getWhatsAppLinkState: request<undefined, WhatsAppLinkState>()("messaging:get-whatsapp-link-state"),
    cancelWhatsAppLink: request<undefined, void>()("messaging:cancel-whatsapp-link"),
    disconnectWhatsAppNumber: request<MessagingWorkspaceInput, void>()("messaging:disconnect-whatsapp-number"),
    reconnectWhatsAppNumber: request<MessagingWorkspaceInput, void>()("messaging:reconnect-whatsapp-number"),
    setWhatsAppEnabled: request<SetMessagingEnabledInput, void>()("messaging:set-whatsapp-enabled"),
    addWhatsAppOrchestrator: request<AddWhatsAppOrchestratorInput, AddMessagingOrchestratorResult>()(
      "messaging:add-whatsapp-orchestrator",
    ),
    listWhatsAppGroups: request<MessagingWorkspaceInput, WhatsAppGroupList>()("messaging:list-whatsapp-groups"),
    addWhatsAppSender: request<WhatsAppSenderInput, void>()("messaging:add-whatsapp-sender"),
    removeWhatsAppSender: request<RemoveWhatsAppSenderInput, void>()("messaging:remove-whatsapp-sender"),
    answerWhatsAppRequest: request<AnswerWhatsAppRequestInput, void>()("messaging:answer-whatsapp-request"),
    setWhatsAppOwnNumber: request<SetWhatsAppOwnNumberInput, void>()("messaging:set-whatsapp-own-number"),
    setWhatsAppWorkingMessage: request<SetWhatsAppWorkingMessageInput, void>()(
      "messaging:set-whatsapp-working-message",
    ),
    setWhatsAppStatusReactions: request<SetWhatsAppStatusReactionsInput, void>()(
      "messaging:set-whatsapp-status-reactions",
    ),
    setWhatsAppSenderReadOnly: request<SetWhatsAppSenderReadOnlyInput, void>()(
      "messaging:set-whatsapp-sender-read-only",
    ),
    hostOverview: scopedRequest<HostMessagingPlatformInput, MessagingOverview, "required">()("messaging:host-overview"),
    hostConnect: scopedRequest<HostMessagingConnectInput, void, "required">()("messaging:host-connect"),
    hostDisconnect: scopedRequest<HostMessagingWorkspaceInput, void, "required">()("messaging:host-disconnect"),
    hostReconnect: scopedRequest<HostMessagingWorkspaceInput, void, "required">()("messaging:host-reconnect"),
    hostSetEnabled: scopedRequest<HostSetMessagingEnabledInput, void, "required">()("messaging:host-set-enabled"),
    hostAddOrchestrator: scopedRequest<HostAddMessagingOrchestratorInput, AddMessagingOrchestratorResult, "required">()(
      "messaging:host-add-orchestrator",
    ),
    hostGetDiscordAccess: scopedRequest<HostDiscordAccessInput, DiscordAccess, "required">()(
      "messaging:host-get-discord-access",
    ),
    hostListDiscordRoles: scopedRequest<HostDiscordAccessInput, DiscordRoleList, "required">()(
      "messaging:host-list-discord-roles",
    ),
    hostSetDiscordAccess: scopedRequest<HostSetDiscordAccessInput, DiscordAccess, "required">()(
      "messaging:host-set-discord-access",
    ),
    hostGetWhatsAppOverview: scopedQuery<WhatsAppOverview, "required">()("messaging:host-get-whatsapp-overview"),
    hostStartWhatsAppLink: scopedRequest<StartWhatsAppLinkInput, WhatsAppLinkState, "required">()(
      "messaging:host-start-whatsapp-link",
    ),
    hostGetWhatsAppLinkState: scopedQuery<WhatsAppLinkState, "required">()("messaging:host-get-whatsapp-link-state"),
    hostCancelWhatsAppLink: scopedQuery<void, "required">()("messaging:host-cancel-whatsapp-link"),
    hostDisconnectWhatsAppNumber: scopedRequest<MessagingWorkspaceInput, void, "required">()(
      "messaging:host-disconnect-whatsapp-number",
    ),
    hostReconnectWhatsAppNumber: scopedRequest<MessagingWorkspaceInput, void, "required">()(
      "messaging:host-reconnect-whatsapp-number",
    ),
    hostSetWhatsAppEnabled: scopedRequest<SetMessagingEnabledInput, void, "required">()(
      "messaging:host-set-whatsapp-enabled",
    ),
    hostAddWhatsAppOrchestrator: scopedQuery<AddMessagingOrchestratorResult, "required">()(
      "messaging:host-add-whatsapp-orchestrator",
    ),
    hostListWhatsAppGroups: scopedRequest<MessagingWorkspaceInput, WhatsAppGroupList, "required">()(
      "messaging:host-list-whatsapp-groups",
    ),
    hostAddWhatsAppSender: scopedRequest<WhatsAppSenderInput, void, "required">()("messaging:host-add-whatsapp-sender"),
    hostRemoveWhatsAppSender: scopedRequest<RemoveWhatsAppSenderInput, void, "required">()(
      "messaging:host-remove-whatsapp-sender",
    ),
    hostAnswerWhatsAppRequest: scopedRequest<AnswerWhatsAppRequestInput, void, "required">()(
      "messaging:host-answer-whatsapp-request",
    ),
    hostSetWhatsAppOwnNumber: scopedRequest<SetWhatsAppOwnNumberInput, void, "required">()(
      "messaging:host-set-whatsapp-own-number",
    ),
    hostSetWhatsAppWorkingMessage: scopedRequest<SetWhatsAppWorkingMessageInput, void, "required">()(
      "messaging:host-set-whatsapp-working-message",
    ),
    hostSetWhatsAppStatusReactions: scopedRequest<SetWhatsAppStatusReactionsInput, void, "required">()(
      "messaging:host-set-whatsapp-status-reactions",
    ),
    hostSetWhatsAppSenderReadOnly: scopedRequest<SetWhatsAppSenderReadOnlyInput, void, "required">()(
      "messaging:host-set-whatsapp-sender-read-only",
    ),
  },
  hostAdmin: {
    updateIdentity: scopedRequest<UpdateHostIdentityInput, ServerSummary, "required">()("host-admin:update-identity"),
    rotateHostKey: scopedQuery<void, "required">()("host-admin:rotate-host-key"),
    restartHost: scopedQuery<void, "required">()("host-admin:restart-host"),
    getReleaseStatus: scopedQuery<HostReleaseStatus | null, "required">()("host-admin:get-release-status"),
    checkRelease: scopedQuery<HostReleaseStatus, "required">()("host-admin:check-release"),
    getUpdateStatus: scopedQuery<HostUpdateStatus, "required">()("host-admin:get-update-status"),
    checkForUpdate: scopedQuery<HostUpdateStatus, "required">()("host-admin:check-for-update"),
    startUpdate: scopedRequest<UpdateRestartMode, HostUpdateStatus, "required">()("host-admin:start-update"),
    cancelUpdate: scopedQuery<HostUpdateStatus, "required">()("host-admin:cancel-update"),
    setUpdateSettings: scopedRequest<HostUpdateSettingsChange, HostUpdateStatus, "required">()(
      "host-admin:set-update-settings",
    ),
    getTimezone: scopedQuery<HostTimezoneSettings, "required">()("host-admin:get-timezone"),
    setTimezone: scopedRequest<string | null, HostTimezoneSettings, "required">()("host-admin:set-timezone"),
    getSignalHome: scopedQuery<HostSignalHomeSettings, "required">()("host-admin:get-signal-home"),
    setSignalHome: scopedRequest<string | null, HostSignalHomeSettings, "required">()("host-admin:set-signal-home"),
    getVoiceModel: scopedQuery<HostVoiceModel, "required">()("host-admin:get-voice-model"),
    changeVoiceModel: scopedRequest<HostVoiceModelChange, HostVoiceModel, "required">()(
      "host-admin:change-voice-model",
    ),
    getTurnLimits: scopedQuery<HostTurnLimits, "required">()("host-admin:get-turn-limits"),
    setTurnLimits: scopedRequest<HostTurnLimitsInput, HostTurnLimits, "required">()("host-admin:set-turn-limits"),
    getPersonality: scopedQuery<HostPersonality, "required">()("host-admin:get-personality"),
    setPersonality: scopedRequest<HostPersonality, HostPersonality, "required">()("host-admin:set-personality"),
    getAgentMemoryLimit: scopedQuery<HostAgentMemoryLimit, "required">()("host-admin:get-agent-memory-limit"),
    setAgentMemoryLimit: scopedRequest<number, HostAgentMemoryLimit, "required">()("host-admin:set-agent-memory-limit"),
    getMemoryReview: scopedQuery<HostMemoryReview, "required">()("host-admin:get-memory-review"),
    setMemoryReview: scopedRequest<number, HostMemoryReview, "required">()("host-admin:set-memory-review"),
    getSkillLearning: scopedQuery<HostSkillLearning, "required">()("host-admin:get-skill-learning"),
    setSkillLearning: scopedRequest<string, HostSkillLearning, "required">()("host-admin:set-skill-learning"),
    getBrowsingMemory: scopedQuery<HostBrowsingMemory, "required">()("host-admin:get-browsing-memory"),
    setBrowsingMemory: scopedRequest<boolean, HostBrowsingMemory, "required">()("host-admin:set-browsing-memory"),
    getMachineAlerts: scopedQuery<MachineAlertSettings, "required">()("host-admin:get-machine-alerts"),
    setMachineAlerts: scopedRequest<MachineAlertSettings, MachineAlertSettings, "required">()(
      "host-admin:set-machine-alerts",
    ),
    getPromptCacheTtl: scopedQuery<PromptCacheTtlSetting, "required">()("host-admin:get-prompt-cache-ttl"),
    setPromptCacheTtl: scopedRequest<PromptCacheTtl, PromptCacheTtlSetting, "required">()(
      "host-admin:set-prompt-cache-ttl",
    ),
    getCacheExpiryCompaction: scopedQuery<CacheExpiryCompactionSetting, "required">()(
      "host-admin:get-cache-expiry-compaction",
    ),
    setCacheExpiryCompaction: scopedRequest<boolean, CacheExpiryCompactionSetting, "required">()(
      "host-admin:set-cache-expiry-compaction",
    ),
    getMediaApprovalCredits: scopedQuery<MediaApprovalCreditsSetting, "required">()(
      "host-admin:get-media-approval-credits",
    ),
    setMediaApprovalCredits: scopedRequest<MediaApprovalCreditsUpdate, MediaApprovalCreditsSetting, "required">()(
      "host-admin:set-media-approval-credits",
    ),
    getClaudeUserSetup: scopedQuery<ClaudeUserSetupSetting, "required">()("host-admin:get-claude-user-setup"),
    setClaudeUserSetup: scopedRequest<boolean, ClaudeUserSetupSetting, "required">()(
      "host-admin:set-claude-user-setup",
    ),
    getClaudeCompactWindow: scopedQuery<ClaudeCompactWindowSetting, "required">()(
      "host-admin:get-claude-compact-window",
    ),
    setClaudeCompactWindow: scopedRequest<number | null, ClaudeCompactWindowSetting, "required">()(
      "host-admin:set-claude-compact-window",
    ),
    getProviderEnvironment: scopedRequest<ProviderEnvironmentProvider, ProviderEnvironment, "required">()(
      "host-admin:get-provider-environment",
    ),
    setProviderEnvironment: scopedRequest<ProviderEnvironmentUpdate, ProviderEnvironment, "required">()(
      "host-admin:set-provider-environment",
    ),
    getModelVisibility: scopedRequest<AgentProviderRef, ProviderModelVisibility, "required">()(
      "host-admin:get-model-visibility",
    ),
    setModelVisibility: scopedRequest<ProviderModelVisibilityChange, ProviderModelVisibility, "required">()(
      "host-admin:set-model-visibility",
    ),
    getAgentAccess: scopedQuery<AgentAccessSnapshot, "required">()("host-admin:get-agent-access"),
    setAgentAccess: scopedRequest<AgentAccessChange, AgentAccessSnapshot, "required">()("host-admin:set-agent-access"),
    getAuditLog: scopedQuery<ServerAuditLog, "required">()("host-admin:get-audit-log"),
  },
  githubConnector: {
    status: request<undefined, GitHubConnectorStatus>()("github-connector:status"),
    connect: request<undefined, GitHubConnectorStatus>()("github-connector:connect"),
    cancel: request<undefined, GitHubConnectorStatus>()("github-connector:cancel"),
    disconnect: request<undefined, GitHubConnectorStatus>()("github-connector:disconnect"),
    repositories: request<undefined, GitHubConnectorRepositories>()("github-connector:repositories"),
    openVerification: request<undefined, void>()("github-connector:open-verification"),
    openInstall: request<undefined, void>()("github-connector:open-install"),
    changed: event<GitHubConnectorStatus>()("github-connector:changed"),
    hostStatus: scopedQuery<GitHubConnectorStatus, "required">()("github-connector:host-status"),
    hostConnect: scopedQuery<GitHubConnectorStatus, "required">()("github-connector:host-connect"),
    hostCancel: scopedQuery<GitHubConnectorStatus, "required">()("github-connector:host-cancel"),
    hostDisconnect: scopedQuery<GitHubConnectorStatus, "required">()("github-connector:host-disconnect"),
    hostRepositories: scopedQuery<GitHubConnectorRepositories, "required">()("github-connector:host-repositories"),
    hostOpenVerification: scopedQuery<void, "required">()("github-connector:host-open-verification"),
    hostOpenInstall: scopedQuery<void, "required">()("github-connector:host-open-install"),
  },
  bitwardenConnector: {
    status: request<undefined, BitwardenConnectorStatus>()("bitwarden-connector:status"),
    connect: request<string, BitwardenConnectorStatus>()("bitwarden-connector:connect"),
    disconnect: request<undefined, BitwardenConnectorStatus>()("bitwarden-connector:disconnect"),
    changed: event<BitwardenConnectorStatus>()("bitwarden-connector:changed"),
    hostStatus: scopedQuery<BitwardenConnectorStatus, "required">()("bitwarden-connector:host-status"),
    hostConnect: scopedRequest<BitwardenHostConnectInput, BitwardenConnectorStatus, "required">()(
      "bitwarden-connector:host-connect",
    ),
    hostDisconnect: scopedQuery<BitwardenConnectorStatus, "required">()("bitwarden-connector:host-disconnect"),
  },
  passwordManagers: {
    list: request<undefined, PasswordManagerStatus[]>()("password-managers:list"),
    connect: request<PasswordManagerConnectInput, PasswordManagerStatus>()("password-managers:connect"),
    cancel: request<PasswordManagerId, PasswordManagerStatus>()("password-managers:cancel"),
    disconnect: request<PasswordManagerId, PasswordManagerStatus>()("password-managers:disconnect"),
    openSignIn: request<PasswordManagerId, void>()("password-managers:open-sign-in"),
    changed: event<PasswordManagerStatus>()("password-managers:changed"),
    hostList: scopedQuery<PasswordManagerStatus[], "required">()("password-managers:host-list"),
    hostConnect: scopedRequest<PasswordManagerConnectInput, PasswordManagerStatus, "required">()(
      "password-managers:host-connect",
    ),
    hostCancel: scopedRequest<PasswordManagerId, PasswordManagerStatus, "required">()("password-managers:host-cancel"),
    hostDisconnect: scopedRequest<PasswordManagerId, PasswordManagerStatus, "required">()(
      "password-managers:host-disconnect",
    ),
    hostOpenSignIn: scopedRequest<PasswordManagerId, void, "required">()("password-managers:host-open-sign-in"),
  },
  linkAccount: {
    status: request<undefined, LinkAccountStatus>()("link-account:status"),
    connect: request<undefined, LinkAccountStatus>()("link-account:connect"),
    cancel: request<undefined, LinkAccountStatus>()("link-account:cancel"),
    disconnect: request<undefined, LinkAccountStatus>()("link-account:disconnect"),
    changed: event<LinkAccountStatus>()("link-account:changed"),
  },
  vault: {
    list: request<undefined, VaultState>()("vault:list"),
    save: request<VaultSaveInput, VaultState>()("vault:save"),
    delete: request<string, VaultState>()("vault:delete"),
    reveal: request<VaultSecretRequest, string>()("vault:reveal"),
    copy: request<VaultSecretRequest, void>()("vault:copy"),
    importCsv: request<undefined, VaultImportResult>()("vault:import-csv"),
    reset: request<undefined, VaultState>()("vault:reset"),
    codes: request<undefined, VaultTwoStepCodes>()("vault:codes"),
    changed: event<VaultState>()("vault:changed"),
    hostList: scopedQuery<VaultState, "required">()("vault:host-list"),
    hostSave: scopedRequest<VaultSaveInput, VaultState, "required">()("vault:host-save"),
    hostDelete: scopedRequest<string, VaultState, "required">()("vault:host-delete"),
    hostReveal: scopedRequest<VaultSecretRequest, string, "required">()("vault:host-reveal"),
    hostCopy: scopedRequest<VaultSecretRequest, void, "required">()("vault:host-copy"),
    hostReset: scopedQuery<VaultState, "required">()("vault:host-reset"),
    hostCodes: scopedQuery<VaultTwoStepCodes, "required">()("vault:host-codes"),
    hostImportCsv: scopedQuery<VaultImportResult, "required">()("vault:host-import-csv"),
  },
  onePasswordConnector: {
    status: request<undefined, OnePasswordConnectorStatus>()("onepassword-connector:status"),
    checkSetup: request<undefined, OnePasswordConnectorStatus>()("onepassword-connector:check-setup"),
    installCli: request<undefined, OnePasswordConnectorStatus>()("onepassword-connector:install-cli"),
    openApp: request<undefined, void>()("onepassword-connector:open-app"),
    connect: request<OnePasswordConnectInput, OnePasswordConnectorStatus>()("onepassword-connector:connect"),
    connectWithToken: request<string, OnePasswordConnectorStatus>()("onepassword-connector:connect-with-token"),
    cancel: request<undefined, OnePasswordConnectorStatus>()("onepassword-connector:cancel"),
    disconnect: request<undefined, OnePasswordConnectorStatus>()("onepassword-connector:disconnect"),
    changed: event<OnePasswordConnectorStatus>()("onepassword-connector:changed"),
    hostStatus: scopedQuery<OnePasswordConnectorStatus, "required">()("onepassword-connector:host-status"),
    hostConnectWithToken: scopedRequest<OnePasswordHostConnectInput, OnePasswordConnectorStatus, "required">()(
      "onepassword-connector:host-connect-with-token",
    ),
    hostDisconnect: scopedQuery<OnePasswordConnectorStatus, "required">()("onepassword-connector:host-disconnect"),
  },
  hostedSites: {
    list: scopedQuery<HostedSiteList, "required">()("hosted-sites:list"),
    chooseDirectory: request<undefined, string | null>()("hosted-sites:choose-directory"),
    publish: request<PublishHostedSiteInput, HostedSiteSummary>()("hosted-sites:publish"),
    replace: request<ReplaceHostedSiteInput, HostedSiteSummary>()("hosted-sites:replace"),
    delete: scopedRequest<DeleteHostedSiteInput, void, "required">()("hosted-sites:delete"),
  },
  routineFeed: {
    get: request<undefined, RoutineFeed>()("routine-feed:get"),
    create: request<undefined, RoutineFeed>()("routine-feed:create"),
    remove: request<undefined, RoutineFeed>()("routine-feed:remove"),
  },
  billing: {
    getState: request<undefined, BillingState>()("billing:get-state"),
    openPortal: request<BillingPortalRequest, void>()("billing:open-portal"),
    buyStorage: request<BillingStorageRequest, BillingState>()("billing:buy-storage"),
    getDetails: request<undefined, BillingDetails>()("billing:get-details"),
    setDetails: request<BillingDetailsRequest, BillingDetails>()("billing:set-details"),
  },
  referral: {
    getState: request<ReferralPageRequest, ReferralState>()("referral:get-state"),
  },
  credits: {
    getState: request<undefined, CreditsState>()("credits:get-state"),
    getActivity: request<undefined, CreditActivity>()("credits:get-activity"),
    openCheckout: request<CreditCheckoutRequest, void>()("credits:open-checkout"),
    transfer: request<CreditTransferRequest, CreditsState>()("credits:transfer"),
  },
  license: {
    getState: request<undefined, LicenseState>()("license:get-state"),
    openCheckout: request<LicenseCheckoutRequest, void>()("license:open-checkout"),
    setUsers: request<LicenseUsersRequest, LicenseState>()("license:set-users"),
    changePlan: request<LicensePlanRequest, LicenseState>()("license:change-plan"),
    setRenewal: request<LicenseRenewalRequest, LicenseState>()("license:set-renewal"),
  },
  hostedServers: {
    list: request<undefined, HostedServerList>()("hosted-servers:list"),
    plans: request<undefined, HostedServerCatalog>()("hosted-servers:plans"),
    create: request<CreateHostedServerInput, HostedServerSummary>()("hosted-servers:create"),
    openCheckout: request<string, HostedServerSummary>()("hosted-servers:open-checkout"),
    openCustomCheckout: request<CustomServerCheckoutRequest, CustomServerCheckoutResult>()(
      "hosted-servers:open-custom-checkout",
    ),
    delete: request<DeleteHostedServerInput, void>()("hosted-servers:delete"),
    lifecycle: request<HostedServerLifecycleInput, void>()("hosted-servers:lifecycle"),
    wake: request<string, HostedServerSummary>()("hosted-servers:wake"),
    restart: request<string, HostedServerSummary>()("hosted-servers:restart"),
    createServerClaim: request<undefined, ServerClaim>()("hosted-servers:create-server-claim"),
  },
  localServers: {
    create: request<string, ServerSummary>()("local-servers:create"),
    restart: request<string, void>()("local-servers:restart"),
    delete: request<string, void>()("local-servers:delete"),
  },
  marketplaceAgents: {
    list: request<MarketplaceAgentQuery | undefined, MarketplaceAgentPage>()("marketplace-agents:list"),
    get: request<string, MarketplaceAgentDetail>()("marketplace-agents:get"),
    getListing: request<string, MarketplaceAgentDetail>()("marketplace-agents:get-listing"),
    listMine: request<undefined, AgentSubmission[]>()("marketplace-agents:list-mine"),
    preview: request<string, AgentPublicationPreview>()("marketplace-agents:preview"),
    submit: request<SubmitMarketplaceAgentInput, AgentSubmission>()("marketplace-agents:submit"),
    install: request<InstallMarketplaceAgentInput, InstallMarketplaceAgentResult>()("marketplace-agents:install"),
  },
  agentTemplates: {
    preview: request<string, AgentTemplatePreview>()("agent-templates:preview"),
    publish: request<PublishAgentTemplateInput, AgentTemplatePublication>()("agent-templates:publish"),
    unpublish: request<string, void>()("agent-templates:unpublish"),
    get: request<string, AgentTemplateDetail>()("agent-templates:get"),
    install: request<InstallAgentTemplateInput, InstallAgentTemplateResult>()("agent-templates:install"),
    takePendingLink: request<undefined, string | null>()("agent-templates:take-pending-link"),
    openLink: event<string>()("agent-templates:open-link"),
  },
  auth: {
    getState: request<undefined, CentralAuthState>()("auth:get-state"),
    retry: request<undefined, CentralAuthState>()("auth:retry"),
    requestEmailCode: request<string, CentralAuthState>()("auth:request-email-code"),
    verifyEmailCode: request<VerifyEmailCodeInput, CentralAuthState>()("auth:verify-email-code"),
    updateName: request<string, CentralAuthState>()("auth:update-name"),
    updateAvatar: request<AvatarImageInput | null, CentralAuthState>()("auth:update-avatar"),
    updateChatColor: request<AvatarColor | null, CentralAuthState>()("auth:update-chat-color"),
    createMobileConnect: request<undefined, MobileConnectTicket>()("auth:create-mobile-connect"),
    cancelMobileConnect: request<undefined, void>()("auth:cancel-mobile-connect"),
    getMobileConnectLink: request<undefined, MobileConnectLink | null>()("auth:get-mobile-connect-link"),
    createMobileConnectLink: request<undefined, MobileConnectLink>()("auth:create-mobile-connect-link"),
    revokeMobileConnectLink: request<undefined, void>()("auth:revoke-mobile-connect-link"),
    listMobileConnectedDevices: request<undefined, MobileConnectedDevice[]>()("auth:list-mobile-connected-devices"),
    listAccountSessions: request<undefined, AccountSession[]>()("auth:list-account-sessions"),
    revokeAccountSession: request<string, void>()("auth:revoke-account-session"),
    revokeMobileConnectedDevice: request<string, void>()("auth:revoke-mobile-connected-device"),
    logout: request<undefined, CentralAuthState>()("auth:logout"),
    openCompanySignIn: request<undefined, CentralAuthState>()("auth:open-company-sign-in"),
    getCompanySignIn: request<string, CompanySignInSettings>()("auth:company-sign-in:get"),
    testCompanySignIn: request<TestCompanySignInInput, TestCompanySignInResult>()("auth:company-sign-in:test"),
    cancelCompanySignInTest: request<undefined, void>()("auth:company-sign-in:cancel-test"),
    setCompanySignInEnabled: request<SetCompanySignInEnabledInput, CompanySignInSettings>()(
      "auth:company-sign-in:set-enabled",
    ),
    removeCompanySignIn: request<string, CompanySignInSettings>()("auth:company-sign-in:remove"),
    createCompanySignInScimToken: request<string, CompanySignInScimToken>()("auth:company-sign-in:create-scim-token"),
    revokeCompanySignInScimToken: request<string, CompanySignInSettings>()("auth:company-sign-in:revoke-scim-token"),
    listOwnerTransfers: request<undefined, OwnerTransfer[]>()("auth:list-owner-transfers"),
    acceptOwnerTransfer: request<string, AcceptedOwnerTransfer>()("auth:accept-owner-transfer"),
    declineOwnerTransfer: request<string, void>()("auth:decline-owner-transfer"),
    event: event<CentralAuthState>()("auth:event"),
    ownerTransfersChanged: event<undefined>()("auth:owner-transfers-changed"),
  },
  update: {
    getStatus: request<undefined, UpdateStatus>()("update:get-status"),
    check: request<undefined, UpdateStatus>()("update:check"),
    download: request<undefined, UpdateStatus>()("update:download"),
    install: request<undefined, UpdateStatus>()("update:install"),
    getPreference: request<undefined, UpdatePreference>()("update:get-preference"),
    setPreference: request<UpdatePreferenceChange, UpdatePreference>()("update:set-preference"),
    cancelScheduledRestart: request<undefined, UpdateStatus>()("update:cancel-scheduled-restart"),
    restartWhenIdle: request<IdleRestartTarget, UpdateStatus>()("update:restart-when-idle"),
    cancelIdleRestart: request<undefined, UpdateStatus>()("update:cancel-idle-restart"),
    restartNow: request<undefined, UpdateStatus>()("update:restart-now"),
    event: event<UpdateStatus>()("update:event"),
    preference: event<UpdatePreference>()("update:preference-event"),
  },
  notifications: {
    getPreference: request<undefined, NotificationPreference>()("notifications:get-preference"),
    setPreference: request<NotificationPreference, NotificationPreference>()("notifications:set-preference"),
    test: request<undefined, void>()("notifications:test"),
    openSettings: request<undefined, void>()("notifications:open-settings"),
    opened: event<NotificationOpenedEvent>()("notifications:opened-event"),
    workflowOpened: event<WorkflowNotificationOpenedEvent>()("notifications:workflow-opened-event"),
  },
  agent: {
    getStatus: scopedQuery<AgentStatus>()("agent:get-status"),
    getRuntimeSnapshot: scopedQuery<AgentRuntimeSnapshot | null>()("agent:get-runtime-snapshot"),
    getAnalytics: scopedRequest<AgentAnalyticsInput, AgentAnalytics | null, "required">()("agent:get-analytics"),
    getHostAnalytics: scopedRequest<HostAnalyticsInput, HostAnalytics | null, "required">()("host:get-analytics"),
    getUsage: scopedRequest<string | undefined, AccountUsage>()("agent:get-usage"),
    listModels: scopedQuery<ClientAgentModelOption[]>()("agent:list-models"),
    listAgents: scopedQuery<ClientAgentSummary[]>()("agent:list"),
    readAgentSessionSettings: scopedRequest<string, AgentSessionSettings>()("agent:session-settings:read"),
    setAgentSessionSetting: scopedRequest<SetAgentSessionSettingInput, AgentSessionSettings>()(
      "agent:session-settings:set",
    ),
    resetAgentSessionSetting: scopedRequest<ResetAgentSessionSettingInput, AgentSessionSettings>()(
      "agent:session-settings:reset",
    ),
    listInstalledSkills: scopedRequest<string, InstalledSkill[]>()("agent:list-installed-skills"),
    listChannels: scopedQuery<ChannelSummary[]>()("agent:channels:list"),
    readChannel: scopedRequest<ChannelReadInput, ChannelPage>()("agent:channels:read"),
    channelCommand: scopedRequest<ChannelCommand, Channel>()("agent:channels:command"),
    deleteChannel: scopedRequest<string, void>()("agent:channels:delete"),
    deleteChannelMessage: scopedRequest<DeleteChannelMessageInput, void>()("agent:channels:delete-message"),
    setChannelImage: scopedRequest<SetChannelImageInput, Channel>()("agent:channels:set-image"),
    clearChannelContext: scopedRequest<string, void>()("agent:channels:clear-context"),
    deleteChannelHistory: scopedRequest<string, void>()("agent:channels:delete-history"),
    compactChannelContext: scopedRequest<string, void>()("agent:channels:compact-context"),
    getSidebarLayout: scopedQuery<SidebarLayoutSnapshot>()("agent:get-sidebar-layout"),
    mutateSidebarLayout: scopedRequest<SidebarLayoutAction, SidebarLayoutSnapshot>()("agent:mutate-sidebar-layout"),
    getSidebarPins: scopedQuery<SidebarPinsSnapshot>()("agent:sidebar-pins:get"),
    setSidebarPins: scopedRequest<SetSidebarPinsInput, SidebarPinsSnapshot>()("agent:sidebar-pins:set"),
    seedSidebarPins: scopedRequest<SetSidebarPinsInput, SidebarPinsSnapshot>()("agent:sidebar-pins:seed"),
    listHiddenAgents: scopedQuery<HiddenAgentsSnapshot>()("agent:hidden:list"),
    setAgentHidden: scopedRequest<SetAgentHiddenInput, HiddenAgentsSnapshot>()("agent:hidden:set"),
    listAgentNotificationLevels: scopedQuery<AgentNotificationLevelsSnapshot>()("agent:notification-levels:list"),
    setAgentNotificationLevel: scopedRequest<SetAgentNotificationLevelInput, AgentNotificationLevelsSnapshot>()(
      "agent:notification-levels:set",
    ),
    generateProfile: scopedRequest<GenerateAgentProfileInput, AgentProfileDraft>()("agent:generate-profile"),
    saveProfile: scopedRequest<SaveAgentProfileInput, SaveAgentProfileResult>()("agent:save-profile"),
    askSideQuestion: scopedRequest<AskSideQuestionInput, string>()("agent:ask-side-question"),
    saveSkillSuggestion: scopedRequest<SaveSkillSuggestionInput, SaveSkillSuggestionResult>()(
      "agent:save-skill-suggestion",
    ),
    createAgent: scopedRequest<CreateAgentInput, ClientAgentSummary>()("agent:create"),
    duplicateAgent: scopedRequest<string, DuplicateAgentResult>()("agent:duplicate"),
    updateAgent: scopedRequest<UpdateAgentInput, ClientAgentSummary>()("agent:update"),
    setAvatar: scopedRequest<SetAgentAvatarInput, ClientAgentSummary>()("agent:set-avatar"),
    deleteAgent: scopedRequest<string, void>()("agent:delete"),
    readConversation: scopedRequest<string, ConversationWithReadState>()("agent:read-conversation"),
    readConversationPage: scopedRequest<ReadConversationPageInput, ConversationPage>()("agent:read-conversation-page"),
    searchConversationMessages: scopedRequest<SearchConversationMessagesInput, ConversationSearchPage>()(
      "agent:search-conversation-messages",
    ),
    openMessageLink: scopedRequest<OpenMessageLinkInput, McpSignInRelayPage | null>()("agent:open-message-link"),
    pasteMessageLink: scopedRequest<PasteMessageLinkInput, void>()("agent:paste-message-link"),
    cancelMessageLink: scopedRequest<CancelMessageLinkInput, void>()("agent:cancel-message-link"),
    searchConversationFiles: scopedRequest<SearchConversationFilesInput, ConversationFileSearchPage>()(
      "agent:search-conversation-files",
    ),
    listConversationReads: scopedQuery<Record<string, ConversationReadState>>()("agent:list-conversation-reads"),
    markConversationRead: scopedRequest<MarkConversationReadInput, ConversationReadState>()(
      "agent:mark-conversation-read",
    ),
    markConversationUnread: scopedRequest<MarkConversationUnreadInput, ConversationReadState>()(
      "agent:mark-conversation-unread",
    ),
    sendMessage: scopedRequest<SendMessageInput, QueuedMessageReceipt>()("agent:send-message"),
    setMessageReaction: scopedRequest<SetMessageReactionInput, void>()("agent:set-message-reaction"),
    deleteConversationMessage: scopedRequest<DeleteConversationMessageInput, void>()(
      "agent:delete-conversation-message",
    ),
    withdrawFeedback: scopedRequest<WithdrawFeedbackInput, WithdrawFeedbackResult>()("agent:withdraw-feedback"),
    listQueue: scopedRequest<string, QueueSnapshot>()("agent:list-queue"),
    listActiveQueues: scopedRequest<string[], AgentActiveQueues | null>()("agent:list-active-queues"),
    listWaits: scopedRequest<string, AgentWaitsSnapshot>()("agent:list-waits"),
    cancelWait: scopedRequest<CancelAgentWaitInput, void>()("agent:cancel-wait"),
    listPinnedMessages: scopedRequest<string, PinnedMessagesSnapshot>()("agent:list-pinned-messages"),
    setMessagePinned: scopedRequest<SetMessagePinnedInput, PinnedMessagesSnapshot>()("agent:set-message-pinned"),
    listTasks: scopedRequest<string, AgentTasksSnapshot>()("agent:tasks:list"),
    listArchivedTasks: scopedRequest<ListArchivedAgentTasksInput, ArchivedAgentTasksPage>()(
      "agent:tasks:list-archived",
    ),
    readTask: scopedRequest<AgentTaskInput, ConversationSnapshot>()("agent:tasks:read"),
    readTaskPage: scopedRequest<ReadAgentTaskPageInput, AgentTaskPage>()("agent:tasks:read-page"),
    readTaskAround: scopedRequest<ReadAgentTaskAroundInput, AgentTaskWindow>()("agent:tasks:read-around"),
    startTask: scopedRequest<StartAgentTaskInput, AgentTask>()("agent:tasks:start"),
    runQueuedMessageAsTask: scopedRequest<RunQueuedMessageAsTaskInput, AgentTask>()("agent:tasks:run-queued-message"),
    branchTask: scopedRequest<BranchAgentTaskInput, AgentTask>()("agent:tasks:branch"),
    stopTask: scopedRequest<AgentTaskInput, void>()("agent:tasks:stop"),
    closeTask: scopedRequest<AgentTaskInput, void>()("agent:tasks:close"),
    reopenTask: scopedRequest<AgentTaskInput, void>()("agent:tasks:reopen"),
    renameTask: scopedRequest<RenameAgentTaskInput, void>()("agent:tasks:rename"),
    deleteTask: scopedRequest<AgentTaskInput, void>()("agent:tasks:delete"),
    listTaskReads: scopedRequest<string, AgentTaskReadState[]>()("agent:tasks:reads"),
    markTaskRead: scopedRequest<MarkAgentTaskReadInput, AgentTaskReadState>()("agent:tasks:mark-read"),
    acknowledgeFailedTurn: scopedRequest<AcknowledgeFailedTurnInput, void>()("agent:acknowledge-failed-turn"),
    cancelQueuedMessage: scopedRequest<CancelQueuedMessageInput, void>()("agent:cancel-queued-message"),
    steerQueuedMessage: scopedRequest<SteerQueuedMessageInput, void>()("agent:steer-queued-message"),
    editQueuedMessage: scopedRequest<EditQueuedMessageInput, QueueSnapshot>()("agent:edit-queued-message"),
    updateQueuedMessage: scopedRequest<UpdateQueuedMessageInput, void>()("agent:update-queued-message"),
    reorderQueue: scopedRequest<ReorderQueueInput, void>()("agent:reorder-queue"),
    interrupt: scopedRequest<InterruptTurnInput, void>()("agent:interrupt"),
    clearContext: scopedRequest<string, void>()("agent:clear-context"),
    deleteHistory: scopedRequest<string, void>()("agent:delete-history"),
    compactContext: scopedRequest<string, void>()("agent:compact-context"),
    compactTaskContext: scopedRequest<AgentTaskInput, void>()("agent:tasks:compact-context"),
    respondToPrompt: scopedRequest<RespondToPromptInput, void>()("agent:respond-to-prompt"),
    respondToApproval: scopedRequest<RespondToApprovalInput, void>()("agent:respond-to-approval"),
    readPendingApproval: scopedRequest<ReadPendingApprovalInput, AgentApproval | null>()("agent:read-pending-approval"),
    readMediaApproval: scopedRequest<ReadMediaApprovalInput, MediaApprovalRead>()("agent:read-media-approval"),
    respondToMediaApproval: scopedRequest<RespondToMediaApprovalInput, void>()("agent:respond-to-media-approval"),
    respondToCreditsHold: scopedRequest<RespondToCreditsHoldInput, CreditsHold | null>()(
      "agent:respond-to-credits-hold",
    ),
    setCreditsAskMuted: scopedRequest<{ muted: boolean }, void>()("agent:set-credits-ask-muted"),
    readCreditsAskMuted: scopedQuery<{ muted: boolean }>()("agent:read-credits-ask-muted"),
    listPendingPrompts: scopedQuery<AgentRuntimePrompt[]>()("agent:list-pending-prompts"),
    respondToBrowserSecret: scopedRequest<LocalBrowserSecretResponse, void>()("agent:respond-to-browser-secret"),
    respondToBrowserTakeover: scopedRequest<RespondToBrowserTakeoverInput, void>()("agent:respond-to-browser-takeover"),
    scopedEvent: event<ScopedAgentEvent>()("agent:event"),
  },
  agentMemories: {
    getMemorySelection: scopedRequest<string, AgentMemorySelectionState | null>()("agent:get-memory-selection"),
    setMemoryInclusion: scopedRequest<SetAgentMemoryInclusionInput, AgentMemorySelectionState>()(
      "agent:set-memory-inclusion",
    ),
    listMemories: scopedRequest<string, AgentMemory[]>()("agent:list-memories"),
    createMemory: scopedRequest<CreateAgentMemoryInput, AgentMemory>()("agent:create-memory"),
    updateMemory: scopedRequest<UpdateAgentMemoryInput, AgentMemory>()("agent:update-memory"),
    deleteMemory: scopedRequest<DeleteAgentMemoryInput, void>()("agent:delete-memory"),
    clearMemories: scopedRequest<string, void>()("agent:clear-memories"),
  },
  sharedTables: {
    listTables: scopedQuery<SharedTable[]>()("shared:list-tables"),
    deleteTable: scopedRequest<DeleteSharedTableInput, void>()("shared:delete-table"),
  },
  agentRoutines: {
    listRoutines: scopedRequest<string, Routine[]>()("agent:list-routines"),
    createRoutine: scopedRequest<CreateRoutineInput, Routine>()("agent:create-routine"),
    updateRoutine: scopedRequest<UpdateRoutineInput, Routine>()("agent:update-routine"),
    deleteRoutine: scopedRequest<DeleteRoutineInput, void>()("agent:delete-routine"),
    testRoutine: scopedRequest<TestRoutineInput, RoutineRun>()("agent:test-routine"),
    listRoutineRuns: scopedRequest<ListRoutineRunsInput, RoutineRun[]>()("agent:list-routine-runs"),
    automationRunCommand: scopedRequest<TestRoutineInput, string>()("agent:automation-run-command"),
    routineCalendar: scopedRequest<RoutineCalendarInput, RoutineCalendar>()("agent:routine-calendar"),
  },
  channelMemories: {
    listChannelMemories: scopedRequest<string, ChannelMemory[]>()("agent:channel-memories:list"),
    createChannelMemory: scopedRequest<CreateChannelMemoryInput, ChannelMemory>()("agent:channel-memories:create"),
    updateChannelMemory: scopedRequest<UpdateChannelMemoryInput, ChannelMemory>()("agent:channel-memories:update"),
    deleteChannelMemory: scopedRequest<DeleteChannelMemoryInput, void>()("agent:channel-memories:delete"),
    clearChannelMemories: scopedRequest<string, void>()("agent:channel-memories:clear"),
  },
  channelFolders: {
    listChannelFolders: scopedRequest<string, ChannelFolderList>()("agent:channel-folders:list"),
    chooseChannelFolder: request<string, ChannelFolderChange>()("agent:channel-folders:choose"),
    addChannelFolder: scopedRequest<ChannelFolderInput, ChannelFolderChange>()("agent:channel-folders:add"),
    removeChannelFolder: scopedRequest<ChannelFolderInput, ChannelFolderChange>()("agent:channel-folders:remove"),
    browseChannelFolders: scopedRequest<BrowseChannelFoldersInput, AgentFolderBrowse>()("agent:channel-folders:browse"),
  },
  channelRoutines: {
    listChannelRoutines: scopedRequest<string, ChannelRoutine[]>()("agent:channel-routines:list"),
    createChannelRoutine: scopedRequest<CreateChannelRoutineInput, ChannelRoutine>()("agent:channel-routines:create"),
    updateChannelRoutine: scopedRequest<UpdateChannelRoutineInput, ChannelRoutine>()("agent:channel-routines:update"),
    deleteChannelRoutine: scopedRequest<DeleteChannelRoutineInput, void>()("agent:channel-routines:delete"),
    testChannelRoutine: scopedRequest<TestChannelRoutineInput, ChannelRoutineRun>()("agent:channel-routines:test"),
    listChannelRoutineRuns: scopedRequest<ListChannelRoutineRunsInput, ChannelRoutineRun[]>()(
      "agent:channel-routines:runs",
    ),
  },
  workflows: {
    list: scopedQuery<WorkflowSummary[]>()("workflows:list"),
    get: scopedRequest<string, WorkflowDetail>()("workflows:get"),
    create: scopedRequest<CreateWorkflowInput, WorkflowDetail>()("workflows:create"),
    rename: scopedRequest<RenameWorkflowInput, WorkflowSummary>()("workflows:rename"),
    setPaused: scopedRequest<SetWorkflowPausedInput, WorkflowSummary>()("workflows:setPaused"),
    exportFile: scopedRequest<string, WorkflowFileSaveResult>()("workflows:export-file"),
    delete: scopedRequest<string, void>()("workflows:delete"),
    saveGraph: scopedRequest<SaveWorkflowGraphInput, WorkflowSaveResult>()("workflows:save-graph"),
    versions: scopedRequest<string, WorkflowVersion[]>()("workflows:versions"),
    versionGraph: scopedRequest<WorkflowVersionInput, WorkflowGraph>()("workflows:version-graph"),
    restoreVersion: scopedRequest<WorkflowVersionInput, WorkflowDetail>()("workflows:restore-version"),
    startRun: scopedRequest<StartWorkflowRunInput, WorkflowRunDetail>()("workflows:start-run"),
    runStep: scopedRequest<RunWorkflowStepInput, WorkflowStep>()("workflows:run-step"),
    stopStep: scopedRequest<string, void>()("workflows:stop-step"),
    stopRun: scopedRequest<string, void>()("workflows:stop-run"),
    retryStep: scopedRequest<RetryWorkflowStepInput, WorkflowStep>()("workflows:retry-step"),
    decide: scopedRequest<DecideWorkflowStepInput, void>()("workflows:decide"),
    runs: scopedRequest<WorkflowRunsInput, WorkflowRunPage>()("workflows:runs"),
    run: scopedRequest<string, WorkflowRunDetail>()("workflows:run"),
    stepSettings: scopedRequest<string, WorkflowStepSettings>()("workflows:step-settings"),
    rotateWebhookSecret: scopedRequest<WorkflowTriggerInput, WorkflowWebhookSecret>()(
      "workflows:rotate-webhook-secret",
    ),
    githubCatalog: scopedQuery<WorkflowGitHubCatalog>()("workflows:github-catalog"),
    githubOptions: scopedRequest<WorkflowGitHubRepositoryInput, WorkflowGitHubRepositoryOptions>()(
      "workflows:github-options",
    ),
    githubHistory: scopedRequest<string, WorkflowGitHubHistory>()("workflows:github-history"),
    githubRunLastEvent: scopedRequest<WorkflowGitHubLastEventInput, WorkflowRunDetail>()(
      "workflows:github-run-last-event",
    ),
    keepPicture: scopedRequest<string, string>()("workflows:keep-picture"),
    mediaProviders: scopedQuery<WorkflowMediaProviders>()("workflows:media-providers"),
    mediaCredits: scopedQuery<WorkflowMediaCredits>()("workflows:media-credits"),
    mediaCatalog: scopedQuery<WorkflowMediaCatalog>()("workflows:media-catalog"),
    mediaPrice: scopedRequest<WorkflowMediaPriceRequest, WorkflowMediaPrice>()("workflows:media-price"),
    folders: scopedQuery<WorkflowFoldersSnapshot>()("workflows:folders"),
    folderAction: scopedRequest<WorkflowFolderAction, WorkflowFoldersSnapshot>()("workflows:folder-action"),
  },
  crm: {
    overview: scopedQuery<CrmOverview>()("crm:overview"),
    customers: scopedRequest<CrmCustomerPageInput, CrmCustomerPage>()("crm:customers"),
    payments: scopedRequest<CrmPaymentPageInput, CrmPaymentPage>()("crm:payments"),
    activity: scopedRequest<CrmActivityPageInput, CrmActivityPage>()("crm:activity"),
    apply: scopedRequest<CrmChange, CrmApplyResult>()("crm:apply"),
    sourceConnect: scopedRequest<CrmSourceConnectInput, CrmApplyResult>()("crm:source-connect"),
    sourceDisconnect: scopedRequest<CrmSourceInput, CrmApplyResult>()("crm:source-disconnect"),
    sourceSync: scopedRequest<CrmSourceInput, CrmApplyResult>()("crm:source-sync"),
    settings: scopedQuery<CrmSettings>()("crm:settings"),
    setSettings: scopedRequest<CrmSettings, CrmSettings>()("crm:set-settings"),
  },
  routineResults: {
    options: scopedQuery<RoutineResultConnectionOption[], "required">()("routine-results:options"),
    destination: scopedRequest<RoutineResultRoutineInput, RoutineResultDestination | null, "required">()(
      "routine-results:destination",
    ),
    setDestination: scopedRequest<SetRoutineResultDestinationInput, RoutineResultDestination | null, "required">()(
      "routine-results:set-destination",
    ),
    deliveries: request<RoutineResultRoutineInput, RoutineResultDelivery[]>()("routine-results:deliveries"),
    resend: request<ResendRoutineResultInput, void>()("routine-results:resend"),
  },
  agentAttachments: {
    importAttachmentData: scopedRequest<AttachmentDataInput[], DraftAttachment[]>()("agent:import-attachment-data"),
    chooseAttachments: scopedRequest<ChooseAttachmentsInput, DraftAttachment[]>()("agent:choose-attachments"),
    discardDraftAttachment: scopedRequest<string, void>()("agent:discard-draft-attachment"),
    downloadAttachments: scopedRequest<DownloadAttachmentsInput, void>()("agent:download-attachments"),
    openAttachment: scopedRequest<OpenAttachmentInput, void>()("agent:open-attachment"),
    stopAttachmentDownload: scopedRequest<string, void>()("agent:stop-attachment-download"),
    attachmentDownload: event<AttachmentDownloadProgress>()("agent:attachment-download"),
    openSharedFile: scopedRequest<OpenSharedFileInput, void>()("agent:open-shared-file"),
    openWorkspaceFile: scopedRequest<OpenWorkspaceFileInput, void>()("agent:open-workspace-file"),
    previewSharedFile: scopedRequest<PreviewSharedFileInput, FilePreview>()("agent:preview-shared-file"),
    previewWorkspaceFile: scopedRequest<PreviewWorkspaceFileInput, FilePreview>()("agent:preview-workspace-file"),
    releaseFilePreview: request<string, void>()("agent:release-file-preview"),
    addPreviewPage: request<string, string | null>()("agent:add-preview-page"),
    listWorkspaceDirectory: scopedRequest<OpenWorkspaceFileInput, WorkspaceDirectory>()(
      "agent:list-workspace-directory",
    ),
  },
  agentFolders: {
    listAgentFolders: scopedRequest<string, AgentFolderList>()("agent:folders:list"),
    chooseAgentFolder: request<ChooseAgentFolderInput, AgentFolderChange>()("agent:folders:choose"),
    addAgentFolder: scopedRequest<AddAgentFolderInput, AgentFolderChange>()("agent:folders:add"),
    removeAgentFolder: scopedRequest<AgentFolderInput, AgentFolderChange>()("agent:folders:remove"),
    chooseAgentExclusion: request<string, AgentExclusionChange>()("agent:folders:exclusions:choose"),
    addAgentExclusion: scopedRequest<AgentFolderInput, AgentExclusionChange>()("agent:folders:exclusions:add"),
    removeAgentExclusion: scopedRequest<AgentFolderInput, AgentExclusionChange>()("agent:folders:exclusions:remove"),
    browseAgentFolders: scopedRequest<BrowseAgentFoldersInput, AgentFolderBrowse>()("agent:folders:browse"),
  },
  agentInstructions: {
    readAgentInstructions: scopedRequest<string, AgentInstructionsFile>()("agent:instructions:read"),
    saveAgentInstructions: scopedRequest<SaveAgentInstructionsInput, AgentInstructionsFile>()(
      "agent:instructions:save",
    ),
    revealAgentInstructions: request<string, void>()("agent:instructions:reveal"),
  },
  attachmentImports: {
    importAttachments: scopedRequest<ImportAttachmentsInput, DraftAttachment[]>()("agent:import-attachments"),
    importProgress: event<AttachmentImportProgress>()("agent:attachment-import-progress"),
  },
  browser: {
    open: request<BrowserOpenInput, BrowserTab>()("browser:open"),
    activate: request<string, void>()("browser:activate"),
    navigate: request<BrowserNavigateInput, void>()("browser:navigate"),
    reload: request<string, void>()("browser:reload"),
    stop: request<string, void>()("browser:stop"),
    close: request<string, void>()("browser:close"),
    takeControl: request<string, void>()("browser:take-control"),
    releaseControl: request<string, void>()("browser:release-control"),
    startTeach: request<string, void>()("browser:teach-start"),
    stopTeach: request<BrowserTeachStopInput, BrowserTeachStep[]>()("browser:teach-stop"),
    listTabs: request<undefined, BrowserTab[]>()("browser:list-tabs"),
    getDisplayState: request<undefined, BrowserDisplayState>()("browser:get-display-state"),
    getControlState: request<undefined, BrowserControlState>()("browser:get-control-state"),
    capturePreview: request<string, BrowserPreview>()("browser:capture-preview"),
    setVisible: request<BrowserVisibilityInput, void>()("browser:set-visible"),
    startLiveView: request<string, void>()("browser:start-live-view"),
    stopLiveView: request<undefined, void>()("browser:stop-live-view"),
    liveViewEvent: event<BrowserLiveViewEvent>()("browser:live-view-event"),
    displayState: event<BrowserDisplayState>()("browser:display-state-event"),
    openPictureInPicture: request<BrowserBounds | undefined, BrowserBounds>()("browser:picture-in-picture-open"),
    closePictureInPicture: request<undefined, void>()("browser:picture-in-picture-close"),
    dockPictureInPicture: request<undefined, void>()("browser:picture-in-picture-dock"),
    hidePictureInPicture: request<undefined, void>()("browser:picture-in-picture-hide"),
    pictureInPictureEvent: event<BrowserPictureInPictureEvent>()("browser:picture-in-picture-event"),
    openWindow: request<BrowserBounds | undefined, BrowserBounds>()("browser:window-open"),
    closeWindow: request<undefined, void>()("browser:window-close"),
    focusWindow: request<undefined, void>()("browser:window-focus"),
    dockWindow: request<undefined, void>()("browser:window-dock"),
    publishWindowModel: request<BrowserWindowModel, void>()("browser:window-model-publish"),
    getWindowModel: request<undefined, BrowserWindowModel | null>()("browser:window-model-get"),
    sendWindowAction: request<BrowserWindowAction, void>()("browser:window-action"),
    windowModel: event<BrowserWindowModel>()("browser:window-model-event"),
    windowEvent: event<BrowserWindowEvent>()("browser:window-event"),
    openLocalSignIn: request<BrowserLocalSignInInput, BrowserLocalSignInEnd>()("browser:local-sign-in-open"),
    finishLocalSignIn: request<BrowserLocalSignInFinish, BrowserLocalSignInResult | null>()(
      "browser:local-sign-in-finish",
    ),
  },
  browserInput: {
    sendLiveViewInput: untypedRequest("browser:send-live-view-input"),
  },
  servers: {
    list: request<undefined, ServerSummary[]>()("servers:list"),
    select: request<string, ServerSummary[]>()("servers:select"),
    reorder: request<ReorderServersInput, ServerSummary[]>()("servers:reorder"),
    setMuted: request<SetServerMutedInput, ServerSummary[]>()("servers:set-muted"),
    setHidden: request<SetServerHiddenInput, ServerSummary[]>()("servers:set-hidden"),
    setNotificationLevel: request<SetServerNotificationLevelInput, ServerSummary[]>()("servers:set-notification-level"),
    join: request<JoinServerInput, ServerSummary>()("servers:join"),
    previewInvite: request<JoinServerInput, InvitePreview>()("servers:preview-invite"),
    takePendingInvite: request<undefined, string | null>()("servers:take-pending-invite"),
    login: request<LoginServerInput, ServerSummary>()("servers:login"),
    retryConnection: request<string, ServerSummary>()("servers:retry-connection"),
    remove: request<string, void>()("servers:remove"),
    getPresence: request<undefined, TeamPresenceSnapshot>()("servers:get-presence"),
    getPresenceFor: request<string, TeamPresenceSnapshot>()("servers:get-presence-for"),
    refreshIdentity: request<string, ServerSummary>()("servers:refresh-identity"),
    listMembers: request<string, TeamMemberSummary[]>()("servers:list-members"),
    updateMember: scopedRequest<UpdateTeamMemberInput, TeamMemberSummary, "required">()("servers:update-member"),
    removeMember: scopedRequest<string, void, "required">()("servers:remove-member"),
    listInvites: request<string, TeamInviteSummary[]>()("servers:list-invites"),
    revokeInvite: scopedRequest<string, void, "required">()("servers:revoke-invite"),
    createInvite: scopedRequest<CreateTeamInviteInput, InviteSummary, "required">()("servers:create-invite"),
    getOwnerTransfer: scopedQuery<OwnerTransfer | null, "required">()("servers:get-owner-transfer"),
    startOwnerTransfer: scopedRequest<string, OwnerTransfer, "required">()("servers:start-owner-transfer"),
    cancelOwnerTransfer: scopedQuery<void, "required">()("servers:cancel-owner-transfer"),
    setTyping: request<SetTeamTypingInput, void>()("servers:set-typing"),
    scopedPresence: event<ScopedTeamPresenceSnapshot>()("servers:presence"),
    listDirectThreads: request<undefined, DirectThreadSummary[]>()("servers:list-direct-threads"),
    readDirectConversation: request<string, DirectConversationSnapshot>()("servers:read-direct-conversation"),
    readDirectConversationPage: request<ReadDirectConversationPageInput, DirectConversationPage>()(
      "servers:read-direct-conversation-page",
    ),
    sendDirectMessage: request<SendDirectMessageInput, DirectMessage>()("servers:send-direct-message"),
    markDirectRead: request<MarkDirectReadInput, DirectConversationReadState>()("servers:mark-direct-read"),
    setDirectTyping: request<DirectTypingInput, void>()("servers:set-direct-typing"),
    scopedDirectMessage: event<ScopedDirectMessageEvent>()("servers:direct-message"),
    scopedDirectTyping: event<ScopedDirectTypingEvent>()("servers:direct-typing"),
    event: event<ServerSummary[]>()("servers:event"),
    invite: event<string>()("servers:invite"),
  },
  agentAdmin: {
    getAgentHostSettings: scopedRequest<string, AgentHostSettings>()("agent:admin:get-host-settings"),
    updateAgentHostSettings: scopedRequest<UpdateAgentHostSettingsInput, AgentHostSettings>()(
      "agent:admin:update-host-settings",
    ),
    getAgentBackupModels: scopedRequest<string, AgentBackupModelSettings>()("agent:admin:get-backup-models"),
    updateAgentBackupModels: scopedRequest<UpdateAgentBackupModelsInput, AgentBackupModelSettings>()(
      "agent:admin:update-backup-models",
    ),
    getAgentNewChat: scopedRequest<string, AgentNewChatSettings>()("agent:admin:get-new-chat"),
    updateAgentNewChat: scopedRequest<UpdateAgentNewChatInput, AgentNewChatSettings>()("agent:admin:update-new-chat"),
    previewAgentTemplate: scopedRequest<string, AgentTemplatePreview>()("agent:admin:preview-template"),
    publishAgentTemplate: scopedRequest<PublishAgentTemplateInput, AgentTemplatePublication>()(
      "agent:admin:publish-template",
    ),
    unpublishAgentTemplate: scopedRequest<string, void>()("agent:admin:unpublish-template"),
    getAgentPlanCard: scopedRequest<string, AgentPlanCardSettings>()("agent:admin:get-plan-card"),
    updateAgentPlanCard: scopedRequest<UpdateAgentPlanCardInput, AgentPlanCardSettings>()(
      "agent:admin:update-plan-card",
    ),
    getAgentBuiltinMemory: scopedRequest<string, AgentBuiltinMemorySettings>()("agent:admin:get-builtin-memory"),
    updateAgentBuiltinMemory: scopedRequest<UpdateAgentBuiltinMemoryInput, AgentBuiltinMemorySettings>()(
      "agent:admin:update-builtin-memory",
    ),
    getAgentFastMode: scopedRequest<string, AgentFastModeSettings>()("agent:admin:get-fast-mode"),
    updateAgentFastMode: scopedRequest<UpdateAgentFastModeInput, AgentFastModeSettings>()(
      "agent:admin:update-fast-mode",
    ),
    listBrowserProfiles: scopedQuery<BrowserProfileList>()("agent:admin:list-browser-profiles"),
    createBrowserProfile: scopedRequest<string, BrowserProfileSummary>()("agent:admin:create-browser-profile"),
    updateBrowserProfile: scopedRequest<UpdateBrowserProfileInput, BrowserProfileSummary>()(
      "agent:admin:edit-browser-profile",
    ),
    clearBrowserData: scopedRequest<ClearBrowserDataInput, void>()("agent:admin:clear-browser-data"),
    deleteBrowserProfile: scopedRequest<string, void>()("agent:admin:delete-browser-profile"),
    getAgentBrowserProfile: scopedRequest<string, AgentBrowserProfile>()("agent:admin:get-browser-profile"),
    updateAgentBrowserProfile: scopedRequest<UpdateAgentBrowserProfileInput, AgentBrowserProfile>()(
      "agent:admin:update-browser-profile",
    ),
    getAgentDefaultsOverview: scopedQuery<AgentDefaultsOverview, "required">()("agent:admin:get-agent-defaults"),
    updateAgentDefaultsOverview: scopedRequest<UpdateAgentDefaultsInput, AgentDefaultsOverview, "required">()(
      "agent:admin:update-agent-defaults",
    ),
    setAgentDefaultChoice: scopedRequest<SetAgentDefaultChoiceInput, AgentDefaultsOverview, "required">()(
      "agent:admin:set-agent-default-choice",
    ),
    listBrowserProxies: scopedQuery<BrowserProxyList | null>()("agent:admin:list-browser-proxies"),
    saveBrowserProxy: scopedRequest<SaveBrowserProxyInput, BrowserProxySummary>()("agent:admin:save-browser-proxy"),
    deleteBrowserProxy: scopedRequest<DeleteBrowserProxyInput, void>()("agent:admin:delete-browser-proxy"),
    setBrowserProfileProxy: scopedRequest<SetBrowserProfileProxyInput, void>()("agent:admin:set-browser-profile-proxy"),
    getBrowserComputerSharing: scopedQuery<BrowserComputerSharing | null>()("agent:admin:get-browser-computer-sharing"),
    setBrowserComputerSharing: scopedRequest<BrowserComputerSharing, void>()(
      "agent:admin:set-browser-computer-sharing",
    ),
    listBrowserTabProfiles: scopedQuery<BrowserTabProfile[]>()("agent:admin:list-browser-tab-profiles"),
    getAgentAdminSettings: scopedRequest<string, AgentAdminSettings>()("agent:admin:get-settings"),
    updateAgentAdminSettings: scopedRequest<UpdateAgentAdminSettingsInput, AgentAdminSettings>()(
      "agent:admin:update-settings",
    ),
    listAgentSkills: scopedRequest<string, InstalledSkill[], "required">()("agent:admin:list-skills"),
    installAgentSkill: scopedRequest<InstallSkillInput, InstalledSkill, "required">()("agent:admin:install-skill"),
    uninstallAgentSkill: scopedRequest<UninstallSkillInput, void, "required">()("agent:admin:uninstall-skill"),
    setAgentSkillEnabled: scopedRequest<SetEnabledSkillInput, InstalledSkill, "required">()(
      "agent:admin:set-skill-enabled",
    ),
    readGithubSkills: scopedRequest<string, GithubSkillSource, "required">()("agent:admin:read-github-skills"),
    addMarketplaceAgent: scopedRequest<InstallMarketplaceAgentInput, AddedAgent, "required">()(
      "agent:admin:add-marketplace-agent",
    ),
    addTemplateAgent: scopedRequest<InstallAgentTemplateInput, AddedAgent, "required">()(
      "agent:admin:add-template-agent",
    ),
  },
  mcpServers: {
    listMcpServers: scopedQuery<McpServerConfig[], "required">()("servers:mcp:list"),
    saveMcpServer: scopedRequest<SaveMcpServerInput, McpServerConfig[], "required">()("servers:mcp:save"),
    removeMcpServer: scopedRequest<RemoveMcpServerInput, McpServerConfig[], "required">()("servers:mcp:remove"),
    setMcpServerEnabled: scopedRequest<SetMcpServerEnabledInput, McpServerConfig[], "required">()(
      "servers:mcp:set-enabled",
    ),
    testMcpServer: scopedRequest<TestMcpServerInput, McpTestResult, "required">()("servers:mcp:test"),
    signInMcpServer: scopedRequest<TestMcpServerInput, McpTestResult, "required">()("servers:mcp:sign-in"),
    mcpSignInPage: scopedRequest<CancelMcpSignInInput, string | null, "required">()("servers:mcp:sign-in-page"),
    mcpSignInRelay: scopedRequest<CancelMcpSignInInput, McpSignInRelayPage | null, "required">()(
      "servers:mcp:sign-in-relay",
    ),
    openMcpSignInRelay: scopedRequest<CancelMcpSignInInput, void, "required">()("servers:mcp:open-sign-in-relay"),
    completeMcpSignInRelay: scopedRequest<CompleteMcpSignInRelayInput, void, "required">()(
      "servers:mcp:complete-sign-in-relay",
    ),
    cancelMcpSignIn: scopedRequest<CancelMcpSignInInput, void, "required">()("servers:mcp:cancel-sign-in"),
    copyMcpSignInLink: scopedRequest<CancelMcpSignInInput, void, "required">()("servers:mcp:copy-sign-in-link"),
    signOutMcpServer: scopedRequest<SignOutMcpServerInput, McpSignInState[], "required">()("servers:mcp:sign-out"),
    listMcpSignIns: scopedQuery<McpSignInState[], "required">()("servers:mcp:list-sign-ins"),
    mcpSignInApp: scopedRequest<McpSignInAppInput, McpSignInAppState, "required">()("servers:mcp:sign-in-app"),
    saveMcpSignInApp: scopedRequest<SaveMcpSignInAppInput, McpSignInAppState, "required">()(
      "servers:mcp:save-sign-in-app",
    ),
    removeMcpSignInApp: scopedRequest<McpSignInAppInput, McpSignInAppState, "required">()(
      "servers:mcp:remove-sign-in-app",
    ),
    getMcpAccess: scopedQuery<McpAccessSnapshot, "required">()("servers:mcp:get-access"),
    setMcpAccess: scopedRequest<SetMcpAccessInput, McpAccessSnapshot, "required">()("servers:mcp:set-access"),
  },
  storage: {
    getUsage: scopedRequest<GetStorageUsageInput, StorageUsage | null, "required">()("storage:get-usage"),
    getDisk: scopedQuery<StorageDisk | null, "required">()("storage:get-disk"),
    getMachineMetrics: scopedQuery<MachineMetrics | null, "required">()("storage:get-machine-metrics"),
    deleteFile: scopedRequest<DeleteStoredFileInput, void, "required">()("storage:delete-file"),
    clear: scopedRequest<ClearStorageInput, void, "required">()("storage:clear"),
    openFile: scopedRequest<OpenStoredFileInput, void, "required">()("storage:open-file"),
    openLocation: request<OpenStorageLocationInput, void>()("storage:open-location"),
    getLibraryFolders: scopedQuery<LibraryFoldersSnapshot | null, "required">()("storage:get-library-folders"),
    changeLibraryFolders: scopedRequest<LibraryFolderAction, LibraryFoldersSnapshot, "required">()(
      "storage:change-library-folders",
    ),
    getRemovableRuntimes: request<undefined, RemovableRuntimes>()("storage:get-removable-runtimes"),
    removeRemovableRuntimes: request<undefined, RemovableRuntimes>()("storage:remove-removable-runtimes"),
  },
  agentImport: {
    choose: scopedQuery<AgentImportPreview | null, "required">()("agent-import:choose"),
    apply: scopedRequest<ApplyAgentImportInput, AgentImportResult, "required">()("agent-import:apply"),
    discard: scopedRequest<string, void, "required">()("agent-import:discard"),
    readSkill: request<AgentImportSkillSource, string>()("agent-import:read-skill"),
    saveSkill: request<AgentImportSkillSource, ExportResult>()("agent-import:save-skill"),
    readHermes: scopedQuery<HermesImportPreview | null, "required">()("agent-import:read-hermes"),
    chooseHermes: request<undefined, HermesImportPreview | null>()("agent-import:choose-hermes"),
    applyHermes: scopedRequest<ApplyHermesImportInput, AgentImportResult, "required">()("agent-import:apply-hermes"),
    discardHermes: scopedRequest<string, void, "required">()("agent-import:discard-hermes"),
  },
  instanceTransfer: {
    summary: scopedQuery<InstanceTransferSummary, "required">()("instance-transfer:summary"),
    export: scopedRequest<ExportInstanceInput, InstanceExportResult, "required">()("instance-transfer:export"),
    showExport: request<undefined, void>()("instance-transfer:show-export"),
    choose: scopedQuery<InstanceTransferPreview | null, "required">()("instance-transfer:choose"),
    apply: scopedRequest<ApplyInstanceTransferInput, InstanceTransferResult, "required">()("instance-transfer:apply"),
    discard: scopedRequest<string, void, "required">()("instance-transfer:discard"),
    copy: scopedRequest<CopyInstanceAgentsInput, InstanceTransferResult, "required">()("instance-transfer:copy"),
    uploadProgress: event<InstanceTransferUploadProgress>()("instance-transfer:upload-progress"),
  },
  plugins: {
    takePendingListing: request<undefined, string | null>()("plugins:take-pending-listing"),
    openListing: event<string>()("plugins:open-listing"),
  },
  marketplace: {
    takePendingListing: request<undefined, MarketplaceListingLink | null>()("marketplace:take-pending-listing"),
    openListing: event<MarketplaceListingLink>()("marketplace:open-listing"),
  },
  host: {
    getStatus: request<undefined, HostStatus>()("host:get-status"),
    configure: request<ConfigureHostInput, HostStatus>()("host:configure"),
    updateIdentity: request<UpdateHostIdentityInput, HostStatus>()("host:update-identity"),
    rotateIdentityKey: request<undefined, HostStatus>()("host:rotate-identity-key"),
    getPresence: request<undefined, TeamPresenceSnapshot>()("host:get-presence"),
    start: request<undefined, HostStatus>()("host:start"),
    stop: request<undefined, HostStatus>()("host:stop"),
    recheckScreenRecording: request<undefined, HostStatus>()("host:recheck-screen-recording"),
    listMembers: request<undefined, TeamMemberSummary[]>()("host:list-members"),
    createInvite: request<CreateTeamInviteInput, InviteSummary>()("host:create-invite"),
    listInvites: request<undefined, TeamInviteSummary[]>()("host:list-invites"),
    revokeInvite: request<string, void>()("host:revoke-invite"),
    updateMember: request<UpdateTeamMemberInput, TeamMemberSummary>()("host:update-member"),
    removeMember: request<string, void>()("host:remove-member"),
    listSessions: request<undefined, TeamSessionSummary[]>()("host:list-sessions"),
    revokeSession: request<string, void>()("host:revoke-session"),
    getRemoteControlPolicy: request<undefined, RemoteControlPolicy>()("host:get-remote-control-policy"),
    setRemoteControlPolicy: request<RemoteControlPolicy, RemoteControlPolicy>()("host:set-remote-control-policy"),
    stopRemoteControl: request<undefined, HostStatus>()("host:stop-remote-control"),
    event: event<HostStatus>()("host:event"),
  },
  events: {
    getStatus: scopedQuery<EventStatus, "required">()("events:get-status"),
    listRoutines: scopedRequest<ListEventRoutinesInput, EventRoutine[], "required">()("events:list-routines"),
    saveRoutine: scopedRequest<SaveEventRoutineInput, SaveEventRoutineResult, "required">()("events:save-routine"),
    deleteRoutine: scopedRequest<EventRoutineRef, void, "required">()("events:delete-routine"),
    testRoutine: scopedRequest<EventRoutineRef, void, "required">()("events:test-routine"),
    rotateSecret: scopedRequest<EventRoutineRef, WebhookSecret, "required">()("events:rotate-secret"),
    setSecret: scopedRequest<SetWebhookSecretInput, void, "required">()("events:set-secret"),
    giveSecretToAgent: scopedRequest<EventRoutineRef, AgentWebhookSecret, "required">()("events:give-secret-to-agent"),
    sendTestEvent: scopedRequest<EventRoutineRef, WebhookTestResult, "required">()("events:send-test-event"),
    listActivity: scopedRequest<ListEventActivityInput, EventActivity[], "required">()("events:list-activity"),
    listRoutineRuns: scopedRequest<ListEventRoutineRunsInput, EventRoutineRun[], "required">()(
      "events:list-routine-runs",
    ),
  },

  remoteDesktop: {
    checkSetup: request<string, RemoteDesktopSetupStatus>()("remote-desktop:check-setup"),
    openSetup: request<RemoteDesktopSetupAction, void>()("remote-desktop:open-setup"),
    test: request<RemoteDesktopTestInput, RemoteDesktopTestStatus>()("remote-desktop:test"),
    list: request<undefined, RemoteDesktopSession[]>()("remote-desktop:list"),
    connect: request<RemoteDesktopConnectInput, RemoteDesktopConnectResult>()("remote-desktop:connect"),
    selectDisplay: request<RemoteDesktopSelectDisplayInput, void>()("remote-desktop:select-display"),
    disconnect: request<string, void>()("remote-desktop:disconnect"),
    event: event<RemoteDesktopSession[]>()("remote-desktop:event"),
  },
} as const;

export type IpcEndpoints = typeof IPC_ENDPOINTS;

export const IPC_GROUP_PATHS = {
  app: "",
  maintenance: "maintenance",
  providers: "",
  providerRuntimes: "providerRuntimes",
  voice: "voice",
  dynamicIsland: "dynamicIsland",
  browserDock: "browserDock",
  agentDock: "agentDock",
  computerUse: "computerUse",
  macAutomation: "macAutomation",
  backgroundProcesses: "backgroundProcesses",
  skills: "skills",
  customProviders: "customProviders",
  providerDetection: "providerDetection",
  customAgents: "customAgents",
  acpRegistry: "acpRegistry",
  providerAdmin: "providerAdmin",
  messaging: "messaging",
  hostAdmin: "hostAdmin",
  githubConnector: "githubConnector",
  onePasswordConnector: "onePasswordConnector",
  bitwardenConnector: "bitwardenConnector",
  passwordManagers: "passwordManagers",
  linkAccount: "linkAccount",
  vault: "vault",
  hostedSites: "hostedSites",
  routineFeed: "routineFeed",
  workflows: "workflows",
  crm: "crm",
  routineResults: "routineResults",
  billing: "billing",
  referral: "referral",
  credits: "credits",
  license: "license",
  hostedServers: "hostedServers",
  localServers: "localServers",
  marketplaceAgents: "marketplaceAgents",
  agentTemplates: "agentTemplates",
  auth: "auth",
  update: "update",
  notifications: "notifications",
  agent: "agent",
  agentMemories: "agent",
  sharedTables: "agent",
  agentRoutines: "agent",
  channelMemories: "agent",
  channelRoutines: "agent",
  channelFolders: "agent",
  agentAttachments: "agent",
  agentFolders: "agent",
  agentInstructions: "agent",
  attachmentImports: null,
  browser: "browser",
  browserInput: "browser",
  servers: "servers",
  agentAdmin: "agent",
  mcpServers: "agent",
  storage: "storage",
  agentImport: "agentImport",
  instanceTransfer: "instanceTransfer",
  plugins: "plugins",
  marketplace: "marketplace",
  host: "host",
  events: "events",
  remoteDesktop: "remoteDesktop",
} as const satisfies { readonly [Group in keyof IpcEndpoints]: string | null };

export type IpcGroupName = keyof IpcEndpoints;
type IpcGroupPaths = typeof IPC_GROUP_PATHS;

type OptionalArgs<Payload> = [Payload] extends [undefined]
  ? []
  : undefined extends Payload
    ? [input?: Exclude<Payload, undefined>]
    : [input: Payload];

type ServerArgs<Server> = [Server] extends ["required"] ? [serverId: string] : [serverId?: string];

type ScopedArgs<Inner, Server> = [Inner] extends [null]
  ? ServerArgs<Server>
  : [...OptionalArgs<Inner>, ...ServerArgs<Server>];

export type Invoke<Endpoint> =
  Endpoint extends ScopedRequestEndpoint<string, infer Inner, infer Result, infer Server>
    ? (...args: ScopedArgs<Inner, Server>) => Promise<Result>
    : Endpoint extends RequestEndpoint<string, infer Payload, infer Result>
      ? [Payload] extends [Untyped]
        ? never
        : (...args: OptionalArgs<Payload>) => Promise<Result>
      : never;

export type Subscribe<Endpoint> =
  Endpoint extends EventEndpoint<string, infer Payload>
    ? (listener: [Payload] extends [undefined] ? () => void : (payload: Payload) => void) => () => void
    : never;

type MethodName<Key extends string, Endpoint> = Endpoint extends EventEndpoint ? `on${Capitalize<Key>}` : Key;

export type GroupApi<Group extends IpcEndpointGroup> = {
  -readonly [Key in keyof Group & string as MethodName<Key, Group[Key]>]: Group[Key] extends EventEndpoint
    ? Subscribe<Group[Key]>
    : Invoke<Group[Key]>;
};

type GroupsAt<Path extends string> = {
  [Group in IpcGroupName]: IpcGroupPaths[Group] extends Path ? Group : never;
}[IpcGroupName];

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;

type GroupApis<Group extends IpcGroupName> = Group extends IpcGroupName ? GroupApi<IpcEndpoints[Group]> : never;

export type PathApi<Path extends string> = UnionToIntersection<GroupApis<GroupsAt<Path>>>;

type NestedPath = Exclude<IpcGroupPaths[IpcGroupName], "" | null>;

export type BridgedDesktopApi = PathApi<""> & { [Path in NestedPath]: PathApi<Path> };

export function groupApiMethodName(key: string, endpoint: IpcEndpoint): string {
  return endpoint.kind === "event" ? `on${key.charAt(0).toUpperCase()}${key.slice(1)}` : key;
}
