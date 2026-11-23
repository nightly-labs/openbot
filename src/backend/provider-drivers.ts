import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { type ClientSideConnection, type InitializeResponse, RequestError } from "@agentclientprotocol/sdk";
import {
  type AgentAuthState,
  type AgentModelOption,
  type AgentProviderId,
  composedCustomModelId,
  customProviderOfModel,
  DEFAULT_PROMPT_CACHE_TTL,
  type KeyOnlyProviderId,
  type PromptCacheTtl,
  type ProviderEnvironmentProvider,
  type ProviderModelSource,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { AcpAgentClient, type AcpHistoryPersistence } from "./acp-client";
import {
  CLINE_ACP_FLAVOR,
  COPILOT_ACP_FLAVOR,
  CURSOR_ACP_FLAVOR,
  customAgentFlavor,
  DEVIN_ACP_FLAVOR,
  HERMES_ACP_FLAVOR,
  KIMI_ACP_FLAVOR,
  MISTRAL_ACP_FLAVOR,
} from "./acp-flavor";
import {
  ANTIGRAVITY_ACP_FLAVOR,
  antigravityGeminiHome,
  GEMINI_DIR_FLAG,
  geminiSavedKeyLimitFailure,
} from "./acp-flavor-antigravity";
import { OPENCODE_ACP_FLAVOR } from "./acp-flavor-opencode";
import { acpSessionSteers, steerAcpSession } from "./acp-session-steering";
import type { AcpArgv, AcpExtensionMethod } from "./acp-sign-in";
import { CODEX_VARIABLE_PROVIDER, readCodexModelSource } from "./agent/codex-model-source";
import type { ImageFitter } from "./agent/image-reader";
import { readMuseAccount } from "./agent/muse-login";
import { claudeModelName, modelsAfterOpenCodeDiscoveryFailure, serviceTierFields } from "./agent/provider-models";
import type { TurnContext } from "./agent/turn-context";
import type { AgentClient } from "./agent-client";
import { ANTIGRAVITY_TOKEN_FILE, importAntigravityToken } from "./antigravity-token-import";
import { readAntigravityEmail, readAntigravityQuota, readAntigravityValidationLink } from "./antigravity-usage";
import { CodexAppServerClient } from "./app-server-client";
import { ClaudeAgentClient } from "./claude-client";
import {
  type AgentCliInfo,
  ANTIGRAVITY_UPDATE_ENV,
  antigravityTakesStateFolders,
  COPILOT_ENV,
  cliPathEnvironment,
  kimiLoginArgs,
  resolveAntigravityCli,
  resolveClaudeCli,
  resolveClineCli,
  resolveCodexCli,
  resolveCopilotCli,
  resolveCursorCli,
  resolveDevinCli,
  resolveGrokCli,
  resolveHermesCli,
  resolveKimiCli,
  resolveMistralCli,
  resolveMuseCli,
  resolveOpencodeCli,
  resolvePiCli,
} from "./cli";
import { clineFreeModels } from "./cline-free-models";
import { checkCursorApiKey, readCursorUsage } from "./cursor-usage";
import { CustomAcpAgentsClient, type CustomAgentConfig, type CustomAgentSource } from "./custom-acp-agents-client";
import { isMissingFileError } from "./file-errors";
import { GrokAgentClient } from "./grok-client";
import { hermesSettingsEnvironment } from "./hermes-settings";
import { isPythonKimiCli, kimiPythonLoginEnv, kimiPythonSavedRegionEnv, type SignInRegion } from "./kimi-region";
import { kimiSavedSignInCheck, kimiSavedSignInVersion } from "./kimi-sign-in-check";
import { readKimiUsage } from "./kimi-usage";
import type { McpOAuthAuthority } from "./mcp-oauth-provider";
import type { McpOAuthProxySettingsStore } from "./mcp-oauth-proxy";
import type { McpDropReporter, McpEndpointSource, McpServerSource, McpToolRuntimeSource } from "./mcp-provider-shapes";
import { MuseAgentClient } from "./muse-client";
import { openCodeAgentDefaultsEnv } from "./opencode-agent-defaults";
import {
  CUSTOM_ENDPOINT_SILENCE_MS,
  type CustomProviderSource,
  customProvidersOn,
  OPENCODE_AGENT_CONFIG,
  OPENCODE_PROFILE_CONFIG,
  openCodeConfigEnv,
  openCodeModelName,
  openCodeSignInMessage,
} from "./opencode-config";
import { hasOpenCodeProviderKey, readOpenCodeGoUsage, readOpenCodeRefusalStatus } from "./opencode-usage";
import { PiAgentClient } from "./pi-client";
import {
  antigravityStatePaths,
  COPILOT_CONFINED_ENV,
  clineStatePaths,
  codexHomeDirectory,
  confineSpawnTarget,
  copilotHomeDirectory,
  copilotStatePaths,
  cursorConfinedEnv,
  cursorStatePaths,
  customAgentStatePaths,
  devinDataDirectory,
  devinStatePaths,
  grokHomeDirectory,
  hermesHome,
  hermesStatePaths,
  kimiCodeStatePaths,
  kimiStatePaths,
  mistralHomeDirectory,
  mistralStatePaths,
  museStatePaths,
  OPENCODE_CONFINED_ENV,
  openCodeStatePaths,
  type ProcessConfinement,
  type ProviderStatePaths,
  piAgentDirectory,
  piStatePaths,
  type SpawnTarget,
} from "./process-confinement";
import { type AccountReadResult, isCodexLoginType, type ModelListResponse } from "./protocol";
import { type ProviderClientOperationError, providerCall, providerFailure } from "./provider-client-effects";

interface ProviderCliCommand {
  readonly argv: readonly string[];
  readonly env: (cli: AgentCliInfo) => Record<string, string>;
  readonly timeoutMs: number;
  readonly closeInput?: true;
  readonly acpLogout?: true | AcpExtensionMethod;
  readonly windowsPageByOpenBot?: true;
  readonly failureText?: (output: string) => string | null;
}

interface ProviderSignInCommand extends Omit<ProviderCliCommand, "argv" | "env"> {
  readonly argv:
    | readonly string[]
    | ((cli: AgentCliInfo, region: SignInRegion) => Effect.Effect<readonly string[], ProviderClientOperationError>);
  readonly env: (cli: AgentCliInfo, region: SignInRegion) => Record<string, string>;
  readonly savedSignIn?: (cli: AgentCliInfo, env: NodeJS.ProcessEnv) => Effect.Effect<string | null>;
  readonly pipedInput?: true;
}

const CLI_LOGIN_TIMEOUT_MS = 10 * 60_000;

const CURSOR_KEY_ACCOUNTS_MIN_VERSION = "2026.10.01";

export interface ProviderHomeAccountSupport {
  readonly homeVariable: string;
  readonly signIn: ProviderCliCommand | AcpAuthenticateSignIn;
  readonly codeSignIn?: { readonly flow: "device" | "paste" | "link"; readonly command: ProviderCliCommand };
  readonly signOut?: ProviderCliCommand;
  supports?(cli: AgentCliInfo): boolean;
  readonly usageLeavesSession?: boolean;
}

export interface ProviderKeyAccountSupport {
  readonly keyEnvironment: (key: string) => Readonly<Record<string, string>>;
  readonly checkKey?: (key: string) => Effect.Effect<boolean, { readonly cause: unknown }>;
  supports?(cli: AgentCliInfo): boolean;
}

export type ProviderAccountSupport = ProviderHomeAccountSupport | ProviderKeyAccountSupport;

export function isKeyAccountSupport(support: ProviderAccountSupport | undefined): support is ProviderKeyAccountSupport {
  return support !== undefined && "keyEnvironment" in support;
}

interface ProviderAccountKeys {
  get(provider: AgentProviderId, accountId: string): string | null;
  set(
    provider: AgentProviderId,
    accountId: string,
    key: string | null,
  ): Effect.Effect<void, { readonly cause: unknown }>;
}

const CLAUDE_COMMAND_ENV = (cli: AgentCliInfo): Record<string, string> =>
  cli.source === "managed" ? { DISABLE_AUTOUPDATER: "1" } : {};

const CLAUDE_CODE_SIGN_IN: ProviderCliCommand = {
  argv: ["auth", "login", "--claudeai"],
  env: CLAUDE_COMMAND_ENV,
  timeoutMs: CLI_LOGIN_TIMEOUT_MS,
};
const GROK_CODE_SIGN_IN: ProviderCliCommand = {
  argv: ["--no-auto-update", "login", "--device-auth"],
  env: () => ({ GROK_OAUTH2_REFERRER: "openbot" }),
  timeoutMs: CLI_LOGIN_TIMEOUT_MS,
};
function claudeSignInFailure(output: string): string | null {
  return /couldn.t save your login/iu.test(output) ? sourceText("error.provider.claudeLoginNotSaved") : null;
}
const CLAUDE_SIGN_IN: ProviderCliCommand = {
  argv: ["auth", "login", "--claudeai"],
  env: CLAUDE_COMMAND_ENV,
  timeoutMs: CLI_LOGIN_TIMEOUT_MS,
  windowsPageByOpenBot: true,
  failureText: claudeSignInFailure,
};

function opencodeEnv(cli: AgentCliInfo): Record<string, string> {
  return cli.source === "managed" ? { OPENCODE_DISABLE_AUTOUPDATE: "1" } : {};
}

type ProviderSignIn =
  | { kind: "browser" }
  | { kind: "cli-command"; command: ProviderSignInCommand }
  | { kind: "external" }
  | { kind: "terminal"; timeoutMs: number }
  | { kind: "muse-device"; timeoutMs: number }
  | AcpAuthenticateSignIn;

interface AcpAuthenticateSignIn {
  readonly kind: "acp-authenticate";
  readonly methodId: string;
  readonly argv: AcpArgv;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

type ProviderCodeSignIn =
  | { kind: "codex-device" }
  | { kind: "muse-device"; timeoutMs: number }
  | { kind: "cli"; flow: "device" | "paste" | "link"; command: ProviderSignInCommand }
  | (Omit<AcpAuthenticateSignIn, "kind"> & { readonly kind: "acp-delegated" });

function antigravityTokenFile(context: ProviderClientContext): string {
  return join(antigravityAppDataDir({ ...process.env, ...context.accountEnvironment }), ANTIGRAVITY_TOKEN_FILE);
}

function antigravityUsesSavedKey(context: ProviderClientContext): boolean {
  return Boolean(context.apiKey("antigravity")) && !context.accountEnvironment;
}

function antigravityKeyOptions(context: ProviderClientContext, agentEnvironment: boolean) {
  const account = context.accountEnvironment;
  const variables = () => context.providerEnvironment?.("antigravity") ?? {};
  const key = () =>
    account || "AGY_LLM_GATEWAY_URL" in variables() || "GEMINI_API_KEY" in variables()
      ? null
      : context.apiKey("antigravity");
  return {
    extraEnv: () => {
      importAntigravityToken(antigravityAppDataDir({ ...process.env, ...account }));
      const saved = key();
      return {
        ...(agentEnvironment ? context.agentEnvironment?.() : {}),
        ...account,
        ...(saved ? { GEMINI_API_KEY: saved } : {}),
        ...variables(),
      };
    },
    redactValues: () => {
      const saved = key();
      return saved ? [saved] : [];
    },
    authenticate: (connection: ClientSideConnection, initialization: InitializeResponse) =>
      key() && initialization.authMethods?.some((method) => method.id === GEMINI_API_KEY_METHOD)
        ? providerCall(() => connection.authenticate({ methodId: GEMINI_API_KEY_METHOD })).pipe(Effect.asVoid)
        : Effect.void,
    savedKeyRefusedMessage: () => (key() ? sourceText("error.provider.geminiKeyRefused") : null),
    savedKeyLimitMessage: (detail: string, error?: unknown) =>
      key() ? geminiSavedKeyLimitFailure(detail, error) : null,
    authBlockedMessage: () =>
      antigravitySettingsUnreadable(antigravityAppDataDir({ ...process.env, ...account }))
        ? sourceText(
            account ? "error.provider.geminiAccountSettingsUnreadable" : "error.provider.geminiSettingsUnreadable",
          )
        : null,
  };
}

function antigravitySettingsUnreadable(appDataDir: string): boolean {
  try {
    readFileSync(join(appDataDir, "settings.json"));
    return false;
  } catch (error) {
    return !isMissingFileError(error);
  }
}

const ANTIGRAVITY_ENV = { WSL_DISTRO_NAME: "OpenBot", ...ANTIGRAVITY_UPDATE_ENV };

const ANTIGRAVITY_APP_DATA = "antigravity-acp";

function antigravityAppDataDir(env: Readonly<Record<string, string | undefined>>): string {
  return join(antigravityGeminiHome(env), ANTIGRAVITY_APP_DATA);
}

const antigravityArgv = (env: Readonly<Record<string, string | undefined>>): readonly string[] => [
  "acp",
  `${GEMINI_DIR_FLAG}${antigravityGeminiHome(env)}`,
  `--app-data-dir=${ANTIGRAVITY_APP_DATA}`,
];

function antigravityAccountStatePaths(context: ProviderClientContext) {
  const state = antigravityStatePaths({ ...process.env, ...context.accountEnvironment });
  if (context.accountEnvironment)
    for (const folder of state.writable) mkdirSync(folder, { recursive: true, mode: 0o700 });
  return state;
}

const GEMINI_API_KEY_METHOD = "gemini-api-key";

export function antigravityTemp(context: Pick<ProviderClientContext, "providerTempDirectory" | "availableDiskBytes">) {
  return context.providerTempDirectory
    ? {
        root: join(context.providerTempDirectory, "antigravity"),
        availableDiskBytes: context.availableDiskBytes,
      }
    : undefined;
}

const ANTIGRAVITY_SIGN_IN: AcpAuthenticateSignIn = {
  kind: "acp-authenticate",
  methodId: "oauth-personal",
  argv: antigravityArgv,
  env: ANTIGRAVITY_ENV,
  timeoutMs: CLI_LOGIN_TIMEOUT_MS,
};

const ANTIGRAVITY_CODE_SIGN_IN: ProviderSignInCommand = {
  argv: () => Effect.succeed([...antigravityArgv({ ...process.env, ...ANTIGRAVITY_ENV }), "--login"]),
  env: () => ({ ...ANTIGRAVITY_ENV }),
  timeoutMs: CLI_LOGIN_TIMEOUT_MS,
  pipedInput: true,
};

const CLINE_ARGV: readonly string[] = ["--acp"];

const CLINE_ENV: Readonly<Record<string, string>> = {
  CLINE_SESSION_BACKEND_MODE: "local",
  CLINE_NO_AUTO_UPDATE: "1",
};

function confineClineTarget(target: SpawnTarget, confinement: ProcessConfinement): SpawnTarget {
  const state = clineStatePaths();
  for (const folder of state.writable) mkdirSync(folder, { recursive: true, mode: 0o700 });
  return confineSpawnTarget(target, confinement, state);
}

const HERMES_ARGV: readonly string[] = ["acp"];

const HERMES_NOUS_SIGN_IN: readonly string[] = ["auth", "add", "nous", "--type", "oauth"];

const HERMES_SETUP_METHOD = "hermes-setup";
function requireHermesProvider(_connection: ClientSideConnection, initialization: InitializeResponse) {
  const methods = initialization.authMethods ?? [];
  return methods.length > 0 && methods.every((method) => method.id === HERMES_SETUP_METHOD)
    ? Effect.fail(providerFailure(RequestError.authRequired()))
    : Effect.void;
}

function confineHermesTarget(
  target: SpawnTarget,
  confinement: ProcessConfinement,
  env: NodeJS.ProcessEnv,
): SpawnTarget {
  mkdirSync(hermesHome(env), { recursive: true, mode: 0o700 });
  return confineSpawnTarget(target, confinement, hermesStatePaths(env));
}

const KIMI_ENV: Readonly<Record<string, string>> = { KIMI_CLI_NO_AUTO_UPDATE: "1" };

const KIMI_CODE_LOGIN_ENV: Readonly<Record<string, string>> =
  process.platform === "win32" ? KIMI_ENV : { ...KIMI_ENV, BROWSER: "true" };

function kimiLoginEnv(
  base: Readonly<Record<string, string>>,
  cli: AgentCliInfo,
  region: SignInRegion,
): Record<string, string> {
  return isPythonKimiCli(cli) ? { ...base, ...kimiPythonLoginEnv(region) } : { ...base };
}

const kimiSavedSignIn = (cli: AgentCliInfo, env: NodeJS.ProcessEnv) =>
  kimiSavedSignInVersion(isPythonKimiCli(cli), env);

function kimiProcessEnv(
  cli: AgentCliInfo,
  agentEnvironment: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const region = isPythonKimiCli(cli) ? kimiPythonSavedRegionEnv({ ...process.env, ...agentEnvironment }) : {};
  return { ...region, ...agentEnvironment };
}

function confineWithState(
  target: SpawnTarget,
  confinement: ProcessConfinement,
  statePaths: (env: NodeJS.ProcessEnv) => ProviderStatePaths,
  agentEnvironment: Readonly<Record<string, string>> | undefined,
): SpawnTarget {
  const state = statePaths({ ...process.env, ...agentEnvironment });
  for (const folder of state.writable) mkdirSync(folder, { recursive: true, mode: 0o700 });
  return confineSpawnTarget(target, confinement, state);
}

const DEVIN_ARGV: readonly string[] = ["acp"];

const COPILOT_ARGV: readonly string[] = ["--acp", "--no-auto-update"];

const MISTRAL_ENV: Readonly<Record<string, string>> = {
  VIBE_ENABLE_TELEMETRY: "false",
  VIBE_EXPERIMENTAL_ENABLE_MODEL_CATALOG: "true",
};

const MISTRAL_ARGV: readonly string[] = [];

export interface ProviderClientContext {
  apiKey(provider: AgentProviderId): string | null;
  readonly accountKeys?: ProviderAccountKeys;
  readonly history?: (provider: AgentProviderId) => AcpHistoryPersistence | undefined;
  readonly customProviders: CustomProviderSource;
  readonly mcpServers: McpServerSource;
  readonly reportMcpDrops?: McpDropReporter;
  readonly mcpToolRuntimes?: McpToolRuntimeSource;
  readonly mcpEndpoint?: McpEndpointSource;
  readonly mcpOAuth?: McpOAuthAuthority;
  readonly mcpOAuthProxySettings?: McpOAuthProxySettingsStore;
  readonly appVersion?: string;
  servesModel?(modelId: string): boolean;
  readonly providerStateDirectory?: string;
  readonly providerTempDirectory?: string;
  readonly availableDiskBytes?: (path: string) => number;
  readonly agentEnvironment?: (inherited?: NodeJS.ProcessEnv) => Readonly<Record<string, string>>;
  readonly serverEnvironment?: Readonly<Record<string, string>>;
  readonly accountEnvironment?: Readonly<Record<string, string>>;
  readonly customAgents?: CustomAgentSource;
  readonly promptCacheTtl?: () => PromptCacheTtl;
  readonly claudeUserSetup?: () => boolean;
  readonly claudeCompactWindow?: () => number | null;
  readonly codexTurnContext?: TurnContext;
  readonly providerEnvironment?: (provider: ProviderEnvironmentProvider) => Readonly<Record<string, string>>;
  readonly systemProxyFetch?: (url: string, init: RequestInit) => Promise<Response>;
  readonly fitImage?: ImageFitter | null;
}

const CODEX_ADDRESS_VARIABLE = "OPENAI_BASE_URL";

function codexVariableOverrides(variables: Readonly<Record<string, string>>): string[] {
  const baseUrl = variables[CODEX_ADDRESS_VARIABLE]?.trim().replace(/\/+$/, "");
  if (!baseUrl || !/^https?:\/\/[^/\s]+/.test(baseUrl) || /\s/.test(baseUrl)) return [];
  return [
    `model_provider=${CODEX_VARIABLE_PROVIDER}`,
    `model_providers.${CODEX_VARIABLE_PROVIDER}.name=OpenBot`,
    `model_providers.${CODEX_VARIABLE_PROVIDER}.base_url=${baseUrl}`,
    `model_providers.${CODEX_VARIABLE_PROVIDER}.wire_api=responses`,
    ...("OPENAI_API_KEY" in variables ? [`model_providers.${CODEX_VARIABLE_PROVIDER}.env_key=OPENAI_API_KEY`] : []),
  ];
}

function withAccountEnvironment(
  context: ProviderClientContext,
): ((inherited?: NodeJS.ProcessEnv) => Readonly<Record<string, string>>) | undefined {
  const { agentEnvironment, accountEnvironment } = context;
  if (!accountEnvironment) return agentEnvironment;
  return (inherited) => ({ ...agentEnvironment?.(inherited), ...accountEnvironment });
}

function claudeAgentEnvironment(
  context: ProviderClientContext,
): (inherited?: NodeJS.ProcessEnv) => Readonly<Record<string, string>> {
  const environment = withAccountEnvironment(context);
  return (inherited) => {
    const compactWindow = context.claudeCompactWindow?.() ?? null;
    return {
      ...((context.promptCacheTtl?.() ?? DEFAULT_PROMPT_CACHE_TTL.ttl) === "1h"
        ? { ENABLE_PROMPT_CACHING_1H: "1" }
        : {}),
      ...(compactWindow === null ? {} : { CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(compactWindow) }),
      ...environment?.(inherited),
      ...context.providerEnvironment?.("claude"),
    };
  };
}

function claudeFallbackApiKey(context: ProviderClientContext): (() => string | null) | undefined {
  if (context.accountEnvironment) return undefined;
  return () => {
    const variables = context.providerEnvironment?.("claude") ?? {};
    return "ANTHROPIC_API_KEY" in variables || "ANTHROPIC_AUTH_TOKEN" in variables ? null : context.apiKey("claude");
  };
}

export const NO_PROVIDER_CREDENTIALS: ProviderClientContext = {
  apiKey: () => null,
  customProviders: () => [],
  mcpServers: () => [],
};

interface ProviderModelCatalog {
  readonly paged?: true;
  readonly slowList?: true;
  readonly hiddenWhenSignedOut?: true;
  readonly ownOrder?: true;
  readonly partialListAtStart?: true;
  readonly relistAfterStart?: true;
  readonly relistWhileRunning?: true;
  modelName?(id: string): string | null;
  modelFields?(
    model: ModelListResponse["data"][number],
  ): Pick<AgentModelOption, "fastServiceTier" | "ultrafastServiceTier" | "steersTurns">;
  fallback?(previous: AgentModelOption[]): AgentModelOption[];
  source?(
    client: AgentClient,
    timeoutMs: number,
  ): Effect.Effect<{ source: ProviderModelSource | null; startSettings: string | null }, unknown>;
}

function steeringFields(model: ModelListResponse["data"][number]): Pick<AgentModelOption, "steersTurns"> {
  return model.steersTurns ? { steersTurns: true } : {};
}

export interface BuiltInProviderDriver {
  id: AgentProviderId;
  signIn: ProviderSignIn;
  signInFiles?(): readonly string[];
  codeSignIn?: ProviderCodeSignIn;
  accounts?: ProviderAccountSupport;
  signOut?: ProviderCliCommand;
  cliProvider?: AgentProviderId;
  catalog?: ProviderModelCatalog;
  resolveCli(options?: {
    bundledExecutable?: string | null | undefined;
  }): Effect.Effect<AgentCliInfo, ProviderClientOperationError>;
  createClient(
    cli: AgentCliInfo,
    requestTimeoutMs: number,
    context: ProviderClientContext,
    confinement?: ProcessConfinement,
  ): AgentClient;
  createProfileClient?(cli: AgentCliInfo, requestTimeoutMs: number, context: ProviderClientContext): AgentClient;
  createMediaClient?(cli: AgentCliInfo, requestTimeoutMs: number, context: ProviderClientContext): AgentClient;
  authState(account: AccountReadResult["account"]): AgentAuthState;
  validateAccount(account: NonNullable<AccountReadResult["account"]>): void;
}

function piClient(
  provider: "pi" | KeyOnlyProviderId,
  cli: AgentCliInfo,
  timeout: number,
  context: ProviderClientContext,
  confinement: ProcessConfinement | undefined,
): AgentClient {
  const history = context.history?.(provider);
  return new PiAgentClient(cli, {
    requestTimeoutMs: timeout,
    ...(confinement
      ? {
          confine: (target) => {
            const paths = piStatePaths();
            for (const path of paths.writable) mkdirSync(path, { recursive: true, mode: 0o700 });
            try {
              writeFileSync(join(piAgentDirectory(), "auth.json"), "{}", { flag: "wx", mode: 0o600 });
            } catch (error) {
              if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
            }
            return confineSpawnTarget(target, confinement, paths);
          },
        }
      : {}),
    extraEnv: () => ({ ...piCacheEnvironment(context), ...context.agentEnvironment?.() }),
    ...piKeyProvider(provider, context),
    ...(context.providerStateDirectory ? { providerStateDirectory: context.providerStateDirectory } : {}),
    mcpServers: context.mcpServers,
    ...(context.reportMcpDrops ? { reportMcpDrops: context.reportMcpDrops } : {}),
    ...(context.mcpToolRuntimes ? { mcpToolRuntimes: context.mcpToolRuntimes } : {}),
    ...(context.mcpEndpoint ? { mcpEndpoint: context.mcpEndpoint } : {}),
    ...(history ? { history } : {}),
  });
}

function piCacheEnvironment(context: ProviderClientContext): Readonly<Record<string, string>> {
  return (context.promptCacheTtl?.() ?? DEFAULT_PROMPT_CACHE_TTL.ttl) === "1h" ? { PI_CACHE_RETENTION: "long" } : {};
}

function piKeyProvider(provider: "pi" | KeyOnlyProviderId, context: ProviderClientContext) {
  return provider === "pi"
    ? { customEndpoints: customProvidersOn(context.customProviders, "pi") }
    : { keyProvider: { id: provider, apiKey: () => context.apiKey(provider) } };
}

function openCodeEndpoints(context: ProviderClientContext): CustomProviderSource {
  return customProvidersOn(context.customProviders, "opencode");
}

function piProfileClient(
  provider: "pi" | KeyOnlyProviderId,
  cli: AgentCliInfo,
  timeout: number,
  context: ProviderClientContext,
): AgentClient {
  return new PiAgentClient(cli, {
    requestTimeoutMs: timeout,
    profileGeneration: true,
    ...piKeyProvider(provider, context),
    ...(context.providerStateDirectory ? { providerStateDirectory: context.providerStateDirectory } : {}),
  });
}

export const BUILT_IN_PROVIDER_DRIVERS: readonly BuiltInProviderDriver[] = [
  {
    id: "pi",
    signIn: { kind: "terminal", timeoutMs: CLI_LOGIN_TIMEOUT_MS },
    signInFiles: () => ["auth.json", "models.json"].map((name) => join(piAgentDirectory(), name)),
    resolveCli: resolvePiCli,
    createClient: (cli, timeout, context, confinement) => piClient("pi", cli, timeout, context, confinement),
    createProfileClient: (cli, timeout, context) => piProfileClient("pi", cli, timeout, context),
    authState: (account) => ({ kind: "pi", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "inception",
    signIn: { kind: "external" },
    cliProvider: "pi",
    resolveCli: resolvePiCli,
    createClient: (cli, timeout, context, confinement) => piClient("inception", cli, timeout, context, confinement),
    createProfileClient: (cli, timeout, context) => piProfileClient("inception", cli, timeout, context),
    authState: (account) => ({ kind: "inception", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "deepseek",
    signIn: { kind: "external" },
    cliProvider: "pi",
    resolveCli: resolvePiCli,
    createClient: (cli, timeout, context, confinement) => piClient("deepseek", cli, timeout, context, confinement),
    createProfileClient: (cli, timeout, context) => piProfileClient("deepseek", cli, timeout, context),
    authState: (account) => ({ kind: "deepseek", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "openrouter",
    signIn: { kind: "external" },
    cliProvider: "pi",
    resolveCli: resolvePiCli,
    createClient: (cli, timeout, context, confinement) => piClient("openrouter", cli, timeout, context, confinement),
    createProfileClient: (cli, timeout, context) => piProfileClient("openrouter", cli, timeout, context),
    authState: (account) => ({ kind: "openrouter", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "muse",
    signIn: { kind: "muse-device", timeoutMs: CLI_LOGIN_TIMEOUT_MS },
    codeSignIn: { kind: "muse-device", timeoutMs: CLI_LOGIN_TIMEOUT_MS },
    signOut: { argv: ["logout"], env: () => ({ MUSE_NO_AUTO_UPDATE: "1" }), timeoutMs: 30_000 },
    resolveCli: resolveMuseCli,
    createClient: (cli, timeout, context, confinement) =>
      new MuseAgentClient(cli, {
        requestTimeoutMs: timeout,
        apiKey: () => context.apiKey("muse"),
        extraEnv: () => ({ ...context.agentEnvironment?.() }),
        readAccount: () =>
          readMuseAccount({ cli, apiKey: context.apiKey("muse"), extraEnv: { ...context.agentEnvironment?.() } }),
        ...(confinement
          ? {
              confine: (target) => {
                const paths = museStatePaths();
                for (const path of paths.writable)
                  mkdirSync(basename(path).startsWith("session-index.db") ? dirname(path) : path, {
                    recursive: true,
                    mode: 0o700,
                  });
                return confineSpawnTarget(target, confinement, paths);
              },
            }
          : {}),
        mcpServers: context.mcpServers,
        ...(context.reportMcpDrops ? { reportMcpDrops: context.reportMcpDrops } : {}),
        ...(context.mcpToolRuntimes ? { mcpToolRuntimes: context.mcpToolRuntimes } : {}),
        ...(context.mcpEndpoint ? { mcpEndpoint: context.mcpEndpoint } : {}),
      }),
    createProfileClient: (cli, timeout, context) =>
      new MuseAgentClient(cli, {
        requestTimeoutMs: timeout,
        apiKey: () => context.apiKey("muse"),
        profileGeneration: true,
      }),
    authState: (account) =>
      account?.type === "muse" ? { kind: "muse", email: account.email ?? null } : { kind: "unknown" },
    validateAccount: () => undefined,
  },
  {
    id: "codex",
    signIn: { kind: "browser" },
    codeSignIn: { kind: "codex-device" },
    accounts: {
      homeVariable: "CODEX_HOME",
      signIn: { argv: ["login"], env: () => ({}), timeoutMs: CLI_LOGIN_TIMEOUT_MS },
      codeSignIn: {
        flow: "device",
        command: { argv: ["login", "--device-auth"], env: () => ({}), timeoutMs: CLI_LOGIN_TIMEOUT_MS },
      },
      signOut: { argv: ["logout"], env: () => ({}), timeoutMs: 30_000 },
    },
    signInFiles: () => [join(codexHomeDirectory(), "auth.json")],
    catalog: { paged: true, modelFields: serviceTierFields, source: readCodexModelSource, relistWhileRunning: true },
    resolveCli: resolveCodexCli,
    createClient: (cli, requestTimeoutMs, context) => {
      const { SSL_CERT_FILE: _openBotRoots, ...serverEnvironment } = context.serverEnvironment ?? {};
      const variables = context.providerEnvironment?.("codex") ?? {};
      const overrides = codexVariableOverrides(variables);
      return new CodexAppServerClient(
        cli.executable,
        requestTimeoutMs,
        {
          ...cliPathEnvironment(cli),
          ...serverEnvironment,
          ...context.accountEnvironment,
          ...variables,
        },
        context.codexTurnContext,
        overrides,
        overrides.length > 0 ? CODEX_ADDRESS_VARIABLE : undefined,
      );
    },
    authState: (account) => ({ kind: "chatgpt", email: account?.email ?? null }),
    validateAccount: (account) => {
      if (!isCodexLoginType(account.type)) {
        throw new Error(sourceText("error.provider.codexLoginRequired"));
      }
    },
  },
  {
    id: "claude",
    signIn: { kind: "cli-command", command: CLAUDE_SIGN_IN },
    codeSignIn: { kind: "cli", flow: "paste", command: CLAUDE_CODE_SIGN_IN },
    accounts: {
      homeVariable: "CLAUDE_CONFIG_DIR",
      signIn: CLAUDE_SIGN_IN,
      codeSignIn: { flow: "paste", command: CLAUDE_CODE_SIGN_IN },
      signOut: { argv: ["auth", "logout"], env: CLAUDE_COMMAND_ENV, timeoutMs: 30_000 },
    },
    catalog: { modelName: claudeModelName, modelFields: serviceTierFields },
    resolveCli: resolveClaudeCli,
    createClient: (cli, requestTimeoutMs, context) =>
      new ClaudeAgentClient(
        cli,
        undefined,
        undefined,
        requestTimeoutMs,
        context.mcpServers,
        context.reportMcpDrops,
        context.mcpToolRuntimes,
        context.mcpEndpoint,
        context.providerStateDirectory,
        claudeAgentEnvironment(context),
        undefined,
        claudeFallbackApiKey(context),
        context.claudeUserSetup,
      ),
    authState: (account) => ({ kind: "claude", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "grok",
    signIn: {
      kind: "cli-command",
      command: {
        argv: ["--no-auto-update", "login"],
        env: () => ({ GROK_OAUTH2_REFERRER: "openbot" }),
        timeoutMs: CLI_LOGIN_TIMEOUT_MS,
      },
    },
    codeSignIn: { kind: "cli", flow: "device", command: GROK_CODE_SIGN_IN },
    accounts: {
      homeVariable: "GROK_HOME",
      signIn: {
        argv: ["--no-auto-update", "login"],
        env: () => ({ GROK_OAUTH2_REFERRER: "openbot" }),
        timeoutMs: CLI_LOGIN_TIMEOUT_MS,
      },
      codeSignIn: { flow: "device", command: GROK_CODE_SIGN_IN },
    },
    signInFiles: () => [join(grokHomeDirectory(), "auth.json")],
    signOut: { argv: ["--no-auto-update", "logout"], env: () => ({}), timeoutMs: 30_000 },
    resolveCli: resolveGrokCli,
    createClient: (cli, requestTimeoutMs, context, confinement) =>
      new GrokAgentClient(
        cli,
        requestTimeoutMs,
        false,
        context.mcpServers,
        context.reportMcpDrops,
        context.mcpToolRuntimes,
        context.mcpEndpoint,
        confinement,
        withAccountEnvironment(context),
        context.history?.("grok"),
        context.fitImage,
        () => discoveryFolder("grok"),
      ),
    createProfileClient: (cli, requestTimeoutMs, { accountEnvironment }) =>
      new GrokAgentClient(
        cli,
        requestTimeoutMs,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        accountEnvironment && (() => accountEnvironment),
        undefined,
        undefined,
        () => discoveryFolder("grok"),
      ),
    createMediaClient: (cli, requestTimeoutMs, { accountEnvironment }) =>
      new GrokAgentClient(
        cli,
        requestTimeoutMs,
        "media",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        accountEnvironment && (() => accountEnvironment),
        undefined,
        undefined,
        () => discoveryFolder("grok"),
      ),
    authState: (account) => ({ kind: "grok", email: account?.email ?? null }),
    validateAccount: () => undefined,
    catalog: { partialListAtStart: true, relistAfterStart: true },
  },
  {
    id: "opencode",
    signIn: { kind: "external" },
    catalog: {
      hiddenWhenSignedOut: true,
      partialListAtStart: true,
      relistAfterStart: true,
      modelFields: steeringFields,
      fallback: modelsAfterOpenCodeDiscoveryFailure,
    },
    resolveCli: resolveOpencodeCli,
    createClient: (cli, timeout, context, confinement) =>
      new AcpAgentClient(cli, timeout, {
        provider: "opencode",
        flavor: OPENCODE_ACP_FLAVOR,
        argv: ["acp"],
        env: {},
        ...(confinement ? { confine: (target) => confineSpawnTarget(target, confinement, openCodeStatePaths()) } : {}),
        extraEnv: () => {
          const agentEnvironment = context.agentEnvironment?.();
          return {
            ...agentEnvironment,
            ...opencodeEnv(cli),
            ...openCodeAgentDefaultsEnv(
              context.providerStateDirectory,
              { ...process.env, ...agentEnvironment },
              cli.version,
            ),
            ...openCodeConfigEnv(OPENCODE_AGENT_CONFIG, openCodeEndpoints(context), context.apiKey("opencode")),
            ...(confinement ? OPENCODE_CONFINED_ENV : {}),
          };
        },
        signInMessage: openCodeSignInMessage(openCodeEndpoints(context)().length),
        modelName: (id, name) => openCodeModelName(id, name, openCodeEndpoints(context)),
        customEndpoint: (modelId) => {
          const endpoint = customProviderOfModel(modelId, openCodeEndpoints(context)());
          const contextWindow = endpoint?.models.find(
            (model) => composedCustomModelId(endpoint.id, model.id) === modelId,
          )?.contextWindow;
          return endpoint
            ? {
                name: endpoint.name,
                hasCredentials: Boolean(endpoint.apiKey) || endpoint.headers.length > 0,
                stallMs: CUSTOM_ENDPOINT_SILENCE_MS,
                ...(contextWindow === undefined ? {} : { contextWindow }),
              }
            : null;
        },
        savedKey: (modelId) =>
          Boolean(context.apiKey("opencode")) && (modelId?.toLowerCase().startsWith("opencode-go/") ?? false),
        providerKeyStored: (provider) =>
          Effect.runSync(hasOpenCodeProviderKey(provider, { ...process.env, ...context.agentEnvironment?.() })),
        providerRefusalStatus: (sessionId) =>
          Effect.runSync(readOpenCodeRefusalStatus(sessionId, { ...process.env, ...context.agentEnvironment?.() })),
        servesModel: context.servesModel,
        mcpServers: context.mcpServers,
        fitImage: context.fitImage,
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpEndpoint: context.mcpEndpoint,
        readRateLimits: () =>
          readOpenCodeGoUsage(context.apiKey("opencode")).pipe(
            Effect.mapError((failure) => providerFailure(failure.cause)),
          ),
        steer: steerAcpSession,
        steers: acpSessionSteers,
        history: context.history?.("opencode"),
      }),
    createProfileClient: (cli, timeout, context) =>
      new AcpAgentClient(cli, timeout, {
        provider: "opencode",
        flavor: OPENCODE_ACP_FLAVOR,
        argv: ["acp"],
        profileGeneration: true,
        env: {},
        extraEnv: () => ({
          ...opencodeEnv(cli),
          ...openCodeConfigEnv(OPENCODE_PROFILE_CONFIG, openCodeEndpoints(context), context.apiKey("opencode")),
        }),
        signInMessage: openCodeSignInMessage(openCodeEndpoints(context)().length),
        modelName: (id, name) => openCodeModelName(id, name, openCodeEndpoints(context)),
        servesModel: context.servesModel,
      }),
    authState: (account) => ({ kind: "opencode", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "antigravity",
    signIn: ANTIGRAVITY_SIGN_IN,
    codeSignIn: { kind: "cli", flow: "paste", command: ANTIGRAVITY_CODE_SIGN_IN },
    accounts: {
      homeVariable: "GEMINI_HOME",
      signIn: ANTIGRAVITY_SIGN_IN,
      supports: (cli) => antigravityTakesStateFolders(cli.version),
      usageLeavesSession: true,
    },
    signOut: {
      argv: antigravityArgv(process.env),
      env: () => ({ ...ANTIGRAVITY_ENV }),
      timeoutMs: 30_000,
      acpLogout: true,
    },
    catalog: { slowList: true, ownOrder: true, relistWhileRunning: true },
    resolveCli: resolveAntigravityCli,
    createClient: (cli, timeout, context, confinement) =>
      new AcpAgentClient(cli, timeout, {
        provider: "antigravity",
        flavor: ANTIGRAVITY_ACP_FLAVOR,
        argv: antigravityArgv({ ...process.env, ...context.accountEnvironment }),
        env: ANTIGRAVITY_ENV,
        discoveryCwd: () => discoveryFolder("antigravity"),
        privateTemp: antigravityTemp(context),
        ...(confinement
          ? { confine: (target) => confineSpawnTarget(target, confinement, antigravityAccountStatePaths(context)) }
          : {}),
        ...antigravityKeyOptions(context, true),
        signInMessage: sourceText("error.provider.antigravitySignIn"),
        servesModel: context.servesModel,
        mcpServers: context.mcpServers,
        fitImage: context.fitImage,
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpEndpoint: context.mcpEndpoint,
        history: context.history?.("antigravity"),
        readAccount: () =>
          antigravityUsesSavedKey(context)
            ? Effect.succeed({ email: null })
            : readAntigravityEmail(antigravityTokenFile(context)).pipe(Effect.map((email) => ({ email }))),
        readRateLimits: (_connection, model) =>
          antigravityUsesSavedKey(context)
            ? Effect.succeed({ rateLimits: null, rateLimitsByLimitId: null })
            : readAntigravityQuota({
                tokenFile: antigravityTokenFile(context),
                model,
                ...(context.systemProxyFetch ? { fetch: context.systemProxyFetch } : {}),
              }),
        readVerificationLink: () =>
          antigravityUsesSavedKey(context)
            ? Effect.succeed(null)
            : readAntigravityValidationLink({
                tokenFile: antigravityTokenFile(context),
                fetch: context.systemProxyFetch,
              }),
      }),
    createProfileClient: (cli, timeout, context) =>
      new AcpAgentClient(cli, timeout, {
        provider: "antigravity",
        flavor: ANTIGRAVITY_ACP_FLAVOR,
        argv: antigravityArgv({ ...process.env, ...context.accountEnvironment }),
        env: ANTIGRAVITY_ENV,
        profileGeneration: true,
        discoveryCwd: () => discoveryFolder("antigravity"),
        privateTemp: antigravityTemp(context),
        ...antigravityKeyOptions(context, false),
        signInMessage: sourceText("error.provider.antigravitySignIn"),
        servesModel: context.servesModel,
      }),
    authState: (account) => ({ kind: "antigravity", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "cursor",
    signIn: { kind: "acp-authenticate", methodId: "cursor_login", argv: ["acp"], timeoutMs: CLI_LOGIN_TIMEOUT_MS },
    codeSignIn: {
      kind: "cli",
      flow: "link",
      command: { argv: ["login"], env: () => ({ NO_OPEN_BROWSER: "1" }), timeoutMs: CLI_LOGIN_TIMEOUT_MS },
    },
    signOut: { argv: ["logout"], env: () => ({}), timeoutMs: 30_000 },
    accounts: {
      keyEnvironment: (key) => ({ CURSOR_API_KEY: key, CURSOR_AUTH_TOKEN: "", AGENT_CLI_CREDENTIAL_STORE: "memory" }),
      checkKey: checkCursorApiKey,
      supports: (cli) => cli.version >= CURSOR_KEY_ACCOUNTS_MIN_VERSION,
    },
    resolveCli: resolveCursorCli,
    createClient: (cli, timeout, context, confinement) =>
      new AcpAgentClient(cli, timeout, {
        provider: "cursor",
        flavor: CURSOR_ACP_FLAVOR,
        argv: ["acp"],
        env: {},
        ...(confinement ? { confine: (target) => confineSpawnTarget(target, confinement, cursorStatePaths()) } : {}),
        extraEnv: () => ({
          ...context.agentEnvironment?.(),
          ...(confinement ? cursorConfinedEnv() : {}),
          ...context.accountEnvironment,
        }),
        signInMessage: sourceText("error.provider.cursorSignIn"),
        ...(context.accountEnvironment
          ? { savedKeyRefusedMessage: () => sourceText("error.provider.accountKeyRefused", { provider: "Cursor" }) }
          : {
              readRateLimits: () =>
                readCursorUsage().pipe(Effect.mapError((failure) => providerFailure(failure.cause))),
            }),
        servesModel: context.servesModel,
        mcpServers: context.mcpServers,
        fitImage: context.fitImage,
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpEndpoint: context.mcpEndpoint,
        history: context.history?.("cursor"),
      }),
    createProfileClient: (cli, timeout, context) =>
      new AcpAgentClient(cli, timeout, {
        provider: "cursor",
        flavor: CURSOR_ACP_FLAVOR,
        argv: ["acp"],
        profileGeneration: true,
        env: {},
        ...(context.accountEnvironment ? { extraEnv: () => ({ ...context.accountEnvironment }) } : {}),
        signInMessage: sourceText("error.provider.cursorSignIn"),
        servesModel: context.servesModel,
      }),
    authState: (account) => ({ kind: "cursor", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "cline",
    signIn: {
      kind: "acp-authenticate",
      methodId: "cline",
      argv: CLINE_ARGV,
      env: CLINE_ENV,
      timeoutMs: CLI_LOGIN_TIMEOUT_MS,
    },
    codeSignIn: {
      kind: "cli",
      flow: "device",
      command: { argv: ["auth", "-p", "cline"], env: () => ({ ...CLINE_ENV }), timeoutMs: CLI_LOGIN_TIMEOUT_MS },
    },
    resolveCli: resolveClineCli,
    createClient: (cli, timeout, context, confinement) =>
      new AcpAgentClient(cli, timeout, {
        provider: "cline",
        flavor: CLINE_ACP_FLAVOR,
        argv: CLINE_ARGV,
        env: { ...CLINE_ENV },
        ...(confinement ? { confine: (target) => confineClineTarget(target, confinement) } : {}),
        extraEnv: () => ({ ...context.agentEnvironment?.() }),
        additionalModels: clineFreeModels(),
        encodesModelIds: true,
        signInMessage: sourceText("error.provider.clineSignIn"),
        servesModel: context.servesModel,
        mcpServers: context.mcpServers,
        fitImage: context.fitImage,
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpEndpoint: context.mcpEndpoint,
        history: context.history?.("cline"),
      }),
    createProfileClient: (cli, timeout, context) =>
      new AcpAgentClient(cli, timeout, {
        provider: "cline",
        flavor: CLINE_ACP_FLAVOR,
        argv: CLINE_ARGV,
        profileGeneration: true,
        env: { ...CLINE_ENV },
        additionalModels: clineFreeModels(),
        encodesModelIds: true,
        signInMessage: sourceText("error.provider.clineSignIn"),
        servesModel: context.servesModel,
      }),
    authState: (account) => ({ kind: "cline", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "kimi",
    signIn: {
      kind: "cli-command",
      command: {
        argv: (cli, region) => kimiLoginArgs(cli, kimiLoginEnv(KIMI_ENV, cli, region), { code: false, region }),
        env: (cli, region) => kimiLoginEnv(KIMI_ENV, cli, region),
        savedSignIn: kimiSavedSignIn,
        timeoutMs: CLI_LOGIN_TIMEOUT_MS,
      },
    },
    codeSignIn: {
      kind: "cli",
      flow: "device",
      command: {
        argv: (cli, region) =>
          kimiLoginArgs(cli, kimiLoginEnv(KIMI_CODE_LOGIN_ENV, cli, region), { code: true, region }),
        env: (cli, region) => kimiLoginEnv(KIMI_CODE_LOGIN_ENV, cli, region),
        savedSignIn: kimiSavedSignIn,
        timeoutMs: CLI_LOGIN_TIMEOUT_MS,
      },
    },
    signOut: { argv: ["logout"], env: () => ({ ...KIMI_ENV }), timeoutMs: 30_000 },
    resolveCli: resolveKimiCli,
    createClient: (cli, timeout, context, confinement) =>
      new AcpAgentClient(cli, timeout, {
        provider: "kimi",
        flavor: KIMI_ACP_FLAVOR,
        argv: ["acp"],
        env: { ...KIMI_ENV },
        ...(confinement
          ? {
              confine: (target) =>
                confineWithState(
                  target,
                  confinement,
                  isPythonKimiCli(cli) ? kimiStatePaths : kimiCodeStatePaths,
                  context.agentEnvironment?.(),
                ),
            }
          : {}),
        extraEnv: () => kimiProcessEnv(cli, context.agentEnvironment?.()),
        signInMessage: sourceText("error.provider.kimiSignIn"),
        servesModel: context.servesModel,
        mcpServers: context.mcpServers,
        fitImage: context.fitImage,
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpEndpoint: context.mcpEndpoint,
        history: context.history?.("kimi"),
        readRateLimits: () =>
          readKimiUsage(isPythonKimiCli(cli), { ...process.env, ...context.agentEnvironment?.() }).pipe(
            Effect.mapError((failure) => providerFailure(failure.cause)),
          ),
        ...(isPythonKimiCli(cli)
          ? { savedSignInCheck: kimiSavedSignInCheck(() => ({ ...process.env, ...context.agentEnvironment?.() })) }
          : {}),
      }),
    createProfileClient: (cli, timeout, context) =>
      new AcpAgentClient(cli, timeout, {
        provider: "kimi",
        flavor: KIMI_ACP_FLAVOR,
        argv: ["acp"],
        profileGeneration: true,
        env: { ...KIMI_ENV },
        extraEnv: () => kimiProcessEnv(cli, undefined),
        signInMessage: sourceText("error.provider.kimiSignIn"),
        servesModel: context.servesModel,
      }),
    authState: (account) => ({ kind: "kimi", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "devin",
    signIn: { kind: "acp-authenticate", methodId: "devin-browser", argv: DEVIN_ARGV, timeoutMs: CLI_LOGIN_TIMEOUT_MS },
    signInFiles: () => [join(devinDataDirectory(), "credentials.toml")],
    signOut: { argv: ["auth", "logout"], env: () => ({}), timeoutMs: 30_000 },
    resolveCli: resolveDevinCli,
    createClient: (cli, timeout, context, confinement) =>
      new AcpAgentClient(cli, timeout, {
        provider: "devin",
        flavor: DEVIN_ACP_FLAVOR,
        argv: DEVIN_ARGV,
        env: {},
        ...(confinement
          ? {
              confine: (target) => confineWithState(target, confinement, devinStatePaths, context.agentEnvironment?.()),
            }
          : {}),
        extraEnv: () => ({ ...context.agentEnvironment?.() }),
        signInMessage: sourceText("error.provider.devinSignIn"),
        noModelsWhenSignedOut: true,
        servesModel: context.servesModel,
        mcpServers: context.mcpServers,
        fitImage: context.fitImage,
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpEndpoint: context.mcpEndpoint,
        history: context.history?.("devin"),
      }),
    createProfileClient: (cli, timeout, context) =>
      new AcpAgentClient(cli, timeout, {
        provider: "devin",
        flavor: DEVIN_ACP_FLAVOR,
        argv: DEVIN_ARGV,
        profileGeneration: true,
        env: {},
        signInMessage: sourceText("error.provider.devinSignIn"),
        noModelsWhenSignedOut: true,
        servesModel: context.servesModel,
      }),
    authState: (account) => ({ kind: "devin", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "copilot",
    signIn: {
      kind: "cli-command",
      command: { argv: ["login"], env: () => ({ ...COPILOT_ENV }), timeoutMs: CLI_LOGIN_TIMEOUT_MS },
    },
    codeSignIn: {
      kind: "cli",
      flow: "device",
      command: {
        argv: ["login", "--device-code"],
        env: () => ({ ...COPILOT_ENV }),
        timeoutMs: CLI_LOGIN_TIMEOUT_MS,
        closeInput: true,
      },
    },
    signOut: { argv: COPILOT_ARGV, env: () => ({ ...COPILOT_ENV }), timeoutMs: 30_000, acpLogout: true },
    signInFiles: () => [join(copilotHomeDirectory(), "config.json")],
    catalog: { relistWhileRunning: true },
    resolveCli: resolveCopilotCli,
    createClient: (cli, timeout, context, confinement) =>
      new AcpAgentClient(cli, timeout, {
        provider: "copilot",
        flavor: COPILOT_ACP_FLAVOR,
        argv: COPILOT_ARGV,
        env: { ...COPILOT_ENV },
        ...(confinement
          ? {
              confine: (target) =>
                confineWithState(target, confinement, copilotStatePaths, context.agentEnvironment?.()),
            }
          : {}),
        extraEnv: () => ({ ...context.agentEnvironment?.(), ...(confinement ? COPILOT_CONFINED_ENV : {}) }),
        signInMessage: sourceText("error.provider.copilotSignIn"),
        noModelsWhenSignedOut: true,
        servesModel: context.servesModel,
        mcpServers: context.mcpServers,
        fitImage: context.fitImage,
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpEndpoint: context.mcpEndpoint,
        history: context.history?.("copilot"),
      }),
    createProfileClient: (cli, timeout, context) =>
      new AcpAgentClient(cli, timeout, {
        provider: "copilot",
        flavor: COPILOT_ACP_FLAVOR,
        argv: COPILOT_ARGV,
        profileGeneration: true,
        env: { ...COPILOT_ENV },
        signInMessage: sourceText("error.provider.copilotSignIn"),
        noModelsWhenSignedOut: true,
        servesModel: context.servesModel,
      }),
    authState: (account) => ({ kind: "copilot", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "mistral",
    signIn: {
      kind: "acp-authenticate",
      methodId: "browser-auth",
      argv: MISTRAL_ARGV,
      env: MISTRAL_ENV,
      timeoutMs: CLI_LOGIN_TIMEOUT_MS,
    },
    codeSignIn: {
      kind: "acp-delegated",
      methodId: "browser-auth-delegated",
      argv: MISTRAL_ARGV,
      env: MISTRAL_ENV,
      timeoutMs: CLI_LOGIN_TIMEOUT_MS,
    },
    signOut: { argv: MISTRAL_ARGV, env: () => ({ ...MISTRAL_ENV }), timeoutMs: 30_000, acpLogout: "_auth/signOut" },
    signInFiles: () => [join(mistralHomeDirectory(), ".env"), join(mistralHomeDirectory(), "config.toml")],
    resolveCli: resolveMistralCli,
    createClient: (cli, timeout, context, confinement) =>
      new AcpAgentClient(cli, timeout, {
        provider: "mistral",
        flavor: MISTRAL_ACP_FLAVOR,
        argv: MISTRAL_ARGV,
        env: { ...MISTRAL_ENV },
        ...(confinement
          ? {
              confine: (target) =>
                confineWithState(target, confinement, mistralStatePaths, context.agentEnvironment?.()),
            }
          : {}),
        extraEnv: () => ({ ...context.agentEnvironment?.() }),
        signInMessage: sourceText("error.provider.mistralSignIn"),
        servesModel: context.servesModel,
        mcpServers: context.mcpServers,
        fitImage: context.fitImage,
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpEndpoint: context.mcpEndpoint,
        history: context.history?.("mistral"),
      }),
    createProfileClient: (cli, timeout, context) =>
      new AcpAgentClient(cli, timeout, {
        provider: "mistral",
        flavor: MISTRAL_ACP_FLAVOR,
        argv: MISTRAL_ARGV,
        profileGeneration: true,
        env: { ...MISTRAL_ENV },
        signInMessage: sourceText("error.provider.mistralSignIn"),
        servesModel: context.servesModel,
      }),
    authState: (account) => ({ kind: "mistral", email: account?.email ?? null }),
    validateAccount: () => undefined,
    catalog: { partialListAtStart: true, relistAfterStart: true },
  },
  {
    id: "hermes",
    signIn: {
      kind: "cli-command",
      command: { argv: HERMES_NOUS_SIGN_IN, env: () => ({}), timeoutMs: CLI_LOGIN_TIMEOUT_MS },
    },
    codeSignIn: {
      kind: "cli",
      flow: "device",
      command: {
        argv: [...HERMES_NOUS_SIGN_IN, "--no-browser"],
        env: () => ({}),
        timeoutMs: CLI_LOGIN_TIMEOUT_MS,
        closeInput: true,
      },
    },
    signInFiles: () => ["auth.json", ".env", "config.yaml"].map((name) => join(hermesHome(), name)),
    resolveCli: () => resolveHermesCli(),
    createClient: (cli, timeout, context, confinement) =>
      new AcpAgentClient(cli, timeout, {
        provider: "hermes",
        flavor: HERMES_ACP_FLAVOR,
        argv: HERMES_ARGV,
        env: {},
        ...(confinement
          ? {
              confine: (target) =>
                confineHermesTarget(target, confinement, { ...process.env, ...context.agentEnvironment?.() }),
            }
          : {}),
        extraEnv: () => {
          const agentEnvironment = context.agentEnvironment?.() ?? {};
          return {
            ...hermesSettingsEnvironment({ ...process.env, ...agentEnvironment }, context.providerStateDirectory),
            ...agentEnvironment,
          };
        },
        signInMessage: sourceText("error.provider.hermesSignIn"),
        authenticate: requireHermesProvider,
        servesModel: context.servesModel,
        mcpServers: context.mcpServers,
        fitImage: context.fitImage,
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpEndpoint: context.mcpEndpoint,
        history: context.history?.("hermes"),
      }),
    createProfileClient: (cli, timeout, context) =>
      new AcpAgentClient(cli, timeout, {
        provider: "hermes",
        flavor: HERMES_ACP_FLAVOR,
        argv: HERMES_ARGV,
        profileGeneration: true,
        env: {},
        extraEnv: () => hermesSettingsEnvironment(process.env, context.providerStateDirectory),
        signInMessage: sourceText("error.provider.hermesSignIn"),
        authenticate: requireHermesProvider,
        servesModel: context.servesModel,
      }),
    authState: (account) => ({ kind: "hermes", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "acp",
    signIn: { kind: "external" },
    catalog: {
      slowList: true,
      partialListAtStart: true,
      relistAfterStart: true,
      modelFields: steeringFields,
    },
    resolveCli: () => Effect.succeed(CUSTOM_AGENTS_CLI),
    createClient: (_cli, timeout, context, confinement) =>
      new CustomAcpAgentsClient(
        () => savedCustomAgents(context),
        (config, executable, folder, history, launchPath) =>
          customAgentChild(config, executable, folder, timeout, context, confinement, false, history, launchPath),
        undefined,
        context.history?.("acp"),
        confinement !== undefined,
      ),
    createProfileClient: (_cli, timeout, context) =>
      new CustomAcpAgentsClient(
        () => savedCustomAgents(context),
        (config, executable, folder, history, launchPath) =>
          customAgentChild(config, executable, folder, timeout, context, undefined, true, history, launchPath),
        undefined,
        context.history?.("acp"),
      ),
    authState: () => ({ kind: "acp", email: null }),
    validateAccount: () => undefined,
  },
] as const;

function customAgentChild(
  config: CustomAgentConfig,
  executable: string,
  folder: string | null,
  timeout: number,
  context: ProviderClientContext,
  confinement: ProcessConfinement | undefined,
  profileGeneration: boolean,
  history?: AcpHistoryPersistence,
  launchPath?: string | null,
): AgentClient {
  const env = {
    ...(launchPath ? { PATH: launchPath } : {}),
    ...Object.fromEntries(config.env.map((entry) => [entry.name, entry.value])),
  };
  const values = config.env.map((entry) => entry.value);
  return new AcpAgentClient({ executable, version: "", source: "system" }, timeout, {
    provider: "acp",
    flavor: customAgentFlavor(config.command),
    label: config.name,
    allowNoModels: true,
    discoveryCwd: () => folder ?? discoveryFolder(config.id),
    redactValues: () => values,
    argv: config.args,
    env,
    ...(profileGeneration ? { profileGeneration: true } : {}),
    history: profileGeneration ? undefined : history,
    ...(confinement ? { confine: (target) => confineSpawnTarget(target, confinement, customAgentStatePaths()) } : {}),
    signInMessage: sourceText("error.provider.customAgentSignIn"),
    servesModel: () => savedCustomAgents(context).some((saved) => saved.id === config.id),
    steer: steerAcpSession,
    steers: acpSessionSteers,
    ...(profileGeneration
      ? {}
      : {
          extraEnv: () =>
            Object.fromEntries(
              Object.entries(context.agentEnvironment?.({ ...process.env, ...env }) ?? {}).filter(
                ([name]) =>
                  name.startsWith("GIT_CONFIG_") ||
                  !(name in env || (name === "SSL_CERT_FILE" && "SSL_CERT_DIR" in env)),
              ),
            ),
          mcpServers: context.mcpServers,
          fitImage: context.fitImage,
          reportMcpDrops: context.reportMcpDrops,
          mcpToolRuntimes: context.mcpToolRuntimes,
          mcpEndpoint: context.mcpEndpoint,
        }),
  });
}

export function savedCustomAgents(context: ProviderClientContext): readonly CustomAgentConfig[] {
  return context.customAgents?.() ?? [];
}

let customAgentDiscoveryRoot: string | undefined;

function discoveryFolder(agentId: string): string {
  customAgentDiscoveryRoot ??= mkdtempSync(join(tmpdir(), "openbot-custom-agents-"));
  const folder = join(customAgentDiscoveryRoot, agentId);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  return folder;
}

const CUSTOM_AGENTS_CLI: AgentCliInfo = { executable: "", version: "", source: "system" };

const PROVIDER_DRIVERS = new Map(BUILT_IN_PROVIDER_DRIVERS.map((driver) => [driver.id, driver]));

export function requireProviderDriver(provider: AgentProviderId): BuiltInProviderDriver {
  const driver = PROVIDER_DRIVERS.get(provider);
  if (!driver) throw new Error(`Unknown agent provider: ${provider}`);
  return driver;
}
