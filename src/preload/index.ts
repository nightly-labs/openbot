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
  type GroupApi,
  groupApiMethodName,
  type ImportAttachmentsInput,
  IPC_ENDPOINTS,
  type IpcEndpointGroup,
  LOCAL_SERVER_ID,
  type OpenBotDesktopApi,
  type RequestEndpoint,
  type Untyped,
} from "@openbot/contracts/ipc";
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

// An event decoder that answers null for a value the renderer must not see. The event is dropped,
// not thrown: a deep link carries an id that began in a URL a web page chose.
interface DroppingDecoder<Payload> {
  readonly drop: (value: unknown) => Payload | null;
}

function dropInvalid<Payload>(decode: (value: unknown) => Payload | null): DroppingDecoder<Payload> {
  return { drop: decode };
}

// One decoder per endpoint of a bridged group. A scoped or untyped endpoint has no decoder type,
// so a group that holds one cannot be bridged and stays written by hand.
type DecoderFor<Endpoint> =
  Endpoint extends RequestEndpoint<string, infer Payload, infer Result>
    ? [Payload] extends [Untyped]
      ? never
      : [Payload] extends [AgentIpcRequest<unknown>]
        ? never
        : (value: unknown) => Result
    : Endpoint extends EventEndpoint<string, infer Payload>
      ? ((value: unknown) => Payload) | DroppingDecoder<Payload>
      : never;

type GroupDecoders<Group extends IpcEndpointGroup> = { -readonly [Key in keyof Group]: DecoderFor<Group[Key]> };

type BridgeDecoder = ((value: unknown) => unknown) | DroppingDecoder<unknown>;
type BridgeMethod = (...args: never[]) => Promise<unknown> | (() => void);

