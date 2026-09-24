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
import type { AppLanguagePreference, SetAppLanguagePreferenceInput } from "./app-language";
import type { AgentAnalytics, AgentAnalyticsInput } from "./ipc-agent-analytics";
import type { AgentIpcRequest, ScopedAgentEvent } from "./ipc-agent-events";
import type { AgentModelOption } from "./ipc-agent-identity";
import type {
  AgentMemory,
  CreateAgentMemoryInput,
  DeleteAgentMemoryInput,
  UpdateAgentMemoryInput,
} from "./ipc-agent-memories";
import type {
  AgentProfileDraft,
  GenerateAgentProfileInput,
  SaveAgentProfileInput,
  SaveAgentProfileResult,
} from "./ipc-agent-profile";
import type {
  AccountUsage,
  AgentProviderId,
  AgentStatus,
  ProviderApiKeyState,
  ProviderCodeLoginStart,
  SetProviderApiKeyInput,
} from "./ipc-agent-status";
import type {
  AgentSummary,
  AvatarImageInput,
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
  ComputerUseHighlightPlacement,
  ComputerUsePermissionApp,
  ComputerUseState,
  ExportResult,
  ExternalDestination,
  MacPermissionId,
  ProviderRuntimeSnapshot,
  SaveSetupInput,
  SetAnalyticsPreferenceInput,
  UpdatePreference,
  UpdateStatus,
  VerifyEmailCodeInput,
} from "./ipc-app-auth";
import type {
  ApprovalAutomationPreference,
  RespondToApprovalInput,
  RespondToBrowserTakeoverInput,
  SetApprovalAutomationInput,
} from "./ipc-approvals";
import type {
  ChooseAttachmentsInput,
  DownloadAttachmentsInput,
  DraftAttachment,
  FilePreview,
  ImportAttachmentsInput,
  OpenAttachmentInput,
  OpenSharedFileInput,
  OpenWorkspaceFileInput,
} from "./ipc-attachments";
import type {
  BrowserBounds,
  BrowserControlState,
  BrowserDisplayState,
  BrowserLiveViewEvent,
  BrowserNavigateInput,
  BrowserOpenInput,
  BrowserPictureInPictureEvent,
  BrowserPreview,
  BrowserTab,
  BrowserVisibilityInput,
} from "./ipc-browser";
import type { RespondToBrowserSecretInput } from "./ipc-browser-secret";
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
  CustomProviderResult,
  CustomProviderSummary,
  DeleteCustomProviderInput,
  SaveCustomProviderInput,
} from "./ipc-custom-providers";
import type {
  DynamicIslandAction,
  DynamicIslandGeometry,
  DynamicIslandPreference,
  DynamicIslandPresentation,
  SetDynamicIslandInteractiveInput,
  SetDynamicIslandPreferenceInput,
} from "./ipc-dynamic-island";
import type { HostAnalytics, HostAnalyticsInput } from "./ipc-host-analytics";
import type {
  DeleteHostedSiteInput,
  HostedSiteSummary,
  PublishHostedSiteInput,
  ReplaceHostedSiteInput,
} from "./ipc-hosted-sites";
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
  CreateRoutineInput,
  DeleteRoutineInput,
  ListRoutineRunsInput,
  Routine,
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
import type { VoiceModelStatus, VoiceTranscriptionInput, VoiceTranscriptionResult } from "./ipc-voice";
import type { AccountSession, MobileConnectedDevice, MobileConnectTicket } from "./mobile-connect";

declare const payloadType: unique symbol;
declare const resultType: unique symbol;
declare const untypedBrand: unique symbol;

/**
 * The payload and result of an endpoint that has no types. The main binder and the preload accept
 * anything for it. Only `browser.sendLiveViewInput` uses it: see the comment at that endpoint.
 */
export interface Untyped {
  readonly [untypedBrand]: true;
}

