import {
  type AgentIpcRequest,
  type AgentRequestChannel,
  type AttachmentImportEvent,
  decodeAgentProfileDraft,
  decodeChannel,
  decodeChannelMemories,
  decodeChannelMemory,
  decodeChannelPage,
  decodeChannelRoutine,
  decodeChannelRoutineRun,
  decodeChannelRoutineRuns,
  decodeChannelRoutines,
  decodeChannelSummaries,
  decodeMcpServerConfigs,
  decodeMcpTestResult,
  decodeOptionalStorageUsage,
  decodeSaveAgentProfileResult,
  type EventChannel,
  type EventPayloadOf,
  type ImportAttachmentsInput,
  type InnerPayloadOf,
  IPC_CHANNELS,
  LOCAL_SERVER_ID,
  type OpenBotDesktopApi,
  type PayloadOf,
  type RequestChannel,
  type ResultOf,
} from "@openbot/contracts/ipc";
import { isPluginSlug } from "@openbot/contracts/plugin-links";
import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  decodeAccountUsageFromMain,
  decodeAgent,
  decodeAgentAnalyticsFromMain,
  decodeAgentModels,
  decodeAgentStatusFromMain,
  decodeAgents,
  decodeDuplicateAgentResultFromMain,
  decodeHostAnalyticsFromMain,
  decodeMemories,
  decodeMemory,
  decodeProviderApiKeyState,
  decodeProviderCodeLoginStart,
  decodeRoutine,
  decodeRoutineRun,
  decodeRoutineRuns,
  decodeRoutines,
  decodeSidebarLayout,
  decodeTables,
} from "./agent-decoding";
import { decodeScopedAgentEvent } from "./agent-event-decoding";
import {
  decodeAccountSessions,
  decodeAnalyticsPreference,
  decodeAppInfo,
  decodeAppLanguagePreference,
  decodeApprovalAutomationPreference,
  decodeAppSetupState,
  decodeCentralAuthState,
  decodeCustomProviderResult,
  decodeCustomProviders,
  decodeExportResult,
  decodeHostedSite,
  decodeHostedSites,
  decodeMobileConnectedDevices,
  decodeMobileConnectTicket,
  decodeNotificationOpenedEvent,
  decodeNotificationPreference,
  decodeNullablePath,
  decodePendingListing,
  decodeRemoteDesktopSetupFromMain,
  decodeRemoteDesktopTestFromMain,
  decodeUpdatePreference,
  decodeUpdateStatus,
  decodeVoiceModelStatus,
  decodeVoiceTranscriptionResult,
  decodeVoid,
} from "./app-decoding";
import {
  decodeBrowserBounds,
  decodeBrowserControlState,
  decodeBrowserDisplayState,
  decodeBrowserLiveViewEvent,
  decodeBrowserPictureInPictureEvent,
  decodeBrowserPreviewFromMain,
  decodeBrowserTab,
  decodeBrowserTabs,
} from "./browser-decoding";
import { clipboardFiles } from "./clipboard-files";
import {
  decodeComputerUseHighlightPlacement,
  decodeComputerUsePermissionApp,
  decodeComputerUseState,
} from "./computer-use-decoding";
import {
  decodeAttachments,
  decodeConversation,
  decodeConversationPageFromMain,
  decodeConversationSearchPageFromMain,
  decodeFilePreview,
  decodeQueue,
  decodeReadState,
  decodeReadStates,
  decodeReceipt,
} from "./conversation-decoding";
import {
  decodeDynamicIslandAction,
  decodeDynamicIslandGeometry,
  decodeDynamicIslandPreference,
  decodeDynamicIslandPresentation,
} from "./dynamic-island-decoding";
import { decodeProviderRuntimeSnapshot } from "./provider-runtime";
import {
  decodeAgentInstallation,
  decodeAgentPublicationPreview,
  decodeAgentSubmission,
  decodeAgentSubmissions,
  decodeInstalledSkill,
  decodeInstalledSkillsFromMain,
  decodeMarketplaceAgentDetail,
  decodeMarketplaceAgentPage,
  decodeSkillDetail,
  decodeSkillDetails,
  decodeSkillPage,
  decodeSkillPreview,
  decodeSubmission,
  decodeSubmissions,
} from "./skills-decoding";
import {
  decodeDirectConversation,
  decodeDirectConversationPage,
  decodeDirectMessage,
  decodeDirectReadState,
  decodeDirectThreads,
  decodeHostStatus,
  decodeInvitePreview,
  decodeInviteSummary,
  decodeInviteUrl,
  decodePendingInvite,
  decodeRemoteDesktopConnectResult,
  decodeRemoteDesktopSessions,
  decodeScopedDirectMessage,
  decodeScopedDirectTyping,
  decodeScopedTeamPresence,
  decodeServer,
  decodeServers,
  decodeTeamInvites,
  decodeTeamMember,
  decodeTeamMembers,
  decodeTeamPresenceSnapshot,
  decodeTeamSessions,
} from "./team-decoding";

const attachmentImportListeners = new Set<(event: AttachmentImportEvent) => void>();
let selectedServerId: string = LOCAL_SERVER_ID;

// A typed endpoint fixes what the preload sends and what its decoder must return. An endpoint that
// takes nothing takes no payload argument here.
type PayloadArgs<Channel extends RequestChannel> = [PayloadOf<Channel>] extends [undefined]
  ? []
  : [payload: PayloadOf<Channel>];

function invokeRequest<Channel extends RequestChannel>(
  channel: Channel,
  decode: (value: unknown) => ResultOf<Channel>,
  ...payload: PayloadArgs<Channel>
): Promise<ResultOf<Channel>> {
  return ipcRenderer.invoke(channel, ...payload).then(decode);
}

