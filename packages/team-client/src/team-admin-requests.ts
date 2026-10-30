import {
  type AgentAccessChange,
  type AgentAccessSnapshot,
  type AgentNotificationLevelsSnapshot,
  type AgentSessionSettings,
  type DiscordAccess,
  type DiscordRoleList,
  decodeAgentAccessSnapshot,
  type HiddenAgentsSnapshot,
  type HostDiscordAccessInput,
  type HostSetDiscordAccessInput,
  isAgentNotificationLevelsSnapshot,
  isAgentSessionSettings,
  isDiscordAccess,
  isDiscordRoleList,
  isHiddenAgentsSnapshot,
  type ResetAgentSessionSettingInput,
  type SetAgentHiddenInput,
  type SetAgentNotificationLevelInput,
  type SetAgentSessionSettingInput,
  type SetOwnServerNotificationLevelInput,
} from "@openbot/contracts/ipc";
import { AGENT_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/agent-access-v1";
import { AGENT_HIDDEN_ROUTES } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import { AGENT_MEMORY_LIMIT_ROUTES } from "@openbot/contracts/team-protocol/agent-memory-limit-v1";
import { AGENT_NOTIFICATION_LEVELS_ROUTES } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { AGENT_SESSION_SETTINGS_ROUTES } from "@openbot/contracts/team-protocol/agent-session-settings-v1";
import type { CUSTOM_PROVIDER_HARNESS_ROUTES } from "@openbot/contracts/team-protocol/custom-provider-harness-v1";
import { DISCORD_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/discord-access-v1";
import { HOST_MEMBER_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-member-update-v1";
import { HOST_RELEASE_ROUTES } from "@openbot/contracts/team-protocol/host-release-v1";
import { HOST_TIMEZONE_ROUTES } from "@openbot/contracts/team-protocol/host-timezone-v1";
import { MEMORY_REVIEW_ROUTES } from "@openbot/contracts/team-protocol/memory-review-v1";
import { PROMPT_CACHE_TTL_ROUTES } from "@openbot/contracts/team-protocol/prompt-cache-ttl-v1";
import { PROVIDER_DEFAULT_ROUTES } from "@openbot/contracts/team-protocol/provider-default-v1";
import type { PROVIDERS_V5_ROUTES } from "@openbot/contracts/team-protocol/providers-v5";
import { PROVIDERS_V8_ROUTES } from "@openbot/contracts/team-protocol/providers-v8";
// Admin requests to one host: agent settings and skills, shared tables, agent share links, the server name and logo,
// the server timezone, the agent memory limit, the memory review, the prompt cache time, the default provider, the Discord roles that can use OpenBot, the app update, MCP servers, storage, hosted sites and providers.
//
// The desktop sends the same routes from the main process. The web client and the mobile app send
// them through their own transport, so the path, body and decoding of each request are here once.
// The host answers only an owner or admin; a member gets a refusal, which the transport rejects.

import { type AgentProviderRef, isAgentProviderRef, type ManagedProviderId } from "@openbot/contracts/agent-providers";
import { parseHostedSiteList } from "@openbot/contracts/hosted-sites";
import {
  type AccountUsage,
  type AddedAgent,
  type AddMessagingOrchestratorResult,
  type AgentAdminSettings,
  type AgentModelId,
  type AgentProviderId,
  type AgentStatus,
  type AgentTemplatePreview,
  type AgentTemplatePublication,
  assertStorageUsageScope,
  type BitwardenConnectorStatus,
  type BitwardenHostConnectInput,
  type CancelMcpSignInInput,
  type ClearStorageInput,
  type ConnectProviderAccountInput,
  type CustomProviderResult,
  type CustomProviderSummary,
  type DeleteCustomProviderInput,
  type DeleteStoredFileInput,
  decodeAgentAdminSettings,
  decodeCustomProviderResult,
  decodeCustomProviderSummaries,
  decodeHostAddedAgent,
  decodeHostAgentMemoryLimit,
  decodeHostAgentTemplatePreview,
  decodeHostAgentTemplatePublication,
  decodeHostBitwardenConnectorStatus,
  decodeHostGitHubConnectorRepositories,
  decodeHostGitHubConnectorStatus,
  decodeHostMemoryReview,
  decodeHostMessagingOverview,
  decodeHostOnePasswordConnectorStatus,
  decodeHostProviderAccounts,
  decodeHostProviderAccountUsage,
  decodeHostReleaseStatus,
  decodeHostTimezoneSettings,
  decodeHostUpdateStatus,
  decodeHostVaultImport,
  decodeHostVaultState,
  decodeInstalledSkills,
  decodeMcpServerConfigs,
  decodeMcpSignInAppState,
  decodeMcpSignInStates,
  decodeMcpSignInStatus,
  decodeMcpTestResult,
  decodePromptCacheTtlSetting,
  decodeProviderApiKeyStatus,
  decodeProviderCodeLoginStart,
  decodeProviderHostSignInStatus,
  decodeProviderRuntimeSnapshot,
  decodeProviderRuntimeSnapshotV8,
  decodeProviderUsageResetOutcome,
  decodeProviderUsageResets,
  decodeRoutineResultConnectionOptions,
  decodeRoutineResultDestinationAnswer,
  decodeSignInRelayFlow,
  decodeSignInRelayStatus,
  decodeStorageUsage,
  type GetStorageUsageInput,
  type GitHubConnectorRepositories,
  type HostAddMessagingOrchestratorInput,
  type HostAgentMemoryLimit,
  type HostedSiteList,
  type HostGitHubConnectorStatus,
  type HostMemoryReview,
  type HostMessagingConnectInput,
  type HostMessagingPlatformInput,
  type HostMessagingWorkspaceInput,
  type HostProviderAccounts,
  type HostReleaseStatus,
  type HostSetMessagingEnabledInput,
  type HostTimezoneSettings,
  type HostUpdateSettingsChange,
  type HostUpdateStatus,
  type InstallAgentTemplateInput,
  type InstalledSkill,
  type InstallMarketplaceAgentInput,
  type InstallSkillInput,
  isAddMessagingOrchestratorResult,
  isAgentModel,
  isAgentStatus,
  isSharedTable,
  type McpServerConfig,
  type McpSignInAppInput,
  type McpSignInAppState,
  type McpSignInState,
  type McpSignInStatus,
  type McpTestResult,
  type MessagingOverview,
  type OnePasswordConnectorStatus,
  type OnePasswordHostConnectInput,
  type PromptCacheTtl,
  type PromptCacheTtlSetting,
  type ProviderCodeLoginStart,
  type ProviderHostSignInStatus,
  type ProviderRuntimeSnapshot,
  type ProviderUsageResetOutcome,
  type ProviderUsageResets,
  type PublishAgentTemplateInput,
  type RemoveMcpServerInput,
  type RemoveProviderAccountInput,
  type RenameProviderAccountInput,
  type ResetProviderUsageInput,
  type RoutineResultConnectionOption,
  type RoutineResultDestination,
  type RoutineResultRoutineInput,
  type SaveCustomProviderInput,
  type SaveMcpServerInput,
  type SaveMcpSignInAppInput,
  type SetAgentProviderAccountInput,
  type SetEnabledSkillInput,
  type SetMcpServerEnabledInput,
  type SetProviderApiKeyInput,
  type SetRoutineResultDestinationInput,
  type SharedTable,
  type SignInRelayStatus,
  type SignOutMcpServerInput,
  type SubmitProviderCodeLoginInput,
  type TestMcpServerInput,
  type UninstallSkillInput,
  type UpdateAgentAdminSettingsInput,
  type UpdateHostIdentityInput,
  type UpdateRestartMode,
  type VaultHostImportResult,
  type VaultSaveInput,
  type VaultState,
} from "@openbot/contracts/ipc";
import { decodeRecord, guardedListDecoder, nullableString, requiredBoolean } from "@openbot/contracts/ipc-decoding";
import {
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
  type WebhookSecret,
  type WebhookTestResult,
} from "@openbot/contracts/ipc-events";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_INSTALL_ROUTES } from "@openbot/contracts/team-protocol/agent-install-v1";
import { AGENT_PUBLISH_IMAGE_BYTES, AGENT_PUBLISH_ROUTES } from "@openbot/contracts/team-protocol/agent-publish-v1";
import { AGENT_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/agent-update-v1";
import { BITWARDEN_CONNECTOR_ROUTES } from "@openbot/contracts/team-protocol/bitwarden-connector-v1";
import { CONNECTORS_ROUTES } from "@openbot/contracts/team-protocol/connectors-v1";
import { EVENTS_ROUTES } from "@openbot/contracts/team-protocol/events-v1";
import { HOST_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/host-admin-v1";
import { HOST_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-update-v1";
import { HOSTED_SITES_ROUTES } from "@openbot/contracts/team-protocol/hosted-sites-v1";
import { MCP_SIGN_IN_APP_ROUTES } from "@openbot/contracts/team-protocol/mcp-sign-in-app-v1";
import { MCP_SIGN_IN_ROUTES } from "@openbot/contracts/team-protocol/mcp-sign-in-v1";
import { MCP_ROUTES } from "@openbot/contracts/team-protocol/mcp-v1";
import { ONEPASSWORD_CONNECTOR_ROUTES } from "@openbot/contracts/team-protocol/onepassword-connector-v1";
import type {
  ProviderAccountRelay,
  ProviderAccountRelayProvider,
} from "@openbot/contracts/team-protocol/provider-account-relays";
import { PROVIDER_ACCOUNTS_ROUTES } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { PROVIDER_HOST_SIGN_IN_ROUTES } from "@openbot/contracts/team-protocol/provider-host-sign-in-v1";
import { PROVIDER_SIGN_OUT_ROUTES } from "@openbot/contracts/team-protocol/provider-sign-out-v1";
import { PROVIDER_USAGE_RESET_ROUTES } from "@openbot/contracts/team-protocol/provider-usage-reset-v1";
import { PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import type { PROVIDERS_RUNTIMES_V2_ROUTES } from "@openbot/contracts/team-protocol/providers-v2";
import { PROVIDERS_SIGN_IN_V3_ROUTES } from "@openbot/contracts/team-protocol/providers-v3";
import type { PROVIDERS_V4_ROUTES } from "@openbot/contracts/team-protocol/providers-v4";
import { ROUTINE_RECOVERY_ROUTES } from "@openbot/contracts/team-protocol/routine-recovery-v1";
import { ROUTINE_RESULTS_ROUTES } from "@openbot/contracts/team-protocol/routine-results-v1";
import { SHARED_TABLES_ROUTES } from "@openbot/contracts/team-protocol/shared-tables-v1";
import { type SIGN_IN_RELAY_PROVIDERS, SIGN_IN_RELAY_ROUTES } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { SKILLS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { VAULT_IMPORT_ROUTES } from "@openbot/contracts/team-protocol/vault-import-v1";
import { VAULT_ROUTES } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_ROUTES } from "@openbot/contracts/team-protocol/vault-v2";
import { WEBHOOK_TESTS_ROUTES } from "@openbot/contracts/team-protocol/webhook-tests-v1";
import { Effect, Schema } from "effect";
import { bytesToBase64 } from "./base64";
import type { TeamApiRequest } from "./team-api-requests";

export class TeamAdminRequestError extends Schema.TaggedError<TeamAdminRequestError>()("TeamAdminRequestError", {
  cause: Schema.Defect(),
}) {}

const adminCall = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new TeamAdminRequestError({ cause }),
  });

// The route codec has already checked the empty reply.
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

/** Only ids cross the wire: the host downloads the skill with its own account. */
export function installAgentSkill(
  request: TeamApiRequest,
  input: InstallSkillInput,
): Effect.Effect<InstalledSkill, TeamAdminRequestError> {
  return adminCall(() => request("POST", SKILLS_ADMIN_ROUTES.install, decodeInstalledSkill, { ...input }));
}

/**
 * Adds a new agent from a marketplace listing, or updates one added from it. Only ids cross the wire:
 * the host downloads the listing with its own account. agent-install-v1 only adds, so an update goes
 * to agent-update-v1 rather than as an add that would make a copy.
 */
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

/** A shared agent template on the host. The host reads the template again and refuses a newer version. */
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

/** What the host would publish for one of its agents, and its link when it is published. */
export function previewAgentTemplate(
  request: TeamApiRequest,
  agentId: string,
): Effect.Effect<AgentTemplatePreview, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_PUBLISH_ROUTES.preview, decodeHostAgentTemplatePreview, { agentId }));
}

/** The host publishes with its own account. A card too large for the wire is left out, as one that cannot be drawn. */
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

/** With `recovery`, for a host with `routine-recovery-v1`, the routines carry `missedPolicy`. */
export function listEventRoutines(
  request: TeamApiRequest,
  input: ListEventRoutinesInput,
  recovery = false,
): Effect.Effect<EventRoutine[], TeamAdminRequestError> {
  const path = recovery ? ROUTINE_RECOVERY_ROUTES.listRoutines : EVENTS_ROUTES.listRoutines;
  return adminCall(() => request("POST", path, decodeEventRoutines, eventBody(input)));
}

/**
 * The result has the new signing secret only when the routine became a webhook routine. With
 * `recovery`, for a host with `routine-recovery-v1`, the host saves `missedPolicy`.
 */
export function saveEventRoutine(
  request: TeamApiRequest,
  input: SaveEventRoutineInput,
  recovery = false,
): Effect.Effect<SaveEventRoutineResult, TeamAdminRequestError> {
  const path = recovery ? ROUTINE_RECOVERY_ROUTES.saveRoutine : EVENTS_ROUTES.saveRoutine;
  return adminCall(() => request("POST", path, decodeSaveEventRoutineResult, eventBody(input)));
}

/** A routine's newest runs with its missed occurrences. Only a host with `routine-recovery-v1` answers it. */
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

/** Asks the host to send one signed test event to the routine. Only a host with `webhook-tests-v1` answers it. */
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

/** An absent field stays unchanged; a `null` logo removes it. */
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

/** The host starts the check and answers at once; read the status again for the outcome. */
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

/** A second start replaces the restart mode of the first, which is how an admin skips the wait. */
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

/** `null` returns the server to the system zone of its computer. */
export function setHostTimezone(
  request: TeamApiRequest,
  timezone: string | null,
): Effect.Effect<HostTimezoneSettings, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOST_TIMEZONE_ROUTES.update, decodeHostTimezoneSettings, { timezone }));
}

