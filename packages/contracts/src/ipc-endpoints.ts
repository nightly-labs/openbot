// The one channel list, given structure. `ipc-channels.ts` still holds every wire value; this file
// says which group each channel belongs to and whether it is a request the renderer invokes or an
// event the main process sends. That is what lets a registrar bind its handlers as an object keyed
// by endpoint, so a channel with no handler, and a handler for a channel that was never declared,
// are both compile errors instead of a runtime rejection nobody sees until a user hits the feature.
//
// A group is the unit one registrar implements in full. Where a wire prefix spans several registrars
// - `agent:` has four - it is split into one group per registrar, because the exhaustiveness a group
// buys is only worth having when a single object literal can satisfy it.

import { IPC_CHANNELS } from "./ipc-channels";

export interface RequestEndpoint<Channel extends string = string> {
  readonly kind: "request";
  readonly channel: Channel;
}

export interface EventEndpoint<Channel extends string = string> {
  readonly kind: "event";
  readonly channel: Channel;
}

export type IpcEndpoint = RequestEndpoint | EventEndpoint;
export type IpcEndpointGroup = Readonly<Record<string, IpcEndpoint>>;

function request<Channel extends string>(channel: Channel): RequestEndpoint<Channel> {
  return { kind: "request", channel };
}

function event<Channel extends string>(channel: Channel): EventEndpoint<Channel> {
  return { kind: "event", channel };
}

