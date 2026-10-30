import type {
  AcpRegistryEntry,
  AcpRegistryInstallation,
  AcpRegistryInstallInput,
  AcpRegistryOperation,
} from "./ipc-acp-registry";
import type { AgentAccessChange, AgentAccessSnapshot } from "./ipc-agent-access";
import type {
  AgentSessionSettings,
  ResetAgentSessionSettingInput,
  SetAgentSessionSettingInput,
} from "./ipc-agent-session-settings";
// The one channel list. Each endpoint holds its wire value, the group it belongs to, and whether it
// is a request the renderer invokes or an event the main process sends. That is what lets a
// registrar bind its handlers as an object keyed by endpoint, so a channel with no handler, and a
// handler for a channel that was never declared, are both compile errors instead of a runtime
// rejection nobody sees until a user hits the feature.
//
// A group is the unit one registrar implements in full. Where a wire prefix spans several registrars
// - `agent:` has four - it is split into one group per registrar, because the exhaustiveness a group
// buys is only worth having when a single object literal can satisfy it.

//
// An endpoint also names what crosses the wire: the payload the renderer sends and the result main
// answers, or the payload of an event. The main binder and the preload read both from here, so a
// change on one side is a type error on the other. The types are phantom members: they exist only
// for the checker, and the runtime value is still `{ kind, channel }`.