/** The host's enabled messaging connections with their places. Only a host with `routine-results-v1` answers it. */
export function listRoutineResultOptions(
  request: TeamApiRequest,
): Effect.Effect<RoutineResultConnectionOption[], TeamAdminRequestError> {
  return adminCall(() => request("POST", ROUTINE_RESULTS_ROUTES.options, decodeRoutineResultConnectionOptions, {}));
}

/** The place where an agent routine sends its answers, or null when it sends none. */
export function getRoutineResultDestination(
  request: TeamApiRequest,
  input: RoutineResultRoutineInput,
): Effect.Effect<RoutineResultDestination | null, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", ROUTINE_RESULTS_ROUTES.destination, decodeRoutineResultDestinationAnswer, eventBody(input)),
  );
}

/** Null `destination` stops sending. */
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

/** The host refuses a value that its snapshot does not list in `choices`. */
export function setHostAgentMemoryLimit(
  request: TeamApiRequest,
  limit: number,
): Effect.Effect<HostAgentMemoryLimit, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_MEMORY_LIMIT_ROUTES.update, decodeHostAgentMemoryLimit, { limit }));
}

export function getHostMemoryReview(request: TeamApiRequest): Effect.Effect<HostMemoryReview, TeamAdminRequestError> {
  return adminCall(() => request("POST", MEMORY_REVIEW_ROUTES.settings, decodeHostMemoryReview, {}));
}

