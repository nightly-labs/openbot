// The one channel list, given structure. `ipc-channels.ts` still holds every wire value; this file
// says which group each channel belongs to and whether it is a request the renderer invokes or an
// event the main process sends. That is what lets a registrar bind its handlers as an object keyed
// by endpoint, so a channel with no handler, and a handler for a channel that was never declared,
// are both compile errors instead of a runtime rejection nobody sees until a user hits the feature.
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
import { IPC_CHANNELS } from "./ipc-channels";
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
import type { VoiceModelStatus, VoiceTranscriptionInput, VoiceTranscriptionResult } from "./ipc-voice";
import type { AccountSession, MobileConnectedDevice, MobileConnectTicket } from "./mobile-connect";

declare const payloadType: unique symbol;
declare const resultType: unique symbol;
declare const untypedBrand: unique symbol;

/**
 * The payload and result of an endpoint whose group is not typed yet. The main binder and the
 * preload accept anything for it, as they did before endpoints had types. It goes away when the last
 * group is typed.
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
// would widen the channel to `string`, and the coverage assertion at the bottom needs the literal.
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

function untypedEvent<Channel extends string>(channel: Channel): EventEndpoint<Channel, Untyped> {
  return { kind: "event", channel };
}

export const IPC_ENDPOINTS = {
  app: {
    getAppInfo: request<undefined, AppInfo>()(IPC_CHANNELS.getAppInfo),
    getSetupState: request<undefined, AppSetupState>()(IPC_CHANNELS.getSetupState),
    saveSetup: request<SaveSetupInput, AppSetupState>()(IPC_CHANNELS.saveSetup),
    getAnalyticsPreference: request<undefined, AnalyticsPreference>()(IPC_CHANNELS.getAnalyticsPreference),
    setAnalyticsPreference: request<SetAnalyticsPreferenceInput, AnalyticsPreference>()(
      IPC_CHANNELS.setAnalyticsPreference,
    ),
    getApprovalAutomation: request<undefined, ApprovalAutomationPreference>()(IPC_CHANNELS.getApprovalAutomation),
    setApprovalAutomation: request<SetApprovalAutomationInput, ApprovalAutomationPreference>()(
      IPC_CHANNELS.setApprovalAutomation,
    ),
    getAppLanguagePreference: request<undefined, AppLanguagePreference>()(IPC_CHANNELS.getAppLanguagePreference),
    setAppLanguagePreference: request<SetAppLanguagePreferenceInput, AppLanguagePreference>()(
      IPC_CHANNELS.setAppLanguagePreference,
    ),
    // Every window draws its own text, so the choice is broadcast rather than returned: the
    // Dynamic Island overlay has no Settings of its own and would otherwise stay in the old
    // language until it was next recreated.
    appLanguagePreference: event<AppLanguagePreference>()(IPC_CHANNELS.appLanguagePreference),
    // The native Preferences menu item and its shortcut live in main, while the dialog lives in
    // the renderer, so the menu click is broadcast rather than handled: every window opens its
    // own Settings.
    openSettings: event<undefined>()(IPC_CHANNELS.openSettings),
    openExternal: request<ExternalDestination, void>()(IPC_CHANNELS.openExternal),
    openUrl: request<string, void>()(IPC_CHANNELS.openUrl),
  },
  maintenance: {
    exportData: request<undefined, ExportResult>()(IPC_CHANNELS.maintenanceExportData),
    exportDiagnostics: request<undefined, ExportResult>()(IPC_CHANNELS.maintenanceExportDiagnostics),
  },
  providers: {
    connectProvider: request<AgentProviderId, AgentStatus>()(IPC_CHANNELS.connectProvider),
    refreshAgentProviders: request<undefined, AgentStatus>()(IPC_CHANNELS.refreshAgentProviders),
    updateProviderCli: request<ManagedProviderId, AgentStatus>()(IPC_CHANNELS.updateProviderCli),
    setProviderApiKey: request<SetProviderApiKeyInput, AgentStatus>()(IPC_CHANNELS.setProviderApiKey),
    clearProviderApiKey: request<AgentProviderId, AgentStatus>()(IPC_CHANNELS.clearProviderApiKey),
    getProviderApiKeyState: request<AgentProviderId, ProviderApiKeyState>()(IPC_CHANNELS.getProviderApiKeyState),
    startProviderCodeLogin: request<AgentProviderId, ProviderCodeLoginStart>()(IPC_CHANNELS.startProviderCodeLogin),
    cancelProviderCodeLogin: request<AgentProviderId, AgentStatus>()(IPC_CHANNELS.cancelProviderCodeLogin),
  },
  providerRuntimes: {
    getStatus: request<undefined, ProviderRuntimeSnapshot>()(IPC_CHANNELS.providerRuntimesGetStatus),
    download: request<ManagedProviderId, ProviderRuntimeSnapshot>()(IPC_CHANNELS.providerRuntimesDownload),
    cancel: request<ManagedProviderId, ProviderRuntimeSnapshot>()(IPC_CHANNELS.providerRuntimesCancel),
    checkForUpdates: request<undefined, ProviderRuntimeSnapshot>()(IPC_CHANNELS.providerRuntimesCheckForUpdates),
    event: event<ProviderRuntimeSnapshot>()(IPC_CHANNELS.providerRuntimesEvent),
  },
  voice: {
    getModelStatus: request<undefined, VoiceModelStatus>()(IPC_CHANNELS.voiceGetModelStatus),
    prepareModel: request<undefined, VoiceModelStatus>()(IPC_CHANNELS.voicePrepareModel),
    transcribe: request<VoiceTranscriptionInput, VoiceTranscriptionResult>()(IPC_CHANNELS.voiceTranscribe),
    modelStatus: event<VoiceModelStatus>()(IPC_CHANNELS.voiceModelStatus),
  },
  dynamicIsland: {
    getPreference: request<undefined, DynamicIslandPreference>()(IPC_CHANNELS.dynamicIslandGetPreference),
    setPreference: request<SetDynamicIslandPreferenceInput, DynamicIslandPreference>()(
      IPC_CHANNELS.dynamicIslandSetPreference,
    ),
    publishPresentation: request<DynamicIslandPresentation, void>()(IPC_CHANNELS.dynamicIslandPublishPresentation),
    getPresentation: request<undefined, DynamicIslandPresentation>()(IPC_CHANNELS.dynamicIslandGetPresentation),
    presentation: event<DynamicIslandPresentation>()(IPC_CHANNELS.dynamicIslandPresentation),
    preference: event<DynamicIslandPreference>()(IPC_CHANNELS.dynamicIslandPreference),
    geometry: event<DynamicIslandGeometry>()(IPC_CHANNELS.dynamicIslandGeometry),
    performAction: request<DynamicIslandAction, void>()(IPC_CHANNELS.dynamicIslandPerformAction),
    performHaptic: request<undefined, void>()(IPC_CHANNELS.dynamicIslandPerformHaptic),
    action: event<DynamicIslandAction>()(IPC_CHANNELS.dynamicIslandAction),
    setInteractive: request<SetDynamicIslandInteractiveInput, void>()(IPC_CHANNELS.dynamicIslandSetInteractive),
  },
  computerUse: {
    getState: request<undefined, ComputerUseState>()(IPC_CHANNELS.computerUseGetState),
    openPermissionPane: request<MacPermissionId, ComputerUseState>()(IPC_CHANNELS.computerUseOpenPermissionPane),
    closePermissionHelp: request<undefined, void>()(IPC_CHANNELS.computerUseClosePermissionHelp),
    getPermissionApp: request<undefined, ComputerUsePermissionApp | null>()(IPC_CHANNELS.computerUseGetPermissionApp),
    startPermissionAppDrag: request<undefined, void>()(IPC_CHANNELS.computerUseStartPermissionAppDrag),
    revealPermissionApp: request<undefined, void>()(IPC_CHANNELS.computerUseRevealPermissionApp),
    highlightPlacement: event<ComputerUseHighlightPlacement>()(IPC_CHANNELS.computerUseHighlightPlacement),
  },
  skills: {
    localList: request<undefined, MarketplaceSkillDetail[]>()(IPC_CHANNELS.skillsLocalList),
    localGet: request<LocalSkillRevisionInput, MarketplaceSkillDetail>()(IPC_CHANNELS.skillsLocalGet),
    localCreate: request<CreateLocalSkillInput, MarketplaceSkillDetail>()(IPC_CHANNELS.skillsLocalCreate),
    localRevise: request<ReviseLocalSkillInput, MarketplaceSkillDetail>()(IPC_CHANNELS.skillsLocalRevise),
    localInstall: request<InstallLocalSkillInput, InstalledSkill>()(IPC_CHANNELS.skillsLocalInstall),

    list: request<MarketplaceSkillQuery | undefined, MarketplaceSkillPage>()(IPC_CHANNELS.skillsList),
    get: request<string, MarketplaceSkillDetail>()(IPC_CHANNELS.skillsGet),
    listMine: request<undefined, SkillSubmission[]>()(IPC_CHANNELS.skillsListMine),
    choosePackage: request<undefined, SkillPackagePreview | null>()(IPC_CHANNELS.skillsChoosePackage),
    submit: request<SubmitSkillInput, SkillSubmission>()(IPC_CHANNELS.skillsSubmit),
    listInstalled: request<string, InstalledSkill[]>()(IPC_CHANNELS.skillsListInstalled),
    install: request<InstallSkillInput, InstalledSkill>()(IPC_CHANNELS.skillsInstall),
    uninstall: request<UninstallSkillInput, void>()(IPC_CHANNELS.skillsUninstall),
    setEnabled: request<SetEnabledSkillInput, InstalledSkill>()(IPC_CHANNELS.skillsSetEnabled),
  },
  // No event channel: the renderer is the only writer, and the models a saved endpoint adds arrive
  // through the ready `status` event the provider restart already emits.
  customProviders: {
    list: request<undefined, CustomProviderSummary[]>()(IPC_CHANNELS.customProvidersList),
    save: request<SaveCustomProviderInput, CustomProviderResult>()(IPC_CHANNELS.customProvidersSave),
    delete: request<DeleteCustomProviderInput, CustomProviderResult>()(IPC_CHANNELS.customProvidersDelete),
  },
  hostedSites: {
    list: request<undefined, HostedSiteSummary[]>()(IPC_CHANNELS.hostedSitesList),
    chooseDirectory: request<undefined, string | null>()(IPC_CHANNELS.hostedSitesChooseDirectory),
    publish: request<PublishHostedSiteInput, HostedSiteSummary>()(IPC_CHANNELS.hostedSitesPublish),
    replace: request<ReplaceHostedSiteInput, HostedSiteSummary>()(IPC_CHANNELS.hostedSitesReplace),
    delete: request<DeleteHostedSiteInput, void>()(IPC_CHANNELS.hostedSitesDelete),
  },
  marketplaceAgents: {
    list: request<MarketplaceAgentQuery | undefined, MarketplaceAgentPage>()(IPC_CHANNELS.marketplaceAgentsList),
    get: request<string, MarketplaceAgentDetail>()(IPC_CHANNELS.marketplaceAgentsGet),
    listMine: request<undefined, AgentSubmission[]>()(IPC_CHANNELS.marketplaceAgentsListMine),
    preview: request<string, AgentPublicationPreview>()(IPC_CHANNELS.marketplaceAgentsPreview),
    submit: request<SubmitMarketplaceAgentInput, AgentSubmission>()(IPC_CHANNELS.marketplaceAgentsSubmit),
    install: request<InstallMarketplaceAgentInput, InstallMarketplaceAgentResult>()(
      IPC_CHANNELS.marketplaceAgentsInstall,
    ),
  },
  auth: {
    getState: request<undefined, CentralAuthState>()(IPC_CHANNELS.authGetState),
    retry: request<undefined, CentralAuthState>()(IPC_CHANNELS.authRetry),
    requestEmailCode: request<string, CentralAuthState>()(IPC_CHANNELS.authRequestEmailCode),
    verifyEmailCode: request<VerifyEmailCodeInput, CentralAuthState>()(IPC_CHANNELS.authVerifyEmailCode),
    updateName: request<string, CentralAuthState>()(IPC_CHANNELS.authUpdateName),
    updateAvatar: request<AvatarImageInput | null, CentralAuthState>()(IPC_CHANNELS.authUpdateAvatar),
    createMobileConnect: request<undefined, MobileConnectTicket>()(IPC_CHANNELS.authCreateMobileConnect),
    listMobileConnectedDevices: request<undefined, MobileConnectedDevice[]>()(
      IPC_CHANNELS.authListMobileConnectedDevices,
    ),
    listAccountSessions: request<undefined, AccountSession[]>()(IPC_CHANNELS.authListAccountSessions),
    revokeAccountSession: request<string, void>()(IPC_CHANNELS.authRevokeAccountSession),
    revokeMobileConnectedDevice: request<string, void>()(IPC_CHANNELS.authRevokeMobileConnectedDevice),
    logout: request<undefined, CentralAuthState>()(IPC_CHANNELS.authLogout),
    event: event<CentralAuthState>()(IPC_CHANNELS.authEvent),
  },
  update: {
    getStatus: request<undefined, UpdateStatus>()(IPC_CHANNELS.updateGetStatus),
    check: request<undefined, UpdateStatus>()(IPC_CHANNELS.updateCheck),
    download: request<undefined, UpdateStatus>()(IPC_CHANNELS.updateDownload),
    install: request<undefined, void>()(IPC_CHANNELS.updateInstall),
    getPreference: request<undefined, UpdatePreference>()(IPC_CHANNELS.updateGetPreference),
    setPreference: request<UpdatePreference, UpdatePreference>()(IPC_CHANNELS.updateSetPreference),
    event: event<UpdateStatus>()(IPC_CHANNELS.updateEvent),
  },
  notifications: {
    getPreference: request<undefined, NotificationPreference>()(IPC_CHANNELS.notificationsGetPreference),
    setPreference: request<NotificationPreference, NotificationPreference>()(IPC_CHANNELS.notificationsSetPreference),
    test: request<undefined, void>()(IPC_CHANNELS.notificationsTest),
    openSettings: request<undefined, void>()(IPC_CHANNELS.notificationsOpenSettings),
    openedEvent: event<NotificationOpenedEvent>()(IPC_CHANNELS.notificationsOpenedEvent),
  },
  agent: {
    getStatus: request<AgentIpcRequest<null>, AgentStatus>()(IPC_CHANNELS.agentGetStatus),
    getAnalytics: request<AgentIpcRequest<AgentAnalyticsInput>, AgentAnalytics | null>()(
      IPC_CHANNELS.agentGetAnalytics,
    ),
    getHostAnalytics: request<AgentIpcRequest<HostAnalyticsInput>, HostAnalytics | null>()(
      IPC_CHANNELS.hostGetAnalytics,
    ),
    getUsage: request<AgentIpcRequest<string | undefined>, AccountUsage>()(IPC_CHANNELS.agentGetUsage),
    listModels: request<AgentIpcRequest<null>, AgentModelOption[]>()(IPC_CHANNELS.agentListModels),
    list: request<AgentIpcRequest<null>, AgentSummary[]>()(IPC_CHANNELS.agentList),
    listInstalledSkills: request<AgentIpcRequest<string>, InstalledSkill[]>()(IPC_CHANNELS.agentListInstalledSkills),
    listChannels: request<AgentIpcRequest<null>, ChannelSummary[]>()(IPC_CHANNELS.agentListChannels),
    readChannel: request<AgentIpcRequest<ChannelReadInput>, ChannelPage>()(IPC_CHANNELS.agentReadChannel),
    channelCommand: request<AgentIpcRequest<ChannelCommand>, Channel>()(IPC_CHANNELS.agentChannelCommand),
    deleteChannel: request<AgentIpcRequest<string>, void>()(IPC_CHANNELS.agentDeleteChannel),
    getSidebarLayout: request<AgentIpcRequest<null>, SidebarLayoutSnapshot>()(IPC_CHANNELS.agentGetSidebarLayout),
    mutateSidebarLayout: request<AgentIpcRequest<SidebarLayoutAction>, SidebarLayoutSnapshot>()(
      IPC_CHANNELS.agentMutateSidebarLayout,
    ),
    generateProfile: request<AgentIpcRequest<GenerateAgentProfileInput>, AgentProfileDraft>()(
      IPC_CHANNELS.agentGenerateProfile,
    ),
    saveProfile: request<AgentIpcRequest<SaveAgentProfileInput>, SaveAgentProfileResult>()(
      IPC_CHANNELS.agentSaveProfile,
    ),
    create: request<AgentIpcRequest<CreateAgentInput>, AgentSummary>()(IPC_CHANNELS.agentCreate),
    duplicate: request<AgentIpcRequest<string>, DuplicateAgentResult>()(IPC_CHANNELS.agentDuplicate),
    update: request<AgentIpcRequest<UpdateAgentInput>, AgentSummary>()(IPC_CHANNELS.agentUpdate),
    setAvatar: request<AgentIpcRequest<SetAgentAvatarInput>, AgentSummary>()(IPC_CHANNELS.agentSetAvatar),
    delete: request<AgentIpcRequest<string>, void>()(IPC_CHANNELS.agentDelete),
    readConversation: request<AgentIpcRequest<string>, ConversationWithReadState>()(IPC_CHANNELS.agentReadConversation),
    readConversationPage: request<AgentIpcRequest<ReadConversationPageInput>, ConversationPage>()(
      IPC_CHANNELS.agentReadConversationPage,
    ),
    searchConversationMessages: request<AgentIpcRequest<SearchConversationMessagesInput>, ConversationSearchPage>()(
      IPC_CHANNELS.agentSearchConversationMessages,
    ),
    listConversationReads: request<AgentIpcRequest<null>, Record<string, ConversationReadState>>()(
      IPC_CHANNELS.agentListConversationReads,
    ),
    markConversationRead: request<AgentIpcRequest<MarkConversationReadInput>, ConversationReadState>()(
      IPC_CHANNELS.agentMarkConversationRead,
    ),
    sendMessage: request<AgentIpcRequest<SendMessageInput>, QueuedMessageReceipt>()(IPC_CHANNELS.agentSendMessage),
    setMessageReaction: request<AgentIpcRequest<SetMessageReactionInput>, void>()(IPC_CHANNELS.agentSetMessageReaction),
    listQueue: request<AgentIpcRequest<string>, QueueSnapshot>()(IPC_CHANNELS.agentListQueue),
    acknowledgeFailedTurn: request<AgentIpcRequest<AcknowledgeFailedTurnInput>, void>()(
      IPC_CHANNELS.agentAcknowledgeFailedTurn,
    ),
    cancelQueuedMessage: request<AgentIpcRequest<CancelQueuedMessageInput>, void>()(
      IPC_CHANNELS.agentCancelQueuedMessage,
    ),
    steerQueuedMessage: request<AgentIpcRequest<SteerQueuedMessageInput>, void>()(IPC_CHANNELS.agentSteerQueuedMessage),
    editQueuedMessage: request<AgentIpcRequest<EditQueuedMessageInput>, QueueSnapshot>()(
      IPC_CHANNELS.agentEditQueuedMessage,
    ),
    updateQueuedMessage: request<AgentIpcRequest<UpdateQueuedMessageInput>, void>()(
      IPC_CHANNELS.agentUpdateQueuedMessage,
    ),
    reorderQueue: request<AgentIpcRequest<ReorderQueueInput>, void>()(IPC_CHANNELS.agentReorderQueue),
    interrupt: request<AgentIpcRequest<InterruptTurnInput>, void>()(IPC_CHANNELS.agentInterrupt),
    respondToPrompt: request<AgentIpcRequest<RespondToPromptInput>, void>()(IPC_CHANNELS.agentRespondToPrompt),
    respondToApproval: request<AgentIpcRequest<RespondToApprovalInput>, void>()(IPC_CHANNELS.agentRespondToApproval),
    respondToBrowserSecret: request<AgentIpcRequest<RespondToBrowserSecretInput>, void>()(
      IPC_CHANNELS.agentRespondToBrowserSecret,
    ),
    respondToBrowserTakeover: request<AgentIpcRequest<RespondToBrowserTakeoverInput>, void>()(
      IPC_CHANNELS.agentRespondToBrowserTakeover,
    ),
    event: event<ScopedAgentEvent>()(IPC_CHANNELS.agentEvent),
  },
  agentMemories: {
    listMemories: request<AgentIpcRequest<string>, AgentMemory[]>()(IPC_CHANNELS.agentListMemories),
    createMemory: request<AgentIpcRequest<CreateAgentMemoryInput>, AgentMemory>()(IPC_CHANNELS.agentCreateMemory),
    updateMemory: request<AgentIpcRequest<UpdateAgentMemoryInput>, AgentMemory>()(IPC_CHANNELS.agentUpdateMemory),
    deleteMemory: request<AgentIpcRequest<DeleteAgentMemoryInput>, void>()(IPC_CHANNELS.agentDeleteMemory),
    clearMemories: request<AgentIpcRequest<string>, void>()(IPC_CHANNELS.agentClearMemories),
  },
  sharedTables: {
    listTables: request<AgentIpcRequest<null>, SharedTable[]>()(IPC_CHANNELS.sharedListTables),
    deleteTable: request<AgentIpcRequest<DeleteSharedTableInput>, void>()(IPC_CHANNELS.sharedDeleteTable),
  },
  agentRoutines: {
    listRoutines: request<AgentIpcRequest<string>, Routine[]>()(IPC_CHANNELS.agentListRoutines),
    createRoutine: request<AgentIpcRequest<CreateRoutineInput>, Routine>()(IPC_CHANNELS.agentCreateRoutine),
    updateRoutine: request<AgentIpcRequest<UpdateRoutineInput>, Routine>()(IPC_CHANNELS.agentUpdateRoutine),
    deleteRoutine: request<AgentIpcRequest<DeleteRoutineInput>, void>()(IPC_CHANNELS.agentDeleteRoutine),
    testRoutine: request<AgentIpcRequest<TestRoutineInput>, RoutineRun>()(IPC_CHANNELS.agentTestRoutine),
    listRoutineRuns: request<AgentIpcRequest<ListRoutineRunsInput>, RoutineRun[]>()(IPC_CHANNELS.agentListRoutineRuns),
  },
  channelMemories: {
    listChannelMemories: request<AgentIpcRequest<string>, ChannelMemory[]>()(IPC_CHANNELS.agentListChannelMemories),
    createChannelMemory: request<AgentIpcRequest<CreateChannelMemoryInput>, ChannelMemory>()(
      IPC_CHANNELS.agentCreateChannelMemory,
    ),
    updateChannelMemory: request<AgentIpcRequest<UpdateChannelMemoryInput>, ChannelMemory>()(
      IPC_CHANNELS.agentUpdateChannelMemory,
    ),
    deleteChannelMemory: request<AgentIpcRequest<DeleteChannelMemoryInput>, void>()(
      IPC_CHANNELS.agentDeleteChannelMemory,
    ),
    clearChannelMemories: request<AgentIpcRequest<string>, void>()(IPC_CHANNELS.agentClearChannelMemories),
  },
  channelRoutines: {
    listChannelRoutines: request<AgentIpcRequest<string>, ChannelRoutine[]>()(IPC_CHANNELS.agentListChannelRoutines),
    createChannelRoutine: request<AgentIpcRequest<CreateChannelRoutineInput>, ChannelRoutine>()(
      IPC_CHANNELS.agentCreateChannelRoutine,
    ),
    updateChannelRoutine: request<AgentIpcRequest<UpdateChannelRoutineInput>, ChannelRoutine>()(
      IPC_CHANNELS.agentUpdateChannelRoutine,
    ),
    deleteChannelRoutine: request<AgentIpcRequest<DeleteChannelRoutineInput>, void>()(
      IPC_CHANNELS.agentDeleteChannelRoutine,
    ),
    testChannelRoutine: request<AgentIpcRequest<TestChannelRoutineInput>, ChannelRoutineRun>()(
      IPC_CHANNELS.agentTestChannelRoutine,
    ),
    listChannelRoutineRuns: request<AgentIpcRequest<ListChannelRoutineRunsInput>, ChannelRoutineRun[]>()(
      IPC_CHANNELS.agentListChannelRoutineRuns,
    ),
  },
  agentAttachments: {
    chooseAttachments: request<AgentIpcRequest<ChooseAttachmentsInput>, DraftAttachment[]>()(
      IPC_CHANNELS.agentChooseAttachments,
    ),
    importAttachments: request<AgentIpcRequest<ImportAttachmentsInput>, DraftAttachment[]>()(
      IPC_CHANNELS.agentImportAttachments,
    ),
    discardDraftAttachment: request<AgentIpcRequest<string>, void>()(IPC_CHANNELS.agentDiscardDraftAttachment),
    downloadAttachments: request<AgentIpcRequest<DownloadAttachmentsInput>, void>()(
      IPC_CHANNELS.agentDownloadAttachments,
    ),
    openAttachment: request<AgentIpcRequest<OpenAttachmentInput>, void>()(IPC_CHANNELS.agentOpenAttachment),
    openSharedFile: request<AgentIpcRequest<OpenSharedFileInput>, void>()(IPC_CHANNELS.agentOpenSharedFile),
    openWorkspaceFile: request<AgentIpcRequest<OpenWorkspaceFileInput>, void>()(IPC_CHANNELS.agentOpenWorkspaceFile),
    previewSharedFile: request<AgentIpcRequest<OpenSharedFileInput>, FilePreview>()(
      IPC_CHANNELS.agentPreviewSharedFile,
    ),
    previewWorkspaceFile: request<AgentIpcRequest<OpenWorkspaceFileInput>, FilePreview>()(
      IPC_CHANNELS.agentPreviewWorkspaceFile,
    ),
  },
  browser: {
    open: untypedRequest(IPC_CHANNELS.browserOpen),
    activate: untypedRequest(IPC_CHANNELS.browserActivate),
    navigate: untypedRequest(IPC_CHANNELS.browserNavigate),
    reload: untypedRequest(IPC_CHANNELS.browserReload),
    close: untypedRequest(IPC_CHANNELS.browserClose),
    listTabs: untypedRequest(IPC_CHANNELS.browserListTabs),
    getDisplayState: untypedRequest(IPC_CHANNELS.browserGetDisplayState),
    getControlState: untypedRequest(IPC_CHANNELS.browserGetControlState),
    capturePreview: untypedRequest(IPC_CHANNELS.browserCapturePreview),
    setVisible: untypedRequest(IPC_CHANNELS.browserSetVisible),
    startLiveView: untypedRequest(IPC_CHANNELS.browserStartLiveView),
    stopLiveView: untypedRequest(IPC_CHANNELS.browserStopLiveView),
    sendLiveViewInput: untypedRequest(IPC_CHANNELS.browserSendLiveViewInput),
    liveViewEvent: untypedEvent(IPC_CHANNELS.browserLiveViewEvent),
    displayStateEvent: untypedEvent(IPC_CHANNELS.browserDisplayStateEvent),
    pictureInPictureOpen: untypedRequest(IPC_CHANNELS.browserPictureInPictureOpen),
    pictureInPictureClose: untypedRequest(IPC_CHANNELS.browserPictureInPictureClose),
    pictureInPictureDock: untypedRequest(IPC_CHANNELS.browserPictureInPictureDock),
    pictureInPictureHide: untypedRequest(IPC_CHANNELS.browserPictureInPictureHide),
    pictureInPictureEvent: untypedEvent(IPC_CHANNELS.browserPictureInPictureEvent),
  },
  servers: {
    list: untypedRequest(IPC_CHANNELS.serversList),
    select: untypedRequest(IPC_CHANNELS.serversSelect),
    reorder: untypedRequest(IPC_CHANNELS.serversReorder),
    setMuted: untypedRequest(IPC_CHANNELS.serversSetMuted),
    setNotificationLevel: untypedRequest(IPC_CHANNELS.serversSetNotificationLevel),
    join: untypedRequest(IPC_CHANNELS.serversJoin),
    previewInvite: untypedRequest(IPC_CHANNELS.serversPreviewInvite),
    takePendingInvite: untypedRequest(IPC_CHANNELS.serversTakePendingInvite),
    login: untypedRequest(IPC_CHANNELS.serversLogin),
    retryConnection: untypedRequest(IPC_CHANNELS.serversRetryConnection),
    remove: untypedRequest(IPC_CHANNELS.serversRemove),
    getPresence: untypedRequest(IPC_CHANNELS.serversGetPresence),
    getPresenceFor: untypedRequest(IPC_CHANNELS.serversGetPresenceFor),
    refreshIdentity: untypedRequest(IPC_CHANNELS.serversRefreshIdentity),
    listMembers: untypedRequest(IPC_CHANNELS.serversListMembers),
    updateMember: untypedRequest(IPC_CHANNELS.serversUpdateMember),
    removeMember: untypedRequest(IPC_CHANNELS.serversRemoveMember),
    listInvites: untypedRequest(IPC_CHANNELS.serversListInvites),
    revokeInvite: untypedRequest(IPC_CHANNELS.serversRevokeInvite),
    createInvite: untypedRequest(IPC_CHANNELS.serversCreateInvite),
    setTyping: untypedRequest(IPC_CHANNELS.serversSetTyping),
    presence: untypedEvent(IPC_CHANNELS.serversPresence),
    listDirectThreads: untypedRequest(IPC_CHANNELS.serversListDirectThreads),
    readDirectConversation: untypedRequest(IPC_CHANNELS.serversReadDirectConversation),
    readDirectConversationPage: untypedRequest(IPC_CHANNELS.serversReadDirectConversationPage),
    sendDirectMessage: untypedRequest(IPC_CHANNELS.serversSendDirectMessage),
    markDirectRead: untypedRequest(IPC_CHANNELS.serversMarkDirectRead),
    setDirectTyping: untypedRequest(IPC_CHANNELS.serversSetDirectTyping),
    directMessage: untypedEvent(IPC_CHANNELS.serversDirectMessage),
    directTyping: untypedEvent(IPC_CHANNELS.serversDirectTyping),
    event: untypedEvent(IPC_CHANNELS.serversEvent),
    invite: untypedEvent(IPC_CHANNELS.serversInvite),
  },
  // A separate group, not part of `servers`: a group is what one registrar covers in full, and
  // `servers` is bound against `RemoteServerManager` while these are bound against `AgentService`.
  mcpServers: {
    list: request<AgentIpcRequest<null>, McpServerConfig[]>()(IPC_CHANNELS.serversListMcpServers),
    save: request<AgentIpcRequest<SaveMcpServerInput>, McpServerConfig[]>()(IPC_CHANNELS.serversSaveMcpServer),
    remove: request<AgentIpcRequest<RemoveMcpServerInput>, McpServerConfig[]>()(IPC_CHANNELS.serversRemoveMcpServer),
    setEnabled: request<AgentIpcRequest<SetMcpServerEnabledInput>, McpServerConfig[]>()(
      IPC_CHANNELS.serversSetMcpServerEnabled,
    ),
    test: request<AgentIpcRequest<TestMcpServerInput>, McpTestResult>()(IPC_CHANNELS.serversTestMcpServer),
  },
  // Bound against the storage service, not `AgentService`, so it is its own group.
  storage: {
    getUsage: request<AgentIpcRequest<GetStorageUsageInput>, StorageUsage | null>()(IPC_CHANNELS.storageGetUsage),
    deleteFile: request<AgentIpcRequest<DeleteStoredFileInput>, void>()(IPC_CHANNELS.storageDeleteFile),
    clear: request<AgentIpcRequest<ClearStorageInput>, void>()(IPC_CHANNELS.storageClear),
    openFile: request<AgentIpcRequest<OpenStoredFileInput>, void>()(IPC_CHANNELS.storageOpenFile),
    openLocation: request<OpenStorageLocationInput, void>()(IPC_CHANNELS.storageOpenLocation),
  },
  // The plugin deep link, its own group because its registrar holds the pending link rather than a
  // service. `takePendingListing` is what a window that finished loading after the link arrived
  // asks for; `openListing` is the same slug pushed to a window that was already there.
  plugins: {
    takePendingListing: request<undefined, string | null>()(IPC_CHANNELS.pluginsTakePendingListing),
    openListing: event<string>()(IPC_CHANNELS.pluginsOpenListing),
  },
  host: {
    getStatus: untypedRequest(IPC_CHANNELS.hostGetStatus),
    configure: untypedRequest(IPC_CHANNELS.hostConfigure),
    updateIdentity: untypedRequest(IPC_CHANNELS.hostUpdateIdentity),
    getPresence: untypedRequest(IPC_CHANNELS.hostGetPresence),
    start: untypedRequest(IPC_CHANNELS.hostStart),
    stop: untypedRequest(IPC_CHANNELS.hostStop),
    recheckScreenRecording: untypedRequest(IPC_CHANNELS.hostRecheckScreenRecording),
    listMembers: untypedRequest(IPC_CHANNELS.hostListMembers),
    createInvite: untypedRequest(IPC_CHANNELS.hostCreateInvite),
    listInvites: untypedRequest(IPC_CHANNELS.hostListInvites),
    revokeInvite: untypedRequest(IPC_CHANNELS.hostRevokeInvite),
    updateMember: untypedRequest(IPC_CHANNELS.hostUpdateMember),
    removeMember: untypedRequest(IPC_CHANNELS.hostRemoveMember),
    listSessions: untypedRequest(IPC_CHANNELS.hostListSessions),
    revokeSession: untypedRequest(IPC_CHANNELS.hostRevokeSession),
    event: untypedEvent(IPC_CHANNELS.hostEvent),
  },
  remoteDesktop: {
    checkSetup: untypedRequest(IPC_CHANNELS.remoteDesktopCheckSetup),
    openSetup: untypedRequest(IPC_CHANNELS.remoteDesktopOpenSetup),
    test: untypedRequest(IPC_CHANNELS.remoteDesktopTest),
    list: untypedRequest(IPC_CHANNELS.remoteDesktopList),
    connect: untypedRequest(IPC_CHANNELS.remoteDesktopConnect),
    selectDisplay: untypedRequest(IPC_CHANNELS.remoteDesktopSelectDisplay),
    disconnect: untypedRequest(IPC_CHANNELS.remoteDesktopDisconnect),
    event: untypedEvent(IPC_CHANNELS.remoteDesktopEvent),
  },
} as const;

type ChannelsOf<Group extends IpcEndpointGroup> = Group[keyof Group]["channel"];

/** Every channel some group declares, request or event. */
type GroupedChannel = {
  [Group in keyof typeof IPC_ENDPOINTS]: ChannelsOf<(typeof IPC_ENDPOINTS)[Group]>;
}[keyof typeof IPC_ENDPOINTS];

