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

import type { AgentIpcRequest } from "./ipc-agent-events";
import type {
  AgentMemory,
  CreateAgentMemoryInput,
  DeleteAgentMemoryInput,
  UpdateAgentMemoryInput,
} from "./ipc-agent-memories";
import type { ExportResult } from "./ipc-app-auth";
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
import type {
  CustomProviderResult,
  CustomProviderSummary,
  DeleteCustomProviderInput,
  SaveCustomProviderInput,
} from "./ipc-custom-providers";
import type {
  DeleteHostedSiteInput,
  HostedSiteSummary,
  PublishHostedSiteInput,
  ReplaceHostedSiteInput,
} from "./ipc-hosted-sites";
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
import type { VoiceModelStatus, VoiceTranscriptionInput, VoiceTranscriptionResult } from "./ipc-voice";

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
    getAppInfo: untypedRequest(IPC_CHANNELS.getAppInfo),
    getSetupState: untypedRequest(IPC_CHANNELS.getSetupState),
    saveSetup: untypedRequest(IPC_CHANNELS.saveSetup),
    getAnalyticsPreference: untypedRequest(IPC_CHANNELS.getAnalyticsPreference),
    setAnalyticsPreference: untypedRequest(IPC_CHANNELS.setAnalyticsPreference),
    getApprovalAutomation: untypedRequest(IPC_CHANNELS.getApprovalAutomation),
    setApprovalAutomation: untypedRequest(IPC_CHANNELS.setApprovalAutomation),
    getAppLanguagePreference: untypedRequest(IPC_CHANNELS.getAppLanguagePreference),
    setAppLanguagePreference: untypedRequest(IPC_CHANNELS.setAppLanguagePreference),
    // Every window draws its own text, so the choice is broadcast rather than returned: the
    // Dynamic Island overlay has no Settings of its own and would otherwise stay in the old
    // language until it was next recreated.
    appLanguagePreference: untypedEvent(IPC_CHANNELS.appLanguagePreference),
    // The native Preferences menu item and its shortcut live in main, while the dialog lives in
    // the renderer, so the menu click is broadcast rather than handled: every window opens its
    // own Settings.
    openSettings: untypedEvent(IPC_CHANNELS.openSettings),
    openExternal: untypedRequest(IPC_CHANNELS.openExternal),
    openUrl: untypedRequest(IPC_CHANNELS.openUrl),
  },
  maintenance: {
    exportData: request<undefined, ExportResult>()(IPC_CHANNELS.maintenanceExportData),
    exportDiagnostics: request<undefined, ExportResult>()(IPC_CHANNELS.maintenanceExportDiagnostics),
  },
  providers: {
    connectProvider: untypedRequest(IPC_CHANNELS.connectProvider),
    refreshAgentProviders: untypedRequest(IPC_CHANNELS.refreshAgentProviders),
    updateProviderCli: untypedRequest(IPC_CHANNELS.updateProviderCli),
    setProviderApiKey: untypedRequest(IPC_CHANNELS.setProviderApiKey),
    clearProviderApiKey: untypedRequest(IPC_CHANNELS.clearProviderApiKey),
    getProviderApiKeyState: untypedRequest(IPC_CHANNELS.getProviderApiKeyState),
    startProviderCodeLogin: untypedRequest(IPC_CHANNELS.startProviderCodeLogin),
    cancelProviderCodeLogin: untypedRequest(IPC_CHANNELS.cancelProviderCodeLogin),
  },
  providerRuntimes: {
    getStatus: untypedRequest(IPC_CHANNELS.providerRuntimesGetStatus),
    download: untypedRequest(IPC_CHANNELS.providerRuntimesDownload),
    cancel: untypedRequest(IPC_CHANNELS.providerRuntimesCancel),
    checkForUpdates: untypedRequest(IPC_CHANNELS.providerRuntimesCheckForUpdates),
    event: untypedEvent(IPC_CHANNELS.providerRuntimesEvent),
  },
  voice: {
    getModelStatus: request<undefined, VoiceModelStatus>()(IPC_CHANNELS.voiceGetModelStatus),
    prepareModel: request<undefined, VoiceModelStatus>()(IPC_CHANNELS.voicePrepareModel),
    transcribe: request<VoiceTranscriptionInput, VoiceTranscriptionResult>()(IPC_CHANNELS.voiceTranscribe),
    modelStatus: event<VoiceModelStatus>()(IPC_CHANNELS.voiceModelStatus),
  },
  dynamicIsland: {
    getPreference: untypedRequest(IPC_CHANNELS.dynamicIslandGetPreference),
    setPreference: untypedRequest(IPC_CHANNELS.dynamicIslandSetPreference),
    publishPresentation: untypedRequest(IPC_CHANNELS.dynamicIslandPublishPresentation),
    getPresentation: untypedRequest(IPC_CHANNELS.dynamicIslandGetPresentation),
    presentation: untypedEvent(IPC_CHANNELS.dynamicIslandPresentation),
    preference: untypedEvent(IPC_CHANNELS.dynamicIslandPreference),
    geometry: untypedEvent(IPC_CHANNELS.dynamicIslandGeometry),
    performAction: untypedRequest(IPC_CHANNELS.dynamicIslandPerformAction),
    performHaptic: untypedRequest(IPC_CHANNELS.dynamicIslandPerformHaptic),
    action: untypedEvent(IPC_CHANNELS.dynamicIslandAction),
    setInteractive: untypedRequest(IPC_CHANNELS.dynamicIslandSetInteractive),
  },
  computerUse: {
    getState: untypedRequest(IPC_CHANNELS.computerUseGetState),
    openPermissionPane: untypedRequest(IPC_CHANNELS.computerUseOpenPermissionPane),
    closePermissionHelp: untypedRequest(IPC_CHANNELS.computerUseClosePermissionHelp),
    getPermissionApp: untypedRequest(IPC_CHANNELS.computerUseGetPermissionApp),
    startPermissionAppDrag: untypedRequest(IPC_CHANNELS.computerUseStartPermissionAppDrag),
    revealPermissionApp: untypedRequest(IPC_CHANNELS.computerUseRevealPermissionApp),
    highlightPlacement: untypedEvent(IPC_CHANNELS.computerUseHighlightPlacement),
  },
  skills: {
    localList: untypedRequest(IPC_CHANNELS.skillsLocalList),
    localGet: untypedRequest(IPC_CHANNELS.skillsLocalGet),
    localCreate: untypedRequest(IPC_CHANNELS.skillsLocalCreate),
    localRevise: untypedRequest(IPC_CHANNELS.skillsLocalRevise),
    localInstall: untypedRequest(IPC_CHANNELS.skillsLocalInstall),

    list: untypedRequest(IPC_CHANNELS.skillsList),
    get: untypedRequest(IPC_CHANNELS.skillsGet),
    listMine: untypedRequest(IPC_CHANNELS.skillsListMine),
    choosePackage: untypedRequest(IPC_CHANNELS.skillsChoosePackage),
    submit: untypedRequest(IPC_CHANNELS.skillsSubmit),
    listInstalled: untypedRequest(IPC_CHANNELS.skillsListInstalled),
    install: untypedRequest(IPC_CHANNELS.skillsInstall),
    uninstall: untypedRequest(IPC_CHANNELS.skillsUninstall),
    setEnabled: untypedRequest(IPC_CHANNELS.skillsSetEnabled),
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
    list: untypedRequest(IPC_CHANNELS.marketplaceAgentsList),
    get: untypedRequest(IPC_CHANNELS.marketplaceAgentsGet),
    listMine: untypedRequest(IPC_CHANNELS.marketplaceAgentsListMine),
    preview: untypedRequest(IPC_CHANNELS.marketplaceAgentsPreview),
    submit: untypedRequest(IPC_CHANNELS.marketplaceAgentsSubmit),
    install: untypedRequest(IPC_CHANNELS.marketplaceAgentsInstall),
  },
  auth: {
    getState: untypedRequest(IPC_CHANNELS.authGetState),
    retry: untypedRequest(IPC_CHANNELS.authRetry),
    requestEmailCode: untypedRequest(IPC_CHANNELS.authRequestEmailCode),
    verifyEmailCode: untypedRequest(IPC_CHANNELS.authVerifyEmailCode),
    updateName: untypedRequest(IPC_CHANNELS.authUpdateName),
    updateAvatar: untypedRequest(IPC_CHANNELS.authUpdateAvatar),
    createMobileConnect: untypedRequest(IPC_CHANNELS.authCreateMobileConnect),
    listMobileConnectedDevices: untypedRequest(IPC_CHANNELS.authListMobileConnectedDevices),
    listAccountSessions: untypedRequest(IPC_CHANNELS.authListAccountSessions),
    revokeAccountSession: untypedRequest(IPC_CHANNELS.authRevokeAccountSession),
    revokeMobileConnectedDevice: untypedRequest(IPC_CHANNELS.authRevokeMobileConnectedDevice),
    logout: untypedRequest(IPC_CHANNELS.authLogout),
    event: untypedEvent(IPC_CHANNELS.authEvent),
  },
  update: {
    getStatus: untypedRequest(IPC_CHANNELS.updateGetStatus),
    check: untypedRequest(IPC_CHANNELS.updateCheck),
    download: untypedRequest(IPC_CHANNELS.updateDownload),
    install: untypedRequest(IPC_CHANNELS.updateInstall),
    getPreference: untypedRequest(IPC_CHANNELS.updateGetPreference),
    setPreference: untypedRequest(IPC_CHANNELS.updateSetPreference),
    event: untypedEvent(IPC_CHANNELS.updateEvent),
  },
  notifications: {
    getPreference: untypedRequest(IPC_CHANNELS.notificationsGetPreference),
    setPreference: untypedRequest(IPC_CHANNELS.notificationsSetPreference),
    test: untypedRequest(IPC_CHANNELS.notificationsTest),
    openSettings: untypedRequest(IPC_CHANNELS.notificationsOpenSettings),
    openedEvent: untypedEvent(IPC_CHANNELS.notificationsOpenedEvent),
  },
  agent: {
    getStatus: untypedRequest(IPC_CHANNELS.agentGetStatus),
    getAnalytics: untypedRequest(IPC_CHANNELS.agentGetAnalytics),
    getHostAnalytics: untypedRequest(IPC_CHANNELS.hostGetAnalytics),
    getUsage: untypedRequest(IPC_CHANNELS.agentGetUsage),
    listModels: untypedRequest(IPC_CHANNELS.agentListModels),
    list: untypedRequest(IPC_CHANNELS.agentList),
    listInstalledSkills: untypedRequest(IPC_CHANNELS.agentListInstalledSkills),
    listChannels: untypedRequest(IPC_CHANNELS.agentListChannels),
    readChannel: untypedRequest(IPC_CHANNELS.agentReadChannel),
    channelCommand: untypedRequest(IPC_CHANNELS.agentChannelCommand),
    deleteChannel: untypedRequest(IPC_CHANNELS.agentDeleteChannel),
    getSidebarLayout: untypedRequest(IPC_CHANNELS.agentGetSidebarLayout),
    mutateSidebarLayout: untypedRequest(IPC_CHANNELS.agentMutateSidebarLayout),
    generateProfile: untypedRequest(IPC_CHANNELS.agentGenerateProfile),
    saveProfile: untypedRequest(IPC_CHANNELS.agentSaveProfile),
    create: untypedRequest(IPC_CHANNELS.agentCreate),
    duplicate: untypedRequest(IPC_CHANNELS.agentDuplicate),
    update: untypedRequest(IPC_CHANNELS.agentUpdate),
    setAvatar: untypedRequest(IPC_CHANNELS.agentSetAvatar),
    delete: untypedRequest(IPC_CHANNELS.agentDelete),
    readConversation: untypedRequest(IPC_CHANNELS.agentReadConversation),
    readConversationPage: untypedRequest(IPC_CHANNELS.agentReadConversationPage),
    searchConversationMessages: untypedRequest(IPC_CHANNELS.agentSearchConversationMessages),
    listConversationReads: untypedRequest(IPC_CHANNELS.agentListConversationReads),
    markConversationRead: untypedRequest(IPC_CHANNELS.agentMarkConversationRead),
    sendMessage: untypedRequest(IPC_CHANNELS.agentSendMessage),
    setMessageReaction: untypedRequest(IPC_CHANNELS.agentSetMessageReaction),
    listQueue: untypedRequest(IPC_CHANNELS.agentListQueue),
    acknowledgeFailedTurn: untypedRequest(IPC_CHANNELS.agentAcknowledgeFailedTurn),
    cancelQueuedMessage: untypedRequest(IPC_CHANNELS.agentCancelQueuedMessage),
    steerQueuedMessage: untypedRequest(IPC_CHANNELS.agentSteerQueuedMessage),
    editQueuedMessage: untypedRequest(IPC_CHANNELS.agentEditQueuedMessage),
    updateQueuedMessage: untypedRequest(IPC_CHANNELS.agentUpdateQueuedMessage),
    reorderQueue: untypedRequest(IPC_CHANNELS.agentReorderQueue),
    interrupt: untypedRequest(IPC_CHANNELS.agentInterrupt),
    respondToPrompt: untypedRequest(IPC_CHANNELS.agentRespondToPrompt),
    respondToApproval: untypedRequest(IPC_CHANNELS.agentRespondToApproval),
    respondToBrowserSecret: untypedRequest(IPC_CHANNELS.agentRespondToBrowserSecret),
    respondToBrowserTakeover: untypedRequest(IPC_CHANNELS.agentRespondToBrowserTakeover),
    event: untypedEvent(IPC_CHANNELS.agentEvent),
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
    chooseAttachments: untypedRequest(IPC_CHANNELS.agentChooseAttachments),
    importAttachments: untypedRequest(IPC_CHANNELS.agentImportAttachments),
    discardDraftAttachment: untypedRequest(IPC_CHANNELS.agentDiscardDraftAttachment),
    downloadAttachments: untypedRequest(IPC_CHANNELS.agentDownloadAttachments),
    openAttachment: untypedRequest(IPC_CHANNELS.agentOpenAttachment),
    openSharedFile: untypedRequest(IPC_CHANNELS.agentOpenSharedFile),
    openWorkspaceFile: untypedRequest(IPC_CHANNELS.agentOpenWorkspaceFile),
    previewSharedFile: untypedRequest(IPC_CHANNELS.agentPreviewSharedFile),
    previewWorkspaceFile: untypedRequest(IPC_CHANNELS.agentPreviewWorkspaceFile),
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
    list: untypedRequest(IPC_CHANNELS.serversListMcpServers),
    save: untypedRequest(IPC_CHANNELS.serversSaveMcpServer),
    remove: untypedRequest(IPC_CHANNELS.serversRemoveMcpServer),
    setEnabled: untypedRequest(IPC_CHANNELS.serversSetMcpServerEnabled),
    test: untypedRequest(IPC_CHANNELS.serversTestMcpServer),
  },
  // Bound against the storage service, not `AgentService`, so it is its own group.
  storage: {
    getUsage: untypedRequest(IPC_CHANNELS.storageGetUsage),
    deleteFile: untypedRequest(IPC_CHANNELS.storageDeleteFile),
    clear: untypedRequest(IPC_CHANNELS.storageClear),
    openFile: untypedRequest(IPC_CHANNELS.storageOpenFile),
    openLocation: untypedRequest(IPC_CHANNELS.storageOpenLocation),
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