/** `0` turns the review off. The host refuses a value that its snapshot does not list in `choices`. */
export function setHostMemoryReview(
  request: TeamApiRequest,
  interval: number,
): Effect.Effect<HostMemoryReview, TeamAdminRequestError> {
  return adminCall(() => request("POST", MEMORY_REVIEW_ROUTES.update, decodeHostMemoryReview, { interval }));
}

/** The roles of the host (`agent-access-v1`). A member reads only `mine`. */
export function getHostAgentAccess(request: TeamApiRequest): Effect.Effect<AgentAccessSnapshot, TeamAdminRequestError> {
  return adminCall(() => request("POST", AGENT_ACCESS_ROUTES.read, decodeAgentAccessSnapshot, {}));
}

/** Replaces the roles. The host answers 409 when another admin saved after `change.revision`. */
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

/** `provider-default-v1`: the provider that a new agent of the host starts on. A newer host can name a provider this build does not know. */
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

/** A null model is the provider's own default model. */
export function setHostProviderDefault(
  request: TeamApiRequest,
  provider: AgentProviderId,
  model: AgentModelId | null,
): Effect.Effect<HostProviderDefault, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", PROVIDER_DEFAULT_ROUTES.update, decodeHostProviderDefault, { provider, model }),
  );
}

/** The one MCP read route, and the only one the host answers to a GET. */
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

