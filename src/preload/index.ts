import {
  type AgentIpcRequest,
  type AttachmentImportEvent,
  decodeAddedAgent,
  decodeAgentAccessSnapshot,
  decodeAgentAdminSettings,
  decodeAgentBackupModelSettings,
  decodeAgentBrowserProfile,
  decodeAgentExclusionChangeFromMain,
  decodeAgentFolderChangeFromMain,
  decodeAgentFolderListFromMain,
  decodeAgentImportPreview,
  decodeAgentImportResult,
  decodeAgentPlanCardSettings,
  decodeAgentProfileDraft,
  decodeAgentTaskLimitSettings,
  decodeBrowserProfileList,
  decodeBrowserProfileSummary,
  decodeBrowserTabProfiles,
  decodeChannel,
  decodeChannelMemories,
  decodeChannelMemory,
  decodeChannelPage,
  decodeChannelRoutine,
  decodeChannelRoutineRun,
  decodeChannelRoutineRuns,
  decodeChannelRoutines,
  decodeChannelSummaries,
  decodeHermesImportPreview,
  decodeHermesImportResult,
  decodeHostAgentMemoryLimit,
  decodeHostMemoryReview,
  decodeHostTimezoneSettings,
  decodeHostUpdateStatus,
  decodeInstanceExportResult,
  decodeInstanceTransferPreview,
  decodeInstanceTransferResult,
  decodeInstanceTransferSummary,
  decodeMachineAlertSettings,
  decodeMcpServerConfigs,
  decodeMcpSignInAppState,
  decodeMcpSignInPage,
  decodeMcpSignInRelayPage,
  decodeMcpSignInStates,
  decodeMcpTestResult,
  decodeOptionalMachineMetrics,
  decodeOptionalStorageDisk,
  decodeOptionalStorageUsage,
  decodePromptCacheTtlSetting,
  decodeProviderHostSignInStatus,
  decodeProviderRelaySignInStatus,
  decodeProviderRuntimeDownload,
  decodeRegistryEntries,
  decodeRegistryInstallations,
  decodeRegistryInstallResult,
  decodeRegistryOperations,
  decodeRemovableRuntimes,
  decodeSaveAgentProfileResult,
  decodeWorkspaceDirectory,
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
  type ServerSummary,
  type Untyped,
} from "@openbot/contracts/ipc";
import {
  decodeEventActivity,
  decodeEventRoutineRuns,
  decodeEventRoutines,
  decodeEventStatus,
  decodeSaveEventRoutineResult,
  decodeWebhookSecret,
  decodeWebhookTestResult,
} from "@openbot/contracts/ipc-events";
import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  decodeAccountUsageFromMain,
  decodeAgent,
  decodeAgentAnalyticsFromMain,
  decodeAgentHostSettingsFromMain,
  decodeAgentModels,
  decodeAgentNotificationLevelsFromMain,
  decodeAgentRuntimeSnapshot,
  decodeAgentSessionSettingsFromMain,
  decodeAgentStatusFromMain,
  decodeAgents,
  decodeAutomationRunCommand,
  decodeDuplicateAgentResultFromMain,
  decodeHiddenAgentsFromMain,
  decodeHostAnalyticsFromMain,
  decodeHostProviderAccountsFromMain,
  decodeMemories,
  decodeMemory,
  decodeMemorySelection,
  decodeOptionalMemorySelection,
  decodeProviderApiKeyState,
  decodeProviderCodeLoginStart,
  decodeProviderUsageResetOutcomeFromMain,
  decodeProviderUsageResetsFromMain,
  decodeRoutine,
  decodeRoutineCalendar,
  decodeRoutineFeed,
  decodeRoutineRun,
  decodeRoutineRuns,
  decodeRoutines,
  decodeSidebarLayout,
  decodeSideQuestionAnswer,
  decodeTables,
} from "./agent-decoding";
import { decodeScopedAgentEvent } from "./agent-event-decoding";
import {
  decodeAccountSessions,
  decodeAgentDefaults,
  decodeAgentImportSkill,
  decodeAgentMemoryLimitPreference,
  decodeAnalyticsPreference,
  decodeAppAppearancePreference,
  decodeAppBehaviorPreference,
  decodeAppInfo,
  decodeAppInterfaceSizePreference,
  decodeAppLanguagePreference,
  decodeAppLogoColorPreference,
  decodeApprovalAutomationPreference,
  decodeAppSetupState,
  decodeBillingState,
  decodeBitwardenConnectorStatus,
  decodeBusyMessageModePreference,
  decodeCentralAuthState,
  decodeChatWindowTargets,
  decodeCustomAgentCheckResult,
  decodeCustomAgentResult,
  decodeCustomAgents,
  decodeCustomAgentUsage,
  decodeCustomProviderResult,
  decodeCustomProviders,
  decodeDetectedAcpAgents,
  decodeDetectedModelServers,
  decodeDiscoverModelsResult,
  decodeExportResult,
  decodeExternalLinkBrowserOrNull,
  decodeExternalLinkBrowsers,
  decodeExternalLinkFallback,
  decodeExternalLinkPreference,
  decodeGitHubConnectorRepositories,
  decodeGitHubConnectorStatus,
  decodeHostedServer,
  decodeHostedServerCatalog,
  decodeHostedServerList,
  decodeHostedSite,
  decodeHostedSiteList,
  decodeLicenseState,
  decodeMobileConnectedDevices,
  decodeMobileConnectLink,
  decodeMobileConnectTicket,
  decodeNotificationOpenedEvent,
  decodeNotificationPreference,
  decodeNullablePath,
  decodeOnePasswordConnectorStatus,
  decodePendingAgentTemplate,
  decodePendingListing,
  decodeProviderDetectionSettings,
  decodeRemoteDesktopSetupFromMain,
  decodeRemoteDesktopTestFromMain,
  decodeRemoteNetworkRouteState,
  decodeRemoteSessionReusePreference,
  decodeSpeechAudio,
  decodeSpeechModelStatus,
  decodeSpeechSettings,
  decodeUpdatePreference,
  decodeUpdateStatus,
  decodeVoiceModelStatus,
  decodeVoiceModelStatuses,
  decodeVoiceServerProbe,
  decodeVoiceServerSettings,
  decodeVoiceSettings,
  decodeVoiceStream,
  decodeVoiceStreamTranscript,
  decodeVoiceTranscriptionResult,
  decodeVoid,
} from "./app-decoding";
import { decodeBackgroundProcesses } from "./background-process-decoding";
import {
  decodeBrowserBounds,
  decodeBrowserControlState,
  decodeBrowserDisplayState,
  decodeBrowserLiveViewEvent,
  decodeBrowserLocalSignInEnd,
  decodeBrowserLocalSignInResult,
  decodeBrowserPictureInPictureEvent,
  decodeBrowserPreviewFromMain,
  decodeBrowserTab,
  decodeBrowserTabs,
} from "./browser-decoding";
import {
  decodeBrowserDockAction,
  decodeBrowserDockPresentation,
  decodeBrowserDockShown,
} from "./browser-dock-decoding";
import { clipboardFiles } from "./clipboard-files";
import {
  decodeComputerUseHighlightPlacement,
  decodeComputerUsePermissionApp,
  decodeComputerUseState,
} from "./computer-use-decoding";
import {
  decodeAgentTask,
  decodeAgentTaskReadState,
  decodeAgentTasks,
  decodeAttachment,
  decodeAttachments,
  decodeConversation,
  decodeConversationFileSearchPage,
  decodeConversationPageFromMain,
  decodeConversationSearchPageFromMain,
  decodeFilePreview,
  decodeQueue,
  decodeReadState,
  decodeReadStates,
  decodeReceipt,
  decodeTaskConversation,
  decodeWaits,
} from "./conversation-decoding";
import {
  decodeDynamicIslandAction,
  decodeDynamicIslandGeometry,
  decodeDynamicIslandPreference,
  decodeDynamicIslandPresentation,
} from "./dynamic-island-decoding";
import { decodeHostReleaseStatusFromMain } from "./host-release-decoding";
import { decodeMacAutomationResults } from "./mac-automation-decoding";
import {
  decodeAddOrchestratorReply,
  decodeDiscordAccessReply,
  decodeDiscordRolesReply,
  decodeMessagingOverviewReply,
  decodeTelegramOverviewReply,
} from "./messaging-decoding";
import { decodeProviderRuntimeSnapshot } from "./provider-runtime";
import { decodeRoutineFlowCanvas, decodeRoutineFlowLink } from "./routine-flow-decoding";
import {
  decodeRoutineResultDeliveries,
  decodeRoutineResultDestination,
  decodeRoutineResultOptions,
} from "./routine-result-decoding";
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
import { decodeVaultImportResult, decodeVaultSecret, decodeVaultState } from "./vault-decoding";
import {
  decodeWorkflowDetail,
  decodeWorkflowGraph,
  decodeWorkflowRunDetail,
  decodeWorkflowRunPage,
  decodeWorkflowSaveResult,
  decodeWorkflowStep,
  decodeWorkflowSummaries,
  decodeWorkflowSummary,
  decodeWorkflowVersions,
  decodeWorkflowWebhookSecret,
} from "./workflow-decoding";

