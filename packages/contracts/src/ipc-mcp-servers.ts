import { INPUT_LIMITS } from "./input-limits";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export const MCP_SERVERS_CAPABILITY = "mcp-servers-v1";

export const RESERVED_MCP_SERVER_NAMES = ["openbot", "openbot_browser"] as const;

export const COMPUTER_USE_MCP_SERVER_NAME = "computer_use";
export const COMPUTER_USE_MCP_SERVER_ID = "openbot-computer-use";

export const GITHUB_CONNECTOR_MCP_SERVER_ID = "openbot-github";
export const GITHUB_CONNECTOR_MCP_SERVER_NAME = "github";
export const GITHUB_CONNECTOR_MCP_SERVER_URL = "https://api.githubcopilot.com/mcp/";

export const MCP_TRANSPORTS = ["stdio", "http"] as const;

export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export interface McpKeyValue {
  key: string;
  value: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  command: string;
  args: string[];
  env: McpKeyValue[];
  envPassthrough: string[];
  workingDirectory: string;
  url: string;
  headers: McpKeyValue[];
}

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

export interface TestMcpServerInput {
  config: McpServerConfig;
}

export const MCP_SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

export interface CancelMcpSignInInput {
  url: string;
}

export interface CompleteMcpSignInRelayInput {
  url: string;
  address: string;
}

export interface McpSignInRelayPage {
  authorizeHost: string;
  url: string | null;
  listening: boolean;
  pasteable: boolean;
}

export interface SignInRelayStatus {
  authorizeUrl: string | null;
  callback: { port: number; path: string; state: string | null } | null;
  result: McpTestResult | null;
}

export interface SignOutMcpServerInput {
  mcpServerId: string;
}

export interface McpSignInState {
  mcpServerId: string;
  signedIn: boolean;
  needsSignIn?: boolean;
}

export interface McpSignInApp {
  clientId: string;
  secretSaved: boolean;
  scope: string;
}

export interface McpSignInAppState {
  redirectUrl: string | null;
  app: McpSignInApp | null;
}

export interface McpSignInAppInput {
  mcpServerId: string;
}

