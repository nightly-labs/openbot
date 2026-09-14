/**
 * The MCP server configuration the settings panel edits, the pure rules around it, and the wire
 * shapes the renderer and the main process share.
 *
 * "Server" in this repository means a joined team server or the local Team API host. An MCP server
 * is an unrelated thing, so every name here carries `mcp` and nothing here touches `ServerSummary`.
 *
 * The presentation-only helpers - a blank draft, the badge text, the badge variant - stay in
 * `src/renderer/src/features/servers/mcp-servers.ts`, which re-exports these types. What lives here
 * is what the main process must not re-implement: a second copy of `normalizeMcpConfig` would let
 * the row hold something the form never previewed.
 */

import { INPUT_LIMITS } from "./input-limits";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

/**
 * Additive, optional Team API behaviour, in the sense `packages/contracts/AGENTS.md` gives the
 * word: a host that does not advertise this string has no MCP routes, and the panel stays hidden
 * for it. The string is permanent - evolving it means a second capability, never an edit.
 */
export const MCP_SERVERS_CAPABILITY = "mcp-servers-v1";

/**
 * The names OpenBot gives its own in-process bridge servers (`claude-client.ts`). A user
 * configuration may not take either one: on Claude the record key would collide, and on the other
 * providers the agent would be offered two servers with one name.
 */
export const RESERVED_MCP_SERVER_NAMES = ["openbot", "openbot_browser"] as const;

export const MCP_TRANSPORTS = ["stdio", "http"] as const;

export type McpTransport = (typeof MCP_TRANSPORTS)[number];

/** One key/value pair the form edits as a row. An array of these keeps the row order stable. */
export interface McpKeyValue {
  key: string;
  value: string;
}

/**
 * A configured MCP server. Both transports' fields live on one record rather than in a union: the
 * form keeps what the user typed under the other transport while they compare the two, and
 * `normalizeMcpConfig` is what drops the side that does not apply on the way out.
 */
export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  /** stdio */
  command: string;
  args: string[];
  env: McpKeyValue[];
  envPassthrough: string[];
  workingDirectory: string;
  /** streamable http */
  url: string;
  headers: McpKeyValue[];
}

/**
 * What one test connection found: the tools the server offered, or the sentence that says why it
 * did not answer.
 *
 * Nothing stores this. OpenBot connects only when the user asks it to, because a connection is not
 * free - an http server can want an OAuth sign-in, a cold `npx` can take a minute, and a server can
 * do real work at startup. A stored result would also be a claim about right now that nothing keeps
 * true. The providers make their own connections when an agent starts.
 */
export interface McpTestResult {
  toolCount: number;
  error: string | null;
}

export interface McpConfigErrors {
  name?: string;
  command?: string;
  url?: string;
}

export interface SaveMcpServerInput {
  config: McpServerConfig;
}

export interface RemoveMcpServerInput {
  mcpServerId: string;
}

export interface SetMcpServerEnabledInput {
  mcpServerId: string;
  enabled: boolean;
}

/** The configuration to test. It carries no id, because a draft is testable before it is saved. */
export interface TestMcpServerInput {
  config: McpServerConfig;
}

export function createMcpServerId(): string {
  return `mcp-${crypto.randomUUID()}`;
}

export function mcpConfigErrors(config: McpServerConfig): McpConfigErrors {
  const errors: McpConfigErrors = {};
  const name = config.name.trim();
  if (!name) errors.name = "Enter a name for this MCP server.";
  else if (name.length > INPUT_LIMITS.mcpServerName)
    errors.name = `Use ${INPUT_LIMITS.mcpServerName} characters or fewer for the name.`;
  else if (isReservedMcpServerName(name)) errors.name = `OpenBot already uses the name ${name}.`;
  if (config.transport === "stdio") {
    if (!config.command.trim()) errors.command = "Enter the command that launches this server.";
    return errors;
  }
  if (!isHttpUrl(config.url)) errors.url = "Enter an http or https address.";
  return errors;
}

export function mcpConfigIsValid(config: McpServerConfig): boolean {
  return Object.keys(mcpConfigErrors(config)).length === 0;
}