const attachmentImportListeners = new Set<(event: AttachmentImportEvent) => void>();
/**
 * The server of a window that main opened for one chat (#2964), from its `?window=chat&server=<id>`
 * URL. The window never selects a server, so it keeps this one while the main window selects others.
 */
const chatWindowServerId = (() => {
  const query = new URLSearchParams(window.location.search);
  return query.get("window") === "chat" ? query.get("server") : null;
})();
let selectedServerId: string = chatWindowServerId ?? LOCAL_SERVER_ID;

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

// A chat window shows its own server as the active one, so the renderer scopes everything to it.
function rememberActiveServer(servers: ServerSummary[]): ServerSummary[] {
  const pinned = chatWindowServerId;
  if (pinned !== null && servers.some((server) => server.id === pinned)) {
    selectedServerId = pinned;
    return servers.map((server) => ({ ...server, active: server.id === pinned }));
  }
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
  getRuntimeSnapshot: decodeAgentRuntimeSnapshot,
  getHostAnalytics: decodeHostAnalyticsFromMain,
  getAnalytics: decodeAgentAnalyticsFromMain,
  getUsage: decodeAccountUsageFromMain,
  listModels: decodeAgentModels,
  listAgents: decodeAgents,
  readAgentSessionSettings: decodeAgentSessionSettingsFromMain,
  setAgentSessionSetting: decodeAgentSessionSettingsFromMain,
  resetAgentSessionSetting: decodeAgentSessionSettingsFromMain,
  listHiddenAgents: decodeHiddenAgentsFromMain,
  setAgentHidden: decodeHiddenAgentsFromMain,
  listAgentNotificationLevels: decodeAgentNotificationLevelsFromMain,
  setAgentNotificationLevel: decodeAgentNotificationLevelsFromMain,
  listInstalledSkills: decodeInstalledSkillsFromMain,
  listChannels: decodeChannelSummaries,
  readChannel: decodeChannelPage,
  channelCommand: decodeChannel,
  deleteChannel: decodeVoid,
  getSidebarLayout: decodeSidebarLayout,
  mutateSidebarLayout: decodeSidebarLayout,
  generateProfile: decodeAgentProfileDraft,
  saveProfile: decodeSaveAgentProfileResult,
  askSideQuestion: decodeSideQuestionAnswer,
  createAgent: decodeAgent,
  duplicateAgent: decodeDuplicateAgentResultFromMain,
  updateAgent: decodeAgent,
  setAvatar: decodeAgent,
  deleteAgent: decodeVoid,
  readConversation: decodeConversation,
  readConversationPage: decodeConversationPageFromMain,
  searchConversationMessages: decodeConversationSearchPageFromMain,
  openMessageLink: decodeMcpSignInRelayPage,
  pasteMessageLink: decodeVoid,
  cancelMessageLink: decodeVoid,
  searchConversationFiles: decodeConversationFileSearchPage,
  listConversationReads: decodeReadStates,
  markConversationRead: decodeReadState,
  markConversationUnread: decodeReadState,
  sendMessage: decodeReceipt,
  setMessageReaction: decodeVoid,
  listQueue: decodeQueue,
  listWaits: decodeWaits,
  cancelWait: decodeVoid,
  listTasks: decodeAgentTasks,
  readTask: decodeTaskConversation,
  startTask: decodeAgentTask,
  runQueuedMessageAsTask: decodeAgentTask,
  stopTask: decodeVoid,
  closeTask: decodeVoid,
  reopenTask: decodeVoid,
  renameTask: decodeVoid,
  deleteTask: decodeVoid,
  markTaskRead: decodeAgentTaskReadState,
  acknowledgeFailedTurn: decodeVoid,
  cancelQueuedMessage: decodeVoid,
  steerQueuedMessage: decodeVoid,
  editQueuedMessage: decodeQueue,
  updateQueuedMessage: decodeVoid,
  reorderQueue: decodeVoid,
  interrupt: decodeVoid,
  clearContext: decodeVoid,
  compactContext: decodeVoid,
  compactTaskContext: decodeVoid,
  respondToPrompt: decodeVoid,
  respondToApproval: decodeVoid,
  respondToBrowserSecret: decodeVoid,
  respondToBrowserTakeover: decodeVoid,
  scopedEvent: decodeScopedAgentEvent,
});

