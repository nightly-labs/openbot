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
  type ServerScope,
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

// One decoder per endpoint of a bridged group. An untyped endpoint has no decoder type, so a group
// that holds one cannot be bridged and stays written by hand.
type DecoderFor<Endpoint> =
  Endpoint extends RequestEndpoint<string, infer Payload, infer Result>
    ? [Payload] extends [Untyped]
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
      const { scope } = endpoint;
      api[name] =
        scope === undefined
          ? (...args: unknown[]) => ipcRenderer.invoke(endpoint.channel, ...args.slice(0, 1)).then(decode)
          : (...args: unknown[]) => ipcRenderer.invoke(endpoint.channel, scopedRequest(scope, args)).then(decode);
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

// The server is the argument after the payload, or the only one when the scope carries nothing. It is
// read at call time, so a method bridged before the user switches servers follows the switch.
function scopedRequest(scope: ServerScope, args: readonly unknown[]): AgentIpcRequest<unknown> {
  const [payload, server] = scope === "empty" ? [null, args[0]] : [args[0], args[1]];
  return { serverId: typeof server === "string" ? server : selectedServerId, payload };
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
      IPC_ENDPOINTS.attachmentImports.importAttachments,
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

// Bridged apart from the API object, because `onEvent` narrows its `onScopedEvent`.
const agentGroup = bridgeGroup(IPC_ENDPOINTS.agent, {
  getStatus: decodeAgentStatusFromMain,
  getHostAnalytics: decodeHostAnalyticsFromMain,
  getAnalytics: decodeAgentAnalyticsFromMain,
  getUsage: decodeAccountUsageFromMain,
  listModels: decodeAgentModels,
  listAgents: decodeAgents,
  listInstalledSkills: decodeInstalledSkillsFromMain,
  listChannels: decodeChannelSummaries,
  readChannel: decodeChannelPage,
  channelCommand: decodeChannel,
  deleteChannel: decodeVoid,
  getSidebarLayout: decodeSidebarLayout,
  mutateSidebarLayout: decodeSidebarLayout,
  generateProfile: decodeAgentProfileDraft,
  saveProfile: decodeSaveAgentProfileResult,
  createAgent: decodeAgent,
  duplicateAgent: decodeDuplicateAgentResultFromMain,
  updateAgent: decodeAgent,
  setAvatar: decodeAgent,
  deleteAgent: decodeVoid,
  readConversation: decodeConversation,
  readConversationPage: decodeConversationPageFromMain,
  searchConversationMessages: decodeConversationSearchPageFromMain,
  listConversationReads: decodeReadStates,
  markConversationRead: decodeReadState,
  sendMessage: decodeReceipt,
  setMessageReaction: decodeVoid,
  listQueue: decodeQueue,
  acknowledgeFailedTurn: decodeVoid,
  cancelQueuedMessage: decodeVoid,
  steerQueuedMessage: decodeVoid,
  editQueuedMessage: decodeQueue,
  updateQueuedMessage: decodeVoid,
  reorderQueue: decodeVoid,
  interrupt: decodeVoid,
  respondToPrompt: decodeVoid,
  respondToApproval: decodeVoid,
  respondToBrowserSecret: decodeVoid,
  respondToBrowserTakeover: decodeVoid,
  scopedEvent: decodeScopedAgentEvent,
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
    ...agentGroup,
    ...bridgeGroup(IPC_ENDPOINTS.agentMemories, {
      listMemories: decodeMemories,
      createMemory: decodeMemory,
      updateMemory: decodeMemory,
      deleteMemory: decodeVoid,
      clearMemories: decodeVoid,
    }),
    ...bridgeGroup(IPC_ENDPOINTS.sharedTables, {
      listTables: decodeTables,
      deleteTable: decodeVoid,
    }),
    ...bridgeGroup(IPC_ENDPOINTS.agentRoutines, {
      listRoutines: decodeRoutines,
      createRoutine: decodeRoutine,
      updateRoutine: decodeRoutine,
      deleteRoutine: decodeVoid,
      testRoutine: decodeRoutineRun,
      listRoutineRuns: decodeRoutineRuns,
    }),
    ...bridgeGroup(IPC_ENDPOINTS.channelMemories, {
      listChannelMemories: decodeChannelMemories,
      createChannelMemory: decodeChannelMemory,
      updateChannelMemory: decodeChannelMemory,
      deleteChannelMemory: decodeVoid,
      clearChannelMemories: decodeVoid,
    }),
    ...bridgeGroup(IPC_ENDPOINTS.channelRoutines, {
      listChannelRoutines: decodeChannelRoutines,
      createChannelRoutine: decodeChannelRoutine,
      updateChannelRoutine: decodeChannelRoutine,
      deleteChannelRoutine: decodeVoid,
      testChannelRoutine: decodeChannelRoutineRun,
      listChannelRoutineRuns: decodeChannelRoutineRuns,
    }),
    ...bridgeGroup(IPC_ENDPOINTS.mcpServers, {
      listMcpServers: decodeMcpServerConfigs,
      saveMcpServer: decodeMcpServerConfigs,
      removeMcpServer: decodeMcpServerConfigs,
      setMcpServerEnabled: decodeMcpServerConfigs,
      testMcpServer: decodeMcpTestResult,
    }),
    ...bridgeGroup(IPC_ENDPOINTS.agentAttachments, {
      chooseAttachments: decodeAttachments,
      discardDraftAttachment: decodeVoid,
      downloadAttachments: decodeVoid,
      openAttachment: decodeVoid,
      openSharedFile: decodeVoid,
      openWorkspaceFile: decodeVoid,
      previewSharedFile: decodeFilePreview,
      previewWorkspaceFile: decodeFilePreview,
    }),
    onAttachmentImport: (listener) => {
      attachmentImportListeners.add(listener);
      return () => attachmentImportListeners.delete(listener);
    },
    onEvent: (listener) =>
      agentGroup.onScopedEvent((scoped) => {
        if (scoped.serverId === selectedServerId) listener(scoped.event);
      }),
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
  storage: bridgeGroup(IPC_ENDPOINTS.storage, {
    getUsage: decodeOptionalStorageUsage,
    deleteFile: decodeVoid,
    clear: decodeVoid,
    openFile: decodeVoid,
    openLocation: decodeVoid,
  }),
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
