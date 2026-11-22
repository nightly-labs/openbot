import {
  type AgentProviderRef,
  type DownloadableProviderId,
  isAgentProviderRef,
} from "@openbot/contracts/agent-providers";
import { parseHostedSiteList } from "@openbot/contracts/hosted-sites";
import {
  type AccountUsage,
  type AddAgentFolderInput,
  type AddedAgent,
  type AddMessagingOrchestratorResult,
  type AgentAccessChange,
  type AgentAccessSnapshot,
  type AgentAdminSettings,
  type AgentBrowserProfile,
  type AgentColors,
  type AgentExclusionChange,
  type AgentFolderBrowse,
  type AgentFolderChange,
  type AgentFolderInput,
  type AgentFolderList,
  type AgentModelId,
  type AgentNotificationLevelsSnapshot,
  type AgentProviderId,
  type AgentSessionSettings,
  type AgentStatus,
  type AgentTemplatePreview,
  type AgentTemplatePublication,
  type AnswerWhatsAppRequestInput,
  assertStorageUsageScope,
  type BackgroundProcess,
  type BitwardenConnectorStatus,
  type BitwardenHostConnectInput,
  type BrowseAgentFoldersInput,
  type BrowseChannelFoldersInput,
  type BrowserProfileList,
  type BrowserProfileSummary,
  type BrowserProxyList,
  type BrowserProxySummary,
  type CacheExpiryCompactionSetting,
  type CancelMcpSignInInput,
  type ChannelFolderChange,
  type ChannelFolderInput,
  type ChannelFolderList,
  type ChatColors,
  type ClaudeCompactWindowSetting,
  type ClearBrowserDataInput,
  type ClearStorageInput,
  type ConnectProviderAccountInput,
  type ConnectProviderAccountKeyInput,
  type CustomAgentResult,
  type CustomAgentSummary,
  type CustomProviderResult,
  type CustomProviderSummary,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  type DeleteBrowserProxyInput,
  type DeleteCustomProviderInput,
  type DeleteStoredFileInput,
  type DiscordAccess,
  type DiscordRoleList,
  decodeAgentAccessSnapshot,
  decodeAgentAdminSettings,
  decodeAgentBrowserProfile,
  decodeAgentExclusionChangeFromMain,
  decodeAgentFolderBrowse,
  decodeAgentFolderChangeFromMain,
  decodeAgentFolderListFromMain,
  decodeBrowserProfileList,
  decodeBrowserProfileSummary,
  decodeBrowserProxyList,
  decodeBrowserProxySummary,
  decodeChannelFolderChangeFromMain,
  decodeChannelFolderListFromMain,
  decodeChannelStorageUsage,
  decodeCustomAgentResult,
  decodeCustomAgentSummaries,
  decodeCustomProviderResult,
  decodeCustomProviderSummaries,
  decodeGithubSkillSource,
  decodeHostAddedAgent,
  decodeHostAgentMemoryLimit,
  decodeHostAgentTemplatePreview,
  decodeHostAgentTemplatePublication,
  decodeHostBitwardenConnectorStatus,
  decodeHostBrowsingMemory,
  decodeHostGitHubConnectorRepositories,
  decodeHostGitHubConnectorStatus,
  decodeHostMemoryReview,
  decodeHostMessagingOverview,
  decodeHostOnePasswordConnectorStatus,
  decodeHostPasswordManagerList,
  decodeHostPasswordManagerStatus,
  decodeHostPersonality,
  decodeHostProviderAccountModels,
  decodeHostProviderAccountPools,
  decodeHostProviderAccounts,
  decodeHostProviderAccountUsage,
  decodeHostReleaseStatus,
  decodeHostSkillLearning,
  decodeHostTimezoneSettings,
  decodeHostUpdateStatus,
  decodeHostVaultCodes,
  decodeHostVaultImport,
  decodeHostVaultState,
  decodeHostVoiceModel,
  decodeHostWhatsAppLinkState,
  decodeHostWhatsAppOverview,
  decodeInstalledSkills,
  decodeMcpAccessSnapshot,
  decodeMcpServerConfigs,
  decodeMcpSignInAppState,
  decodeMcpSignInStates,
  decodeMcpSignInStatus,
  decodeMcpTestResult,
  decodePromptCacheTtlSetting,
  decodeProviderAccountCodeLoginStart,
  decodeProviderAccountCodeLoginStatus,
  decodeProviderApiKeyStatus,
  decodeProviderCodeLoginStart,
  decodeProviderHostSignInStatus,
  decodeProviderModelVisibility,
  decodeProviderRuntimeSnapshot,
  decodeProviderRuntimeSnapshotV8,
  decodeProviderUsageResetOutcome,
  decodeProviderUsageResets,
  decodeRoutineResultConnectionOptions,
  decodeRoutineResultDestinationAnswer,
  decodeServerAuditLog,
  decodeSignInRelayFlow,
  decodeSignInRelayStatus,
  decodeStorageUsage,
  type GetStorageUsageInput,
  type GitHubConnectorRepositories,
  type GithubSkillSource,
  type HiddenAgentsSnapshot,
  type HostAddMessagingOrchestratorInput,
  type HostAgentMemoryLimit,
  type HostBrowsingMemory,
  type HostDiscordAccessInput,
  type HostedSiteList,
  type HostGitHubConnectorStatus,
  type HostMemoryReview,
  type HostMessagingConnectInput,
  type HostMessagingPlatformInput,
  type HostMessagingWorkspaceInput,
  type HostPersonality,
  type HostProviderAccounts,
  type HostReleaseStatus,
  type HostSetDiscordAccessInput,
  type HostSetMessagingEnabledInput,
  type HostSkillLearning,
  type HostTimezoneSettings,
  type HostUpdateSettingsChange,
  type HostUpdateStatus,
  type HostVoiceModel,
  type HostVoiceModelChange,
  type InstallAgentTemplateInput,
  type InstalledSkill,
  type InstallMarketplaceAgentInput,
  type InstallSkillInput,
  isAddMessagingOrchestratorResult,
  isAgentColors,
  isAgentModel,
  isAgentNotificationLevelsSnapshot,
  isAgentSessionSettings,
  isAgentStatus,
  isChatColors,
  isDiscordAccess,
  isDiscordRoleList,
  isHiddenAgentsSnapshot,
  isSharedTable,
  isSidebarPinsSnapshot,
  isWhatsAppGroupList,
  isWhatsAppStatusReactionsList,
  isWhatsAppWorkingMessageList,
  type McpAccessSnapshot,
  type McpServerConfig,
  type McpSignInAppInput,
  type McpSignInAppState,
  type McpSignInState,
  type McpSignInStatus,
  type McpTestResult,
  type MessagingOverview,
  type MessagingWorkspaceInput,
  type OnePasswordConnectorStatus,
  type OnePasswordHostConnectInput,
  type PasswordManagerConnectInput,
  type PasswordManagerId,
  type PasswordManagerStatus,
  type PromptCacheTtl,
  type PromptCacheTtlSetting,
  type ProviderAccountCodeLoginStart,
  type ProviderAccountCodeLoginStatus,
  type ProviderCodeLoginStart,
  type ProviderEnvironment,
  type ProviderEnvironmentProvider,
  type ProviderEnvironmentUpdate,
  type ProviderHostSignInStatus,
  type ProviderModelVisibility,
  type ProviderModelVisibilityChange,
  type ProviderRuntimeSnapshot,
  type ProviderUsageResetOutcome,
  type ProviderUsageResets,
  type PublishAgentTemplateInput,
  type RemoveMcpServerInput,
  type RemoveProviderAccountInput,
  type RemoveWhatsAppSenderInput,
  type RenameProviderAccountInput,
  type ResetAgentSessionSettingInput,
  type ResetProviderUsageInput,
  type RoutineResultConnectionOption,
  type RoutineResultDestination,
  type RoutineResultRoutineInput,
  type SaveBrowserProxyInput,
  type SaveCustomAgentInput,
  type SaveCustomProviderInput,
  type SaveMcpServerInput,
  type SaveMcpSignInAppInput,
  type ServerAuditLog,
  type SetAgentChatColorInput,
  type SetAgentColorInput,
  type SetAgentHiddenInput,
  type SetAgentNotificationLevelInput,
  type SetAgentProviderAccountInput,
  type SetAgentSessionSettingInput,
  type SetBrowserProfileProxyInput,
  type SetEnabledSkillInput,
  type SetLiveVoiceAccountInput,
  type SetMcpAccessInput,
  type SetMcpServerEnabledInput,
  type SetMessagingEnabledInput,
  type SetOwnServerNotificationLevelInput,
  type SetProviderAccountPoolInput,
  type SetProviderApiKeyInput,
  type SetRoutineResultDestinationInput,
  type SetWhatsAppOwnNumberInput,
  type SetWhatsAppStatusReactionsInput,
  type SetWhatsAppWorkingMessageInput,
  type SharedTable,
  type SidebarPin,
  type SidebarPinsSnapshot,
  type SignInRelayStatus,
  type SignOutMcpServerInput,
  type StartWhatsAppLinkInput,
  type SubmitProviderAccountCodeLoginInput,
  type SubmitProviderCodeLoginInput,
  type TestMcpServerInput,
  type UninstallSkillInput,
  type UpdateAgentAdminSettingsInput,
  type UpdateAgentBrowserProfileInput,
  type UpdateBrowserProfileInput,
  type UpdateCustomProviderInput,
  type UpdateHostIdentityInput,
  type UpdateRestartMode,
  type VaultHostImportResult,
  type VaultSaveInput,
  type VaultState,
  type VaultTwoStepCodes,
  type WhatsAppGroupList,
  type WhatsAppLinkState,
  type WhatsAppOverview,
  type WhatsAppSenderInput,
  type WhatsAppStatusReactionsList,
  type WhatsAppWorkingMessageList,
  withHostProviderAccountModels,
} from "@openbot/contracts/ipc";
import {
  decodeRecord,
  guardedListDecoder,
  nullableString,
  requiredBoolean,
  requiredString,
} from "@openbot/contracts/ipc-decoding";
import {
  type AgentWebhookSecret,
  decodeAgentWebhookSecret,
  decodeEventActivity,
  decodeEventRoutineRuns,
  decodeEventRoutines,
  decodeEventStatus,
  decodeSaveEventRoutineResult,
  decodeWebhookSecret,
  decodeWebhookTestResult,
  type EventActivity,
  type EventRoutine,
  type EventRoutineRef,
  type EventRoutineRun,
  type EventStatus,
  type ListEventActivityInput,
  type ListEventRoutineRunsInput,
  type ListEventRoutinesInput,
  type SaveEventRoutineInput,
  type SaveEventRoutineResult,
  type SetWebhookSecretInput,
  type WebhookSecret,
  type WebhookTestResult,
} from "@openbot/contracts/ipc-events";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/agent-access-v1";
import { AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_COLORS_ROUTES } from "@openbot/contracts/team-protocol/agent-colors-v1";
import { AGENT_FOLDERS_ROUTES } from "@openbot/contracts/team-protocol/agent-folders-v1";
import { AGENT_HIDDEN_ROUTES } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import { AGENT_INSTALL_ROUTES } from "@openbot/contracts/team-protocol/agent-install-v1";
import { AGENT_MEMORY_LIMIT_ROUTES } from "@openbot/contracts/team-protocol/agent-memory-limit-v1";
import { AGENT_NOTIFICATION_LEVELS_ROUTES } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { AGENT_PUBLISH_IMAGE_BYTES, AGENT_PUBLISH_ROUTES } from "@openbot/contracts/team-protocol/agent-publish-v1";
import { AGENT_SESSION_SETTINGS_ROUTES } from "@openbot/contracts/team-protocol/agent-session-settings-v1";
import { AGENT_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/agent-update-v1";
import {
  BACKGROUND_PROCESSES_ROUTES,
  decodeBackgroundProcessesResponse,
} from "@openbot/contracts/team-protocol/background-processes-v1";
import { BITWARDEN_CONNECTOR_ROUTES } from "@openbot/contracts/team-protocol/bitwarden-connector-v1";
import { BROWSER_PROFILES_ROUTES } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { BROWSER_PROXIES_ROUTES } from "@openbot/contracts/team-protocol/browser-proxies-v1";
import { BROWSING_MEMORY_ROUTES } from "@openbot/contracts/team-protocol/browsing-memory-v1";
import {
  CACHE_EXPIRY_COMPACTION_ROUTES,
  decodeCacheExpiryCompactionResponse,
} from "@openbot/contracts/team-protocol/cache-expiry-compaction-v1";
import { CHANNEL_FOLDERS_ROUTES } from "@openbot/contracts/team-protocol/channel-folders-v1";
import { CHAT_COLORS_ROUTES } from "@openbot/contracts/team-protocol/chat-colors-v1";
import {
  CLAUDE_COMPACT_WINDOW_ROUTES,
  decodeClaudeCompactWindowResponse,
} from "@openbot/contracts/team-protocol/claude-compact-window-v1";
import { CONNECTORS_ROUTES } from "@openbot/contracts/team-protocol/connectors-v1";
import { CUSTOM_AGENTS_ROUTES } from "@openbot/contracts/team-protocol/custom-agents-v1";
import { CUSTOM_PROVIDER_EDIT_ROUTES } from "@openbot/contracts/team-protocol/custom-provider-edit-v1";
import { CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES } from "@openbot/contracts/team-protocol/custom-provider-harness-choice-v1";
import type { CUSTOM_PROVIDER_HARNESS_ROUTES } from "@openbot/contracts/team-protocol/custom-provider-harness-v1";
import { DISCORD_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/discord-access-v1";
import { EVENTS_ROUTES } from "@openbot/contracts/team-protocol/events-v1";
import { GITHUB_SKILLS_ROUTES } from "@openbot/contracts/team-protocol/github-skills-v1";
import { HOST_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/host-admin-v1";
import { HOST_APPEARANCE_ROUTES, type ServerAppearance } from "@openbot/contracts/team-protocol/host-appearance-v1";
import { HOST_KEY_ROTATION_ROUTES } from "@openbot/contracts/team-protocol/host-key-rotation-v1";
import { HOST_MEMBER_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-member-update-v1";
import { HOST_PERSONALITY_ROUTES } from "@openbot/contracts/team-protocol/host-personality-v1";
import { HOST_RELEASE_ROUTES } from "@openbot/contracts/team-protocol/host-release-v1";
import { HOST_RESTART_ROUTES } from "@openbot/contracts/team-protocol/host-restart-v1";
import { HOST_TIMEZONE_ROUTES } from "@openbot/contracts/team-protocol/host-timezone-v1";
import { HOST_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-update-v1";
import { HOST_VOICE_MODEL_ROUTES } from "@openbot/contracts/team-protocol/host-voice-model-v1";
import { HOSTED_SITES_ROUTES } from "@openbot/contracts/team-protocol/hosted-sites-v1";
import {
  decodeLiveVoiceAccount,
  LIVE_VOICE_ACCOUNT_ROUTES,
} from "@openbot/contracts/team-protocol/live-voice-account-v1";
import { LOCAL_SERVERS_ROUTES } from "@openbot/contracts/team-protocol/local-servers-v1";
import { MCP_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/mcp-access-v1";
import { MCP_SIGN_IN_APP_ROUTES } from "@openbot/contracts/team-protocol/mcp-sign-in-app-v1";
import { MCP_SIGN_IN_ROUTES } from "@openbot/contracts/team-protocol/mcp-sign-in-v1";
import { MCP_ROUTES } from "@openbot/contracts/team-protocol/mcp-v1";
import { MEMORY_REVIEW_ROUTES } from "@openbot/contracts/team-protocol/memory-review-v1";
import { MODEL_VISIBILITY_ROUTES } from "@openbot/contracts/team-protocol/model-visibility-v1";
import { ONEPASSWORD_CONNECTOR_ROUTES } from "@openbot/contracts/team-protocol/onepassword-connector-v1";
import { PASSWORD_MANAGERS_ROUTES } from "@openbot/contracts/team-protocol/password-managers-v1";
import { PROMPT_CACHE_TTL_ROUTES } from "@openbot/contracts/team-protocol/prompt-cache-ttl-v1";
import { PROVIDER_ACCOUNT_CODE_ROUTES } from "@openbot/contracts/team-protocol/provider-account-code-v1";
import { PROVIDER_ACCOUNT_KEYS_ROUTES } from "@openbot/contracts/team-protocol/provider-account-keys-v1";
import { PROVIDER_ACCOUNT_MODELS_ROUTES } from "@openbot/contracts/team-protocol/provider-account-models-v1";
import { PROVIDER_ACCOUNT_POOL_ROUTES } from "@openbot/contracts/team-protocol/provider-account-pool-v1";
import type {
  ProviderAccountRelay,
  ProviderAccountRelayProvider,
} from "@openbot/contracts/team-protocol/provider-account-relays";
import { PROVIDER_ACCOUNTS_ROUTES } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { PROVIDER_DEFAULT_ROUTES } from "@openbot/contracts/team-protocol/provider-default-v1";
import {
  decodeProviderEnvironmentResponse,
  PROVIDER_ENVIRONMENT_ROUTES,
} from "@openbot/contracts/team-protocol/provider-environment-v1";
import { PROVIDER_HOST_SIGN_IN_ROUTES } from "@openbot/contracts/team-protocol/provider-host-sign-in-v1";
import type {
  ProviderSignInRelay,
  ProviderSignInRelayProvider,
} from "@openbot/contracts/team-protocol/provider-sign-in-relays";
import { PROVIDER_SIGN_OUT_ROUTES } from "@openbot/contracts/team-protocol/provider-sign-out-v1";
import { PROVIDER_USAGE_RESET_ROUTES } from "@openbot/contracts/team-protocol/provider-usage-reset-v1";
import { decodeProviderUseResponse, PROVIDER_USE_ROUTES } from "@openbot/contracts/team-protocol/provider-use-v1";
import { PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import type { PROVIDERS_RUNTIMES_V2_ROUTES } from "@openbot/contracts/team-protocol/providers-v2";
import { PROVIDERS_SIGN_IN_V3_ROUTES } from "@openbot/contracts/team-protocol/providers-v3";
import type { PROVIDERS_V4_ROUTES } from "@openbot/contracts/team-protocol/providers-v4";
import type { PROVIDERS_V5_ROUTES } from "@openbot/contracts/team-protocol/providers-v5";
import { PROVIDERS_V8_ROUTES } from "@openbot/contracts/team-protocol/providers-v8";
import { ROUTINE_RECOVERY_ROUTES } from "@openbot/contracts/team-protocol/routine-recovery-v1";
import { ROUTINE_RESULTS_ROUTES } from "@openbot/contracts/team-protocol/routine-results-v1";
import {
  decodeRoutineRunPlace,
  decodeRoutineRunPlaces,
  ROUTINE_RUN_PLACE_ROUTES,
} from "@openbot/contracts/team-protocol/routine-run-place-v1";
import { SERVER_AUDIT_ROUTES } from "@openbot/contracts/team-protocol/server-audit-v1";
import { SHARED_TABLES_ROUTES } from "@openbot/contracts/team-protocol/shared-tables-v1";
import { SIDEBAR_PINS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import { SIGN_IN_RELAY_ROUTES } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { SKILL_LEARNING_ROUTES } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { SKILLS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { STORAGE_CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/storage-channel-v1";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { VAULT_IMPORT_ROUTES } from "@openbot/contracts/team-protocol/vault-import-v1";
import { VAULT_ROUTES } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_ROUTES } from "@openbot/contracts/team-protocol/vault-v2";
import { VAULT_V3_ROUTES } from "@openbot/contracts/team-protocol/vault-v3";
import { VAULT_V4_ROUTES } from "@openbot/contracts/team-protocol/vault-v4";
import { WEBHOOK_AGENT_SECRET_ROUTES } from "@openbot/contracts/team-protocol/webhook-agent-secret-v1";
import { WEBHOOK_SENDER_SECRET_ROUTES } from "@openbot/contracts/team-protocol/webhook-sender-secret-v1";
import { WEBHOOK_TESTS_ROUTES } from "@openbot/contracts/team-protocol/webhook-tests-v1";
import { WHATSAPP_CONNECTOR_ROUTES } from "@openbot/contracts/team-protocol/whatsapp-connector-v1";
import { WHATSAPP_STATUS_REACTIONS_ROUTES } from "@openbot/contracts/team-protocol/whatsapp-status-reactions-v1";
import { WHATSAPP_WORKING_MESSAGE_ROUTES } from "@openbot/contracts/team-protocol/whatsapp-working-message-v1";
import { Effect, Schema } from "effect";
import { bytesToBase64 } from "./base64";
import {
  isOnceSchedule,
  listOnceEventRoutines,
  type RoutinesOncePost,
  routinesOnceUnsupported,
  saveOnceEventRoutine,
} from "./routines-once";
import {
  listRoutinePauseReasons,
  listRoutineRunChanges,
  setRoutineRunChanges,
  type TeamApiRequest,
  withRoutinePauseReasons,
  withRoutineRunChanges,
  withRoutineRunPlaces,
} from "./team-api-requests";

export class TeamAdminRequestError extends Schema.TaggedError<TeamAdminRequestError>()("TeamAdminRequestError", {
  cause: Schema.Defect(),
}) {}

const adminCall = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new TeamAdminRequestError({ cause }),
  });

function ignoreResponse(): void {}

const decodeSharedTables = guardedListDecoder(isSharedTable, "remote shared tables");

function decodeInstalledSkill(value: unknown): InstalledSkill {
  const [skill] = decodeInstalledSkills([value]);
  if (!skill) throw new Error("Invalid installed skill.");
  return skill;
}

function decodeAgentStatus(value: unknown): AgentStatus {
  if (!isAgentStatus(value)) throw new Error("The host returned an invalid status.");
  return value;
}

function keyValues(rows: McpServerConfig["env"]): TeamProtocolV2Json {
  return rows.map(({ key, value }) => ({ key, value }));
}

function eventBody(value: unknown): TeamProtocolV2Json {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number")
    return value;
  if (Array.isArray(value)) return value.map(eventBody);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, eventBody(item)]));
  throw new Error("Invalid event request.");
}

function mcpConfig(config: McpServerConfig): TeamProtocolV2Json {
  return {
    ...config,
    args: [...config.args],
    env: keyValues(config.env),
    envPassthrough: [...config.envPassthrough],
    headers: keyValues(config.headers),
  };
}

export function getAgentAdminSettings(
  request: TeamApiRequest,
  agentId: string,
): Effect.Effect<AgentAdminSettings, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_ADMIN_ROUTES.settings, decodeAgentAdminSettings, { agentId }));
}

export function updateAgentAdminSettings(
  request: TeamApiRequest,
  input: UpdateAgentAdminSettingsInput,
): Effect.Effect<AgentAdminSettings, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_ADMIN_ROUTES.update, decodeAgentAdminSettings, { ...input }));
}