/** The host makes the connection with its own stored credentials, and opens no browser. */
export function testMcpServer(
  request: TeamApiRequest,
  input: TestMcpServerInput,
): Effect.Effect<McpTestResult, TeamAdminRequestError> {
  return adminCall(() => request("POST", MCP_ROUTES.test, decodeMcpTestResult, { config: mcpConfig(input.config) }));
}
/** The host opens the sign-in page in its own browser and answers at once; `mcpSignInStatus` follows it. */
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

/**
 * A relayed sign-in (`sign-in-relay-v1`): the host starts it and opens no page. The client opens the
 * page in the user's own browser and sends the query of the callback back with `completeSignInRelay`.
 */
export function startMcpSignInRelay(
  request: TeamApiRequest,
  input: TestMcpServerInput,
): Effect.Effect<{ flowId: string }, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", SIGN_IN_RELAY_ROUTES.mcpStart, decodeSignInRelayFlow, { config: mcpConfig(input.config) }),
  );
}

/** A relayed sign-in of a provider's CLI on the host (`sign-in-relay-v1`). */
export function startProviderSignInRelay(
  request: TeamApiRequest,
  provider: (typeof SIGN_IN_RELAY_PROVIDERS)[number],
): Effect.Effect<{ flowId: string }, TeamAdminRequestError> {
  return adminCall(() => request("POST", SIGN_IN_RELAY_ROUTES.providerStart, decodeSignInRelayFlow, { provider }));
}