function invokeAgent<Channel extends AgentRequestChannel>(
  channel: Channel,
  payload: InnerPayloadOf<Channel>,
  decode: (value: unknown) => ResultOf<Channel>,
): Promise<ResultOf<Channel>> {
  const request: AgentIpcRequest<InnerPayloadOf<Channel>> = { serverId: selectedServerId, payload };
  return ipcRenderer.invoke(channel, request).then(decode);
}

function invokeAgentForServer<Channel extends AgentRequestChannel>(
  serverId: string,
  channel: Channel,
  payload: InnerPayloadOf<Channel>,
  decode: (value: unknown) => ResultOf<Channel>,
): Promise<ResultOf<Channel>> {
  const request: AgentIpcRequest<InnerPayloadOf<Channel>> = { serverId, payload };
  return ipcRenderer.invoke(channel, request).then(decode);
}

// The one place the preload subscribes to main. It hands on the raw value, so a caller that keeps
// only one server's events can decode and check it before the renderer sees it.
function listen(channel: EventChannel, onValue: (value: unknown) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: unknown) => onValue(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

function subscribe<Channel extends EventChannel>(
  channel: Channel,
  decode: (value: unknown) => EventPayloadOf<Channel>,
  listener: (payload: EventPayloadOf<Channel>) => void,
): () => void {
  return listen(channel, (value) => listener(decode(value)));
}

function rememberActiveServer<T extends { id: string; active: boolean }[]>(servers: T): T {
  selectedServerId = servers.find((server) => server.active)?.id ?? LOCAL_SERVER_ID;
  return servers;
}

function emitAttachmentImport(event: AttachmentImportEvent): void {
  for (const listener of attachmentImportListeners) listener(event);
}

async function importFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const requestId = crypto.randomUUID();
  const serverId = selectedServerId;
  emitAttachmentImport({ type: "started", requestId, serverId });
  try {
    const input: ImportAttachmentsInput = { paths: [], data: [] };
    for (const file of files) {
      const path = webUtils.getPathForFile(file);
      if (path) input.paths.push(path);
      else {
        input.data.push({
          name: file.name || `pasted-${Date.now()}.png`,
          mimeType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
      }
    }
    const attachments = await invokeAgentForServer(
      serverId,
      IPC_CHANNELS.agentImportAttachments,
      input,
      decodeAttachments,
    );
    emitAttachmentImport({ type: "completed", requestId, serverId, attachments });
  } catch (error) {
    emitAttachmentImport({
      type: "error",
      requestId,
      serverId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function isConversationDropTarget(target: EventTarget | null): boolean {
  const conversation = document.querySelector(".conversation-panel");
  return target instanceof Node && Boolean(conversation?.contains(target));
}

window.addEventListener("dragover", (event) => {
  if (!isConversationDropTarget(event.target)) return;
  if ([...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file")) {
    event.preventDefault();
  }
});
window.addEventListener("drop", (event) => {
  if (!isConversationDropTarget(event.target)) return;
  const files = [...(event.dataTransfer?.files ?? [])];
  if (!files.length) return;
  event.preventDefault();
  void importFiles(files);
});
window.addEventListener("paste", (event) => {
  const files = clipboardFiles(event.clipboardData);
  if (files.length) {
    event.preventDefault();
    void importFiles(files);
  }
});
window.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.dataset.openbotAttachmentPicker !== "true") return;
  void importFiles([...(input.files ?? [])]);
});

const openbotApi: OpenBotDesktopApi = {
  getAppInfo: () => invokeRequest(IPC_CHANNELS.getAppInfo, decodeAppInfo),
  getSetupState: () => invokeRequest(IPC_CHANNELS.getSetupState, decodeAppSetupState),
  saveSetup: (input) => invokeRequest(IPC_CHANNELS.saveSetup, decodeAppSetupState, input),
  getAnalyticsPreference: () => invokeRequest(IPC_CHANNELS.getAnalyticsPreference, decodeAnalyticsPreference),
  setAnalyticsPreference: (input) =>
    invokeRequest(IPC_CHANNELS.setAnalyticsPreference, decodeAnalyticsPreference, input),
  getApprovalAutomation: () => invokeRequest(IPC_CHANNELS.getApprovalAutomation, decodeApprovalAutomationPreference),
  setApprovalAutomation: (input) =>
    invokeRequest(IPC_CHANNELS.setApprovalAutomation, decodeApprovalAutomationPreference, input),
  getAppLanguagePreference: () => invokeRequest(IPC_CHANNELS.getAppLanguagePreference, decodeAppLanguagePreference),
  setAppLanguagePreference: (input) =>
    invokeRequest(IPC_CHANNELS.setAppLanguagePreference, decodeAppLanguagePreference, input),
  onAppLanguagePreference: (listener) =>
    subscribe(IPC_CHANNELS.appLanguagePreference, decodeAppLanguagePreference, listener),
  onOpenSettings: (listener) => listen(IPC_CHANNELS.openSettings, () => listener()),
  dynamicIsland: {
    getPreference: () => invokeRequest(IPC_CHANNELS.dynamicIslandGetPreference, decodeDynamicIslandPreference),
    setPreference: (input) =>
      invokeRequest(IPC_CHANNELS.dynamicIslandSetPreference, decodeDynamicIslandPreference, input),
    publishPresentation: (presentation) =>
      invokeRequest(IPC_CHANNELS.dynamicIslandPublishPresentation, decodeVoid, presentation),
    getPresentation: () => invokeRequest(IPC_CHANNELS.dynamicIslandGetPresentation, decodeDynamicIslandPresentation),
    onPreference: (listener) =>
      subscribe(IPC_CHANNELS.dynamicIslandPreference, decodeDynamicIslandPreference, listener),
    onPresentation: (listener) =>
      subscribe(IPC_CHANNELS.dynamicIslandPresentation, decodeDynamicIslandPresentation, listener),
    onGeometry: (listener) => subscribe(IPC_CHANNELS.dynamicIslandGeometry, decodeDynamicIslandGeometry, listener),
    performAction: (action) => invokeRequest(IPC_CHANNELS.dynamicIslandPerformAction, decodeVoid, action),
    performHaptic: () => invokeRequest(IPC_CHANNELS.dynamicIslandPerformHaptic, decodeVoid),
    onAction: (listener) => subscribe(IPC_CHANNELS.dynamicIslandAction, decodeDynamicIslandAction, listener),
    setInteractive: (input) => invokeRequest(IPC_CHANNELS.dynamicIslandSetInteractive, decodeVoid, input),
  },
  getComputerUseState: () => invokeRequest(IPC_CHANNELS.computerUseGetState, decodeComputerUseState),
  openComputerUsePermissionPane: (permission) =>
    invokeRequest(IPC_CHANNELS.computerUseOpenPermissionPane, decodeComputerUseState, permission),
  closeComputerUsePermissionHelp: () => invokeRequest(IPC_CHANNELS.computerUseClosePermissionHelp, decodeVoid),
  getComputerUsePermissionApp: () =>
    invokeRequest(IPC_CHANNELS.computerUseGetPermissionApp, decodeComputerUsePermissionApp),
  startComputerUsePermissionAppDrag: () => invokeRequest(IPC_CHANNELS.computerUseStartPermissionAppDrag, decodeVoid),
  revealComputerUsePermissionApp: () => invokeRequest(IPC_CHANNELS.computerUseRevealPermissionApp, decodeVoid),
  onComputerUseHighlightPlacement: (listener) =>
    subscribe(IPC_CHANNELS.computerUseHighlightPlacement, decodeComputerUseHighlightPlacement, listener),
  openExternal: (destination) => invokeRequest(IPC_CHANNELS.openExternal, decodeVoid, destination),
  connectProvider: (provider) => invokeRequest(IPC_CHANNELS.connectProvider, decodeAgentStatusFromMain, provider),
  updateProviderCli: (provider) => invokeRequest(IPC_CHANNELS.updateProviderCli, decodeAgentStatusFromMain, provider),
  refreshAgentProviders: () => invokeRequest(IPC_CHANNELS.refreshAgentProviders, decodeAgentStatusFromMain),
  setProviderApiKey: (input) => invokeRequest(IPC_CHANNELS.setProviderApiKey, decodeAgentStatusFromMain, input),
  clearProviderApiKey: (provider) =>
    invokeRequest(IPC_CHANNELS.clearProviderApiKey, decodeAgentStatusFromMain, provider),
  getProviderApiKeyState: (provider) =>
    invokeRequest(IPC_CHANNELS.getProviderApiKeyState, decodeProviderApiKeyState, provider),
  startProviderCodeLogin: (provider) =>
    invokeRequest(IPC_CHANNELS.startProviderCodeLogin, decodeProviderCodeLoginStart, provider),
  cancelProviderCodeLogin: (provider) =>
    invokeRequest(IPC_CHANNELS.cancelProviderCodeLogin, decodeAgentStatusFromMain, provider),
  providerRuntimes: {
    getStatus: () => invokeRequest(IPC_CHANNELS.providerRuntimesGetStatus, decodeProviderRuntimeSnapshot),
    download: (provider) =>
      invokeRequest(IPC_CHANNELS.providerRuntimesDownload, decodeProviderRuntimeSnapshot, provider),
    cancel: (provider) => invokeRequest(IPC_CHANNELS.providerRuntimesCancel, decodeProviderRuntimeSnapshot, provider),
    checkForUpdates: () => invokeRequest(IPC_CHANNELS.providerRuntimesCheckForUpdates, decodeProviderRuntimeSnapshot),
    onEvent: (listener) => subscribe(IPC_CHANNELS.providerRuntimesEvent, decodeProviderRuntimeSnapshot, listener),
  },
  openUrl: (url) => invokeRequest(IPC_CHANNELS.openUrl, decodeVoid, url),
  voice: {
    getModelStatus: () => invokeRequest(IPC_CHANNELS.voiceGetModelStatus, decodeVoiceModelStatus),
    prepareModel: () => invokeRequest(IPC_CHANNELS.voicePrepareModel, decodeVoiceModelStatus),
    transcribe: (input) => invokeRequest(IPC_CHANNELS.voiceTranscribe, decodeVoiceTranscriptionResult, input),
    onModelStatus: (listener) => subscribe(IPC_CHANNELS.voiceModelStatus, decodeVoiceModelStatus, listener),
  },
  auth: {
    getState: () => invokeRequest(IPC_CHANNELS.authGetState, decodeCentralAuthState),
    retry: () => invokeRequest(IPC_CHANNELS.authRetry, decodeCentralAuthState),
    requestEmailCode: (email) => invokeRequest(IPC_CHANNELS.authRequestEmailCode, decodeCentralAuthState, email),
    verifyEmailCode: (challengeId, code) =>
      invokeRequest(IPC_CHANNELS.authVerifyEmailCode, decodeCentralAuthState, { challengeId, code }),
    updateName: (name) => invokeRequest(IPC_CHANNELS.authUpdateName, decodeCentralAuthState, name),
    updateAvatar: (image) => invokeRequest(IPC_CHANNELS.authUpdateAvatar, decodeCentralAuthState, image),
    createMobileConnect: () => invokeRequest(IPC_CHANNELS.authCreateMobileConnect, decodeMobileConnectTicket),
    listMobileConnectedDevices: () =>
      invokeRequest(IPC_CHANNELS.authListMobileConnectedDevices, decodeMobileConnectedDevices),
    listAccountSessions: () => invokeRequest(IPC_CHANNELS.authListAccountSessions, decodeAccountSessions),
    revokeAccountSession: (sessionId) => invokeRequest(IPC_CHANNELS.authRevokeAccountSession, decodeVoid, sessionId),
    revokeMobileConnectedDevice: (sessionId) =>
      invokeRequest(IPC_CHANNELS.authRevokeMobileConnectedDevice, decodeVoid, sessionId),
    logout: () => invokeRequest(IPC_CHANNELS.authLogout, decodeCentralAuthState),
    onEvent: (listener) => subscribe(IPC_CHANNELS.authEvent, decodeCentralAuthState, listener),
  },
  skills: {
    localList: () => invokeRequest(IPC_CHANNELS.skillsLocalList, decodeSkillDetails),
    localGet: (input) => invokeRequest(IPC_CHANNELS.skillsLocalGet, decodeSkillDetail, input),
    localCreate: (input) => invokeRequest(IPC_CHANNELS.skillsLocalCreate, decodeSkillDetail, input),
    localRevise: (input) => invokeRequest(IPC_CHANNELS.skillsLocalRevise, decodeSkillDetail, input),
    localInstall: (input) => invokeRequest(IPC_CHANNELS.skillsLocalInstall, decodeInstalledSkill, input),
    list: (query) => invokeRequest(IPC_CHANNELS.skillsList, decodeSkillPage, query),
    get: (skillId) => invokeRequest(IPC_CHANNELS.skillsGet, decodeSkillDetail, skillId),
    listMine: () => invokeRequest(IPC_CHANNELS.skillsListMine, decodeSubmissions),
    choosePackage: () => invokeRequest(IPC_CHANNELS.skillsChoosePackage, decodeSkillPreview),
    submit: (input) => invokeRequest(IPC_CHANNELS.skillsSubmit, decodeSubmission, input),
    listInstalled: (agentId) => invokeRequest(IPC_CHANNELS.skillsListInstalled, decodeInstalledSkillsFromMain, agentId),
    install: (input) => invokeRequest(IPC_CHANNELS.skillsInstall, decodeInstalledSkill, input),
    uninstall: (input) => invokeRequest(IPC_CHANNELS.skillsUninstall, decodeVoid, input),
    setEnabled: (input) => invokeRequest(IPC_CHANNELS.skillsSetEnabled, decodeInstalledSkill, input),
  },
  hostedSites: {
    list: () => invokeRequest(IPC_CHANNELS.hostedSitesList, decodeHostedSites),
    chooseDirectory: () => invokeRequest(IPC_CHANNELS.hostedSitesChooseDirectory, decodeNullablePath),
    publish: (input) => invokeRequest(IPC_CHANNELS.hostedSitesPublish, decodeHostedSite, input),
    replace: (input) => invokeRequest(IPC_CHANNELS.hostedSitesReplace, decodeHostedSite, input),
    delete: (input) => invokeRequest(IPC_CHANNELS.hostedSitesDelete, decodeVoid, input),
  },
  customProviders: {
    list: () => invokeRequest(IPC_CHANNELS.customProvidersList, decodeCustomProviders),
    save: (input) => invokeRequest(IPC_CHANNELS.customProvidersSave, decodeCustomProviderResult, input),
    delete: (input) => invokeRequest(IPC_CHANNELS.customProvidersDelete, decodeCustomProviderResult, input),
  },
  marketplaceAgents: {
    list: (query) => invokeRequest(IPC_CHANNELS.marketplaceAgentsList, decodeMarketplaceAgentPage, query),
    get: (agentId) => invokeRequest(IPC_CHANNELS.marketplaceAgentsGet, decodeMarketplaceAgentDetail, agentId),
    listMine: () => invokeRequest(IPC_CHANNELS.marketplaceAgentsListMine, decodeAgentSubmissions),
    preview: (agentId) => invokeRequest(IPC_CHANNELS.marketplaceAgentsPreview, decodeAgentPublicationPreview, agentId),
    submit: (input) => invokeRequest(IPC_CHANNELS.marketplaceAgentsSubmit, decodeAgentSubmission, input),
    install: (input) => invokeRequest(IPC_CHANNELS.marketplaceAgentsInstall, decodeAgentInstallation, input),
  },
  agent: {
    getStatus: () => invokeAgent(IPC_CHANNELS.agentGetStatus, null, decodeAgentStatusFromMain),
    getHostAnalytics: (input, serverId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.hostGetAnalytics, input, decodeHostAnalyticsFromMain),
    getAnalytics: (input, serverId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.agentGetAnalytics, input, decodeAgentAnalyticsFromMain),
    getUsage: (agentId) => invokeAgent(IPC_CHANNELS.agentGetUsage, agentId, decodeAccountUsageFromMain),
    listModels: () => invokeAgent(IPC_CHANNELS.agentListModels, null, decodeAgentModels),
    listAgents: (serverId) =>
      serverId === undefined
        ? invokeAgent(IPC_CHANNELS.agentList, null, decodeAgents)
        : invokeAgentForServer(serverId, IPC_CHANNELS.agentList, null, decodeAgents),
    listInstalledSkills: (agentId) =>
      invokeAgent(IPC_CHANNELS.agentListInstalledSkills, agentId, decodeInstalledSkillsFromMain),
    listChannels: () => invokeAgent(IPC_CHANNELS.agentListChannels, null, decodeChannelSummaries),
    readChannel: (input) => invokeAgent(IPC_CHANNELS.agentReadChannel, input, decodeChannelPage),
    channelCommand: (input) => invokeAgent(IPC_CHANNELS.agentChannelCommand, input, decodeChannel),
    deleteChannel: (channelId) => invokeAgent(IPC_CHANNELS.agentDeleteChannel, channelId, decodeVoid),
    getSidebarLayout: () => invokeAgent(IPC_CHANNELS.agentGetSidebarLayout, null, decodeSidebarLayout),
    mutateSidebarLayout: (action) => invokeAgent(IPC_CHANNELS.agentMutateSidebarLayout, action, decodeSidebarLayout),
    generateProfile: (input) => invokeAgent(IPC_CHANNELS.agentGenerateProfile, input, decodeAgentProfileDraft),
    saveProfile: (input) => invokeAgent(IPC_CHANNELS.agentSaveProfile, input, decodeSaveAgentProfileResult),
    createAgent: (input) => invokeAgent(IPC_CHANNELS.agentCreate, input, decodeAgent),
    duplicateAgent: (agentId) => invokeAgent(IPC_CHANNELS.agentDuplicate, agentId, decodeDuplicateAgentResultFromMain),
    updateAgent: (input) => invokeAgent(IPC_CHANNELS.agentUpdate, input, decodeAgent),
    setAvatar: (input) => invokeAgent(IPC_CHANNELS.agentSetAvatar, input, decodeAgent),
    deleteAgent: (agentId) => invokeAgent(IPC_CHANNELS.agentDelete, agentId, decodeVoid),
    listMemories: (agentId) => invokeAgent(IPC_CHANNELS.agentListMemories, agentId, decodeMemories),
    createMemory: (input) => invokeAgent(IPC_CHANNELS.agentCreateMemory, input, decodeMemory),
    updateMemory: (input) => invokeAgent(IPC_CHANNELS.agentUpdateMemory, input, decodeMemory),
    deleteMemory: (input) => invokeAgent(IPC_CHANNELS.agentDeleteMemory, input, decodeVoid),
    clearMemories: (agentId) => invokeAgent(IPC_CHANNELS.agentClearMemories, agentId, decodeVoid),
    listTables: () => invokeAgent(IPC_CHANNELS.sharedListTables, null, decodeTables),
    deleteTable: (input) => invokeAgent(IPC_CHANNELS.sharedDeleteTable, input, decodeVoid),
    listRoutines: (agentId) => invokeAgent(IPC_CHANNELS.agentListRoutines, agentId, decodeRoutines),
    createRoutine: (input) => invokeAgent(IPC_CHANNELS.agentCreateRoutine, input, decodeRoutine),
    updateRoutine: (input) => invokeAgent(IPC_CHANNELS.agentUpdateRoutine, input, decodeRoutine),
    deleteRoutine: (input) => invokeAgent(IPC_CHANNELS.agentDeleteRoutine, input, decodeVoid),
    testRoutine: (input) => invokeAgent(IPC_CHANNELS.agentTestRoutine, input, decodeRoutineRun),
    listRoutineRuns: (input) => invokeAgent(IPC_CHANNELS.agentListRoutineRuns, input, decodeRoutineRuns),
    listChannelMemories: (channelId) =>
      invokeAgent(IPC_CHANNELS.agentListChannelMemories, channelId, decodeChannelMemories),
    createChannelMemory: (input) => invokeAgent(IPC_CHANNELS.agentCreateChannelMemory, input, decodeChannelMemory),
    updateChannelMemory: (input) => invokeAgent(IPC_CHANNELS.agentUpdateChannelMemory, input, decodeChannelMemory),
    deleteChannelMemory: (input) => invokeAgent(IPC_CHANNELS.agentDeleteChannelMemory, input, decodeVoid),
    clearChannelMemories: (channelId) => invokeAgent(IPC_CHANNELS.agentClearChannelMemories, channelId, decodeVoid),
    listChannelRoutines: (channelId) =>
      invokeAgent(IPC_CHANNELS.agentListChannelRoutines, channelId, decodeChannelRoutines),
    createChannelRoutine: (input) => invokeAgent(IPC_CHANNELS.agentCreateChannelRoutine, input, decodeChannelRoutine),
    updateChannelRoutine: (input) => invokeAgent(IPC_CHANNELS.agentUpdateChannelRoutine, input, decodeChannelRoutine),
    deleteChannelRoutine: (input) => invokeAgent(IPC_CHANNELS.agentDeleteChannelRoutine, input, decodeVoid),
    testChannelRoutine: (input) => invokeAgent(IPC_CHANNELS.agentTestChannelRoutine, input, decodeChannelRoutineRun),
    listChannelRoutineRuns: (input) =>
      invokeAgent(IPC_CHANNELS.agentListChannelRoutineRuns, input, decodeChannelRoutineRuns),
    // `invokeAgentForServer`, never `invokeAgent`: the settings modal can be open for a server the
    // user has not switched to, and `invokeAgent` would pin the selected one.
    listMcpServers: (serverId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.serversListMcpServers, null, decodeMcpServerConfigs),
    saveMcpServer: (input, serverId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.serversSaveMcpServer, input, decodeMcpServerConfigs),
    removeMcpServer: (input, serverId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.serversRemoveMcpServer, input, decodeMcpServerConfigs),
    setMcpServerEnabled: (input, serverId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.serversSetMcpServerEnabled, input, decodeMcpServerConfigs),
    testMcpServer: (input, serverId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.serversTestMcpServer, input, decodeMcpTestResult),
    readConversation: (agentId) => invokeAgent(IPC_CHANNELS.agentReadConversation, agentId, decodeConversation),
    readConversationPage: (input, serverId = selectedServerId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.agentReadConversationPage, input, decodeConversationPageFromMain),
    searchConversationMessages: (input) =>
      invokeAgent(IPC_CHANNELS.agentSearchConversationMessages, input, decodeConversationSearchPageFromMain),
    listConversationReads: () => invokeAgent(IPC_CHANNELS.agentListConversationReads, null, decodeReadStates),
    markConversationRead: (input, serverId = selectedServerId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.agentMarkConversationRead, input, decodeReadState),
    chooseAttachments: (input) => invokeAgent(IPC_CHANNELS.agentChooseAttachments, input, decodeAttachments),
    onAttachmentImport: (listener) => {
      attachmentImportListeners.add(listener);
      return () => attachmentImportListeners.delete(listener);
    },
    discardDraftAttachment: (attachmentId, serverId = selectedServerId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.agentDiscardDraftAttachment, attachmentId, decodeVoid),
    downloadAttachments: (input) => invokeAgent(IPC_CHANNELS.agentDownloadAttachments, input, decodeVoid),
    openAttachment: (input) => invokeAgent(IPC_CHANNELS.agentOpenAttachment, input, decodeVoid),
    openSharedFile: (input) => invokeAgent(IPC_CHANNELS.agentOpenSharedFile, input, decodeVoid),
    openWorkspaceFile: (input) => invokeAgent(IPC_CHANNELS.agentOpenWorkspaceFile, input, decodeVoid),
    previewSharedFile: (input) => invokeAgent(IPC_CHANNELS.agentPreviewSharedFile, input, decodeFilePreview),
    previewWorkspaceFile: (input) => invokeAgent(IPC_CHANNELS.agentPreviewWorkspaceFile, input, decodeFilePreview),
    sendMessage: (input, serverId = selectedServerId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.agentSendMessage, input, decodeReceipt),
    setMessageReaction: (input) => invokeAgent(IPC_CHANNELS.agentSetMessageReaction, input, decodeVoid),
    listQueue: (agentId) => invokeAgent(IPC_CHANNELS.agentListQueue, agentId, decodeQueue),
    acknowledgeFailedTurn: (input) => invokeAgent(IPC_CHANNELS.agentAcknowledgeFailedTurn, input, decodeVoid),
    cancelQueuedMessage: (input) => invokeAgent(IPC_CHANNELS.agentCancelQueuedMessage, input, decodeVoid),
    steerQueuedMessage: (input) => invokeAgent(IPC_CHANNELS.agentSteerQueuedMessage, input, decodeVoid),
    editQueuedMessage: (input, serverId = selectedServerId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.agentEditQueuedMessage, input, decodeQueue),
    updateQueuedMessage: (input, serverId = selectedServerId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.agentUpdateQueuedMessage, input, decodeVoid),
    reorderQueue: (input) => invokeAgent(IPC_CHANNELS.agentReorderQueue, input, decodeVoid),
    interrupt: (input) => invokeAgent(IPC_CHANNELS.agentInterrupt, input, decodeVoid),
    respondToPrompt: (input) => invokeAgent(IPC_CHANNELS.agentRespondToPrompt, input, decodeVoid),
    respondToApproval: (input) => invokeAgent(IPC_CHANNELS.agentRespondToApproval, input, decodeVoid),
    respondToBrowserSecret: (input) => invokeAgent(IPC_CHANNELS.agentRespondToBrowserSecret, input, decodeVoid),
    respondToBrowserTakeover: (input) => invokeAgent(IPC_CHANNELS.agentRespondToBrowserTakeover, input, decodeVoid),
    onEvent: (listener) =>
      subscribe(IPC_CHANNELS.agentEvent, decodeScopedAgentEvent, (payload) => {
        if (payload.serverId === selectedServerId) listener(payload.event);
      }),
    onScopedEvent: (listener) => subscribe(IPC_CHANNELS.agentEvent, decodeScopedAgentEvent, listener),
  },
  browser: {
    open: (input) => invokeRequest(IPC_CHANNELS.browserOpen, decodeBrowserTab, input),
    activate: (tabId) => invokeRequest(IPC_CHANNELS.browserActivate, decodeVoid, tabId),
    navigate: (input) => invokeRequest(IPC_CHANNELS.browserNavigate, decodeVoid, input),
    reload: (tabId) => invokeRequest(IPC_CHANNELS.browserReload, decodeVoid, tabId),
    close: (tabId) => invokeRequest(IPC_CHANNELS.browserClose, decodeVoid, tabId),
    listTabs: () => invokeRequest(IPC_CHANNELS.browserListTabs, decodeBrowserTabs),
    getDisplayState: () => invokeRequest(IPC_CHANNELS.browserGetDisplayState, decodeBrowserDisplayState),
    getControlState: () => invokeRequest(IPC_CHANNELS.browserGetControlState, decodeBrowserControlState),
    capturePreview: (tabId) => invokeRequest(IPC_CHANNELS.browserCapturePreview, decodeBrowserPreviewFromMain, tabId),
    setVisible: (input) => invokeRequest(IPC_CHANNELS.browserSetVisible, decodeVoid, input),
    startLiveView: (tabId) => invokeRequest(IPC_CHANNELS.browserStartLiveView, decodeVoid, tabId),
    stopLiveView: () => invokeRequest(IPC_CHANNELS.browserStopLiveView, decodeVoid),
    // Untyped: the renderer and wire input shapes differ on purpose. See `IPC_ENDPOINTS.browser`.
    sendLiveViewInput: (input) => ipcRenderer.invoke(IPC_CHANNELS.browserSendLiveViewInput, input).then(decodeVoid),
    onLiveViewEvent: (listener) => subscribe(IPC_CHANNELS.browserLiveViewEvent, decodeBrowserLiveViewEvent, listener),
    onDisplayState: (listener) => subscribe(IPC_CHANNELS.browserDisplayStateEvent, decodeBrowserDisplayState, listener),
    openPictureInPicture: (bounds) =>
      invokeRequest(IPC_CHANNELS.browserPictureInPictureOpen, decodeBrowserBounds, bounds),
    closePictureInPicture: () => invokeRequest(IPC_CHANNELS.browserPictureInPictureClose, decodeVoid),
    dockPictureInPicture: () => invokeRequest(IPC_CHANNELS.browserPictureInPictureDock, decodeVoid),
    hidePictureInPicture: () => invokeRequest(IPC_CHANNELS.browserPictureInPictureHide, decodeVoid),
    onPictureInPictureEvent: (listener) =>
      subscribe(IPC_CHANNELS.browserPictureInPictureEvent, decodeBrowserPictureInPictureEvent, listener),
  },
  update: {
    getStatus: () => invokeRequest(IPC_CHANNELS.updateGetStatus, decodeUpdateStatus),
    check: () => invokeRequest(IPC_CHANNELS.updateCheck, decodeUpdateStatus),
    download: () => invokeRequest(IPC_CHANNELS.updateDownload, decodeUpdateStatus),
    install: () => invokeRequest(IPC_CHANNELS.updateInstall, decodeVoid),
    getPreference: () => invokeRequest(IPC_CHANNELS.updateGetPreference, decodeUpdatePreference),
    setPreference: (input) => invokeRequest(IPC_CHANNELS.updateSetPreference, decodeUpdatePreference, input),
    onEvent: (listener) => subscribe(IPC_CHANNELS.updateEvent, decodeUpdateStatus, listener),
  },
  notifications: {
    getPreference: () => invokeRequest(IPC_CHANNELS.notificationsGetPreference, decodeNotificationPreference),
    setPreference: (input) =>
      invokeRequest(IPC_CHANNELS.notificationsSetPreference, decodeNotificationPreference, input),
    test: () => invokeRequest(IPC_CHANNELS.notificationsTest, decodeVoid),
    openSettings: () => invokeRequest(IPC_CHANNELS.notificationsOpenSettings, decodeVoid),
    onOpened: (listener) => subscribe(IPC_CHANNELS.notificationsOpenedEvent, decodeNotificationOpenedEvent, listener),
  },
  maintenance: {
    exportData: () => invokeRequest(IPC_CHANNELS.maintenanceExportData, decodeExportResult),
    exportDiagnostics: () => invokeRequest(IPC_CHANNELS.maintenanceExportDiagnostics, decodeExportResult),
  },
  servers: {
    list: async () => rememberActiveServer(await invokeRequest(IPC_CHANNELS.serversList, decodeServers)),
    select: async (serverId) =>
      rememberActiveServer(await invokeRequest(IPC_CHANNELS.serversSelect, decodeServers, serverId)),
    reorder: async (input) =>
      rememberActiveServer(await invokeRequest(IPC_CHANNELS.serversReorder, decodeServers, input)),
    setMuted: async (input) =>
      rememberActiveServer(await invokeRequest(IPC_CHANNELS.serversSetMuted, decodeServers, input)),
    setNotificationLevel: async (input) =>
      rememberActiveServer(await invokeRequest(IPC_CHANNELS.serversSetNotificationLevel, decodeServers, input)),
    join: async (input) => {
      const server = await invokeRequest(IPC_CHANNELS.serversJoin, decodeServer, input);
      selectedServerId = server.id;
      return server;
    },
    previewInvite: (input) => invokeRequest(IPC_CHANNELS.serversPreviewInvite, decodeInvitePreview, input),
    takePendingInvite: () => invokeRequest(IPC_CHANNELS.serversTakePendingInvite, decodePendingInvite),
    login: async (input) => {
      const server = await invokeRequest(IPC_CHANNELS.serversLogin, decodeServer, input);
      selectedServerId = server.id;
      return server;
    },
    retryConnection: (serverId) => invokeRequest(IPC_CHANNELS.serversRetryConnection, decodeServer, serverId),
    remove: (serverId) => invokeRequest(IPC_CHANNELS.serversRemove, decodeVoid, serverId),
    getPresence: () => invokeRequest(IPC_CHANNELS.serversGetPresence, decodeTeamPresenceSnapshot),
    getPresenceFor: (serverId) =>
      invokeRequest(IPC_CHANNELS.serversGetPresenceFor, decodeTeamPresenceSnapshot, serverId),
    refreshIdentity: (serverId) => invokeRequest(IPC_CHANNELS.serversRefreshIdentity, decodeServer, serverId),
    listMembers: (serverId) => invokeRequest(IPC_CHANNELS.serversListMembers, decodeTeamMembers, serverId),
    updateMember: (serverId, input) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.serversUpdateMember, input, decodeTeamMember),
    removeMember: (serverId, memberId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.serversRemoveMember, memberId, decodeVoid),
    listInvites: (serverId) => invokeRequest(IPC_CHANNELS.serversListInvites, decodeTeamInvites, serverId),
    revokeInvite: (serverId, inviteId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.serversRevokeInvite, inviteId, decodeVoid),
    createInvite: (serverId, input) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.serversCreateInvite, input, decodeInviteSummary),
    setTyping: (input) => invokeRequest(IPC_CHANNELS.serversSetTyping, decodeVoid, input),
    onPresence: (listener, serverId) =>
      subscribe(IPC_CHANNELS.serversPresence, decodeScopedTeamPresence, (scoped) => {
        if (scoped.serverId === (serverId ?? selectedServerId)) listener(scoped.snapshot);
      }),
    listDirectThreads: () => invokeRequest(IPC_CHANNELS.serversListDirectThreads, decodeDirectThreads),
    readDirectConversation: (memberId) =>
      invokeRequest(IPC_CHANNELS.serversReadDirectConversation, decodeDirectConversation, memberId),
    readDirectConversationPage: (input) =>
      invokeRequest(IPC_CHANNELS.serversReadDirectConversationPage, decodeDirectConversationPage, input),
    sendDirectMessage: (input) => invokeRequest(IPC_CHANNELS.serversSendDirectMessage, decodeDirectMessage, input),
    markDirectRead: (input) => invokeRequest(IPC_CHANNELS.serversMarkDirectRead, decodeDirectReadState, input),
    setDirectTyping: (input) => invokeRequest(IPC_CHANNELS.serversSetDirectTyping, decodeVoid, input),
    onDirectMessage: (listener) =>
      subscribe(IPC_CHANNELS.serversDirectMessage, decodeScopedDirectMessage, (scoped) => {
        if (scoped.serverId === selectedServerId) listener(scoped.event);
      }),
    onDirectTyping: (listener) =>
      subscribe(IPC_CHANNELS.serversDirectTyping, decodeScopedDirectTyping, (scoped) => {
        if (scoped.serverId === selectedServerId) listener(scoped.event);
      }),
    onEvent: (listener) =>
      subscribe(IPC_CHANNELS.serversEvent, decodeServers, (servers) => listener(rememberActiveServer(servers))),
    onInvite: (listener) => subscribe(IPC_CHANNELS.serversInvite, decodeInviteUrl, listener),
  },
  plugins: {
    takePendingListing: () => invokeRequest(IPC_CHANNELS.pluginsTakePendingListing, decodePendingListing),
    onOpenListing: (listener) =>
      listen(IPC_CHANNELS.pluginsOpenListing, (slug) => {
        if (typeof slug === "string" && isPluginSlug(slug)) listener(slug);
      }),
  },
  host: {
    getStatus: () => invokeRequest(IPC_CHANNELS.hostGetStatus, decodeHostStatus),
    configure: (input) => invokeRequest(IPC_CHANNELS.hostConfigure, decodeHostStatus, input),
    updateIdentity: (input) => invokeRequest(IPC_CHANNELS.hostUpdateIdentity, decodeHostStatus, input),
    getPresence: () => invokeRequest(IPC_CHANNELS.hostGetPresence, decodeTeamPresenceSnapshot),
    start: () => invokeRequest(IPC_CHANNELS.hostStart, decodeHostStatus),
    stop: () => invokeRequest(IPC_CHANNELS.hostStop, decodeHostStatus),
    recheckScreenRecording: () => invokeRequest(IPC_CHANNELS.hostRecheckScreenRecording, decodeHostStatus),
    listMembers: () => invokeRequest(IPC_CHANNELS.hostListMembers, decodeTeamMembers),
    updateMember: (input) => invokeRequest(IPC_CHANNELS.hostUpdateMember, decodeTeamMember, input),
    removeMember: (memberId) => invokeRequest(IPC_CHANNELS.hostRemoveMember, decodeVoid, memberId),
    listSessions: () => invokeRequest(IPC_CHANNELS.hostListSessions, decodeTeamSessions),
    revokeSession: (sessionId) => invokeRequest(IPC_CHANNELS.hostRevokeSession, decodeVoid, sessionId),
    listInvites: () => invokeRequest(IPC_CHANNELS.hostListInvites, decodeTeamInvites),
    revokeInvite: (inviteId) => invokeRequest(IPC_CHANNELS.hostRevokeInvite, decodeVoid, inviteId),
    createInvite: (input) => invokeRequest(IPC_CHANNELS.hostCreateInvite, decodeInviteSummary, input),
    onEvent: (listener) => subscribe(IPC_CHANNELS.hostEvent, decodeHostStatus, listener),
  },
  // The shared contract decoder, as MCP does: it already bounds every row, and a remote answer was
  // decoded in main before it reached this point.
  storage: {
    getUsage: (input, serverId) =>
      invokeAgentForServer(serverId, IPC_CHANNELS.storageGetUsage, input, decodeOptionalStorageUsage),
    deleteFile: (input, serverId) => invokeAgentForServer(serverId, IPC_CHANNELS.storageDeleteFile, input, decodeVoid),
    clear: (input, serverId) => invokeAgentForServer(serverId, IPC_CHANNELS.storageClear, input, decodeVoid),
    openFile: (input, serverId) => invokeAgentForServer(serverId, IPC_CHANNELS.storageOpenFile, input, decodeVoid),
    openLocation: (input) => invokeRequest(IPC_CHANNELS.storageOpenLocation, decodeVoid, input),
  },
  remoteDesktop: {
    checkSetup: (serverId) =>
      invokeRequest(IPC_CHANNELS.remoteDesktopCheckSetup, decodeRemoteDesktopSetupFromMain, serverId),
    openSetup: (action) => invokeRequest(IPC_CHANNELS.remoteDesktopOpenSetup, decodeVoid, action),
    test: (input) => invokeRequest(IPC_CHANNELS.remoteDesktopTest, decodeRemoteDesktopTestFromMain, input),
    list: () => invokeRequest(IPC_CHANNELS.remoteDesktopList, decodeRemoteDesktopSessions),
    connect: (input) => invokeRequest(IPC_CHANNELS.remoteDesktopConnect, decodeRemoteDesktopConnectResult, input),
    selectDisplay: (input) => invokeRequest(IPC_CHANNELS.remoteDesktopSelectDisplay, decodeVoid, input),
    disconnect: (sessionId) => invokeRequest(IPC_CHANNELS.remoteDesktopDisconnect, decodeVoid, sessionId),
    onEvent: (listener) => subscribe(IPC_CHANNELS.remoteDesktopEvent, decodeRemoteDesktopSessions, listener),
  },
};

contextBridge.exposeInMainWorld("openbot", openbotApi);