/** Every channel `IPC_CHANNELS` declares. */
type DeclaredChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

// The two sets have to be equal, and the type checker is what says so, at no runtime cost. A channel
// added to `IPC_CHANNELS` and left out of every group fails this with the channel named in the
// diagnostic; the reverse direction cannot happen, because a group reads its value from
// `IPC_CHANNELS` and a name that is not there is already an error at the reference. Keeping the
// unreachable direction anyway is what makes the assertion readable as "these are the same set"
// rather than as a rule about one of them.
type SameChannels<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : { channelsMissingFromEveryGroup: Exclude<Right, Left> }
  : { channelsNoChannelListDeclares: Exclude<Left, Right> };

// `Coverage` carries no members — `Record<never, Coverage>` is `{}`, so the intersection is the
// manifest and nothing else. The constraint is the whole assertion: it is checked where the argument
// is written, one line down, and `IpcEndpoints` still resolves to the manifest when it fails — one diagnostic naming the channel, rather than every registrar in
// `src/main` breaking at once against an `IpcEndpoints` that had become the failure object. Carrying
// it here rather than in an alias of its own is also what keeps it off the package surface: an
// assertion is referenced by nothing by construction, so a private alias would be `TS6196` under
// `noUnusedLocals` and an exported one would be API that means nothing to an importer.
type CoveredEndpoints<Coverage extends true> = typeof IPC_ENDPOINTS & Record<never, Coverage>;