export interface RequestEndpoint<Channel extends string = string, Payload = unknown, Result = unknown> {
  readonly kind: "request";
  readonly channel: Channel;
  readonly [payloadType]?: Payload;
  readonly [resultType]?: Result;
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
function request<Payload, Result>(): <Channel extends string>(
  channel: Channel,
) => RequestEndpoint<Channel, Payload, Result> {
  return (channel) => ({ kind: "request", channel });
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
    getAnalyticsPreference: request<undefined, AnalyticsPreference>()("app:get-analytics-preference"),
    setAnalyticsPreference: request<SetAnalyticsPreferenceInput, AnalyticsPreference>()("app:set-analytics-preference"),
    getApprovalAutomation: request<undefined, ApprovalAutomationPreference>()("app:get-approval-automation"),
    setApprovalAutomation: request<SetApprovalAutomationInput, ApprovalAutomationPreference>()(
      "app:set-approval-automation",
    ),
    getAppLanguagePreference: request<undefined, AppLanguagePreference>()("app:get-language-preference"),
    setAppLanguagePreference: request<SetAppLanguagePreferenceInput, AppLanguagePreference>()(
      "app:set-language-preference",
    ),
    // Every window draws its own text, so the choice is broadcast rather than returned: the
    // Dynamic Island overlay has no Settings of its own and would otherwise stay in the old
    // language until it was next recreated.
    appLanguagePreference: event<AppLanguagePreference>()("app:language-preference"),
    // The native Preferences menu item and its shortcut live in main, while the dialog lives in
    // the renderer, so the menu click is broadcast rather than handled: every window opens its
    // own Settings.
    openSettings: event<undefined>()("app:open-settings"),
    openExternal: request<ExternalDestination, void>()("app:open-external"),
    openUrl: request<string, void>()("app:open-url"),
  },
  maintenance: {
    exportData: request<undefined, ExportResult>()("maintenance:export-data"),
    exportDiagnostics: request<undefined, ExportResult>()("maintenance:export-diagnostics"),
  },
  providers: {
    connectProvider: request<AgentProviderId, AgentStatus>()("app:connect-provider"),
    refreshAgentProviders: request<undefined, AgentStatus>()("app:refresh-agent-providers"),
    updateProviderCli: request<ManagedProviderId, AgentStatus>()("app:update-provider-cli"),
    setProviderApiKey: request<SetProviderApiKeyInput, AgentStatus>()("app:set-provider-api-key"),
    clearProviderApiKey: request<AgentProviderId, AgentStatus>()("app:clear-provider-api-key"),
    getProviderApiKeyState: request<AgentProviderId, ProviderApiKeyState>()("app:get-provider-api-key-state"),
    startProviderCodeLogin: request<AgentProviderId, ProviderCodeLoginStart>()("app:start-provider-code-login"),
    cancelProviderCodeLogin: request<AgentProviderId, AgentStatus>()("app:cancel-provider-code-login"),
  },
  providerRuntimes: {
    getStatus: request<undefined, ProviderRuntimeSnapshot>()("provider-runtimes:get-status"),
    download: request<ManagedProviderId, ProviderRuntimeSnapshot>()("provider-runtimes:download"),
    cancel: request<ManagedProviderId, ProviderRuntimeSnapshot>()("provider-runtimes:cancel"),
    checkForUpdates: request<undefined, ProviderRuntimeSnapshot>()("provider-runtimes:check-for-updates"),
    event: event<ProviderRuntimeSnapshot>()("provider-runtimes:event"),
  },
  voice: {
    getModelStatus: request<undefined, VoiceModelStatus>()("voice:get-model-status"),
    prepareModel: request<undefined, VoiceModelStatus>()("voice:prepare-model"),
    transcribe: request<VoiceTranscriptionInput, VoiceTranscriptionResult>()("voice:transcribe"),
    modelStatus: event<VoiceModelStatus>()("voice:model-status"),
  },
  dynamicIsland: {
    getPreference: request<undefined, DynamicIslandPreference>()("dynamic-island:get-preference"),
    setPreference: request<SetDynamicIslandPreferenceInput, DynamicIslandPreference>()("dynamic-island:set-preference"),
    publishPresentation: request<DynamicIslandPresentation, void>()("dynamic-island:publish-presentation"),
    getPresentation: request<undefined, DynamicIslandPresentation>()("dynamic-island:get-presentation"),
    presentation: event<DynamicIslandPresentation>()("dynamic-island:presentation"),
    preference: event<DynamicIslandPreference>()("dynamic-island:preference"),
    geometry: event<DynamicIslandGeometry>()("dynamic-island:geometry"),
    performAction: request<DynamicIslandAction, void>()("dynamic-island:perform-action"),
    performHaptic: request<undefined, void>()("dynamic-island:perform-haptic"),
    action: event<DynamicIslandAction>()("dynamic-island:action"),
    setInteractive: request<SetDynamicIslandInteractiveInput, void>()("dynamic-island:set-interactive"),
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
  },
  hostedSites: {
    list: request<undefined, HostedSiteSummary[]>()("hosted-sites:list"),
    chooseDirectory: request<undefined, string | null>()("hosted-sites:choose-directory"),
    publish: request<PublishHostedSiteInput, HostedSiteSummary>()("hosted-sites:publish"),
    replace: request<ReplaceHostedSiteInput, HostedSiteSummary>()("hosted-sites:replace"),
    delete: request<DeleteHostedSiteInput, void>()("hosted-sites:delete"),
  },
  marketplaceAgents: {
    list: request<MarketplaceAgentQuery | undefined, MarketplaceAgentPage>()("marketplace-agents:list"),
    get: request<string, MarketplaceAgentDetail>()("marketplace-agents:get"),
    listMine: request<undefined, AgentSubmission[]>()("marketplace-agents:list-mine"),
    preview: request<string, AgentPublicationPreview>()("marketplace-agents:preview"),
    submit: request<SubmitMarketplaceAgentInput, AgentSubmission>()("marketplace-agents:submit"),
    install: request<InstallMarketplaceAgentInput, InstallMarketplaceAgentResult>()("marketplace-agents:install"),
  },
  auth: {
    getState: request<undefined, CentralAuthState>()("auth:get-state"),
    retry: request<undefined, CentralAuthState>()("auth:retry"),
    requestEmailCode: request<string, CentralAuthState>()("auth:request-email-code"),
    verifyEmailCode: request<VerifyEmailCodeInput, CentralAuthState>()("auth:verify-email-code"),
    updateName: request<string, CentralAuthState>()("auth:update-name"),
    updateAvatar: request<AvatarImageInput | null, CentralAuthState>()("auth:update-avatar"),
    createMobileConnect: request<undefined, MobileConnectTicket>()("auth:create-mobile-connect"),
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
    setPreference: request<UpdatePreference, UpdatePreference>()("update:set-preference"),
    event: event<UpdateStatus>()("update:event"),
  },
  notifications: {
    getPreference: request<undefined, NotificationPreference>()("notifications:get-preference"),
    setPreference: request<NotificationPreference, NotificationPreference>()("notifications:set-preference"),
    test: request<undefined, void>()("notifications:test"),
    openSettings: request<undefined, void>()("notifications:open-settings"),
    openedEvent: event<NotificationOpenedEvent>()("notifications:opened-event"),
  },
  agent: {
    getStatus: request<AgentIpcRequest<null>, AgentStatus>()("agent:get-status"),
    getAnalytics: request<AgentIpcRequest<AgentAnalyticsInput>, AgentAnalytics | null>()("agent:get-analytics"),
    getHostAnalytics: request<AgentIpcRequest<HostAnalyticsInput>, HostAnalytics | null>()("host:get-analytics"),
    getUsage: request<AgentIpcRequest<string | undefined>, AccountUsage>()("agent:get-usage"),
    listModels: request<AgentIpcRequest<null>, AgentModelOption[]>()("agent:list-models"),
    list: request<AgentIpcRequest<null>, AgentSummary[]>()("agent:list"),
    listInstalledSkills: request<AgentIpcRequest<string>, InstalledSkill[]>()("agent:list-installed-skills"),
    listChannels: request<AgentIpcRequest<null>, ChannelSummary[]>()("agent:channels:list"),
    readChannel: request<AgentIpcRequest<ChannelReadInput>, ChannelPage>()("agent:channels:read"),
    channelCommand: request<AgentIpcRequest<ChannelCommand>, Channel>()("agent:channels:command"),
    deleteChannel: request<AgentIpcRequest<string>, void>()("agent:channels:delete"),
    getSidebarLayout: request<AgentIpcRequest<null>, SidebarLayoutSnapshot>()("agent:get-sidebar-layout"),
    mutateSidebarLayout: request<AgentIpcRequest<SidebarLayoutAction>, SidebarLayoutSnapshot>()(
      "agent:mutate-sidebar-layout",
    ),
    generateProfile: request<AgentIpcRequest<GenerateAgentProfileInput>, AgentProfileDraft>()("agent:generate-profile"),
    saveProfile: request<AgentIpcRequest<SaveAgentProfileInput>, SaveAgentProfileResult>()("agent:save-profile"),
    create: request<AgentIpcRequest<CreateAgentInput>, AgentSummary>()("agent:create"),
    duplicate: request<AgentIpcRequest<string>, DuplicateAgentResult>()("agent:duplicate"),
    update: request<AgentIpcRequest<UpdateAgentInput>, AgentSummary>()("agent:update"),
    setAvatar: request<AgentIpcRequest<SetAgentAvatarInput>, AgentSummary>()("agent:set-avatar"),
    delete: request<AgentIpcRequest<string>, void>()("agent:delete"),
    readConversation: request<AgentIpcRequest<string>, ConversationWithReadState>()("agent:read-conversation"),
    readConversationPage: request<AgentIpcRequest<ReadConversationPageInput>, ConversationPage>()(
      "agent:read-conversation-page",
    ),
    searchConversationMessages: request<AgentIpcRequest<SearchConversationMessagesInput>, ConversationSearchPage>()(
      "agent:search-conversation-messages",
    ),
    listConversationReads: request<AgentIpcRequest<null>, Record<string, ConversationReadState>>()(
      "agent:list-conversation-reads",
    ),
    markConversationRead: request<AgentIpcRequest<MarkConversationReadInput>, ConversationReadState>()(
      "agent:mark-conversation-read",
    ),
    sendMessage: request<AgentIpcRequest<SendMessageInput>, QueuedMessageReceipt>()("agent:send-message"),
    setMessageReaction: request<AgentIpcRequest<SetMessageReactionInput>, void>()("agent:set-message-reaction"),
    listQueue: request<AgentIpcRequest<string>, QueueSnapshot>()("agent:list-queue"),
    acknowledgeFailedTurn: request<AgentIpcRequest<AcknowledgeFailedTurnInput>, void>()(
      "agent:acknowledge-failed-turn",
    ),
    cancelQueuedMessage: request<AgentIpcRequest<CancelQueuedMessageInput>, void>()("agent:cancel-queued-message"),
    steerQueuedMessage: request<AgentIpcRequest<SteerQueuedMessageInput>, void>()("agent:steer-queued-message"),
    editQueuedMessage: request<AgentIpcRequest<EditQueuedMessageInput>, QueueSnapshot>()("agent:edit-queued-message"),
    updateQueuedMessage: request<AgentIpcRequest<UpdateQueuedMessageInput>, void>()("agent:update-queued-message"),
    reorderQueue: request<AgentIpcRequest<ReorderQueueInput>, void>()("agent:reorder-queue"),
    interrupt: request<AgentIpcRequest<InterruptTurnInput>, void>()("agent:interrupt"),
    respondToPrompt: request<AgentIpcRequest<RespondToPromptInput>, void>()("agent:respond-to-prompt"),
    respondToApproval: request<AgentIpcRequest<RespondToApprovalInput>, void>()("agent:respond-to-approval"),
    respondToBrowserSecret: request<AgentIpcRequest<RespondToBrowserSecretInput>, void>()(
      "agent:respond-to-browser-secret",
    ),
    respondToBrowserTakeover: request<AgentIpcRequest<RespondToBrowserTakeoverInput>, void>()(
      "agent:respond-to-browser-takeover",
    ),
    event: event<ScopedAgentEvent>()("agent:event"),
  },
  agentMemories: {
    listMemories: request<AgentIpcRequest<string>, AgentMemory[]>()("agent:list-memories"),
    createMemory: request<AgentIpcRequest<CreateAgentMemoryInput>, AgentMemory>()("agent:create-memory"),
    updateMemory: request<AgentIpcRequest<UpdateAgentMemoryInput>, AgentMemory>()("agent:update-memory"),
    deleteMemory: request<AgentIpcRequest<DeleteAgentMemoryInput>, void>()("agent:delete-memory"),
    clearMemories: request<AgentIpcRequest<string>, void>()("agent:clear-memories"),
  },
  sharedTables: {
    listTables: request<AgentIpcRequest<null>, SharedTable[]>()("shared:list-tables"),
    deleteTable: request<AgentIpcRequest<DeleteSharedTableInput>, void>()("shared:delete-table"),
  },
  agentRoutines: {
    listRoutines: request<AgentIpcRequest<string>, Routine[]>()("agent:list-routines"),
    createRoutine: request<AgentIpcRequest<CreateRoutineInput>, Routine>()("agent:create-routine"),
    updateRoutine: request<AgentIpcRequest<UpdateRoutineInput>, Routine>()("agent:update-routine"),
    deleteRoutine: request<AgentIpcRequest<DeleteRoutineInput>, void>()("agent:delete-routine"),
    testRoutine: request<AgentIpcRequest<TestRoutineInput>, RoutineRun>()("agent:test-routine"),
    listRoutineRuns: request<AgentIpcRequest<ListRoutineRunsInput>, RoutineRun[]>()("agent:list-routine-runs"),
  },
  channelMemories: {
    listChannelMemories: request<AgentIpcRequest<string>, ChannelMemory[]>()("agent:channel-memories:list"),
    createChannelMemory: request<AgentIpcRequest<CreateChannelMemoryInput>, ChannelMemory>()(
      "agent:channel-memories:create",
    ),
    updateChannelMemory: request<AgentIpcRequest<UpdateChannelMemoryInput>, ChannelMemory>()(
      "agent:channel-memories:update",
    ),
    deleteChannelMemory: request<AgentIpcRequest<DeleteChannelMemoryInput>, void>()("agent:channel-memories:delete"),
    clearChannelMemories: request<AgentIpcRequest<string>, void>()("agent:channel-memories:clear"),
  },
  channelRoutines: {
    listChannelRoutines: request<AgentIpcRequest<string>, ChannelRoutine[]>()("agent:channel-routines:list"),
    createChannelRoutine: request<AgentIpcRequest<CreateChannelRoutineInput>, ChannelRoutine>()(
      "agent:channel-routines:create",
    ),
    updateChannelRoutine: request<AgentIpcRequest<UpdateChannelRoutineInput>, ChannelRoutine>()(
      "agent:channel-routines:update",
    ),
    deleteChannelRoutine: request<AgentIpcRequest<DeleteChannelRoutineInput>, void>()("agent:channel-routines:delete"),
    testChannelRoutine: request<AgentIpcRequest<TestChannelRoutineInput>, ChannelRoutineRun>()(
      "agent:channel-routines:test",
    ),
    listChannelRoutineRuns: request<AgentIpcRequest<ListChannelRoutineRunsInput>, ChannelRoutineRun[]>()(
      "agent:channel-routines:runs",
    ),
  },
  agentAttachments: {
    chooseAttachments: request<AgentIpcRequest<ChooseAttachmentsInput>, DraftAttachment[]>()(
      "agent:choose-attachments",
    ),
    importAttachments: request<AgentIpcRequest<ImportAttachmentsInput>, DraftAttachment[]>()(
      "agent:import-attachments",
    ),
    discardDraftAttachment: request<AgentIpcRequest<string>, void>()("agent:discard-draft-attachment"),
    downloadAttachments: request<AgentIpcRequest<DownloadAttachmentsInput>, void>()("agent:download-attachments"),
    openAttachment: request<AgentIpcRequest<OpenAttachmentInput>, void>()("agent:open-attachment"),
    openSharedFile: request<AgentIpcRequest<OpenSharedFileInput>, void>()("agent:open-shared-file"),
    openWorkspaceFile: request<AgentIpcRequest<OpenWorkspaceFileInput>, void>()("agent:open-workspace-file"),
    previewSharedFile: request<AgentIpcRequest<OpenSharedFileInput>, FilePreview>()("agent:preview-shared-file"),
    previewWorkspaceFile: request<AgentIpcRequest<OpenWorkspaceFileInput>, FilePreview>()(
      "agent:preview-workspace-file",
    ),
  },
  browser: {
    open: request<BrowserOpenInput, BrowserTab>()("browser:open"),
    activate: request<string, void>()("browser:activate"),
    navigate: request<BrowserNavigateInput, void>()("browser:navigate"),
    reload: request<string, void>()("browser:reload"),
    close: request<string, void>()("browser:close"),
    listTabs: request<undefined, BrowserTab[]>()("browser:list-tabs"),
    getDisplayState: request<undefined, BrowserDisplayState>()("browser:get-display-state"),
    getControlState: request<undefined, BrowserControlState>()("browser:get-control-state"),
    capturePreview: request<string, BrowserPreview>()("browser:capture-preview"),
    setVisible: request<BrowserVisibilityInput, void>()("browser:set-visible"),
    startLiveView: request<string, void>()("browser:start-live-view"),
    stopLiveView: request<undefined, void>()("browser:stop-live-view"),
    // The one untyped endpoint. The renderer sends `BrowserLiveViewInput` and main reads the wire
    // `BrowserViewInput`, which differ on purpose (see `ipc-browser.ts`); main's wire decoder fills the rest.
    sendLiveViewInput: untypedRequest("browser:send-live-view-input"),
    liveViewEvent: event<BrowserLiveViewEvent>()("browser:live-view-event"),
    displayStateEvent: event<BrowserDisplayState>()("browser:display-state-event"),
    pictureInPictureOpen: request<BrowserBounds | undefined, BrowserBounds>()("browser:picture-in-picture-open"),
    pictureInPictureClose: request<undefined, void>()("browser:picture-in-picture-close"),
    pictureInPictureDock: request<undefined, void>()("browser:picture-in-picture-dock"),
    pictureInPictureHide: request<undefined, void>()("browser:picture-in-picture-hide"),
    pictureInPictureEvent: event<BrowserPictureInPictureEvent>()("browser:picture-in-picture-event"),
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
    updateMember: request<AgentIpcRequest<UpdateTeamMemberInput>, TeamMemberSummary>()("servers:update-member"),
    removeMember: request<AgentIpcRequest<string>, void>()("servers:remove-member"),
    listInvites: request<string, TeamInviteSummary[]>()("servers:list-invites"),
    revokeInvite: request<AgentIpcRequest<string>, void>()("servers:revoke-invite"),
    createInvite: request<AgentIpcRequest<CreateTeamInviteInput>, InviteSummary>()("servers:create-invite"),
    setTyping: request<SetTeamTypingInput, void>()("servers:set-typing"),
    presence: event<ScopedTeamPresenceSnapshot>()("servers:presence"),
    listDirectThreads: request<undefined, DirectThreadSummary[]>()("servers:list-direct-threads"),
    readDirectConversation: request<string, DirectConversationSnapshot>()("servers:read-direct-conversation"),
    readDirectConversationPage: request<ReadDirectConversationPageInput, DirectConversationPage>()(
      "servers:read-direct-conversation-page",
    ),
    sendDirectMessage: request<SendDirectMessageInput, DirectMessage>()("servers:send-direct-message"),
    markDirectRead: request<MarkDirectReadInput, DirectConversationReadState>()("servers:mark-direct-read"),
    setDirectTyping: request<DirectTypingInput, void>()("servers:set-direct-typing"),
    directMessage: event<ScopedDirectMessageEvent>()("servers:direct-message"),
    directTyping: event<ScopedDirectTypingEvent>()("servers:direct-typing"),
    event: event<ServerSummary[]>()("servers:event"),
    invite: event<string>()("servers:invite"),
  },
  // A separate group, not part of `servers`: a group is what one registrar covers in full, and
  // `servers` is bound against `RemoteServerManager` while these are bound against `AgentService`.
  mcpServers: {
    list: request<AgentIpcRequest<null>, McpServerConfig[]>()("servers:mcp:list"),
    save: request<AgentIpcRequest<SaveMcpServerInput>, McpServerConfig[]>()("servers:mcp:save"),
    remove: request<AgentIpcRequest<RemoveMcpServerInput>, McpServerConfig[]>()("servers:mcp:remove"),
    setEnabled: request<AgentIpcRequest<SetMcpServerEnabledInput>, McpServerConfig[]>()("servers:mcp:set-enabled"),
    test: request<AgentIpcRequest<TestMcpServerInput>, McpTestResult>()("servers:mcp:test"),
  },
  // Bound against the storage service, not `AgentService`, so it is its own group.
  storage: {
    getUsage: request<AgentIpcRequest<GetStorageUsageInput>, StorageUsage | null>()("storage:get-usage"),
    deleteFile: request<AgentIpcRequest<DeleteStoredFileInput>, void>()("storage:delete-file"),
    clear: request<AgentIpcRequest<ClearStorageInput>, void>()("storage:clear"),
    openFile: request<AgentIpcRequest<OpenStoredFileInput>, void>()("storage:open-file"),
    openLocation: request<OpenStorageLocationInput, void>()("storage:open-location"),
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
    event: event<HostStatus>()("host:event"),
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

// What a typed endpoint looks like to the renderer. A server-scoped payload loses its scope, because
// the preload adds the selected server; a scope that carries nothing takes no argument.
type ArgsOf<Payload> = [Payload] extends [undefined]
  ? []
  : [Payload] extends [AgentIpcRequest<infer Inner>]
    ? [Inner] extends [null]
      ? []
      : [input: Inner]
    : [input: Payload];

/**
 * The `OpenBotDesktopApi` signature of a typed request, so a method that passes its input straight
 * through takes its types from the endpoint instead of repeating them. An untyped endpoint is `never`.
 */
export type Invoke<Endpoint> =
  Endpoint extends RequestEndpoint<string, infer Payload, infer Result>
    ? [Payload] extends [Untyped]
      ? never
      : (...args: ArgsOf<Payload>) => Promise<Result>
    : never;

/** The `OpenBotDesktopApi` subscription to a typed event. It answers the unsubscribe call. */
export type Subscribe<Endpoint> =
  Endpoint extends EventEndpoint<string, infer Payload>
    ? (listener: [Payload] extends [undefined] ? () => void : (payload: Payload) => void) => () => void
    : never;
