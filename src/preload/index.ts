import {
  type AccountUsage,
  type AgentIpcRequest,
  type AgentMemory,
  type AgentModelOption,
  type AgentPublicationPreview,
  type AgentRequestChannel,
  type AgentStatus,
  type AgentSubmission,
  type AgentSummary,
  type AttachmentImportEvent,
  type BrowserPreview,
  COMPUTER_USE_STATUSES,
  type ComputerUseCoveredArea,
  type ComputerUseCursorPoint,
  type ComputerUseHighlightPlacement,
  type ComputerUsePermission,
  type ComputerUsePermissionApp,
  type ComputerUseState,
  type ConversationMessage,
  type ConversationPage,
  type ConversationReadState,
  type ConversationSearchPage,
  type ConversationWithReadState,
  type CustomProviderResult,
  type CustomProviderSummary,
  type DraftAttachment,
  type DuplicateAgentResult,
  type DynamicIslandAction,
  type DynamicIslandGeometry,
  type DynamicIslandPreference,
  type DynamicIslandPresentation,
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
  decodeOptionalAgentAnalytics,
  decodeOptionalHostAnalytics,
  decodeOptionalStorageUsage,
  decodeSaveAgentProfileResult,
  type ExportResult,
  type FilePreview,
  type HostedSiteSummary,
  type ImportAttachmentsInput,
  INSTALLED_SKILL_ORIGINS,
  type InnerPayloadOf,
  type InstalledSkill,
  type InstallMarketplaceAgentResult,
  IPC_CHANNELS,
  isAccountUsage,
  isAgentMemory,
  isAgentModelOption,
  isAgentProvider,
  isAgentStatus,
  isAgentSummary,
  isAttachmentSummary,
  isAvatarHue,
  isAvatarSeed,
  isConversationMessage,
  isConversationReadState,
  isConversationWithReadState,
  isCustomProviderResult,
  isCustomProviderSummary,
  isDynamicIslandAction,
  isDynamicIslandNotchSize,
  isDynamicIslandPreference,
  isDynamicIslandPresentation,
  isFilePreviewKind,
  isQueuedMessageReceipt,
  isQueueSnapshot,
  isRemoteDesktopSetupStatus,
  isRemoteDesktopTestStatus,
  isRoutine,
  isRoutineRun,
  isRoutineSchedule,
  isSharedTable,
  isSidebarLayoutSnapshot,
  isSkillCategory,
  isSkillNote,
  LOCAL_SERVER_ID,
  type MarketplaceAgentDetail,
  type MarketplaceAgentPage,
  type MarketplaceAgentSummary,
  type MarketplaceSkillDetail,
  type MarketplaceSkillPage,
  type OpenBotDesktopApi,
  type PayloadOf,
  type ProviderApiKeyState,
  type ProviderCodeLoginStart,
  type QueuedMessageReceipt,
  type QueueSnapshot,
  type RemoteDesktopSetupStatus,
  type RemoteDesktopTestStatus,
  type RequestChannel,
  type ResultOf,
  type SharedTable,
  type SidebarLayoutSnapshot,
  SKILL_DESCRIPTION_MAX_LENGTH,
  type SkillPackagePreview,
  type SkillSubmission,
  type UntypedRequestChannel,
  type VoiceModelStatus,
  type VoiceTranscriptionResult,
} from "@openbot/contracts/ipc";
import {
  decodeRecord,
  emptyDecoder,
  guardedDecoder,
  guardedListDecoder,
  nullableString,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from "@openbot/contracts/ipc-decoding";
import { isPluginSlug } from "@openbot/contracts/plugin-links";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { contextBridge, ipcRenderer, webUtils } from "electron";
import { decodeScopedAgentEvent } from "./agent-event-decoding";
import {
  decodeAccountSessions,
  decodeAnalyticsPreference,
  decodeAppInfo,
  decodeAppLanguagePreference,
  decodeApprovalAutomationPreference,
  decodeAppSetupState,
  decodeCentralAuthState,
  decodeMobileConnectedDevices,
  decodeMobileConnectTicket,
  decodeNotificationOpenedEvent,
  decodeNotificationPreference,
  decodeUpdatePreference,
  decodeUpdateStatus,
} from "./app-decoding";
import { clipboardFiles } from "./clipboard-files";
import { decodeProviderRuntimeSnapshot } from "./provider-runtime";
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

// The second overload of each agent helper serves the endpoints that have no types yet.
function invokeAgent<Channel extends AgentRequestChannel>(
  channel: Channel,
  payload: InnerPayloadOf<Channel>,
  decode: (value: unknown) => ResultOf<Channel>,
): Promise<ResultOf<Channel>>;
function invokeAgent<Result>(
  channel: UntypedRequestChannel,
  payload: unknown,
  decode: (value: unknown) => Result,
): Promise<Result>;
function invokeAgent<Result>(channel: string, payload: unknown, decode: (value: unknown) => Result): Promise<Result> {
  const request: AgentIpcRequest = { serverId: selectedServerId, payload };
  return ipcRenderer.invoke(channel, request).then(decode);
}

function invokeAgentForServer<Channel extends AgentRequestChannel>(
  serverId: string,
  channel: Channel,
  payload: InnerPayloadOf<Channel>,
  decode: (value: unknown) => ResultOf<Channel>,
): Promise<ResultOf<Channel>>;
function invokeAgentForServer<Result>(
  serverId: string,
  channel: UntypedRequestChannel,
  payload: unknown,
  decode: (value: unknown) => Result,
): Promise<Result>;
function invokeAgentForServer<Result>(
  serverId: string,
  channel: string,
  payload: unknown,
  decode: (value: unknown) => Result,
): Promise<Result> {
  const request: AgentIpcRequest = { serverId, payload };
  return ipcRenderer.invoke(channel, request).then(decode);
}

const VOICE_MODEL_PHASES: readonly VoiceModelStatus["phase"][] = ["missing", "downloading", "ready", "error"];

function decodeVoiceModelStatus(value: unknown): VoiceModelStatus {
  const status = decodeRecord(value, "voice model status");
  const { phase, progress } = status;
  if (!isOneOf(VOICE_MODEL_PHASES, phase) || (progress !== null && !isNumber(progress))) {
    throw new Error("Invalid voice model status.");
  }
  return { phase, progress, message: nullableString(status, "message") };
}

function decodeVoiceTranscriptionResult(value: unknown): VoiceTranscriptionResult {
  return { text: requiredString(decodeRecord(value, "voice transcription"), "text") };
}

function decodeExportResult(value: unknown): ExportResult {
  return { saved: requiredBoolean(decodeRecord(value, "export result"), "saved") };
}

// The slug is checked again on arrival rather than trusted because it came from main. It began life
// in a URL a web page chose, and this is the last point before the renderer looks it up.
function decodePendingListing(value: unknown): string | null {
  return typeof value === "string" && isPluginSlug(value) ? value : null;
}

function decodeComputerUseState(value: unknown): ComputerUseState {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(COMPUTER_USE_STATUSES, value.status) ||
    !Array.isArray(value.permissions) ||
    (value.message !== null && !isString(value.message))
  ) {
    throw new Error("Invalid Computer Use state.");
  }
  return {
    status: value.status,
    permissions: value.permissions.map(decodeComputerUsePermission),
    message: value.message,
  };
}