export type IpcEndpoints = CoveredEndpoints<SameChannels<GroupedChannel, DeclaredChannel>>;

type Endpoints = typeof IPC_ENDPOINTS;
type AnyEndpoint = { [Group in keyof Endpoints]: Endpoints[Group][keyof Endpoints[Group]] }[keyof Endpoints];

// Keyed by wire value, built once, so a lookup is an index rather than an `Extract` over every
// endpoint at each call site.
type RequestsByChannel = { [Endpoint in Extract<AnyEndpoint, { kind: "request" }> as Endpoint["channel"]]: Endpoint };
type EventsByChannel = { [Endpoint in Extract<AnyEndpoint, { kind: "event" }> as Endpoint["channel"]]: Endpoint };

export type RequestChannel = keyof RequestsByChannel;
export type EventChannel = keyof EventsByChannel;

/** What the renderer sends on a request channel. `undefined` when it sends nothing. */
export type PayloadOf<Channel extends RequestChannel> =
  RequestsByChannel[Channel] extends RequestEndpoint<Channel, infer Payload, unknown> ? Payload : never;

/** What main answers on a request channel. */
export type ResultOf<Channel extends RequestChannel> =
  RequestsByChannel[Channel] extends RequestEndpoint<Channel, unknown, infer Result> ? Result : never;

/** What main sends on an event channel. `undefined` when it sends nothing. */
export type EventPayloadOf<Channel extends EventChannel> =
  EventsByChannel[Channel] extends EventEndpoint<Channel, infer Payload> ? Payload : never;

/** Request channels whose group is not typed yet. */
export type UntypedRequestChannel = {
  [Channel in RequestChannel]: [PayloadOf<Channel>] extends [Untyped] ? Channel : never;
}[RequestChannel];

/** Typed request channels whose payload is scoped to one server. */
export type AgentRequestChannel = {
  [Channel in RequestChannel]: PayloadOf<Channel> extends AgentIpcRequest<unknown> ? Channel : never;
}[RequestChannel];

/** The payload inside the server scope of an agent request. */
export type InnerPayloadOf<Channel extends AgentRequestChannel> =
  PayloadOf<Channel> extends AgentIpcRequest<infer Payload> ? Payload : never;

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
    ? [Payload] extends [Untyped]
      ? never
      : (listener: [Payload] extends [undefined] ? () => void : (payload: Payload) => void) => () => void
    : never;
