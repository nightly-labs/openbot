// Admin requests to one host: agent settings and skills, shared tables, the server name and logo,
// MCP servers, storage and providers.
//
// The desktop sends the same routes from the main process. The web client and the mobile app send
// them through their own transport, so the path, body and decoding of each request are here once.
// The host answers only an owner or admin; a member gets a refusal, which the transport rejects.

import type { ManagedProviderId } from "@openbot/contracts/agent-providers";
import {
  type AddedAgent,
  type AgentAdminSettings,
  type AgentProviderId,
  type AgentStatus,
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
  decodeInstalledSkills,
  decodeMcpServerConfigs,
  decodeMcpTestResult,
  decodeProviderApiKeyStatus,
  decodeProviderCodeLoginStart,
  decodeProviderRuntimeSnapshot,
  decodeStorageUsage,
  type GetStorageUsageInput,
  type InstallAgentTemplateInput,
  type InstalledSkill,
  type InstallMarketplaceAgentInput,
  type InstallSkillInput,
  isAgentStatus,
  isSharedTable,
  type McpServerConfig,
  type McpTestResult,
  type ProviderApiKeyState,
  type ProviderCodeLoginStart,
  type ProviderRuntimeSnapshot,
  type RemoveMcpServerInput,
  type SaveCustomProviderInput,
  type SaveMcpServerInput,
  type SetEnabledSkillInput,
  type SetMcpServerEnabledInput,
  type SetProviderApiKeyInput,
  type SharedTable,
  type StorageUsage,
  type TestMcpServerInput,
  type UninstallSkillInput,
  type UpdateAgentAdminSettingsInput,
  type UpdateHostIdentityInput,
} from "@openbot/contracts/ipc";
import { guardedListDecoder } from "@openbot/contracts/ipc-decoding";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_INSTALL_ROUTES } from "@openbot/contracts/team-protocol/agent-install-v1";
import { AGENT_UPDATE_ROUTES } from "@openbot/contracts/team-protocol/agent-update-v1";
import { HOST_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/host-admin-v1";
import { MCP_ROUTES } from "@openbot/contracts/team-protocol/mcp-v1";
import { PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import { SHARED_TABLES_ROUTES } from "@openbot/contracts/team-protocol/shared-tables-v1";
import { SKILLS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import type { TeamApiRequest } from "./team-api-requests";

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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function keyValues(rows: McpServerConfig["env"]): TeamProtocolV2Json {
  return rows.map(({ key, value }) => ({ key, value }));
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

export function getAgentAdminSettings(request: TeamApiRequest, agentId: string): Promise<AgentAdminSettings> {
  return request("POST", AGENT_ADMIN_ROUTES.settings, decodeAgentAdminSettings, { agentId });
}

export function updateAgentAdminSettings(
  request: TeamApiRequest,
  input: UpdateAgentAdminSettingsInput,
): Promise<AgentAdminSettings> {
  return request("POST", AGENT_ADMIN_ROUTES.update, decodeAgentAdminSettings, { ...input });
}

export function listAgentSkills(request: TeamApiRequest, agentId: string): Promise<InstalledSkill[]> {
  return request("POST", SKILLS_ADMIN_ROUTES.list, decodeInstalledSkills, { agentId });
}

/** Only ids cross the wire: the host downloads the skill with its own account. */
export function installAgentSkill(request: TeamApiRequest, input: InstallSkillInput): Promise<InstalledSkill> {
  return request("POST", SKILLS_ADMIN_ROUTES.install, decodeInstalledSkill, { ...input });
}

/**
 * Adds a new agent from a marketplace listing, or updates one added from it. Only ids cross the wire:
 * the host downloads the listing with its own account. agent-install-v1 only adds, so an update goes
 * to agent-update-v1 rather than as an add that would make a copy.
 */
export async function installMarketplaceAgent(
  request: TeamApiRequest,
  input: InstallMarketplaceAgentInput,
): Promise<AddedAgent> {
  const { listingId, agentId, timezone, receiptId } = input;
  if (agentId !== undefined)
    return request("POST", AGENT_UPDATE_ROUTES.marketplace, decodeHostAddedAgent, { agentId, listingId, timezone });
  return request("POST", AGENT_INSTALL_ROUTES.marketplace, decodeHostAddedAgent, { listingId, timezone, receiptId });
}

/** A shared agent template on the host. The host reads the template again and refuses a newer version. */
export async function installAgentTemplate(
  request: TeamApiRequest,
  input: InstallAgentTemplateInput,
): Promise<AddedAgent> {
  const { templateId, timezone, expectedUpdatedAt } = input;
  return request("POST", AGENT_INSTALL_ROUTES.template, decodeHostAddedAgent, {
    templateId,
    timezone,
    expectedUpdatedAt,
  });
}

export function uninstallAgentSkill(request: TeamApiRequest, input: UninstallSkillInput): Promise<void> {
  return request("POST", SKILLS_ADMIN_ROUTES.uninstall, ignoreResponse, { ...input });
}

export function setAgentSkillEnabled(request: TeamApiRequest, input: SetEnabledSkillInput): Promise<InstalledSkill> {
  return request("POST", SKILLS_ADMIN_ROUTES.setEnabled, decodeInstalledSkill, { ...input });
}

export function listSharedTables(request: TeamApiRequest): Promise<SharedTable[]> {
  return request("POST", SHARED_TABLES_ROUTES.list, decodeSharedTables, {});
}

export function deleteSharedTable(request: TeamApiRequest, name: string): Promise<void> {
  return request("POST", SHARED_TABLES_ROUTES.delete, ignoreResponse, { name });
}

/** An absent field stays unchanged; a `null` logo removes it. */
export function updateHostIdentity(request: TeamApiRequest, input: UpdateHostIdentityInput): Promise<void> {
  const body: { [key: string]: TeamProtocolV2Json } = {};
  if (input.serverName !== undefined) body.serverName = input.serverName;
  if (input.logo !== undefined)
    body.logo = input.logo ? { mimeType: input.logo.mimeType, data: bytesToBase64(input.logo.bytes) } : null;
  return request("POST", HOST_ADMIN_ROUTES.identity, ignoreResponse, body);
}

/** The one MCP read route, and the only one the host answers to a GET. */
export function listMcpServers(request: TeamApiRequest): Promise<McpServerConfig[]> {
  return request("GET", MCP_ROUTES.list, decodeMcpServerConfigs);
}

export function saveMcpServer(request: TeamApiRequest, input: SaveMcpServerInput): Promise<McpServerConfig[]> {
  return request("POST", MCP_ROUTES.save, decodeMcpServerConfigs, { config: mcpConfig(input.config) });
}

export function removeMcpServer(request: TeamApiRequest, input: RemoveMcpServerInput): Promise<McpServerConfig[]> {
  return request("POST", MCP_ROUTES.remove, decodeMcpServerConfigs, { ...input });
}

export function setMcpServerEnabled(
  request: TeamApiRequest,
  input: SetMcpServerEnabledInput,
): Promise<McpServerConfig[]> {
  return request("POST", MCP_ROUTES.toggle, decodeMcpServerConfigs, { ...input });
}

/** The host makes the connection with its own stored credentials, and opens no browser. */
export function testMcpServer(request: TeamApiRequest, input: TestMcpServerInput): Promise<McpTestResult> {
  return request("POST", MCP_ROUTES.test, decodeMcpTestResult, { config: mcpConfig(input.config) });
}

export async function getStorageUsage(request: TeamApiRequest, input: GetStorageUsageInput): Promise<StorageUsage> {
  return assertStorageUsageScope(await request("POST", STORAGE_ROUTES.usage, decodeStorageUsage, { ...input }), input);
}

export function deleteStoredFile(request: TeamApiRequest, input: DeleteStoredFileInput): Promise<void> {
  return request("POST", STORAGE_ROUTES.deleteFile, ignoreResponse, { ...input });
}

export function clearStorage(request: TeamApiRequest, input: ClearStorageInput): Promise<void> {
  return request("POST", STORAGE_ROUTES.clear, ignoreResponse, { ...input });
}

/** The verification URL is https, or the reply is refused. */
export function startProviderCodeLogin(
  request: TeamApiRequest,
  provider: AgentProviderId,
): Promise<ProviderCodeLoginStart> {
  return request("POST", PROVIDERS_ADMIN_ROUTES.codeLoginStart, decodeProviderCodeLoginStart, { provider });
}

/** A change, then the host's status, so the result is the `AgentStatus` a local change gives. */
async function providerChange(request: TeamApiRequest, path: string, body: TeamProtocolV2Json): Promise<AgentStatus> {
  await request("POST", path, ignoreResponse, body);
  return request("GET", TEAM_API_ROUTES.agents.status, decodeAgentStatus);
}

export function cancelProviderCodeLogin(request: TeamApiRequest, provider: AgentProviderId): Promise<AgentStatus> {
  return providerChange(request, PROVIDERS_ADMIN_ROUTES.codeLoginCancel, { provider });
}

/** Only the key's state comes back; no reply carries the key. */
export async function getProviderApiKeyState(
  request: TeamApiRequest,
  provider: AgentProviderId,
): Promise<ProviderApiKeyState> {
  return {
    provider,
    status: await request("POST", PROVIDERS_ADMIN_ROUTES.apiKeyState, decodeProviderApiKeyStatus, { provider }),
  };
}

export function setProviderApiKey(request: TeamApiRequest, input: SetProviderApiKeyInput): Promise<AgentStatus> {
  return providerChange(request, PROVIDERS_ADMIN_ROUTES.apiKeySet, { provider: input.provider, key: input.key });
}

export function clearProviderApiKey(request: TeamApiRequest, provider: AgentProviderId): Promise<AgentStatus> {
  return providerChange(request, PROVIDERS_ADMIN_ROUTES.apiKeyClear, { provider });
}

export function getProviderRuntimes(request: TeamApiRequest): Promise<ProviderRuntimeSnapshot> {
  return request("POST", PROVIDERS_ADMIN_ROUTES.runtimesStatus, decodeProviderRuntimeSnapshot, {});
}

export function downloadProviderRuntime(
  request: TeamApiRequest,
  provider: ManagedProviderId,
): Promise<ProviderRuntimeSnapshot> {
  return request("POST", PROVIDERS_ADMIN_ROUTES.runtimesDownload, decodeProviderRuntimeSnapshot, { provider });
}

export function cancelProviderRuntime(
  request: TeamApiRequest,
  provider: ManagedProviderId,
): Promise<ProviderRuntimeSnapshot> {
  return request("POST", PROVIDERS_ADMIN_ROUTES.runtimesCancel, decodeProviderRuntimeSnapshot, { provider });
}

export function checkProviderRuntimeUpdates(request: TeamApiRequest): Promise<ProviderRuntimeSnapshot> {
  return request("POST", PROVIDERS_ADMIN_ROUTES.runtimesCheck, decodeProviderRuntimeSnapshot, {});
}

export function listCustomProviders(request: TeamApiRequest): Promise<CustomProviderSummary[]> {
  return request("POST", PROVIDERS_ADMIN_ROUTES.customList, decodeCustomProviderSummaries, {});
}

export function saveCustomProvider(
  request: TeamApiRequest,
  input: SaveCustomProviderInput,
): Promise<CustomProviderResult> {
  return request("POST", PROVIDERS_ADMIN_ROUTES.customSave, decodeCustomProviderResult, {
    ...input,
    models: input.models.map(({ id, name }) => ({ id, name })),
    headers: input.headers.map(({ name, value }) => ({ name, value })),
  });
}

export function deleteCustomProvider(
  request: TeamApiRequest,
  input: DeleteCustomProviderInput,
): Promise<CustomProviderResult> {
  return request("POST", PROVIDERS_ADMIN_ROUTES.customDelete, decodeCustomProviderResult, { id: input.id });
}