export interface SaveMcpSignInAppInput {
  mcpServerId: string;
  clientId: string;
  clientSecret: string | null;
  scope: string;
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
  else if (isReservedMcpServerName(name) || name.toLowerCase() === COMPUTER_USE_MCP_SERVER_NAME)
    errors.name = `OpenBot already uses the name ${name}.`;
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

export function normalizeMcpConfig(config: McpServerConfig): McpServerConfig {
  const stdio = config.transport === "stdio";
  return {
    ...config,
    name: config.name.trim(),
    command: stdio ? config.command.trim() : "",
    args: stdio ? config.args.filter((value) => value.trim().length > 0) : [],
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

export function decodeMcpSignInStates(value: unknown): McpSignInState[] {
  if (!Array.isArray(value) || value.length > INPUT_LIMITS.mcpServers || !value.every(isMcpSignInState))
    throw new Error("Invalid MCP server response.");
  return value;
}

export interface McpSignInStatus {
  tabId: string | null;
  result: McpTestResult | null;
}

export function decodeMcpSignInStatus(value: unknown): McpSignInStatus {
  if (
    !isDynamicRecord(value) ||
    (value.tabId !== null && !isBounded(value.tabId, INPUT_LIMITS.identifier)) ||
    (value.result !== null && !isMcpTestResult(value.result))
  )
    throw new Error("Invalid MCP server response.");
  return { tabId: value.tabId, result: value.result };
}

export function relayCallbackQuery(address: string, state: string | null): string | null {
  try {
    const url = new URL(address.trim());
    const params = url.searchParams;
    if (!params.has("code") && !params.has("error")) return null;
    if (state !== null && params.get("state") !== state) return null;
    return url.search.slice(1);
  } catch {
    return null;
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function loopbackCallback(pageUrl: string): NonNullable<SignInRelayStatus["callback"]> | null {
  try {
    const page = new URL(pageUrl);
    const redirect = page.searchParams.get("redirect_uri");
    if (!redirect) return null;
    const target = new URL(redirect);
    if (target.protocol !== "http:" || !LOOPBACK_HOSTS.has(target.hostname) || !target.port) return null;
    return { port: Number(target.port), path: target.pathname, state: page.searchParams.get("state") };
  } catch {
    return null;
  }
}

export function hostOnlySignInPage(address: string): boolean {
  const page = URL.parse(address);
  return page?.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(page.hostname);
}

export function relayableSignInLink(address: string): string | null {
  const page = URL.parse(address);
  if (page?.protocol !== "https:" || !page.searchParams.get("state")) return null;
  return loopbackCallback(page.toString()) ? page.toString() : null;
}

export function decodeSignInRelayFlow(value: unknown): { flowId: string } {
  if (!isDynamicRecord(value) || !isBounded(value.flowId, INPUT_LIMITS.identifier) || value.flowId.length === 0)
    throw new Error("Invalid sign-in relay response.");
  return { flowId: value.flowId };
}

export function decodeSignInRelayStatus(value: unknown): SignInRelayStatus {
  if (
    !isDynamicRecord(value) ||
    (value.authorizeUrl !== null && !isBounded(value.authorizeUrl, INPUT_LIMITS.signInRelayAddress)) ||
    (value.callback !== null && !isSignInRelayCallback(value.callback)) ||
    (value.result !== null && !isMcpTestResult(value.result))
  )
    throw new Error("Invalid sign-in relay response.");
  return { authorizeUrl: value.authorizeUrl, callback: value.callback, result: value.result };
}

function isSignInRelayCallback(value: unknown): value is NonNullable<SignInRelayStatus["callback"]> {
  return (
    isDynamicRecord(value) &&
    isNumber(value.port) &&
    Number.isInteger(value.port) &&
    value.port > 0 &&
    value.port < 65_536 &&
    isBounded(value.path, INPUT_LIMITS.mcpUrl) &&
    (value.state === null || isBounded(value.state, INPUT_LIMITS.mcpClientId))
  );
}

export function decodeMcpSignInRelayPage(value: unknown): McpSignInRelayPage | null {
  if (value === null) return null;
  if (
    !isDynamicRecord(value) ||
    !isBounded(value.authorizeHost, INPUT_LIMITS.mcpUrl) ||
    (value.url !== null && !isBounded(value.url, INPUT_LIMITS.signInRelayAddress)) ||
    !isBoolean(value.listening) ||
    !isBoolean(value.pasteable)
  )
    throw new Error("Invalid MCP server response.");
  return {
    authorizeHost: value.authorizeHost,
    url: value.url,
    listening: value.listening,
    pasteable: value.pasteable,
  };
}

export function relayPageUrl(page: URL): string | null {
  const address = page.toString();
  return address.length <= INPUT_LIMITS.signInRelayAddress ? address : null;
}

export function decodeMcpSignInPage(value: unknown): string | null {
  if (value !== null && !isBounded(value, INPUT_LIMITS.identifier)) throw new Error("Invalid MCP server response.");
  return value;
}

export function decodeMcpSignInAppState(value: unknown): McpSignInAppState {
  if (
    !isDynamicRecord(value) ||
    (value.redirectUrl !== null && !isBounded(value.redirectUrl, INPUT_LIMITS.mcpUrl)) ||
    (value.app !== null && !isMcpSignInApp(value.app))
  )
    throw new Error("Invalid MCP server response.");
  return { redirectUrl: value.redirectUrl, app: value.app };
}

function isMcpSignInApp(value: unknown): value is McpSignInApp {
  return (
    isDynamicRecord(value) &&
    isBounded(value.clientId, INPUT_LIMITS.mcpClientId) &&
    value.clientId.length > 0 &&
    isBoolean(value.secretSaved) &&
    isBounded(value.scope, INPUT_LIMITS.mcpScope)
  );
}

function isMcpSignInState(value: unknown): value is McpSignInState {
  return (
    isDynamicRecord(value) &&
    isBounded(value.mcpServerId, INPUT_LIMITS.identifier) &&
    isBoolean(value.signedIn) &&
    (value.needsSignIn === undefined || isBoolean(value.needsSignIn))
  );
}

function normalizePairs(pairs: McpKeyValue[]): McpKeyValue[] {
  return pairs.map((pair) => ({ key: pair.key.trim(), value: pair.value })).filter((pair) => pair.key.length > 0);
}

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
