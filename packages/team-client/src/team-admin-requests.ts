import { HOST_MEMBER_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-member-update-v1";
import { HOST_RELEASE_ROUTES } from "@openbot/contracts/team-protocol/host-release-v1";
// Admin requests to one host: agent settings and skills, shared tables, agent share links, the server name and logo,
// the app update, MCP servers, storage, hosted sites and providers.
//
// The desktop sends the same routes from the main process. The web client and the mobile app send
// them through their own transport, so the path, body and decoding of each request are here once.
// The host answers only an owner or admin; a member gets a refusal, which the transport rejects.

import type { ManagedProviderId } from "@openbot/contracts/agent-providers";
import { parseHostedSiteList } from "@openbot/contracts/hosted-sites";
import {
  type AddedAgent,
  type AgentAdminSettings,
  type AgentProviderId,
  type AgentStatus,
  type AgentTemplatePreview,
  type AgentTemplatePublication,
  assertStorageUsageScope,
  type ClearStorageInput,
  type CustomProviderResult,
  type CustomProviderSummary,
  type DeleteCustomProviderInput,
  type DeleteStoredFileInput,
  decodeAgentAdminSettings,
  decodeCustomProviderResult,
  decodeCustomProviderSummaries,
  decodeHostAddedAgent,
  decodeHostAgentTemplatePreview,
  decodeHostAgentTemplatePublication,
  decodeHostReleaseStatus,
  decodeHostUpdateStatus,
  decodeInstalledSkills,
  decodeMcpServerConfigs,
  decodeMcpTestResult,
  decodeProviderApiKeyStatus,
  decodeProviderCodeLoginStart,
  decodeProviderRuntimeSnapshot,
  decodeStorageUsage,
  type GetStorageUsageInput,
  type HostedSiteList,
  type HostReleaseStatus,
  type HostUpdateSettingsChange,
  type HostUpdateStatus,
  type InstallAgentTemplateInput,
  type InstalledSkill,
  type InstallMarketplaceAgentInput,
  type InstallSkillInput,
  isAgentStatus,
  isSharedTable,
  type McpServerConfig,
  type McpTestResult,
  type ProviderCodeLoginStart,
  type ProviderRuntimeSnapshot,
  type PublishAgentTemplateInput,
  type RemoveMcpServerInput,
  type SaveCustomProviderInput,
  type SaveMcpServerInput,
  type SetEnabledSkillInput,
  type SetMcpServerEnabledInput,
  type SetProviderApiKeyInput,
  type SharedTable,
  type SubmitProviderCodeLoginInput,
  type TestMcpServerInput,
  type UninstallSkillInput,
  type UpdateAgentAdminSettingsInput,
  type UpdateHostIdentityInput,
  type UpdateRestartMode,
} from "@openbot/contracts/ipc";
import { guardedListDecoder } from "@openbot/contracts/ipc-decoding";
import {
  decodeEventActivity,
  decodeEventRoutines,
  decodeEventStatus,
  decodeSaveEventRoutineResult,
  decodeWebhookSecret,
  type EventActivity,
  type EventRoutine,
  type EventRoutineRef,
  type EventStatus,
  type ListEventActivityInput,
  type ListEventRoutinesInput,
  type SaveEventRoutineInput,
  type SaveEventRoutineResult,
  type WebhookSecret,
} from "@openbot/contracts/ipc-events";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_INSTALL_ROUTES } from "@openbot/contracts/team-protocol/agent-install-v1";
import { AGENT_PUBLISH_IMAGE_BYTES, AGENT_PUBLISH_ROUTES } from "@openbot/contracts/team-protocol/agent-publish-v1";
import { AGENT_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/agent-update-v1";
import { EVENTS_ROUTES } from "@openbot/contracts/team-protocol/events-v1";
import { HOST_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/host-admin-v1";
import { HOST_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/host-update-v1";
import { HOSTED_SITES_ROUTES } from "@openbot/contracts/team-protocol/hosted-sites-v1";
import { MCP_ROUTES } from "@openbot/contracts/team-protocol/mcp-v1";
import { PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import type { PROVIDERS_RUNTIMES_V2_ROUTES } from "@openbot/contracts/team-protocol/providers-v2";
import { PROVIDERS_SIGN_IN_V3_ROUTES } from "@openbot/contracts/team-protocol/providers-v3";
import type { PROVIDERS_V4_ROUTES } from "@openbot/contracts/team-protocol/providers-v4";
import { SHARED_TABLES_ROUTES } from "@openbot/contracts/team-protocol/shared-tables-v1";
import { SKILLS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
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

export function listEventRoutines(
  request: TeamApiRequest,
  input: ListEventRoutinesInput,
): Effect.Effect<EventRoutine[], TeamAdminRequestError> {
  return adminCall(() => request("POST", EVENTS_ROUTES.listRoutines, decodeEventRoutines, eventBody(input)));
}

/** The result has the new signing secret only when the routine became a webhook routine. */
export function saveEventRoutine(
  request: TeamApiRequest,
  input: SaveEventRoutineInput,
): Effect.Effect<SaveEventRoutineResult, TeamAdminRequestError> {
  return adminCall(() => request("POST", EVENTS_ROUTES.saveRoutine, decodeSaveEventRoutineResult, eventBody(input)));
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

/** `providers-v3` or `providers-v4`. The code is a credential: it goes in the body, and no reply carries it. */
export function submitProviderCodeLogin(
  request: TeamApiRequest,
  input: SubmitProviderCodeLoginInput,
  routes: typeof PROVIDERS_V4_ROUTES | typeof PROVIDERS_SIGN_IN_V3_ROUTES = PROVIDERS_SIGN_IN_V3_ROUTES,
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
export const getProviderApiKeyState = Effect.fn("TeamAdmin.getProviderApiKeyState")(function* (
  request: TeamApiRequest,
  provider: AgentProviderId,
) {
  const status = yield* adminCall(() =>
    request("POST", PROVIDERS_ADMIN_ROUTES.apiKeyState, decodeProviderApiKeyStatus, { provider }),
  );
  return { provider, status };
});

export function setProviderApiKey(
  request: TeamApiRequest,
  input: SetProviderApiKeyInput,
): Effect.Effect<AgentStatus, TeamAdminRequestError> {
  return providerChange(request, PROVIDERS_ADMIN_ROUTES.apiKeySet, { provider: input.provider, key: input.key });
}

export function clearProviderApiKey(
  request: TeamApiRequest,
  provider: AgentProviderId,
): Effect.Effect<AgentStatus, TeamAdminRequestError> {
  return providerChange(request, PROVIDERS_ADMIN_ROUTES.apiKeyClear, { provider });
}

/**
 * The runtime routes of a host: `providers-v4` includes Cursor and Cline, `providers-v2` Gemini,
 * and `providers-v1` none of them. The caller picks by the host's capabilities.
 */
export type ProviderRuntimeRoutes =
  | typeof PROVIDERS_V4_ROUTES
  | typeof PROVIDERS_RUNTIMES_V2_ROUTES
  | typeof PROVIDERS_ADMIN_ROUTES;

export function getProviderRuntimes(
  request: TeamApiRequest,
  routes: ProviderRuntimeRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<ProviderRuntimeSnapshot, TeamAdminRequestError> {
  return adminCall(() => request("POST", routes.runtimesStatus, decodeProviderRuntimeSnapshot, {}));
}

export function downloadProviderRuntime(
  request: TeamApiRequest,
  provider: ManagedProviderId,
  routes: ProviderRuntimeRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<ProviderRuntimeSnapshot, TeamAdminRequestError> {
  return adminCall(() => request("POST", routes.runtimesDownload, decodeProviderRuntimeSnapshot, { provider }));
}

export function cancelProviderRuntime(
  request: TeamApiRequest,
  provider: ManagedProviderId,
  routes: ProviderRuntimeRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<ProviderRuntimeSnapshot, TeamAdminRequestError> {
  return adminCall(() => request("POST", routes.runtimesCancel, decodeProviderRuntimeSnapshot, { provider }));
}

export function checkProviderRuntimeUpdates(
  request: TeamApiRequest,
  routes: ProviderRuntimeRoutes = PROVIDERS_ADMIN_ROUTES,
): Effect.Effect<ProviderRuntimeSnapshot, TeamAdminRequestError> {
  return adminCall(() => request("POST", routes.runtimesCheck, decodeProviderRuntimeSnapshot, {}));
}

export function listCustomProviders(
  request: TeamApiRequest,
): Effect.Effect<CustomProviderSummary[], TeamAdminRequestError> {
  return adminCall(() => request("POST", PROVIDERS_ADMIN_ROUTES.customList, decodeCustomProviderSummaries, {}));
}

export function saveCustomProvider(
  request: TeamApiRequest,
  input: SaveCustomProviderInput,
): Effect.Effect<CustomProviderResult, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", PROVIDERS_ADMIN_ROUTES.customSave, decodeCustomProviderResult, {
      ...input,
      models: input.models.map(({ id, name }) => ({ id, name })),
      headers: input.headers.map(({ name, value }) => ({ name, value })),
    }),
  );
}

export function deleteCustomProvider(
  request: TeamApiRequest,
  input: DeleteCustomProviderInput,
): Effect.Effect<CustomProviderResult, TeamAdminRequestError> {
  return adminCall(() =>
    request("POST", PROVIDERS_ADMIN_ROUTES.customDelete, decodeCustomProviderResult, { id: input.id }),
  );
}

export function getHostReleaseStatus(request: TeamApiRequest): Effect.Effect<HostReleaseStatus, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOST_RELEASE_ROUTES.status, decodeHostReleaseStatus, {}));
}

export function checkHostRelease(request: TeamApiRequest): Effect.Effect<HostReleaseStatus, TeamAdminRequestError> {
  return adminCall(() => request("POST", HOST_RELEASE_ROUTES.check, decodeHostReleaseStatus, {}));
}