export function listAgentSkills(
  request: TeamApiRequest,
  agentId: string,
): Effect.Effect<InstalledSkill[], TeamAdminRequestError> {
  return adminCall(() => request("POST", SKILLS_ADMIN_ROUTES.list, decodeInstalledSkills, { agentId }));
}

export function readGithubSkills(
  request: TeamApiRequest,
  link: string,
): Effect.Effect<GithubSkillSource, TeamAdminRequestError> {
  return adminCall(() => request("POST", GITHUB_SKILLS_ROUTES.read, decodeGithubSkillSource, { link }));
}

export function installAgentSkill(
  request: TeamApiRequest,
  input: InstallSkillInput,
): Effect.Effect<InstalledSkill, TeamAdminRequestError> {
  return adminCall(() => request("POST", SKILLS_ADMIN_ROUTES.install, decodeInstalledSkill, { ...input }));
}

export function installMarketplaceAgent(
  request: TeamApiRequest,
  input: InstallMarketplaceAgentInput,
): Effect.Effect<AddedAgent, TeamAdminRequestError> {
  const { listingId, agentId, timezone, receiptId } = input;
  if (agentId !== undefined)
    return adminCall(() =>
      request("POST", AGENT_UPDATE_ROUTES.marketplace, decodeHostAddedAgent, { agentId, listingId, timezone }),
    );
  return adminCall(() =>
    request("POST", AGENT_INSTALL_ROUTES.marketplace, decodeHostAddedAgent, { listingId, timezone, receiptId }),
  );
}

