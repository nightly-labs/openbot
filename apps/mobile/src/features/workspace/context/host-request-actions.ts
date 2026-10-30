import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import {
  assertStorageUsageScope,
  CHANNEL_CHATS_CAPABILITY,
  canAdministerServer,
  decodeAgentAdminSettings,
  decodeAgentHostSettings,
  decodeChannelRoutineRuns,
  decodeChannelRoutines,
  decodeChannelSummaries,
  decodeInstalledSkills,
  decodeStorageUsage,
  type HiddenAgent,
  isAgentMemory,
  isClientAgentModelOption,
  isKnownAgentProvider,
  isQueueSnapshot,
  isRoutine,
  isRoutineRun,
  MCP_SERVERS_CAPABILITY,
  type RoutineCalendarOwner,
  type SetAgentHiddenInput,
  STORAGE_CAPABILITY,
  type TeamRole,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-access-v1";
import { AGENT_ADMIN_CAPABILITY, AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_HIDDEN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import {
  AGENT_HOST_SETTINGS_CAPABILITY,
  AGENT_HOST_SETTINGS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import { AGENT_INSTALL_CAPABILITY } from "@openbot/contracts/team-protocol/agent-install-v1";
import { AGENT_MEMORIES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-memories-v1";
import { AGENT_MEMORY_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-memory-limit-v1";
import { AGENT_PUBLISH_CAPABILITY } from "@openbot/contracts/team-protocol/agent-publish-v1";
import { AGENT_SESSION_SETTINGS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-session-settings-v1";
import { AGENT_TASKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import { AGENT_THREAD_FILES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-files-v1";
import { AGENT_THREAD_READS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import { AGENT_THREADS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-threads-v1";
import { AGENT_UPDATE_CAPABILITY } from "@openbot/contracts/team-protocol/agent-update-v1";
import { BITWARDEN_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/bitwarden-connector-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CONNECTORS_CAPABILITY } from "@openbot/contracts/team-protocol/connectors-v1";
import { CONTEXT_RESET_CAPABILITY } from "@openbot/contracts/team-protocol/context-reset-v1";
import {
  CONVERSATION_FILE_SEARCH_CAPABILITY,
  CONVERSATION_FILE_SEARCH_ROUTES,
  type ConversationFileSearchRequest,
  decodeConversationFileSearchResponse,
} from "@openbot/contracts/team-protocol/conversation-file-search-v1";
import {
  TEAM_AGENT_CREATE_MODEL_CAPABILITY,
  TEAM_EML_ATTACHMENTS_CAPABILITY,
  TEAM_MEDIA_ATTACHMENTS_CAPABILITY,
  TEAM_MESSAGE_CLIENT_ID_CAPABILITY,
  TEAM_MP4_ATTACHMENTS_CAPABILITY,
  TEAM_SEMANTIC_TAGS_CAPABILITY,
  TEAM_ZIP_ATTACHMENTS_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import { EVENTS_CAPABILITY } from "@openbot/contracts/team-protocol/events-v1";
import { HOST_MEMBER_UPDATE_CAPABILITY } from "@openbot/contracts/team-protocol/host-member-update-v1";
import { HOST_RELEASE_CAPABILITY } from "@openbot/contracts/team-protocol/host-release-v1";
import { HOST_TIMEZONE_CAPABILITY } from "@openbot/contracts/team-protocol/host-timezone-v1";
import { HOST_UPDATE_CAPABILITY } from "@openbot/contracts/team-protocol/host-update-v1";
import { HOSTED_SITES_CAPABILITY } from "@openbot/contracts/team-protocol/hosted-sites-v1";
import { MCP_SIGN_IN_CAPABILITY } from "@openbot/contracts/team-protocol/mcp-sign-in-v1";
import { ONEPASSWORD_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/onepassword-connector-v1";
import { PROVIDER_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { PROVIDERS_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/providers-v1";
import { TEAM_QUEUE_EDIT_CAPABILITY } from "@openbot/contracts/team-protocol/queue-edit-v1";
import { ROUTINE_RECOVERY_CAPABILITY } from "@openbot/contracts/team-protocol/routine-recovery-v1";
import { ROUTINE_RESULTS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-results-v1";
import { SHARED_TABLES_CAPABILITY } from "@openbot/contracts/team-protocol/shared-tables-v1";
import { SIGN_IN_RELAY_CAPABILITY } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { SKILLS_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { VAULT_IMPORT_CAPABILITY } from "@openbot/contracts/team-protocol/vault-import-v1";
import { VAULT_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v2";
import { WORKFLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-v1";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { readHostAnalytics } from "@openbot/team-client";
import { readPlanLimits } from "@openbot/team-client/plan-limits";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { buildRoutineCalendar, type RoutineCalendarSource } from "@openbot/team-client/routine-calendar";
import {
  bitwardenConnectorRequest,
  cancelHostUpdate,
  cancelSignInRelay,
  checkHostForUpdate,
  checkHostRelease,
  completeSignInRelay,
  deleteEventRoutine,
  deleteHostedSite,
  deleteHostVaultItem,
  deleteSharedTable,
  getHostAgentAccess,
  getHostAgentMemoryLimit,
  getHostReleaseStatus,
  getHostTimezone,
  getHostUpdateStatus,
  getRoutineResultDestination,
  githubConnectorRepositories,
  githubConnectorRequest,
  importHostVaultCsv,
  installAgentSkill,
  installAgentTemplate,
  installMarketplaceAgent,
  listAgentSkills,
  listEventActivity,
  listEventRoutines,
  listHiddenAgents,
  listHostedSites,
  listHostVault,
  listMcpServers,
  listMcpSignIns,
  listProviderAccounts,
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
  previewAgentTemplate,
  publishAgentTemplate,
  readAgentSessionSettings,
  removeMcpServer,
  resetAgentSessionSetting,
  rotateEventRoutineSecret,
  saveEventRoutine,
  saveHostVaultItem,
  saveMcpServer,
  setAgentHidden,
  setAgentProviderAccount,
  setAgentSessionSetting,
  setAgentSkillEnabled,
  setHostAgentAccess,
  setHostAgentMemoryLimit,
  setHostTimezone,
  setHostUpdateSettings,
  setMcpServerEnabled,
  setRoutineResultDestination,
  signInRelayStatus,
  signOutMcpServer,
  startHostUpdate,
  startMcpSignInRelay,
  testEventRoutine,
  testMcpServer,
  uninstallAgentSkill,
  unpublishAgentTemplate,
} from "@openbot/team-client/team-admin-requests";
import {
  type AgentMemoriesRequest,
  agentTaskControl,
  clearAgentContext,
  deleteAgentThread,
  listAgentTasks,
  listAgentThreadReads,
  markAgentThreadRead,
  readAgentMemories,
  readAgentMemorySelection,
  readAgentTask,
  renameAgentThread,
  sendAgentTaskMessage,
  setAgentMemoryInclusion,
  startAgentTask,
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
) => Promise<T>;

/** The capability checks that only read what a host advertised. */
type HostRequestChecks = Pick<MobileWorkspaceState, Exclude<MobileWorkspaceCapabilityCheck, "browserViewSupport">>;

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
  | "loadAgentThreadReads"
  | "markAgentThreadRead"
  | "respondToTaskPrompt"
  | "loadAgentSkills"
  | "installAgentSkill"
  | "setAgentSkillEnabled"
  | "uninstallAgentSkill"
  | "loadAgentStorage"
  | "loadServerStorage"
  | "clearServerStorage"
  | "loadAgentAdminSettings"
  | "updateAgentAdminSettings"
  | "loadAgentHostSettings"
  | "updateAgentHostSettings"
  | "loadProviderAccounts"
  | "loadPlanLimits"
  | "setAgentProviderAccount"
  | "startNewChat"
  | "loadAgentSessionSettings"
  | "loadServerTimezone"
  | "setServerTimezone"
  | "loadAgentMemoryLimit"
  | "setAgentMemoryLimit"
  | "loadServerRoles"
  | "setServerRoles"
  | "githubConnector"
  | "loadGitHubRepositories"
  | "loadOnePasswordConnector"
  | "connectOnePassword"
  | "disconnectOnePassword"
  | "loadBitwardenConnector"
  | "connectBitwarden"
  | "disconnectBitwarden"
  | "loadVault"
  | "saveVaultItem"
  | "deleteVaultItem"
  | "importVaultCsv"
  | "loadMessagingConnections"
  | "connectMessaging"
  | "completeMessagingInstall"
  | "reconnectMessaging"
  | "disconnectMessaging"
  | "setMessagingEnabled"
  | "addMessagingOrchestrator"
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
  | "downloadAttachment"
>;

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

/** Workspace actions that only send host requests and read advertised capabilities. */
export function createHostRequestActions({
  request,
  teamApi,
  queryClient,
  queryScope,
  capabilities,
  attachmentDownloads,
}: {
  request: WorkspaceRequest;
  teamApi: (serverId: string) => TeamApiRequest;
  queryClient: QueryClient;
  /** The API URL, user ID and session scope that start each account query key. */
  queryScope: QueryScope;
  capabilities: ServerCapabilities;
  attachmentDownloads: { current: Promise<void> };
}): { checks: HostRequestChecks; actions: HostRequestActions } {
  const has = (serverId: string, capability: string) => hasCapability(capabilities, serverId, capability);
  /** The Team API of a server that serves `capability`, for an optional admin route set. */
  function capabilityApi(serverId: string, capability: string, unsupported: MobileTextKey): TeamApiRequest {
    requireCapability(capabilities, serverId, capability, unsupported);
    return teamApi(serverId);
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
  /** The server timezone and the agent memory limit are optional admin route sets. */
  const timezoneAdmin = (serverId: string) =>
    capabilityApi(serverId, HOST_TIMEZONE_CAPABILITY, "mobile.server.settings.timezoneUnsupported");
  const memoryLimitAdmin = (serverId: string) =>
    capabilityApi(serverId, AGENT_MEMORY_LIMIT_CAPABILITY, "mobile.server.settings.memoryLimitUnsupported");
  /** The roles that set the agents of each member are an optional admin route set. */
  const rolesAdmin = (serverId: string) =>
    capabilityApi(serverId, AGENT_ACCESS_CAPABILITY, "mobile.server.roles.unsupported");
  /** The connectors are optional admin route sets. */
  const connectorsAdmin = (serverId: string) =>
    capabilityApi(serverId, CONNECTORS_CAPABILITY, "mobile.server.connectors.unsupported");
  const onePasswordAdmin = (serverId: string) =>
    capabilityApi(serverId, ONEPASSWORD_CONNECTOR_CAPABILITY, "mobile.server.connectors.unsupported");
  const bitwardenAdmin = (serverId: string) =>
    capabilityApi(serverId, BITWARDEN_CONNECTOR_CAPABILITY, "mobile.server.connectors.unsupported");
  const vaultAdmin = (serverId: string) => capabilityApi(serverId, VAULT_CAPABILITY, "mobile.server.vault.unsupported");
  const vaultImportAdmin = (serverId: string) =>
    capabilityApi(serverId, VAULT_IMPORT_CAPABILITY, "mobile.server.vault.unsupported");
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
  const checks: HostRequestChecks = {
    canSearchFiles: (serverId) => has(serverId, CONVERSATION_FILE_SEARCH_CAPABILITY),
    canUseTasks: (serverId) => has(serverId, AGENT_TASKS_CAPABILITY),
    canEditThreads: (serverId) => has(serverId, AGENT_THREADS_CAPABILITY),
    canReadThreads: (serverId) => has(serverId, AGENT_THREAD_READS_CAPABILITY),
    canAttachThreadFiles: (serverId) => has(serverId, AGENT_THREAD_FILES_CAPABILITY),
    canUseWorkflows: (serverId) => has(serverId, WORKFLOWS_CAPABILITY),
    canReadServerStorage: (serverId) => has(serverId, STORAGE_CAPABILITY),
    canStartNewChat: (serverId) => has(serverId, CONTEXT_RESET_CAPABILITY),
    canChooseNewAgentModel: (serverId) => has(serverId, TEAM_AGENT_CREATE_MODEL_CAPABILITY),
    canInstallAgentTemplate: (serverId) => has(serverId, AGENT_INSTALL_CAPABILITY),
    canEditQueue: (serverId) => has(serverId, TEAM_QUEUE_EDIT_CAPABILITY),
    canRetryMessage: (serverId) => has(serverId, TEAM_MESSAGE_CLIENT_ID_CAPABILITY),
    attachmentSupport: (serverId) => {
      const advertised = capabilities.get(serverId) ?? [];
      return {
        eml: advertised.includes(TEAM_EML_ATTACHMENTS_CAPABILITY),
        media: advertised.includes(TEAM_MEDIA_ATTACHMENTS_CAPABILITY),
        zip: advertised.includes(TEAM_ZIP_ATTACHMENTS_CAPABILITY),
        mp4: advertised.includes(TEAM_MP4_ATTACHMENTS_CAPABILITY),
      };
    },
  };
  const actions: HostRequestActions = {
    // Async, so a host without the capability rejects the promise and does not throw at the call.
    loadServerTimezone: async (serverId) => runTeamRequest(getHostTimezone(timezoneAdmin(serverId))),
    setServerTimezone: async (timezone, serverId) => runTeamRequest(setHostTimezone(timezoneAdmin(serverId), timezone)),
    loadAgentMemoryLimit: async (serverId) => runTeamRequest(getHostAgentMemoryLimit(memoryLimitAdmin(serverId))),
    setAgentMemoryLimit: async (limit, serverId) =>
      runTeamRequest(setHostAgentMemoryLimit(memoryLimitAdmin(serverId), limit)),
    loadServerRoles: async (serverId) => runTeamRequest(getHostAgentAccess(rolesAdmin(serverId))),
    setServerRoles: async (change, serverId) => runTeamRequest(setHostAgentAccess(rolesAdmin(serverId), change)),
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
    loadVault: async (serverId) =>
      runTeamRequest(listHostVault(vaultAdmin(serverId), has(serverId, VAULT_V2_CAPABILITY))),
    saveVaultItem: async (input, serverId) =>
      runTeamRequest(saveHostVaultItem(vaultAdmin(serverId), input, has(serverId, VAULT_V2_CAPABILITY))),
    deleteVaultItem: async (id, serverId) =>
      runTeamRequest(deleteHostVaultItem(vaultAdmin(serverId), id, has(serverId, VAULT_V2_CAPABILITY))),
    importVaultCsv: async (csv, serverId) => runTeamRequest(importHostVaultCsv(vaultImportAdmin(serverId), csv)),
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
    loadAgentSessionSettings: async (agentId, serverId) =>
      has(serverId, AGENT_SESSION_SETTINGS_CAPABILITY)
        ? runTeamRequest(readAgentSessionSettings(sessionSettingsAdmin(serverId), agentId))
        : null,
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
    loadAgentModels: (serverId) =>
      request(
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
      ),
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
    loadAgentTasks: async (agentId, serverId) => runTeamRequest(listAgentTasks(tasksApi(serverId), agentId)),
    loadAgentTaskConversation: async (input, serverId) => runTeamRequest(readAgentTask(tasksApi(serverId), input)),
    startAgentTask: async (input, serverId) =>
      runTeamRequest(startAgentTask(threadMessageApi(serverId, input.attachmentDraftIds), input)),
    sendAgentTaskMessage: async (input, serverId) =>
      runTeamRequest(sendAgentTaskMessage(threadMessageApi(serverId, input.attachmentDraftIds), input)),
    controlAgentTask: async (action, input, serverId) =>
      runTeamRequest(agentTaskControl(tasksApi(serverId), action, input)),
    renameAgentThread: async (input, serverId) => runTeamRequest(renameAgentThread(threadsApi(serverId), input)),
    deleteAgentThread: async (input, serverId) => runTeamRequest(deleteAgentThread(threadsApi(serverId), input)),
    loadAgentThreadReads: async (agentId, serverId) =>
      runTeamRequest(listAgentThreadReads(threadReadsApi(serverId), agentId)),
    markAgentThreadRead: async (input, serverId) =>
      runTeamRequest(markAgentThreadRead(threadReadsApi(serverId), input)),
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
    loadProviderAccounts: async (serverId) =>
      has(serverId, PROVIDER_ACCOUNTS_CAPABILITY) ? runTeamRequest(listProviderAccounts(teamApi(serverId))) : null,
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
    downloadAttachment: (serverId, attachmentId) => {
      const download = () =>
        request(
          "GET",
          TEAM_API_ROUTES.attachment(attachmentId),
          (value) => {
            if (
              !isDynamicRecord(value) ||
              !isString(value.name) ||
              !isString(value.mimeType) ||
              !isString(value.base64)
            )
              throw new Error("The host returned an invalid file.");
            return { name: value.name, mimeType: value.mimeType, base64: value.base64 };
          },
          undefined,
          serverId,
        );
      // Limit native/DOM copies when a message contains several large images.
      const result = attachmentDownloads.current.then(download);
      attachmentDownloads.current = result.then(
        () => {},
        () => {},
      );
      return result;
    },
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