export function isReservedMcpServerName(name: string): boolean {
  return RESERVED_MCP_SERVER_NAMES.some((reserved) => reserved === name.trim().toLowerCase());
}

/**
 * What a save sends: trimmed values, the empty rows the form shows dropped, and the transport the
 * user did not choose cleared, so a stored configuration never carries a half-typed alternative.
 */
export function normalizeMcpConfig(config: McpServerConfig): McpServerConfig {
  const stdio = config.transport === "stdio";
  return {
    ...config,
    name: config.name.trim(),
    command: stdio ? config.command.trim() : "",
    args: stdio ? config.args.map((value) => value.trim()).filter(Boolean) : [],
    env: stdio ? normalizePairs(config.env) : [],
    envPassthrough: stdio ? config.envPassthrough.map((value) => value.trim()).filter(Boolean) : [],
    workingDirectory: stdio ? config.workingDirectory.trim() : "",
    url: stdio ? "" : config.url.trim(),
    headers: stdio ? [] : normalizePairs(config.headers),
  };
}

export function isMcpKeyValue(value: unknown): value is McpKeyValue {
  return isPair(value, INPUT_LIMITS.mcpEnvValue);
}

export function isMcpServerConfig(value: unknown): value is McpServerConfig {
  return (
    isDynamicRecord(value) &&
    isBounded(value.id, INPUT_LIMITS.identifier) &&
    isBounded(value.name, INPUT_LIMITS.mcpServerName) &&
    isOneOf(MCP_TRANSPORTS, value.transport) &&
    isBoolean(value.enabled) &&
    isBounded(value.command, INPUT_LIMITS.mcpCommand) &&
    isBoundedList(value.args, INPUT_LIMITS.mcpArgs, INPUT_LIMITS.mcpArgValue) &&
    isPairList(value.env, INPUT_LIMITS.mcpEnvVariables, INPUT_LIMITS.mcpEnvValue) &&
    isBoundedList(value.envPassthrough, INPUT_LIMITS.mcpEnvVariables, INPUT_LIMITS.mcpEnvName) &&
    isBounded(value.workingDirectory, INPUT_LIMITS.path) &&
    isBounded(value.url, INPUT_LIMITS.mcpUrl) &&
    isPairList(value.headers, INPUT_LIMITS.mcpHeaders, INPUT_LIMITS.mcpHeaderValue)
  );
}

export function isMcpTestResult(value: unknown): value is McpTestResult {
  return isDynamicRecord(value) && isToolCount(value.toolCount) && isErrorText(value.error);
}

export function decodeMcpServerConfigs(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value) || value.length > INPUT_LIMITS.mcpServers || !value.every(isMcpServerConfig))
    throw new Error("Invalid MCP server response.");
  return value;
}

export function decodeMcpTestResult(value: unknown): McpTestResult {
  if (!isMcpTestResult(value)) throw new Error("Invalid MCP server response.");
  return value;
}

function normalizePairs(pairs: McpKeyValue[]): McpKeyValue[] {
  return pairs
    .map((pair) => ({ key: pair.key.trim(), value: pair.value.trim() }))
    .filter((pair) => pair.key.length > 0);
}

/** Empty is allowed everywhere here: an unused transport's fields are cleared, not absent. */
function isBounded(value: unknown, maximum: number): value is string {
  return isString(value) && value.length <= maximum;
}

function isBoundedList(value: unknown, count: number, each: number): value is string[] {
  return Array.isArray(value) && value.length <= count && value.every((item) => isBounded(item, each));
}

function isPair(value: unknown, each: number): value is McpKeyValue {
  return isDynamicRecord(value) && isBounded(value.key, INPUT_LIMITS.mcpEnvName) && isBounded(value.value, each);
}

function isPairList(value: unknown, count: number, each: number): value is McpKeyValue[] {
  return Array.isArray(value) && value.length <= count && value.every((item) => isPair(item, each));
}

function isToolCount(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 0 && value <= INPUT_LIMITS.mcpToolCount;
}

function isErrorText(value: unknown): value is string | null {
  return value === null || isBounded(value, INPUT_LIMITS.mcpErrorText);
}

function isHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > INPUT_LIMITS.mcpUrl) return false;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