/** A relayed sign-in of an account after the first, on the route of the host's account relay. */
export function startProviderAccountSignInRelay(
  request: TeamApiRequest,
  relay: ProviderAccountRelay,
  input: { provider: ProviderAccountRelayProvider; accountId: string | null },
): Effect.Effect<{ flowId: string }, TeamAdminRequestError> {
  return adminCall(() => request("POST", relay.start, decodeSignInRelayFlow, { ...input }));
}

/** A relayed sign-in of a link that an agent of the host printed (`sign-in-relay-v1`). */
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

/** `query` holds a grant. It goes only to the host, on the encrypted Team channel. */
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

/** The client secret goes to the host once; the answer says only whether one is saved. */
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
  const result = yield* adminCall(() => request("POST", STORAGE_ROUTES.usage, decodeStorageUsage, { ...input }));
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

function decodeHostedSiteList(value: unknown): HostedSiteList {
  const list = parseHostedSiteList(value);
  if (!list) throw new Error("The host returned an invalid site list.");
  return list;
}

/** Any member can read the sites of the server. */
export function listHostedSites(request: TeamApiRequest): Effect.Effect<HostedSiteList, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOSTED_SITES_ROUTES.list, decodeHostedSiteList, {}));
}

export function deleteHostedSite(request: TeamApiRequest, siteId: string): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOSTED_SITES_ROUTES.remove, ignoreResponse, { siteId }));
}

/**
 * The sign-in routes of a host: `providers-v4` signs in Codex, Claude, Grok, Cursor and Cline,
 * `providers-v3` Codex, Claude and Grok, and `providers-v1` Codex only. The caller picks by the
 * host's capabilities.
 */
export type ProviderCodeLoginRoutes =
  | typeof PROVIDERS_V8_ROUTES
  | typeof PROVIDERS_V4_ROUTES
  | typeof PROVIDERS_SIGN_IN_V3_ROUTES
  | typeof PROVIDERS_ADMIN_ROUTES;

/** The verification URL is https, or the reply is refused. */
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

/**
 * `providers-v3`, `providers-v4` or `providers-v8`. The code is a credential: it goes in the body, and
 * no reply carries it.
 */
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
/** `provider-host-sign-in-v1`: the host opens the sign-in page in its own browser. */
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

/**
 * `provider-accounts-v1`: the accounts of the host's providers, and the agents on an account after
 * the first. The host's status, agent list and usage do not carry them.
 */