// Builds a whole group whose methods pass straight through, as `GroupApi` names them. The decoder map
// is exhaustive, so a new endpoint without a decoder does not compile. It is a plain object of
// functions, which `contextBridge` copies as it copies the literals around it.
//
// The typed signature is an overload because no loop can build a key-remapped type step by step.
// The implementation sets one method for each endpoint under `groupApiMethodName`, the runtime twin
// of the names `GroupApi` gives.
function bridgeGroup<Group extends IpcEndpointGroup>(
  group: Group,
  decoders: NoInfer<GroupDecoders<Group>>,
): GroupApi<Group>;
function bridgeGroup(group: IpcEndpointGroup, decoders: Readonly<Record<string, BridgeDecoder | undefined>>): object {
  for (const key of Object.keys(decoders)) {
    if (!Object.hasOwn(group, key)) throw new Error(`The preload has a decoder for no endpoint: ${key}.`);
  }
  const api: Record<string, BridgeMethod> = {};
  for (const [key, endpoint] of Object.entries(group)) {
    const decode = decoders[key];
    if (decode === undefined) throw new Error(`The preload has no decoder for ${endpoint.channel}.`);
    const name = groupApiMethodName(key, endpoint);
    // Event `x` and request `onX` share one name, and the second would silently replace the first.
    if (Object.hasOwn(api, name)) throw new Error(`The preload has two methods named ${name}.`);
    if (endpoint.kind === "request") {
      if (typeof decode !== "function") throw new Error(`The preload cannot drop the result of ${endpoint.channel}.`);
      // Main takes at most one payload, so nothing past it reaches the channel. The types erase which
      // endpoints take none, so an argument given to such a method is still sent, and main ignores it.
      api[name] = (...args: unknown[]) => ipcRenderer.invoke(endpoint.channel, ...args.slice(0, 1)).then(decode);
    } else if (typeof decode === "function") {
      api[name] = (listener: (payload: unknown) => void) => listen(endpoint, (value) => listener(decode(value)));
    } else {
      api[name] = (listener: (payload: unknown) => void) =>
        listen(endpoint, (value) => {
          const payload = decode.drop(value);
          if (payload !== null) listener(payload);
        });
    }
  }
  return api;
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
  ...bridgeGroup(IPC_ENDPOINTS.app, {
    getAppInfo: decodeAppInfo,
    getSetupState: decodeAppSetupState,
    saveSetup: decodeAppSetupState,
    getAnalyticsPreference: decodeAnalyticsPreference,
    setAnalyticsPreference: decodeAnalyticsPreference,
    getApprovalAutomation: decodeApprovalAutomationPreference,
    setApprovalAutomation: decodeApprovalAutomationPreference,
    getAppLanguagePreference: decodeAppLanguagePreference,
    setAppLanguagePreference: decodeAppLanguagePreference,
    appLanguagePreference: decodeAppLanguagePreference,
    openSettings: decodeVoid,
    openExternal: decodeVoid,
    openUrl: decodeVoid,
  }),
  ...bridgeGroup(IPC_ENDPOINTS.providers, {
    connectProvider: decodeAgentStatusFromMain,
    refreshAgentProviders: decodeAgentStatusFromMain,
    updateProviderCli: decodeAgentStatusFromMain,
    setProviderApiKey: decodeAgentStatusFromMain,
    clearProviderApiKey: decodeAgentStatusFromMain,
    getProviderApiKeyState: decodeProviderApiKeyState,
    startProviderCodeLogin: decodeProviderCodeLoginStart,
    cancelProviderCodeLogin: decodeAgentStatusFromMain,
  }),
  dynamicIsland: bridgeGroup(IPC_ENDPOINTS.dynamicIsland, {
    getPreference: decodeDynamicIslandPreference,
    setPreference: decodeDynamicIslandPreference,
    publishPresentation: decodeVoid,
    getPresentation: decodeDynamicIslandPresentation,
    preference: decodeDynamicIslandPreference,
    presentation: decodeDynamicIslandPresentation,
    geometry: decodeDynamicIslandGeometry,
    performAction: decodeVoid,
    performHaptic: decodeVoid,
    action: decodeDynamicIslandAction,
    setInteractive: decodeVoid,
  }),
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
  providerRuntimes: bridgeGroup(IPC_ENDPOINTS.providerRuntimes, {
    getStatus: decodeProviderRuntimeSnapshot,
    download: decodeProviderRuntimeSnapshot,
    cancel: decodeProviderRuntimeSnapshot,
    checkForUpdates: decodeProviderRuntimeSnapshot,
    event: decodeProviderRuntimeSnapshot,
  }),
  voice: bridgeGroup(IPC_ENDPOINTS.voice, {
    getModelStatus: decodeVoiceModelStatus,
    prepareModel: decodeVoiceModelStatus,
    transcribe: decodeVoiceTranscriptionResult,
    modelStatus: decodeVoiceModelStatus,
  }),
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
  skills: bridgeGroup(IPC_ENDPOINTS.skills, {
    localList: decodeSkillDetails,
    localGet: decodeSkillDetail,
    localCreate: decodeSkillDetail,
    localRevise: decodeSkillDetail,
    localInstall: decodeInstalledSkill,
    list: decodeSkillPage,
    get: decodeSkillDetail,
    listMine: decodeSubmissions,
    choosePackage: decodeSkillPreview,
    submit: decodeSubmission,
    listInstalled: decodeInstalledSkillsFromMain,
    install: decodeInstalledSkill,
    uninstall: decodeVoid,
    setEnabled: decodeInstalledSkill,
  }),
  hostedSites: bridgeGroup(IPC_ENDPOINTS.hostedSites, {
    list: decodeHostedSites,
    chooseDirectory: decodeNullablePath,
    publish: decodeHostedSite,
    replace: decodeHostedSite,
    delete: decodeVoid,
  }),
  customProviders: bridgeGroup(IPC_ENDPOINTS.customProviders, {
    list: decodeCustomProviders,
    save: decodeCustomProviderResult,
    delete: decodeCustomProviderResult,
  }),
  agentImport: bridgeGroup(IPC_ENDPOINTS.agentImport, {
    choose: decodeAgentImportPreview,
    apply: decodeAgentImportResult,
    discard: decodeVoid,
    readSkill: decodeAgentImportSkill,
    saveSkill: decodeExportResult,
  }),
  marketplaceAgents: bridgeGroup(IPC_ENDPOINTS.marketplaceAgents, {
    list: decodeMarketplaceAgentPage,
    get: decodeMarketplaceAgentDetail,
    listMine: decodeAgentSubmissions,
    preview: decodeAgentPublicationPreview,
    submit: decodeAgentSubmission,
    install: decodeAgentInstallation,
  }),
  agentTemplates: bridgeGroup(IPC_ENDPOINTS.agentTemplates, {
    preview: decodeAgentTemplatePreview,
    publish: decodeAgentTemplatePublication,
    unpublish: decodeVoid,
    get: decodeAgentTemplateDetail,
    install: decodeAgentInstallation,
    takePendingLink: decodePendingAgentTemplate,
    openLink: dropInvalid(decodePendingAgentTemplate),
  }),
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
  update: bridgeGroup(IPC_ENDPOINTS.update, {
    getStatus: decodeUpdateStatus,
    check: decodeUpdateStatus,
    download: decodeUpdateStatus,
    install: decodeVoid,
    getPreference: decodeUpdatePreference,
    setPreference: decodeUpdatePreference,
    event: decodeUpdateStatus,
  }),
  notifications: bridgeGroup(IPC_ENDPOINTS.notifications, {
    getPreference: decodeNotificationPreference,
    setPreference: decodeNotificationPreference,
    test: decodeVoid,
    openSettings: decodeVoid,
    opened: decodeNotificationOpenedEvent,
  }),
  maintenance: bridgeGroup(IPC_ENDPOINTS.maintenance, {
    exportData: decodeExportResult,
    exportDiagnostics: decodeExportResult,
  }),
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
  plugins: bridgeGroup(IPC_ENDPOINTS.plugins, {
    takePendingListing: decodePendingListing,
    openListing: dropInvalid(decodePendingListing),
  }),
  host: bridgeGroup(IPC_ENDPOINTS.host, {
    getStatus: decodeHostStatus,
    configure: decodeHostStatus,
    updateIdentity: decodeHostStatus,
    getPresence: decodeTeamPresenceSnapshot,
    start: decodeHostStatus,
    stop: decodeHostStatus,
    recheckScreenRecording: decodeHostStatus,
    listMembers: decodeTeamMembers,
    updateMember: decodeTeamMember,
    removeMember: decodeVoid,
    listSessions: decodeTeamSessions,
    revokeSession: decodeVoid,
    listInvites: decodeTeamInvites,
    revokeInvite: decodeVoid,
    createInvite: decodeInviteSummary,
    event: decodeHostStatus,
  }),
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
  remoteDesktop: bridgeGroup(IPC_ENDPOINTS.remoteDesktop, {
    checkSetup: decodeRemoteDesktopSetupFromMain,
    openSetup: decodeVoid,
    test: decodeRemoteDesktopTestFromMain,
    list: decodeRemoteDesktopSessions,
    connect: decodeRemoteDesktopConnectResult,
    selectDisplay: decodeVoid,
    disconnect: decodeVoid,
    event: decodeRemoteDesktopSessions,
  }),
};

contextBridge.exposeInMainWorld("openbot", openbotApi);