// Bridged apart from the API object, because a dropped folder with no path reads the list.
const agentFoldersGroup = bridgeGroup(IPC_ENDPOINTS.agentFolders, {
  listAgentFolders: decodeAgentFolderListFromMain,
  chooseAgentFolder: decodeAgentFolderChangeFromMain,
  addAgentFolder: decodeAgentFolderChangeFromMain,
  removeAgentFolder: decodeAgentFolderChangeFromMain,
  chooseAgentExclusion: decodeAgentExclusionChangeFromMain,
  addAgentExclusion: decodeAgentExclusionChangeFromMain,
  removeAgentExclusion: decodeAgentExclusionChangeFromMain,
});

// Bridged apart from the API object, because the server list calls record the selected server and
// three events are narrowed to one server.
const serversGroup = bridgeGroup(IPC_ENDPOINTS.servers, {
  list: decodeServers,
  select: decodeServers,
  reorder: decodeServers,
  setMuted: decodeServers,
  setNotificationLevel: decodeServers,
  join: decodeServer,
  previewInvite: decodeInvitePreview,
  takePendingInvite: decodePendingInvite,
  login: decodeServer,
  retryConnection: decodeServer,
  remove: decodeVoid,
  getPresence: decodeTeamPresenceSnapshot,
  getPresenceFor: decodeTeamPresenceSnapshot,
  refreshIdentity: decodeServer,
  listMembers: decodeTeamMembers,
  updateMember: decodeTeamMember,
  removeMember: decodeVoid,
  listInvites: decodeTeamInvites,
  revokeInvite: decodeVoid,
  createInvite: decodeInviteSummary,
  setTyping: decodeVoid,
  scopedPresence: decodeScopedTeamPresence,
  listDirectThreads: decodeDirectThreads,
  readDirectConversation: decodeDirectConversation,
  readDirectConversationPage: decodeDirectConversationPage,
  sendDirectMessage: decodeDirectMessage,
  markDirectRead: decodeDirectReadState,
  setDirectTyping: decodeVoid,
  scopedDirectMessage: decodeScopedDirectMessage,
  scopedDirectTyping: decodeScopedDirectTyping,
  event: decodeServers,
  invite: decodeInviteUrl,
});

function selectJoinedServer(server: ServerSummary): ServerSummary {
  selectedServerId = server.id;
  return server;
}