export function listProviderAccounts(
  request: TeamApiRequest,
): Effect.Effect<HostProviderAccounts, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_ACCOUNTS_ROUTES.list, decodeHostProviderAccounts, {}));
}

/** The readings of the accounts after the first. */
export function providerAccountUsage(request: TeamApiRequest): Effect.Effect<AccountUsage, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_ACCOUNTS_ROUTES.usage, decodeHostProviderAccountUsage, {}));
}

/** Opens the account's sign-in page in the host's browser, as `startProviderHostSignIn` does. */
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

/** `provider-usage-reset-v1`: the usage reset credits of each connected account of a provider on the host. */
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

/** Spends one usage reset credit of an account on the host. */
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

/** `provider-sign-out-v1`: signs the host's own sign-in of a provider out. */
export function signOutProvider(
  request: TeamApiRequest,
  provider: AgentProviderId,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_SIGN_OUT_ROUTES.signOut, ignoreResponse, { provider }));
}

/** Moves the agent to an account of its provider; null is the provider's own sign-in. */
export function setAgentProviderAccount(
  request: TeamApiRequest,
  input: SetAgentProviderAccountInput,
): Effect.Effect<void, TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDER_ACCOUNTS_ROUTES.agent, ignoreResponse, { ...input }));
}

/** Ends a relayed provider sign-in on the host, and answers the host's status after it. */
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

/**
 * The runtime routes of a host: `providers-v8` lists every runtime as a row, `providers-v4` includes
 * Cursor and Cline, `providers-v2` Gemini, and `providers-v1` none of them. The caller picks by the
 * host's capabilities.
 */
export type ProviderRuntimeRoutes =
  | typeof PROVIDERS_V8_ROUTES
  | typeof PROVIDERS_V5_ROUTES
  | typeof PROVIDERS_V4_ROUTES
  | typeof PROVIDERS_RUNTIMES_V2_ROUTES
  | typeof PROVIDERS_ADMIN_ROUTES;

/** `providers-v8` lists the runtimes as rows; the older route sets give the IPC record. */
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
  provider: ManagedProviderId,
  routes: ProviderRuntimeRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<ProviderRuntimeSnapshot, TeamAdminRequestError> {
  return adminCall(() => request("POST", routes.runtimesDownload, runtimeDecoder(routes), { provider }));
}

export function cancelProviderRuntime(
  request: TeamApiRequest,
  provider: ManagedProviderId,
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

/**
 * The custom endpoint routes of a host: `custom-provider-harness-v1` names the harness of each
 * endpoint, and `providers-v1` does not. The caller picks by the host's capabilities.
 */
export type CustomProviderRoutes = typeof CUSTOM_PROVIDER_HARNESS_ROUTES | typeof PROVIDERS_ADMIN_ROUTES;

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
    }),
  );
}

export function deleteCustomProvider(
  request: TeamApiRequest,
  input: DeleteCustomProviderInput,
  routes: CustomProviderRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<CustomProviderResult, TeamAdminRequestError> {
  return adminCall(() => request("POST", routes.customDelete, decodeCustomProviderResult, { id: input.id }));
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

function decodeHiddenAgents(value: unknown): HiddenAgentsSnapshot {
  if (!isHiddenAgentsSnapshot(value)) throw new Error("Invalid hidden agents response.");
  return value;
}
/** Any member may read and change the hidden agents of a host that advertises `agent-hidden-v1`. */
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

function decodeAgentNotificationLevels(value: unknown): AgentNotificationLevelsSnapshot {
  if (!isAgentNotificationLevelsSnapshot(value)) throw new Error("Invalid agent notification levels response.");
  return value;
}
/** The member's own level for each agent, on a host that advertises `agent-notification-levels-v1`. */
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

/** The member's own level of the whole server, for all of their devices. `null` gives each device its own level. */
export function setOwnServerNotificationLevel(
  request: TeamApiRequest,
  level: SetOwnServerNotificationLevelInput["level"],
): Effect.Effect<AgentNotificationLevelsSnapshot, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.server, decodeAgentNotificationLevels, { level }),
  );
}

type GitHubConnectorStatusRoute = Exclude<keyof typeof CONNECTORS_ROUTES, "githubRepositories">;