export function installAgentTemplate(
  request: TeamApiRequest,
  input: InstallAgentTemplateInput,
): Effect.Effect<AddedAgent, TeamAdminRequestError> {
  const { templateId, timezone, expectedUpdatedAt } = input;
  return adminCall(() =>
    request("POST", AGENT_INSTALL_ROUTES.template, decodeHostAddedAgent, {
      templateId,
      timezone,
      expectedUpdatedAt,
    }),
  );
}

export function previewAgentTemplate(
  request: TeamApiRequest,
  agentId: string,
): Effect.Effect<AgentTemplatePreview, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_PUBLISH_ROUTES.preview, decodeHostAgentTemplatePreview, { agentId }));
}

export function publishAgentTemplate(
  request: TeamApiRequest,
  { agentId, card }: PublishAgentTemplateInput,
): Effect.Effect<AgentTemplatePublication, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", AGENT_PUBLISH_ROUTES.publish, decodeHostAgentTemplatePublication, {
      agentId,
      card: card && card.byteLength <= AGENT_PUBLISH_IMAGE_BYTES ? bytesToBase64(card) : null,
    }),
  );
}

export function unpublishAgentTemplate(
  request: TeamApiRequest,
  agentId: string,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_PUBLISH_ROUTES.unpublish, ignoreResponse, { agentId }));
}

export function uninstallAgentSkill(
  request: TeamApiRequest,
  input: UninstallSkillInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", SKILLS_ADMIN_ROUTES.uninstall, ignoreResponse, { ...input }));
}

export function setAgentSkillEnabled(
  request: TeamApiRequest,
  input: SetEnabledSkillInput,
): Effect.Effect<InstalledSkill, TeamAdminRequestError> {
  return adminCall(() => request("POST", SKILLS_ADMIN_ROUTES.setEnabled, decodeInstalledSkill, { ...input }));
}

export function listSharedTables(request: TeamApiRequest): Effect.Effect<SharedTable[], TeamAdminRequestError> {
  return adminCall(() => request("POST", SHARED_TABLES_ROUTES.list, decodeSharedTables, {}));
}

export function deleteSharedTable(request: TeamApiRequest, name: string): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", SHARED_TABLES_ROUTES.delete, ignoreResponse, { name }));
}

export function getEventStatus(request: TeamApiRequest): Effect.Effect<EventStatus, TeamAdminRequestError> {
  return adminCall(() => request("POST", EVENTS_ROUTES.status, decodeEventStatus, {}));
}

export function listEventRoutines(
  request: TeamApiRequest,
  input: ListEventRoutinesInput,
  recovery = false,
  runPlaces = false,
  once = false,
  pauseReasons = false,
  runChanges = false,
): Effect.Effect<EventRoutine[], TeamAdminRequestError> {
  const routines = listReleasedEventRoutines(request, input, recovery, runPlaces, pauseReasons);
  const onceRoutines = once
    ? adminCall(() => listOnceEventRoutines(onceSend(request), input.owner))
    : Effect.succeed<EventRoutine[]>([]);
  const { owner } = input;
  const changes =
    runChanges && owner.kind === "agent"
      ? adminCall(() => listRoutineRunChanges(request, owner.id))
      : Effect.succeed([]);
  return Effect.all([routines, onceRoutines, changes], { concurrency: "unbounded" }).pipe(
    Effect.map(([released, extra, entries]) => withRoutineRunChanges([...released, ...extra], entries)),
  );
}

function listReleasedEventRoutines(
  request: TeamApiRequest,
  input: ListEventRoutinesInput,
  recovery: boolean,
  runPlaces: boolean,
  pauseReasons: boolean,
): Effect.Effect<EventRoutine[], TeamAdminRequestError> {
  const path = recovery ? ROUTINE_RECOVERY_ROUTES.listRoutines : EVENTS_ROUTES.listRoutines;
  const routines = adminCall(() => request("POST", path, decodeEventRoutines, eventBody(input)));
  const { owner } = input;
  if (owner.kind !== "agent" || (!runPlaces && !pauseReasons)) return routines;
  const places = runPlaces
    ? adminCall(() => request("POST", ROUTINE_RUN_PLACE_ROUTES.list, decodeRoutineRunPlaces, { agentId: owner.id }))
    : Effect.succeed([]);
  const reasons = pauseReasons ? adminCall(() => listRoutinePauseReasons(request, owner.id)) : Effect.succeed([]);
  return Effect.all([routines, places, reasons], { concurrency: "unbounded" }).pipe(
    Effect.map(([list, entries, paused]) => withRoutinePauseReasons(withRoutineRunPlaces(list, entries), paused)),
  );
}

function onceSend(request: TeamApiRequest): RoutinesOncePost {
  return (path, decode, body) => request("POST", path, decode, body);
}

export function saveEventRoutine(
  request: TeamApiRequest,
  input: SaveEventRoutineInput,
  recovery = false,
  runPlaces = false,
  once = false,
  runChanges = false,
): Effect.Effect<SaveEventRoutineResult, TeamAdminRequestError> {
  const { runsChangeRoutines, ...fields } = input;
  const released = saveReleasedEventRoutine(request, fields, recovery, runPlaces);
  const schedule = fields.trigger.kind === "schedule" ? fields.trigger.schedule : undefined;
  const saved = once
    ? adminCall(() => saveOnceEventRoutine(onceSend(request), fields)).pipe(
        Effect.flatMap((result) => (result === null ? released : Effect.succeed(result))),
      )
    : isOnceSchedule(schedule)
      ? Effect.fail(new TeamAdminRequestError({ cause: routinesOnceUnsupported() }))
      : released;
  const { owner } = fields;
  if (!runChanges || owner.kind !== "agent" || runsChangeRoutines === undefined) return saved;
  return saved.pipe(
    Effect.flatMap((result) =>
      adminCall(() =>
        setRoutineRunChanges(request, owner.id, result.routine, runsChangeRoutines, input.id === undefined),
      ).pipe(Effect.map((routine) => ({ ...result, routine }))),
    ),
  );
}

function saveReleasedEventRoutine(
  request: TeamApiRequest,
  input: SaveEventRoutineInput,
  recovery: boolean,
  runPlaces: boolean,
): Effect.Effect<SaveEventRoutineResult, TeamAdminRequestError> {
  const path = recovery ? ROUTINE_RECOVERY_ROUTES.saveRoutine : EVENTS_ROUTES.saveRoutine;
  const saved = adminCall(() => request("POST", path, decodeSaveEventRoutineResult, eventBody(input)));
  const { owner, runIn } = input;
  if (!runPlaces || owner.kind !== "agent" || runIn === undefined) return saved;
  return Effect.gen(function* () {
    const result = yield* saved;
    const placed = adminCall(() =>
      request("POST", ROUTINE_RUN_PLACE_ROUTES.set, decodeRoutineRunPlace, {
        agentId: owner.id,
        routineId: result.routine.id,
        runIn,
      }),
    );
    const place =
      input.id === undefined
        ? yield* placed.pipe(Effect.orElseSucceed(() => ({ runIn: "chat" as const })))
        : yield* placed;
    return { ...result, routine: { ...result.routine, runIn: place.runIn } };
  });
}

export function listEventRoutineRuns(
  request: TeamApiRequest,
  input: ListEventRoutineRunsInput,
): Effect.Effect<EventRoutineRun[], TeamAdminRequestError> {
  return adminCall(() => request("POST", ROUTINE_RECOVERY_ROUTES.listRuns, decodeEventRoutineRuns, eventBody(input)));
}

export function deleteEventRoutine(
  request: TeamApiRequest,
  input: EventRoutineRef,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", EVENTS_ROUTES.deleteRoutine, ignoreResponse, eventBody(input)));
}

export function testEventRoutine(
  request: TeamApiRequest,
  input: EventRoutineRef,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", EVENTS_ROUTES.testRoutine, ignoreResponse, eventBody(input)));
}

export function rotateEventRoutineSecret(
  request: TeamApiRequest,
  input: EventRoutineRef,
): Effect.Effect<WebhookSecret, TeamAdminRequestError> {
  return adminCall(() => request("POST", EVENTS_ROUTES.rotateSecret, decodeWebhookSecret, eventBody(input)));
}

export function setEventRoutineSecret(
  request: TeamApiRequest,
  input: SetWebhookSecretInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", WEBHOOK_SENDER_SECRET_ROUTES.set, ignoreResponse, eventBody(input)));
}

export function giveEventRoutineSecretToAgent(
  request: TeamApiRequest,
  input: EventRoutineRef,
): Effect.Effect<AgentWebhookSecret, TeamAdminRequestError> {
  return adminCall(() => request("POST", WEBHOOK_AGENT_SECRET_ROUTES.give, decodeAgentWebhookSecret, eventBody(input)));
}

export function sendEventRoutineTestEvent(
  request: TeamApiRequest,
  input: EventRoutineRef,
): Effect.Effect<WebhookTestResult, TeamAdminRequestError> {
  return adminCall(() => request("POST", WEBHOOK_TESTS_ROUTES.send, decodeWebhookTestResult, eventBody(input)));
}

export function listEventActivity(
  request: TeamApiRequest,
  input: ListEventActivityInput,
): Effect.Effect<EventActivity[], TeamAdminRequestError> {
  return adminCall(() => request("POST", EVENTS_ROUTES.listActivity, decodeEventActivity, eventBody(input)));
}

export function updateHostIdentity(
  request: TeamApiRequest,
  input: UpdateHostIdentityInput,
): Effect.Effect<void, TeamAdminRequestError> {
  const body: { [key: string]: TeamProtocolV2Json } = {};
  if (input.serverName !== undefined) body.serverName = input.serverName;
  if (input.logo !== undefined)
    body.logo = input.logo ? { mimeType: input.logo.mimeType, data: bytesToBase64(input.logo.bytes) } : null;
  return adminCall(() => request("POST", HOST_ADMIN_ROUTES.identity, ignoreResponse, body));
}

export function setHostAppearance(
  request: TeamApiRequest,
  appearance: ServerAppearance | null,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", HOST_APPEARANCE_ROUTES.appearance, ignoreResponse, {
      appearance: appearance ? { shape: appearance.shape, color: appearance.color } : null,
    }),
  );
}

export function getHostUpdateStatus(
  request: TeamApiRequest,
  memberAccess = false,
): Effect.Effect<HostUpdateStatus, TeamAdminRequestError> {
  return adminCall(() =>
    request(
      "POST",
      memberAccess ? HOST_MEMBER_UPDATE_ROUTES.status : HOST_UPDATE_ROUTES.status,
      decodeHostUpdateStatus,
      {},
    ),
  );
}

export function checkHostForUpdate(
  request: TeamApiRequest,
  memberAccess = false,
): Effect.Effect<HostUpdateStatus, TeamAdminRequestError> {
  return adminCall(() =>
    request(
      "POST",
      memberAccess ? HOST_MEMBER_UPDATE_ROUTES.check : HOST_UPDATE_ROUTES.check,
      decodeHostUpdateStatus,
      {},
    ),
  );
}

export function startHostUpdate(
  request: TeamApiRequest,
  restart: UpdateRestartMode,
  memberAccess = false,
): Effect.Effect<HostUpdateStatus, TeamAdminRequestError> {
  return adminCall(() =>
    request(
      "POST",
      memberAccess ? HOST_MEMBER_UPDATE_ROUTES.start : HOST_UPDATE_ROUTES.start,
      decodeHostUpdateStatus,
      memberAccess ? {} : { restart },
    ),
  );
}

export function cancelHostUpdate(request: TeamApiRequest): Effect.Effect<HostUpdateStatus, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOST_UPDATE_ROUTES.cancel, decodeHostUpdateStatus, {}));
}

