// Admin requests to one host: agent settings, the server name and logo, MCP servers and storage.
//
// The desktop sends the same routes from the main process. The web client and the mobile app send
// them through their own transport, so the path, body and decoding of each request are here once.
// The host answers only an owner or admin; a member gets a refusal, which the transport rejects.

import {
  type AgentAdminSettings,
  assertStorageUsageScope,
  type ClearStorageInput,
  type DeleteStoredFileInput,
  decodeAgentAdminSettings,
  decodeMcpServerConfigs,
  decodeMcpTestResult,
  decodeStorageUsage,
  type GetStorageUsageInput,
  type McpServerConfig,
  type McpTestResult,
  type RemoveMcpServerInput,
  type SaveMcpServerInput,
  type SetMcpServerEnabledInput,
  type StorageUsage,
  type TestMcpServerInput,
  type UpdateAgentAdminSettingsInput,
  type UpdateHostIdentityInput,
} from "@openbot/contracts/ipc";
import { AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { HOST_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/host-admin-v1";
import { MCP_ROUTES } from "@openbot/contracts/team-protocol/mcp-v1";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import type { TeamApiRequest } from "./team-api-requests";

// The route codec has already checked the empty reply.
function ignoreResponse(): void {}

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
