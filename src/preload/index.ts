import { isAgentTemplateId } from "@openbot/contracts/agent-template-links";
import {
  type AgentIpcRequest,
  type AttachmentImportEvent,
  decodeAgentImportPreview,
  decodeAgentImportResult,
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
  type EventEndpoint,
  type ImportAttachmentsInput,
  IPC_ENDPOINTS,
  LOCAL_SERVER_ID,
  type OpenBotDesktopApi,
  type RequestEndpoint,
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
  decodeAgentImportSkill,
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
  decodePendingAgentTemplate,
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
  decodeAgentTemplateDetail,
  decodeAgentTemplatePreview,
  decodeAgentTemplatePublication,
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
// The payload and result come from the endpoint alone. `NoInfer` keeps a decoder or an argument from
// widening them, so a decoder that returns less than the endpoint promises is a type error.
type PayloadArgs<Payload> = [Payload] extends [undefined] ? [] : [payload: Payload];

function invokeRequest<Payload, Result>(
  endpoint: RequestEndpoint<string, Payload, Result>,
  decode: (value: unknown) => NoInfer<Result>,
  ...payload: PayloadArgs<NoInfer<Payload>>
): Promise<Result> {
  return ipcRenderer.invoke(endpoint.channel, ...payload).then(decode);
}

function invokeAgent<Input, Result>(
  endpoint: RequestEndpoint<string, AgentIpcRequest<Input>, Result>,
  payload: NoInfer<Input>,
  decode: (value: unknown) => NoInfer<Result>,
): Promise<Result> {
  const request: AgentIpcRequest<Input> = { serverId: selectedServerId, payload };
  return ipcRenderer.invoke(endpoint.channel, request).then(decode);
}

function invokeAgentForServer<Input, Result>(
  serverId: string,
  endpoint: RequestEndpoint<string, AgentIpcRequest<Input>, Result>,
  payload: NoInfer<Input>,
  decode: (value: unknown) => NoInfer<Result>,
): Promise<Result> {
  const request: AgentIpcRequest<Input> = { serverId, payload };
  return ipcRenderer.invoke(endpoint.channel, request).then(decode);
}

// The one place the preload subscribes to main. It hands on the raw value, so a caller that keeps
// only one server's events can decode and check it before the renderer sees it.
function listen(endpoint: EventEndpoint, onValue: (value: unknown) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: unknown) => onValue(value);
  ipcRenderer.on(endpoint.channel, handler);
  return () => ipcRenderer.removeListener(endpoint.channel, handler);
}