export function setHostUpdateSettings(
  request: TeamApiRequest,
  settings: HostUpdateSettingsChange,
): Effect.Effect<HostUpdateStatus, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOST_UPDATE_ROUTES.settings, decodeHostUpdateStatus, settings));
}

export function getHostTimezone(request: TeamApiRequest): Effect.Effect<HostTimezoneSettings, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOST_TIMEZONE_ROUTES.settings, decodeHostTimezoneSettings, {}));
}

export function setHostTimezone(
  request: TeamApiRequest,
  timezone: string | null,
): Effect.Effect<HostTimezoneSettings, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOST_TIMEZONE_ROUTES.update, decodeHostTimezoneSettings, { timezone }));
}

export function getHostVoiceModel(request: TeamApiRequest): Effect.Effect<HostVoiceModel, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOST_VOICE_MODEL_ROUTES.settings, decodeHostVoiceModel, {}));
}

export function changeHostVoiceModel(
  request: TeamApiRequest,
  { action, modelId }: HostVoiceModelChange,
): Effect.Effect<HostVoiceModel, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOST_VOICE_MODEL_ROUTES.change, decodeHostVoiceModel, { action, modelId }));
}

export function requestHostRestart(request: TeamApiRequest): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOST_RESTART_ROUTES.restart, ignoreResponse, {}));
}

export function getHostPersonality(request: TeamApiRequest): Effect.Effect<HostPersonality, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOST_PERSONALITY_ROUTES.settings, decodeHostPersonality, {}));
}

export function setHostPersonality(
  request: TeamApiRequest,
  personality: HostPersonality,
): Effect.Effect<HostPersonality, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", HOST_PERSONALITY_ROUTES.update, decodeHostPersonality, {
      responseStyle: personality.responseStyle,
    }),
  );
}

export function rotateHostKey(request: TeamApiRequest): Effect.Effect<{ publicKey: string }, TeamAdminRequestError> {
  return adminCall(() =>
    request(
      "POST",
      HOST_KEY_ROTATION_ROUTES.rotate,
      (value) => ({ publicKey: requiredString(decodeRecord(value, "host key"), "publicKey") }),
      {},
    ),
  );
}

export interface HostLocalServer {
  serverId: string;
  name: string;
  published: boolean;
}

export interface HostLocalServerList {
  servers: HostLocalServer[];
  limit: number;
}

function decodeHostLocalServer(value: unknown): HostLocalServer {
  const record = decodeRecord(value, "local server");
  return {
    serverId: requiredString(record, "serverId"),
    name: requiredString(record, "name"),
    published: requiredBoolean(record, "published"),
  };
}

function decodeHostLocalServerList(value: unknown): HostLocalServerList {
  const record = decodeRecord(value, "local servers");
  const { servers, limit } = record;
  if (!Array.isArray(servers)) throw new Error("Invalid local server list.");
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 0)
    throw new Error("Invalid local server limit.");
  return { servers: servers.map(decodeHostLocalServer), limit };
}

export function listHostLocalServers(
  request: TeamApiRequest,
): Effect.Effect<HostLocalServerList, TeamAdminRequestError> {
  return adminCall(() => request("POST", LOCAL_SERVERS_ROUTES.list, decodeHostLocalServerList, {}));
}

export function createHostLocalServer(
  request: TeamApiRequest,
  name: string,
): Effect.Effect<HostLocalServer, TeamAdminRequestError> {
  return adminCall(() => request("POST", LOCAL_SERVERS_ROUTES.create, decodeHostLocalServer, { name }));
}

export function deleteHostLocalServer(
  request: TeamApiRequest,
  serverId: string,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", LOCAL_SERVERS_ROUTES.delete, () => undefined, { serverId }));
}

export function listRoutineResultOptions(
  request: TeamApiRequest,
): Effect.Effect<RoutineResultConnectionOption[], TeamAdminRequestError> {
  return adminCall(() => request("POST", ROUTINE_RESULTS_ROUTES.options, decodeRoutineResultConnectionOptions, {}));
}

export function getRoutineResultDestination(
  request: TeamApiRequest,
  input: RoutineResultRoutineInput,
): Effect.Effect<RoutineResultDestination | null, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", ROUTINE_RESULTS_ROUTES.destination, decodeRoutineResultDestinationAnswer, eventBody(input)),
  );
}

export function setRoutineResultDestination(
  request: TeamApiRequest,
  input: SetRoutineResultDestinationInput,
): Effect.Effect<RoutineResultDestination | null, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", ROUTINE_RESULTS_ROUTES.setDestination, decodeRoutineResultDestinationAnswer, eventBody(input)),
  );
}

export function getHostAgentMemoryLimit(
  request: TeamApiRequest,
): Effect.Effect<HostAgentMemoryLimit, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_MEMORY_LIMIT_ROUTES.settings, decodeHostAgentMemoryLimit, {}));
}

export function setHostAgentMemoryLimit(
  request: TeamApiRequest,
  limit: number,
): Effect.Effect<HostAgentMemoryLimit, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_MEMORY_LIMIT_ROUTES.update, decodeHostAgentMemoryLimit, { limit }));
}

export function getHostMemoryReview(request: TeamApiRequest): Effect.Effect<HostMemoryReview, TeamAdminRequestError> {
  return adminCall(() => request("POST", MEMORY_REVIEW_ROUTES.settings, decodeHostMemoryReview, {}));
}

export function setHostMemoryReview(
  request: TeamApiRequest,
  interval: number,
): Effect.Effect<HostMemoryReview, TeamAdminRequestError> {
  return adminCall(() => request("POST", MEMORY_REVIEW_ROUTES.update, decodeHostMemoryReview, { interval }));
}

export function getHostSkillLearning(request: TeamApiRequest): Effect.Effect<HostSkillLearning, TeamAdminRequestError> {
  return adminCall(() => request("POST", SKILL_LEARNING_ROUTES.settings, decodeHostSkillLearning, {}));
}

export function setHostSkillLearning(
  request: TeamApiRequest,
  mode: string,
): Effect.Effect<HostSkillLearning, TeamAdminRequestError> {
  return adminCall(() => request("POST", SKILL_LEARNING_ROUTES.update, decodeHostSkillLearning, { mode }));
}

export function getHostBrowsingMemory(
  request: TeamApiRequest,
): Effect.Effect<HostBrowsingMemory, TeamAdminRequestError> {
  return adminCall(() => request("POST", BROWSING_MEMORY_ROUTES.settings, decodeHostBrowsingMemory, {}));
}

export function setHostBrowsingMemory(
  request: TeamApiRequest,
  enabled: boolean,
): Effect.Effect<HostBrowsingMemory, TeamAdminRequestError> {
  return adminCall(() => request("POST", BROWSING_MEMORY_ROUTES.update, decodeHostBrowsingMemory, { enabled }));
}

export function getHostAgentAccess(request: TeamApiRequest): Effect.Effect<AgentAccessSnapshot, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_ACCESS_ROUTES.read, decodeAgentAccessSnapshot, {}));
}

export function getHostAuditLog(request: TeamApiRequest): Effect.Effect<ServerAuditLog, TeamAdminRequestError> {
  return adminCall(() => request("POST", SERVER_AUDIT_ROUTES.read, decodeServerAuditLog, {}));
}

export function setHostAgentAccess(
  request: TeamApiRequest,
  change: AgentAccessChange,
): Effect.Effect<AgentAccessSnapshot, TeamAdminRequestError> {
  const body = {
    revision: change.revision,
    everyone: { ...change.everyone },
    roles: change.roles.map((role) => ({
      id: role.id,
      name: role.name,
      agents: { ...role.agents },
      memberIds: [...role.memberIds],
    })),
  };
  return adminCall(() => request("POST", AGENT_ACCESS_ROUTES.set, decodeAgentAccessSnapshot, body));
}

export function getHostPromptCacheTtl(
  request: TeamApiRequest,
): Effect.Effect<PromptCacheTtlSetting, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROMPT_CACHE_TTL_ROUTES.settings, decodePromptCacheTtlSetting, {}));
}

export function setHostPromptCacheTtl(
  request: TeamApiRequest,
  ttl: PromptCacheTtl,
): Effect.Effect<PromptCacheTtlSetting, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROMPT_CACHE_TTL_ROUTES.update, decodePromptCacheTtlSetting, { ttl }));
}

export function getHostCacheExpiryCompaction(
  request: TeamApiRequest,
): Effect.Effect<CacheExpiryCompactionSetting, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", CACHE_EXPIRY_COMPACTION_ROUTES.settings, decodeCacheExpiryCompactionResponse, {}),
  );
}

export function setHostCacheExpiryCompaction(
  request: TeamApiRequest,
  enabled: boolean,
): Effect.Effect<CacheExpiryCompactionSetting, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", CACHE_EXPIRY_COMPACTION_ROUTES.update, decodeCacheExpiryCompactionResponse, { enabled }),
  );
}

export function getHostClaudeCompactWindow(
  request: TeamApiRequest,
): Effect.Effect<ClaudeCompactWindowSetting, TeamAdminRequestError> {
  return adminCall(() => request("POST", CLAUDE_COMPACT_WINDOW_ROUTES.settings, decodeClaudeCompactWindowResponse, {}));
}

export function setHostClaudeCompactWindow(
  request: TeamApiRequest,
  tokens: number | null,
): Effect.Effect<ClaudeCompactWindowSetting, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", CLAUDE_COMPACT_WINDOW_ROUTES.update, decodeClaudeCompactWindowResponse, { tokens }),
  );
}

export function getHostProviderEnvironment(
  request: TeamApiRequest,
  provider: ProviderEnvironmentProvider,
): Effect.Effect<ProviderEnvironment, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", PROVIDER_ENVIRONMENT_ROUTES.settings, decodeProviderEnvironmentResponse, { provider }),
  );
}

export function setHostProviderEnvironment(
  request: TeamApiRequest,
  update: ProviderEnvironmentUpdate,
): Effect.Effect<ProviderEnvironment, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", PROVIDER_ENVIRONMENT_ROUTES.update, decodeProviderEnvironmentResponse, {
      provider: update.provider,
      variables: update.variables.map(({ name, value, sensitive }) => ({ name, value, sensitive })),
    }),
  );
}

export function getHostModelVisibility(
  request: TeamApiRequest,
  provider: AgentProviderRef,
): Effect.Effect<ProviderModelVisibility, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", MODEL_VISIBILITY_ROUTES.settings, decodeProviderModelVisibility, { provider }),
  );
}

export function setHostModelVisibility(
  request: TeamApiRequest,
  change: ProviderModelVisibilityChange,
): Effect.Effect<ProviderModelVisibility, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", MODEL_VISIBILITY_ROUTES.update, decodeProviderModelVisibility, {
      provider: change.provider,
      shown: change.shown,
    }),
  );
}

export interface HostProviderDefault {
  provider: AgentProviderRef | null;
  model: AgentModelId | null;
}

function decodeHostProviderDefault(value: unknown): HostProviderDefault {
  const record = decodeRecord(value, "default provider");
  const { provider, model } = record;
  if (provider !== null && !isAgentProviderRef(provider)) throw new Error("Invalid default provider.");
  if (model !== null && !isAgentModel(model)) throw new Error("Invalid default model.");
  return { provider, model };
}

export function getHostProviderDefault(
  request: TeamApiRequest,
): Effect.Effect<HostProviderDefault, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_DEFAULT_ROUTES.settings, decodeHostProviderDefault, {}));
}

export function setHostProviderDefault(
  request: TeamApiRequest,
  provider: AgentProviderId,
  model: AgentModelId | null,
): Effect.Effect<HostProviderDefault, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", PROVIDER_DEFAULT_ROUTES.update, decodeHostProviderDefault, { provider, model }),
  );
}

export function listMcpServers(request: TeamApiRequest): Effect.Effect<McpServerConfig[], TeamAdminRequestError> {
  return adminCall(() => request("GET", MCP_ROUTES.list, decodeMcpServerConfigs));
}

export function saveMcpServer(
  request: TeamApiRequest,
  input: SaveMcpServerInput,
): Effect.Effect<McpServerConfig[], TeamAdminRequestError> {
  return adminCall(() => request("POST", MCP_ROUTES.save, decodeMcpServerConfigs, { config: mcpConfig(input.config) }));
}

