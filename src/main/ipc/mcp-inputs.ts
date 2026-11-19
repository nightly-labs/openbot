import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  CancelMcpSignInInput,
  CompleteMcpSignInRelayInput,
  McpKeyValue,
  McpServerConfig,
  McpSignInAppInput,
  RemoveMcpServerInput,
  SaveMcpServerInput,
  SaveMcpSignInAppInput,
  SetMcpServerEnabledInput,
  TestMcpServerInput,
} from "@openbot/contracts/ipc";
import { isBoolean, isString } from "@openbot/contracts/runtime-values";
import { isObject, requireString } from "./validation";

export function parseSaveMcpServer(value: unknown): SaveMcpServerInput {
  if (!isObject(value)) throw new Error("An MCP server is required.");
  return { config: parseMcpServerConfig(value.config) };
}

export function parseTestMcpServer(value: unknown): TestMcpServerInput {
  if (!isObject(value)) throw new Error("An MCP server is required.");
  return { config: parseMcpServerConfig(value.config) };
}

export function parseRemoveMcpServer(value: unknown): RemoveMcpServerInput {
  if (!isObject(value)) throw new Error("An MCP server is required.");
  return { mcpServerId: requireString(value.mcpServerId, "MCP server") };
}

export function parseCancelMcpSignIn(value: unknown): CancelMcpSignInInput {
  if (!isObject(value)) throw new Error("An MCP server is required.");
  return { url: requireString(value.url, "Address", INPUT_LIMITS.mcpUrl) };
}

export function parseCompleteMcpSignInRelay(value: unknown): CompleteMcpSignInRelayInput {
  if (!isObject(value)) throw new Error("An MCP server is required.");
  return {
    url: requireString(value.url, "Address", INPUT_LIMITS.mcpUrl),
    address: requireString(value.address, "Address", INPUT_LIMITS.signInRelayAddress),
  };
}

export function parseMcpSignInApp(value: unknown): McpSignInAppInput {
  if (!isObject(value)) throw new Error("An MCP server is required.");
  return { mcpServerId: requireString(value.mcpServerId, "MCP server") };
}

export function parseSaveMcpSignInApp(value: unknown): SaveMcpSignInAppInput {
  if (!isObject(value)) throw new Error("An MCP server is required.");
  return {
    mcpServerId: requireString(value.mcpServerId, "MCP server"),
    clientId: boundedText(value.clientId, "Client ID", INPUT_LIMITS.mcpClientId),
    clientSecret:
      value.clientSecret === null
        ? null
        : boundedText(value.clientSecret, "Client secret", INPUT_LIMITS.mcpClientSecret),
    scope: boundedText(value.scope, "Scope", INPUT_LIMITS.mcpScope),
  };
}

export function parseSetMcpServerEnabled(value: unknown): SetMcpServerEnabledInput {
  if (!isObject(value)) throw new Error("An MCP server is required.");
  if (!isBoolean(value.enabled)) throw new Error("The enabled state must be a boolean.");
  return { mcpServerId: requireString(value.mcpServerId, "MCP server"), enabled: value.enabled };
}

function parseMcpServerConfig(value: unknown): McpServerConfig {
  if (!isObject(value)) throw new Error("An MCP server is required.");
  const transport = value.transport;
  if (transport !== "stdio" && transport !== "http") throw new Error("Choose a stdio or HTTP transport.");
  if (!isBoolean(value.enabled)) throw new Error("The enabled state must be a boolean.");
  return {
    id: boundedText(value.id, "MCP server", INPUT_LIMITS.identifier),
    name: requireString(value.name, "Name", INPUT_LIMITS.mcpServerName),
    transport,
    enabled: value.enabled,
    command: boundedText(value.command, "Command", INPUT_LIMITS.mcpCommand),
    args: boundedList(value.args, "Arguments", INPUT_LIMITS.mcpArgs, INPUT_LIMITS.mcpArgValue),
    env: pairList(value.env, "Environment", INPUT_LIMITS.mcpEnvVariables, INPUT_LIMITS.mcpEnvValue),
    envPassthrough: boundedList(
      value.envPassthrough,
      "Environment",
      INPUT_LIMITS.mcpEnvVariables,
      INPUT_LIMITS.mcpEnvName,
    ),
    workingDirectory: boundedText(value.workingDirectory, "Working directory", INPUT_LIMITS.path),
    url: boundedText(value.url, "Address", INPUT_LIMITS.mcpUrl),
    headers: pairList(value.headers, "Headers", INPUT_LIMITS.mcpHeaders, INPUT_LIMITS.mcpHeaderValue),
  };
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (!isString(value)) throw new Error(`${field} must be text.`);
  if (value.length > maximum) throw new Error(`${field} is too long.`);
  return value;
}

function boundedList(value: unknown, field: string, count: number, each: number): string[] {
  if (!Array.isArray(value) || value.length > count) throw new Error(`${field} holds too many entries.`);
  return value.map((item) => boundedText(item, field, each));
}

function pairList(value: unknown, field: string, count: number, each: number): McpKeyValue[] {
  if (!Array.isArray(value) || value.length > count) throw new Error(`${field} holds too many entries.`);
  return value.map((item) => {
    if (!isObject(item) || !isString(item.key) || item.key.length > INPUT_LIMITS.mcpEnvName)
      throw new Error(`${field} holds an invalid name.`);
    return { key: item.key, value: boundedText(item.value, field, each) };
  });
}