import type { ManagedProviderId } from "./agent-providers";
import type { AppAppearancePreference, SetAppAppearancePreferenceInput } from "./app-appearance";
import type { AppInterfaceSizePreference, SetAppInterfaceSizePreferenceInput } from "./app-interface-size";
import type { AppLanguagePreference, SetAppLanguagePreferenceInput } from "./app-language";
import type { AppLogoColorPreference, SetAppLogoColorPreferenceInput } from "./app-logo-color";
import type { BillingPortalRequest, BillingState } from "./billing";
import type {
  CreateHostedServerInput,
  DeleteHostedServerInput,
  HostedServerCatalog,
  HostedServerLifecycleInput,
  HostedServerList,
  HostedServerSummary,
} from "./hosted-servers";
import type {
  AddedAgent,
  AgentAdminSettings,
  AgentBackupModelSettings,
  AgentHostSettings,
  AgentTaskLimitSettings,
  UpdateAgentAdminSettingsInput,
  UpdateAgentBackupModelsInput,
  UpdateAgentHostSettingsInput,
  UpdateAgentTaskLimitInput,
} from "./ipc-agent-admin";
import type { AgentAnalytics, AgentAnalyticsInput } from "./ipc-agent-analytics";
import type { AgentIpcRequest, ScopedAgentEvent } from "./ipc-agent-events";
import type {
  AgentExclusionChange,
  AgentFolderChange,
  AgentFolderInput,
  AgentFolderList,
  ChooseAgentFolderInput,
} from "./ipc-agent-folders";
import type { ClientAgentModelOption } from "./ipc-agent-identity";
import type {
  AgentImportPreview,
  AgentImportResult,
  AgentImportSkillSource,
  ApplyAgentImportInput,
} from "./ipc-agent-import";
import type {
  AgentMemory,
  AgentMemoryLimitPreference,
  AgentMemorySelectionState,
  CreateAgentMemoryInput,
  DeleteAgentMemoryInput,
  HostAgentMemoryLimit,
  HostMemoryReview,
  SetAgentMemoryInclusionInput,
  UpdateAgentMemoryInput,
} from "./ipc-agent-memories";
import type {
  AgentProfileDraft,
  GenerateAgentProfileInput,
  SaveAgentProfileInput,
  SaveAgentProfileResult,
} from "./ipc-agent-profile";
import type { AgentRuntimeSnapshot } from "./ipc-agent-runtime";
import type { AskSideQuestionInput } from "./ipc-agent-side-question";
import type {
  AccountUsage,
  AgentProviderId,
  AgentStatus,
  ConnectProviderAccountInput,
  HostProviderAccounts,
  PasteProviderRelaySignInInput,
  ProviderApiKeyState,
  ProviderCodeLoginStart,
  ProviderHostSignInStatus,
  ProviderRelaySignInStatus,
  ProviderUsageResetOutcome,
  ProviderUsageResets,
  RemoveProviderAccountInput,
  RenameProviderAccountInput,
  ResetProviderUsageInput,
  SetProviderApiKeyInput,
  SubmitProviderCodeLoginInput,
} from "./ipc-agent-status";
import type {
  AgentTask,
  AgentTaskInput,
  AgentTaskReadState,
  AgentTasksSnapshot,
  MarkAgentTaskReadInput,
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
  CentralAuthState,
  ChatWindowTarget,
  ComputerUseHighlightPlacement,
  ComputerUsePermissionApp,
  ComputerUseState,
  ExportResult,
  ExternalDestination,
  HostUpdateSettingsChange,
  HostUpdateStatus,
  IdleRestartTarget,
  MacAutomationResult,
  MacAutomationTarget,
  MacPermissionId,
  ProviderRuntimeSnapshot,
  SaveSetupInput,
  SetAnalyticsPreferenceInput,
  UpdatePreference,
  UpdatePreferenceChange,
  UpdateRestartMode,
  UpdateStatus,
  VerifyEmailCodeInput,
} from "./ipc-app-auth";
import type { AppBehaviorPreference, AppBehaviorPreferenceChange } from "./ipc-app-behavior";
import type {
  ApprovalAutomationPreference,
  RespondToApprovalInput,
  RespondToBrowserTakeoverInput,
} from "./ipc-approvals";
import type {
  AttachmentDataInput,
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
  BrowserVisibilityInput,
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
import type { LocalBrowserSecretResponse } from "./ipc-browser-secret";
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
import type { Channel, ChannelCommand, ChannelPage, ChannelReadInput, ChannelSummary } from "./ipc-chat-channels";
import type {
  CancelMessageLinkInput,
  ConversationFileSearchPage,
  ConversationPage,
  ConversationReadState,
  ConversationSearchPage,
  ConversationSnapshot,
  ConversationWithReadState,
  MarkConversationReadInput,
  OpenMessageLinkInput,
  PasteMessageLinkInput,
  ReadConversationPageInput,
  RespondToPromptInput,
  SearchConversationFilesInput,
  SearchConversationMessagesInput,
  SendMessageInput,
  SetMessageReactionInput,
} from "./ipc-conversations";
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
  DynamicIslandAction,
  DynamicIslandGeometry,
  DynamicIslandPreference,
  DynamicIslandPresentation,
  SetDynamicIslandInteractiveInput,
  SetDynamicIslandPreferenceInput,
} from "./ipc-dynamic-island";
import type {
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
import type { ApplyHermesImportInput, HermesImportPreview } from "./ipc-hermes-import";
import type { HiddenAgentsSnapshot, SetAgentHiddenInput } from "./ipc-hidden-agents";
import type { HostAnalytics, HostAnalyticsInput } from "./ipc-host-analytics";
import type { HostReleaseStatus } from "./ipc-host-release";
import type { HostTimezoneSettings } from "./ipc-host-timezone";
import type {
  DeleteHostedSiteInput,
  HostedSiteList,
  HostedSiteSummary,
  PublishHostedSiteInput,
  ReplaceHostedSiteInput,
} from "./ipc-hosted-sites";
import type {
  ApplyInstanceTransferInput,
  ExportInstanceInput,
  InstanceExportResult,
  InstanceTransferPreview,
  InstanceTransferResult,
  InstanceTransferSummary,
} from "./ipc-instance-transfer";
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
  AddMessagingOrchestratorInput,
  AddMessagingOrchestratorResult,
  AddSlackOrchestratorInput,
  AddSlackOrchestratorResult,
  AddTelegramOrchestratorInput,
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
  SetDiscordAccessInput,
  SetMessagingEnabledInput,
  SetSlackEnabledInput,
  SetTelegramEnabledInput,
  SlackOverview,
  SlackWorkspaceInput,
  TelegramChatInput,
  TelegramOverview,
} from "./ipc-messaging";
import type { NotificationOpenedEvent, NotificationPreference } from "./ipc-notifications";
import type {
  OnePasswordConnectInput,
  OnePasswordConnectorStatus,
  OnePasswordHostConnectInput,
} from "./ipc-onepassword-connector";
import type { PromptCacheTtl, PromptCacheTtlSetting } from "./ipc-prompt-cache";
import type {
  DetectedModelServer,
  DiscoverModelsInput,
  DiscoverModelsResult,
  ProviderDetectionSettings,
} from "./ipc-provider-detection";
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
  ConnectRoutineFlowInput,
  DisconnectRoutineFlowInput,
  RemoveRoutineFlowPositionInput,
  RoutineFlowCanvas,
  RoutineFlowLink,
  SaveRoutineFlowPositionInput,
  UpdateRoutineFlowLinkInput,
} from "./ipc-routine-flows";
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
import type { DeleteSharedTableInput, SharedTable } from "./ipc-shared-tables";
import type { SidebarLayoutAction, SidebarLayoutSnapshot } from "./ipc-sidebar-layout";
import type {
  CreateLocalSkillInput,
  InstalledSkill,
  InstallLocalSkillInput,
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
  OldRuntimeVersions,
  OpenStorageLocationInput,
  OpenStoredFileInput,
  ProviderRuntimeDownload,
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
import type { VaultImportResult, VaultSaveInput, VaultSecretRequest, VaultState } from "./ipc-vault";
import type {
  SpeechAudio,
  SpeechInput,
  SpeechModelStatus,
  SpeechSettings,
  VoiceApiKeyInput,
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
import type {
  CreateWorkflowInput,
  DecideWorkflowStepInput,
  RenameWorkflowInput,
  RetryWorkflowStepInput,
  RunWorkflowStepInput,
  SaveWorkflowGraphInput,
  StartWorkflowRunInput,
  WorkflowDetail,
  WorkflowGraph,
  WorkflowRunDetail,
  WorkflowRunPage,
  WorkflowRunsInput,
  WorkflowSaveResult,
  WorkflowStep,
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
import type { AccountSession, MobileConnectedDevice, MobileConnectLink, MobileConnectTicket } from "./mobile-connect";

declare const payloadType: unique symbol;
declare const resultType: unique symbol;
declare const untypedBrand: unique symbol;
declare const serverArgument: unique symbol;

/**
 * The payload and result of an endpoint that has no types. The main binder and the preload accept
 * anything for it. Only `browserInput.sendLiveViewInput` uses it: see the comment at that endpoint.
 */
export interface Untyped {
  readonly [untypedBrand]: true;
}

/**
 * How the preload scopes a request to a server. `payload` wraps the first argument as
 * `AgentIpcRequest.payload`; `empty` sends a `null` payload. The server is the trailing argument, or
 * the selected server when the caller leaves it out. An unscoped request has no `scope`.
 */
export type ServerScope = "payload" | "empty";

/** Whether the renderer must name the server of a scoped request. It is a type only. */
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

// Curried, because explicit type arguments turn off inference for the rest: `request<P, R>(channel)`
// would widen the channel to `string`, and the literal is what shows the wire value in the type.
// A request with no payload takes `undefined`: main receives that when the preload sends nothing.
// A server-scoped payload does not compile here: without `scope`, the preload would not wrap it.
function request<Payload, Result>(): <Channel extends string>(
  channel: Channel & ([Payload] extends [AgentIpcRequest<unknown>] ? never : unknown),
) => RequestEndpoint<Channel, Payload, Result> {
  return (channel) => ({ kind: "request", channel });
}

// Main receives `AgentIpcRequest<Inner>`; the renderer passes `Inner` and, last, a server.
function scopedRequest<Inner, Result, Server extends ServerArgument = "optional">(): <Channel extends string>(
  channel: Channel,
) => ScopedRequestEndpoint<Channel, Inner, Result, Server> {
  return (channel) => ({ kind: "request", channel, scope: "payload" });
}

// A scoped request that carries nothing but the server: main receives `AgentIpcRequest<null>`.
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
    // A joined owner or admin can set the default provider of this computer (`provider-default-v1`),
    // so main tells the window.
    setupState: event<AppSetupState>()("app:setup-state"),
    getAnalyticsPreference: request<undefined, AnalyticsPreference>()("app:get-analytics-preference"),
    setAnalyticsPreference: request<SetAnalyticsPreferenceInput, AnalyticsPreference>()("app:set-analytics-preference"),
    getApprovalAutomation: request<undefined, ApprovalAutomationPreference>()("app:get-approval-automation"),
    // A remote owner or admin can change a grant from a phone or the web client, so main tells the
    // window instead of the window only reading the value at start.
    approvalAutomation: event<ApprovalAutomationPreference>()("app:approval-automation"),
    getBusyMessageModePreference: request<undefined, BusyMessageModePreference>()("app:get-busy-message-mode"),
    setBusyMessageModePreference: request<BusyMessageModePreference, BusyMessageModePreference>()(
      "app:set-busy-message-mode",
    ),
    getAgentDefaults: request<undefined, AgentDefaults>()("app:get-agent-defaults"),
    setAgentDefaults: request<AgentDefaults, AgentDefaults>()("app:set-agent-defaults"),
    getAgentMemoryLimitPreference: request<undefined, AgentMemoryLimitPreference>()("app:get-agent-memory-limit"),
    // Server settings set the limit of this computer (`hostAdmin.setAgentMemoryLimit`), here or from a
    // joined admin, so main tells the window.
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
    // Every window draws its own text, so the choice is broadcast rather than returned: the
    // Dynamic Island overlay has no Settings of its own and would otherwise stay in the old
    // language until it was next recreated.
    appLanguagePreference: event<AppLanguagePreference>()("app:language-preference"),
    getAppLogoColorPreference: request<undefined, AppLogoColorPreference>()("app:get-logo-color-preference"),
    setAppLogoColorPreference: request<SetAppLogoColorPreferenceInput, AppLogoColorPreference>()(
      "app:set-logo-color-preference",
    ),
    // Every window draws the logo, and the Dynamic Island has no Settings of its own, so the choice
    // is broadcast in the same way as the language.
    appLogoColorPreference: event<AppLogoColorPreference>()("app:logo-color-preference"),
    getAppAppearancePreference: request<undefined, AppAppearancePreference>()("app:get-appearance-preference"),
    setAppAppearancePreference: request<SetAppAppearancePreferenceInput, AppAppearancePreference>()(
      "app:set-appearance-preference",
    ),
    // Sent to every window, because each window applies the choice to its own page.
    appAppearancePreference: event<AppAppearancePreference>()("app:appearance-preference"),
    getAppInterfaceSizePreference: request<undefined, AppInterfaceSizePreference>()(
      "app:get-interface-size-preference",
    ),
    setAppInterfaceSizePreference: request<SetAppInterfaceSizePreferenceInput, AppInterfaceSizePreference>()(
      "app:set-interface-size-preference",
    ),
    // The zoom shortcuts and the View menu change the size in main, so main tells the window, and
    // Settings shows the new size.
    appInterfaceSizePreference: event<AppInterfaceSizePreference>()("app:interface-size-preference"),
    // The native Preferences menu item and its shortcut live in main, while the dialog lives in
    // the renderer, so the menu click is broadcast rather than handled: every window opens its
    // own Settings.
    openSettings: event<undefined>()("app:open-settings"),
    // The native Check for Updates menu item opens the Updates tab, because only that tab shows
    // the check and its result.
    openUpdateSettings: event<undefined>()("app:open-update-settings"),
    openExternal: request<ExternalDestination, void>()("app:open-external"),
    openUrl: request<string, void>()("app:open-url"),
    getExternalLinkPreference: request<undefined, ExternalLinkPreference>()("app:get-external-link-preference"),
    setExternalLinkPreference: request<ExternalLinkPreference, ExternalLinkPreference>()(
      "app:set-external-link-preference",
    ),
    // The browsers that the setting lists. Only macOS tells which applications open web pages.
    listExternalLinkBrowsers: request<undefined, ExternalLinkBrowsers>()("app:list-external-link-browsers"),
    // The file dialog of "Other app…". Null when the user closed the dialog.
    chooseExternalLinkApp: request<undefined, ExternalLinkBrowser | null>()("app:choose-external-link-app"),
    // A page can open from main with no window action, such as a sign-in page, so main tells the
    // window when the chosen browser did not start.
    externalLinkFallback: event<ExternalLinkFallback>()("app:external-link-fallback"),
    // A chat in a window of its own, for a second display. A chat that has a window already brings
    // that window to the front.
    openChatWindow: request<ChatWindowTarget, void>()("app:open-chat-window"),
    getChatWindows: request<undefined, ChatWindowTarget[]>()("app:get-chat-windows"),
    // The main window marks each chat that has a window, so main tells it when one opens or closes.
    chatWindows: event<ChatWindowTarget[]>()("app:chat-windows"),
  },
  maintenance: {
    exportData: request<undefined, ExportResult>()("maintenance:export-data"),
    exportDiagnostics: request<undefined, ExportResult>()("maintenance:export-diagnostics"),
  },
  providers: {
    setProviderOn: request<{ provider: AgentProviderId; on: boolean }, AgentStatus>()("app:set-provider-on"),
    connectProvider: request<AgentProviderId, AgentStatus>()("app:connect-provider"),
    /** Ends the sign-in that `connectProvider` started and that still waits for the browser. */
    cancelProviderSignIn: request<AgentProviderId, AgentStatus>()("app:cancel-provider-sign-in"),
    /**
     * `automatic`: the app asks, not the user. A provider that OpenBot stopped starting after failed
     * starts in a row then stays stopped; only a refresh the user asks for starts it again.
     */
    refreshAgentProviders: request<{ automatic: boolean } | undefined, AgentStatus>()("app:refresh-agent-providers"),
    /**
     * Restarts one provider's process after the turns that run on it end, and reads its version,
     * account and models again. It answers when the restart is scheduled; the provider's status has
     * `restartPending` until it is done. `cancelProviderRestart` removes one that still waits.
     */
    restartProvider: request<AgentProviderId, AgentStatus>()("app:restart-provider"),
    cancelProviderRestart: request<AgentProviderId, AgentStatus>()("app:cancel-provider-restart"),
    /**
     * Runs the provider CLI's own updater, for a CLI the user installed themselves. It is their copy,
     * so the version they end on is whatever that updater fetches, which owes nothing to the version
     * OpenBot pins for the runtime it manages.
     */
    updateProviderCli: request<ManagedProviderId, AgentStatus>()("app:update-provider-cli"),
    /**
     * Stores the optional API key a provider's paid catalog needs, and reconnects the provider.
     *
     * The key only ever travels towards main. There is no getter for it, and
     * `getProviderApiKeyState` answers with a status, because a renderer that can read a key back
     * puts it in every crash report, export and screenshot that follows.
     */
    setProviderApiKey: request<SetProviderApiKeyInput, AgentStatus>()("app:set-provider-api-key"),
    clearProviderApiKey: request<AgentProviderId, AgentStatus>()("app:clear-provider-api-key"),
    getProviderApiKeyState: request<AgentProviderId, ProviderApiKeyState>()("app:get-provider-api-key-state"),
    /**
     * Starts a sign-in the user finishes on another device, for a provider whose backend driver has
     * one: Codex, Grok, Cursor, Cline and Muse, and Claude on Linux. A pasted code goes to
     * `providerAdmin.submitCodeLogin` with `LOCAL_SERVER_ID`. Cancel it with
     * `cancelProviderCodeLogin`; leaving it running holds one provider process open until the code
     * expires.
     */
    startProviderCodeLogin: request<AgentProviderId, ProviderCodeLoginStart>()("app:start-provider-code-login"),
    /** Abandons a code sign-in: the provider is told, the code is dead, and the provider goes idle. */
    cancelProviderCodeLogin: request<AgentProviderId, AgentStatus>()("app:cancel-provider-code-login"),
    /**
     * Signs one more account of a provider in through the browser, or signs a signed-out one in
     * again. It answers when the sign-in starts; the account's status tells how it ends. Removing a
     * `connecting` account cancels its sign-in.
     */
    connectProviderAccount: request<ConnectProviderAccountInput, AgentStatus>()("app:connect-provider-account"),
    /** Stops a `connecting` account's sign-in: a new account goes, another one shows as signed out. */
    cancelProviderAccountSignIn: request<RemoveProviderAccountInput, AgentStatus>()(
      "app:cancel-provider-account-sign-in",
    ),
    renameProviderAccount: request<RenameProviderAccountInput, AgentStatus>()("app:rename-provider-account"),
    removeProviderAccount: request<RemoveProviderAccountInput, AgentStatus>()("app:remove-provider-account"),
    /** The usage reset credits of each connected account of a provider. It reads the usage of each. */
    providerUsageResets: request<AgentProviderId, ProviderUsageResets[]>()("app:provider-usage-resets"),
    /** Spends one usage reset credit of an account. A reset ends the usage limit that holds its agents. */
    resetProviderUsage: request<ResetProviderUsageInput, ProviderUsageResetOutcome>()("app:reset-provider-usage"),
  },
  providerRuntimes: {
    getStatus: request<undefined, ProviderRuntimeSnapshot>()("provider-runtimes:get-status"),
    download: request<ManagedProviderId, ProviderRuntimeSnapshot>()("provider-runtimes:download"),
    cancel: request<ManagedProviderId, ProviderRuntimeSnapshot>()("provider-runtimes:cancel"),
    /** What `removeDownload` frees now: nothing while the provider is on. */
    measureDownload: request<ManagedProviderId, ProviderRuntimeDownload>()("provider-runtimes:measure-download"),
    /** Removes the downloaded CLI of a provider that is off. Rejects while it is on or downloading. */
    removeDownload: request<ManagedProviderId, ProviderRuntimeSnapshot>()("provider-runtimes:remove-download"),
    /** Asks each provider's upstream for its latest release. Rejects when no source answered. */
    checkForUpdates: request<undefined, ProviderRuntimeSnapshot>()("provider-runtimes:check-for-updates"),
    event: event<ProviderRuntimeSnapshot>()("provider-runtimes:event"),
  },
  voice: {
    /** The status of the model in use. */
    getModelStatus: request<undefined, VoiceModelStatus>()("voice:get-model-status"),
    /** One status for each model in `VOICE_MODELS`, in the same order. */
    getModelStatuses: request<undefined, VoiceModelStatus[]>()("voice:get-model-statuses"),
    /** Downloads the model in use when it is missing. Answers when it is ready or failed. */
    prepareModel: request<undefined, VoiceModelStatus>()("voice:prepare-model"),
    /** Downloads one model. Answers when it is ready, failed, or cancelled. */
    downloadModel: request<VoiceModelRequest, VoiceModelStatus>()("voice:download-model"),
    /** Stops a download. The model is missing again; a later download starts from the first file not complete. */
    cancelModelDownload: request<VoiceModelRequest, VoiceModelStatus>()("voice:cancel-model-download"),
    /**
     * Deletes a downloaded model from this computer and stops its download first. Answers its status,
     * which is missing. Rejects a cloud model, and rejects while a transcription runs.
     */
    removeModel: request<VoiceModelRequest, VoiceModelStatus>()("voice:remove-model"),
    getSettings: request<undefined, VoiceSettings>()("voice:get-settings"),
    setSettings: request<VoiceSettings, VoiceSettings>()("voice:set-settings"),
    transcribe: request<VoiceTranscriptionInput, VoiceTranscriptionResult>()("voice:transcribe"),
    /** Saves or removes the ElevenLabs API key. Answers the status of the ElevenLabs model. */
    setApiKey: request<VoiceApiKeyInput, VoiceModelStatus>()("voice:set-api-key"),
    /**
     * Opens a streamed dictation with the cloud model in use. Answers when the provider accepted it.
     * A new stream ends the one before it.
     */
    startStream: request<undefined, VoiceStream>()("voice:start-stream"),
    appendStream: request<VoiceStreamAudio, void>()("voice:append-stream"),
    /** Ends the audio and answers the whole text. */
    finishStream: request<VoiceStream, VoiceTranscriptionResult>()("voice:finish-stream"),
    /** Ends a stream and drops its text. */
    cancelStream: request<VoiceStream, void>()("voice:cancel-stream"),
    modelStatus: event<VoiceModelStatus>()("voice:model-status"),
    /** The text of a stream so far. It can change until `finishStream` answers. */
    streamTranscript: event<VoiceStreamTranscript>()("voice:stream-transcript"),
    getSpeechSettings: request<undefined, SpeechSettings>()("voice:get-speech-settings"),
    setSpeechSettings: request<SpeechSettings, SpeechSettings>()("voice:set-speech-settings"),
    getSpeechModelStatus: request<undefined, SpeechModelStatus>()("voice:get-speech-model-status"),
    /** Downloads the speech model. Answers when it is ready, failed, or cancelled. */
    downloadSpeechModel: request<undefined, SpeechModelStatus>()("voice:download-speech-model"),
    cancelSpeechModelDownload: request<undefined, SpeechModelStatus>()("voice:cancel-speech-model-download"),
    /** Deletes the speech model from this computer. Answers its status, which is missing. */
    removeSpeechModel: request<undefined, SpeechModelStatus>()("voice:remove-speech-model"),
    /** Reads one part of a reply aloud with the voice in the settings. The model must be ready. */
    speak: request<SpeechInput, SpeechAudio>()("voice:speak"),
    /**
     * Loads the speech model before a reply needs it, so its first part starts sooner. Answers when
     * the model is loaded. It does nothing when the model is not downloaded.
     */
    warmSpeech: request<undefined, void>()("voice:warm-speech"),
    /**
     * Keeps a voice turn's recording as an attachment draft of this computer's host. A message names it
     * in `voiceRecordingDraftId`, so the chat can play it again; the agent gets only the text.
     */
    keepRecording: request<VoiceTranscriptionInput, DraftAttachment>()("voice:keep-recording"),
    speechModelStatus: event<SpeechModelStatus>()("voice:speech-model-status"),
    /** The user's own voice server, or null. While a route is on, `transcribe` or `speak` uses it. */
    getServer: request<undefined, VoiceServerSettings | null>()("voice:get-server"),
    /** Lists the models and voices of a server, before the user saves it. */
    probeServer: request<VoiceServerConnection, VoiceServerProbe>()("voice:probe-server"),
    setServer: request<VoiceServerSave, VoiceServerSettings | null>()("voice:set-server"),
    serverSettings: event<VoiceServerSettings | null>()("voice:server-settings"),
  },
  dynamicIsland: {
    getPreference: request<undefined, DynamicIslandPreference>()("dynamic-island:get-preference"),
    setPreference: request<SetDynamicIslandPreferenceInput, DynamicIslandPreference>()("dynamic-island:set-preference"),
    publishPresentation: request<DynamicIslandPresentation, void>()("dynamic-island:publish-presentation"),
    getPresentation: request<undefined, DynamicIslandPresentation>()("dynamic-island:get-presentation"),
    presentation: event<DynamicIslandPresentation>()("dynamic-island:presentation"),
    preference: event<DynamicIslandPreference>()("dynamic-island:preference"),
    geometry: event<DynamicIslandGeometry>()("dynamic-island:geometry"),
    /** The notch of the built-in display, or null when it has none. The Settings preview draws it. */
    getBuiltInDisplayGeometry: request<undefined, DynamicIslandGeometry>()(
      "dynamic-island:get-built-in-display-geometry",
    ),
    performAction: request<DynamicIslandAction, void>()("dynamic-island:perform-action"),
    performHaptic: request<undefined, void>()("dynamic-island:perform-haptic"),
    action: event<DynamicIslandAction>()("dynamic-island:action"),
    setInteractive: request<SetDynamicIslandInteractiveInput, void>()("dynamic-island:set-interactive"),
  },
  /**
   * The dock over a local page. The main renderer publishes it and does its actions; the overlay view
   * above the page shows it and reports the space and the glass it needs.
   */
  browserDock: {
    /** Null hides the overlay. */
    publishPresentation: request<BrowserDockPresentation | null, void>()("browser-dock:publish-presentation"),
    getPresentation: request<undefined, BrowserDockPresentation | null>()("browser-dock:get-presentation"),
    presentation: event<BrowserDockPresentation | null>()("browser-dock:presentation"),
    performAction: request<BrowserDockAction, void>()("browser-dock:perform-action"),
    action: event<BrowserDockAction>()("browser-dock:action"),
    setFrame: request<BrowserDockFrame, void>()("browser-dock:set-frame"),
    /** Whether the overlay shows the dock over the page. While it does, the dock in the renderer is inert. */
    shown: event<boolean>()("browser-dock:shown"),
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
    /** Sends one harmless Apple Event to each app, so macOS shows its Automation prompts now. */
    request: request<readonly MacAutomationTarget[], MacAutomationResult[]>()("mac-automation:request"),
  },
  skills: {
    localList: request<undefined, MarketplaceSkillDetail[]>()("skills:local-list"),
    localGet: request<LocalSkillRevisionInput, MarketplaceSkillDetail>()("skills:local-get"),
    localCreate: request<CreateLocalSkillInput, MarketplaceSkillDetail>()("skills:local-create"),
    localRevise: request<ReviseLocalSkillInput, MarketplaceSkillDetail>()("skills:local-revise"),
    localInstall: request<InstallLocalSkillInput, InstalledSkill>()("skills:local-install"),

    list: request<MarketplaceSkillQuery | undefined, MarketplaceSkillPage>()("skills:list"),
    get: request<string, MarketplaceSkillDetail>()("skills:get"),
    listMine: request<undefined, SkillSubmission[]>()("skills:list-mine"),
    choosePackage: request<undefined, SkillPackagePreview | null>()("skills:choose-package"),
    submit: request<SubmitSkillInput, SkillSubmission>()("skills:submit"),
    listInstalled: request<string, InstalledSkill[]>()("skills:list-installed"),
    install: request<InstallSkillInput, InstalledSkill>()("skills:install"),
    uninstall: request<UninstallSkillInput, void>()("skills:uninstall"),
    setEnabled: request<SetEnabledSkillInput, InstalledSkill>()("skills:set-enabled"),
  },
  // No event channel: the renderer is the only writer, and the models a saved endpoint adds arrive
  // through the ready `status` event the provider restart already emits.
  customProviders: {
    list: request<undefined, CustomProviderSummary[]>()("custom-providers:list"),
    save: request<SaveCustomProviderInput, CustomProviderResult>()("custom-providers:save"),
    delete: request<DeleteCustomProviderInput, CustomProviderResult>()("custom-providers:delete"),
    // This computer only. `providerAdmin` has no edit, so a joined admin cannot reach a stored key
    // through a changed address.
    update: request<UpdateCustomProviderInput, CustomProviderResult>()("custom-providers:update"),
  },
  // Local model servers and ACP agents on this computer. Main makes every request, and a scan sends
  // no key. A joined host is never scanned.
  providerDetection: {
    scanModelServers: request<undefined, DetectedModelServer[]>()("provider-detection:scan-model-servers"),
    discoverModels: request<DiscoverModelsInput, DiscoverModelsResult>()("provider-detection:discover-models"),
    getSettings: request<undefined, ProviderDetectionSettings>()("provider-detection:get-settings"),
    setSettings: request<ProviderDetectionSettings, ProviderDetectionSettings>()("provider-detection:set-settings"),
    // Looks for known agent command names only. It starts no file.
    scanAgents: request<undefined, DetectedAcpAgent[]>()("provider-detection:scan-agents"),
  },
  // The user's own ACP agents, on this computer only: no Team API route and no `providerAdmin` entry.
  // Environment values travel only towards main.
  acpRegistry: {
    search: scopedRequest<string, AcpRegistryEntry[]>()("acp-registry:search"),
    installed: scopedQuery<AcpRegistryInstallation[]>()("acp-registry:installed"),
    status: scopedQuery<AcpRegistryOperation[]>()("acp-registry:status"),
    install: scopedRequest<AcpRegistryInstallInput, CustomAgentResult>()("acp-registry:install"),
    cancel: scopedRequest<string, void>()("acp-registry:cancel"),
    remove: scopedRequest<string, void>()("acp-registry:remove"),
  },
  customAgents: {
    list: request<undefined, CustomAgentSummary[]>()("custom-agents:list"),
    save: request<SaveCustomAgentInput, CustomAgentResult>()("custom-agents:save"),
    delete: request<DeleteCustomAgentInput, CustomAgentResult>()("custom-agents:delete"),
    check: request<CheckCustomAgentInput, CustomAgentCheckResult>()("custom-agents:check"),
    // The answers of the agents that have a usage prompt. An agent with no answer is not listed.
    usage: request<undefined, CustomAgentUsage[]>()("custom-agents:usage"),
  },
  // The providers of the computer that runs the agents. `providers`, `providerRuntimes` and
  // `customProviders` reach this computer only; these take the server, so a remote admin reaches the
  // host. As there, a key only travels towards the host, and no result carries one.
  providerAdmin: {
    startCodeLogin: scopedRequest<AgentProviderId, ProviderCodeLoginStart, "required">()(
      "provider-admin:start-code-login",
    ),
    // The code of a `paste` sign-in. The result is the status; how the sign-in ends arrives as one.
    submitCodeLogin: scopedRequest<SubmitProviderCodeLoginInput, AgentStatus, "required">()(
      "provider-admin:submit-code-login",
    ),
    cancelCodeLogin: scopedRequest<AgentProviderId, AgentStatus, "required">()("provider-admin:cancel-code-login"),
    // A sign-in in the browser of a joined server's host, which the live view shows
    // (`provider-host-sign-in-v1`). How it ends also arrives as the host's status.
    startHostSignIn: scopedRequest<AgentProviderId, void, "required">()("provider-admin:start-host-sign-in"),
    hostSignInStatus: scopedRequest<AgentProviderId, ProviderHostSignInStatus, "required">()(
      "provider-admin:host-sign-in-status",
    ),
    cancelHostSignIn: scopedRequest<AgentProviderId, AgentStatus, "required">()("provider-admin:cancel-host-sign-in"),
    // The accounts of a joined server's host's providers (`provider-accounts-v1`). The host's status,
    // agent list and usage do not carry them, so the renderer adds them to its copy. An account signs
    // in on the host's page, as `startHostSignIn` does; the account's state tells how it ended.
    accounts: scopedQuery<HostProviderAccounts, "required">()("provider-admin:accounts"),
    accountUsage: scopedQuery<AccountUsage, "required">()("provider-admin:account-usage"),
    startAccountSignIn: scopedRequest<ConnectProviderAccountInput, void, "required">()(
      "provider-admin:start-account-sign-in",
    ),
    accountSignInStatus: scopedRequest<AgentProviderId, ProviderHostSignInStatus, "required">()(
      "provider-admin:account-sign-in-status",
    ),
    cancelAccountSignIn: scopedRequest<AgentProviderId, void, "required">()("provider-admin:cancel-account-sign-in"),
    renameAccount: scopedRequest<RenameProviderAccountInput, void, "required">()("provider-admin:rename-account"),
    removeAccount: scopedRequest<RemoveProviderAccountInput, void, "required">()("provider-admin:remove-account"),
    // The usage reset credits of a joined server's host's accounts, and the reset that spends one
    // (`provider-usage-reset-v1`).
    usageResets: scopedRequest<AgentProviderId, ProviderUsageResets[], "required">()("provider-admin:usage-resets"),
    resetUsage: scopedRequest<ResetProviderUsageInput, ProviderUsageResetOutcome, "required">()(
      "provider-admin:reset-usage",
    ),
    // A sign-in that a joined server's host starts and that opens in this computer's browser
    // (`sign-in-relay-v1`). This computer takes the callback and sends its query to the host.
    // `openRelaySignIn` opens the page when the user asks, and `pasteRelaySignIn` takes the address
    // the browser shows when the callback cannot reach this computer.
    startRelaySignIn: scopedRequest<AgentProviderId, void, "required">()("provider-admin:start-relay-sign-in"),
    // The relayed sign-in of an account after the first (`provider-account-relay-v1`). The other relay
    // requests run it, by its provider, as they run `startRelaySignIn`'s.
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
    downloadRuntime: scopedRequest<ManagedProviderId, ProviderRuntimeSnapshot, "required">()(
      "provider-admin:download-runtime",
    ),
    cancelRuntime: scopedRequest<ManagedProviderId, ProviderRuntimeSnapshot, "required">()(
      "provider-admin:cancel-runtime",
    ),
    checkRuntimeUpdates: scopedQuery<ProviderRuntimeSnapshot, "required">()("provider-admin:check-runtime-updates"),
    listCustomProviders: scopedQuery<CustomProviderSummary[], "required">()("provider-admin:list-custom-providers"),
    saveCustomProvider: scopedRequest<SaveCustomProviderInput, CustomProviderResult, "required">()(
      "provider-admin:save-custom-provider",
    ),
    deleteCustomProvider: scopedRequest<DeleteCustomProviderInput, CustomProviderResult, "required">()(
      "provider-admin:delete-custom-provider",
    ),
  },
  // The Slack workspaces, Discord guilds and Telegram chats where this computer's agents answer. Only
  // the host's own desktop can use these: a connect opens a Slack, Discord or Telegram page in this
  // computer's browser, and a Slack or Discord page returns to this computer's `openbot://` link. A
  // token only travels towards the host; no result carries one.
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
    // Who can use OpenBot in a Discord server: the members with one of the chosen roles. The roles to
    // choose from come from Discord through Signal.
    getDiscordAccess: request<MessagingWorkspaceInput, DiscordAccess>()("messaging:get-discord-access"),
    listDiscordRoles: request<MessagingWorkspaceInput, DiscordRoleList>()("messaging:list-discord-roles"),
    setDiscordAccess: request<SetDiscordAccessInput, DiscordAccess>()("messaging:set-discord-access"),
    // The Telegram chats that added the OpenBot bot. A connect opens a `t.me` link with a one-use code
    // in this computer's browser; the chat links itself when the bot is added.
    getTelegramOverview: request<undefined, TelegramOverview>()("messaging:get-telegram-overview"),
    connectTelegramChat: request<ConnectTelegramChatInput, void>()("messaging:connect-telegram-chat"),
    disconnectTelegramChat: request<TelegramChatInput, void>()("messaging:disconnect-telegram-chat"),
    reconnectTelegramChat: request<TelegramChatInput, void>()("messaging:reconnect-telegram-chat"),
    setTelegramEnabled: request<SetTelegramEnabledInput, void>()("messaging:set-telegram-enabled"),
    addTelegramOrchestrator: request<AddTelegramOrchestratorInput, AddMessagingOrchestratorResult>()(
      "messaging:add-telegram-orchestrator",
    ),
    // The same for a joined server with `connectors-v1`, which an owner or admin manages from here.
    // The host opens no page: main opens it in this computer's browser. A Slack or Discord install
    // returns to this computer's `openbot://` link, and main sends the sealed grant on to the host.
    hostOverview: scopedRequest<HostMessagingPlatformInput, MessagingOverview, "required">()("messaging:host-overview"),
    hostConnect: scopedRequest<HostMessagingConnectInput, void, "required">()("messaging:host-connect"),
    hostDisconnect: scopedRequest<HostMessagingWorkspaceInput, void, "required">()("messaging:host-disconnect"),
    hostReconnect: scopedRequest<HostMessagingWorkspaceInput, void, "required">()("messaging:host-reconnect"),
    hostSetEnabled: scopedRequest<HostSetMessagingEnabledInput, void, "required">()("messaging:host-set-enabled"),
    hostAddOrchestrator: scopedRequest<HostAddMessagingOrchestratorInput, AddMessagingOrchestratorResult, "required">()(
      "messaging:host-add-orchestrator",
    ),
    // The same for a joined server with `discord-access-v1`.
    hostGetDiscordAccess: scopedRequest<HostDiscordAccessInput, DiscordAccess, "required">()(
      "messaging:host-get-discord-access",
    ),
    hostListDiscordRoles: scopedRequest<HostDiscordAccessInput, DiscordRoleList, "required">()(
      "messaging:host-list-discord-roles",
    ),
    hostSetDiscordAccess: scopedRequest<HostSetDiscordAccessInput, DiscordAccess, "required">()(
      "messaging:host-set-discord-access",
    ),
  },
  // The server name, logo, timezone, agent memory limit and app update of one server's host. `host.updateIdentity` and `update`
  // reach this computer only; these take the server, so a remote admin reaches the host. The
  // identity result is the server as the list shows it after the change.
  hostAdmin: {
    updateIdentity: scopedRequest<UpdateHostIdentityInput, ServerSummary, "required">()("host-admin:update-identity"),
    getReleaseStatus: scopedQuery<HostReleaseStatus | null, "required">()("host-admin:get-release-status"),
    checkRelease: scopedQuery<HostReleaseStatus, "required">()("host-admin:check-release"),
    getUpdateStatus: scopedQuery<HostUpdateStatus, "required">()("host-admin:get-update-status"),
    checkForUpdate: scopedQuery<HostUpdateStatus, "required">()("host-admin:check-for-update"),
    startUpdate: scopedRequest<UpdateRestartMode, HostUpdateStatus, "required">()("host-admin:start-update"),
    cancelUpdate: scopedQuery<HostUpdateStatus, "required">()("host-admin:cancel-update"),
    setUpdateSettings: scopedRequest<HostUpdateSettingsChange, HostUpdateStatus, "required">()(
      "host-admin:set-update-settings",
    ),
    // The server timezone. `null` is automatic: the host system zone.
    getTimezone: scopedQuery<HostTimezoneSettings, "required">()("host-admin:get-timezone"),
    setTimezone: scopedRequest<string | null, HostTimezoneSettings, "required">()("host-admin:set-timezone"),
    // How many memories each agent of the server can keep, and the values its host permits.
    getAgentMemoryLimit: scopedQuery<HostAgentMemoryLimit, "required">()("host-admin:get-agent-memory-limit"),
    setAgentMemoryLimit: scopedRequest<number, HostAgentMemoryLimit, "required">()("host-admin:set-agent-memory-limit"),
    // How many completed turns of one conversation pass between two background memory reviews of the
    // server's agents (`0` is off), and the values its host permits.
    getMemoryReview: scopedQuery<HostMemoryReview, "required">()("host-admin:get-memory-review"),
    setMemoryReview: scopedRequest<number, HostMemoryReview, "required">()("host-admin:set-memory-review"),
    // The machine alert levels and the member who gets the alert (`machine-resources-v1`).
    getMachineAlerts: scopedQuery<MachineAlertSettings, "required">()("host-admin:get-machine-alerts"),
    setMachineAlerts: scopedRequest<MachineAlertSettings, MachineAlertSettings, "required">()(
      "host-admin:set-machine-alerts",
    ),
    getPromptCacheTtl: scopedQuery<PromptCacheTtlSetting, "required">()("host-admin:get-prompt-cache-ttl"),
    setPromptCacheTtl: scopedRequest<PromptCacheTtl, PromptCacheTtlSetting, "required">()(
      "host-admin:set-prompt-cache-ttl",
    ),
    // The roles of the server and the level each gives for each agent. A member reads only `mine`.
    getAgentAccess: scopedQuery<AgentAccessSnapshot, "required">()("host-admin:get-agent-access"),
    setAgentAccess: scopedRequest<AgentAccessChange, AgentAccessSnapshot, "required">()("host-admin:set-agent-access"),
  },
  // The built-in GitHub connection of this computer. The token stays in main; every answer is the
  // status only. The `host*` endpoints reach the connection of a joined server (`connectors-v1`): the
  // host runs the device flow, and main opens its GitHub pages in this computer's browser.
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
  // The Bitwarden connection of this computer. The session key goes from the renderer to main once,
  // in `connect`; every answer is the status only. The `host*` endpoints do the same for a joined
  // server (`bitwarden-connector-v1`), with an API key and the master password: a session key from
  // this computer cannot open the host's vault.
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
  // The Vault of this computer. Lists carry no password, card number or security code: `reveal`
  // returns one when the user asks, and `copy` writes one to the clipboard in main. The `host*`
  // endpoints do the same for one server: a joined server answers through `vault-v1`, to an owner
  // or admin. It has no CSV import, as the file is on this computer.
  vault: {
    list: request<undefined, VaultState>()("vault:list"),
    save: request<VaultSaveInput, VaultState>()("vault:save"),
    delete: request<string, VaultState>()("vault:delete"),
    reveal: request<VaultSecretRequest, string>()("vault:reveal"),
    copy: request<VaultSecretRequest, void>()("vault:copy"),
    importCsv: request<undefined, VaultImportResult>()("vault:import-csv"),
    reset: request<undefined, VaultState>()("vault:reset"),
    changed: event<VaultState>()("vault:changed"),
    hostList: scopedQuery<VaultState, "required">()("vault:host-list"),
    hostSave: scopedRequest<VaultSaveInput, VaultState, "required">()("vault:host-save"),
    hostDelete: scopedRequest<string, VaultState, "required">()("vault:host-delete"),
    hostReveal: scopedRequest<VaultSecretRequest, string, "required">()("vault:host-reveal"),
    hostCopy: scopedRequest<VaultSecretRequest, void, "required">()("vault:host-copy"),
    hostReset: scopedQuery<VaultState, "required">()("vault:host-reset"),
  },
  // The 1Password connection of this computer. The token goes from the renderer to main once, in
  // `connectWithToken`; every answer is the status only. The `host*` endpoints do the same for a
  // joined server (`onepassword-connector-v1`), with a token only: the host has no 1Password app.
  onePasswordConnector: {
    status: request<undefined, OnePasswordConnectorStatus>()("onepassword-connector:status"),
    // Looks again for the CLI and the 1Password app's CLI integration, for a page that opens or regains focus.
    checkSetup: request<undefined, OnePasswordConnectorStatus>()("onepassword-connector:check-setup"),
    // Downloads the CLI release that main pins, into a folder that OpenBot owns.
    installCli: request<undefined, OnePasswordConnectorStatus>()("onepassword-connector:install-cli"),
    // Opens the 1Password app, or its download page when it is not installed.
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
    // The sites of one server. A joined server answers through `hosted-sites-v1`.
    list: scopedQuery<HostedSiteList, "required">()("hosted-sites:list"),
    chooseDirectory: request<undefined, string | null>()("hosted-sites:choose-directory"),
    publish: request<PublishHostedSiteInput, HostedSiteSummary>()("hosted-sites:publish"),
    replace: request<ReplaceHostedSiteInput, HostedSiteSummary>()("hosted-sites:replace"),
    delete: scopedRequest<DeleteHostedSiteInput, void, "required">()("hosted-sites:delete"),
  },
  // The account's Stripe subscription. The main process gets the Checkout or Portal URL from the
  // account server and opens it in the browser, so the renderer never sends a URL.
  // The iCalendar feed of this computer's routines. `create` also replaces the URL of a feed that is on.
  routineFeed: {
    get: request<undefined, RoutineFeed>()("routine-feed:get"),
    create: request<undefined, RoutineFeed>()("routine-feed:create"),
    remove: request<undefined, RoutineFeed>()("routine-feed:remove"),
  },
  billing: {
    getState: request<undefined, BillingState>()("billing:get-state"),
    openPortal: request<BillingPortalRequest, void>()("billing:open-portal"),
  },
  // The commercial license of the account. Main opens the Checkout page; the renderer never sends a URL.
  license: {
    getState: request<undefined, LicenseState>()("license:get-state"),
    openCheckout: request<LicenseCheckoutRequest, void>()("license:open-checkout"),
    setUsers: request<LicenseUsersRequest, LicenseState>()("license:set-users"),
    changePlan: request<LicensePlanRequest, LicenseState>()("license:change-plan"),
    setRenewal: request<LicenseRenewalRequest, LicenseState>()("license:set-renewal"),
  },
  // OpenBot servers that the account server runs for this account. `wake` also works for a server
  // that the account is a member of; it answers 404 for a host that is not a hosted server.
  hostedServers: {
    list: request<undefined, HostedServerList>()("hosted-servers:list"),
    plans: request<undefined, HostedServerCatalog>()("hosted-servers:plans"),
    // Main opens the Stripe Checkout page and returns only the server, which waits for the payment.
    create: request<CreateHostedServerInput, HostedServerSummary>()("hosted-servers:create"),
    openCheckout: request<string, HostedServerSummary>()("hosted-servers:open-checkout"),
    delete: request<DeleteHostedServerInput, void>()("hosted-servers:delete"),
    lifecycle: request<HostedServerLifecycleInput, void>()("hosted-servers:lifecycle"),
    wake: request<string, HostedServerSummary>()("hosted-servers:wake"),
    // Owner only. Stops a running server and starts it again; a server that does not run starts.
    restart: request<string, HostedServerSummary>()("hosted-servers:restart"),
  },
  // Servers that the desktop app starts on this computer, each with its own data. Each one is in the
  // server list as a joined server with `thisComputer`. `create` takes the name; the others take the
  // server id. A server, in server mode or hosted, has none and refuses these.
  localServers: {
    create: request<string, ServerSummary>()("local-servers:create"),
    restart: request<string, void>()("local-servers:restart"),
    delete: request<string, void>()("local-servers:delete"),
  },
  marketplaceAgents: {
    list: request<MarketplaceAgentQuery | undefined, MarketplaceAgentPage>()("marketplace-agents:list"),
    get: request<string, MarketplaceAgentDetail>()("marketplace-agents:get"),
    listMine: request<undefined, AgentSubmission[]>()("marketplace-agents:list-mine"),
    preview: request<string, AgentPublicationPreview>()("marketplace-agents:preview"),
    submit: request<SubmitMarketplaceAgentInput, AgentSubmission>()("marketplace-agents:submit"),
    install: request<InstallMarketplaceAgentInput, InstallMarketplaceAgentResult>()("marketplace-agents:install"),
  },
  // Link-only agent templates. `takePendingLink` and `openLink` carry an id from an
  // `openbot://agents/<id>` link; there is no endpoint that installs from a link without the dialog.
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
    event: event<CentralAuthState>()("auth:event"),
  },
  update: {
    getStatus: request<undefined, UpdateStatus>()("update:get-status"),
    check: request<undefined, UpdateStatus>()("update:check"),
    download: request<undefined, UpdateStatus>()("update:download"),
    install: request<undefined, void>()("update:install"),
    getPreference: request<undefined, UpdatePreference>()("update:get-preference"),
    setPreference: request<UpdatePreferenceChange, UpdatePreference>()("update:set-preference"),
    cancelScheduledRestart: request<undefined, UpdateStatus>()("update:cancel-scheduled-restart"),
    // The user of this computer restarts OpenBot, or installs the update, when no work runs.
    restartWhenIdle: request<IdleRestartTarget, UpdateStatus>()("update:restart-when-idle"),
    cancelIdleRestart: request<undefined, UpdateStatus>()("update:cancel-idle-restart"),
    event: event<UpdateStatus>()("update:event"),
    // A preference that an admin of a joined server changed on this computer.
    preference: event<UpdatePreference>()("update:preference-event"),
  },
  notifications: {
    getPreference: request<undefined, NotificationPreference>()("notifications:get-preference"),
    setPreference: request<NotificationPreference, NotificationPreference>()("notifications:set-preference"),
    // Shows one OS notification now, even when the window has focus, so the user can check that the
    // operating system lets OpenBot show them.
    test: request<undefined, void>()("notifications:test"),
    // Opens the operating system page where the user allows OpenBot notifications. It rejects on a
    // system that has no such page.
    openSettings: request<undefined, void>()("notifications:open-settings"),
    opened: event<NotificationOpenedEvent>()("notifications:opened-event"),
  },
  agent: {
    getStatus: scopedQuery<AgentStatus>()("agent:get-status"),
    /**
     * The local runtime snapshot, which the window reads after it subscribes to agent events. Main
     * drops an event while the page loads, so a snapshot event cannot do this. A joined server answers
     * null and sends its snapshot on its event stream.
     */
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
    getSidebarLayout: scopedQuery<SidebarLayoutSnapshot>()("agent:get-sidebar-layout"),
    mutateSidebarLayout: scopedRequest<SidebarLayoutAction, SidebarLayoutSnapshot>()("agent:mutate-sidebar-layout"),
    // A joined server answers through `agent-hidden-v1`. A server without it has no hidden agents.
    listHiddenAgents: scopedQuery<HiddenAgentsSnapshot>()("agent:hidden:list"),
    setAgentHidden: scopedRequest<SetAgentHiddenInput, HiddenAgentsSnapshot>()("agent:hidden:set"),
    generateProfile: scopedRequest<GenerateAgentProfileInput, AgentProfileDraft>()("agent:generate-profile"),
    saveProfile: scopedRequest<SaveAgentProfileInput, SaveAgentProfileResult>()("agent:save-profile"),
    // Only the computer that runs the agent answers. A joined server has no route for it.
    askSideQuestion: scopedRequest<AskSideQuestionInput, string>()("agent:ask-side-question"),
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
    // On a joined server, a sign-in page that the agent printed goes through `sign-in-relay-v1`. The
    // page is answered when this computer cannot take the callback, so the user pastes the address.
    openMessageLink: scopedRequest<OpenMessageLinkInput, McpSignInRelayPage | null>()("agent:open-message-link"),
    // Resolves when the sign-in ended, and rejects with its error.
    pasteMessageLink: scopedRequest<PasteMessageLinkInput, void>()("agent:paste-message-link"),
    cancelMessageLink: scopedRequest<CancelMessageLinkInput, void>()("agent:cancel-message-link"),
    // Local only: a joined server has no file search route, so the renderer asks only this computer.
    searchConversationFiles: request<SearchConversationFilesInput, ConversationFileSearchPage>()(
      "agent:search-conversation-files",
    ),
    listConversationReads: scopedQuery<Record<string, ConversationReadState>>()("agent:list-conversation-reads"),
    markConversationRead: scopedRequest<MarkConversationReadInput, ConversationReadState>()(
      "agent:mark-conversation-read",
    ),
    sendMessage: scopedRequest<SendMessageInput, QueuedMessageReceipt>()("agent:send-message"),
    setMessageReaction: scopedRequest<SetMessageReactionInput, void>()("agent:set-message-reaction"),
    listQueue: scopedRequest<string, QueueSnapshot>()("agent:list-queue"),
    listWaits: scopedRequest<string, AgentWaitsSnapshot>()("agent:list-waits"),
    cancelWait: scopedRequest<CancelAgentWaitInput, void>()("agent:cancel-wait"),
    // A joined server takes these through `agent-tasks-v1`, except `runQueuedMessageAsTask`, which is local only.
    listTasks: scopedRequest<string, AgentTasksSnapshot>()("agent:tasks:list"),
    readTask: scopedRequest<AgentTaskInput, ConversationSnapshot>()("agent:tasks:read"),
    startTask: scopedRequest<StartAgentTaskInput, AgentTask>()("agent:tasks:start"),
    runQueuedMessageAsTask: scopedRequest<RunQueuedMessageAsTaskInput, AgentTask>()("agent:tasks:run-queued-message"),
    stopTask: scopedRequest<AgentTaskInput, void>()("agent:tasks:stop"),
    closeTask: scopedRequest<AgentTaskInput, void>()("agent:tasks:close"),
    reopenTask: scopedRequest<AgentTaskInput, void>()("agent:tasks:reopen"),
    // A joined server takes these through `agent-threads-v1`.
    renameTask: scopedRequest<RenameAgentTaskInput, void>()("agent:tasks:rename"),
    deleteTask: scopedRequest<AgentTaskInput, void>()("agent:tasks:delete"),
    // A joined server takes this through `agent-thread-reads-v1`.
    markTaskRead: scopedRequest<MarkAgentTaskReadInput, AgentTaskReadState>()("agent:tasks:mark-read"),
    acknowledgeFailedTurn: scopedRequest<AcknowledgeFailedTurnInput, void>()("agent:acknowledge-failed-turn"),
    cancelQueuedMessage: scopedRequest<CancelQueuedMessageInput, void>()("agent:cancel-queued-message"),
    steerQueuedMessage: scopedRequest<SteerQueuedMessageInput, void>()("agent:steer-queued-message"),
    editQueuedMessage: scopedRequest<EditQueuedMessageInput, QueueSnapshot>()("agent:edit-queued-message"),
    updateQueuedMessage: scopedRequest<UpdateQueuedMessageInput, void>()("agent:update-queued-message"),
    reorderQueue: scopedRequest<ReorderQueueInput, void>()("agent:reorder-queue"),
    interrupt: scopedRequest<InterruptTurnInput, void>()("agent:interrupt"),
    clearContext: scopedRequest<string, void>()("agent:clear-context"),
    compactContext: scopedRequest<string, void>()("agent:compact-context"),
    compactTaskContext: scopedRequest<AgentTaskInput, void>()("agent:tasks:compact-context"),
    respondToPrompt: scopedRequest<RespondToPromptInput, void>()("agent:respond-to-prompt"),
    respondToApproval: scopedRequest<RespondToApprovalInput, void>()("agent:respond-to-approval"),
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
    // Shared tables are not scoped to an agent: there is no `agentId` on either call. The list is
    // every table in the one shared database, and the user's delete is not owner-gated.
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
    /** The shell command a local script uses to run the routine. It names the token file, not the token. */
    automationRunCommand: scopedRequest<TestRoutineInput, string>()("agent:automation-run-command"),
    // Every routine of the host, of agents and channels, with its runs in a range.
    routineCalendar: scopedRequest<RoutineCalendarInput, RoutineCalendar>()("agent:routine-calendar"),
  },
  channelMemories: {
    listChannelMemories: scopedRequest<string, ChannelMemory[]>()("agent:channel-memories:list"),
    createChannelMemory: scopedRequest<CreateChannelMemoryInput, ChannelMemory>()("agent:channel-memories:create"),
    updateChannelMemory: scopedRequest<UpdateChannelMemoryInput, ChannelMemory>()("agent:channel-memories:update"),
    deleteChannelMemory: scopedRequest<DeleteChannelMemoryInput, void>()("agent:channel-memories:delete"),
    clearChannelMemories: scopedRequest<string, void>()("agent:channel-memories:clear"),
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
  /**
   * Routine flows: an agent routine's answer handed on from agent to agent, and the canvas that shows
   * it. A joined server answers through `routine-flows-v1` when it supports it. The agent event
   * `routine-flows-changed` says which canvas changed.
   */
  routineFlows: {
    canvas: scopedRequest<string, RoutineFlowCanvas>()("routine-flows:canvas"),
    savePosition: scopedRequest<SaveRoutineFlowPositionInput, void>()("routine-flows:save-position"),
    removePosition: scopedRequest<RemoveRoutineFlowPositionInput, void>()("routine-flows:remove-position"),
    connect: scopedRequest<ConnectRoutineFlowInput, RoutineFlowLink>()("routine-flows:connect"),
    disconnect: scopedRequest<DisconnectRoutineFlowInput, void>()("routine-flows:disconnect"),
    updateLink: scopedRequest<UpdateRoutineFlowLinkInput, RoutineFlowLink>()("routine-flows:update-link"),
  },
  /**
   * Workflows: graphs of steps drawn on a canvas, their versions and their runs. The agent event
   * `workflows-changed` says which workflow changed. A joined server answers through `workflows-v1`
   * when it supports it.
   */
  workflows: {
    list: scopedQuery<WorkflowSummary[]>()("workflows:list"),
    get: scopedRequest<string, WorkflowDetail>()("workflows:get"),
    create: scopedRequest<CreateWorkflowInput, WorkflowDetail>()("workflows:create"),
    rename: scopedRequest<RenameWorkflowInput, WorkflowSummary>()("workflows:rename"),
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
    /** Makes a new signing secret for a webhook trigger; the first one also makes its address. */
    rotateWebhookSecret: scopedRequest<WorkflowTriggerInput, WorkflowWebhookSecret>()(
      "workflows:rotate-webhook-secret",
    ),
  },
  /**
   * Routine results: an agent routine's answer sent on to a messaging place. Only this computer's host
   * keeps a destination, so the group has no remote route. The agent event `routines-changed` says
   * when a destination or a delivery changed.
   */
  routineResults: {
    options: request<undefined, RoutineResultConnectionOption[]>()("routine-results:options"),
    destination: request<RoutineResultRoutineInput, RoutineResultDestination | null>()("routine-results:destination"),
    setDestination: request<SetRoutineResultDestinationInput, RoutineResultDestination | null>()(
      "routine-results:set-destination",
    ),
    deliveries: request<RoutineResultRoutineInput, RoutineResultDelivery[]>()("routine-results:deliveries"),
    resend: request<ResendRoutineResultInput, void>()("routine-results:resend"),
  },
  agentAttachments: {
    /** Imports bytes only. Disk paths remain private to the preload's attachmentImports group. */
    importAttachmentData: scopedRequest<AttachmentDataInput[], DraftAttachment[]>()("agent:import-attachment-data"),
    chooseAttachments: scopedRequest<ChooseAttachmentsInput, DraftAttachment[]>()("agent:choose-attachments"),
    discardDraftAttachment: scopedRequest<string, void>()("agent:discard-draft-attachment"),
    downloadAttachments: scopedRequest<DownloadAttachmentsInput, void>()("agent:download-attachments"),
    openAttachment: scopedRequest<OpenAttachmentInput, void>()("agent:open-attachment"),
    openSharedFile: scopedRequest<OpenSharedFileInput, void>()("agent:open-shared-file"),
    openWorkspaceFile: scopedRequest<OpenWorkspaceFileInput, void>()("agent:open-workspace-file"),
    previewSharedFile: scopedRequest<PreviewSharedFileInput, FilePreview>()("agent:preview-shared-file"),
    previewWorkspaceFile: scopedRequest<PreviewWorkspaceFileInput, FilePreview>()("agent:preview-workspace-file"),
    /** Releases only this client's temporary HTML bytes, never a file on a host. */
    releaseFilePreview: request<string, void>()("agent:release-file-preview"),
    listWorkspaceDirectory: scopedRequest<OpenWorkspaceFileInput, WorkspaceDirectory>()(
      "agent:list-workspace-directory",
    ),
  },
  // The folders a local agent can change besides its workspace. A joined server has no route for them:
  // the Team API does not carry them, as it does not carry `access`.
  agentFolders: {
    listAgentFolders: request<string, AgentFolderList>()("agent:folders:list"),
    // Opens the folder picker in main.
    chooseAgentFolder: request<ChooseAgentFolderInput, AgentFolderChange>()("agent:folders:choose"),
    // A dropped folder, or the Undo of a removal. Main checks each path as it checks a picked one.
    addAgentFolder: request<AgentFolderInput, AgentFolderChange>()("agent:folders:add"),
    removeAgentFolder: request<AgentFolderInput, AgentFolderChange>()("agent:folders:remove"),
    // Folders in those that the agent must not change. The picker opens in main; add is the Undo.
    chooseAgentExclusion: request<string, AgentExclusionChange>()("agent:folders:exclusions:choose"),
    addAgentExclusion: request<AgentFolderInput, AgentExclusionChange>()("agent:folders:exclusions:add"),
    removeAgentExclusion: request<AgentFolderInput, AgentExclusionChange>()("agent:folders:exclusions:remove"),
  },
  // Not part of `agentAttachments`: the preload sends the paths of dropped and pasted files, and the
  // renderer must never name a path to import. So this group is never bridged to the renderer.
  attachmentImports: {
    importAttachments: scopedRequest<ImportAttachmentsInput, DraftAttachment[]>()("agent:import-attachments"),
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
    // Resolves when the local sign-in window closes, or when the site in it looks signed in.
    openLocalSignIn: request<BrowserLocalSignInInput, BrowserLocalSignInEnd>()("browser:local-sign-in-open"),
    finishLocalSignIn: request<BrowserLocalSignInFinish, BrowserLocalSignInResult | null>()(
      "browser:local-sign-in-finish",
    ),
  },
  // Not part of `browser`, so that group can be bridged: this is the one untyped endpoint. The renderer
  // sends `BrowserLiveViewInput` and main reads the wire `BrowserViewInput`, which differ on purpose
  // (see `ipc-browser.ts`); main's wire decoder fills the rest.
  browserInput: {
    sendLiveViewInput: untypedRequest("browser:send-live-view-input"),
  },
  servers: {
    list: request<undefined, ServerSummary[]>()("servers:list"),
    select: request<string, ServerSummary[]>()("servers:select"),
    reorder: request<ReorderServersInput, ServerSummary[]>()("servers:reorder"),
    setMuted: request<SetServerMutedInput, ServerSummary[]>()("servers:set-muted"),
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
  // Access and auto-approve of one agent, read and written on the computer that runs it. A joined
  // server answers only an owner or admin, and only when it advertises `agent-admin-v1`.
  agentAdmin: {
    getAgentHostSettings: scopedRequest<string, AgentHostSettings>()("agent:admin:get-host-settings"),
    updateAgentHostSettings: scopedRequest<UpdateAgentHostSettingsInput, AgentHostSettings>()(
      "agent:admin:update-host-settings",
    ),
    // Backup models: `agent-backup-models-v1` on a joined server.
    getAgentBackupModels: scopedRequest<string, AgentBackupModelSettings>()("agent:admin:get-backup-models"),
    updateAgentBackupModels: scopedRequest<UpdateAgentBackupModelsInput, AgentBackupModelSettings>()(
      "agent:admin:update-backup-models",
    ),
    // Task limit: `agent-task-limit-v1` on a joined server.
    getAgentTaskLimit: scopedRequest<string, AgentTaskLimitSettings>()("agent:admin:get-task-limit"),
    updateAgentTaskLimit: scopedRequest<UpdateAgentTaskLimitInput, AgentTaskLimitSettings>()(
      "agent:admin:update-task-limit",
    ),
    // Browser profiles of the computer that runs the agents, and the profile of one agent.
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
    listBrowserTabProfiles: scopedQuery<BrowserTabProfile[]>()("agent:admin:list-browser-tab-profiles"),
    getAgentAdminSettings: scopedRequest<string, AgentAdminSettings>()("agent:admin:get-settings"),
    updateAgentAdminSettings: scopedRequest<UpdateAgentAdminSettingsInput, AgentAdminSettings>()(
      "agent:admin:update-settings",
    ),
    // The skills of one agent, on the computer that runs it. The `skills` group reads and writes
    // this computer only; these take the server, so a remote admin reaches the host.
    listAgentSkills: scopedRequest<string, InstalledSkill[], "required">()("agent:admin:list-skills"),
    installAgentSkill: scopedRequest<InstallSkillInput, InstalledSkill, "required">()("agent:admin:install-skill"),
    uninstallAgentSkill: scopedRequest<UninstallSkillInput, void, "required">()("agent:admin:uninstall-skill"),
    setAgentSkillEnabled: scopedRequest<SetEnabledSkillInput, InstalledSkill, "required">()(
      "agent:admin:set-skill-enabled",
    ),
    // A new agent from a marketplace listing or a shared template, added on the computer that runs
    // it. The `marketplaceAgents` and `agentTemplates` installs stay for this computer.
    addMarketplaceAgent: scopedRequest<InstallMarketplaceAgentInput, AddedAgent, "required">()(
      "agent:admin:add-marketplace-agent",
    ),
    addTemplateAgent: scopedRequest<InstallAgentTemplateInput, AddedAgent, "required">()(
      "agent:admin:add-template-agent",
    ),
  },
  // A separate group, not part of `servers`: a group is what one registrar covers in full, and
  // `servers` is bound against `RemoteServerManager` while these are bound against `AgentService`.
  mcpServers: {
    // Every MCP method names its server, because the settings modal can be open for a server the user
    // has not switched to. Each mutation answers with the whole list, so the panel never merges.
    listMcpServers: scopedQuery<McpServerConfig[], "required">()("servers:mcp:list"),
    saveMcpServer: scopedRequest<SaveMcpServerInput, McpServerConfig[], "required">()("servers:mcp:save"),
    removeMcpServer: scopedRequest<RemoveMcpServerInput, McpServerConfig[], "required">()("servers:mcp:remove"),
    setMcpServerEnabled: scopedRequest<SetMcpServerEnabledInput, McpServerConfig[], "required">()(
      "servers:mcp:set-enabled",
    ),
    // A test connects once and reports what it found. Nothing is stored, and no agent uses it.
    testMcpServer: scopedRequest<TestMcpServerInput, McpTestResult, "required">()("servers:mcp:test"),
    // A test never opens a browser; a sign-in does, and answers once the browser came back and the
    // server took the token. On a remote server the page opens in the host's browser, and the panel
    // shows that tab: `mcpSignInPage` names it while the sign-in waits.
    signInMcpServer: scopedRequest<TestMcpServerInput, McpTestResult, "required">()("servers:mcp:sign-in"),
    mcpSignInPage: scopedRequest<CancelMcpSignInInput, string | null, "required">()("servers:mcp:sign-in-page"),
    // A host with `sign-in-relay-v1` opens no tab: the page opens in this computer's browser, and the
    // callback comes back here. `mcpSignInRelay` names the page while it waits, `openMcpSignInRelay`
    // opens it when the user asks, and `completeMcpSignInRelay` takes the address the user pastes when
    // no listener took the callback.
    mcpSignInRelay: scopedRequest<CancelMcpSignInInput, McpSignInRelayPage | null, "required">()(
      "servers:mcp:sign-in-relay",
    ),
    openMcpSignInRelay: scopedRequest<CancelMcpSignInInput, void, "required">()("servers:mcp:open-sign-in-relay"),
    completeMcpSignInRelay: scopedRequest<CompleteMcpSignInRelayInput, void, "required">()(
      "servers:mcp:complete-sign-in-relay",
    ),
    cancelMcpSignIn: scopedRequest<CancelMcpSignInInput, void, "required">()("servers:mcp:cancel-sign-in"),
    signOutMcpServer: scopedRequest<SignOutMcpServerInput, McpSignInState[], "required">()("servers:mcp:sign-out"),
    listMcpSignIns: scopedQuery<McpSignInState[], "required">()("servers:mcp:list-sign-ins"),
    // The OAuth app an administrator registered for a saved http row, and the exact callback address.
    // The client secret goes in and never comes back.
    mcpSignInApp: scopedRequest<McpSignInAppInput, McpSignInAppState, "required">()("servers:mcp:sign-in-app"),
    saveMcpSignInApp: scopedRequest<SaveMcpSignInAppInput, McpSignInAppState, "required">()(
      "servers:mcp:save-sign-in-app",
    ),
    removeMcpSignInApp: scopedRequest<McpSignInAppInput, McpSignInAppState, "required">()(
      "servers:mcp:remove-sign-in-app",
    ),
  },
  // Bound against the storage service, not `AgentService`, so it is its own group.
  storage: {
    getUsage: scopedRequest<GetStorageUsageInput, StorageUsage | null, "required">()("storage:get-usage"),
    // Free and total disk space with no scan, for the sidebar storage card. Null before `storage-disk-v1`.
    getDisk: scopedQuery<StorageDisk | null, "required">()("storage:get-disk"),
    // Disk, memory, and CPU of the machine, for Server settings > Storage. Null before `machine-resources-v1`.
    getMachineMetrics: scopedQuery<MachineMetrics | null, "required">()("storage:get-machine-metrics"),
    deleteFile: scopedRequest<DeleteStoredFileInput, void, "required">()("storage:delete-file"),
    clear: scopedRequest<ClearStorageInput, void, "required">()("storage:clear"),
    openFile: scopedRequest<OpenStoredFileInput, void, "required">()("storage:open-file"),
    openLocation: request<OpenStorageLocationInput, void>()("storage:open-location"),
    // Local only, like `openLocation`: a server removes its own old provider CLI versions.
    getOldRuntimeVersions: request<undefined, OldRuntimeVersions>()("storage:get-old-runtime-versions"),
    /** Removes the old versions no instance uses now, and answers what is left. */
    removeOldRuntimeVersions: request<undefined, OldRuntimeVersions>()("storage:remove-old-runtime-versions"),
  },
  // Bound against the agent import service, which holds the staged archives. A remote server is
  // reached with `agent-import-v1`; main still opens the file dialog and sends the file.
  agentImport: {
    choose: scopedQuery<AgentImportPreview | null, "required">()("agent-import:choose"),
    apply: scopedRequest<ApplyAgentImportInput, AgentImportResult, "required">()("agent-import:apply"),
    discard: scopedRequest<string, void, "required">()("agent-import:discard"),
    // The export skill of Grok Bot or Hermes Agent, for a user who adds it by hand. Main reads it
    // from the app's resources, and `saveSkill` asks where to write it.
    readSkill: request<AgentImportSkillSource, string>()("agent-import:read-skill"),
    saveSkill: request<AgentImportSkillSource, ExportResult>()("agent-import:save-skill"),
    // Hermes Agent profiles in a folder on this computer, so only the local server imports them.
    // `readHermes` reads the folder Hermes uses, `chooseHermes` one the user picks; null means none.
    readHermes: request<undefined, HermesImportPreview | null>()("agent-import:read-hermes"),
    chooseHermes: request<undefined, HermesImportPreview | null>()("agent-import:choose-hermes"),
    applyHermes: request<ApplyHermesImportInput, AgentImportResult>()("agent-import:apply-hermes"),
    discardHermes: request<string, void>()("agent-import:discard-hermes"),
  },
  // Bound against the instance transfer service: a server's agents and server settings in one file for
  // another server. A remote server is reached with `instance-transfer-v1`; main opens both file
  // dialogs and moves the file. `showExport` reveals the file this computer saved last.
  instanceTransfer: {
    summary: scopedQuery<InstanceTransferSummary, "required">()("instance-transfer:summary"),
    export: scopedRequest<ExportInstanceInput, InstanceExportResult, "required">()("instance-transfer:export"),
    showExport: request<undefined, void>()("instance-transfer:show-export"),
    choose: scopedQuery<InstanceTransferPreview | null, "required">()("instance-transfer:choose"),
    apply: scopedRequest<ApplyInstanceTransferInput, InstanceTransferResult, "required">()("instance-transfer:apply"),
    discard: scopedRequest<string, void, "required">()("instance-transfer:discard"),
  },
  // The plugin deep link, its own group because its registrar holds the pending link rather than a
  // service. `takePendingListing` is what a window that finished loading after the link arrived
  // asks for; `openListing` is the same slug pushed to a window that was already there.
  plugins: {
    takePendingListing: request<undefined, string | null>()("plugins:take-pending-listing"),
    openListing: event<string>()("plugins:open-listing"),
  },
  host: {
    getStatus: request<undefined, HostStatus>()("host:get-status"),
    configure: request<ConfigureHostInput, HostStatus>()("host:configure"),
    updateIdentity: request<UpdateHostIdentityInput, HostStatus>()("host:update-identity"),
    /** Changes this computer's server key. Paired devices follow a handover that both keys sign. */
    rotateIdentityKey: request<undefined, HostStatus>()("host:rotate-identity-key"),
    getPresence: request<undefined, TeamPresenceSnapshot>()("host:get-presence"),
    start: request<undefined, HostStatus>()("host:start"),
    stop: request<undefined, HostStatus>()("host:stop"),
    /**
     * Asks the screen sharing runtime again whether the operating system lets it record, and answers
     * the status that holds the result.
     *
     * The refusal is remembered, because the runtime that reported it is dropped so that the next
     * attempt reads a new grant. Without this call only another member's attempt could clear it, and
     * the host owner who just gave the grant would keep reading that they had not.
     */
    recheckScreenRecording: request<undefined, HostStatus>()("host:recheck-screen-recording"),
    listMembers: request<undefined, TeamMemberSummary[]>()("host:list-members"),
    createInvite: request<CreateTeamInviteInput, InviteSummary>()("host:create-invite"),
    listInvites: request<undefined, TeamInviteSummary[]>()("host:list-invites"),
    revokeInvite: request<string, void>()("host:revoke-invite"),
    updateMember: request<UpdateTeamMemberInput, TeamMemberSummary>()("host:update-member"),
    removeMember: request<string, void>()("host:remove-member"),
    listSessions: request<undefined, TeamSessionSummary[]>()("host:list-sessions"),
    revokeSession: request<string, void>()("host:revoke-session"),
    event: event<HostStatus>()("host:event"),
  },
  events: {
    getStatus: scopedQuery<EventStatus, "required">()("events:get-status"),
    listRoutines: scopedRequest<ListEventRoutinesInput, EventRoutine[], "required">()("events:list-routines"),
    saveRoutine: scopedRequest<SaveEventRoutineInput, SaveEventRoutineResult, "required">()("events:save-routine"),
    deleteRoutine: scopedRequest<EventRoutineRef, void, "required">()("events:delete-routine"),
    testRoutine: scopedRequest<EventRoutineRef, void, "required">()("events:test-routine"),
    rotateSecret: scopedRequest<EventRoutineRef, WebhookSecret, "required">()("events:rotate-secret"),
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

/**
 * Where each group sits on `window.openbot`. The empty path is the top level, and several groups can
 * share one path: the agent groups are spread into `agent`. Null keeps a group off the page; only the
 * preload calls it. A new group does not compile until it has a place here, so the author decides
 * what the page can call. `OpenBotDesktopApi`, the built-preload verifier and the test harness all
 * read this table; the preload and the preview mock are checked against it through the type.
 */
export const IPC_GROUP_PATHS = {
  app: "",
  maintenance: "maintenance",
  providers: "",
  providerRuntimes: "providerRuntimes",
  voice: "voice",
  dynamicIsland: "dynamicIsland",
  browserDock: "browserDock",
  computerUse: "computerUse",
  macAutomation: "macAutomation",
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
  vault: "vault",
  hostedSites: "hostedSites",
  routineFeed: "routineFeed",
  routineFlows: "routineFlows",
  workflows: "workflows",
  routineResults: "routineResults",
  billing: "billing",
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
  agentAttachments: "agent",
  agentFolders: "agent",
  // The preload calls it from its own drop, paste, and file input handlers.
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
  host: "host",
  events: "events",
  remoteDesktop: "remoteDesktop",
} as const satisfies { readonly [Group in keyof IpcEndpoints]: string | null };

export type IpcGroupName = keyof IpcEndpoints;
type IpcGroupPaths = typeof IPC_GROUP_PATHS;

// What a typed endpoint looks like to the renderer. A payload that may be `undefined` is an optional
// argument. A server-scoped payload loses its scope and takes the server last instead, because the
// preload builds the scope; left out, it is the selected server. A scope that carries nothing takes
// only the server.
type OptionalArgs<Payload> = [Payload] extends [undefined]
  ? []
  : undefined extends Payload
    ? [input?: Exclude<Payload, undefined>]
    : [input: Payload];

type ServerArgs<Server> = [Server] extends ["required"] ? [serverId: string] : [serverId?: string];

type ScopedArgs<Inner, Server> = [Inner] extends [null]
  ? ServerArgs<Server>
  : [...OptionalArgs<Inner>, ...ServerArgs<Server>];

/**
 * The `OpenBotDesktopApi` signature of a typed request, so a method that passes its input straight
 * through takes its types from the endpoint instead of repeating them. An untyped endpoint is `never`.
 */
export type Invoke<Endpoint> =
  Endpoint extends ScopedRequestEndpoint<string, infer Inner, infer Result, infer Server>
    ? (...args: ScopedArgs<Inner, Server>) => Promise<Result>
    : Endpoint extends RequestEndpoint<string, infer Payload, infer Result>
      ? [Payload] extends [Untyped]
        ? never
        : (...args: OptionalArgs<Payload>) => Promise<Result>
      : never;

/** The `OpenBotDesktopApi` subscription to a typed event. It answers the unsubscribe call. */
export type Subscribe<Endpoint> =
  Endpoint extends EventEndpoint<string, infer Payload>
    ? (listener: [Payload] extends [undefined] ? () => void : (payload: Payload) => void) => () => void
    : never;

type MethodName<Key extends string, Endpoint> = Endpoint extends EventEndpoint ? `on${Capitalize<Key>}` : Key;

/**
 * The `OpenBotDesktopApi` surface of a group whose methods pass straight through: a request keeps
 * its key, and an event is `on` and the key. The preload builds it with `bridgeGroup`, so a new
 * endpoint in such a group needs no line in `ipc-desktop-apis.ts`.
 */
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

// Distributes over a union of groups, one `GroupApi` each.
type GroupApis<Group extends IpcGroupName> = Group extends IpcGroupName ? GroupApi<IpcEndpoints[Group]> : never;

/** Every group at one path of `window.openbot`, as one surface: `PathApi<"agent">` is all nine agent groups. */
export type PathApi<Path extends string> = UnionToIntersection<GroupApis<GroupsAt<Path>>>;

type NestedPath = Exclude<IpcGroupPaths[IpcGroupName], "" | null>;

/**
 * `window.openbot` as `IPC_GROUP_PATHS` lays it out, with every method passed straight through.
 * `OpenBotDesktopApi` is this, except for the few members the preload writes by hand.
 */
export type BridgedDesktopApi = PathApi<""> & { [Path in NestedPath]: PathApi<Path> };

/** The runtime twin of `GroupApi`'s method names, for the preload bridge and the test harness. */
export function groupApiMethodName(key: string, endpoint: IpcEndpoint): string {
  return endpoint.kind === "event" ? `on${key.charAt(0).toUpperCase()}${key.slice(1)}` : key;
}