export function removeMcpServer(
  request: TeamApiRequest,
  input: RemoveMcpServerInput,
): Effect.Effect<McpServerConfig[], TeamAdminRequestError> {
  return adminCall(() => request("POST", MCP_ROUTES.remove, decodeMcpServerConfigs, { ...input }));
}

export function setMcpServerEnabled(
  request: TeamApiRequest,
  input: SetMcpServerEnabledInput,
): Effect.Effect<McpServerConfig[], TeamAdminRequestError> {
  return adminCall(() => request("POST", MCP_ROUTES.toggle, decodeMcpServerConfigs, { ...input }));
}

export function getHostMcpAccess(request: TeamApiRequest): Effect.Effect<McpAccessSnapshot, TeamAdminRequestError> {
  return adminCall(() => request("POST", MCP_ACCESS_ROUTES.read, decodeMcpAccessSnapshot, {}));
}

export function setHostMcpAccess(
  request: TeamApiRequest,
  input: SetMcpAccessInput,
): Effect.Effect<McpAccessSnapshot, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", MCP_ACCESS_ROUTES.set, decodeMcpAccessSnapshot, {
      revision: input.revision,
      mcpServerId: input.mcpServerId,
      access: { agents: input.access.agents, everyone: input.access.everyone, roles: { ...input.access.roles } },
    }),
  );
}

export function testMcpServer(
  request: TeamApiRequest,
  input: TestMcpServerInput,
): Effect.Effect<McpTestResult, TeamAdminRequestError> {
  return adminCall(() => request("POST", MCP_ROUTES.test, decodeMcpTestResult, { config: mcpConfig(input.config) }));
}
export function startMcpSignIn(
  request: TeamApiRequest,
  input: TestMcpServerInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", MCP_SIGN_IN_ROUTES.start, ignoreResponse, { config: mcpConfig(input.config) }),
  );
}

export function mcpSignInStatus(
  request: TeamApiRequest,
  input: CancelMcpSignInInput,
): Effect.Effect<McpSignInStatus, TeamAdminRequestError> {
  return adminCall(() => request("POST", MCP_SIGN_IN_ROUTES.status, decodeMcpSignInStatus, { url: input.url }));
}

export function cancelMcpSignIn(
  request: TeamApiRequest,
  input: CancelMcpSignInInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", MCP_SIGN_IN_ROUTES.cancel, ignoreResponse, { url: input.url }));
}

export function startMcpSignInRelay(
  request: TeamApiRequest,
  input: TestMcpServerInput,
): Effect.Effect<{ flowId: string }, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", SIGN_IN_RELAY_ROUTES.mcpStart, decodeSignInRelayFlow, { config: mcpConfig(input.config) }),
  );
}

export function startProviderSignInRelay(
  request: TeamApiRequest,
  relay: ProviderSignInRelay,
  provider: ProviderSignInRelayProvider,
): Effect.Effect<{ flowId: string }, TeamAdminRequestError> {
  return adminCall(() => request("POST", relay.start, decodeSignInRelayFlow, { provider }));
}

export function startProviderAccountSignInRelay(
  request: TeamApiRequest,
  relay: ProviderAccountRelay,
  input: { provider: ProviderAccountRelayProvider; accountId: string | null },
): Effect.Effect<{ flowId: string }, TeamAdminRequestError> {
  return adminCall(() => request("POST", relay.start, decodeSignInRelayFlow, { ...input }));
}

export function startLinkSignInRelay(
  request: TeamApiRequest,
  input: { agentId: string; url: string },
): Effect.Effect<{ flowId: string }, TeamAdminRequestError> {
  return adminCall(() => request("POST", SIGN_IN_RELAY_ROUTES.linkStart, decodeSignInRelayFlow, input));
}

export function signInRelayStatus(
  request: TeamApiRequest,
  flowId: string,
): Effect.Effect<SignInRelayStatus, TeamAdminRequestError> {
  return adminCall(() => request("POST", SIGN_IN_RELAY_ROUTES.status, decodeSignInRelayStatus, { flowId }));
}

export function completeSignInRelay(
  request: TeamApiRequest,
  flowId: string,
  query: string,
): Effect.Effect<SignInRelayStatus, TeamAdminRequestError> {
  return adminCall(() => request("POST", SIGN_IN_RELAY_ROUTES.complete, decodeSignInRelayStatus, { flowId, query }));
}

export function cancelSignInRelay(request: TeamApiRequest, flowId: string): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", SIGN_IN_RELAY_ROUTES.cancel, ignoreResponse, { flowId }));
}

export function signOutMcpServer(
  request: TeamApiRequest,
  input: SignOutMcpServerInput,
): Effect.Effect<McpSignInState[], TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", MCP_SIGN_IN_ROUTES.signOut, decodeMcpSignInStates, { mcpServerId: input.mcpServerId }),
  );
}

export function listMcpSignIns(request: TeamApiRequest): Effect.Effect<McpSignInState[], TeamAdminRequestError> {
  return adminCall(() => request("POST", MCP_SIGN_IN_ROUTES.list, decodeMcpSignInStates, {}));
}

export function mcpSignInApp(
  request: TeamApiRequest,
  input: McpSignInAppInput,
): Effect.Effect<McpSignInAppState, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", MCP_SIGN_IN_APP_ROUTES.get, decodeMcpSignInAppState, { mcpServerId: input.mcpServerId }),
  );
}

export function saveMcpSignInApp(
  request: TeamApiRequest,
  input: SaveMcpSignInAppInput,
): Effect.Effect<McpSignInAppState, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", MCP_SIGN_IN_APP_ROUTES.save, decodeMcpSignInAppState, {
      mcpServerId: input.mcpServerId,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      scope: input.scope,
    }),
  );
}

export function removeMcpSignInApp(
  request: TeamApiRequest,
  input: McpSignInAppInput,
): Effect.Effect<McpSignInAppState, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", MCP_SIGN_IN_APP_ROUTES.remove, decodeMcpSignInAppState, { mcpServerId: input.mcpServerId }),
  );
}

export const getStorageUsage = Effect.fn("TeamAdmin.getStorageUsage")(function* (
  request: TeamApiRequest,
  input: GetStorageUsageInput,
) {
  const { channelId, force } = input;
  const result = yield* adminCall(() =>
    input.scope === "channel"
      ? request("POST", STORAGE_CHANNEL_ROUTES.files, decodeChannelStorageUsage, {
          channelId: channelId ?? "",
          ...(force === undefined ? {} : { force }),
        })
      : request("POST", STORAGE_ROUTES.usage, decodeStorageUsage, { ...input }),
  );
  return yield* Effect.try({
    try: () => assertStorageUsageScope(result, input),
    catch: (cause) => new TeamAdminRequestError({ cause }),
  });
});

export function deleteStoredFile(
  request: TeamApiRequest,
  input: DeleteStoredFileInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", STORAGE_ROUTES.deleteFile, ignoreResponse, { ...input }));
}

export function clearStorage(
  request: TeamApiRequest,
  input: ClearStorageInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", STORAGE_ROUTES.clear, ignoreResponse, { ...input }));
}

export function listHostBackgroundProcesses(
  request: TeamApiRequest,
): Effect.Effect<BackgroundProcess[] | null, TeamAdminRequestError> {
  return adminCall(() => request("POST", BACKGROUND_PROCESSES_ROUTES.list, decodeBackgroundProcessesResponse, {}));
}

export function stopHostBackgroundProcess(
  request: TeamApiRequest,
  id: string,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", BACKGROUND_PROCESSES_ROUTES.stop, ignoreResponse, { id }));
}

function decodeHostedSiteList(value: unknown): HostedSiteList {
  const list = parseHostedSiteList(value);
  if (!list) throw new Error("The host returned an invalid site list.");
  return list;
}

export function listHostedSites(request: TeamApiRequest): Effect.Effect<HostedSiteList, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOSTED_SITES_ROUTES.list, decodeHostedSiteList, {}));
}

export function deleteHostedSite(request: TeamApiRequest, siteId: string): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOSTED_SITES_ROUTES.remove, ignoreResponse, { siteId }));
}

export type ProviderCodeLoginRoutes =
  | typeof PROVIDERS_V8_ROUTES
  | typeof PROVIDERS_V4_ROUTES
  | typeof PROVIDERS_SIGN_IN_V3_ROUTES
  | typeof PROVIDERS_ADMIN_ROUTES;

export function startProviderCodeLogin(
  request: TeamApiRequest,
  provider: AgentProviderId,
  routes: ProviderCodeLoginRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<ProviderCodeLoginStart, TeamAdminRequestError> {
  return adminCall(() => request("POST", routes.codeLoginStart, decodeProviderCodeLoginStart, { provider }));
}
const providerChange = Effect.fn("TeamAdmin.providerChange")(function* (
  request: TeamApiRequest,
  path: string,
  body: TeamProtocolV2Json,
) {
  yield* adminCall(() => request("POST", path, ignoreResponse, body));
  return yield* adminCall(() => request("GET", TEAM_API_ROUTES.agents.status, decodeAgentStatus));
});

export function submitProviderCodeLogin(
  request: TeamApiRequest,
  input: SubmitProviderCodeLoginInput,
  routes:
    | typeof PROVIDERS_V8_ROUTES
    | typeof PROVIDERS_V4_ROUTES
    | typeof PROVIDERS_SIGN_IN_V3_ROUTES = PROVIDERS_SIGN_IN_V3_ROUTES,
): Effect.Effect<AgentStatus, TeamAdminRequestError> {
  return providerChange(request, routes.codeLoginSubmit, { ...input });
}

export function cancelProviderCodeLogin(
  request: TeamApiRequest,
  provider: AgentProviderId,
  routes: ProviderCodeLoginRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<AgentStatus, TeamAdminRequestError> {
  return providerChange(request, routes.codeLoginCancel, { provider });
}
export function startProviderHostSignIn(
  request: TeamApiRequest,
  provider: AgentProviderId,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_HOST_SIGN_IN_ROUTES.start, ignoreResponse, { provider }));
}

export function providerHostSignInStatus(
  request: TeamApiRequest,
  provider: AgentProviderId,
): Effect.Effect<ProviderHostSignInStatus, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", PROVIDER_HOST_SIGN_IN_ROUTES.status, decodeProviderHostSignInStatus, { provider }),
  );
}

export function cancelProviderHostSignIn(
  request: TeamApiRequest,
  provider: AgentProviderId,
): Effect.Effect<AgentStatus, TeamAdminRequestError> {
  return providerChange(request, PROVIDER_HOST_SIGN_IN_ROUTES.cancel, { provider });
}

export function listProviderAccounts(
  request: TeamApiRequest,
): Effect.Effect<HostProviderAccounts, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_ACCOUNTS_ROUTES.list, decodeHostProviderAccounts, {}));
}

export function listProviderAccountsWithModels(
  request: TeamApiRequest,
  withModels: boolean,
  withPools: boolean,
  withLiveVoice = false,
): Effect.Effect<HostProviderAccounts, TeamAdminRequestError> {
  if (!withModels && !withPools && !withLiveVoice) return listProviderAccounts(request);
  return Effect.all(
    [
      listProviderAccounts(request),
      withModels
        ? adminCall(() =>
            request("POST", PROVIDER_ACCOUNT_MODELS_ROUTES.list, decodeHostProviderAccountModels, {}),
          ).pipe(Effect.orElseSucceed(() => null))
        : Effect.succeed(null),
      withPools
        ? adminCall(() => request("POST", PROVIDER_ACCOUNT_POOL_ROUTES.list, decodeHostProviderAccountPools, {})).pipe(
            Effect.orElseSucceed(() => null),
          )
        : Effect.succeed(null),
      withLiveVoice
        ? adminCall(() => request("POST", LIVE_VOICE_ACCOUNT_ROUTES.settings, decodeLiveVoiceAccount, {})).pipe(
            Effect.map((accountId) => ({ accountId })),
            Effect.orElseSucceed(() => null),
          )
        : Effect.succeed(null),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map(([accounts, models, pools, liveVoice]) => {
      const withAccountModels = models ? withHostProviderAccountModels(accounts, models) : accounts;
      const withPools = pools ? { ...withAccountModels, pools } : withAccountModels;
      return liveVoice ? { ...withPools, liveVoiceAccount: liveVoice.accountId } : withPools;
    }),
  );
}

export function connectProviderAccountKey(
  request: TeamApiRequest,
  input: ConnectProviderAccountKeyInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_ACCOUNT_KEYS_ROUTES.connect, ignoreResponse, { ...input }));
}