const openbotApi: OpenBotDesktopApi = {
  ...bridgeGroup(IPC_ENDPOINTS.app, {
    getAppInfo: decodeAppInfo,
    getSetupState: decodeAppSetupState,
    saveSetup: decodeAppSetupState,
    setupState: decodeAppSetupState,
    getAnalyticsPreference: decodeAnalyticsPreference,
    getAnalyticsDefault: decodeAnalyticsPreference,
    analyticsPreference: decodeAnalyticsPreference,
    setAnalyticsPreference: decodeAnalyticsPreference,
    getApprovalAutomation: decodeApprovalAutomationPreference,
    approvalAutomation: decodeApprovalAutomationPreference,
    getBusyMessageModePreference: decodeBusyMessageModePreference,
    setBusyMessageModePreference: decodeBusyMessageModePreference,
    getAgentDefaults: decodeAgentDefaults,
    setAgentDefaults: decodeAgentDefaults,
    getAgentMemoryLimitPreference: decodeAgentMemoryLimitPreference,
    agentMemoryLimitPreference: decodeAgentMemoryLimitPreference,
    getAppBehaviorPreference: decodeAppBehaviorPreference,
    setAppBehaviorPreference: decodeAppBehaviorPreference,
    getRemoteSessionReusePreference: decodeRemoteSessionReusePreference,
    setRemoteSessionReusePreference: decodeRemoteSessionReusePreference,
    getRemoteNetworkRoute: decodeRemoteNetworkRouteState,
    setRemoteNetworkRoute: decodeRemoteNetworkRouteState,
    getAppLanguagePreference: decodeAppLanguagePreference,
    setAppLanguagePreference: decodeAppLanguagePreference,
    appLanguagePreference: decodeAppLanguagePreference,
    getAppLogoColorPreference: decodeAppLogoColorPreference,
    setAppLogoColorPreference: decodeAppLogoColorPreference,
    appLogoColorPreference: decodeAppLogoColorPreference,
    getAppAppearancePreference: decodeAppAppearancePreference,
    setAppAppearancePreference: decodeAppAppearancePreference,
    appAppearancePreference: decodeAppAppearancePreference,
    getAppInterfaceSizePreference: decodeAppInterfaceSizePreference,
    setAppInterfaceSizePreference: decodeAppInterfaceSizePreference,
    appInterfaceSizePreference: decodeAppInterfaceSizePreference,
    openSettings: decodeVoid,
    openUpdateSettings: decodeVoid,
    openExternal: decodeVoid,
    openUrl: decodeVoid,
    getExternalLinkPreference: decodeExternalLinkPreference,
    setExternalLinkPreference: decodeExternalLinkPreference,
    listExternalLinkBrowsers: decodeExternalLinkBrowsers,
    chooseExternalLinkApp: decodeExternalLinkBrowserOrNull,
    externalLinkFallback: decodeExternalLinkFallback,
    openChatWindow: decodeVoid,
    getChatWindows: decodeChatWindowTargets,
    chatWindows: decodeChatWindowTargets,
  }),
  ...bridgeGroup(IPC_ENDPOINTS.providers, {
    connectProvider: decodeAgentStatusFromMain,
    cancelProviderSignIn: decodeAgentStatusFromMain,
    refreshAgentProviders: decodeAgentStatusFromMain,
    setProviderOn: decodeAgentStatusFromMain,
    restartProvider: decodeAgentStatusFromMain,
    cancelProviderRestart: decodeAgentStatusFromMain,
    updateProviderCli: decodeAgentStatusFromMain,
    setProviderApiKey: decodeAgentStatusFromMain,
    clearProviderApiKey: decodeAgentStatusFromMain,
    getProviderApiKeyState: decodeProviderApiKeyState,
    startProviderCodeLogin: decodeProviderCodeLoginStart,
    cancelProviderCodeLogin: decodeAgentStatusFromMain,
    connectProviderAccount: decodeAgentStatusFromMain,
    cancelProviderAccountSignIn: decodeAgentStatusFromMain,
    renameProviderAccount: decodeAgentStatusFromMain,
    removeProviderAccount: decodeAgentStatusFromMain,
    signOutProvider: decodeAgentStatusFromMain,
    providerUsageResets: decodeProviderUsageResetsFromMain,
    resetProviderUsage: decodeProviderUsageResetOutcomeFromMain,
  }),
  browserDock: bridgeGroup(IPC_ENDPOINTS.browserDock, {
    publishPresentation: decodeVoid,
    getPresentation: decodeBrowserDockPresentation,
    presentation: decodeBrowserDockPresentation,
    performAction: decodeVoid,
    action: decodeBrowserDockAction,
    setFrame: decodeVoid,
    shown: decodeBrowserDockShown,
  }),
  dynamicIsland: bridgeGroup(IPC_ENDPOINTS.dynamicIsland, {
    getPreference: decodeDynamicIslandPreference,
    setPreference: decodeDynamicIslandPreference,
    publishPresentation: decodeVoid,
    getPresentation: decodeDynamicIslandPresentation,
    preference: decodeDynamicIslandPreference,
    presentation: decodeDynamicIslandPresentation,
    geometry: decodeDynamicIslandGeometry,
    getBuiltInDisplayGeometry: decodeDynamicIslandGeometry,
    performAction: decodeVoid,
    performHaptic: decodeVoid,
    action: decodeDynamicIslandAction,
    setInteractive: decodeVoid,
  }),
  computerUse: bridgeGroup(IPC_ENDPOINTS.computerUse, {
    getState: decodeComputerUseState,
    openPermissionPane: decodeComputerUseState,
    closePermissionHelp: decodeVoid,
    getPermissionApp: decodeComputerUsePermissionApp,
    startPermissionAppDrag: decodeVoid,
    revealPermissionApp: decodeVoid,
    highlightPlacement: decodeComputerUseHighlightPlacement,
  }),
  macAutomation: bridgeGroup(IPC_ENDPOINTS.macAutomation, {
    request: decodeMacAutomationResults,
  }),
  backgroundProcesses: bridgeGroup(IPC_ENDPOINTS.backgroundProcesses, {
    list: decodeBackgroundProcesses,
    stop: decodeVoid,
  }),
  providerRuntimes: bridgeGroup(IPC_ENDPOINTS.providerRuntimes, {
    getStatus: decodeProviderRuntimeSnapshot,
    download: decodeProviderRuntimeSnapshot,
    cancel: decodeProviderRuntimeSnapshot,
    measureDownload: decodeProviderRuntimeDownload,
    removeDownload: decodeProviderRuntimeSnapshot,
    checkForUpdates: decodeProviderRuntimeSnapshot,
    event: decodeProviderRuntimeSnapshot,
  }),
  routineFlows: bridgeGroup(IPC_ENDPOINTS.routineFlows, {
    canvas: decodeRoutineFlowCanvas,
    savePosition: decodeVoid,
    removePosition: decodeVoid,
    connect: decodeRoutineFlowLink,
    disconnect: decodeVoid,
    updateLink: decodeRoutineFlowLink,
  }),
  workflows: bridgeGroup(IPC_ENDPOINTS.workflows, {
    list: decodeWorkflowSummaries,
    get: decodeWorkflowDetail,
    create: decodeWorkflowDetail,
    rename: decodeWorkflowSummary,
    delete: decodeVoid,
    saveGraph: decodeWorkflowSaveResult,
    versions: decodeWorkflowVersions,
    versionGraph: decodeWorkflowGraph,
    restoreVersion: decodeWorkflowDetail,
    startRun: decodeWorkflowRunDetail,
    runStep: decodeWorkflowStep,
    stopStep: decodeVoid,
    stopRun: decodeVoid,
    retryStep: decodeWorkflowStep,
    decide: decodeVoid,
    runs: decodeWorkflowRunPage,
    run: decodeWorkflowRunDetail,
    rotateWebhookSecret: decodeWorkflowWebhookSecret,
  }),
  routineResults: bridgeGroup(IPC_ENDPOINTS.routineResults, {
    options: decodeRoutineResultOptions,
    destination: decodeRoutineResultDestination,
    setDestination: decodeRoutineResultDestination,
    deliveries: decodeRoutineResultDeliveries,
    resend: decodeVoid,
  }),
  voice: bridgeGroup(IPC_ENDPOINTS.voice, {
    getModelStatus: decodeVoiceModelStatus,
    getModelStatuses: decodeVoiceModelStatuses,
    downloadModel: decodeVoiceModelStatus,
    cancelModelDownload: decodeVoiceModelStatus,
    removeModel: decodeVoiceModelStatus,
    getSettings: decodeVoiceSettings,
    setSettings: decodeVoiceSettings,
    prepareModel: decodeVoiceModelStatus,
    transcribe: decodeVoiceTranscriptionResult,
    setApiKey: decodeVoiceModelStatus,
    startStream: decodeVoiceStream,
    appendStream: decodeVoid,
    finishStream: decodeVoiceTranscriptionResult,
    cancelStream: decodeVoid,
    modelStatus: decodeVoiceModelStatus,
    streamTranscript: decodeVoiceStreamTranscript,
    getSpeechSettings: decodeSpeechSettings,
    setSpeechSettings: decodeSpeechSettings,
    getSpeechModelStatus: decodeSpeechModelStatus,
    downloadSpeechModel: decodeSpeechModelStatus,
    cancelSpeechModelDownload: decodeSpeechModelStatus,
    removeSpeechModel: decodeSpeechModelStatus,
    speak: decodeSpeechAudio,
    warmSpeech: decodeVoid,
    keepRecording: decodeAttachment,
    speechModelStatus: decodeSpeechModelStatus,
    getServer: decodeVoiceServerSettings,
    probeServer: decodeVoiceServerProbe,
    setServer: decodeVoiceServerSettings,
    serverSettings: decodeVoiceServerSettings,
  }),
  auth: bridgeGroup(IPC_ENDPOINTS.auth, {
    getState: decodeCentralAuthState,
    retry: decodeCentralAuthState,
    requestEmailCode: decodeCentralAuthState,
    verifyEmailCode: decodeCentralAuthState,
    updateName: decodeCentralAuthState,
    updateAvatar: decodeCentralAuthState,
    createMobileConnect: decodeMobileConnectTicket,
    cancelMobileConnect: decodeVoid,
    getMobileConnectLink: (value) => (value === null ? null : decodeMobileConnectLink(value)),
    createMobileConnectLink: decodeMobileConnectLink,
    revokeMobileConnectLink: decodeVoid,
    listMobileConnectedDevices: decodeMobileConnectedDevices,
    listAccountSessions: decodeAccountSessions,
    revokeAccountSession: decodeVoid,
    revokeMobileConnectedDevice: decodeVoid,
    logout: decodeCentralAuthState,
    event: decodeCentralAuthState,
  }),
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
    list: decodeHostedSiteList,
    chooseDirectory: decodeNullablePath,
    publish: decodeHostedSite,
    replace: decodeHostedSite,
    delete: decodeVoid,
  }),
  githubConnector: bridgeGroup(IPC_ENDPOINTS.githubConnector, {
    status: decodeGitHubConnectorStatus,
    connect: decodeGitHubConnectorStatus,
    cancel: decodeGitHubConnectorStatus,
    disconnect: decodeGitHubConnectorStatus,
    repositories: decodeGitHubConnectorRepositories,
    openVerification: decodeVoid,
    openInstall: decodeVoid,
    changed: decodeGitHubConnectorStatus,
    hostStatus: decodeGitHubConnectorStatus,
    hostConnect: decodeGitHubConnectorStatus,
    hostCancel: decodeGitHubConnectorStatus,
    hostDisconnect: decodeGitHubConnectorStatus,
    hostRepositories: decodeGitHubConnectorRepositories,
    hostOpenVerification: decodeVoid,
    hostOpenInstall: decodeVoid,
  }),
  bitwardenConnector: bridgeGroup(IPC_ENDPOINTS.bitwardenConnector, {
    status: decodeBitwardenConnectorStatus,
    connect: decodeBitwardenConnectorStatus,
    disconnect: decodeBitwardenConnectorStatus,
    changed: decodeBitwardenConnectorStatus,
    hostStatus: decodeBitwardenConnectorStatus,
    hostConnect: decodeBitwardenConnectorStatus,
    hostDisconnect: decodeBitwardenConnectorStatus,
  }),
  vault: bridgeGroup(IPC_ENDPOINTS.vault, {
    list: decodeVaultState,
    save: decodeVaultState,
    delete: decodeVaultState,
    reveal: decodeVaultSecret,
    copy: decodeVoid,
    importCsv: decodeVaultImportResult,
    reset: decodeVaultState,
    changed: decodeVaultState,
    hostList: decodeVaultState,
    hostSave: decodeVaultState,
    hostDelete: decodeVaultState,
    hostReveal: decodeVaultSecret,
    hostCopy: decodeVoid,
    hostReset: decodeVaultState,
  }),
  onePasswordConnector: bridgeGroup(IPC_ENDPOINTS.onePasswordConnector, {
    status: decodeOnePasswordConnectorStatus,
    checkSetup: decodeOnePasswordConnectorStatus,
    installCli: decodeOnePasswordConnectorStatus,
    openApp: decodeVoid,
    connect: decodeOnePasswordConnectorStatus,
    connectWithToken: decodeOnePasswordConnectorStatus,
    cancel: decodeOnePasswordConnectorStatus,
    disconnect: decodeOnePasswordConnectorStatus,
    changed: decodeOnePasswordConnectorStatus,
    hostStatus: decodeOnePasswordConnectorStatus,
    hostConnectWithToken: decodeOnePasswordConnectorStatus,
    hostDisconnect: decodeOnePasswordConnectorStatus,
  }),
  routineFeed: bridgeGroup(IPC_ENDPOINTS.routineFeed, {
    get: decodeRoutineFeed,
    create: decodeRoutineFeed,
    remove: decodeRoutineFeed,
  }),
  billing: bridgeGroup(IPC_ENDPOINTS.billing, {
    getState: decodeBillingState,
    openPortal: decodeVoid,
  }),
  license: bridgeGroup(IPC_ENDPOINTS.license, {
    getState: decodeLicenseState,
    openCheckout: decodeVoid,
    setUsers: decodeLicenseState,
    changePlan: decodeLicenseState,
    setRenewal: decodeLicenseState,
  }),
  hostedServers: bridgeGroup(IPC_ENDPOINTS.hostedServers, {
    lifecycle: decodeVoid,
    list: decodeHostedServerList,
    plans: decodeHostedServerCatalog,
    create: decodeHostedServer,
    openCheckout: decodeHostedServer,
    delete: decodeVoid,
    wake: decodeHostedServer,
    restart: decodeHostedServer,
  }),
  localServers: bridgeGroup(IPC_ENDPOINTS.localServers, {
    create: decodeServer,
    restart: decodeVoid,
    delete: decodeVoid,
  }),
  customProviders: bridgeGroup(IPC_ENDPOINTS.customProviders, {
    list: decodeCustomProviders,
    save: decodeCustomProviderResult,
    delete: decodeCustomProviderResult,
    update: decodeCustomProviderResult,
  }),
  acpRegistry: bridgeGroup(IPC_ENDPOINTS.acpRegistry, {
    search: decodeRegistryEntries,
    installed: decodeRegistryInstallations,
    status: decodeRegistryOperations,
    install: decodeRegistryInstallResult,
    cancel: decodeVoid,
    remove: decodeVoid,
  }),
  customAgents: bridgeGroup(IPC_ENDPOINTS.customAgents, {
    list: decodeCustomAgents,
    save: decodeCustomAgentResult,
    delete: decodeCustomAgentResult,
    check: decodeCustomAgentCheckResult,
    usage: decodeCustomAgentUsage,
  }),
  providerDetection: bridgeGroup(IPC_ENDPOINTS.providerDetection, {
    scanModelServers: decodeDetectedModelServers,
    scanAgents: decodeDetectedAcpAgents,
    discoverModels: decodeDiscoverModelsResult,
    getSettings: decodeProviderDetectionSettings,
    setSettings: decodeProviderDetectionSettings,
  }),
  providerAdmin: bridgeGroup(IPC_ENDPOINTS.providerAdmin, {
    startCodeLogin: decodeProviderCodeLoginStart,
    submitCodeLogin: decodeAgentStatusFromMain,
    cancelCodeLogin: decodeAgentStatusFromMain,
    startHostSignIn: decodeVoid,
    hostSignInStatus: decodeProviderHostSignInStatus,
    cancelHostSignIn: decodeAgentStatusFromMain,
    accounts: decodeHostProviderAccountsFromMain,
    accountUsage: decodeAccountUsageFromMain,
    startAccountSignIn: decodeVoid,
    accountSignInStatus: decodeProviderHostSignInStatus,
    cancelAccountSignIn: decodeVoid,
    renameAccount: decodeVoid,
    removeAccount: decodeVoid,
    usageResets: decodeProviderUsageResetsFromMain,
    resetUsage: decodeProviderUsageResetOutcomeFromMain,
    signOut: decodeVoid,
    startRelaySignIn: decodeVoid,
    startAccountRelaySignIn: decodeVoid,
    relaySignInStatus: decodeProviderRelaySignInStatus,
    openRelaySignIn: decodeVoid,
    pasteRelaySignIn: decodeVoid,
    cancelRelaySignIn: decodeAgentStatusFromMain,
    getApiKeyState: decodeProviderApiKeyState,
    setApiKey: decodeAgentStatusFromMain,
    clearApiKey: decodeAgentStatusFromMain,
    getRuntimes: decodeProviderRuntimeSnapshot,
    downloadRuntime: decodeProviderRuntimeSnapshot,
    cancelRuntime: decodeProviderRuntimeSnapshot,
    checkRuntimeUpdates: decodeProviderRuntimeSnapshot,
    listCustomProviders: decodeCustomProviders,
    saveCustomProvider: decodeCustomProviderResult,
    deleteCustomProvider: decodeCustomProviderResult,
  }),
  messaging: bridgeGroup(IPC_ENDPOINTS.messaging, {
    getSlackOverview: decodeMessagingOverviewReply,
    connectSlackWorkspace: decodeVoid,
    disconnectSlackWorkspace: decodeVoid,
    reconnectSlackWorkspace: decodeVoid,
    setSlackEnabled: decodeVoid,
    addSlackOrchestrator: decodeAddOrchestratorReply,
    getDiscordOverview: decodeMessagingOverviewReply,
    connectDiscordGuild: decodeVoid,
    disconnectDiscordGuild: decodeVoid,
    reconnectDiscordGuild: decodeVoid,
    setDiscordEnabled: decodeVoid,
    addDiscordOrchestrator: decodeAddOrchestratorReply,
    getDiscordAccess: decodeDiscordAccessReply,
    listDiscordRoles: decodeDiscordRolesReply,
    setDiscordAccess: decodeDiscordAccessReply,
    getTelegramOverview: decodeTelegramOverviewReply,
    connectTelegramChat: decodeVoid,
    disconnectTelegramChat: decodeVoid,
    reconnectTelegramChat: decodeVoid,
    setTelegramEnabled: decodeVoid,
    addTelegramOrchestrator: decodeAddOrchestratorReply,
    // A joined server can list up to the Telegram limit; main has already read its states.
    hostOverview: decodeTelegramOverviewReply,
    hostConnect: decodeVoid,
    hostDisconnect: decodeVoid,
    hostReconnect: decodeVoid,
    hostSetEnabled: decodeVoid,
    hostAddOrchestrator: decodeAddOrchestratorReply,
    hostGetDiscordAccess: decodeDiscordAccessReply,
    hostListDiscordRoles: decodeDiscordRolesReply,
    hostSetDiscordAccess: decodeDiscordAccessReply,
  }),
  hostAdmin: bridgeGroup(IPC_ENDPOINTS.hostAdmin, {
    updateIdentity: decodeServer,
    getUpdateStatus: decodeHostUpdateStatus,
    getReleaseStatus: (value) => (value === null ? null : decodeHostReleaseStatusFromMain(value)),
    checkRelease: decodeHostReleaseStatusFromMain,
    checkForUpdate: decodeHostUpdateStatus,
    startUpdate: decodeHostUpdateStatus,
    cancelUpdate: decodeHostUpdateStatus,
    setUpdateSettings: decodeHostUpdateStatus,
    getTimezone: decodeHostTimezoneSettings,
    setTimezone: decodeHostTimezoneSettings,
    getAgentMemoryLimit: decodeHostAgentMemoryLimit,
    setAgentMemoryLimit: decodeHostAgentMemoryLimit,
    getMemoryReview: decodeHostMemoryReview,
    setMemoryReview: decodeHostMemoryReview,
    getMachineAlerts: decodeMachineAlertSettings,
    setMachineAlerts: decodeMachineAlertSettings,
    getPromptCacheTtl: decodePromptCacheTtlSetting,
    setPromptCacheTtl: decodePromptCacheTtlSetting,
    getAgentAccess: decodeAgentAccessSnapshot,
    setAgentAccess: decodeAgentAccessSnapshot,
  }),
  agentImport: bridgeGroup(IPC_ENDPOINTS.agentImport, {
    choose: decodeAgentImportPreview,
    apply: decodeAgentImportResult,
    discard: decodeVoid,
    readSkill: decodeAgentImportSkill,
    saveSkill: decodeExportResult,
    readHermes: decodeHermesImportPreview,
    chooseHermes: decodeHermesImportPreview,
    applyHermes: decodeHermesImportResult,
    discardHermes: decodeVoid,
  }),
  instanceTransfer: bridgeGroup(IPC_ENDPOINTS.instanceTransfer, {
    summary: decodeInstanceTransferSummary,
    export: decodeInstanceExportResult,
    showExport: decodeVoid,
    choose: decodeInstanceTransferPreview,
    apply: decodeInstanceTransferResult,
    discard: decodeVoid,
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
      getMemorySelection: decodeOptionalMemorySelection,
      setMemoryInclusion: decodeMemorySelection,
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
      automationRunCommand: decodeAutomationRunCommand,
      routineCalendar: decodeRoutineCalendar,
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
      signInMcpServer: decodeMcpTestResult,
      mcpSignInPage: decodeMcpSignInPage,
      mcpSignInRelay: decodeMcpSignInRelayPage,
      openMcpSignInRelay: decodeVoid,
      completeMcpSignInRelay: decodeVoid,
      cancelMcpSignIn: decodeVoid,
      signOutMcpServer: decodeMcpSignInStates,
      listMcpSignIns: decodeMcpSignInStates,
      mcpSignInApp: decodeMcpSignInAppState,
      saveMcpSignInApp: decodeMcpSignInAppState,
      removeMcpSignInApp: decodeMcpSignInAppState,
    }),
    ...bridgeGroup(IPC_ENDPOINTS.agentAdmin, {
      getAgentAdminSettings: decodeAgentAdminSettings,
      getAgentHostSettings: decodeAgentHostSettingsFromMain,
      updateAgentHostSettings: decodeAgentHostSettingsFromMain,
      getAgentBackupModels: decodeAgentBackupModelSettings,
      updateAgentBackupModels: decodeAgentBackupModelSettings,
      getAgentTaskLimit: decodeAgentTaskLimitSettings,
      updateAgentTaskLimit: decodeAgentTaskLimitSettings,
      getAgentPlanCard: decodeAgentPlanCardSettings,
      updateAgentPlanCard: decodeAgentPlanCardSettings,
      listBrowserProfiles: decodeBrowserProfileList,
      createBrowserProfile: decodeBrowserProfileSummary,
      updateBrowserProfile: decodeBrowserProfileSummary,
      clearBrowserData: decodeVoid,
      deleteBrowserProfile: decodeVoid,
      getAgentBrowserProfile: decodeAgentBrowserProfile,
      updateAgentBrowserProfile: decodeAgentBrowserProfile,
      listBrowserTabProfiles: decodeBrowserTabProfiles,
      updateAgentAdminSettings: decodeAgentAdminSettings,
      listAgentSkills: decodeInstalledSkillsFromMain,
      installAgentSkill: decodeInstalledSkill,
      uninstallAgentSkill: decodeVoid,
      setAgentSkillEnabled: decodeInstalledSkill,
      addMarketplaceAgent: decodeAddedAgent,
      addTemplateAgent: decodeAddedAgent,
    }),
    ...bridgeGroup(IPC_ENDPOINTS.agentAttachments, {
      importAttachmentData: decodeAttachments,
      chooseAttachments: decodeAttachments,
      discardDraftAttachment: decodeVoid,
      downloadAttachments: decodeVoid,
      openAttachment: decodeVoid,
      openSharedFile: decodeVoid,
      openWorkspaceFile: decodeVoid,
      previewSharedFile: decodeFilePreview,
      previewWorkspaceFile: decodeFilePreview,
      releaseFilePreview: decodeVoid,
      listWorkspaceDirectory: decodeWorkspaceDirectory,
    }),
    ...agentFoldersGroup,
    // The page gets the folder, not its path, as for a dropped attachment.
    addDroppedAgentFolder: async (agentId, folder) => {
      const path = webUtils.getPathForFile(folder);
      // An item from another app, with no path here: the page says that it is not a folder on this computer.
      if (!path)
        return {
          outcome: "refused",
          path: folder.name,
          refusal: "missing",
          list: await agentFoldersGroup.listAgentFolders(agentId),
        };
      return agentFoldersGroup.addAgentFolder({ agentId, path });
    },
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
    ...bridgeGroup(IPC_ENDPOINTS.browser, {
      open: decodeBrowserTab,
      activate: decodeVoid,
      navigate: decodeVoid,
      reload: decodeVoid,
      stop: decodeVoid,
      close: decodeVoid,
      takeControl: decodeVoid,
      releaseControl: decodeVoid,
      listTabs: decodeBrowserTabs,
      getDisplayState: decodeBrowserDisplayState,
      getControlState: decodeBrowserControlState,
      capturePreview: decodeBrowserPreviewFromMain,
      setVisible: decodeVoid,
      startLiveView: decodeVoid,
      stopLiveView: decodeVoid,
      liveViewEvent: decodeBrowserLiveViewEvent,
      displayState: decodeBrowserDisplayState,
      openPictureInPicture: decodeBrowserBounds,
      closePictureInPicture: decodeVoid,
      dockPictureInPicture: decodeVoid,
      hidePictureInPicture: decodeVoid,
      pictureInPictureEvent: decodeBrowserPictureInPictureEvent,
      openLocalSignIn: decodeBrowserLocalSignInEnd,
      finishLocalSignIn: decodeBrowserLocalSignInResult,
    }),
    // Untyped: the renderer and wire input shapes differ on purpose. See `IPC_ENDPOINTS.browserInput`.
    sendLiveViewInput: (input) =>
      ipcRenderer.invoke(IPC_ENDPOINTS.browserInput.sendLiveViewInput.channel, input).then(decodeVoid),
  },
  update: bridgeGroup(IPC_ENDPOINTS.update, {
    getStatus: decodeUpdateStatus,
    check: decodeUpdateStatus,
    download: decodeUpdateStatus,
    install: decodeVoid,
    getPreference: decodeUpdatePreference,
    setPreference: decodeUpdatePreference,
    cancelScheduledRestart: decodeUpdateStatus,
    restartWhenIdle: decodeUpdateStatus,
    cancelIdleRestart: decodeUpdateStatus,
    event: decodeUpdateStatus,
    preference: decodeUpdatePreference,
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
    ...serversGroup,
    list: async () => rememberActiveServer(await serversGroup.list()),
    select: async (serverId) => rememberActiveServer(await serversGroup.select(serverId)),
    reorder: async (input) => rememberActiveServer(await serversGroup.reorder(input)),
    setMuted: async (input) => rememberActiveServer(await serversGroup.setMuted(input)),
    setNotificationLevel: async (input) => rememberActiveServer(await serversGroup.setNotificationLevel(input)),
    join: async (input) => selectJoinedServer(await serversGroup.join(input)),
    login: async (input) => selectJoinedServer(await serversGroup.login(input)),
    onPresence: (listener, serverId) =>
      serversGroup.onScopedPresence((scoped) => {
        if (scoped.serverId === (serverId ?? selectedServerId)) listener(scoped.snapshot);
      }),
    onDirectMessage: (listener) =>
      serversGroup.onScopedDirectMessage((scoped) => {
        if (scoped.serverId === selectedServerId) listener(scoped.event);
      }),
    onDirectTyping: (listener) =>
      serversGroup.onScopedDirectTyping((scoped) => {
        if (scoped.serverId === selectedServerId) listener(scoped.event);
      }),
    onEvent: (listener) => serversGroup.onEvent((servers) => listener(rememberActiveServer(servers))),
  },
  plugins: bridgeGroup(IPC_ENDPOINTS.plugins, {
    takePendingListing: decodePendingListing,
    openListing: dropInvalid(decodePendingListing),
  }),
  host: bridgeGroup(IPC_ENDPOINTS.host, {
    getStatus: decodeHostStatus,
    configure: decodeHostStatus,
    updateIdentity: decodeHostStatus,
    rotateIdentityKey: decodeHostStatus,
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
  // The shared strict contract decoders, as MCP does: main decodes a remote answer with the same
  // decoder before it reaches this point.
  events: bridgeGroup(IPC_ENDPOINTS.events, {
    getStatus: decodeEventStatus,
    listRoutines: decodeEventRoutines,
    saveRoutine: decodeSaveEventRoutineResult,
    deleteRoutine: decodeVoid,
    testRoutine: decodeVoid,
    rotateSecret: decodeWebhookSecret,
    sendTestEvent: decodeWebhookTestResult,
    listActivity: decodeEventActivity,
    listRoutineRuns: decodeEventRoutineRuns,
  }),
  // The shared contract decoder, as MCP does: it already bounds every row, and a remote answer was
  // decoded in main before it reached this point.
  storage: bridgeGroup(IPC_ENDPOINTS.storage, {
    getUsage: decodeOptionalStorageUsage,
    getDisk: decodeOptionalStorageDisk,
    getMachineMetrics: decodeOptionalMachineMetrics,
    deleteFile: decodeVoid,
    clear: decodeVoid,
    openFile: decodeVoid,
    openLocation: decodeVoid,
    getRemovableRuntimes: decodeRemovableRuntimes,
    removeRemovableRuntimes: decodeRemovableRuntimes,
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