function subscribe<Payload>(
  endpoint: EventEndpoint<string, Payload>,
  decode: (value: unknown) => NoInfer<Payload>,
  listener: (payload: NoInfer<Payload>) => void,
): () => void {
  return listen(endpoint, (value) => listener(decode(value)));
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
      IPC_ENDPOINTS.agentAttachments.importAttachments,
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
  getAppInfo: () => invokeRequest(IPC_ENDPOINTS.app.getAppInfo, decodeAppInfo),
  getSetupState: () => invokeRequest(IPC_ENDPOINTS.app.getSetupState, decodeAppSetupState),
  saveSetup: (input) => invokeRequest(IPC_ENDPOINTS.app.saveSetup, decodeAppSetupState, input),
  getAnalyticsPreference: () => invokeRequest(IPC_ENDPOINTS.app.getAnalyticsPreference, decodeAnalyticsPreference),
  setAnalyticsPreference: (input) =>
    invokeRequest(IPC_ENDPOINTS.app.setAnalyticsPreference, decodeAnalyticsPreference, input),
  getApprovalAutomation: () =>
    invokeRequest(IPC_ENDPOINTS.app.getApprovalAutomation, decodeApprovalAutomationPreference),
  setApprovalAutomation: (input) =>
    invokeRequest(IPC_ENDPOINTS.app.setApprovalAutomation, decodeApprovalAutomationPreference, input),
  getAppLanguagePreference: () =>
    invokeRequest(IPC_ENDPOINTS.app.getAppLanguagePreference, decodeAppLanguagePreference),
  setAppLanguagePreference: (input) =>
    invokeRequest(IPC_ENDPOINTS.app.setAppLanguagePreference, decodeAppLanguagePreference, input),
  onAppLanguagePreference: (listener) =>
    subscribe(IPC_ENDPOINTS.app.appLanguagePreference, decodeAppLanguagePreference, listener),
  onOpenSettings: (listener) => listen(IPC_ENDPOINTS.app.openSettings, () => listener()),
  dynamicIsland: {
    getPreference: () => invokeRequest(IPC_ENDPOINTS.dynamicIsland.getPreference, decodeDynamicIslandPreference),
    setPreference: (input) =>
      invokeRequest(IPC_ENDPOINTS.dynamicIsland.setPreference, decodeDynamicIslandPreference, input),
    publishPresentation: (presentation) =>
      invokeRequest(IPC_ENDPOINTS.dynamicIsland.publishPresentation, decodeVoid, presentation),
    getPresentation: () => invokeRequest(IPC_ENDPOINTS.dynamicIsland.getPresentation, decodeDynamicIslandPresentation),
    onPreference: (listener) =>
      subscribe(IPC_ENDPOINTS.dynamicIsland.preference, decodeDynamicIslandPreference, listener),
    onPresentation: (listener) =>
      subscribe(IPC_ENDPOINTS.dynamicIsland.presentation, decodeDynamicIslandPresentation, listener),
    onGeometry: (listener) => subscribe(IPC_ENDPOINTS.dynamicIsland.geometry, decodeDynamicIslandGeometry, listener),
    performAction: (action) => invokeRequest(IPC_ENDPOINTS.dynamicIsland.performAction, decodeVoid, action),
    performHaptic: () => invokeRequest(IPC_ENDPOINTS.dynamicIsland.performHaptic, decodeVoid),
    onAction: (listener) => subscribe(IPC_ENDPOINTS.dynamicIsland.action, decodeDynamicIslandAction, listener),
    setInteractive: (input) => invokeRequest(IPC_ENDPOINTS.dynamicIsland.setInteractive, decodeVoid, input),
  },
  getComputerUseState: () => invokeRequest(IPC_ENDPOINTS.computerUse.getState, decodeComputerUseState),
  openComputerUsePermissionPane: (permission) =>
    invokeRequest(IPC_ENDPOINTS.computerUse.openPermissionPane, decodeComputerUseState, permission),
  closeComputerUsePermissionHelp: () => invokeRequest(IPC_ENDPOINTS.computerUse.closePermissionHelp, decodeVoid),
  getComputerUsePermissionApp: () =>
    invokeRequest(IPC_ENDPOINTS.computerUse.getPermissionApp, decodeComputerUsePermissionApp),
  startComputerUsePermissionAppDrag: () => invokeRequest(IPC_ENDPOINTS.computerUse.startPermissionAppDrag, decodeVoid),
  revealComputerUsePermissionApp: () => invokeRequest(IPC_ENDPOINTS.computerUse.revealPermissionApp, decodeVoid),
  onComputerUseHighlightPlacement: (listener) =>
    subscribe(IPC_ENDPOINTS.computerUse.highlightPlacement, decodeComputerUseHighlightPlacement, listener),
  openExternal: (destination) => invokeRequest(IPC_ENDPOINTS.app.openExternal, decodeVoid, destination),
  connectProvider: (provider) =>
    invokeRequest(IPC_ENDPOINTS.providers.connectProvider, decodeAgentStatusFromMain, provider),
  updateProviderCli: (provider) =>
    invokeRequest(IPC_ENDPOINTS.providers.updateProviderCli, decodeAgentStatusFromMain, provider),
  refreshAgentProviders: () => invokeRequest(IPC_ENDPOINTS.providers.refreshAgentProviders, decodeAgentStatusFromMain),
  setProviderApiKey: (input) =>
    invokeRequest(IPC_ENDPOINTS.providers.setProviderApiKey, decodeAgentStatusFromMain, input),
  clearProviderApiKey: (provider) =>
    invokeRequest(IPC_ENDPOINTS.providers.clearProviderApiKey, decodeAgentStatusFromMain, provider),
  getProviderApiKeyState: (provider) =>
    invokeRequest(IPC_ENDPOINTS.providers.getProviderApiKeyState, decodeProviderApiKeyState, provider),
  startProviderCodeLogin: (provider) =>
    invokeRequest(IPC_ENDPOINTS.providers.startProviderCodeLogin, decodeProviderCodeLoginStart, provider),
  cancelProviderCodeLogin: (provider) =>
    invokeRequest(IPC_ENDPOINTS.providers.cancelProviderCodeLogin, decodeAgentStatusFromMain, provider),
  providerRuntimes: {
    getStatus: () => invokeRequest(IPC_ENDPOINTS.providerRuntimes.getStatus, decodeProviderRuntimeSnapshot),
    download: (provider) =>
      invokeRequest(IPC_ENDPOINTS.providerRuntimes.download, decodeProviderRuntimeSnapshot, provider),
    cancel: (provider) => invokeRequest(IPC_ENDPOINTS.providerRuntimes.cancel, decodeProviderRuntimeSnapshot, provider),
    checkForUpdates: () => invokeRequest(IPC_ENDPOINTS.providerRuntimes.checkForUpdates, decodeProviderRuntimeSnapshot),
    onEvent: (listener) => subscribe(IPC_ENDPOINTS.providerRuntimes.event, decodeProviderRuntimeSnapshot, listener),
  },
  openUrl: (url) => invokeRequest(IPC_ENDPOINTS.app.openUrl, decodeVoid, url),
  voice: {
    getModelStatus: () => invokeRequest(IPC_ENDPOINTS.voice.getModelStatus, decodeVoiceModelStatus),
    prepareModel: () => invokeRequest(IPC_ENDPOINTS.voice.prepareModel, decodeVoiceModelStatus),
    transcribe: (input) => invokeRequest(IPC_ENDPOINTS.voice.transcribe, decodeVoiceTranscriptionResult, input),
    onModelStatus: (listener) => subscribe(IPC_ENDPOINTS.voice.modelStatus, decodeVoiceModelStatus, listener),
  },
  auth: {
    getState: () => invokeRequest(IPC_ENDPOINTS.auth.getState, decodeCentralAuthState),
    retry: () => invokeRequest(IPC_ENDPOINTS.auth.retry, decodeCentralAuthState),
    requestEmailCode: (email) => invokeRequest(IPC_ENDPOINTS.auth.requestEmailCode, decodeCentralAuthState, email),
    verifyEmailCode: (challengeId, code) =>
      invokeRequest(IPC_ENDPOINTS.auth.verifyEmailCode, decodeCentralAuthState, { challengeId, code }),
    updateName: (name) => invokeRequest(IPC_ENDPOINTS.auth.updateName, decodeCentralAuthState, name),
    updateAvatar: (image) => invokeRequest(IPC_ENDPOINTS.auth.updateAvatar, decodeCentralAuthState, image),
    createMobileConnect: () => invokeRequest(IPC_ENDPOINTS.auth.createMobileConnect, decodeMobileConnectTicket),
    listMobileConnectedDevices: () =>
      invokeRequest(IPC_ENDPOINTS.auth.listMobileConnectedDevices, decodeMobileConnectedDevices),
    listAccountSessions: () => invokeRequest(IPC_ENDPOINTS.auth.listAccountSessions, decodeAccountSessions),
    revokeAccountSession: (sessionId) => invokeRequest(IPC_ENDPOINTS.auth.revokeAccountSession, decodeVoid, sessionId),
    revokeMobileConnectedDevice: (sessionId) =>
      invokeRequest(IPC_ENDPOINTS.auth.revokeMobileConnectedDevice, decodeVoid, sessionId),
    logout: () => invokeRequest(IPC_ENDPOINTS.auth.logout, decodeCentralAuthState),
    onEvent: (listener) => subscribe(IPC_ENDPOINTS.auth.event, decodeCentralAuthState, listener),
  },
  skills: {
    localList: () => invokeRequest(IPC_ENDPOINTS.skills.localList, decodeSkillDetails),
    localGet: (input) => invokeRequest(IPC_ENDPOINTS.skills.localGet, decodeSkillDetail, input),
    localCreate: (input) => invokeRequest(IPC_ENDPOINTS.skills.localCreate, decodeSkillDetail, input),
    localRevise: (input) => invokeRequest(IPC_ENDPOINTS.skills.localRevise, decodeSkillDetail, input),
    localInstall: (input) => invokeRequest(IPC_ENDPOINTS.skills.localInstall, decodeInstalledSkill, input),
    list: (query) => invokeRequest(IPC_ENDPOINTS.skills.list, decodeSkillPage, query),
    get: (skillId) => invokeRequest(IPC_ENDPOINTS.skills.get, decodeSkillDetail, skillId),
    listMine: () => invokeRequest(IPC_ENDPOINTS.skills.listMine, decodeSubmissions),
    choosePackage: () => invokeRequest(IPC_ENDPOINTS.skills.choosePackage, decodeSkillPreview),
    submit: (input) => invokeRequest(IPC_ENDPOINTS.skills.submit, decodeSubmission, input),
    listInstalled: (agentId) =>
      invokeRequest(IPC_ENDPOINTS.skills.listInstalled, decodeInstalledSkillsFromMain, agentId),
    install: (input) => invokeRequest(IPC_ENDPOINTS.skills.install, decodeInstalledSkill, input),
    uninstall: (input) => invokeRequest(IPC_ENDPOINTS.skills.uninstall, decodeVoid, input),
    setEnabled: (input) => invokeRequest(IPC_ENDPOINTS.skills.setEnabled, decodeInstalledSkill, input),
  },
  hostedSites: {
    list: () => invokeRequest(IPC_ENDPOINTS.hostedSites.list, decodeHostedSites),
    chooseDirectory: () => invokeRequest(IPC_ENDPOINTS.hostedSites.chooseDirectory, decodeNullablePath),
    publish: (input) => invokeRequest(IPC_ENDPOINTS.hostedSites.publish, decodeHostedSite, input),
    replace: (input) => invokeRequest(IPC_ENDPOINTS.hostedSites.replace, decodeHostedSite, input),
    delete: (input) => invokeRequest(IPC_ENDPOINTS.hostedSites.delete, decodeVoid, input),
  },
  customProviders: {
    list: () => invokeRequest(IPC_ENDPOINTS.customProviders.list, decodeCustomProviders),
    save: (input) => invokeRequest(IPC_ENDPOINTS.customProviders.save, decodeCustomProviderResult, input),
    delete: (input) => invokeRequest(IPC_ENDPOINTS.customProviders.delete, decodeCustomProviderResult, input),
  },
  agentImport: {
    choose: () => invokeRequest(IPC_ENDPOINTS.agentImport.choose, decodeAgentImportPreview),
    apply: (input) => invokeRequest(IPC_ENDPOINTS.agentImport.apply, decodeAgentImportResult, input),
    discard: (token) => invokeRequest(IPC_ENDPOINTS.agentImport.discard, decodeVoid, token),
    readSkill: () => invokeRequest(IPC_ENDPOINTS.agentImport.readSkill, decodeAgentImportSkill),
    saveSkill: () => invokeRequest(IPC_ENDPOINTS.agentImport.saveSkill, decodeExportResult),
  },
  marketplaceAgents: {
    list: (query) => invokeRequest(IPC_ENDPOINTS.marketplaceAgents.list, decodeMarketplaceAgentPage, query),
    get: (agentId) => invokeRequest(IPC_ENDPOINTS.marketplaceAgents.get, decodeMarketplaceAgentDetail, agentId),
    listMine: () => invokeRequest(IPC_ENDPOINTS.marketplaceAgents.listMine, decodeAgentSubmissions),
    preview: (agentId) =>
      invokeRequest(IPC_ENDPOINTS.marketplaceAgents.preview, decodeAgentPublicationPreview, agentId),
    submit: (input) => invokeRequest(IPC_ENDPOINTS.marketplaceAgents.submit, decodeAgentSubmission, input),
    install: (input) => invokeRequest(IPC_ENDPOINTS.marketplaceAgents.install, decodeAgentInstallation, input),
  },
  agentTemplates: {
    preview: (agentId) => invokeRequest(IPC_ENDPOINTS.agentTemplates.preview, decodeAgentTemplatePreview, agentId),
    publish: (input) => invokeRequest(IPC_ENDPOINTS.agentTemplates.publish, decodeAgentTemplatePublication, input),
    unpublish: (agentId) => invokeRequest(IPC_ENDPOINTS.agentTemplates.unpublish, decodeVoid, agentId),
    get: (templateId) => invokeRequest(IPC_ENDPOINTS.agentTemplates.get, decodeAgentTemplateDetail, templateId),
    install: (input) => invokeRequest(IPC_ENDPOINTS.agentTemplates.install, decodeAgentInstallation, input),
    takePendingLink: () => invokeRequest(IPC_ENDPOINTS.agentTemplates.takePendingLink, decodePendingAgentTemplate),
    onOpenLink: (listener) =>
      listen(IPC_ENDPOINTS.agentTemplates.openLink, (id) => {
        if (typeof id === "string" && isAgentTemplateId(id)) listener(id);
      }),
  },
  agent: {
    getStatus: () => invokeAgent(IPC_ENDPOINTS.agent.getStatus, null, decodeAgentStatusFromMain),
    getHostAnalytics: (input, serverId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.agent.getHostAnalytics, input, decodeHostAnalyticsFromMain),
    getAnalytics: (input, serverId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.agent.getAnalytics, input, decodeAgentAnalyticsFromMain),
    getUsage: (agentId) => invokeAgent(IPC_ENDPOINTS.agent.getUsage, agentId, decodeAccountUsageFromMain),
    listModels: () => invokeAgent(IPC_ENDPOINTS.agent.listModels, null, decodeAgentModels),
    listAgents: (serverId) =>
      serverId === undefined
        ? invokeAgent(IPC_ENDPOINTS.agent.list, null, decodeAgents)
        : invokeAgentForServer(serverId, IPC_ENDPOINTS.agent.list, null, decodeAgents),
    listInstalledSkills: (agentId) =>
      invokeAgent(IPC_ENDPOINTS.agent.listInstalledSkills, agentId, decodeInstalledSkillsFromMain),
    listChannels: () => invokeAgent(IPC_ENDPOINTS.agent.listChannels, null, decodeChannelSummaries),
    readChannel: (input) => invokeAgent(IPC_ENDPOINTS.agent.readChannel, input, decodeChannelPage),
    channelCommand: (input) => invokeAgent(IPC_ENDPOINTS.agent.channelCommand, input, decodeChannel),
    deleteChannel: (channelId) => invokeAgent(IPC_ENDPOINTS.agent.deleteChannel, channelId, decodeVoid),
    getSidebarLayout: () => invokeAgent(IPC_ENDPOINTS.agent.getSidebarLayout, null, decodeSidebarLayout),
    mutateSidebarLayout: (action) => invokeAgent(IPC_ENDPOINTS.agent.mutateSidebarLayout, action, decodeSidebarLayout),
    generateProfile: (input) => invokeAgent(IPC_ENDPOINTS.agent.generateProfile, input, decodeAgentProfileDraft),
    saveProfile: (input) => invokeAgent(IPC_ENDPOINTS.agent.saveProfile, input, decodeSaveAgentProfileResult),
    createAgent: (input) => invokeAgent(IPC_ENDPOINTS.agent.create, input, decodeAgent),
    duplicateAgent: (agentId) =>
      invokeAgent(IPC_ENDPOINTS.agent.duplicate, agentId, decodeDuplicateAgentResultFromMain),
    updateAgent: (input) => invokeAgent(IPC_ENDPOINTS.agent.update, input, decodeAgent),
    setAvatar: (input) => invokeAgent(IPC_ENDPOINTS.agent.setAvatar, input, decodeAgent),
    deleteAgent: (agentId) => invokeAgent(IPC_ENDPOINTS.agent.delete, agentId, decodeVoid),
    listMemories: (agentId) => invokeAgent(IPC_ENDPOINTS.agentMemories.listMemories, agentId, decodeMemories),
    createMemory: (input) => invokeAgent(IPC_ENDPOINTS.agentMemories.createMemory, input, decodeMemory),
    updateMemory: (input) => invokeAgent(IPC_ENDPOINTS.agentMemories.updateMemory, input, decodeMemory),
    deleteMemory: (input) => invokeAgent(IPC_ENDPOINTS.agentMemories.deleteMemory, input, decodeVoid),
    clearMemories: (agentId) => invokeAgent(IPC_ENDPOINTS.agentMemories.clearMemories, agentId, decodeVoid),
    listTables: () => invokeAgent(IPC_ENDPOINTS.sharedTables.listTables, null, decodeTables),
    deleteTable: (input) => invokeAgent(IPC_ENDPOINTS.sharedTables.deleteTable, input, decodeVoid),
    listRoutines: (agentId) => invokeAgent(IPC_ENDPOINTS.agentRoutines.listRoutines, agentId, decodeRoutines),
    createRoutine: (input) => invokeAgent(IPC_ENDPOINTS.agentRoutines.createRoutine, input, decodeRoutine),
    updateRoutine: (input) => invokeAgent(IPC_ENDPOINTS.agentRoutines.updateRoutine, input, decodeRoutine),
    deleteRoutine: (input) => invokeAgent(IPC_ENDPOINTS.agentRoutines.deleteRoutine, input, decodeVoid),
    testRoutine: (input) => invokeAgent(IPC_ENDPOINTS.agentRoutines.testRoutine, input, decodeRoutineRun),
    listRoutineRuns: (input) => invokeAgent(IPC_ENDPOINTS.agentRoutines.listRoutineRuns, input, decodeRoutineRuns),
    listChannelMemories: (channelId) =>
      invokeAgent(IPC_ENDPOINTS.channelMemories.listChannelMemories, channelId, decodeChannelMemories),
    createChannelMemory: (input) =>
      invokeAgent(IPC_ENDPOINTS.channelMemories.createChannelMemory, input, decodeChannelMemory),
    updateChannelMemory: (input) =>
      invokeAgent(IPC_ENDPOINTS.channelMemories.updateChannelMemory, input, decodeChannelMemory),
    deleteChannelMemory: (input) => invokeAgent(IPC_ENDPOINTS.channelMemories.deleteChannelMemory, input, decodeVoid),
    clearChannelMemories: (channelId) =>
      invokeAgent(IPC_ENDPOINTS.channelMemories.clearChannelMemories, channelId, decodeVoid),
    listChannelRoutines: (channelId) =>
      invokeAgent(IPC_ENDPOINTS.channelRoutines.listChannelRoutines, channelId, decodeChannelRoutines),
    createChannelRoutine: (input) =>
      invokeAgent(IPC_ENDPOINTS.channelRoutines.createChannelRoutine, input, decodeChannelRoutine),
    updateChannelRoutine: (input) =>
      invokeAgent(IPC_ENDPOINTS.channelRoutines.updateChannelRoutine, input, decodeChannelRoutine),
    deleteChannelRoutine: (input) => invokeAgent(IPC_ENDPOINTS.channelRoutines.deleteChannelRoutine, input, decodeVoid),
    testChannelRoutine: (input) =>
      invokeAgent(IPC_ENDPOINTS.channelRoutines.testChannelRoutine, input, decodeChannelRoutineRun),
    listChannelRoutineRuns: (input) =>
      invokeAgent(IPC_ENDPOINTS.channelRoutines.listChannelRoutineRuns, input, decodeChannelRoutineRuns),
    // `invokeAgentForServer`, never `invokeAgent`: the settings modal can be open for a server the
    // user has not switched to, and `invokeAgent` would pin the selected one.
    listMcpServers: (serverId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.mcpServers.list, null, decodeMcpServerConfigs),
    saveMcpServer: (input, serverId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.mcpServers.save, input, decodeMcpServerConfigs),
    removeMcpServer: (input, serverId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.mcpServers.remove, input, decodeMcpServerConfigs),
    setMcpServerEnabled: (input, serverId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.mcpServers.setEnabled, input, decodeMcpServerConfigs),
    testMcpServer: (input, serverId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.mcpServers.test, input, decodeMcpTestResult),
    readConversation: (agentId) => invokeAgent(IPC_ENDPOINTS.agent.readConversation, agentId, decodeConversation),
    readConversationPage: (input, serverId = selectedServerId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.agent.readConversationPage, input, decodeConversationPageFromMain),
    searchConversationMessages: (input) =>
      invokeAgent(IPC_ENDPOINTS.agent.searchConversationMessages, input, decodeConversationSearchPageFromMain),
    listConversationReads: () => invokeAgent(IPC_ENDPOINTS.agent.listConversationReads, null, decodeReadStates),
    markConversationRead: (input, serverId = selectedServerId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.agent.markConversationRead, input, decodeReadState),
    chooseAttachments: (input) =>
      invokeAgent(IPC_ENDPOINTS.agentAttachments.chooseAttachments, input, decodeAttachments),
    onAttachmentImport: (listener) => {
      attachmentImportListeners.add(listener);
      return () => attachmentImportListeners.delete(listener);
    },
    discardDraftAttachment: (attachmentId, serverId = selectedServerId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.agentAttachments.discardDraftAttachment, attachmentId, decodeVoid),
    downloadAttachments: (input) => invokeAgent(IPC_ENDPOINTS.agentAttachments.downloadAttachments, input, decodeVoid),
    openAttachment: (input) => invokeAgent(IPC_ENDPOINTS.agentAttachments.openAttachment, input, decodeVoid),
    openSharedFile: (input) => invokeAgent(IPC_ENDPOINTS.agentAttachments.openSharedFile, input, decodeVoid),
    openWorkspaceFile: (input) => invokeAgent(IPC_ENDPOINTS.agentAttachments.openWorkspaceFile, input, decodeVoid),
    previewSharedFile: (input) =>
      invokeAgent(IPC_ENDPOINTS.agentAttachments.previewSharedFile, input, decodeFilePreview),
    previewWorkspaceFile: (input) =>
      invokeAgent(IPC_ENDPOINTS.agentAttachments.previewWorkspaceFile, input, decodeFilePreview),
    sendMessage: (input, serverId = selectedServerId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.agent.sendMessage, input, decodeReceipt),
    setMessageReaction: (input) => invokeAgent(IPC_ENDPOINTS.agent.setMessageReaction, input, decodeVoid),
    listQueue: (agentId) => invokeAgent(IPC_ENDPOINTS.agent.listQueue, agentId, decodeQueue),
    acknowledgeFailedTurn: (input) => invokeAgent(IPC_ENDPOINTS.agent.acknowledgeFailedTurn, input, decodeVoid),
    cancelQueuedMessage: (input) => invokeAgent(IPC_ENDPOINTS.agent.cancelQueuedMessage, input, decodeVoid),
    steerQueuedMessage: (input) => invokeAgent(IPC_ENDPOINTS.agent.steerQueuedMessage, input, decodeVoid),
    editQueuedMessage: (input, serverId = selectedServerId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.agent.editQueuedMessage, input, decodeQueue),
    updateQueuedMessage: (input, serverId = selectedServerId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.agent.updateQueuedMessage, input, decodeVoid),
    reorderQueue: (input) => invokeAgent(IPC_ENDPOINTS.agent.reorderQueue, input, decodeVoid),
    interrupt: (input) => invokeAgent(IPC_ENDPOINTS.agent.interrupt, input, decodeVoid),
    respondToPrompt: (input) => invokeAgent(IPC_ENDPOINTS.agent.respondToPrompt, input, decodeVoid),
    respondToApproval: (input) => invokeAgent(IPC_ENDPOINTS.agent.respondToApproval, input, decodeVoid),
    respondToBrowserSecret: (input) => invokeAgent(IPC_ENDPOINTS.agent.respondToBrowserSecret, input, decodeVoid),
    respondToBrowserTakeover: (input) => invokeAgent(IPC_ENDPOINTS.agent.respondToBrowserTakeover, input, decodeVoid),
    onEvent: (listener) =>
      subscribe(IPC_ENDPOINTS.agent.event, decodeScopedAgentEvent, (payload) => {
        if (payload.serverId === selectedServerId) listener(payload.event);
      }),
    onScopedEvent: (listener) => subscribe(IPC_ENDPOINTS.agent.event, decodeScopedAgentEvent, listener),
  },
  browser: {
    open: (input) => invokeRequest(IPC_ENDPOINTS.browser.open, decodeBrowserTab, input),
    activate: (tabId) => invokeRequest(IPC_ENDPOINTS.browser.activate, decodeVoid, tabId),
    navigate: (input) => invokeRequest(IPC_ENDPOINTS.browser.navigate, decodeVoid, input),
    reload: (tabId) => invokeRequest(IPC_ENDPOINTS.browser.reload, decodeVoid, tabId),
    close: (tabId) => invokeRequest(IPC_ENDPOINTS.browser.close, decodeVoid, tabId),
    listTabs: () => invokeRequest(IPC_ENDPOINTS.browser.listTabs, decodeBrowserTabs),
    getDisplayState: () => invokeRequest(IPC_ENDPOINTS.browser.getDisplayState, decodeBrowserDisplayState),
    getControlState: () => invokeRequest(IPC_ENDPOINTS.browser.getControlState, decodeBrowserControlState),
    capturePreview: (tabId) => invokeRequest(IPC_ENDPOINTS.browser.capturePreview, decodeBrowserPreviewFromMain, tabId),
    setVisible: (input) => invokeRequest(IPC_ENDPOINTS.browser.setVisible, decodeVoid, input),
    startLiveView: (tabId) => invokeRequest(IPC_ENDPOINTS.browser.startLiveView, decodeVoid, tabId),
    stopLiveView: () => invokeRequest(IPC_ENDPOINTS.browser.stopLiveView, decodeVoid),
    // Untyped: the renderer and wire input shapes differ on purpose. See `IPC_ENDPOINTS.browser`.
    sendLiveViewInput: (input) =>
      ipcRenderer.invoke(IPC_ENDPOINTS.browser.sendLiveViewInput.channel, input).then(decodeVoid),
    onLiveViewEvent: (listener) => subscribe(IPC_ENDPOINTS.browser.liveViewEvent, decodeBrowserLiveViewEvent, listener),
    onDisplayState: (listener) =>
      subscribe(IPC_ENDPOINTS.browser.displayStateEvent, decodeBrowserDisplayState, listener),
    openPictureInPicture: (bounds) =>
      invokeRequest(IPC_ENDPOINTS.browser.pictureInPictureOpen, decodeBrowserBounds, bounds),
    closePictureInPicture: () => invokeRequest(IPC_ENDPOINTS.browser.pictureInPictureClose, decodeVoid),
    dockPictureInPicture: () => invokeRequest(IPC_ENDPOINTS.browser.pictureInPictureDock, decodeVoid),
    hidePictureInPicture: () => invokeRequest(IPC_ENDPOINTS.browser.pictureInPictureHide, decodeVoid),
    onPictureInPictureEvent: (listener) =>
      subscribe(IPC_ENDPOINTS.browser.pictureInPictureEvent, decodeBrowserPictureInPictureEvent, listener),
  },
  update: {
    getStatus: () => invokeRequest(IPC_ENDPOINTS.update.getStatus, decodeUpdateStatus),
    check: () => invokeRequest(IPC_ENDPOINTS.update.check, decodeUpdateStatus),
    download: () => invokeRequest(IPC_ENDPOINTS.update.download, decodeUpdateStatus),
    install: () => invokeRequest(IPC_ENDPOINTS.update.install, decodeVoid),
    getPreference: () => invokeRequest(IPC_ENDPOINTS.update.getPreference, decodeUpdatePreference),
    setPreference: (input) => invokeRequest(IPC_ENDPOINTS.update.setPreference, decodeUpdatePreference, input),
    onEvent: (listener) => subscribe(IPC_ENDPOINTS.update.event, decodeUpdateStatus, listener),
  },
  notifications: {
    getPreference: () => invokeRequest(IPC_ENDPOINTS.notifications.getPreference, decodeNotificationPreference),
    setPreference: (input) =>
      invokeRequest(IPC_ENDPOINTS.notifications.setPreference, decodeNotificationPreference, input),
    test: () => invokeRequest(IPC_ENDPOINTS.notifications.test, decodeVoid),
    openSettings: () => invokeRequest(IPC_ENDPOINTS.notifications.openSettings, decodeVoid),
    onOpened: (listener) => subscribe(IPC_ENDPOINTS.notifications.openedEvent, decodeNotificationOpenedEvent, listener),
  },
  maintenance: {
    exportData: () => invokeRequest(IPC_ENDPOINTS.maintenance.exportData, decodeExportResult),
    exportDiagnostics: () => invokeRequest(IPC_ENDPOINTS.maintenance.exportDiagnostics, decodeExportResult),
  },
  servers: {
    list: async () => rememberActiveServer(await invokeRequest(IPC_ENDPOINTS.servers.list, decodeServers)),
    select: async (serverId) =>
      rememberActiveServer(await invokeRequest(IPC_ENDPOINTS.servers.select, decodeServers, serverId)),
    reorder: async (input) =>
      rememberActiveServer(await invokeRequest(IPC_ENDPOINTS.servers.reorder, decodeServers, input)),
    setMuted: async (input) =>
      rememberActiveServer(await invokeRequest(IPC_ENDPOINTS.servers.setMuted, decodeServers, input)),
    setNotificationLevel: async (input) =>
      rememberActiveServer(await invokeRequest(IPC_ENDPOINTS.servers.setNotificationLevel, decodeServers, input)),
    join: async (input) => {
      const server = await invokeRequest(IPC_ENDPOINTS.servers.join, decodeServer, input);
      selectedServerId = server.id;
      return server;
    },
    previewInvite: (input) => invokeRequest(IPC_ENDPOINTS.servers.previewInvite, decodeInvitePreview, input),
    takePendingInvite: () => invokeRequest(IPC_ENDPOINTS.servers.takePendingInvite, decodePendingInvite),
    login: async (input) => {
      const server = await invokeRequest(IPC_ENDPOINTS.servers.login, decodeServer, input);
      selectedServerId = server.id;
      return server;
    },
    retryConnection: (serverId) => invokeRequest(IPC_ENDPOINTS.servers.retryConnection, decodeServer, serverId),
    remove: (serverId) => invokeRequest(IPC_ENDPOINTS.servers.remove, decodeVoid, serverId),
    getPresence: () => invokeRequest(IPC_ENDPOINTS.servers.getPresence, decodeTeamPresenceSnapshot),
    getPresenceFor: (serverId) =>
      invokeRequest(IPC_ENDPOINTS.servers.getPresenceFor, decodeTeamPresenceSnapshot, serverId),
    refreshIdentity: (serverId) => invokeRequest(IPC_ENDPOINTS.servers.refreshIdentity, decodeServer, serverId),
    listMembers: (serverId) => invokeRequest(IPC_ENDPOINTS.servers.listMembers, decodeTeamMembers, serverId),
    updateMember: (serverId, input) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.servers.updateMember, input, decodeTeamMember),
    removeMember: (serverId, memberId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.servers.removeMember, memberId, decodeVoid),
    listInvites: (serverId) => invokeRequest(IPC_ENDPOINTS.servers.listInvites, decodeTeamInvites, serverId),
    revokeInvite: (serverId, inviteId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.servers.revokeInvite, inviteId, decodeVoid),
    createInvite: (serverId, input) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.servers.createInvite, input, decodeInviteSummary),
    setTyping: (input) => invokeRequest(IPC_ENDPOINTS.servers.setTyping, decodeVoid, input),
    onPresence: (listener, serverId) =>
      subscribe(IPC_ENDPOINTS.servers.presence, decodeScopedTeamPresence, (scoped) => {
        if (scoped.serverId === (serverId ?? selectedServerId)) listener(scoped.snapshot);
      }),
    listDirectThreads: () => invokeRequest(IPC_ENDPOINTS.servers.listDirectThreads, decodeDirectThreads),
    readDirectConversation: (memberId) =>
      invokeRequest(IPC_ENDPOINTS.servers.readDirectConversation, decodeDirectConversation, memberId),
    readDirectConversationPage: (input) =>
      invokeRequest(IPC_ENDPOINTS.servers.readDirectConversationPage, decodeDirectConversationPage, input),
    sendDirectMessage: (input) => invokeRequest(IPC_ENDPOINTS.servers.sendDirectMessage, decodeDirectMessage, input),
    markDirectRead: (input) => invokeRequest(IPC_ENDPOINTS.servers.markDirectRead, decodeDirectReadState, input),
    setDirectTyping: (input) => invokeRequest(IPC_ENDPOINTS.servers.setDirectTyping, decodeVoid, input),
    onDirectMessage: (listener) =>
      subscribe(IPC_ENDPOINTS.servers.directMessage, decodeScopedDirectMessage, (scoped) => {
        if (scoped.serverId === selectedServerId) listener(scoped.event);
      }),
    onDirectTyping: (listener) =>
      subscribe(IPC_ENDPOINTS.servers.directTyping, decodeScopedDirectTyping, (scoped) => {
        if (scoped.serverId === selectedServerId) listener(scoped.event);
      }),
    onEvent: (listener) =>
      subscribe(IPC_ENDPOINTS.servers.event, decodeServers, (servers) => listener(rememberActiveServer(servers))),
    onInvite: (listener) => subscribe(IPC_ENDPOINTS.servers.invite, decodeInviteUrl, listener),
  },
  plugins: {
    takePendingListing: () => invokeRequest(IPC_ENDPOINTS.plugins.takePendingListing, decodePendingListing),
    onOpenListing: (listener) =>
      listen(IPC_ENDPOINTS.plugins.openListing, (slug) => {
        if (typeof slug === "string" && isPluginSlug(slug)) listener(slug);
      }),
  },
  host: {
    getStatus: () => invokeRequest(IPC_ENDPOINTS.host.getStatus, decodeHostStatus),
    configure: (input) => invokeRequest(IPC_ENDPOINTS.host.configure, decodeHostStatus, input),
    updateIdentity: (input) => invokeRequest(IPC_ENDPOINTS.host.updateIdentity, decodeHostStatus, input),
    getPresence: () => invokeRequest(IPC_ENDPOINTS.host.getPresence, decodeTeamPresenceSnapshot),
    start: () => invokeRequest(IPC_ENDPOINTS.host.start, decodeHostStatus),
    stop: () => invokeRequest(IPC_ENDPOINTS.host.stop, decodeHostStatus),
    recheckScreenRecording: () => invokeRequest(IPC_ENDPOINTS.host.recheckScreenRecording, decodeHostStatus),
    listMembers: () => invokeRequest(IPC_ENDPOINTS.host.listMembers, decodeTeamMembers),
    updateMember: (input) => invokeRequest(IPC_ENDPOINTS.host.updateMember, decodeTeamMember, input),
    removeMember: (memberId) => invokeRequest(IPC_ENDPOINTS.host.removeMember, decodeVoid, memberId),
    listSessions: () => invokeRequest(IPC_ENDPOINTS.host.listSessions, decodeTeamSessions),
    revokeSession: (sessionId) => invokeRequest(IPC_ENDPOINTS.host.revokeSession, decodeVoid, sessionId),
    listInvites: () => invokeRequest(IPC_ENDPOINTS.host.listInvites, decodeTeamInvites),
    revokeInvite: (inviteId) => invokeRequest(IPC_ENDPOINTS.host.revokeInvite, decodeVoid, inviteId),
    createInvite: (input) => invokeRequest(IPC_ENDPOINTS.host.createInvite, decodeInviteSummary, input),
    onEvent: (listener) => subscribe(IPC_ENDPOINTS.host.event, decodeHostStatus, listener),
  },
  // The shared contract decoder, as MCP does: it already bounds every row, and a remote answer was
  // decoded in main before it reached this point.
  storage: {
    getUsage: (input, serverId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.storage.getUsage, input, decodeOptionalStorageUsage),
    deleteFile: (input, serverId) =>
      invokeAgentForServer(serverId, IPC_ENDPOINTS.storage.deleteFile, input, decodeVoid),
    clear: (input, serverId) => invokeAgentForServer(serverId, IPC_ENDPOINTS.storage.clear, input, decodeVoid),
    openFile: (input, serverId) => invokeAgentForServer(serverId, IPC_ENDPOINTS.storage.openFile, input, decodeVoid),
    openLocation: (input) => invokeRequest(IPC_ENDPOINTS.storage.openLocation, decodeVoid, input),
  },
  remoteDesktop: {
    checkSetup: (serverId) =>
      invokeRequest(IPC_ENDPOINTS.remoteDesktop.checkSetup, decodeRemoteDesktopSetupFromMain, serverId),
    openSetup: (action) => invokeRequest(IPC_ENDPOINTS.remoteDesktop.openSetup, decodeVoid, action),
    test: (input) => invokeRequest(IPC_ENDPOINTS.remoteDesktop.test, decodeRemoteDesktopTestFromMain, input),
    list: () => invokeRequest(IPC_ENDPOINTS.remoteDesktop.list, decodeRemoteDesktopSessions),
    connect: (input) => invokeRequest(IPC_ENDPOINTS.remoteDesktop.connect, decodeRemoteDesktopConnectResult, input),
    selectDisplay: (input) => invokeRequest(IPC_ENDPOINTS.remoteDesktop.selectDisplay, decodeVoid, input),
    disconnect: (sessionId) => invokeRequest(IPC_ENDPOINTS.remoteDesktop.disconnect, decodeVoid, sessionId),
    onEvent: (listener) => subscribe(IPC_ENDPOINTS.remoteDesktop.event, decodeRemoteDesktopSessions, listener),
  },
};

contextBridge.exposeInMainWorld("openbot", openbotApi);