export function startProviderAccountCodeLogin(
  request: TeamApiRequest,
  input: ConnectProviderAccountInput,
): Effect.Effect<ProviderAccountCodeLoginStart, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", PROVIDER_ACCOUNT_CODE_ROUTES.start, decodeProviderAccountCodeLoginStart, { ...input }),
  );
}

export function submitProviderAccountCodeLogin(
  request: TeamApiRequest,
  input: SubmitProviderAccountCodeLoginInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_ACCOUNT_CODE_ROUTES.submit, ignoreResponse, { ...input }));
}

export function providerAccountCodeLoginStatus(
  request: TeamApiRequest,
  input: RemoveProviderAccountInput,
): Effect.Effect<ProviderAccountCodeLoginStatus, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", PROVIDER_ACCOUNT_CODE_ROUTES.status, decodeProviderAccountCodeLoginStatus, { ...input }),
  );
}

export function cancelProviderAccountCodeLogin(
  request: TeamApiRequest,
  input: RemoveProviderAccountInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_ACCOUNT_CODE_ROUTES.cancel, ignoreResponse, { ...input }));
}

export function setProviderAccountPool(
  request: TeamApiRequest,
  input: SetProviderAccountPoolInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_ACCOUNT_POOL_ROUTES.update, ignoreResponse, { ...input }));
}

export function setLiveVoiceAccount(
  request: TeamApiRequest,
  input: SetLiveVoiceAccountInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", LIVE_VOICE_ACCOUNT_ROUTES.update, ignoreResponse, { ...input }));
}

export function providerAccountUsage(request: TeamApiRequest): Effect.Effect<AccountUsage, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_ACCOUNTS_ROUTES.usage, decodeHostProviderAccountUsage, {}));
}

export function startProviderAccountSignIn(
  request: TeamApiRequest,
  input: ConnectProviderAccountInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_ACCOUNTS_ROUTES.signInStart, ignoreResponse, { ...input }));
}

export function providerAccountSignInStatus(
  request: TeamApiRequest,
  provider: AgentProviderId,
): Effect.Effect<ProviderHostSignInStatus, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", PROVIDER_ACCOUNTS_ROUTES.signInStatus, decodeProviderHostSignInStatus, { provider }),
  );
}

export function cancelProviderAccountSignIn(
  request: TeamApiRequest,
  provider: AgentProviderId,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_ACCOUNTS_ROUTES.signInCancel, ignoreResponse, { provider }));
}

export function renameProviderAccount(
  request: TeamApiRequest,
  input: RenameProviderAccountInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_ACCOUNTS_ROUTES.rename, ignoreResponse, { ...input }));
}

export function removeProviderAccount(
  request: TeamApiRequest,
  input: RemoveProviderAccountInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_ACCOUNTS_ROUTES.remove, ignoreResponse, { ...input }));
}

export function providerUsageResets(
  request: TeamApiRequest,
  provider: AgentProviderId,
): Effect.Effect<ProviderUsageResets[], TeamAdminRequestError> {
  return adminCall(() =>
    request(
      "POST",
      PROVIDER_USAGE_RESET_ROUTES.list,
      (value) => decodeProviderUsageResets(decodeRecord(value, "provider usage resets").accounts),
      { provider },
    ),
  );
}

export function resetProviderUsage(
  request: TeamApiRequest,
  input: ResetProviderUsageInput,
): Effect.Effect<ProviderUsageResetOutcome, TeamAdminRequestError> {
  return adminCall(() =>
    request(
      "POST",
      PROVIDER_USAGE_RESET_ROUTES.consume,
      (value) => decodeProviderUsageResetOutcome(decodeRecord(value, "provider usage reset").outcome),
      { ...input },
    ),
  );
}

export function signOutProvider(
  request: TeamApiRequest,
  provider: AgentProviderId,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_SIGN_OUT_ROUTES.signOut, ignoreResponse, { provider }));
}

export function getProviderUse(request: TeamApiRequest): Effect.Effect<AgentProviderId[], TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_USE_ROUTES.list, decodeProviderUseResponse, {}));
}

export function setProviderUse(
  request: TeamApiRequest,
  provider: AgentProviderId,
  on: boolean,
): Effect.Effect<AgentProviderId[], TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_USE_ROUTES.set, decodeProviderUseResponse, { provider, on }));
}

export function setAgentProviderAccount(
  request: TeamApiRequest,
  input: SetAgentProviderAccountInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_ACCOUNTS_ROUTES.agent, ignoreResponse, { ...input }));
}

export function cancelProviderSignInRelay(
  request: TeamApiRequest,
  flowId: string,
): Effect.Effect<AgentStatus, TeamAdminRequestError> {
  return providerChange(request, SIGN_IN_RELAY_ROUTES.cancel, { flowId });
}
export type ProviderKeyRoutes = typeof PROVIDERS_ADMIN_ROUTES | typeof PROVIDERS_V5_ROUTES | typeof PROVIDERS_V8_ROUTES;

export const getProviderApiKeyState = Effect.fn("TeamAdmin.getProviderApiKeyState")(function* (
  request: TeamApiRequest,
  provider: AgentProviderId,
  routes: ProviderKeyRoutes = PROVIDERS_ADMIN_ROUTES,
) {
  const status = yield* adminCall(() => request("POST", routes.apiKeyState, decodeProviderApiKeyStatus, { provider }));
  return { provider, status };
});

export function setProviderApiKey(
  request: TeamApiRequest,
  input: SetProviderApiKeyInput,
  routes: ProviderKeyRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<AgentStatus, TeamAdminRequestError> {
  return providerChange(request, routes.apiKeySet, { provider: input.provider, key: input.key });
}

export function clearProviderApiKey(
  request: TeamApiRequest,
  provider: AgentProviderId,
  routes: ProviderKeyRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<AgentStatus, TeamAdminRequestError> {
  return providerChange(request, routes.apiKeyClear, { provider });
}

export type ProviderRuntimeRoutes =
  | typeof PROVIDERS_V8_ROUTES
  | typeof PROVIDERS_V5_ROUTES
  | typeof PROVIDERS_V4_ROUTES
  | typeof PROVIDERS_RUNTIMES_V2_ROUTES
  | typeof PROVIDERS_ADMIN_ROUTES;

function runtimeDecoder(routes: ProviderRuntimeRoutes) {
  return routes === PROVIDERS_V8_ROUTES ? decodeProviderRuntimeSnapshotV8 : decodeProviderRuntimeSnapshot;
}

export function getProviderRuntimes(
  request: TeamApiRequest,
  routes: ProviderRuntimeRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<ProviderRuntimeSnapshot, TeamAdminRequestError> {
  return adminCall(() => request("POST", routes.runtimesStatus, runtimeDecoder(routes), {}));
}

export function downloadProviderRuntime(
  request: TeamApiRequest,
  provider: DownloadableProviderId,
  routes: ProviderRuntimeRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<ProviderRuntimeSnapshot, TeamAdminRequestError> {
  return adminCall(() => request("POST", routes.runtimesDownload, runtimeDecoder(routes), { provider }));
}

export function cancelProviderRuntime(
  request: TeamApiRequest,
  provider: DownloadableProviderId,
  routes: ProviderRuntimeRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<ProviderRuntimeSnapshot, TeamAdminRequestError> {
  return adminCall(() => request("POST", routes.runtimesCancel, runtimeDecoder(routes), { provider }));
}

export function checkProviderRuntimeUpdates(
  request: TeamApiRequest,
  routes: ProviderRuntimeRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<ProviderRuntimeSnapshot, TeamAdminRequestError> {
  return adminCall(() => request("POST", routes.runtimesCheck, runtimeDecoder(routes), {}));
}

export type CustomProviderRoutes =
  | typeof CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES
  | typeof CUSTOM_PROVIDER_EDIT_ROUTES
  | typeof CUSTOM_PROVIDER_HARNESS_ROUTES
  | typeof PROVIDERS_ADMIN_ROUTES;

export function listCustomProviders(
  request: TeamApiRequest,
  routes: CustomProviderRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<CustomProviderSummary[], TeamAdminRequestError> {
  return adminCall(() => request("POST", routes.customList, decodeCustomProviderSummaries, {}));
}

export function saveCustomProvider(
  request: TeamApiRequest,
  input: SaveCustomProviderInput,
  routes: CustomProviderRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<CustomProviderResult, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", routes.customSave, decodeCustomProviderResult, {
      ...input,
      models: input.models.map(({ id, name }) => ({ id, name })),
      headers: input.headers.map(({ name, value }) => ({ name, value })),
      ...(routes === CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES
        ? { harness: input.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS }
        : {}),
    }),
  );
}

export function updateCustomProvider(
  request: TeamApiRequest,
  input: UpdateCustomProviderInput,
  routes: typeof CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES | typeof CUSTOM_PROVIDER_EDIT_ROUTES,
): Effect.Effect<CustomProviderResult, TeamAdminRequestError> {
  const body = {
    id: input.id,
    name: input.name,
    baseUrl: input.baseUrl,
    models: input.models.map(({ id, name }) => ({ id, name })),
    ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
    ...(input.headers !== undefined ? { headers: input.headers.map(({ name, value }) => ({ name, value })) } : {}),
  };
  return adminCall(() =>
    routes === CUSTOM_PROVIDER_HARNESS_CHOICE_ROUTES && input.harness !== undefined
      ? request("POST", routes.customUpdate, decodeCustomProviderResult, { ...body, harness: input.harness })
      : request("POST", CUSTOM_PROVIDER_EDIT_ROUTES.customUpdate, decodeCustomProviderResult, body),
  );
}

export function deleteCustomProvider(
  request: TeamApiRequest,
  input: DeleteCustomProviderInput,
  routes: CustomProviderRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<CustomProviderResult, TeamAdminRequestError> {
  return adminCall(() => request("POST", routes.customDelete, decodeCustomProviderResult, { id: input.id }));
}

export function listCustomAgents(request: TeamApiRequest): Effect.Effect<CustomAgentSummary[], TeamAdminRequestError> {
  return adminCall(() => request("POST", CUSTOM_AGENTS_ROUTES.list, decodeCustomAgentSummaries, {}));
}

export function saveCustomAgent(
  request: TeamApiRequest,
  input: SaveCustomAgentInput,
): Effect.Effect<CustomAgentResult, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", CUSTOM_AGENTS_ROUTES.save, decodeCustomAgentResult, {
      id: input.id,
      name: input.name,
      command: input.command,
      args: [...input.args],
      env: input.env.map(({ name, value }) => ({ name, value })),
      usagePrompt: input.usagePrompt,
    }),
  );
}

export function deleteCustomAgent(
  request: TeamApiRequest,
  id: string,
): Effect.Effect<CustomAgentResult, TeamAdminRequestError> {
  return adminCall(() => request("POST", CUSTOM_AGENTS_ROUTES.delete, decodeCustomAgentResult, { id }));
}

export function getHostReleaseStatus(request: TeamApiRequest): Effect.Effect<HostReleaseStatus, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOST_RELEASE_ROUTES.status, decodeHostReleaseStatus, {}));
}

export function checkHostRelease(request: TeamApiRequest): Effect.Effect<HostReleaseStatus, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOST_RELEASE_ROUTES.check, decodeHostReleaseStatus, {}));
}