function decodeComputerUseCursorPoint(value: unknown): ComputerUseCursorPoint | null {
  if (value === null || value === undefined) return null;
  if (!isDynamicRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") {
    throw new Error("Invalid Computer Use highlight placement.");
  }
  return { x: value.x, y: value.y };
}

function decodeComputerUseHighlightPlacement(value: unknown): ComputerUseHighlightPlacement {
  if (
    !isDynamicRecord(value) ||
    typeof value.x !== "number" ||
    typeof value.y !== "number" ||
    typeof value.width !== "number" ||
    typeof value.height !== "number" ||
    typeof value.cornerRadius !== "number" ||
    typeof value.windowTitle !== "string" ||
    !Array.isArray(value.covered)
  ) {
    throw new Error("Invalid Computer Use highlight placement.");
  }
  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    cornerRadius: value.cornerRadius,
    windowTitle: value.windowTitle,
    cursor: decodeComputerUseCursorPoint(value.cursor),
    covered: value.covered.map(decodeComputerUseCoveredArea),
  };
}

function decodeComputerUseCoveredArea(value: unknown): ComputerUseCoveredArea {
  if (
    !isDynamicRecord(value) ||
    typeof value.x !== "number" ||
    typeof value.y !== "number" ||
    typeof value.width !== "number" ||
    typeof value.height !== "number"
  ) {
    throw new Error("Invalid Computer Use highlight placement.");
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function decodeComputerUsePermissionApp(value: unknown): ComputerUsePermissionApp | null {
  if (value === null) return null;
  if (
    !isDynamicRecord(value) ||
    !isString(value.name) ||
    (value.iconDataUrl !== null && !isString(value.iconDataUrl))
  ) {
    throw new Error("Invalid Computer Use application.");
  }
  return { name: value.name, iconDataUrl: value.iconDataUrl };
}

function decodeComputerUsePermission(value: unknown): ComputerUsePermission {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(["screen-recording", "accessibility"] as const, value.id) ||
    typeof value.granted !== "boolean"
  ) {
    throw new Error("Invalid Computer Use permission.");
  }
  return { id: value.id, granted: value.granted };
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

// A `FromMain` decoder has a same-shaped `FromHost` twin in `src/main/remote-host-decoding.ts` and
// its four wire-area siblings, and is deliberately not the same function: this side is checking what
// the main process sent the renderer, which is a trusted sender, while that side is checking a remote
// team server, which is not. The suffix is there so a later reader does not merge them onto whichever
// is looser. `src/main/ipc-channel-coverage.test.ts` checks the two sets name for name, so dropping a
// suffix or deleting one half is a red test rather than a comment nobody read.
function decodeBrowserPreviewFromMain(value: unknown): BrowserPreview {
  const preview = decodeRecord(value, "browser preview");
  const dataUrl = requiredString(preview, "dataUrl");
  const width = requiredNumber(preview, "width");
  const height = requiredNumber(preview, "height");
  if (
    dataUrl.length > 2_000_000 ||
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl) ||
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    width > 960 ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    height > 600
  ) {
    throw new Error("Invalid browser preview.");
  }
  return { dataUrl, width, height };
}

const decodeVoid = emptyDecoder("IPC returned unexpected data.");

function decodeHostedSite(value: unknown): HostedSiteSummary {
  const site = decodeRecord(value, "hosted site");
  if (
    !isString(site.id) ||
    !isString(site.hostname) ||
    !isString(site.url) ||
    !isString(site.title) ||
    !isString(site.description) ||
    (site.framework !== "vanilla" && site.framework !== "astro") ||
    (site.status !== "active" && site.status !== "deleted" && site.status !== "expired" && site.status !== "blocked") ||
    !isNumber(site.fileCount) ||
    !isNumber(site.size) ||
    (site.expiresAt !== null && !isString(site.expiresAt)) ||
    !isString(site.updatedAt)
  ) {
    throw new Error("Invalid hosted site response.");
  }
  return {
    id: site.id,
    hostname: site.hostname,
    url: site.url,
    title: site.title,
    description: site.description,
    framework: site.framework,
    status: decodeHostedSiteStatus(site.status),
    fileCount: site.fileCount,
    size: site.size,
    expiresAt: site.expiresAt,
    updatedAt: site.updatedAt,
  };
}

function decodeHostedSiteStatus(value: unknown): HostedSiteSummary["status"] {
  if (value === "active" || value === "deleted" || value === "expired" || value === "blocked") return value;
  throw new Error("Invalid hosted site status.");
}

function decodeHostedSites(value: unknown): HostedSiteSummary[] {
  if (!Array.isArray(value)) throw new Error("Invalid hosted site list response.");
  return value.map(decodeHostedSite);
}

/**
 * The guard, not a decoder of its own: it is the assertion that a summary carries no `apiKey`, and a
 * second implementation here could disagree with it. It fails closed on the whole list, so a main
 * process that ever put a key in a row empties the picker rather than leaking one.
 */
function decodeCustomProviders(value: unknown): CustomProviderSummary[] {
  if (!Array.isArray(value) || !value.every(isCustomProviderSummary)) {
    throw new Error("Invalid custom provider list response.");
  }
  return value;
}

function decodeCustomProviderResult(value: unknown): CustomProviderResult {
  if (!isCustomProviderResult(value)) throw new Error("Invalid custom provider response.");
  return value;
}

function decodeNullablePath(value: unknown): string | null {
  if (value !== null && !isString(value)) throw new Error("Invalid directory response.");
  return value;
}

function decodeDynamicIslandPreference(value: unknown): DynamicIslandPreference {
  if (!isDynamicIslandPreference(value)) throw new Error("Invalid Dynamic Island preference response.");
  return value;
}

function decodeDynamicIslandGeometry(value: unknown): DynamicIslandGeometry {
  if (value === null) return null;
  if (!isDynamicIslandNotchSize(value)) throw new Error("Invalid Dynamic Island geometry.");
  return value;
}

function decodeDynamicIslandPresentation(value: unknown): DynamicIslandPresentation {
  if (!isDynamicIslandPresentation(value)) throw new Error("Invalid Dynamic Island presentation.");
  return value;
}

function decodeDynamicIslandAction(value: unknown): DynamicIslandAction {
  if (isDynamicIslandAction(value)) return value;
  throw new Error("Invalid Dynamic Island action.");
}

const decodeRoutine = guardedDecoder(isRoutine, "routine response");
const decodeRoutines = guardedListDecoder(isRoutine, "routine list response");
const decodeRoutineRun = guardedDecoder(isRoutineRun, "routine run response");
const decodeRoutineRuns = guardedListDecoder(isRoutineRun, "routine history response");

function decodeFilePreview(value: unknown): FilePreview {
  const preview = decodeRecord(value, "file preview");
  if (
    !isString(preview.name) ||
    !isNumber(preview.size) ||
    !isString(preview.mimeType) ||
    !isFilePreviewKind(preview.previewKind) ||
    (preview.bytes !== null && !(preview.bytes instanceof Uint8Array))
  ) {
    throw new Error("Invalid file preview response.");
  }
  return {
    name: preview.name,
    size: preview.size,
    mimeType: preview.mimeType,
    previewKind: preview.previewKind,
    bytes: preview.bytes,
  };
}

/** A reply carrying nothing but the provider and a status, so an unexpected field cannot slip in. */
function decodeProviderApiKeyState(value: unknown): ProviderApiKeyState {
  if (
    !isDynamicRecord(value) ||
    !isAgentProvider(value.provider) ||
    !isOneOf(["missing", "saved", "unreadable"] as const, value.status)
  ) {
    throw new Error("Invalid provider key state response.");
  }
  return { provider: value.provider, status: value.status };
}

/**
 * A started code sign-in, checked field by field before the renderer shows it.
 *
 * The verification URL ends up in a link the user is invited to open, so it is held to https here
 * as well as in the backend: this is the last point before it reaches the screen.
 */
function decodeProviderCodeLoginStart(value: unknown): ProviderCodeLoginStart {
  if (!isDynamicRecord(value)) throw new Error("Invalid code login response.");
  if (value.kind === "connected") return { kind: "connected" };
  if (
    value.kind !== "code" ||
    !isString(value.userCode) ||
    !isString(value.verificationUrl) ||
    !isNumber(value.expiresAt)
  ) {
    throw new Error("Invalid code login response.");
  }
  if (new URL(value.verificationUrl).protocol !== "https:") throw new Error("Invalid code login response.");
  return {
    kind: "code",
    userCode: value.userCode,
    verificationUrl: value.verificationUrl,
    expiresAt: value.expiresAt,
  };
}

function decodeAgentStatusFromMain(value: unknown): AgentStatus {
  if (!isAgentStatus(value)) throw new Error("Invalid agent status response.");
  return value;
}

function decodeAccountUsageFromMain(value: unknown): AccountUsage {
  if (!isAccountUsage(value)) throw new Error("Invalid agent usage response.");
  return value;
}

// Fails closed on a member for the same reason as `decodeAgentModelOptions` in the main process, and
// it is the local half of the same payload: `isAgentModel` gaining square brackets is what stopped a
// provider CLI's `claude-fable-5-1[1m]` from emptying this app's own model picker, not a decoder
// willing to hand the renderer a list shorter than the one the main process sent.
function decodeAgentModels(value: unknown): AgentModelOption[] {
  if (!Array.isArray(value) || !value.every(isAgentModelOption)) {
    throw new Error("Invalid agent model response.");
  }
  return value;
}

function decodeAgent(value: unknown): AgentSummary {
  if (!isAgentSummary(value)) throw new Error("Invalid agent response.");
  return value;
}

function decodeAgents(value: unknown): AgentSummary[] {
  if (!Array.isArray(value) || !value.every(isAgentSummary)) {
    throw new Error("Invalid agent list response.");
  }
  return value;
}

function decodeMemory(value: unknown): AgentMemory {
  if (!isAgentMemory(value)) throw new Error("Invalid agent memory response.");
  return value;
}

function decodeTables(value: unknown): SharedTable[] {
  if (!Array.isArray(value) || !value.every(isSharedTable)) throw new Error("Invalid shared tables response.");
  return value;
}

function decodeMemories(value: unknown): AgentMemory[] {
  if (!Array.isArray(value) || !value.every(isAgentMemory)) throw new Error("Invalid agent memories response.");
  return value;
}

function decodeSidebarLayout(value: unknown): SidebarLayoutSnapshot {
  if (!isSidebarLayoutSnapshot(value)) throw new Error("Invalid sidebar layout response.");
  return value;
}

function decodeDuplicateAgentResultFromMain(value: unknown): DuplicateAgentResult {
  const item = decodeRecord(value, "agent duplication");
  return { agent: decodeAgent(item.agent), layout: decodeSidebarLayout(item.layout) };
}

function decodeConversation(value: unknown): ConversationWithReadState {
  if (!isConversationWithReadState(value)) throw new Error("Invalid conversation response.");
  return value;
}

function decodeConversationPageFromMain(value: unknown): ConversationPage {
  if (!isDynamicRecord(value) || !isString(value.agentId) || !Array.isArray(value.messages)) {
    throw new Error("Invalid conversation page response.");
  }
  const pageInfo = decodeRecord(value.pageInfo, "conversation page info");
  return {
    agentId: value.agentId,
    threadId: nullableString(value, "threadId"),
    activeTurnId: nullableString(value, "activeTurnId"),
    revision: requiredNumber(value, "revision"),
    messages: decodeConversationMessages(value.messages),
    references: decodeConversationReferencesFromMain(value.references),
    pageInfo: {
      hasOlder: requiredBoolean(pageInfo, "hasOlder"),
      olderCursor: nullableString(pageInfo, "olderCursor"),
    },
    ...(value.readState === undefined ? {} : { readState: decodeReadState(value.readState) }),
  };
}

function decodeConversationSearchPageFromMain(value: unknown): ConversationSearchPage {
  const item = decodeRecord(value, "conversation search page");
  if (!Array.isArray(item.results)) throw new Error("Invalid conversation search results.");
  return {
    results: item.results.map((value) => {
      const result = decodeRecord(value, "conversation search result");
      if (!isConversationMessage(result.message)) throw new Error("Invalid conversation search message.");
      return { agentId: requiredString(result, "agentId"), message: result.message };
    }),
    total: requiredNumber(item, "total"),
    nextCursor: nullableString(item, "nextCursor"),
  };
}

const decodeConversationMessages = guardedListDecoder(isConversationMessage, "conversation messages");

function decodeConversationReferencesFromMain(value: unknown): Record<string, ConversationMessage> {
  const references = decodeRecord(value, "conversation references");
  const decoded: Record<string, ConversationMessage> = {};
  for (const [messageId, message] of Object.entries(references)) {
    if (!isConversationMessage(message)) throw new Error("Invalid conversation reference.");
    decoded[messageId] = message;
  }
  return decoded;
}

function decodeReadState(value: unknown): ConversationReadState {
  if (!isConversationReadState(value)) throw new Error("Invalid conversation read state.");
  return value;
}

function decodeReadStates(value: unknown): Record<string, ConversationReadState> {
  const item = decodeRecord(value, "conversation reads");
  return Object.fromEntries(Object.entries(item).map(([agentId, state]) => [agentId, decodeReadState(state)]));
}

function decodeAttachments(value: unknown): DraftAttachment[] {
  if (!Array.isArray(value) || !value.every(isAttachmentSummary)) {
    throw new Error("Invalid attachment response.");
  }
  return value;
}

function decodeReceipt(value: unknown): QueuedMessageReceipt {
  if (!isQueuedMessageReceipt(value)) {
    throw new Error("Invalid queued message response.");
  }
  return value;
}

function decodeQueue(value: unknown): QueueSnapshot {
  if (!isQueueSnapshot(value)) {
    throw new Error("Invalid queue response.");
  }
  return value;
}

function decodeSkillSummary(value: unknown) {
  const item = decodeRecord(value, "marketplace skill");
  if (!isSkillCategory(item.category)) throw new Error("Invalid skill category.");
  return {
    id: requiredString(item, "id"),
    slug: requiredString(item, "slug"),
    name: requiredString(item, "name"),
    description: requiredString(item, "description"),
    category: item.category,
    creatorName: requiredString(item, "creatorName"),
    creatorAvatarUrl: item.creatorAvatarUrl === undefined ? null : nullableString(item, "creatorAvatarUrl"),
    version: requiredNumber(item, "version"),
    installs: requiredNumber(item, "installs"),
    featured: requiredBoolean(item, "featured"),
    iconUrl: nullableString(item, "iconUrl"),
    updatedAt: requiredString(item, "updatedAt"),
  };
}

function decodeSkillPage(value: unknown): MarketplaceSkillPage {
  const page = decodeRecord(value, "marketplace page");
  if (!Array.isArray(page.skills)) throw new Error("Invalid marketplace skills.");
  return { skills: page.skills.map(decodeSkillSummary), nextCursor: nullableString(page, "nextCursor") };
}

function decodeSkillDetails(value: unknown): MarketplaceSkillDetail[] {
  if (!Array.isArray(value)) throw new Error("Invalid local skill list.");
  return value.map(decodeSkillDetail);
}

function decodeSkillDetail(value: unknown): MarketplaceSkillDetail {
  const item = decodeRecord(value, "skill detail");
  const summary = decodeSkillSummary(item);
  if (!Array.isArray(item.files) || !item.files.every(isString)) throw new Error("Invalid skill files.");
  return {
    ...summary,
    versionId: requiredString(item, "versionId"),
    bundleSha256: requiredString(item, "bundleSha256"),
    files: item.files,
    instructions: requiredString(item, "instructions"),
    ...(isString(item.examplePrompt) && item.examplePrompt.trim().length <= 1000
      ? { examplePrompt: item.examplePrompt.trim() }
      : {}),
  };
}

function decodeSubmission(value: unknown): SkillSubmission {
  const item = decodeRecord(value, "skill submission");
  const status = item.status;
  if (!isSkillCategory(item.category) || !isOneOf(["pending", "approved", "rejected"], status)) {
    throw new Error("Invalid skill submission state.");
  }
  return {
    showCreatorAvatar: item.showCreatorAvatar === undefined ? false : requiredBoolean(item, "showCreatorAvatar"),
    id: requiredString(item, "id"),
    skillId: requiredString(item, "skillId"),
    slug: requiredString(item, "slug"),
    name: requiredString(item, "name"),
    description: requiredString(item, "description"),
    category: item.category,
    version: requiredNumber(item, "version"),
    status,
    rejectionNote: nullableString(item, "rejectionNote"),
    iconUrl: nullableString(item, "iconUrl"),
    createdAt: requiredString(item, "createdAt"),
  };
}

function decodeSubmissions(value: unknown): SkillSubmission[] {
  if (!Array.isArray(value)) throw new Error("Invalid skill submissions.");
  return value.map(decodeSubmission);
}

function decodeSkillPreview(value: unknown): SkillPackagePreview | null {
  if (value === null) return null;
  const item = decodeRecord(value, "skill package preview");
  if (!Array.isArray(item.files) || !item.files.every(isString)) throw new Error("Invalid skill package files.");
  return {
    draftId: requiredString(item, "draftId"),
    name: requiredString(item, "name"),
    description: requiredString(item, "description"),
    slug: requiredString(item, "slug"),
    files: item.files,
    size: requiredNumber(item, "size"),
  };
}

function decodeInstalledSkill(value: unknown): InstalledSkill {
  const item = decodeRecord(value, "installed skill");
  const state = item.state;
  if (!isOneOf(["installed", "update-available", "modified", "needs-repair"], state)) {
    throw new Error("Invalid installed skill state.");
  }
  const description = optionalSkillDescription(item.description);
  return {
    skillId: requiredString(item, "skillId"),
    slug: requiredString(item, "slug"),
    name: requiredString(item, "name"),
    installedVersion: requiredNumber(item, "installedVersion"),
    availableVersion: requiredNumber(item, "availableVersion"),
    state,
    ...(item.enabled === false ? { enabled: false } : item.enabled === true ? { enabled: true } : {}),
    ...(isOneOf(INSTALLED_SKILL_ORIGINS, item.origin) ? { origin: item.origin } : {}),
    ...(description ? { description } : {}),
    ...(isSkillNote(item.location) ? { location: item.location } : {}),
    ...(isSkillNote(item.problem) ? { problem: item.problem } : {}),
  };
}

function optionalSkillDescription(value: unknown): string | undefined {
  if (!isString(value)) return undefined;
  const description = value.trim();
  return description && description.length <= SKILL_DESCRIPTION_MAX_LENGTH ? description : undefined;
}

function decodeInstalledSkillsFromMain(value: unknown): InstalledSkill[] {
  if (!Array.isArray(value)) throw new Error("Invalid installed skills.");
  return value.map(decodeInstalledSkill);
}

function decodeMarketplaceAgentSummary(value: unknown): MarketplaceAgentSummary {
  const item = decodeRecord(value, "marketplace agent");
  if (!isAvatarSeed(item.avatarSeed) || (item.avatarHue !== null && !isAvatarHue(item.avatarHue)))
    throw new Error("Invalid marketplace agent avatar.");
  if (item.category !== undefined && !isSkillCategory(item.category)) throw new Error("Invalid agent category.");
  return {
    category: item.category ?? "other",
    id: requiredString(item, "id"),
    name: requiredString(item, "name"),
    title: requiredString(item, "title"),
    description: requiredString(item, "description"),
    creatorName: requiredString(item, "creatorName"),
    creatorAvatarUrl: item.creatorAvatarUrl === undefined ? null : nullableString(item, "creatorAvatarUrl"),
    version: requiredNumber(item, "version"),
    installs: requiredNumber(item, "installs"),
    featured: requiredBoolean(item, "featured"),
    avatarSeed: item.avatarSeed,
    avatarHue: item.avatarHue,
    avatarUrl: nullableString(item, "avatarUrl"),
    skillCount: requiredNumber(item, "skillCount"),
    routineCount: requiredNumber(item, "routineCount"),
    activeRoutineCount: requiredNumber(item, "activeRoutineCount"),
    updatedAt: requiredString(item, "updatedAt"),
  };
}

function decodeMarketplaceAgentPage(value: unknown): MarketplaceAgentPage {
  const page = decodeRecord(value, "marketplace agent page");
  if (!Array.isArray(page.agents)) throw new Error("Invalid marketplace agents.");
  return {
    agents: page.agents.map(decodeMarketplaceAgentSummary),
    nextCursor: nullableString(page, "nextCursor"),
  };
}

function decodeMarketplaceAgentDetail(value: unknown): MarketplaceAgentDetail {
  const item = decodeRecord(value, "marketplace agent detail");
  const summary = decodeMarketplaceAgentSummary(item);
  if (
    !Array.isArray(item.skills) ||
    !item.skills.every((skill) => {
      if (!isDynamicRecord(skill)) return false;
      return [skill.skillId, skill.versionId, skill.slug, skill.name].every(isString) && isNumber(skill.version);
    })
  )
    throw new Error("Invalid marketplace agent skills.");
  if (
    !Array.isArray(item.routines) ||
    !item.routines.every(
      (routine) =>
        isDynamicRecord(routine) &&
        isString(routine.name) &&
        isString(routine.instruction) &&
        isBoolean(routine.active) &&
        isRoutineSchedule(routine.schedule),
    )
  )
    throw new Error("Invalid marketplace agent routines.");
  return { ...summary, versionId: requiredString(item, "versionId"), skills: item.skills, routines: item.routines };
}

function decodeAgentSubmission(value: unknown): AgentSubmission {
  const item = decodeRecord(value, "agent submission");
  if (
    !isOneOf(["pending", "approved", "rejected"], item.status) ||
    !isAvatarSeed(item.avatarSeed) ||
    (item.avatarHue !== null && !isAvatarHue(item.avatarHue))
  )
    throw new Error("Invalid agent submission.");
  if (item.category !== undefined && !isSkillCategory(item.category)) throw new Error("Invalid agent category.");
  return {
    showCreatorAvatar: item.showCreatorAvatar === undefined ? false : requiredBoolean(item, "showCreatorAvatar"),
    category: item.category ?? "other",
    id: requiredString(item, "id"),
    listingId: requiredString(item, "listingId"),
    name: requiredString(item, "name"),
    title: requiredString(item, "title"),
    description: requiredString(item, "description"),
    version: requiredNumber(item, "version"),
    status: item.status,
    rejectionNote: nullableString(item, "rejectionNote"),
    avatarSeed: item.avatarSeed,
    avatarHue: item.avatarHue,
    avatarUrl: nullableString(item, "avatarUrl"),
    skillCount: requiredNumber(item, "skillCount"),
    routineCount: requiredNumber(item, "routineCount"),
    activeRoutineCount: requiredNumber(item, "activeRoutineCount"),
    createdAt: requiredString(item, "createdAt"),
  };
}

function decodeAgentSubmissions(value: unknown): AgentSubmission[] {
  if (!Array.isArray(value)) throw new Error("Invalid agent submissions.");
  return value.map(decodeAgentSubmission);
}

function decodeAgentInstallation(value: unknown): InstallMarketplaceAgentResult {
  const item = decodeRecord(value, "agent installation");
  return { agent: decodeAgent(item.agent) };
}

function decodeAgentPublicationPreview(value: unknown): AgentPublicationPreview {
  const item = decodeRecord(value, "agent publication preview");
  const detail = decodeMarketplaceAgentDetail({
    ...item,
    id: item.agentId,
    creatorName: "",
    version: 1,
    installs: 0,
    featured: false,
    skillCount: Array.isArray(item.skills) ? item.skills.length : -1,
    routineCount: Array.isArray(item.routines) ? item.routines.length : -1,
    activeRoutineCount: Array.isArray(item.routines)
      ? item.routines.filter((routine) => isDynamicRecord(routine) && routine.active === true).length
      : -1,
    updatedAt: "",
    versionId: "preview",
  });
  return {
    agentId: requiredString(item, "agentId"),
    name: detail.name,
    title: detail.title,
    description: detail.description,
    avatarSeed: detail.avatarSeed,
    avatarHue: detail.avatarHue,
    avatarUrl: detail.avatarUrl,
    skills: detail.skills,
    routines: detail.routines,
  };
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
  onAppLanguagePreference: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, preference: unknown) =>
      listener(decodeAppLanguagePreference(preference));
    ipcRenderer.on(IPC_CHANNELS.appLanguagePreference, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.appLanguagePreference, handler);
  },
  onOpenSettings: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(IPC_CHANNELS.openSettings, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.openSettings, handler);
  },
  dynamicIsland: {
    getPreference: () => invokeRequest(IPC_CHANNELS.dynamicIslandGetPreference, decodeDynamicIslandPreference),
    setPreference: (input) =>
      invokeRequest(IPC_CHANNELS.dynamicIslandSetPreference, decodeDynamicIslandPreference, input),
    publishPresentation: (presentation) =>
      invokeRequest(IPC_CHANNELS.dynamicIslandPublishPresentation, decodeVoid, presentation),
    getPresentation: () => invokeRequest(IPC_CHANNELS.dynamicIslandGetPresentation, decodeDynamicIslandPresentation),
    onPreference: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, preference: unknown) =>
        listener(decodeDynamicIslandPreference(preference));
      ipcRenderer.on(IPC_CHANNELS.dynamicIslandPreference, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.dynamicIslandPreference, handler);
    },
    onPresentation: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, presentation: unknown) =>
        listener(decodeDynamicIslandPresentation(presentation));
      ipcRenderer.on(IPC_CHANNELS.dynamicIslandPresentation, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.dynamicIslandPresentation, handler);
    },
    onGeometry: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, geometry: unknown) =>
        listener(decodeDynamicIslandGeometry(geometry));
      ipcRenderer.on(IPC_CHANNELS.dynamicIslandGeometry, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.dynamicIslandGeometry, handler);
    },
    performAction: (action) => invokeRequest(IPC_CHANNELS.dynamicIslandPerformAction, decodeVoid, action),
    performHaptic: () => invokeRequest(IPC_CHANNELS.dynamicIslandPerformHaptic, decodeVoid),
    onAction: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, action: unknown) =>
        listener(decodeDynamicIslandAction(action));
      ipcRenderer.on(IPC_CHANNELS.dynamicIslandAction, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.dynamicIslandAction, handler);
    },
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
  onComputerUseHighlightPlacement: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, placement: unknown) =>
      listener(decodeComputerUseHighlightPlacement(placement));
    ipcRenderer.on(IPC_CHANNELS.computerUseHighlightPlacement, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.computerUseHighlightPlacement, handler);
  },
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
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, snapshot: unknown) =>
        listener(decodeProviderRuntimeSnapshot(snapshot));
      ipcRenderer.on(IPC_CHANNELS.providerRuntimesEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.providerRuntimesEvent, handler);
    },
  },
  openUrl: (url) => invokeRequest(IPC_CHANNELS.openUrl, decodeVoid, url),
  voice: {
    getModelStatus: () => invokeRequest(IPC_CHANNELS.voiceGetModelStatus, decodeVoiceModelStatus),
    prepareModel: () => invokeRequest(IPC_CHANNELS.voicePrepareModel, decodeVoiceModelStatus),
    transcribe: (input) => invokeRequest(IPC_CHANNELS.voiceTranscribe, decodeVoiceTranscriptionResult, input),
    onModelStatus: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) => listener(decodeVoiceModelStatus(status));
      ipcRenderer.on(IPC_CHANNELS.voiceModelStatus, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.voiceModelStatus, handler);
    },
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
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(decodeCentralAuthState(state));
      ipcRenderer.on(IPC_CHANNELS.authEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.authEvent, handler);
    },
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
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const payload = decodeScopedAgentEvent(value);
        if (payload.serverId === selectedServerId) listener(payload.event);
      };
      ipcRenderer.on(IPC_CHANNELS.agentEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.agentEvent, handler);
    },
    onScopedEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => listener(decodeScopedAgentEvent(value));
      ipcRenderer.on(IPC_CHANNELS.agentEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.agentEvent, handler);
    },
  },
  browser: {
    open: (input) => ipcRenderer.invoke(IPC_CHANNELS.browserOpen, input),
    activate: (tabId) => ipcRenderer.invoke(IPC_CHANNELS.browserActivate, tabId),
    navigate: (input) => ipcRenderer.invoke(IPC_CHANNELS.browserNavigate, input),
    reload: (tabId) => ipcRenderer.invoke(IPC_CHANNELS.browserReload, tabId),
    close: (tabId) => ipcRenderer.invoke(IPC_CHANNELS.browserClose, tabId),
    listTabs: () => ipcRenderer.invoke(IPC_CHANNELS.browserListTabs),
    getDisplayState: () => ipcRenderer.invoke(IPC_CHANNELS.browserGetDisplayState),
    getControlState: () => ipcRenderer.invoke(IPC_CHANNELS.browserGetControlState),
    capturePreview: (tabId) =>
      ipcRenderer.invoke(IPC_CHANNELS.browserCapturePreview, tabId).then(decodeBrowserPreviewFromMain),
    setVisible: (input) => ipcRenderer.invoke(IPC_CHANNELS.browserSetVisible, input),
    startLiveView: (tabId) => ipcRenderer.invoke(IPC_CHANNELS.browserStartLiveView, tabId),
    stopLiveView: () => ipcRenderer.invoke(IPC_CHANNELS.browserStopLiveView),
    sendLiveViewInput: (input) => ipcRenderer.invoke(IPC_CHANNELS.browserSendLiveViewInput, input),
    onLiveViewEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, event: Parameters<typeof listener>[0]) => listener(event);
      ipcRenderer.on(IPC_CHANNELS.browserLiveViewEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.browserLiveViewEvent, handler);
    },
    onDisplayState: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state);
      ipcRenderer.on(IPC_CHANNELS.browserDisplayStateEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.browserDisplayStateEvent, handler);
    },
    openPictureInPicture: (bounds) => ipcRenderer.invoke(IPC_CHANNELS.browserPictureInPictureOpen, bounds),
    closePictureInPicture: () => ipcRenderer.invoke(IPC_CHANNELS.browserPictureInPictureClose),
    dockPictureInPicture: () => ipcRenderer.invoke(IPC_CHANNELS.browserPictureInPictureDock),
    hidePictureInPicture: () => ipcRenderer.invoke(IPC_CHANNELS.browserPictureInPictureHide),
    onPictureInPictureEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, event: Parameters<typeof listener>[0]) => listener(event);
      ipcRenderer.on(IPC_CHANNELS.browserPictureInPictureEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.browserPictureInPictureEvent, handler);
    },
  },
  update: {
    getStatus: () => invokeRequest(IPC_CHANNELS.updateGetStatus, decodeUpdateStatus),
    check: () => invokeRequest(IPC_CHANNELS.updateCheck, decodeUpdateStatus),
    download: () => invokeRequest(IPC_CHANNELS.updateDownload, decodeUpdateStatus),
    install: () => invokeRequest(IPC_CHANNELS.updateInstall, decodeVoid),
    getPreference: () => invokeRequest(IPC_CHANNELS.updateGetPreference, decodeUpdatePreference),
    setPreference: (input) => invokeRequest(IPC_CHANNELS.updateSetPreference, decodeUpdatePreference, input),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) => listener(decodeUpdateStatus(status));
      ipcRenderer.on(IPC_CHANNELS.updateEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.updateEvent, handler);
    },
  },
  notifications: {
    getPreference: () => invokeRequest(IPC_CHANNELS.notificationsGetPreference, decodeNotificationPreference),
    setPreference: (input) =>
      invokeRequest(IPC_CHANNELS.notificationsSetPreference, decodeNotificationPreference, input),
    test: () => invokeRequest(IPC_CHANNELS.notificationsTest, decodeVoid),
    openSettings: () => invokeRequest(IPC_CHANNELS.notificationsOpenSettings, decodeVoid),
    onOpened: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, opened: unknown) =>
        listener(decodeNotificationOpenedEvent(opened));
      ipcRenderer.on(IPC_CHANNELS.notificationsOpenedEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.notificationsOpenedEvent, handler);
    },
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
    onPresence: (listener, serverId) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        const scoped = decodeScopedTeamPresence(payload);
        if (scoped.serverId === (serverId ?? selectedServerId)) listener(scoped.snapshot);
      };
      ipcRenderer.on(IPC_CHANNELS.serversPresence, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.serversPresence, handler);
    },
    listDirectThreads: () => invokeRequest(IPC_CHANNELS.serversListDirectThreads, decodeDirectThreads),
    readDirectConversation: (memberId) =>
      invokeRequest(IPC_CHANNELS.serversReadDirectConversation, decodeDirectConversation, memberId),
    readDirectConversationPage: (input) =>
      invokeRequest(IPC_CHANNELS.serversReadDirectConversationPage, decodeDirectConversationPage, input),
    sendDirectMessage: (input) => invokeRequest(IPC_CHANNELS.serversSendDirectMessage, decodeDirectMessage, input),
    markDirectRead: (input) => invokeRequest(IPC_CHANNELS.serversMarkDirectRead, decodeDirectReadState, input),
    setDirectTyping: (input) => invokeRequest(IPC_CHANNELS.serversSetDirectTyping, decodeVoid, input),
    onDirectMessage: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        const scoped = decodeScopedDirectMessage(payload);
        if (scoped.serverId === selectedServerId) listener(scoped.event);
      };
      ipcRenderer.on(IPC_CHANNELS.serversDirectMessage, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.serversDirectMessage, handler);
    },
    onDirectTyping: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        const scoped = decodeScopedDirectTyping(payload);
        if (scoped.serverId === selectedServerId) listener(scoped.event);
      };
      ipcRenderer.on(IPC_CHANNELS.serversDirectTyping, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.serversDirectTyping, handler);
    },
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, servers: unknown) =>
        listener(rememberActiveServer(decodeServers(servers)));
      ipcRenderer.on(IPC_CHANNELS.serversEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.serversEvent, handler);
    },
    onInvite: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, inviteUrl: unknown) => listener(decodeInviteUrl(inviteUrl));
      ipcRenderer.on(IPC_CHANNELS.serversInvite, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.serversInvite, handler);
    },
  },
  plugins: {
    takePendingListing: () => invokeRequest(IPC_CHANNELS.pluginsTakePendingListing, decodePendingListing),
    onOpenListing: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, slug: unknown) => {
        if (typeof slug === "string" && isPluginSlug(slug)) listener(slug);
      };
      ipcRenderer.on(IPC_CHANNELS.pluginsOpenListing, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.pluginsOpenListing, handler);
    },
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
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) => listener(decodeHostStatus(status));
      ipcRenderer.on(IPC_CHANNELS.hostEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.hostEvent, handler);
    },
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
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, sessions: unknown) =>
        listener(decodeRemoteDesktopSessions(sessions));
      ipcRenderer.on(IPC_CHANNELS.remoteDesktopEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.remoteDesktopEvent, handler);
    },
  },
};

contextBridge.exposeInMainWorld("openbot", openbotApi);

function decodeAgentAnalyticsFromMain(value: unknown) {
  return decodeOptionalAgentAnalytics(value);
}

function decodeHostAnalyticsFromMain(value: unknown) {
  return decodeOptionalHostAnalytics(value);
}

function decodeRemoteDesktopSetupFromMain(value: unknown): RemoteDesktopSetupStatus {
  if (!isRemoteDesktopSetupStatus(value)) throw new Error("Invalid remote desktop setup response.");
  return { ...value };
}
function decodeRemoteDesktopTestFromMain(value: unknown): RemoteDesktopTestStatus {
  if (!isRemoteDesktopTestStatus(value)) throw new Error("Invalid remote desktop test response.");
  return { ...value };
}
