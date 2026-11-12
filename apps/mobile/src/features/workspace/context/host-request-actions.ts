import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import {
  type AvatarColor,
  agentSpeed,
  assertStorageUsageScope,
  CHANNEL_CHATS_CAPABILITY,
  canAdministerServer,
  decodeAgentAdminSettings,
  decodeAgentBackupModelSettings,
  decodeAgentDefaultsOverview,
  decodeAgentFastModels,
  decodeAgentFastModeSettings,
  decodeAgentHostSettings,
  decodeAgentInstructionsFileFromMain,
  decodeAgentNewChatSettings,
  decodeAgentPlanCardSettings,
  decodeAgentSpeedSettings,
  decodeAgentTaskLimitSettings,
  decodeChannelRoutineRuns,
  decodeChannelRoutines,
  decodeChannelSummaries,
  decodeInstalledSkills,
  decodeMachineMetrics,
  decodeStorageUsage,
  type HiddenAgent,
  isAgentMemory,
  isClientAgentModelOption,
  isKnownAgentProvider,
  isQueueSnapshot,
  isRoutine,
  isRoutineRun,
  LEGACY_RESPONSE_STYLE,
  MCP_SERVERS_CAPABILITY,
  type RoutineCalendarOwner,
  type SetAgentHiddenInput,
  STORAGE_CAPABILITY,
  type TeamRole,
  withFastServiceTiers,
  withWhatsAppWorkingMessages,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-access-v1";
import { AGENT_ADMIN_CAPABILITY, AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import {
  AGENT_BACKUP_MODELS_CAPABILITY,
  AGENT_BACKUP_MODELS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-backup-models-v1";
import {
  AGENT_COLORS_CAPABILITY,
  AGENT_COLORS_ROUTES,
  type AgentColorsSnapshot,
  decodeAgentColorsSnapshot,
} from "@openbot/contracts/team-protocol/agent-colors-v1";
import { AGENT_DEFAULTS_CAPABILITY, AGENT_DEFAULTS_ROUTES } from "@openbot/contracts/team-protocol/agent-defaults-v1";
import {
  AGENT_FAST_MODE_CAPABILITY,
  AGENT_FAST_MODE_ROUTES,
} from "@openbot/contracts/team-protocol/agent-fast-mode-v1";
import { AGENT_FOLDERS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-folders-v1";
import { AGENT_HIDDEN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import {
  AGENT_HOST_SETTINGS_CAPABILITY,
  AGENT_HOST_SETTINGS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import { AGENT_IMPORT_CAPABILITY, AGENT_IMPORT_UPLOAD_BYTES } from "@openbot/contracts/team-protocol/agent-import-v1";
import { AGENT_IMPORT_V2_CAPABILITY } from "@openbot/contracts/team-protocol/agent-import-v2";
import { AGENT_INSTALL_CAPABILITY } from "@openbot/contracts/team-protocol/agent-install-v1";
import {
  AGENT_INSTRUCTIONS_CAPABILITY,
  AGENT_INSTRUCTIONS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-instructions-v1";
import { AGENT_MEMORIES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-memories-v1";
import { AGENT_MEMORY_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-memory-limit-v1";
import { AGENT_NEW_CHAT_CAPABILITY, AGENT_NEW_CHAT_ROUTES } from "@openbot/contracts/team-protocol/agent-new-chat-v1";
import { AGENT_NOTIFICATION_LEVELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import {
  AGENT_PLAN_CARD_CAPABILITY,
  AGENT_PLAN_CARD_ROUTES,
} from "@openbot/contracts/team-protocol/agent-plan-card-v1";
import { AGENT_PUBLISH_CAPABILITY } from "@openbot/contracts/team-protocol/agent-publish-v1";
import { AGENT_SESSION_SETTINGS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-session-settings-v1";
import { AGENT_SPEED_CAPABILITY, AGENT_SPEED_ROUTES } from "@openbot/contracts/team-protocol/agent-speed-v1";
import {
  AGENT_TASK_LIMIT_CAPABILITY,
  AGENT_TASK_LIMIT_ROUTES,
} from "@openbot/contracts/team-protocol/agent-task-limit-v1";
import { AGENT_TASKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import {
  AGENT_THREAD_BRANCHES_CAPABILITY,
  withAgentThreadBranches,
} from "@openbot/contracts/team-protocol/agent-thread-branches-v1";
import { AGENT_THREAD_FILES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-files-v1";
import { AGENT_THREAD_READS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import { AGENT_THREADS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-threads-v1";
import { AGENT_UPDATE_CAPABILITY } from "@openbot/contracts/team-protocol/agent-update-v1";
import {
  BACKGROUND_PROCESSES_CAPABILITY,
  BACKGROUND_PROCESSES_ROUTES,
  decodeBackgroundProcessesResponse,
} from "@openbot/contracts/team-protocol/background-processes-v1";
import { BITWARDEN_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/bitwarden-connector-v1";
import { BROWSER_PROFILES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { BROWSER_PROXIES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-proxies-v1";
import { BROWSING_MEMORY_CAPABILITY } from "@openbot/contracts/team-protocol/browsing-memory-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CONNECTORS_CAPABILITY } from "@openbot/contracts/team-protocol/connectors-v1";
import {
  CONTEXT_COMPACT_CAPABILITY,
  CONTEXT_COMPACT_ROUTES,
} from "@openbot/contracts/team-protocol/context-compact-v1";
import { CONTEXT_RESET_CAPABILITY } from "@openbot/contracts/team-protocol/context-reset-v1";
import {
  CONVERSATION_FILE_SEARCH_CAPABILITY,
  CONVERSATION_FILE_SEARCH_ROUTES,
  type ConversationFileSearchRequest,
  decodeConversationFileSearchResponse,
} from "@openbot/contracts/team-protocol/conversation-file-search-v1";
import { CONVERSATION_UNREAD_FROM_CAPABILITY } from "@openbot/contracts/team-protocol/conversation-unread-from-v1";
import {
  TEAM_AGENT_CREATE_MODEL_CAPABILITY,
  TEAM_ANY_FILE_ATTACHMENTS_CAPABILITY,
  TEAM_EML_ATTACHMENTS_CAPABILITY,
  TEAM_MEDIA_ATTACHMENTS_CAPABILITY,
  TEAM_MESSAGE_CLIENT_ID_CAPABILITY,
  TEAM_MP4_ATTACHMENTS_CAPABILITY,
  TEAM_SEMANTIC_TAGS_CAPABILITY,
  TEAM_SVG_ATTACHMENTS_CAPABILITY,
  TEAM_ZIP_ATTACHMENTS_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import { EVENTS_CAPABILITY } from "@openbot/contracts/team-protocol/events-v1";
import { HOST_MEMBER_UPDATE_CAPABILITY } from "@openbot/contracts/team-protocol/host-member-update-v1";
import { HOST_PERSONALITY_CAPABILITY } from "@openbot/contracts/team-protocol/host-personality-v1";
import { HOST_RELEASE_CAPABILITY } from "@openbot/contracts/team-protocol/host-release-v1";
import { HOST_RESTART_CAPABILITY } from "@openbot/contracts/team-protocol/host-restart-v1";
import { HOST_TIMEZONE_CAPABILITY } from "@openbot/contracts/team-protocol/host-timezone-v1";
import { HOST_UPDATE_CAPABILITY } from "@openbot/contracts/team-protocol/host-update-v1";
import { HOSTED_SITES_CAPABILITY } from "@openbot/contracts/team-protocol/hosted-sites-v1";
import { INSTANCE_TRANSFER_CAPABILITY } from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { LIVE_VOICE_CAPABILITY } from "@openbot/contracts/team-protocol/live-voice-v1";
import {
  MACHINE_RESOURCES_CAPABILITY,
  MACHINE_RESOURCES_ROUTES,
} from "@openbot/contracts/team-protocol/machine-resources-v1";
import { MCP_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/mcp-access-v1";
import { MCP_SIGN_IN_CAPABILITY } from "@openbot/contracts/team-protocol/mcp-sign-in-v1";
import { MEMORY_REVIEW_CAPABILITY } from "@openbot/contracts/team-protocol/memory-review-v1";
import { MESSAGE_DELETE_CAPABILITY, MESSAGE_DELETE_ROUTES } from "@openbot/contracts/team-protocol/message-delete-v1";
import { MESSAGE_PINS_CAPABILITY } from "@openbot/contracts/team-protocol/message-pins-v1";
import { ONEPASSWORD_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/onepassword-connector-v1";
import { PASSWORD_MANAGERS_CAPABILITY } from "@openbot/contracts/team-protocol/password-managers-v1";
import { PROVIDER_ACCOUNT_MODELS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-models-v1";
import { PROVIDER_ACCOUNT_POOL_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-pool-v1";
import { PROVIDER_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { PROVIDERS_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/providers-v1";
import { TEAM_QUEUE_EDIT_CAPABILITY } from "@openbot/contracts/team-protocol/queue-edit-v1";
import { ROUTINE_RECOVERY_CAPABILITY } from "@openbot/contracts/team-protocol/routine-recovery-v1";
import { ROUTINE_RESULTS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-results-v1";
import { SERVER_AUDIT_CAPABILITY } from "@openbot/contracts/team-protocol/server-audit-v1";
import { SHARED_TABLES_CAPABILITY } from "@openbot/contracts/team-protocol/shared-tables-v1";
import { SIGN_IN_RELAY_CAPABILITY } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { SKILL_LEARNING_CAPABILITY } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { SKILLS_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import type { TeamProtocolV1Capability } from "@openbot/contracts/team-protocol/v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { VAULT_IMPORT_CAPABILITY } from "@openbot/contracts/team-protocol/vault-import-v1";
import { VAULT_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v2";
import { VAULT_V3_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v3";
import { WHATSAPP_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/whatsapp-connector-v1";
import { WHATSAPP_WORKING_MESSAGE_CAPABILITY } from "@openbot/contracts/team-protocol/whatsapp-working-message-v1";
import { WORKFLOWS_CHATS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-chats-v1";
import { WORKFLOWS_GITHUB_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-github-v1";
import { WORKFLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-v1";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { sourceText } from "@openbot/i18n/source";
import { readHostAnalytics } from "@openbot/team-client";
import { readPlanLimits } from "@openbot/team-client/plan-limits";
import type { RemoteFileUpload, RemoteLargeDownload } from "@openbot/team-client/remote-peer";
import { buildRoutineCalendar, type RoutineCalendarSource } from "@openbot/team-client/routine-calendar";
import {
  addAgentFolder,
  bitwardenConnectorRequest,
  browseAgentFolders,
  cancelHostUpdate,
  cancelSignInRelay,
  checkHostForUpdate,
  checkHostRelease,
  clearHostBrowserData,
  completeSignInRelay,
  connectPasswordManager,
  createHostBrowserProfile,
  deleteEventRoutine,
  deleteHostBrowserProfile,
  deleteHostBrowserProxy,
  deleteHostedSite,
  deleteHostVaultItem,
  deleteSharedTable,
  excludeAgentFolder,
  getHostAgentAccess,
  getHostAgentBrowserProfile,
  getHostAgentMemoryLimit,
  getHostAuditLog,
  getHostBrowsingMemory,
  getHostMcpAccess,
  getHostMemoryReview,
  getHostPersonality,
  getHostReleaseStatus,
  getHostSkillLearning,
  getHostTimezone,
  getHostUpdateStatus,
  getRoutineResultDestination,
  githubConnectorRepositories,
  githubConnectorRequest,
  importHostVaultCsv,
  includeAgentFolder,
  installAgentSkill,
  installAgentTemplate,
  installMarketplaceAgent,
  listAgentNotificationLevels,
  listAgentSkills,
  listEventActivity,
  listEventRoutines,
  listHiddenAgents,
  listHostBrowserProfiles,
  listHostBrowserProxies,
  listHostedSites,
  listHostVault,
  listHostVaultCodes,
  listMcpServers,
  listMcpSignIns,
  listPasswordManagers,
  listProviderAccountsWithModels,
  listRoutineResultOptions,
  listSharedTables,
  messagingConnectorAddOrchestrator,
  messagingConnectorComplete,
  messagingConnectorConnect,
  messagingConnectorDisconnect,
  messagingConnectorOverview,
  messagingConnectorReconnect,
  messagingConnectorSetEnabled,
  onePasswordConnectorRequest,
  passwordManagerRequest,
  previewAgentTemplate,
  publishAgentTemplate,
  readAgentFolders,
  readAgentSessionSettings,
  removeAgentFolder,
  removeMcpServer,
  requestHostRestart,
  resetAgentSessionSetting,
  rotateEventRoutineSecret,
  saveEventRoutine,
  saveHostBrowserProxy,
  saveHostVaultItem,
  saveMcpServer,
  setAgentHidden,
  setAgentNotificationLevel,
  setAgentProviderAccount,
  setAgentSessionSetting,
  setAgentSkillEnabled,
  setHostAgentAccess,
  setHostAgentMemoryLimit,
  setHostBrowserProfileProxy,
  setHostBrowsingMemory,
  setHostMcpAccess,
  setHostMemoryReview,
  setHostPersonality,
  setHostSkillLearning,
  setHostTimezone,
  setHostUpdateSettings,
  setMcpServerEnabled,
  setOwnServerNotificationLevel,
  setRoutineResultDestination,
  signInRelayStatus,
  signOutMcpServer,
  startHostUpdate,
  startMcpSignInRelay,
  testEventRoutine,
  testMcpServer,
  uninstallAgentSkill,
  unpublishAgentTemplate,
  updateHostAgentBrowserProfile,
  updateHostBrowserProfile,
  whatsappConnectorAddOrchestrator,
  whatsappConnectorAddSender,
  whatsappConnectorAnswerRequest,
  whatsappConnectorCancelLink,
  whatsappConnectorDisconnect,
  whatsappConnectorGroups,
  whatsappConnectorLinkState,
  whatsappConnectorOverview,
  whatsappConnectorReconnect,
  whatsappConnectorRemoveSender,
  whatsappConnectorSetEnabled,
  whatsappConnectorSetOwnNumber,
  whatsappConnectorSetWorkingMessage,
  whatsappConnectorStartLink,
  whatsappConnectorWorkingMessages,
} from "@openbot/team-client/team-admin-requests";
import {
  type AgentMemoriesRequest,
  agentTaskControl,
  applyAgentImport,
  applyInstanceTransfer,
  branchAgentThread,
  clearAgentContext,
  deleteAgentThread,
  discardAgentImport,
  discardInstanceTransfer,
  downloadInstanceTransfer,
  listAgentTasks,
  listAgentThreadBranches,
  listAgentThreadReads,
  listMessagePins,
  loadInstanceTransferSummary,
  markAgentThreadRead,
  readAgentMemories,
  readAgentMemorySelection,
  readAgentTask,
  renameAgentThread,
  sendAgentTaskMessage,
  setAgentMemoryInclusion,
  setMessagePinned,
  stageAgentImport,
  stageAgentImportInParts,
  stageInstanceTransfer,
  startAgentTask,
  startLiveVoice,
  stopLiveVoice,
  type TeamApiRequest,
  TeamRequestError,
} from "@openbot/team-client/team-api-requests";
import type { QueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import * as Crypto from "expo-crypto";
import { createProviderAdmin } from "@/features/servers/model/provider-admin";
import { saveAgentAvatar, savedAgentAvatar } from "@/features/workspace/model/agent-avatar-cache";
import { decodeConversationSearchPage } from "@/features/workspace/model/conversation";
import { type QueryScope, queryKeys } from "@/features/workspace/model/query-keys";
import { saveAgentRecord } from "@/features/workspace/model/save-agent-record";
import {
  hasCapability,
  requireCapability,
  type ServerCapabilities,
} from "@/features/workspace/model/server-capabilities";
import { runTeamRequest } from "@/features/workspace/model/team-request";
import { decodeAgentSummaries, ignoreResponse } from "@/features/workspace/model/workspace-records";
import type {
  MobileWorkspaceActions,
  MobileWorkspaceCapabilityCheck,
  MobileWorkspaceState,
  ServerUpdateAccess,
} from "@/features/workspace/model/workspace-types";

/** Sends one Team API request to a server; without a server ID it uses the active server. */
export type WorkspaceRequest = <T>(
  method: string,
  path: string,
  decode: (value: unknown) => T,
  body?: TeamProtocolV2Json,
  serverId?: string | null,
  upload?: RemoteFileUpload,
  onUploadProgress?: (fraction: number) => void,
  largeDownload?: RemoteLargeDownload,
) => Promise<T>;

/** The capability checks that only read what a host advertised. */
/** The host shares its screen through Sunshine and Moonlight Web. */
const REMOTE_DESKTOP_CAPABILITY = "remote-desktop" satisfies TeamProtocolV1Capability;

export type HostRequestChecks = Pick<
  MobileWorkspaceState,
  Exclude<MobileWorkspaceCapabilityCheck, "browserViewSupport">
>;

type HostRequestActions = Pick<
  MobileWorkspaceActions,
  | "saveAgentMemory"
  | "deleteAgentMemory"
  | "createAgentRoutine"
  | "updateAgentRoutine"
  | "deleteAgentRoutine"
  | "testAgentRoutine"
  | "loadAgentModels"
  | "loadAgentMemories"
  | "loadAgentMemorySelection"
  | "setAgentMemoryInclusion"
  | "loadAgentRoutines"
  | "loadRoutineCalendar"
  | "listEventRoutines"
  | "saveEventRoutine"
  | "loadRoutineResultOptions"
  | "loadRoutineResultDestination"
  | "setRoutineResultDestination"
  | "deleteEventRoutine"
  | "testEventRoutine"
  | "rotateEventRoutineSecret"
  | "listEventActivity"
  | "loadHostAnalytics"
  | "searchMessages"
  | "searchFiles"
  | "loadAgentTasks"
  | "loadAgentTaskConversation"
  | "startAgentTask"
  | "sendAgentTaskMessage"
  | "controlAgentTask"
  | "renameAgentThread"
  | "deleteAgentThread"
  | "branchAgentThread"
  | "loadAgentThreadReads"
  | "markAgentThreadRead"
  | "loadMessagePins"
  | "setMessagePinned"
  | "respondToTaskPrompt"
  | "loadAgentSkills"
  | "installAgentSkill"
  | "setAgentSkillEnabled"
  | "uninstallAgentSkill"
  | "loadAgentStorage"
  | "loadServerStorage"
  | "loadMachineMetrics"
  | "clearServerStorage"
  | "loadAgentAdminSettings"
  | "updateAgentAdminSettings"
  | "loadAgentHostSettings"
  | "updateAgentHostSettings"
  | "loadAgentBackupModels"
  | "updateAgentBackupModels"
  | "loadAgentTaskLimit"
  | "updateAgentTaskLimit"
  | "loadAgentNewChat"
  | "updateAgentNewChat"
  | "loadAgentPlanCard"
  | "updateAgentPlanCard"
  | "loadAgentDefaults"
  | "updateAgentDefaults"
  | "setAgentDefaultChoice"
  | "loadBackgroundProcesses"
  | "stopBackgroundProcess"
  | "loadAgentSpeed"
  | "updateAgentSpeed"
  | "loadAgentInstructions"
  | "saveAgentInstructions"
  | "loadProviderAccounts"
  | "loadPlanLimits"
  | "setAgentProviderAccount"
  | "startNewChat"
  | "startLiveVoice"
  | "stopLiveVoice"
  | "compactContext"
  | "loadAgentSessionSettings"
  | "loadAgentFolders"
  | "addAgentFolder"
  | "removeAgentFolder"
  | "excludeAgentFolder"
  | "includeAgentFolder"
  | "browseAgentFolders"
  | "restartServerItself"
  | "loadServerTimezone"
  | "setServerTimezone"
  | "loadAgentMemoryLimit"
  | "setAgentMemoryLimit"
  | "loadMemoryReview"
  | "setMemoryReview"
  | "loadSkillLearning"
  | "setSkillLearning"
  | "loadBrowsingMemory"
  | "setBrowsingMemory"
  | "loadServerPersonality"
  | "setServerPersonality"
  | "loadServerRoles"
  | "setServerRoles"
  | "loadServerAuditLog"
  | "loadAgentNotificationLevels"
  | "setAgentNotificationLevel"
  | "setOwnServerNotificationLevel"
  | "githubConnector"
  | "loadGitHubRepositories"
  | "loadOnePasswordConnector"
  | "connectOnePassword"
  | "disconnectOnePassword"
  | "loadBitwardenConnector"
  | "connectBitwarden"
  | "disconnectBitwarden"
  | "loadPasswordManagers"
  | "connectPasswordManager"
  | "cancelPasswordManager"
  | "disconnectPasswordManager"
  | "loadVault"
  | "loadVaultCodes"
  | "saveVaultItem"
  | "deleteVaultItem"
  | "importVaultCsv"
  | "checkAgentExport"
  | "stageAgentImport"
  | "applyAgentImport"
  | "discardAgentImport"
  | "loadInstanceTransferSummary"
  | "downloadInstanceTransfer"
  | "stageInstanceTransfer"
  | "applyInstanceTransfer"
  | "discardInstanceTransfer"
  | "loadBrowserProfiles"
  | "createBrowserProfile"
  | "updateBrowserProfile"
  | "clearBrowserData"
  | "deleteBrowserProfile"
  | "loadAgentBrowserProfile"
  | "updateAgentBrowserProfile"
  | "loadBrowserProxies"
  | "saveBrowserProxy"
  | "deleteBrowserProxy"
  | "setBrowserProfileProxy"
  | "loadMessagingConnections"
  | "connectMessaging"
  | "completeMessagingInstall"
  | "reconnectMessaging"
  | "disconnectMessaging"
  | "setMessagingEnabled"
  | "addMessagingOrchestrator"
  | "loadWhatsAppConnector"
  | "startWhatsAppLink"
  | "loadWhatsAppLinkState"
  | "cancelWhatsAppLink"
  | "disconnectWhatsAppNumber"
  | "reconnectWhatsAppNumber"
  | "setWhatsAppEnabled"
  | "addWhatsAppOrchestrator"
  | "loadWhatsAppGroups"
  | "addWhatsAppSender"
  | "removeWhatsAppSender"
  | "answerWhatsAppRequest"
  | "setWhatsAppOwnNumber"
  | "setWhatsAppWorkingMessage"
  | "loadServerUpdate"
  | "checkServerUpdate"
  | "startServerUpdate"
  | "cancelServerUpdate"
  | "setServerUpdateSettings"
  | "loadServerRelease"
  | "checkServerRelease"
  | "loadHostedSites"
  | "deleteHostedSite"
  | "providerAdmin"
  | "listMcpServers"
  | "saveMcpServer"
  | "removeMcpServer"
  | "setMcpServerEnabled"
  | "testMcpServer"
  | "listMcpSignIns"
  | "signOutMcpServer"
  | "loadMcpAccess"
  | "setMcpAccess"
  | "setAgentSessionSetting"
  | "resetAgentSessionSetting"
  | "listSharedTables"
  | "deleteSharedTable"
  | "loadAgentTemplatePreview"
  | "publishAgentTemplate"
  | "unpublishAgentTemplate"
  | "deleteStoredFile"
  | "installAgentTemplate"
  | "installMarketplaceAgent"
  | "mcpSignInRelay"
  | "loadAgentAvatar"
  | "duplicateAgent"
  | "loadQueue"
  | "editQueue"
  | "changeQueue"
  | "setMessageReaction"
  | "deleteMessage"
  | "downloadAttachment"
  | "downloadMessageFile"
>;

/** A file that the host sends, such as an attachment or a workspace file. */
function decodeHostFile(value: unknown): RemoteFileUpload {
  if (!isDynamicRecord(value) || !isString(value.name) || !isString(value.mimeType) || !isString(value.base64))
    throw new Error("The host returned an invalid file.");
  return { name: value.name, mimeType: value.mimeType, base64: value.base64 };
}

/** A host that serves `agent-hidden-v1` owns the hidden agents of its members. */
function hidesAgentsOnHost(capabilities: readonly string[] | undefined): boolean {
  return capabilities?.includes(AGENT_HIDDEN_CAPABILITY) ?? false;
}

/**
 * An owner or an admin hides on the host. The host refuses a member, so a member hides on this phone
 * only, as on a host without the capability.
 */
export function hostOwnsHide(capabilities: readonly string[] | undefined, role: TeamRole | undefined): boolean {
  return hidesAgentsOnHost(capabilities) && canAdministerServer(role);
}

/** The hidden agents of a host that serves `agent-hidden-v1`, or null for an older host. */
export async function readHostHiddenAgents(
  request: TeamApiRequest,
  capabilities: readonly string[],
): Promise<HiddenAgent[] | null> {
  if (!hidesAgentsOnHost(capabilities)) return null;
  return (await runTeamRequest(listHiddenAgents(request))).agents;
}

/** Hides or restores one agent on the host. The host answers with its whole hidden list. */
export async function writeHostAgentHidden(
  request: TeamApiRequest,
  input: SetAgentHiddenInput,
): Promise<HiddenAgent[]> {
  return (await runTeamRequest(setAgentHidden(request, input))).agents;
}

/** A host that serves `agent-colors-v1` keeps an exact colour beside the hue of each agent. */
export function hostKeepsAgentColors(capabilities: readonly string[] | undefined): boolean {
  return capabilities?.includes(AGENT_COLORS_CAPABILITY) ?? false;
}

/** The agents with a colour on a host that serves `agent-colors-v1`, or null for an older host. */
export async function readHostAgentColors(
  request: TeamApiRequest,
  capabilities: readonly string[],
): Promise<AgentColorsSnapshot["agents"] | null> {
  if (!hostKeepsAgentColors(capabilities)) return null;
  return (await request("POST", AGENT_COLORS_ROUTES.read, decodeAgentColorsSnapshot, {})).agents;
}

/**
 * Sets or removes (`null`) the colour of one agent. The host also sets the nearest hue, and answers
 * with all of its colours.
 */
export async function writeHostAgentColor(
  request: TeamApiRequest,
  agentId: string,
  color: AvatarColor | null,
): Promise<AgentColorsSnapshot["agents"]> {
  return (await request("POST", AGENT_COLORS_ROUTES.set, decodeAgentColorsSnapshot, { agentId, color })).agents;
}

/** The checks of the capabilities that each server advertised. */
export function createHostRequestChecks(capabilities: ServerCapabilities): HostRequestChecks {
  const has = (serverId: string, capability: string) => hasCapability(capabilities, serverId, capability);
  return {
    canSearchFiles: (serverId) => has(serverId, CONVERSATION_FILE_SEARCH_CAPABILITY),
    canUseTasks: (serverId) => has(serverId, AGENT_TASKS_CAPABILITY),
    canEditThreads: (serverId) => has(serverId, AGENT_THREADS_CAPABILITY),
    canReadThreads: (serverId) => has(serverId, AGENT_THREAD_READS_CAPABILITY),
    canAttachThreadFiles: (serverId) => has(serverId, AGENT_THREAD_FILES_CAPABILITY),
    canPinMessages: (serverId) => has(serverId, MESSAGE_PINS_CAPABILITY),
    canBranchThreads: (serverId) => has(serverId, AGENT_THREAD_BRANCHES_CAPABILITY),
    canUseWorkflows: (serverId) => has(serverId, WORKFLOWS_CAPABILITY),
    canUseWorkflowGitHub: (serverId) =>
      has(serverId, WORKFLOWS_CAPABILITY) && has(serverId, WORKFLOWS_GITHUB_CAPABILITY),
    canUseWorkflowChats: (serverId) =>
      has(serverId, WORKFLOWS_CAPABILITY) &&
      has(serverId, WORKFLOWS_CHATS_CAPABILITY) &&
      has(serverId, ROUTINE_RESULTS_CAPABILITY),
    canReadServerStorage: (serverId) => has(serverId, STORAGE_CAPABILITY),
    canControlComputer: (serverId) => has(serverId, REMOTE_DESKTOP_CAPABILITY),
    canSetAgentNotificationLevel: (serverId) => has(serverId, AGENT_NOTIFICATION_LEVELS_CAPABILITY),
    canStartNewChat: (serverId) => has(serverId, CONTEXT_RESET_CAPABILITY),
    canCompactContext: (serverId) => has(serverId, CONTEXT_COMPACT_CAPABILITY),
    canChooseNewAgentModel: (serverId) => has(serverId, TEAM_AGENT_CREATE_MODEL_CAPABILITY),
    canInstallAgentTemplate: (serverId) => has(serverId, AGENT_INSTALL_CAPABILITY),
    canEditQueue: (serverId) => has(serverId, TEAM_QUEUE_EDIT_CAPABILITY),
    canRetryMessage: (serverId) => has(serverId, TEAM_MESSAGE_CLIENT_ID_CAPABILITY),
    canDeleteMessages: (serverId) => has(serverId, MESSAGE_DELETE_CAPABILITY),
    canMarkUnreadFrom: (serverId) => has(serverId, CONVERSATION_UNREAD_FROM_CAPABILITY),
    canUseLiveVoice: (serverId) => has(serverId, LIVE_VOICE_CAPABILITY),
    attachmentSupport: (serverId) => {
      const advertised = capabilities.get(serverId) ?? [];
      return {
        eml: advertised.includes(TEAM_EML_ATTACHMENTS_CAPABILITY),
        media: advertised.includes(TEAM_MEDIA_ATTACHMENTS_CAPABILITY),
        zip: advertised.includes(TEAM_ZIP_ATTACHMENTS_CAPABILITY),
        mp4: advertised.includes(TEAM_MP4_ATTACHMENTS_CAPABILITY),
        svg: advertised.includes(TEAM_SVG_ATTACHMENTS_CAPABILITY),
        anyFile: advertised.includes(TEAM_ANY_FILE_ATTACHMENTS_CAPABILITY),
      };
    },
  };
}

/** Workspace actions that only send host requests and read advertised capabilities. */
export function createHostRequestActions({
  request,
  teamApi,
  queryClient,
  queryScope,
  capabilities,
  attachmentDownloads,
  largeAttachmentDownloads,
}: {
  request: WorkspaceRequest;
  teamApi: (serverId: string, onUploadProgress?: (fraction: number) => void) => TeamApiRequest;
  queryClient: QueryClient;
  /** The API URL, user ID and session scope that start each account query key. */
  queryScope: QueryScope;
  capabilities: ServerCapabilities;
  attachmentDownloads: { current: Promise<void> };
  /** The lane of the files above the attachment limit, one at a time. */
  largeAttachmentDownloads: { current: Promise<void> };
}): { checks: HostRequestChecks; actions: HostRequestActions } {
  const has = (serverId: string, capability: string) => hasCapability(capabilities, serverId, capability);
  /** The Team API of a server that serves `capability`, for an optional admin route set. */
  function capabilityApi(
    serverId: string,
    capability: string,
    unsupported: MobileTextKey,
    onUploadProgress?: (fraction: number) => void,
  ): TeamApiRequest {
    requireCapability(capabilities, serverId, capability, unsupported);
    return teamApi(serverId, onUploadProgress);
  }
  /** The shared admin requests, sent to one server that serves `skills-admin-v1`. */
  const skillsAdmin = (serverId: string) =>
    capabilityApi(serverId, SKILLS_ADMIN_CAPABILITY, "mobile.agent.skill.manageUnsupported");
  /** The shared tables are an optional admin route set. */
  const sharedTablesAdmin = (serverId: string) =>
    capabilityApi(serverId, SHARED_TABLES_CAPABILITY, "mobile.agent.tables.unsupported");
  /** Publishing is an optional admin route set. */
  const publishAdmin = (serverId: string) =>
    capabilityApi(serverId, AGENT_PUBLISH_CAPABILITY, "mobile.agent.publish.unsupported");
  /** The event admin routes are optional and reject members on the host. */
  const eventsAdmin = (serverId: string) =>
    capabilityApi(serverId, EVENTS_CAPABILITY, "mobile.agent.record.eventsUnsupported");
  /** A host with `routine-recovery-v1` answers the event routine list and save with `missedPolicy`. */
  const recovery = (serverId: string) => has(serverId, ROUTINE_RECOVERY_CAPABILITY);
  const routineResultsAdmin = (serverId: string) =>
    capabilityApi(serverId, ROUTINE_RESULTS_CAPABILITY, "mobile.agent.record.resultDestinationUnsupported");
  const sessionSettingsAdmin = (serverId: string) =>
    capabilityApi(serverId, AGENT_SESSION_SETTINGS_CAPABILITY, "mobile.agent.session.unsupported");
  const foldersAdmin = (serverId: string) =>
    capabilityApi(serverId, AGENT_FOLDERS_CAPABILITY, "mobile.agent.folders.unsupported");
  /** The tasks are an optional route set. Any member who can message the agent can use them. */
  const tasksApi = (serverId: string) =>
    capabilityApi(serverId, AGENT_TASKS_CAPABILITY, "mobile.server.threads.unsupported");
  /** Rename and delete of a thread are an optional route set beside the tasks. */
  const threadsApi = (serverId: string) =>
    capabilityApi(serverId, AGENT_THREADS_CAPABILITY, "mobile.chat.threads.unsupported");
  /** Files in a thread are an optional route set beside the tasks. A message without files uses the tasks. */
  const threadMessageApi = (serverId: string, attachmentDraftIds: readonly string[] | undefined) =>
    attachmentDraftIds?.length
      ? capabilityApi(serverId, AGENT_THREAD_FILES_CAPABILITY, "mobile.chat.threads.filesUnsupported")
      : tasksApi(serverId);
  /** The read marks of the threads are an optional route set beside the tasks. */
  const threadReadsApi = (serverId: string) =>
    capabilityApi(serverId, AGENT_THREAD_READS_CAPABILITY, "mobile.chat.threads.unsupported");
  /** The pins of an agent's chats are an optional route set. Any member who can message the agent can use it. */
  const messagePinsApi = (serverId: string) =>
    capabilityApi(serverId, MESSAGE_PINS_CAPABILITY, "mobile.chat.pins.unsupported");
  /** The branches of a chat are an optional route set beside the tasks. */
  const threadBranchesApi = (serverId: string) =>
    capabilityApi(serverId, AGENT_THREAD_BRANCHES_CAPABILITY, "mobile.chat.threads.unsupported");
  /** A self-hosted server restarts itself through an optional admin route. */
  const restartAdmin = (serverId: string) =>
    capabilityApi(serverId, HOST_RESTART_CAPABILITY, "mobile.server.settings.restartUnsupported");
  /** The server timezone and the agent memory limit are optional admin route sets. */
  const timezoneAdmin = (serverId: string) =>
    capabilityApi(serverId, HOST_TIMEZONE_CAPABILITY, "mobile.server.settings.timezoneUnsupported");
  const memoryLimitAdmin = (serverId: string) =>
    capabilityApi(serverId, AGENT_MEMORY_LIMIT_CAPABILITY, "mobile.server.settings.memoryLimitUnsupported");
  /** How the agents learn from their chats and browsing are optional admin route sets. */
  const memoryReviewAdmin = (serverId: string) =>
    capabilityApi(serverId, MEMORY_REVIEW_CAPABILITY, "mobile.server.settings.learningUnsupported");
  const skillLearningAdmin = (serverId: string) =>
    capabilityApi(serverId, SKILL_LEARNING_CAPABILITY, "mobile.server.settings.learningUnsupported");
  const browsingMemoryAdmin = (serverId: string) =>
    capabilityApi(serverId, BROWSING_MEMORY_CAPABILITY, "mobile.server.settings.learningUnsupported");
  /** Any member reads the personality; the host lets only an owner or admin set it. */
  const personalityApi = (serverId: string) =>
    capabilityApi(serverId, HOST_PERSONALITY_CAPABILITY, "mobile.server.settings.personalityUnsupported");
  /** The roles that set the agents of each member are an optional admin route set. */
  const rolesAdmin = (serverId: string) =>
    capabilityApi(serverId, AGENT_ACCESS_CAPABILITY, "mobile.server.roles.unsupported");
  /** Who gets each MCP server is an optional admin route set. */
  const mcpAccessAdmin = (serverId: string) =>
    capabilityApi(serverId, MCP_ACCESS_CAPABILITY, "mobile.server.mcp.accessUnsupported");
  /** The audit log of the access changes is an optional admin route set. */
  const auditAdmin = (serverId: string) =>
    capabilityApi(serverId, SERVER_AUDIT_CAPABILITY, "mobile.server.audit.unsupported");
  /** Each member reads and sets only their own levels, so the host does not check a role. */
  const notificationLevelsApi = (serverId: string) =>
    capabilityApi(serverId, AGENT_NOTIFICATION_LEVELS_CAPABILITY, "mobile.agent.notificationLevel.unsupported");
  /** The connectors are optional admin route sets. */
  const connectorsAdmin = (serverId: string) =>
    capabilityApi(serverId, CONNECTORS_CAPABILITY, "mobile.server.connectors.unsupported");
  const onePasswordAdmin = (serverId: string) =>
    capabilityApi(serverId, ONEPASSWORD_CONNECTOR_CAPABILITY, "mobile.server.connectors.unsupported");
  const bitwardenAdmin = (serverId: string) =>
    capabilityApi(serverId, BITWARDEN_CONNECTOR_CAPABILITY, "mobile.server.connectors.unsupported");
  const whatsappAdmin = (serverId: string) =>
    capabilityApi(serverId, WHATSAPP_CONNECTOR_CAPABILITY, "mobile.server.connectors.unsupported");
  const passwordManagersAdmin = (serverId: string) =>
    capabilityApi(serverId, PASSWORD_MANAGERS_CAPABILITY, "mobile.server.connectors.unsupported");
  const vaultAdmin = (serverId: string) => capabilityApi(serverId, VAULT_CAPABILITY, "mobile.server.vault.unsupported");
  const vaultVersion = (serverId: string) =>
    has(serverId, VAULT_V3_CAPABILITY) ? 3 : has(serverId, VAULT_V2_CAPABILITY) ? 2 : 1;
  const vaultImportAdmin = (serverId: string) =>
    capabilityApi(serverId, VAULT_IMPORT_CAPABILITY, "mobile.server.vault.unsupported");
  /** Any member imports agents. The host keeps each export under a token that only its sender uses. */
  const agentImportApi = (serverId: string, onUploadProgress?: (fraction: number) => void) =>
    capabilityApi(serverId, AGENT_IMPORT_CAPABILITY, "mobile.server.import.unsupported", onUploadProgress);
  /** The transfer of the whole server is an optional admin route set. */
  const transferAdmin = (serverId: string, onUploadProgress?: (fraction: number) => void) =>
    capabilityApi(serverId, INSTANCE_TRANSFER_CAPABILITY, "mobile.server.transfer.unsupported", onUploadProgress);
  /** The zone of this phone. The host uses its own when the zone is not valid there. */
  const phoneTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  const browserProfilesAdmin = (serverId: string) =>
    capabilityApi(serverId, BROWSER_PROFILES_CAPABILITY, "mobile.server.browserProfiles.unsupported");
  const browserProxiesAdmin = (serverId: string) =>
    capabilityApi(serverId, BROWSER_PROXIES_CAPABILITY, "mobile.server.browserProxies.unsupported");
  /** The OpenBot update of the host: the admin route set, or the member set that only checks and starts. */
  const updateApi = (serverId: string, access: ServerUpdateAccess) =>
    capabilityApi(
      serverId,
      access === "admin" ? HOST_UPDATE_CAPABILITY : HOST_MEMBER_UPDATE_CAPABILITY,
      "mobile.server.update.unavailable",
    );
  const updateAdmin = (serverId: string) => updateApi(serverId, "admin");
  const releaseApi = (serverId: string) =>
    capabilityApi(serverId, HOST_RELEASE_CAPABILITY, "mobile.server.update.unavailable");
  /** The sites are an optional route set. Every member lists them; the host deletes for an owner or admin only. */
  const sitesApi = (serverId: string) =>
    capabilityApi(serverId, HOSTED_SITES_CAPABILITY, "mobile.server.sites.unsupported");
  /** The MCP servers are an optional admin route set. */
  const mcpAdmin = (serverId: string) =>
    capabilityApi(serverId, MCP_SERVERS_CAPABILITY, "mobile.server.mcp.unsupported");
  function memoryRequest(serverId: string): AgentMemoriesRequest<TeamRequestError> {
    return (method, path, decode, body) =>
      Effect.tryPromise({
        try: () => request(method, path, decode, body, serverId),
        catch: (cause) => new TeamRequestError({ cause }),
      });
  }
  const checks = createHostRequestChecks(capabilities);
  const actions: HostRequestActions = {
    // Async, so a host without the capability rejects the promise and does not throw at the call.
    restartServerItself: async (serverId) => runTeamRequest(requestHostRestart(restartAdmin(serverId))),
    loadServerTimezone: async (serverId) => runTeamRequest(getHostTimezone(timezoneAdmin(serverId))),
    setServerTimezone: async (timezone, serverId) => runTeamRequest(setHostTimezone(timezoneAdmin(serverId), timezone)),
    loadAgentMemoryLimit: async (serverId) => runTeamRequest(getHostAgentMemoryLimit(memoryLimitAdmin(serverId))),
    setAgentMemoryLimit: async (limit, serverId) =>
      runTeamRequest(setHostAgentMemoryLimit(memoryLimitAdmin(serverId), limit)),
    loadMemoryReview: async (serverId) => runTeamRequest(getHostMemoryReview(memoryReviewAdmin(serverId))),
    setMemoryReview: async (interval, serverId) =>
      runTeamRequest(setHostMemoryReview(memoryReviewAdmin(serverId), interval)),
    loadSkillLearning: async (serverId) => runTeamRequest(getHostSkillLearning(skillLearningAdmin(serverId))),
    setSkillLearning: async (mode, serverId) =>
      runTeamRequest(setHostSkillLearning(skillLearningAdmin(serverId), mode)),
    loadBrowsingMemory: async (serverId) => runTeamRequest(getHostBrowsingMemory(browsingMemoryAdmin(serverId))),
    setBrowsingMemory: async (enabled, serverId) =>
      runTeamRequest(setHostBrowsingMemory(browsingMemoryAdmin(serverId), enabled)),
    // A host before host-personality-v1 uses the classic prompt, as the desktop and the web client read it.
    loadServerPersonality: async (serverId) =>
      has(serverId, HOST_PERSONALITY_CAPABILITY)
        ? runTeamRequest(getHostPersonality(personalityApi(serverId)))
        : { responseStyle: LEGACY_RESPONSE_STYLE },
    setServerPersonality: async (personality, serverId) =>
      runTeamRequest(setHostPersonality(personalityApi(serverId), personality)),
    loadServerRoles: async (serverId) => runTeamRequest(getHostAgentAccess(rolesAdmin(serverId))),
    setServerRoles: async (change, serverId) => runTeamRequest(setHostAgentAccess(rolesAdmin(serverId), change)),
    loadServerAuditLog: async (serverId) => runTeamRequest(getHostAuditLog(auditAdmin(serverId))),
    loadAgentNotificationLevels: async (serverId) =>
      runTeamRequest(listAgentNotificationLevels(notificationLevelsApi(serverId))),
    setAgentNotificationLevel: async (input, serverId) =>
      runTeamRequest(setAgentNotificationLevel(notificationLevelsApi(serverId), input)),
    setOwnServerNotificationLevel: async (level, serverId) =>
      runTeamRequest(setOwnServerNotificationLevel(notificationLevelsApi(serverId), level)),
    githubConnector: async (route, serverId) =>
      runTeamRequest(githubConnectorRequest(connectorsAdmin(serverId), route)),
    loadGitHubRepositories: async (serverId) => runTeamRequest(githubConnectorRepositories(connectorsAdmin(serverId))),
    loadOnePasswordConnector: async (serverId) =>
      runTeamRequest(onePasswordConnectorRequest(onePasswordAdmin(serverId), "status")),
    connectOnePassword: async (token, serverId) =>
      runTeamRequest(onePasswordConnectorRequest(onePasswordAdmin(serverId), "connect", { token })),
    disconnectOnePassword: async (serverId) =>
      runTeamRequest(onePasswordConnectorRequest(onePasswordAdmin(serverId), "disconnect")),
    loadBitwardenConnector: async (serverId) =>
      runTeamRequest(bitwardenConnectorRequest(bitwardenAdmin(serverId), "status")),
    connectBitwarden: async (input, serverId) =>
      runTeamRequest(bitwardenConnectorRequest(bitwardenAdmin(serverId), "connect", input)),
    disconnectBitwarden: async (serverId) =>
      runTeamRequest(bitwardenConnectorRequest(bitwardenAdmin(serverId), "disconnect")),
    loadPasswordManagers: async (serverId) => runTeamRequest(listPasswordManagers(passwordManagersAdmin(serverId))),
    connectPasswordManager: async (input, serverId) =>
      runTeamRequest(connectPasswordManager(passwordManagersAdmin(serverId), input)),
    cancelPasswordManager: async (manager, serverId) =>
      runTeamRequest(passwordManagerRequest(passwordManagersAdmin(serverId), "cancel", manager)),
    disconnectPasswordManager: async (manager, serverId) =>
      runTeamRequest(passwordManagerRequest(passwordManagersAdmin(serverId), "disconnect", manager)),
    loadVault: async (serverId) => runTeamRequest(listHostVault(vaultAdmin(serverId), vaultVersion(serverId))),
    // A host without `vault-v3` keeps no two-step keys, so it has no codes.
    loadVaultCodes: async (serverId) =>
      has(serverId, VAULT_V3_CAPABILITY) ? runTeamRequest(listHostVaultCodes(vaultAdmin(serverId))) : { codes: [] },
    saveVaultItem: async (input, serverId) =>
      runTeamRequest(saveHostVaultItem(vaultAdmin(serverId), input, vaultVersion(serverId))),
    deleteVaultItem: async (id, serverId) =>
      runTeamRequest(deleteHostVaultItem(vaultAdmin(serverId), id, vaultVersion(serverId))),
    importVaultCsv: async (csv, serverId) => runTeamRequest(importHostVaultCsv(vaultImportAdmin(serverId), csv)),
    checkAgentExport: (size, serverId) => {
      if (!has(serverId, AGENT_IMPORT_V2_CAPABILITY) && size > AGENT_IMPORT_UPLOAD_BYTES)
        throw new Error(sourceText("error.import.remoteZipTooLargeOldHost"));
    },
    stageAgentImport: async (file, serverId, onProgress) => {
      if (has(serverId, AGENT_IMPORT_V2_CAPABILITY)) {
        // The progress of each part's upload, as a fraction of the whole export.
        let part = { offset: 0, length: 0 };
        const request = agentImportApi(serverId, (fraction) =>
          onProgress?.((part.offset + fraction * part.length) / file.size),
        );
        const readPart = (offset: number, length: number) => {
          part = { offset, length };
          return file.readPart(offset, length);
        };
        return runTeamRequest(stageAgentImportInParts(request, { name: file.name, size: file.size, readPart }));
      }
      const upload = { name: file.name, mimeType: "application/zip", base64: await file.readAll() };
      return runTeamRequest(stageAgentImport(agentImportApi(serverId, onProgress), upload));
    },
    applyAgentImport: async (input, serverId) =>
      runTeamRequest(applyAgentImport(agentImportApi(serverId), input, phoneTimezone())),
    discardAgentImport: async (token, serverId) => runTeamRequest(discardAgentImport(agentImportApi(serverId), token)),
    loadInstanceTransferSummary: async (serverId) =>
      runTeamRequest(loadInstanceTransferSummary(transferAdmin(serverId))),
    downloadInstanceTransfer: async (input, serverId) =>
      runTeamRequest(downloadInstanceTransfer(transferAdmin(serverId), input)),
    stageInstanceTransfer: async (upload, serverId, onProgress) =>
      runTeamRequest(stageInstanceTransfer(transferAdmin(serverId, onProgress), upload)),
    applyInstanceTransfer: async (input, serverId) =>
      runTeamRequest(applyInstanceTransfer(transferAdmin(serverId), input, phoneTimezone())),
    discardInstanceTransfer: async (token, serverId) =>
      runTeamRequest(discardInstanceTransfer(transferAdmin(serverId), token)),
    loadBrowserProfiles: async (serverId) => runTeamRequest(listHostBrowserProfiles(browserProfilesAdmin(serverId))),
    createBrowserProfile: async (name, serverId) =>
      runTeamRequest(createHostBrowserProfile(browserProfilesAdmin(serverId), name)),
    updateBrowserProfile: async (input, serverId) =>
      runTeamRequest(updateHostBrowserProfile(browserProfilesAdmin(serverId), input)),
    clearBrowserData: async (input, serverId) =>
      runTeamRequest(clearHostBrowserData(browserProfilesAdmin(serverId), input)),
    deleteBrowserProfile: async (profileId, serverId) =>
      runTeamRequest(deleteHostBrowserProfile(browserProfilesAdmin(serverId), profileId)),
    loadAgentBrowserProfile: async (agentId, serverId) =>
      runTeamRequest(getHostAgentBrowserProfile(browserProfilesAdmin(serverId), agentId)),
    updateAgentBrowserProfile: async (input, serverId) =>
      runTeamRequest(updateHostAgentBrowserProfile(browserProfilesAdmin(serverId), input)),
    loadBrowserProxies: async (serverId) => runTeamRequest(listHostBrowserProxies(browserProxiesAdmin(serverId))),
    saveBrowserProxy: async (input, serverId) =>
      runTeamRequest(saveHostBrowserProxy(browserProxiesAdmin(serverId), input)),
    deleteBrowserProxy: async (input, serverId) =>
      runTeamRequest(deleteHostBrowserProxy(browserProxiesAdmin(serverId), input)),
    setBrowserProfileProxy: async (input, serverId) =>
      runTeamRequest(setHostBrowserProfileProxy(browserProxiesAdmin(serverId), input)),
    loadMessagingConnections: async (platform, serverId) =>
      runTeamRequest(messagingConnectorOverview(connectorsAdmin(serverId), { platform })),
    connectMessaging: async (input, serverId) =>
      runTeamRequest(messagingConnectorConnect(connectorsAdmin(serverId), input)),
    completeMessagingInstall: async (input, serverId) =>
      runTeamRequest(messagingConnectorComplete(connectorsAdmin(serverId), input)),
    reconnectMessaging: async (input, serverId) =>
      runTeamRequest(messagingConnectorReconnect(connectorsAdmin(serverId), input)),
    disconnectMessaging: async (input, serverId) =>
      runTeamRequest(messagingConnectorDisconnect(connectorsAdmin(serverId), input)),
    setMessagingEnabled: async (input, serverId) =>
      runTeamRequest(messagingConnectorSetEnabled(connectorsAdmin(serverId), input)),
    addMessagingOrchestrator: async (input, serverId) =>
      runTeamRequest(messagingConnectorAddOrchestrator(connectorsAdmin(serverId), input)),
    // `whatsapp-connector-v1` is frozen without the "Working on it…" setting: a second request reads
    // it. The numbers of an older host carry no setting, and the page then shows no switch.
    loadWhatsAppConnector: async (serverId) => {
      const overview = whatsappConnectorOverview(whatsappAdmin(serverId));
      if (!has(serverId, WHATSAPP_WORKING_MESSAGE_CAPABILITY)) return runTeamRequest(overview);
      return runTeamRequest(
        Effect.zipWith(
          overview,
          whatsappConnectorWorkingMessages(whatsappAdmin(serverId)),
          withWhatsAppWorkingMessages,
        ),
      );
    },
    startWhatsAppLink: async (input, serverId) =>
      runTeamRequest(whatsappConnectorStartLink(whatsappAdmin(serverId), input)),
    loadWhatsAppLinkState: async (serverId) => runTeamRequest(whatsappConnectorLinkState(whatsappAdmin(serverId))),
    cancelWhatsAppLink: async (serverId) => runTeamRequest(whatsappConnectorCancelLink(whatsappAdmin(serverId))),
    disconnectWhatsAppNumber: async (input, serverId) =>
      runTeamRequest(whatsappConnectorDisconnect(whatsappAdmin(serverId), input)),
    reconnectWhatsAppNumber: async (input, serverId) =>
      runTeamRequest(whatsappConnectorReconnect(whatsappAdmin(serverId), input)),
    setWhatsAppEnabled: async (input, serverId) =>
      runTeamRequest(whatsappConnectorSetEnabled(whatsappAdmin(serverId), input)),
    addWhatsAppOrchestrator: async (serverId) =>
      runTeamRequest(whatsappConnectorAddOrchestrator(whatsappAdmin(serverId))),
    loadWhatsAppGroups: async (input, serverId) =>
      runTeamRequest(whatsappConnectorGroups(whatsappAdmin(serverId), input)),
    addWhatsAppSender: async (input, serverId) =>
      runTeamRequest(whatsappConnectorAddSender(whatsappAdmin(serverId), input)),
    removeWhatsAppSender: async (input, serverId) =>
      runTeamRequest(whatsappConnectorRemoveSender(whatsappAdmin(serverId), input)),
    answerWhatsAppRequest: async (input, serverId) =>
      runTeamRequest(whatsappConnectorAnswerRequest(whatsappAdmin(serverId), input)),
    setWhatsAppOwnNumber: async (input, serverId) =>
      runTeamRequest(whatsappConnectorSetOwnNumber(whatsappAdmin(serverId), input)),
    setWhatsAppWorkingMessage: async (input, serverId) =>
      runTeamRequest(
        whatsappConnectorSetWorkingMessage(
          capabilityApi(serverId, WHATSAPP_WORKING_MESSAGE_CAPABILITY, "mobile.server.connectors.unsupported"),
          input,
        ),
      ),
    loadServerUpdate: async (serverId, access) =>
      runTeamRequest(getHostUpdateStatus(updateApi(serverId, access), access === "member")),
    checkServerUpdate: async (serverId, access) =>
      runTeamRequest(checkHostForUpdate(updateApi(serverId, access), access === "member")),
    startServerUpdate: async (serverId, access, restart) =>
      runTeamRequest(startHostUpdate(updateApi(serverId, access), restart, access === "member")),
    cancelServerUpdate: async (serverId) => runTeamRequest(cancelHostUpdate(updateAdmin(serverId))),
    setServerUpdateSettings: async (settings, serverId) =>
      runTeamRequest(setHostUpdateSettings(updateAdmin(serverId), settings)),
    loadServerRelease: async (serverId) => runTeamRequest(getHostReleaseStatus(releaseApi(serverId))),
    checkServerRelease: async (serverId) => runTeamRequest(checkHostRelease(releaseApi(serverId))),
    loadHostedSites: async (serverId) => runTeamRequest(listHostedSites(sitesApi(serverId))),
    deleteHostedSite: async (siteId, serverId) => runTeamRequest(deleteHostedSite(sitesApi(serverId), siteId)),
    providerAdmin: (serverId) =>
      createProviderAdmin(
        capabilityApi(serverId, PROVIDERS_ADMIN_CAPABILITY, "mobile.server.providers.unsupported"),
        capabilities.get(serverId) ?? [],
      ),
    listMcpServers: async (serverId) => runTeamRequest(listMcpServers(mcpAdmin(serverId))),
    saveMcpServer: async (config, serverId) => runTeamRequest(saveMcpServer(mcpAdmin(serverId), { config })),
    removeMcpServer: async (mcpServerId, serverId) =>
      runTeamRequest(removeMcpServer(mcpAdmin(serverId), { mcpServerId })),
    setMcpServerEnabled: async (mcpServerId, enabled, serverId) =>
      runTeamRequest(setMcpServerEnabled(mcpAdmin(serverId), { mcpServerId, enabled })),
    testMcpServer: async (config, serverId) => runTeamRequest(testMcpServer(mcpAdmin(serverId), { config })),
    // An older host keeps no sign-ins that a client can read.
    listMcpSignIns: async (serverId) =>
      has(serverId, MCP_SIGN_IN_CAPABILITY) ? runTeamRequest(listMcpSignIns(teamApi(serverId))) : [],
    signOutMcpServer: async (mcpServerId, serverId) =>
      runTeamRequest(
        signOutMcpServer(capabilityApi(serverId, MCP_SIGN_IN_CAPABILITY, "mobile.server.mcp.unsupported"), {
          mcpServerId,
        }),
      ),
    loadMcpAccess: async (serverId) => runTeamRequest(getHostMcpAccess(mcpAccessAdmin(serverId))),
    setMcpAccess: async (input, serverId) => runTeamRequest(setHostMcpAccess(mcpAccessAdmin(serverId), input)),
    loadAgentSessionSettings: async (agentId, serverId) =>
      has(serverId, AGENT_SESSION_SETTINGS_CAPABILITY)
        ? runTeamRequest(readAgentSessionSettings(sessionSettingsAdmin(serverId), agentId))
        : null,
    loadAgentFolders: async (agentId, serverId) => runTeamRequest(readAgentFolders(foldersAdmin(serverId), agentId)),
    addAgentFolder: async (input, serverId) => runTeamRequest(addAgentFolder(foldersAdmin(serverId), input)),
    removeAgentFolder: async (input, serverId) => runTeamRequest(removeAgentFolder(foldersAdmin(serverId), input)),
    excludeAgentFolder: async (input, serverId) => runTeamRequest(excludeAgentFolder(foldersAdmin(serverId), input)),
    includeAgentFolder: async (input, serverId) => runTeamRequest(includeAgentFolder(foldersAdmin(serverId), input)),
    browseAgentFolders: async (agentId, path, serverId) =>
      runTeamRequest(browseAgentFolders(foldersAdmin(serverId), { agentId, path })),
    setAgentSessionSetting: async (input, serverId) =>
      runTeamRequest(setAgentSessionSetting(sessionSettingsAdmin(serverId), input)),
    resetAgentSessionSetting: async (input, serverId) =>
      runTeamRequest(resetAgentSessionSetting(sessionSettingsAdmin(serverId), input)),
    listEventRoutines: (owner, serverId) =>
      runTeamRequest(listEventRoutines(eventsAdmin(serverId), { owner }, recovery(serverId))),
    saveEventRoutine: (input, serverId) =>
      runTeamRequest(saveEventRoutine(eventsAdmin(serverId), input, recovery(serverId))),
    loadRoutineResultOptions: (serverId) => runTeamRequest(listRoutineResultOptions(routineResultsAdmin(serverId))),
    loadRoutineResultDestination: (input, serverId) =>
      runTeamRequest(getRoutineResultDestination(routineResultsAdmin(serverId), input)),
    setRoutineResultDestination: (input, serverId) =>
      runTeamRequest(setRoutineResultDestination(routineResultsAdmin(serverId), input)),
    deleteEventRoutine: (input, serverId) => runTeamRequest(deleteEventRoutine(eventsAdmin(serverId), input)),
    testEventRoutine: (input, serverId) => runTeamRequest(testEventRoutine(eventsAdmin(serverId), input)),
    rotateEventRoutineSecret: (input, serverId) =>
      runTeamRequest(rotateEventRoutineSecret(eventsAdmin(serverId), input)),
    listEventActivity: (input, serverId) => runTeamRequest(listEventActivity(eventsAdmin(serverId), input)),
    saveAgentMemory: async (agentId, text, serverId, memoryId) => {
      await saveAgentRecord(queryClient, queryKeys.agentRecord(queryScope, serverId, agentId, "memories"), () =>
        request(
          memoryId ? "PATCH" : "POST",
          memoryId ? TEAM_API_ROUTES.agent.memory(agentId, memoryId) : TEAM_API_ROUTES.agent.memories(agentId),
          (value) => {
            if (!isAgentMemory(value) || value.agentId !== agentId || (memoryId !== undefined && value.id !== memoryId))
              throw new Error("The host returned an invalid saved record.");
            return value;
          },
          { text },
          serverId,
        ),
      );
    },
    deleteAgentMemory: async (agentId, memoryId, serverId) => {
      await request("DELETE", TEAM_API_ROUTES.agent.memory(agentId, memoryId), ignoreResponse, undefined, serverId);
    },
    createAgentRoutine: async (input, serverId) => {
      await saveAgentRecord(queryClient, queryKeys.agentRecord(queryScope, serverId, input.agentId, "routines"), () =>
        request(
          "POST",
          TEAM_API_ROUTES.agent.routines(input.agentId),
          (value) => {
            if (!isRoutine(value) || value.agentId !== input.agentId)
              throw new Error("The host returned an invalid saved record.");
            return value;
          },
          {
            name: input.name,
            instruction: input.instruction,
            active: input.active,
            timezone: input.timezone,
            schedule: input.schedule,
          },
          serverId,
        ),
      );
    },
    updateAgentRoutine: async (input, serverId) => {
      await saveAgentRecord(queryClient, queryKeys.agentRecord(queryScope, serverId, input.agentId, "routines"), () =>
        request(
          "PATCH",
          TEAM_API_ROUTES.agent.routine(input.agentId, input.routineId),
          (value) => {
            if (!isRoutine(value) || value.agentId !== input.agentId || value.id !== input.routineId)
              throw new Error("The host returned an invalid saved record.");
            return value;
          },
          {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
            ...(input.active === undefined ? {} : { active: input.active }),
            ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
          },
          serverId,
        ),
      );
    },
    deleteAgentRoutine: async (agentId, routineId, serverId) => {
      await request("DELETE", TEAM_API_ROUTES.agent.routine(agentId, routineId), ignoreResponse, undefined, serverId);
    },
    testAgentRoutine: async (agentId, routineId, serverId) => {
      await request("POST", TEAM_API_ROUTES.agent.routineTest(agentId, routineId), ignoreResponse, undefined, serverId);
    },
    loadAgentModels: async (serverId) => {
      const models = request(
        "GET",
        TEAM_API_ROUTES.agents.models,
        (value) => {
          if (!Array.isArray(value) || !value.every(isClientAgentModelOption))
            throw new Error("The host returned invalid models.");
          // A model of a provider that this build does not know cannot be chosen here.
          return value.flatMap((option) => {
            const provider = option.provider;
            return isKnownAgentProvider(provider) ? [{ ...option, provider }] : [];
          });
        },
        undefined,
        serverId,
      );
      // The released model list drops the fast tiers, so a host with `agent-speed-v1` (or the older
      // `agent-fast-mode-v1`) gives them on its own route, as for desktop. Only `agent-speed-v1` lists
      // Ultrafast tiers and Claude models. The tiers are optional: when that route fails, the models
      // show with no Speed choice.
      const fastRoute = has(serverId, AGENT_SPEED_CAPABILITY)
        ? AGENT_SPEED_ROUTES.models
        : has(serverId, AGENT_FAST_MODE_CAPABILITY)
          ? AGENT_FAST_MODE_ROUTES.models
          : null;
      if (!fastRoute) return models;
      const [options, fast] = await Promise.all([
        models,
        request("POST", fastRoute, decodeAgentFastModels, {}, serverId).catch(() => []),
      ]);
      return withFastServiceTiers(options, fast);
    },
    loadAgentMemorySelection: (agentId, serverId) =>
      runTeamRequest(
        readAgentMemorySelection(memoryRequest(serverId), agentId, has(serverId, AGENT_MEMORIES_CAPABILITY)),
      ),
    setAgentMemoryInclusion: async (input, serverId) => {
      const key = queryKeys.agentRecord(queryScope, serverId, input.agentId, "memory-selection");
      try {
        const state = await runTeamRequest(setAgentMemoryInclusion(memoryRequest(serverId), input));
        queryClient.setQueryData(key, state);
        return state;
      } catch (cause) {
        // A concurrent update can reject this revision. Refresh it before the next attempt.
        void queryClient.invalidateQueries({ queryKey: key });
        throw cause;
      }
    },
    loadAgentMemories: (agentId, serverId) =>
      runTeamRequest(readAgentMemories(memoryRequest(serverId), agentId, has(serverId, AGENT_MEMORIES_CAPABILITY))),
    loadAgentRoutines: (agentId, serverId) =>
      request(
        "GET",
        TEAM_API_ROUTES.agent.routines(agentId),
        (value) => {
          if (!Array.isArray(value) || !value.every(isRoutine) || value.some((routine) => routine.agentId !== agentId))
            throw new Error("The host returned invalid routines.");
          return value;
        },
        undefined,
        serverId,
      ),
    loadRoutineCalendar: (input, serverId, owners) =>
      runTeamRequest(
        buildRoutineCalendar(
          { from: new Date(input.from), to: new Date(input.to) },
          new Date(),
          routineCalendarSource(
            teamApi(serverId),
            capabilities.get(serverId)?.includes(CHANNEL_CHATS_CAPABILITY) ?? false,
            owners,
          ),
        ),
      ),
    loadHostAnalytics: (input, serverId) =>
      runTeamRequest(readHostAnalytics(teamApi(serverId), capabilities.get(serverId) ?? [], input)),
    searchMessages: (query, serverId, cursor) =>
      request(
        "GET",
        // A query parameter never reaches the JSON adapters, so every released host reads it as sent.
        `${TEAM_API_ROUTES.messages.search}?${new URLSearchParams({ q: query, limit: "50", ...(cursor ? { cursor } : {}) })}`,
        decodeConversationSearchPage,
        undefined,
        serverId,
      ),
    searchFiles: (query, serverId, cursor) => {
      const body: ConversationFileSearchRequest = { query, cursor: cursor || null, limit: 50 };
      return request(
        "POST",
        CONVERSATION_FILE_SEARCH_ROUTES.search,
        decodeConversationFileSearchResponse,
        body,
        serverId,
      );
    },
    // Async, so a host without the capability rejects the promise and does not throw at the call.
    // A host with `agent-thread-branches-v1` also gives the branch links, read after the tasks so that
    // each listed branch has its link, as on desktop.
    loadAgentTasks: async (agentId, serverId) => {
      const snapshot = await runTeamRequest(listAgentTasks(tasksApi(serverId), agentId));
      if (!has(serverId, AGENT_THREAD_BRANCHES_CAPABILITY)) return snapshot;
      const links = await runTeamRequest(listAgentThreadBranches(threadBranchesApi(serverId), agentId));
      return withAgentThreadBranches(snapshot, links);
    },
    loadAgentTaskConversation: async (input, serverId) => runTeamRequest(readAgentTask(tasksApi(serverId), input)),
    startAgentTask: async (input, serverId) =>
      runTeamRequest(startAgentTask(threadMessageApi(serverId, input.attachmentDraftIds), input)),
    sendAgentTaskMessage: async (input, serverId) =>
      runTeamRequest(sendAgentTaskMessage(threadMessageApi(serverId, input.attachmentDraftIds), input)),
    controlAgentTask: async (action, input, serverId) =>
      runTeamRequest(agentTaskControl(tasksApi(serverId), action, input)),
    renameAgentThread: async (input, serverId) => runTeamRequest(renameAgentThread(threadsApi(serverId), input)),
    deleteAgentThread: async (input, serverId) => runTeamRequest(deleteAgentThread(threadsApi(serverId), input)),
    branchAgentThread: async (input, serverId) => runTeamRequest(branchAgentThread(threadBranchesApi(serverId), input)),
    loadAgentThreadReads: async (agentId, serverId) =>
      runTeamRequest(listAgentThreadReads(threadReadsApi(serverId), agentId)),
    markAgentThreadRead: async (input, serverId) =>
      runTeamRequest(markAgentThreadRead(threadReadsApi(serverId), input)),
    loadMessagePins: async (agentId, serverId) => runTeamRequest(listMessagePins(messagePinsApi(serverId), agentId)),
    setMessagePinned: async (input, serverId) => runTeamRequest(setMessagePinned(messagePinsApi(serverId), input)),
    respondToTaskPrompt: async (input, serverId) => {
      await request(
        "POST",
        TEAM_API_ROUTES.respond.prompt,
        ignoreResponse,
        { requestId: input.requestId, answers: input.answers },
        serverId,
      );
    },
    // A host too old to know the route answers 404, so ask its advertised capabilities first.
    loadAgentSkills: async (agentId, serverId, manage = false) => {
      if (manage) return runTeamRequest(listAgentSkills(skillsAdmin(serverId), agentId));
      return has(serverId, TEAM_SEMANTIC_TAGS_CAPABILITY)
        ? request("GET", TEAM_API_ROUTES.agent.skills(agentId), decodeInstalledSkills, undefined, serverId)
        : null;
    },
    installAgentSkill: async (input, serverId) => runTeamRequest(installAgentSkill(skillsAdmin(serverId), input)),
    setAgentSkillEnabled: async (input, serverId) => runTeamRequest(setAgentSkillEnabled(skillsAdmin(serverId), input)),
    uninstallAgentSkill: async (input, serverId) => runTeamRequest(uninstallAgentSkill(skillsAdmin(serverId), input)),
    loadAgentStorage: async (agentId, serverId, force = false) => {
      if (!has(serverId, STORAGE_CAPABILITY)) return null;
      const input = { scope: "agent" as const, agentId, ...(force ? { force: true } : {}) };
      return assertStorageUsageScope(
        await request("POST", STORAGE_ROUTES.usage, decodeStorageUsage, input, serverId),
        input,
      );
    },
    loadServerStorage: async (serverId, force = false) => {
      requireCapability(capabilities, serverId, STORAGE_CAPABILITY, "mobile.workspace.error.filesUnsupported");
      const input = { scope: "host" as const, ...(force ? { force: true } : {}) };
      return assertStorageUsageScope(
        await request("POST", STORAGE_ROUTES.usage, decodeStorageUsage, input, serverId),
        input,
      );
    },
    loadMachineMetrics: async (serverId) => {
      requireCapability(capabilities, serverId, MACHINE_RESOURCES_CAPABILITY, "mobile.server.machine.unsupported");
      return request("POST", MACHINE_RESOURCES_ROUTES.metrics, decodeMachineMetrics, {}, serverId);
    },
    clearServerStorage: async (category, serverId) => {
      requireCapability(capabilities, serverId, STORAGE_CAPABILITY, "mobile.workspace.error.filesUnsupported");
      await request("POST", STORAGE_ROUTES.clear, ignoreResponse, { category }, serverId);
    },
    loadAgentAdminSettings: async (agentId, serverId) =>
      has(serverId, AGENT_ADMIN_CAPABILITY)
        ? request("POST", AGENT_ADMIN_ROUTES.settings, decodeAgentAdminSettings, { agentId }, serverId)
        : null,
    updateAgentAdminSettings: async (input, serverId) => {
      requireCapability(capabilities, serverId, AGENT_ADMIN_CAPABILITY, "mobile.agent.access.unsupported");
      return request("POST", AGENT_ADMIN_ROUTES.update, decodeAgentAdminSettings, { ...input }, serverId);
    },
    loadAgentHostSettings: async (agentId, serverId) =>
      has(serverId, AGENT_HOST_SETTINGS_CAPABILITY)
        ? request("POST", AGENT_HOST_SETTINGS_ROUTES.settings, decodeAgentHostSettings, { agentId }, serverId)
        : null,
    updateAgentHostSettings: async (input, serverId) => {
      requireCapability(capabilities, serverId, AGENT_HOST_SETTINGS_CAPABILITY, "mobile.agent.host.unsupported");
      return request("POST", AGENT_HOST_SETTINGS_ROUTES.update, decodeAgentHostSettings, { ...input }, serverId);
    },
    loadAgentBackupModels: async (agentId, serverId) =>
      has(serverId, AGENT_BACKUP_MODELS_CAPABILITY)
        ? request("POST", AGENT_BACKUP_MODELS_ROUTES.settings, decodeAgentBackupModelSettings, { agentId }, serverId)
        : null,
    updateAgentBackupModels: async (input, serverId) => {
      requireCapability(capabilities, serverId, AGENT_BACKUP_MODELS_CAPABILITY, "mobile.agent.host.unsupported");
      // The wire body copies each field, as the request takes JSON values and not the IPC interfaces.
      const backupModels = input.backupModels && {
        automatic: input.backupModels.automatic,
        order: input.backupModels.order.map(({ provider, model, providerAccountId }) => ({
          provider,
          model,
          ...(providerAccountId === undefined ? {} : { providerAccountId }),
        })),
      };
      return request(
        "POST",
        AGENT_BACKUP_MODELS_ROUTES.update,
        decodeAgentBackupModelSettings,
        { agentId: input.agentId, backupModels },
        serverId,
      );
    },
    loadAgentTaskLimit: async (agentId, serverId) =>
      has(serverId, AGENT_TASK_LIMIT_CAPABILITY)
        ? request("POST", AGENT_TASK_LIMIT_ROUTES.settings, decodeAgentTaskLimitSettings, { agentId }, serverId)
        : null,
    updateAgentTaskLimit: async (input, serverId) => {
      requireCapability(capabilities, serverId, AGENT_TASK_LIMIT_CAPABILITY, "mobile.agent.host.unsupported");
      return request("POST", AGENT_TASK_LIMIT_ROUTES.update, decodeAgentTaskLimitSettings, { ...input }, serverId);
    },
    loadAgentNewChat: async (agentId, serverId) =>
      has(serverId, AGENT_NEW_CHAT_CAPABILITY)
        ? request("POST", AGENT_NEW_CHAT_ROUTES.settings, decodeAgentNewChatSettings, { agentId }, serverId)
        : null,
    updateAgentNewChat: async (input, serverId) => {
      requireCapability(capabilities, serverId, AGENT_NEW_CHAT_CAPABILITY, "mobile.agent.host.unsupported");
      return request("POST", AGENT_NEW_CHAT_ROUTES.update, decodeAgentNewChatSettings, { ...input }, serverId);
    },
    loadAgentPlanCard: async (agentId, serverId) =>
      has(serverId, AGENT_PLAN_CARD_CAPABILITY)
        ? request("POST", AGENT_PLAN_CARD_ROUTES.settings, decodeAgentPlanCardSettings, { agentId }, serverId)
        : null,
    updateAgentPlanCard: async (input, serverId) => {
      requireCapability(capabilities, serverId, AGENT_PLAN_CARD_CAPABILITY, "mobile.agent.host.unsupported");
      return request("POST", AGENT_PLAN_CARD_ROUTES.update, decodeAgentPlanCardSettings, { ...input }, serverId);
    },
    loadAgentDefaults: async (serverId) =>
      has(serverId, AGENT_DEFAULTS_CAPABILITY)
        ? request("POST", AGENT_DEFAULTS_ROUTES.settings, decodeAgentDefaultsOverview, {}, serverId)
        : null,
    updateAgentDefaults: async (input, serverId) => {
      requireCapability(capabilities, serverId, AGENT_DEFAULTS_CAPABILITY, "mobile.agent.host.unsupported");
      return request("POST", AGENT_DEFAULTS_ROUTES.update, decodeAgentDefaultsOverview, { ...input }, serverId);
    },
    setAgentDefaultChoice: async (input, serverId) => {
      requireCapability(capabilities, serverId, AGENT_DEFAULTS_CAPABILITY, "mobile.agent.host.unsupported");
      return request(
        "POST",
        AGENT_DEFAULTS_ROUTES.choice,
        decodeAgentDefaultsOverview,
        { agentIds: [...input.agentIds], setting: input.setting, choice: input.choice },
        serverId,
      );
    },
    loadBackgroundProcesses: async (serverId) => {
      requireCapability(capabilities, serverId, BACKGROUND_PROCESSES_CAPABILITY, "mobile.agent.host.unsupported");
      return request("POST", BACKGROUND_PROCESSES_ROUTES.list, decodeBackgroundProcessesResponse, {}, serverId);
    },
    stopBackgroundProcess: async (id, serverId) => {
      requireCapability(capabilities, serverId, BACKGROUND_PROCESSES_CAPABILITY, "mobile.agent.host.unsupported");
      await request("POST", BACKGROUND_PROCESSES_ROUTES.stop, ignoreResponse, { id }, serverId);
    },
    loadAgentSpeed: async (agentId, serverId) => {
      if (has(serverId, AGENT_SPEED_CAPABILITY))
        return request("POST", AGENT_SPEED_ROUTES.settings, decodeAgentSpeedSettings, { agentId }, serverId);
      if (!has(serverId, AGENT_FAST_MODE_CAPABILITY)) return null;
      const settings = await request(
        "POST",
        AGENT_FAST_MODE_ROUTES.settings,
        decodeAgentFastModeSettings,
        { agentId },
        serverId,
      );
      return { speed: agentSpeed(settings) };
    },
    updateAgentSpeed: async ({ agentId, speed }, serverId) => {
      if (has(serverId, AGENT_SPEED_CAPABILITY))
        return request("POST", AGENT_SPEED_ROUTES.update, decodeAgentSpeedSettings, { agentId, speed }, serverId);
      // An older host has only Fast: `agent-fast-mode-v1` cannot carry Ultrafast.
      if (speed === "ultrafast")
        requireCapability(capabilities, serverId, AGENT_SPEED_CAPABILITY, "mobile.agent.host.unsupported");
      requireCapability(capabilities, serverId, AGENT_FAST_MODE_CAPABILITY, "mobile.agent.host.unsupported");
      const settings = await request(
        "POST",
        AGENT_FAST_MODE_ROUTES.update,
        decodeAgentFastModeSettings,
        { agentId, fastMode: speed === "fast" },
        serverId,
      );
      return { speed: agentSpeed(settings) };
    },
    loadAgentInstructions: async (agentId, serverId) => {
      requireCapability(
        capabilities,
        serverId,
        AGENT_INSTRUCTIONS_CAPABILITY,
        "mobile.agent.instructionsFile.unsupported",
      );
      return request(
        "POST",
        AGENT_INSTRUCTIONS_ROUTES.read,
        decodeAgentInstructionsFileFromMain,
        { agentId },
        serverId,
      );
    },
    saveAgentInstructions: async (input, serverId) => {
      requireCapability(
        capabilities,
        serverId,
        AGENT_INSTRUCTIONS_CAPABILITY,
        "mobile.agent.instructionsFile.unsupported",
      );
      return request(
        "POST",
        AGENT_INSTRUCTIONS_ROUTES.save,
        decodeAgentInstructionsFileFromMain,
        { ...input },
        serverId,
      );
    },
    loadProviderAccounts: async (serverId) =>
      has(serverId, PROVIDER_ACCOUNTS_CAPABILITY)
        ? runTeamRequest(
            listProviderAccountsWithModels(
              teamApi(serverId),
              has(serverId, PROVIDER_ACCOUNT_MODELS_CAPABILITY),
              has(serverId, PROVIDER_ACCOUNT_POOL_CAPABILITY),
            ),
          )
        : null,
    loadPlanLimits: (serverId, accounts) => runTeamRequest(readPlanLimits(teamApi(serverId), accounts)),
    setAgentProviderAccount: async (input, serverId) => {
      requireCapability(
        capabilities,
        serverId,
        PROVIDER_ACCOUNTS_CAPABILITY,
        "mobile.agent.runtime.accountUnsupported",
      );
      await runTeamRequest(setAgentProviderAccount(teamApi(serverId), input));
    },
    startNewChat: async (agentId, serverId) => {
      // A host too old to know the route answers 404, so refuse before the request.
      requireCapability(capabilities, serverId, CONTEXT_RESET_CAPABILITY, "mobile.agent.newChat.unsupported");
      await runTeamRequest(clearAgentContext(teamApi(serverId), agentId));
    },
    startLiveVoice: async (input, serverId) =>
      runTeamRequest(
        startLiveVoice(capabilityApi(serverId, LIVE_VOICE_CAPABILITY, "mobile.chat.liveVoice.gptUnsupported"), input),
      ),
    stopLiveVoice: async (sessionId, serverId) =>
      runTeamRequest(
        stopLiveVoice(
          capabilityApi(serverId, LIVE_VOICE_CAPABILITY, "mobile.chat.liveVoice.gptUnsupported"),
          sessionId,
        ),
      ),
    compactContext: async (agentId, serverId) => {
      requireCapability(capabilities, serverId, CONTEXT_COMPACT_CAPABILITY, "mobile.agent.compact.unsupported");
      await request("POST", CONTEXT_COMPACT_ROUTES.compact, ignoreResponse, { agentId }, serverId);
    },
    // Async, so a host without the capability rejects the promise and does not throw at the call.
    listSharedTables: async (serverId) => runTeamRequest(listSharedTables(sharedTablesAdmin(serverId))),
    deleteSharedTable: async (name, serverId) => runTeamRequest(deleteSharedTable(sharedTablesAdmin(serverId), name)),
    loadAgentTemplatePreview: async (agentId, serverId) =>
      runTeamRequest(previewAgentTemplate(publishAdmin(serverId), agentId)),
    // A phone cannot draw the share card, and the host publishes without one.
    publishAgentTemplate: async (agentId, serverId) =>
      runTeamRequest(publishAgentTemplate(publishAdmin(serverId), { agentId, card: null })),
    unpublishAgentTemplate: async (agentId, serverId) =>
      runTeamRequest(unpublishAgentTemplate(publishAdmin(serverId), agentId)),
    deleteStoredFile: async (fileId, serverId) => {
      requireCapability(capabilities, serverId, STORAGE_CAPABILITY, "mobile.workspace.error.filesUnsupported");
      await request("POST", STORAGE_ROUTES.deleteFile, ignoreResponse, { fileId }, serverId);
    },
    installAgentTemplate: async (input, serverId) => {
      // A host too old to know the route answers 404, so refuse before the request.
      requireCapability(capabilities, serverId, AGENT_INSTALL_CAPABILITY, "mobile.link.template.error.unsupported");
      return runTeamRequest(installAgentTemplate(teamApi(serverId), input));
    },
    installMarketplaceAgent: async (input, serverId) => {
      // A host too old to know the route answers 404, so refuse before the request. An update goes
      // to the `agent-update-v1` route, as on the desktop.
      if (input.agentId)
        requireCapability(
          capabilities,
          serverId,
          AGENT_UPDATE_CAPABILITY,
          "mobile.marketplace.error.agentUpdateUnsupported",
        );
      else
        requireCapability(
          capabilities,
          serverId,
          AGENT_INSTALL_CAPABILITY,
          "mobile.marketplace.error.agentUnsupported",
        );
      return runTeamRequest(installMarketplaceAgent(teamApi(serverId), input));
    },
    mcpSignInRelay: (serverId) => {
      const relay = capabilityApi(serverId, SIGN_IN_RELAY_CAPABILITY, "mobile.marketplace.error.signInUnsupported");
      return {
        start: async (config) => (await runTeamRequest(startMcpSignInRelay(relay, { config }))).flowId,
        status: (flowId) => runTeamRequest(signInRelayStatus(relay, flowId)),
        complete: (flowId, query) => runTeamRequest(completeSignInRelay(relay, flowId, query)),
        cancel: (flowId) => runTeamRequest(cancelSignInRelay(relay, flowId)),
      };
    },
    loadAgentAvatar: (agentId, avatarUrl, serverId) => requestAgentAvatar(request, agentId, avatarUrl, serverId),
    duplicateAgent: async (agentId) => {
      await request("POST", TEAM_API_ROUTES.agent.duplicate(agentId), ignoreResponse, {
        operationId: Crypto.randomUUID(),
      });
    },
    loadQueue: (agentId, serverId) =>
      request(
        "GET",
        TEAM_API_ROUTES.agent.queue(agentId),
        (value) => {
          if (!isQueueSnapshot(value) || value.agentId !== agentId)
            throw new Error("The host returned an invalid queue.");
          return value;
        },
        undefined,
        serverId,
      ),
    editQueue: async (agentId, serverId, input) => {
      return request(
        "POST",
        TEAM_API_ROUTES.agent.queueEdit(agentId),
        (value) => {
          if (!isQueueSnapshot(value) || value.agentId !== agentId)
            throw new Error("The host returned an invalid queue edit.");
          return value;
        },
        { ...input },
        serverId,
      );
    },
    changeQueue: async (agentId, serverId, action, input) => {
      const route =
        action === "cancel"
          ? TEAM_API_ROUTES.agent.queueCancel
          : action === "steer"
            ? TEAM_API_ROUTES.agent.queueSteer
            : TEAM_API_ROUTES.agent.queueReorder;
      await request("POST", route(agentId), ignoreResponse, input, serverId);
    },
    setMessageReaction: async (agentId, serverId, messageId, emoji) => {
      await request("POST", TEAM_API_ROUTES.agent.reactions(agentId), ignoreResponse, { messageId, emoji }, serverId);
    },
    deleteMessage: async (serverId, target) => {
      requireCapability(capabilities, serverId, MESSAGE_DELETE_CAPABILITY, "error.team.messageDeleteUnsupported");
      const { messageId } = target;
      if (target.kind === "channel") {
        const body = { channelId: target.channelId, messageId };
        await request("POST", MESSAGE_DELETE_ROUTES.channel, ignoreResponse, body, serverId);
      } else if (target.taskId) {
        const body = { agentId: target.agentId, taskId: target.taskId, messageId };
        await request("POST", MESSAGE_DELETE_ROUTES.task, ignoreResponse, body, serverId);
      } else {
        const body = { agentId: target.agentId, messageId };
        await request("POST", MESSAGE_DELETE_ROUTES.agent, ignoreResponse, body, serverId);
      }
    },
    downloadAttachment: (serverId, attachmentId, largeDownload) => {
      const download = () =>
        request(
          "GET",
          TEAM_API_ROUTES.attachment(attachmentId),
          decodeHostFile,
          undefined,
          serverId,
          undefined,
          undefined,
          largeDownload,
        );
      // Limit native/DOM copies when a message contains several large images. A file above the
      // attachment limit has its own lane: the images of the chat do not wait behind it, and two
      // such files never download at the same time.
      const lane = largeDownload ? largeAttachmentDownloads : attachmentDownloads;
      const result = lane.current.then(download);
      lane.current = result.then(
        () => {},
        () => {},
      );
      return result;
    },
    // The user waits for this one file, so it does not wait behind the images of the chat.
    downloadMessageFile: (serverId, file) =>
      request(
        "GET",
        file.kind === "shared"
          ? `${TEAM_API_ROUTES.sharedFiles}?${new URLSearchParams({ path: file.path })}`
          : // The released URL spells the agent `botId`.
            `${TEAM_API_ROUTES.workspaceFiles}?${new URLSearchParams({ botId: file.agentId, path: file.path })}`,
        decodeHostFile,
        undefined,
        serverId,
      ),
  };
  return { checks, actions };
}

/** The routes that the desktop calendar reads from a remote host, so both place the same runs. */
function routineCalendarSource(
  request: TeamApiRequest,
  channels: boolean,
  knownOwners?: readonly RoutineCalendarOwner[],
): RoutineCalendarSource<TeamRequestError> {
  /** One request to this server as an Effect. */
  const send = <T>(method: string, path: string, decode: (value: unknown) => T, body?: TeamProtocolV2Json) =>
    Effect.tryPromise({
      try: () => request(method, path, decode, body),
      catch: (cause) => new TeamRequestError({ cause }),
    });
  return {
    owners: () =>
      knownOwners
        ? Effect.succeed([...knownOwners])
        : Effect.gen(function* () {
            // A host from before channels rejects the channel routes; its agents still have routines.
            const [agents, channelList] = yield* Effect.all(
              [
                send("GET", TEAM_API_ROUTES.agents.all, decodeAgentSummaries),
                channels ? send("GET", CHANNEL_ROUTES.list, decodeChannelSummaries) : Effect.succeed([]),
              ],
              { concurrency: "unbounded" },
            );
            return [
              ...agents.map((agent): RoutineCalendarOwner => ({ kind: "agent", agentId: agent.id })),
              ...channelList
                .filter((channel) => !channel.archived)
                .map((channel): RoutineCalendarOwner => ({ kind: "channel", channelId: channel.id })),
            ];
          }),
    routines: (owner) =>
      owner.kind === "agent"
        ? send("GET", TEAM_API_ROUTES.agent.routines(owner.agentId), (value) => {
            if (!Array.isArray(value) || !value.every(isRoutine))
              throw new Error("The host returned invalid routines.");
            return value;
          })
        : send("POST", CHANNEL_ROUTES.routines, decodeChannelRoutines, { channelId: owner.channelId }),
    runs: (owner, routineId, limit) =>
      owner.kind === "agent"
        ? send("GET", `${TEAM_API_ROUTES.agent.routineRuns(owner.agentId, routineId)}?limit=${limit}`, (value) => {
            if (!Array.isArray(value) || !value.every(isRoutineRun))
              throw new Error("The host returned an invalid routine history.");
            return value;
          })
        : send("POST", CHANNEL_ROUTES.routineRuns, decodeChannelRoutineRuns, {
            channelId: owner.channelId,
            routineId,
            limit,
          }),
  };
}

/**
 * The agent photo as a `file://` URI, or as a data URL when the phone cannot save it. A photo that
 * this phone has saved needs no request. The Live Activity reads it too, outside the workspace value.
 */
export async function requestAgentAvatar(
  request: WorkspaceRequest,
  agentId: string,
  avatarUrl: string,
  serverId: string,
): Promise<string> {
  const saved = savedAgentAvatar(serverId, agentId, avatarUrl);
  if (saved) return saved;
  const version = new URL(avatarUrl).searchParams.get("v");
  if (!version) throw new Error("The agent avatar has no version.");
  const dataUrl = await request(
    "GET",
    `${TEAM_API_ROUTES.agent.avatar(agentId)}?${new URLSearchParams({ v: version })}`,
    (value) => {
      if (
        !isDynamicRecord(value) ||
        !isString(value.mimeType) ||
        !isAvatarMimeType(value.mimeType) ||
        !isString(value.base64)
      )
        throw new Error("The host returned an invalid avatar.");
      return `data:${value.mimeType};base64,${value.base64}`;
    },
    undefined,
    serverId,
  );
  return saveAgentAvatar(serverId, agentId, avatarUrl, dataUrl);
}