function decodeSessionSettings(value: unknown): AgentSessionSettings {
  if (!isAgentSessionSettings(value)) throw new Error("Invalid session settings response.");
  return value;
}
export function readAgentSessionSettings(
  request: TeamApiRequest,
  agentId: string,
): Effect.Effect<AgentSessionSettings, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_SESSION_SETTINGS_ROUTES.read, decodeSessionSettings, { agentId }));
}
export function setAgentSessionSetting(
  request: TeamApiRequest,
  input: SetAgentSessionSettingInput,
): Effect.Effect<AgentSessionSettings, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_SESSION_SETTINGS_ROUTES.set, decodeSessionSettings, { ...input }));
}
export function resetAgentSessionSetting(
  request: TeamApiRequest,
  input: ResetAgentSessionSettingInput,
): Effect.Effect<AgentSessionSettings, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_SESSION_SETTINGS_ROUTES.reset, decodeSessionSettings, { ...input }));
}

export function readAgentFolders(
  request: TeamApiRequest,
  agentId: string,
): Effect.Effect<AgentFolderList, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_FOLDERS_ROUTES.read, decodeAgentFolderListFromMain, { agentId }));
}
export function addAgentFolder(
  request: TeamApiRequest,
  input: AddAgentFolderInput,
): Effect.Effect<AgentFolderChange, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_FOLDERS_ROUTES.add, decodeAgentFolderChangeFromMain, { ...input }));
}
export function removeAgentFolder(
  request: TeamApiRequest,
  input: AgentFolderInput,
): Effect.Effect<AgentFolderChange, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_FOLDERS_ROUTES.remove, decodeAgentFolderChangeFromMain, { ...input }));
}
export function excludeAgentFolder(
  request: TeamApiRequest,
  input: AgentFolderInput,
): Effect.Effect<AgentExclusionChange, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", AGENT_FOLDERS_ROUTES.exclude, decodeAgentExclusionChangeFromMain, { ...input }),
  );
}
export function includeAgentFolder(
  request: TeamApiRequest,
  input: AgentFolderInput,
): Effect.Effect<AgentExclusionChange, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", AGENT_FOLDERS_ROUTES.include, decodeAgentExclusionChangeFromMain, { ...input }),
  );
}
export function browseAgentFolders(
  request: TeamApiRequest,
  input: BrowseAgentFoldersInput,
): Effect.Effect<AgentFolderBrowse, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_FOLDERS_ROUTES.browse, decodeAgentFolderBrowse, { ...input }));
}

export function readChannelFolders(
  request: TeamApiRequest,
  channelId: string,
): Effect.Effect<ChannelFolderList, TeamAdminRequestError> {
  return adminCall(() => request("POST", CHANNEL_FOLDERS_ROUTES.read, decodeChannelFolderListFromMain, { channelId }));
}
export function addChannelFolder(
  request: TeamApiRequest,
  input: ChannelFolderInput,
): Effect.Effect<ChannelFolderChange, TeamAdminRequestError> {
  return adminCall(() => request("POST", CHANNEL_FOLDERS_ROUTES.add, decodeChannelFolderChangeFromMain, { ...input }));
}
export function removeChannelFolder(
  request: TeamApiRequest,
  input: ChannelFolderInput,
): Effect.Effect<ChannelFolderChange, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", CHANNEL_FOLDERS_ROUTES.remove, decodeChannelFolderChangeFromMain, { ...input }),
  );
}
export function browseChannelFolders(
  request: TeamApiRequest,
  input: BrowseChannelFoldersInput,
): Effect.Effect<AgentFolderBrowse, TeamAdminRequestError> {
  return adminCall(() => request("POST", CHANNEL_FOLDERS_ROUTES.browse, decodeAgentFolderBrowse, { ...input }));
}

function decodeHiddenAgents(value: unknown): HiddenAgentsSnapshot {
  if (!isHiddenAgentsSnapshot(value)) throw new Error("Invalid hidden agents response.");
  return value;
}
export function listHiddenAgents(request: TeamApiRequest): Effect.Effect<HiddenAgentsSnapshot, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_HIDDEN_ROUTES.read, decodeHiddenAgents, {}));
}
export function setAgentHidden(
  request: TeamApiRequest,
  input: SetAgentHiddenInput,
): Effect.Effect<HiddenAgentsSnapshot, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", AGENT_HIDDEN_ROUTES.set, decodeHiddenAgents, { agentId: input.agentId, hidden: input.hidden }),
  );
}

function decodeAgentColors(value: unknown): AgentColors {
  if (!isAgentColors(value)) throw new Error("Invalid agent colors response.");
  return value;
}
export function readAgentColors(request: TeamApiRequest): Effect.Effect<AgentColors, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_COLORS_ROUTES.read, decodeAgentColors, {}));
}
export function setAgentColor(
  request: TeamApiRequest,
  input: SetAgentColorInput,
): Effect.Effect<AgentColors, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", AGENT_COLORS_ROUTES.set, decodeAgentColors, { agentId: input.agentId, color: input.color }),
  );
}

function decodeChatColors(value: unknown): ChatColors {
  if (!isChatColors(value)) throw new Error("Invalid chat colors response.");
  return value;
}
export function readChatColors(request: TeamApiRequest): Effect.Effect<ChatColors, TeamAdminRequestError> {
  return adminCall(() => request("POST", CHAT_COLORS_ROUTES.read, decodeChatColors, {}));
}
export function setAgentChatColor(
  request: TeamApiRequest,
  input: SetAgentChatColorInput,
): Effect.Effect<ChatColors, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", CHAT_COLORS_ROUTES.set, decodeChatColors, { agentId: input.agentId, color: input.color }),
  );
}

function decodeAgentNotificationLevels(value: unknown): AgentNotificationLevelsSnapshot {
  if (!isAgentNotificationLevelsSnapshot(value)) throw new Error("Invalid agent notification levels response.");
  return value;
}
export function listAgentNotificationLevels(
  request: TeamApiRequest,
): Effect.Effect<AgentNotificationLevelsSnapshot, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.read, decodeAgentNotificationLevels, {}));
}
export function setAgentNotificationLevel(
  request: TeamApiRequest,
  input: SetAgentNotificationLevelInput,
): Effect.Effect<AgentNotificationLevelsSnapshot, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.set, decodeAgentNotificationLevels, {
      agentId: input.agentId,
      level: input.level,
    }),
  );
}

export function setOwnServerNotificationLevel(
  request: TeamApiRequest,
  level: SetOwnServerNotificationLevelInput["level"],
): Effect.Effect<AgentNotificationLevelsSnapshot, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.server, decodeAgentNotificationLevels, { level }),
  );
}

function decodeSidebarPins(value: unknown): SidebarPinsSnapshot {
  if (!isSidebarPinsSnapshot(value)) throw new Error("Invalid pinned chats response.");
  return value;
}
export function readSidebarPins(request: TeamApiRequest): Effect.Effect<SidebarPinsSnapshot, TeamAdminRequestError> {
  return adminCall(() => request("POST", SIDEBAR_PINS_ROUTES.read, decodeSidebarPins, {}));
}
export function setSidebarPins(
  request: TeamApiRequest,
  items: readonly SidebarPin[],
): Effect.Effect<SidebarPinsSnapshot, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", SIDEBAR_PINS_ROUTES.set, decodeSidebarPins, {
      items: items.map(({ kind, id }) => ({ kind, id })),
    }),
  );
}
export function seedSidebarPins(
  request: TeamApiRequest,
  items: readonly SidebarPin[],
): Effect.Effect<SidebarPinsSnapshot, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", SIDEBAR_PINS_ROUTES.seed, decodeSidebarPins, {
      items: items.map(({ kind, id }) => ({ kind, id })),
    }),
  );
}

type GitHubConnectorStatusRoute = Exclude<keyof typeof CONNECTORS_ROUTES, "githubRepositories">;

export function githubConnectorRequest(
  request: TeamApiRequest,
  route: GitHubConnectorStatusRoute,
): Effect.Effect<HostGitHubConnectorStatus, TeamAdminRequestError> {
  return adminCall(() => request("POST", CONNECTORS_ROUTES[route], decodeHostGitHubConnectorStatus, {}));
}

export function githubConnectorRepositories(
  request: TeamApiRequest,
): Effect.Effect<GitHubConnectorRepositories, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", CONNECTORS_ROUTES.githubRepositories, decodeHostGitHubConnectorRepositories, {}),
  );
}

export function onePasswordConnectorRequest(
  request: TeamApiRequest,
  route: keyof typeof ONEPASSWORD_CONNECTOR_ROUTES,
  body: OnePasswordHostConnectInput | Record<string, never> = {},
): Effect.Effect<OnePasswordConnectorStatus, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", ONEPASSWORD_CONNECTOR_ROUTES[route], decodeHostOnePasswordConnectorStatus, { ...body }),
  );
}

export function bitwardenConnectorRequest(
  request: TeamApiRequest,
  route: keyof typeof BITWARDEN_CONNECTOR_ROUTES,
  body: BitwardenHostConnectInput | Record<string, never> = {},
): Effect.Effect<BitwardenConnectorStatus, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", BITWARDEN_CONNECTOR_ROUTES[route], decodeHostBitwardenConnectorStatus, { ...body }),
  );
}

export function listPasswordManagers(
  request: TeamApiRequest,
): Effect.Effect<PasswordManagerStatus[], TeamAdminRequestError> {
  return adminCall(() => request("POST", PASSWORD_MANAGERS_ROUTES.list, decodeHostPasswordManagerList, {}));
}

export function connectPasswordManager(
  request: TeamApiRequest,
  input: PasswordManagerConnectInput,
): Effect.Effect<PasswordManagerStatus, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", PASSWORD_MANAGERS_ROUTES.connect, decodeHostPasswordManagerStatus, {
      manager: input.manager,
      method: { ...input.method },
    }),
  );
}

export function passwordManagerRequest(
  request: TeamApiRequest,
  route: "cancel" | "disconnect",
  manager: PasswordManagerId,
): Effect.Effect<PasswordManagerStatus, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", PASSWORD_MANAGERS_ROUTES[route], decodeHostPasswordManagerStatus, { manager }),
  );
}

type HostVaultVersion = 1 | 2 | 3 | 4;

function vaultRoutes(version: HostVaultVersion) {
  return version === 4
    ? VAULT_V4_ROUTES
    : version === 3
      ? VAULT_V3_ROUTES
      : version === 2
        ? VAULT_V2_ROUTES
        : VAULT_ROUTES;
}

function hostVaultState(version: HostVaultVersion) {
  return (value: unknown) => decodeHostVaultState(value, version === 4);
}

export function listHostVault(
  request: TeamApiRequest,
  version: HostVaultVersion,
): Effect.Effect<VaultState, TeamAdminRequestError> {
  return adminCall(() => request("POST", vaultRoutes(version).list, hostVaultState(version), {}));
}

export function listHostVaultCodes(request: TeamApiRequest): Effect.Effect<VaultTwoStepCodes, TeamAdminRequestError> {
  return adminCall(() => request("POST", VAULT_V3_ROUTES.codes, decodeHostVaultCodes, {}));
}

export function saveHostVaultItem(
  request: TeamApiRequest,
  input: VaultSaveInput,
  version: HostVaultVersion,
): Effect.Effect<VaultState, TeamAdminRequestError> {
  const { fillSites, twoStepKey, agents, ...item } = {
    fillSites: undefined,
    twoStepKey: undefined,
    agents: undefined,
    ...input,
  };
  return adminCall(() =>
    request("POST", vaultRoutes(version).save, hostVaultState(version), {
      ...item,
      ...(fillSites === undefined ? {} : { fillSites }),
      ...(twoStepKey === undefined ? {} : { twoStepKey }),
      ...(agents === undefined || version < 4 ? {} : { agents }),
    }),
  );
}

export function deleteHostVaultItem(
  request: TeamApiRequest,
  id: string,
  version: HostVaultVersion,
): Effect.Effect<VaultState, TeamAdminRequestError> {
  return adminCall(() => request("POST", vaultRoutes(version).delete, hostVaultState(version), { id }));
}

export function importHostVaultCsv(
  request: TeamApiRequest,
  csv: string,
): Effect.Effect<VaultHostImportResult, TeamAdminRequestError> {
  return adminCall(() => request("POST", VAULT_IMPORT_ROUTES.import, decodeHostVaultImport, { csv }));
}