/**
 * The host's GitHub connection (`connectors-v1`): read it, connect, cancel or disconnect. The host
 * opens no page; the answer names the pages that the client opens.
 */
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

/**
 * The host's 1Password connection (`onepassword-connector-v1`): read it, connect with a service
 * account token, or disconnect. No answer carries the token.
 */
export function onePasswordConnectorRequest(
  request: TeamApiRequest,
  route: keyof typeof ONEPASSWORD_CONNECTOR_ROUTES,
  body: OnePasswordHostConnectInput | Record<string, never> = {},
): Effect.Effect<OnePasswordConnectorStatus, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", ONEPASSWORD_CONNECTOR_ROUTES[route], decodeHostOnePasswordConnectorStatus, { ...body }),
  );
}

/**
 * The host's Bitwarden connection (`bitwarden-connector-v1`): read it, connect with an API key and
 * the master password, or disconnect. No answer carries them.
 */
export function bitwardenConnectorRequest(
  request: TeamApiRequest,
  route: keyof typeof BITWARDEN_CONNECTOR_ROUTES,
  body: BitwardenHostConnectInput | Record<string, never> = {},
): Effect.Effect<BitwardenConnectorStatus, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", BITWARDEN_CONNECTOR_ROUTES[route], decodeHostBitwardenConnectorStatus, { ...body }),
  );
}

/** The routes of `vault-v2` when the host serves it, else of `vault-v1`, which has no API keys. */
function vaultRoutes(v2: boolean) {
  return v2 ? VAULT_V2_ROUTES : VAULT_ROUTES;
}

/**
 * The host's Vault (`vault-v2`, or `vault-v1` without API keys). No list item carries a password, a
 * card number, a security code or an API key.
 */
export function listHostVault(request: TeamApiRequest, v2: boolean): Effect.Effect<VaultState, TeamAdminRequestError> {
  return adminCall(() => request("POST", vaultRoutes(v2).list, decodeHostVaultState, {}));
}

/** Adds or changes one item of the host's Vault. A null secret keeps the saved one; a new one goes to the host once. */
export function saveHostVaultItem(
  request: TeamApiRequest,
  input: VaultSaveInput,
  v2: boolean,
): Effect.Effect<VaultState, TeamAdminRequestError> {
  // Only a card has approved sites, and an absent list keeps them all.
  const { fillSites, ...item } = { fillSites: undefined, ...input };
  return adminCall(() =>
    request(
      "POST",
      vaultRoutes(v2).save,
      decodeHostVaultState,
      fillSites === undefined ? item : { ...item, fillSites },
    ),
  );
}

export function deleteHostVaultItem(
  request: TeamApiRequest,
  id: string,
  v2: boolean,
): Effect.Effect<VaultState, TeamAdminRequestError> {
  return adminCall(() => request("POST", vaultRoutes(v2).delete, decodeHostVaultState, { id }));
}

/** Adds the logins of a CSV password export (`vault-import-v1`). The answer has only the counts. */
export function importHostVaultCsv(
  request: TeamApiRequest,
  csv: string,
): Effect.Effect<VaultHostImportResult, TeamAdminRequestError> {
  return adminCall(() => request("POST", VAULT_IMPORT_ROUTES.import, decodeHostVaultImport, { csv }));
}

/** The host's Slack workspaces, Discord servers or Telegram chats (`connectors-v1`). */
export function messagingConnectorOverview(
  request: TeamApiRequest,
  input: HostMessagingPlatformInput,
): Effect.Effect<MessagingOverview, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", CONNECTORS_ROUTES.messagingOverview, decodeHostMessagingOverview, { ...input }),
  );
}

/** The platform's page that the client opens. `url` is null when a reconnect needs no page. */
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

/** Sends the sealed grant of a Slack or Discord install to the host that started it. */
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
/** The orchestrator starts on the host's default provider and model. */
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

/** Which roles can use OpenBot in one Discord server of the host (`discord-access-v1`). */
export function discordAccess(
  request: TeamApiRequest,
  input: HostDiscordAccessInput,
): Effect.Effect<DiscordAccess, TeamAdminRequestError> {
  return adminCall(() => request("POST", DISCORD_ACCESS_ROUTES.access, decodeDiscordAccess, { ...input }));
}

/** The roles of one Discord server of the host, to choose from. The host reads them from Discord. */
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
