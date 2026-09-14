// The shape and the bounds of the MCP payloads the renderer sends. No message here quotes a value,
// because the field it would name can be an API key or an `Authorization` header.
//
// Domain rules - a duplicate name, a reserved name, the count of servers - stay in `McpServerStore`,
// stated once, so the local path and the remote path cannot disagree about them.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  McpKeyValue,
  McpServerConfig,
  RemoveMcpServerInput,
  SaveMcpServerInput,
  SetMcpServerEnabledInput,
  TestMcpServerInput,
} from "@openbot/contracts/ipc";
import { isBoolean, isString } from "@openbot/contracts/runtime-values";
import { isObject, requireString } from "./validation";

export function parseSaveMcpServer(value: unknown): SaveMcpServerInput {
  if (!isObject(value)) throw new Error("An MCP server is required.");
  return { config: parseMcpServerConfig(value.config) };
}

/** The same shape as a save, because a test answers for exactly what a save would store. */
export function parseTestMcpServer(value: unknown): TestMcpServerInput {
  if (!isObject(value)) throw new Error("An MCP server is required.");
  return { config: parseMcpServerConfig(value.config) };
}

export function parseRemoveMcpServer(value: unknown): RemoveMcpServerInput {
  if (!isObject(value)) throw new Error("An MCP server is required.");
  return { mcpServerId: requireString(value.mcpServerId, "MCP server") };
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
    // An empty id means a server that is not saved yet, so this field is bounded but not required.
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

/** Empty is allowed everywhere here: the transport that is not in use has cleared fields, not absent ones. */
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