export function listHostBrowserProfiles(
  request: TeamApiRequest,
): Effect.Effect<BrowserProfileList, TeamAdminRequestError> {
  return adminCall(() => request("POST", BROWSER_PROFILES_ROUTES.list, decodeBrowserProfileList, {}));
}

export function createHostBrowserProfile(
  request: TeamApiRequest,
  name: string,
): Effect.Effect<BrowserProfileSummary, TeamAdminRequestError> {
  return adminCall(() => request("POST", BROWSER_PROFILES_ROUTES.create, decodeBrowserProfileSummary, { name }));
}

export function updateHostBrowserProfile(
  request: TeamApiRequest,
  input: UpdateBrowserProfileInput,
): Effect.Effect<BrowserProfileSummary, TeamAdminRequestError> {
  return adminCall(() => request("POST", BROWSER_PROFILES_ROUTES.update, decodeBrowserProfileSummary, { ...input }));
}

export function clearHostBrowserData(
  request: TeamApiRequest,
  input: ClearBrowserDataInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", BROWSER_PROFILES_ROUTES.clear, ignoreResponse, { ...input }));
}

export function deleteHostBrowserProfile(
  request: TeamApiRequest,
  profileId: string,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", BROWSER_PROFILES_ROUTES.delete, ignoreResponse, { profileId }));
}

export function getHostAgentBrowserProfile(
  request: TeamApiRequest,
  agentId: string,
): Effect.Effect<AgentBrowserProfile, TeamAdminRequestError> {
  return adminCall(() => request("POST", BROWSER_PROFILES_ROUTES.agent, decodeAgentBrowserProfile, { agentId }));
}

export function updateHostAgentBrowserProfile(
  request: TeamApiRequest,
  input: UpdateAgentBrowserProfileInput,
): Effect.Effect<AgentBrowserProfile, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", BROWSER_PROFILES_ROUTES.updateAgent, decodeAgentBrowserProfile, {
      agentId: input.agentId,
      profile: { ...input.profile },
    }),
  );
}

export function listHostBrowserProxies(
  request: TeamApiRequest,
): Effect.Effect<BrowserProxyList, TeamAdminRequestError> {
  return adminCall(() => request("POST", BROWSER_PROXIES_ROUTES.list, decodeBrowserProxyList, {}));
}

export function saveHostBrowserProxy(
  request: TeamApiRequest,
  input: SaveBrowserProxyInput,
): Effect.Effect<BrowserProxySummary, TeamAdminRequestError> {
  return adminCall(() => request("POST", BROWSER_PROXIES_ROUTES.save, decodeBrowserProxySummary, { ...input }));
}

export function deleteHostBrowserProxy(
  request: TeamApiRequest,
  input: DeleteBrowserProxyInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", BROWSER_PROXIES_ROUTES.delete, ignoreResponse, {
      proxyId: input.proxyId,
      profileIds: [...input.profileIds],
    }),
  );
}

export function setHostBrowserProfileProxy(
  request: TeamApiRequest,
  input: SetBrowserProfileProxyInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", BROWSER_PROXIES_ROUTES.profile, ignoreResponse, { ...input }));
}

export function messagingConnectorOverview(
  request: TeamApiRequest,
  input: HostMessagingPlatformInput,
): Effect.Effect<MessagingOverview, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", CONNECTORS_ROUTES.messagingOverview, decodeHostMessagingOverview, { ...input }),
  );
}

export interface MessagingConnectorPage {
  url: string | null;
  nonce: string | null;
}
function decodeMessagingPage(value: unknown): MessagingConnectorPage {
  const record = decodeRecord(value, "messaging page");
  return { url: nullableString(record, "url"), nonce: nullableString(record, "nonce") };
}
export function messagingConnectorConnect(
  request: TeamApiRequest,
  input: HostMessagingConnectInput,
): Effect.Effect<MessagingConnectorPage, TeamAdminRequestError> {
  return adminCall(() => request("POST", CONNECTORS_ROUTES.messagingConnect, decodeMessagingPage, { ...input }));
}
export function messagingConnectorReconnect(
  request: TeamApiRequest,
  input: HostMessagingWorkspaceInput,
): Effect.Effect<MessagingConnectorPage, TeamAdminRequestError> {
  return adminCall(() => request("POST", CONNECTORS_ROUTES.messagingReconnect, decodeMessagingPage, { ...input }));
}

export function messagingConnectorComplete(
  request: TeamApiRequest,
  input: { platform: "slack" | "discord"; nonce: string; grant: string },
): Effect.Effect<boolean, TeamAdminRequestError> {
  return adminCall(() =>
    request(
      "POST",
      CONNECTORS_ROUTES.messagingComplete,
      (value) => requiredBoolean(decodeRecord(value, "messaging install"), "accepted"),
      { ...input },
    ),
  );
}
export function messagingConnectorDisconnect(
  request: TeamApiRequest,
  input: HostMessagingWorkspaceInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", CONNECTORS_ROUTES.messagingDisconnect, ignoreResponse, { ...input }));
}
export function messagingConnectorSetEnabled(
  request: TeamApiRequest,
  input: HostSetMessagingEnabledInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", CONNECTORS_ROUTES.messagingEnabled, ignoreResponse, { ...input }));
}

function decodeMessagingOrchestrator(value: unknown): AddMessagingOrchestratorResult {
  if (!isAddMessagingOrchestratorResult(value)) throw new Error("Invalid messaging orchestrator response.");
  return value;
}
export function messagingConnectorAddOrchestrator(
  request: TeamApiRequest,
  input: HostAddMessagingOrchestratorInput,
): Effect.Effect<AddMessagingOrchestratorResult, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", CONNECTORS_ROUTES.messagingOrchestrator, decodeMessagingOrchestrator, { ...input }),
  );
}

function decodeDiscordAccess(value: unknown): DiscordAccess {
  if (!isDiscordAccess(value)) throw new Error("Invalid Discord access response.");
  return value;
}

export function discordAccess(
  request: TeamApiRequest,
  input: HostDiscordAccessInput,
): Effect.Effect<DiscordAccess, TeamAdminRequestError> {
  return adminCall(() => request("POST", DISCORD_ACCESS_ROUTES.access, decodeDiscordAccess, { ...input }));
}

export function discordRoles(
  request: TeamApiRequest,
  input: HostDiscordAccessInput,
): Effect.Effect<DiscordRoleList, TeamAdminRequestError> {
  return adminCall(() =>
    request(
      "POST",
      DISCORD_ACCESS_ROUTES.roles,
      (value) => {
        if (!isDiscordRoleList(value)) throw new Error("Invalid Discord roles response.");
        return value;
      },
      { ...input },
    ),
  );
}

export function setDiscordAccess(
  request: TeamApiRequest,
  input: HostSetDiscordAccessInput,
): Effect.Effect<DiscordAccess, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", DISCORD_ACCESS_ROUTES.update, decodeDiscordAccess, {
      workspaceId: input.workspaceId,
      allowedRoles: input.allowedRoles.map((role) => ({ id: role.id, name: role.name })),
    }),
  );
}

export function whatsappConnectorOverview(
  request: TeamApiRequest,
): Effect.Effect<WhatsAppOverview, TeamAdminRequestError> {
  return adminCall(() => request("POST", WHATSAPP_CONNECTOR_ROUTES.overview, decodeHostWhatsAppOverview, {}));
}

export function whatsappConnectorStartLink(
  request: TeamApiRequest,
  input: StartWhatsAppLinkInput,
): Effect.Effect<WhatsAppLinkState, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", WHATSAPP_CONNECTOR_ROUTES.linkStart, decodeHostWhatsAppLinkState, { ...input }),
  );
}

export function whatsappConnectorLinkState(
  request: TeamApiRequest,
): Effect.Effect<WhatsAppLinkState, TeamAdminRequestError> {
  return adminCall(() => request("POST", WHATSAPP_CONNECTOR_ROUTES.linkState, decodeHostWhatsAppLinkState, {}));
}

export function whatsappConnectorCancelLink(request: TeamApiRequest): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", WHATSAPP_CONNECTOR_ROUTES.linkCancel, ignoreResponse, {}));
}

export function whatsappConnectorDisconnect(
  request: TeamApiRequest,
  input: MessagingWorkspaceInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", WHATSAPP_CONNECTOR_ROUTES.disconnect, ignoreResponse, { ...input }));
}

export function whatsappConnectorReconnect(
  request: TeamApiRequest,
  input: MessagingWorkspaceInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", WHATSAPP_CONNECTOR_ROUTES.reconnect, ignoreResponse, { ...input }));
}

export function whatsappConnectorSetEnabled(
  request: TeamApiRequest,
  input: SetMessagingEnabledInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", WHATSAPP_CONNECTOR_ROUTES.enabled, ignoreResponse, { ...input }));
}

export function whatsappConnectorAddOrchestrator(
  request: TeamApiRequest,
): Effect.Effect<AddMessagingOrchestratorResult, TeamAdminRequestError> {
  return adminCall(() => request("POST", WHATSAPP_CONNECTOR_ROUTES.orchestrator, decodeMessagingOrchestrator, {}));
}

export function whatsappConnectorGroups(
  request: TeamApiRequest,
  input: MessagingWorkspaceInput,
): Effect.Effect<WhatsAppGroupList, TeamAdminRequestError> {
  return adminCall(() =>
    request(
      "POST",
      WHATSAPP_CONNECTOR_ROUTES.groups,
      (value) => {
        if (!isWhatsAppGroupList(value)) throw new Error("Invalid WhatsApp groups response.");
        return value;
      },
      { ...input },
    ),
  );
}

export function whatsappConnectorAddSender(
  request: TeamApiRequest,
  input: WhatsAppSenderInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", WHATSAPP_CONNECTOR_ROUTES.senderAdd, ignoreResponse, {
      workspaceId: input.workspaceId,
      sender: { id: input.sender.id, kind: input.sender.kind, name: input.sender.name },
    }),
  );
}

export function whatsappConnectorRemoveSender(
  request: TeamApiRequest,
  input: RemoveWhatsAppSenderInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", WHATSAPP_CONNECTOR_ROUTES.senderRemove, ignoreResponse, { ...input }));
}

export function whatsappConnectorAnswerRequest(
  request: TeamApiRequest,
  input: AnswerWhatsAppRequestInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", WHATSAPP_CONNECTOR_ROUTES.requestAnswer, ignoreResponse, { ...input }));
}

export function whatsappConnectorSetOwnNumber(
  request: TeamApiRequest,
  input: SetWhatsAppOwnNumberInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", WHATSAPP_CONNECTOR_ROUTES.ownNumber, ignoreResponse, { ...input }));
}

export function whatsappConnectorWorkingMessages(
  request: TeamApiRequest,
): Effect.Effect<WhatsAppWorkingMessageList, TeamAdminRequestError> {
  return adminCall(() =>
    request(
      "POST",
      WHATSAPP_WORKING_MESSAGE_ROUTES.list,
      (value) => {
        if (!isWhatsAppWorkingMessageList(value)) throw new Error("Invalid WhatsApp working message response.");
        return value;
      },
      {},
    ),
  );
}

export function whatsappConnectorSetWorkingMessage(
  request: TeamApiRequest,
  input: SetWhatsAppWorkingMessageInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", WHATSAPP_WORKING_MESSAGE_ROUTES.update, ignoreResponse, { ...input }));
}

export function whatsappConnectorStatusReactions(
  request: TeamApiRequest,
): Effect.Effect<WhatsAppStatusReactionsList, TeamAdminRequestError> {
  return adminCall(() =>
    request(
      "POST",
      WHATSAPP_STATUS_REACTIONS_ROUTES.list,
      (value) => {
        if (!isWhatsAppStatusReactionsList(value)) throw new Error("Invalid WhatsApp status reactions response.");
        return value;
      },
      {},
    ),
  );
}

export function whatsappConnectorSetStatusReactions(
  request: TeamApiRequest,
  input: SetWhatsAppStatusReactionsInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", WHATSAPP_STATUS_REACTIONS_ROUTES.update, ignoreResponse, { ...input }));
}
