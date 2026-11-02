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

/**
 * The name and id OpenBot gives the Computer Use driver when it hands it to a provider.
 *
 * Deliberately not in `RESERVED_MCP_SERVER_NAMES`. That list means "OpenBot's own in-process
 * bridges, which never leave this process", and `usableMcpServers` uses it as a drop filter. This
 * server does leave: it is a real stdio command the provider spawns, so putting the name there
 * would delete the entry on its way out. A user still may not take the name, which
 * `mcpConfigErrors` enforces on its own below.
 */
export const COMPUTER_USE_MCP_SERVER_NAME = "computer_use";
export const COMPUTER_USE_MCP_SERVER_ID = "openbot-computer-use";

/**
 * The id and address of the GitHub MCP server that the built-in GitHub connection hands to agents.
 * The name is the one the retired GitHub plugin gave its row, so a row the user added keeps its
 * place: when an enabled row has this name, the built-in entry is not added.
 */
export const GITHUB_CONNECTOR_MCP_SERVER_ID = "openbot-github";
export const GITHUB_CONNECTOR_MCP_SERVER_NAME = "github";
export const GITHUB_CONNECTOR_MCP_SERVER_URL = "https://api.githubcopilot.com/mcp/";

/**
 * The id and name of the loopback MCP server that the Telegram account connection hands to agents.
 * When an enabled row already has this name, the built-in entry is not added.
 */
export const TELEGRAM_ACCOUNT_MCP_SERVER_ID = "openbot-telegram-account";
export const TELEGRAM_ACCOUNT_MCP_SERVER_NAME = "telegram";

/**
 * The id and name of the loopback MCP server that the WhatsApp account connection hands to agents.
 * When an enabled row already has this name, the built-in entry is not added.
 */
export const WHATSAPP_ACCOUNT_MCP_SERVER_ID = "openbot-whatsapp-account";
export const WHATSAPP_ACCOUNT_MCP_SERVER_NAME = "whatsapp";

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

/**
 * How long a sign-in waits for the browser to come back. Long enough to find the right account and
 * read a consent page, short enough to end by itself. The panel states it beside its Cancel button.
 */
export const MCP_SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

/** The sign-in to stop, named by the address it signs in to: a draft has no id yet. */
export interface CancelMcpSignInInput {
  url: string;
}

/**
 * The address that the browser shows at the end of a relayed sign-in. The user pastes it when this
 * computer did not take the callback. Main sends only its query to the host.
 */
export interface CompleteMcpSignInRelayInput {
  url: string;
  address: string;
}

/**
 * A sign-in of a joined server that waits in the browser of this computer (`sign-in-relay-v1`): the
 * host name of the page, and whether this computer listens for the callback. When it does not, the
 * user pastes the address that the browser shows. A page that returns nowhere, such as a device page,
 * is not `pasteable`: the user only opens it, and the host's sign-in finishes by itself.
 */
export interface McpSignInRelayPage {
  authorizeHost: string;
  listening: boolean;
  pasteable: boolean;
}

/** One relayed sign-in as its host answers it. `callback` is `null` when the page does not return to a loopback address. */
export interface SignInRelayStatus {
  authorizeUrl: string | null;
  callback: { port: number; path: string; state: string | null } | null;
  result: McpTestResult | null;
}

export interface SignOutMcpServerInput {
  mcpServerId: string;
}

/**
 * Whether this computer holds a sign-in for one http row. A yes or no only: the token itself never
 * leaves the main process.
 */
export interface McpSignInState {
  mcpServerId: string;
  signedIn: boolean;
  /**
   * The server refused the stored sign-in, so the user must sign in again. Only this computer
   * reports it: `mcp-sign-in-v1` carries `signedIn` alone, so a joined host never sets it.
   */
  needsSignIn?: boolean;
}

/**
 * An OAuth app the administrator registered with a server's authorization server themselves, for a
 * server that offers no dynamic registration. The secret never comes back: `secretSaved` says only
 * whether one is on file.
 */
export interface McpSignInApp {
  clientId: string;
  secretSaved: boolean;
  /** Space-separated. Empty: the scope the server asks for. */
  scope: string;
}

/**
 * One saved http row's sign-in app, and the exact address the authorization server must send the
 * grant back to. `redirectUrl` is `null` when the computer has no sign-in store.
 */
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
  /** `null` keeps the secret on file; an empty string removes it. */
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

/**
 * What a save sends: the surrounding spaces of each name taken off, the empty rows the form shows
 * dropped, and the transport the user did not choose cleared, so a stored configuration never
 * carries a half-typed alternative.
 *
 * A value is kept exactly as written - an argument as well as a credential. An argument is handed
 * to the process as one word, so a token or a file name that ends in a space is a different word
 * once it is trimmed, and the form's change check runs this same normalization, which would read
 * the space typed back as no change at all.
 */
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

/**
 * A sign-in that a joined server runs in its own browser (`mcp-sign-in-v1`): the host tab with the
 * page while it is open, and how it ended, in the shape of a test. Both are `null` while the host
 * looks for the page.
 */
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

/**
 * The query of a pasted callback address, or `null` when it is not the callback of this sign-in. The
 * host checks `state` too; this check only gives the user a clear answer before the request.
 */
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

/**
 * The names a loopback callback can use. Any other address is not a callback on the computer that
 * listens. The relay listener binds only `127.0.0.1`, so a `[::1]` callback is not relayed.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * The loopback address that a sign-in page sends the browser back to, or `null`. A sign-in that returns
 * to another address, such as `openbot://`, has no callback to listen for. The host names it, and the
 * client reads it again from the page it opens, so a host cannot name a port that the page does not use.
 */
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

/**
 * A sign-in page that an agent printed and that a joined server can relay: an https page that returns
 * to a loopback address with a `state`. Any other link opens as a normal link.
 */
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

/** The page of a relayed sign-in that waits on this computer, or `null`. */
export function decodeMcpSignInRelayPage(value: unknown): McpSignInRelayPage | null {
  if (value === null) return null;
  if (
    !isDynamicRecord(value) ||
    !isBounded(value.authorizeHost, INPUT_LIMITS.mcpUrl) ||
    !isBoolean(value.listening) ||
    !isBoolean(value.pasteable)
  )
    throw new Error("Invalid MCP server response.");
  return { authorizeHost: value.authorizeHost, listening: value.listening, pasteable: value.pasteable };
}

/** The host tab that shows a remote sign-in page, or `null` while there is none. */
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

/**
 * The rows a save keeps: a name without its surrounding spaces, and the value exactly as written.
 *
 * A value is a credential. A password or a token may hold a leading or trailing space, and a save
 * that takes it off stores a credential the server rejects - with no way to put it back, because
 * the form's own change check runs this same normalization and would read the retyped space as no
 * change at all.
 */
function normalizePairs(pairs: McpKeyValue[]): McpKeyValue[] {
  return pairs.map((pair) => ({ key: pair.key.trim(), value: pair.value })).filter((pair) => pair.key.length > 0);
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