export const IPC_ENDPOINTS = {
  app: {
    getAppInfo: request(IPC_CHANNELS.getAppInfo),
    getSetupState: request(IPC_CHANNELS.getSetupState),
    saveSetup: request(IPC_CHANNELS.saveSetup),
    getAnalyticsPreference: request(IPC_CHANNELS.getAnalyticsPreference),
    setAnalyticsPreference: request(IPC_CHANNELS.setAnalyticsPreference),
    openExternal: request(IPC_CHANNELS.openExternal),
    openUrl: request(IPC_CHANNELS.openUrl),
  },
  maintenance: {
    exportData: request(IPC_CHANNELS.maintenanceExportData),
    exportDiagnostics: request(IPC_CHANNELS.maintenanceExportDiagnostics),
  },
  providers: {
    connectChatGPT: request(IPC_CHANNELS.connectChatGPT),
    connectClaude: request(IPC_CHANNELS.connectClaude),
    connectGrok: request(IPC_CHANNELS.connectGrok),
    refreshAgentProviders: request(IPC_CHANNELS.refreshAgentProviders),
  },
  providerRuntimes: {
    getStatus: request(IPC_CHANNELS.providerRuntimesGetStatus),
    download: request(IPC_CHANNELS.providerRuntimesDownload),
    cancel: request(IPC_CHANNELS.providerRuntimesCancel),
    event: event(IPC_CHANNELS.providerRuntimesEvent),
  },
  voice: {
    getModelStatus: request(IPC_CHANNELS.voiceGetModelStatus),
    prepareModel: request(IPC_CHANNELS.voicePrepareModel),
    transcribe: request(IPC_CHANNELS.voiceTranscribe),
    modelStatus: event(IPC_CHANNELS.voiceModelStatus),
  },
  dynamicIsland: {
    getPreference: request(IPC_CHANNELS.dynamicIslandGetPreference),
    setPreference: request(IPC_CHANNELS.dynamicIslandSetPreference),
    publishPresentation: request(IPC_CHANNELS.dynamicIslandPublishPresentation),
    getPresentation: request(IPC_CHANNELS.dynamicIslandGetPresentation),
    presentation: event(IPC_CHANNELS.dynamicIslandPresentation),
    preference: event(IPC_CHANNELS.dynamicIslandPreference),
    geometry: event(IPC_CHANNELS.dynamicIslandGeometry),
    performAction: request(IPC_CHANNELS.dynamicIslandPerformAction),
    performHaptic: request(IPC_CHANNELS.dynamicIslandPerformHaptic),
    action: event(IPC_CHANNELS.dynamicIslandAction),
    setInteractive: request(IPC_CHANNELS.dynamicIslandSetInteractive),
  },
  computerUse: {
    getMacSetupState: request(IPC_CHANNELS.computerUseGetMacSetupState),
    openMacPermissionSetup: request(IPC_CHANNELS.computerUseOpenMacPermissionSetup),
    startHelperDrag: request(IPC_CHANNELS.computerUseStartHelperDrag),
    revealHelper: request(IPC_CHANNELS.computerUseRevealHelper),
    closeMacPermissionSetup: request(IPC_CHANNELS.computerUseCloseMacPermissionSetup),
  },
  skills: {
    list: request(IPC_CHANNELS.skillsList),
    get: request(IPC_CHANNELS.skillsGet),
    listMine: request(IPC_CHANNELS.skillsListMine),
    choosePackage: request(IPC_CHANNELS.skillsChoosePackage),
    submit: request(IPC_CHANNELS.skillsSubmit),
    listInstalled: request(IPC_CHANNELS.skillsListInstalled),
    install: request(IPC_CHANNELS.skillsInstall),
    uninstall: request(IPC_CHANNELS.skillsUninstall),
  },
  hostedSites: {
    list: request(IPC_CHANNELS.hostedSitesList),
    chooseDirectory: request(IPC_CHANNELS.hostedSitesChooseDirectory),
    publish: request(IPC_CHANNELS.hostedSitesPublish),
    replace: request(IPC_CHANNELS.hostedSitesReplace),
    delete: request(IPC_CHANNELS.hostedSitesDelete),
  },
  marketplaceAgents: {
    list: request(IPC_CHANNELS.marketplaceAgentsList),
    get: request(IPC_CHANNELS.marketplaceAgentsGet),
    listMine: request(IPC_CHANNELS.marketplaceAgentsListMine),
    preview: request(IPC_CHANNELS.marketplaceAgentsPreview),
    submit: request(IPC_CHANNELS.marketplaceAgentsSubmit),
    install: request(IPC_CHANNELS.marketplaceAgentsInstall),
  },
  auth: {
    getState: request(IPC_CHANNELS.authGetState),
    retry: request(IPC_CHANNELS.authRetry),
    requestEmailCode: request(IPC_CHANNELS.authRequestEmailCode),
    verifyEmailCode: request(IPC_CHANNELS.authVerifyEmailCode),
    updateName: request(IPC_CHANNELS.authUpdateName),
    updateAvatar: request(IPC_CHANNELS.authUpdateAvatar),
    createMobileConnect: request(IPC_CHANNELS.authCreateMobileConnect),
    listMobileConnectedDevices: request(IPC_CHANNELS.authListMobileConnectedDevices),
    listAccountSessions: request(IPC_CHANNELS.authListAccountSessions),
    revokeAccountSession: request(IPC_CHANNELS.authRevokeAccountSession),
    revokeMobileConnectedDevice: request(IPC_CHANNELS.authRevokeMobileConnectedDevice),
    logout: request(IPC_CHANNELS.authLogout),
    event: event(IPC_CHANNELS.authEvent),
  },
  update: {
    getStatus: request(IPC_CHANNELS.updateGetStatus),
    check: request(IPC_CHANNELS.updateCheck),
    download: request(IPC_CHANNELS.updateDownload),
    install: request(IPC_CHANNELS.updateInstall),
    getPreference: request(IPC_CHANNELS.updateGetPreference),
    setPreference: request(IPC_CHANNELS.updateSetPreference),
    event: event(IPC_CHANNELS.updateEvent),
  },
  agent: {
    getStatus: request(IPC_CHANNELS.agentGetStatus),
    getUsage: request(IPC_CHANNELS.agentGetUsage),
    listModels: request(IPC_CHANNELS.agentListModels),
    list: request(IPC_CHANNELS.agentList),
    listInstalledSkills: request(IPC_CHANNELS.agentListInstalledSkills),
    getSidebarLayout: request(IPC_CHANNELS.agentGetSidebarLayout),
    mutateSidebarLayout: request(IPC_CHANNELS.agentMutateSidebarLayout),
    create: request(IPC_CHANNELS.agentCreate),
    duplicate: request(IPC_CHANNELS.agentDuplicate),
    update: request(IPC_CHANNELS.agentUpdate),
    setAvatar: request(IPC_CHANNELS.agentSetAvatar),
    delete: request(IPC_CHANNELS.agentDelete),
    readConversation: request(IPC_CHANNELS.agentReadConversation),
    readConversationPage: request(IPC_CHANNELS.agentReadConversationPage),
    searchConversationMessages: request(IPC_CHANNELS.agentSearchConversationMessages),
    listConversationReads: request(IPC_CHANNELS.agentListConversationReads),
    markConversationRead: request(IPC_CHANNELS.agentMarkConversationRead),
    sendMessage: request(IPC_CHANNELS.agentSendMessage),
    setMessageReaction: request(IPC_CHANNELS.agentSetMessageReaction),
    listQueue: request(IPC_CHANNELS.agentListQueue),
    acknowledgeFailedTurn: request(IPC_CHANNELS.agentAcknowledgeFailedTurn),
    cancelQueuedMessage: request(IPC_CHANNELS.agentCancelQueuedMessage),
    steerQueuedMessage: request(IPC_CHANNELS.agentSteerQueuedMessage),
    updateQueuedMessage: request(IPC_CHANNELS.agentUpdateQueuedMessage),
    reorderQueue: request(IPC_CHANNELS.agentReorderQueue),
    interrupt: request(IPC_CHANNELS.agentInterrupt),
    respondToPrompt: request(IPC_CHANNELS.agentRespondToPrompt),
    respondToApproval: request(IPC_CHANNELS.agentRespondToApproval),
    respondToBrowserTakeover: request(IPC_CHANNELS.agentRespondToBrowserTakeover),
    event: event(IPC_CHANNELS.agentEvent),
  },
  agentMemories: {
    listMemories: request(IPC_CHANNELS.agentListMemories),
    createMemory: request(IPC_CHANNELS.agentCreateMemory),
    updateMemory: request(IPC_CHANNELS.agentUpdateMemory),
    deleteMemory: request(IPC_CHANNELS.agentDeleteMemory),
    clearMemories: request(IPC_CHANNELS.agentClearMemories),
  },
  agentRoutines: {
    listRoutines: request(IPC_CHANNELS.agentListRoutines),
    createRoutine: request(IPC_CHANNELS.agentCreateRoutine),
    updateRoutine: request(IPC_CHANNELS.agentUpdateRoutine),
    deleteRoutine: request(IPC_CHANNELS.agentDeleteRoutine),
    testRoutine: request(IPC_CHANNELS.agentTestRoutine),
    listRoutineRuns: request(IPC_CHANNELS.agentListRoutineRuns),
  },
  agentAttachments: {
    chooseAttachments: request(IPC_CHANNELS.agentChooseAttachments),
    importAttachments: request(IPC_CHANNELS.agentImportAttachments),
    discardDraftAttachment: request(IPC_CHANNELS.agentDiscardDraftAttachment),
    openAttachment: request(IPC_CHANNELS.agentOpenAttachment),
    openSharedFile: request(IPC_CHANNELS.agentOpenSharedFile),
    openWorkspaceFile: request(IPC_CHANNELS.agentOpenWorkspaceFile),
    previewSharedFile: request(IPC_CHANNELS.agentPreviewSharedFile),
    previewWorkspaceFile: request(IPC_CHANNELS.agentPreviewWorkspaceFile),
  },
  browser: {
    open: request(IPC_CHANNELS.browserOpen),
    activate: request(IPC_CHANNELS.browserActivate),
    navigate: request(IPC_CHANNELS.browserNavigate),
    reload: request(IPC_CHANNELS.browserReload),
    close: request(IPC_CHANNELS.browserClose),
    listTabs: request(IPC_CHANNELS.browserListTabs),
    getDisplayState: request(IPC_CHANNELS.browserGetDisplayState),
    getControlState: request(IPC_CHANNELS.browserGetControlState),
    capturePreview: request(IPC_CHANNELS.browserCapturePreview),
    setVisible: request(IPC_CHANNELS.browserSetVisible),
    displayStateEvent: event(IPC_CHANNELS.browserDisplayStateEvent),
    pictureInPictureOpen: request(IPC_CHANNELS.browserPictureInPictureOpen),
    pictureInPictureClose: request(IPC_CHANNELS.browserPictureInPictureClose),
    pictureInPictureDock: request(IPC_CHANNELS.browserPictureInPictureDock),
    pictureInPictureHide: request(IPC_CHANNELS.browserPictureInPictureHide),
    pictureInPictureEvent: event(IPC_CHANNELS.browserPictureInPictureEvent),
  },
  servers: {
    list: request(IPC_CHANNELS.serversList),
    select: request(IPC_CHANNELS.serversSelect),
    reorder: request(IPC_CHANNELS.serversReorder),
    join: request(IPC_CHANNELS.serversJoin),
    previewInvite: request(IPC_CHANNELS.serversPreviewInvite),
    takePendingInvite: request(IPC_CHANNELS.serversTakePendingInvite),
    login: request(IPC_CHANNELS.serversLogin),
    retryConnection: request(IPC_CHANNELS.serversRetryConnection),
    remove: request(IPC_CHANNELS.serversRemove),
    getPresence: request(IPC_CHANNELS.serversGetPresence),
    getPresenceFor: request(IPC_CHANNELS.serversGetPresenceFor),
    refreshIdentity: request(IPC_CHANNELS.serversRefreshIdentity),
    listMembers: request(IPC_CHANNELS.serversListMembers),
    updateMember: request(IPC_CHANNELS.serversUpdateMember),
    removeMember: request(IPC_CHANNELS.serversRemoveMember),
    listInvites: request(IPC_CHANNELS.serversListInvites),
    revokeInvite: request(IPC_CHANNELS.serversRevokeInvite),
    createInvite: request(IPC_CHANNELS.serversCreateInvite),
    setTyping: request(IPC_CHANNELS.serversSetTyping),
    presence: event(IPC_CHANNELS.serversPresence),
    listDirectThreads: request(IPC_CHANNELS.serversListDirectThreads),
    readDirectConversation: request(IPC_CHANNELS.serversReadDirectConversation),
    readDirectConversationPage: request(IPC_CHANNELS.serversReadDirectConversationPage),
    sendDirectMessage: request(IPC_CHANNELS.serversSendDirectMessage),
    markDirectRead: request(IPC_CHANNELS.serversMarkDirectRead),
    setDirectTyping: request(IPC_CHANNELS.serversSetDirectTyping),
    directMessage: event(IPC_CHANNELS.serversDirectMessage),
    directTyping: event(IPC_CHANNELS.serversDirectTyping),
    event: event(IPC_CHANNELS.serversEvent),
    invite: event(IPC_CHANNELS.serversInvite),
  },
  host: {
    getStatus: request(IPC_CHANNELS.hostGetStatus),
    configure: request(IPC_CHANNELS.hostConfigure),
    updateIdentity: request(IPC_CHANNELS.hostUpdateIdentity),
    getPresence: request(IPC_CHANNELS.hostGetPresence),
    start: request(IPC_CHANNELS.hostStart),
    stop: request(IPC_CHANNELS.hostStop),
    listMembers: request(IPC_CHANNELS.hostListMembers),
    createInvite: request(IPC_CHANNELS.hostCreateInvite),
    listInvites: request(IPC_CHANNELS.hostListInvites),
    revokeInvite: request(IPC_CHANNELS.hostRevokeInvite),
    updateMember: request(IPC_CHANNELS.hostUpdateMember),
    removeMember: request(IPC_CHANNELS.hostRemoveMember),
    listSessions: request(IPC_CHANNELS.hostListSessions),
    revokeSession: request(IPC_CHANNELS.hostRevokeSession),
    event: event(IPC_CHANNELS.hostEvent),
  },
  remoteDesktop: {
    list: request(IPC_CHANNELS.remoteDesktopList),
    connect: request(IPC_CHANNELS.remoteDesktopConnect),
    selectDisplay: request(IPC_CHANNELS.remoteDesktopSelectDisplay),
    disconnect: request(IPC_CHANNELS.remoteDesktopDisconnect),
    event: event(IPC_CHANNELS.remoteDesktopEvent),
  },
} as const;

export type IpcEndpoints = typeof IPC_ENDPOINTS;

type ChannelsOf<Group extends IpcEndpointGroup> = Group[keyof Group]["channel"];

/** Every channel some group declares, request or event. */
type GroupedChannel = {
  [Group in keyof IpcEndpoints]: ChannelsOf<IpcEndpoints[Group]>;
}[keyof IpcEndpoints];

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

type RequireTrue<Value extends true> = Value;

// Exported because `noUnusedLocals` deletes an assertion nobody names: a private alias that no other
// type references is `TS6196`, and every way to reference one from the exports this file already has
// either makes `IpcEndpoints` circular or resolves it to the failure object, turning one named
// diagnostic into a cascade across `src/main`. Nothing imports this, and nothing should.
export type ChannelCoverage = RequireTrue<SameChannels<GroupedChannel, DeclaredChannel>>;
