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
import type { AgentImportPreview, AgentImportResult, ApplyAgentImportInput } from "./ipc-agent-import";
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
  AgentTemplateDetail,
  AgentTemplatePreview,
  AgentTemplatePublication,
  InstallAgentTemplateInput,
  InstallAgentTemplateResult,
  PublishAgentTemplateInput,
} from "./ipc-agent-templates";
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
declare const serverArgument: unique symbol;

/**
 * The payload and result of an endpoint that has no types. The main binder and the preload accept
 * anything for it. Only `browser.sendLiveViewInput` uses it: see the comment at that endpoint.
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
     * Starts a sign-in the user finishes on another device, for a provider whose descriptor says
     * `codeSignIn`. Cancel it with `cancelProviderCodeLogin`; leaving it running holds one provider
     * process open until the code expires.
     */
    startProviderCodeLogin: request<AgentProviderId, ProviderCodeLoginStart>()("app:start-provider-code-login"),
    /** Abandons a code sign-in: the provider is told, the code is dead, and the provider goes idle. */
    cancelProviderCodeLogin: request<AgentProviderId, AgentStatus>()("app:cancel-provider-code-login"),
  },
  providerRuntimes: {
    getStatus: request<undefined, ProviderRuntimeSnapshot>()("provider-runtimes:get-status"),
    download: request<ManagedProviderId, ProviderRuntimeSnapshot>()("provider-runtimes:download"),
    cancel: request<ManagedProviderId, ProviderRuntimeSnapshot>()("provider-runtimes:cancel"),
    /** Asks each provider's upstream for its latest release. Rejects when no source answered. */
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
    getAnalytics: scopedRequest<AgentAnalyticsInput, AgentAnalytics | null, "required">()("agent:get-analytics"),
    getHostAnalytics: scopedRequest<HostAnalyticsInput, HostAnalytics | null, "required">()("host:get-analytics"),
    getUsage: scopedRequest<string | undefined, AccountUsage>()("agent:get-usage"),
    listModels: scopedQuery<AgentModelOption[]>()("agent:list-models"),
    listAgents: scopedQuery<AgentSummary[]>()("agent:list"),
    listInstalledSkills: scopedRequest<string, InstalledSkill[]>()("agent:list-installed-skills"),
    listChannels: scopedQuery<ChannelSummary[]>()("agent:channels:list"),
    readChannel: scopedRequest<ChannelReadInput, ChannelPage>()("agent:channels:read"),
    channelCommand: scopedRequest<ChannelCommand, Channel>()("agent:channels:command"),
    deleteChannel: scopedRequest<string, void>()("agent:channels:delete"),
    getSidebarLayout: scopedQuery<SidebarLayoutSnapshot>()("agent:get-sidebar-layout"),
    mutateSidebarLayout: scopedRequest<SidebarLayoutAction, SidebarLayoutSnapshot>()("agent:mutate-sidebar-layout"),
    generateProfile: scopedRequest<GenerateAgentProfileInput, AgentProfileDraft>()("agent:generate-profile"),
    saveProfile: scopedRequest<SaveAgentProfileInput, SaveAgentProfileResult>()("agent:save-profile"),
    createAgent: scopedRequest<CreateAgentInput, AgentSummary>()("agent:create"),
    duplicateAgent: scopedRequest<string, DuplicateAgentResult>()("agent:duplicate"),
    updateAgent: scopedRequest<UpdateAgentInput, AgentSummary>()("agent:update"),
    setAvatar: scopedRequest<SetAgentAvatarInput, AgentSummary>()("agent:set-avatar"),
    deleteAgent: scopedRequest<string, void>()("agent:delete"),
    readConversation: scopedRequest<string, ConversationWithReadState>()("agent:read-conversation"),
    readConversationPage: scopedRequest<ReadConversationPageInput, ConversationPage>()("agent:read-conversation-page"),
    searchConversationMessages: scopedRequest<SearchConversationMessagesInput, ConversationSearchPage>()(
      "agent:search-conversation-messages",
    ),
    listConversationReads: scopedQuery<Record<string, ConversationReadState>>()("agent:list-conversation-reads"),
    markConversationRead: scopedRequest<MarkConversationReadInput, ConversationReadState>()(
      "agent:mark-conversation-read",
    ),
    sendMessage: scopedRequest<SendMessageInput, QueuedMessageReceipt>()("agent:send-message"),
    setMessageReaction: scopedRequest<SetMessageReactionInput, void>()("agent:set-message-reaction"),
    listQueue: scopedRequest<string, QueueSnapshot>()("agent:list-queue"),
    acknowledgeFailedTurn: scopedRequest<AcknowledgeFailedTurnInput, void>()("agent:acknowledge-failed-turn"),
    cancelQueuedMessage: scopedRequest<CancelQueuedMessageInput, void>()("agent:cancel-queued-message"),
    steerQueuedMessage: scopedRequest<SteerQueuedMessageInput, void>()("agent:steer-queued-message"),
    editQueuedMessage: scopedRequest<EditQueuedMessageInput, QueueSnapshot>()("agent:edit-queued-message"),
    updateQueuedMessage: scopedRequest<UpdateQueuedMessageInput, void>()("agent:update-queued-message"),
    reorderQueue: scopedRequest<ReorderQueueInput, void>()("agent:reorder-queue"),
    interrupt: scopedRequest<InterruptTurnInput, void>()("agent:interrupt"),
    respondToPrompt: scopedRequest<RespondToPromptInput, void>()("agent:respond-to-prompt"),
    respondToApproval: scopedRequest<RespondToApprovalInput, void>()("agent:respond-to-approval"),
    respondToBrowserSecret: scopedRequest<RespondToBrowserSecretInput, void>()("agent:respond-to-browser-secret"),
    respondToBrowserTakeover: scopedRequest<RespondToBrowserTakeoverInput, void>()("agent:respond-to-browser-takeover"),
    scopedEvent: event<ScopedAgentEvent>()("agent:event"),
  },
  agentMemories: {
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
  agentAttachments: {
    chooseAttachments: scopedRequest<ChooseAttachmentsInput, DraftAttachment[]>()("agent:choose-attachments"),
    discardDraftAttachment: scopedRequest<string, void>()("agent:discard-draft-attachment"),
    downloadAttachments: scopedRequest<DownloadAttachmentsInput, void>()("agent:download-attachments"),
    openAttachment: scopedRequest<OpenAttachmentInput, void>()("agent:open-attachment"),
    openSharedFile: scopedRequest<OpenSharedFileInput, void>()("agent:open-shared-file"),
    openWorkspaceFile: scopedRequest<OpenWorkspaceFileInput, void>()("agent:open-workspace-file"),
    previewSharedFile: scopedRequest<OpenSharedFileInput, FilePreview>()("agent:preview-shared-file"),
    previewWorkspaceFile: scopedRequest<OpenWorkspaceFileInput, FilePreview>()("agent:preview-workspace-file"),
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
    updateMember: scopedRequest<UpdateTeamMemberInput, TeamMemberSummary>()("servers:update-member"),
    removeMember: scopedRequest<string, void>()("servers:remove-member"),
    listInvites: request<string, TeamInviteSummary[]>()("servers:list-invites"),
    revokeInvite: scopedRequest<string, void>()("servers:revoke-invite"),
    createInvite: scopedRequest<CreateTeamInviteInput, InviteSummary>()("servers:create-invite"),
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
  },
  // Bound against the storage service, not `AgentService`, so it is its own group.
  storage: {
    getUsage: scopedRequest<GetStorageUsageInput, StorageUsage | null, "required">()("storage:get-usage"),
    deleteFile: scopedRequest<DeleteStoredFileInput, void, "required">()("storage:delete-file"),
    clear: scopedRequest<ClearStorageInput, void, "required">()("storage:clear"),
    openFile: scopedRequest<OpenStoredFileInput, void, "required">()("storage:open-file"),
    openLocation: request<OpenStorageLocationInput, void>()("storage:open-location"),
  },
  // Bound against the agent import service, which holds the staged archives.
  agentImport: {
    choose: request<undefined, AgentImportPreview | null>()("agent-import:choose"),
    apply: request<ApplyAgentImportInput, AgentImportResult>()("agent-import:apply"),
    discard: request<string, void>()("agent-import:discard"),
    // The export skill for a user who sets up the export agent in Grok Bot by hand. Main reads it
    // from the app's resources, and `saveSkill` asks where to write it.
    readSkill: request<undefined, string>()("agent-import:read-skill"),
    saveSkill: request<undefined, ExportResult>()("agent-import:save-skill"),
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

/** The runtime twin of `GroupApi`'s method names, for the preload bridge and the test harness. */
export function groupApiMethodName(key: string, endpoint: IpcEndpoint): string {
  return endpoint.kind === "event" ? `on${key.charAt(0).toUpperCase()}${key.slice(1)}` : key;
}
