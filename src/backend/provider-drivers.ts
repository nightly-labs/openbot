import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { AgentAuthState, AgentProviderId } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { AcpAgentClient, type AcpHistoryPersistence } from "./acp-client";
import type { AgentClient } from "./agent-client";
import { CodexAppServerClient } from "./app-server-client";
import { ClaudeAgentClient } from "./claude-client";
import {
  type AgentCliInfo,
  resolveAntigravityCli,
  resolveClaudeCli,
  resolveClineCli,
  resolveCodexCli,
  resolveCursorCli,
  resolveGrokCli,
  resolveMuseCli,
  resolveOpencodeCli,
  resolvePiCli,
} from "./cli";
import { CustomAcpAgentsClient, type CustomAgentConfig, type CustomAgentSource } from "./custom-acp-agents-client";
import { GrokAgentClient } from "./grok-client";
import type { McpOAuthAuthority } from "./mcp-oauth-provider";
import type {
  McpAuthorizationSource,
  McpDropReporter,
  McpServerSource,
  McpToolRuntimeSource,
} from "./mcp-provider-shapes";
import { MuseAgentClient } from "./muse-client";
import {
  type CustomProviderSource,
  OPENCODE_PROFILE_CONFIG,
  openCodeConfigEnv,
  openCodeSignInMessage,
} from "./opencode-config";
import { readOpenCodeGoUsage } from "./opencode-usage";
import { PiAgentClient } from "./pi-client";
import {
  antigravityStatePaths,
  clineStatePaths,
  confineSpawnTarget,
  cursorConfinedEnv,
  cursorStatePaths,
  customAgentStatePaths,
  museStatePaths,
  OPENCODE_CONFINED_ENV,
  openCodeStatePaths,
  type ProcessConfinement,
  piStatePaths,
  type SpawnTarget,
} from "./process-confinement";
import type { AccountReadResult } from "./protocol";
import { type ProviderClientOperationError, providerFailure } from "./provider-client-effects";

/** One command OpenBot runs against a provider's own CLI, waiting for the process to exit. */
export interface ProviderCliCommand {
  readonly argv: readonly string[];
  readonly env: (cli: AgentCliInfo) => Record<string, string>;
  readonly timeoutMs: number;
}

const CLI_LOGIN_TIMEOUT_MS = 10 * 60_000;

/**
 * The environment one OpenCode process gets, read at spawn time.
 *
 * `OPENCODE_API_KEY` is the whole of the optional account: with it the CLI lists the paid Go
 * catalog, without it the free one. `OPENCODE_DISABLE_AUTOUPDATE` is not optional on a managed
 * install -- a CLI that updates itself past the pin fails the exact-version compare in
 * `verifyInstalledRuntime`, and OpenBot would then keep re-downloading a runtime it already has.
 */
function opencodeEnv(cli: AgentCliInfo, credentials: ProviderClientContext): Record<string, string> {
  const key = credentials.apiKey("opencode");
  return {
    ...(key ? { OPENCODE_API_KEY: key } : {}),
    ...(cli.source === "managed" ? { OPENCODE_DISABLE_AUTOUPDATE: "1" } : {}),
  };
}

/**
 * How a provider is signed in. This used to be an optional `cliLogin` field, and its absence meant
 * "this is Codex": two call sites ran the Codex browser login for any driver without one, so a
 * provider that simply had nothing to spawn would have opened a ChatGPT login. The union makes each
 * answer say what it is, and a new arm is a compile error at both sites rather than a wrong login.
 */
type ProviderSignIn =
  /** The provider's own protocol hands back a URL for OpenBot to open. */
  | { kind: "browser" }
  /** OpenBot spawns the provider's CLI and waits for the process to exit. */
  | { kind: "cli-command"; command: ProviderCliCommand }
  /** The user signs in with the CLI themselves; OpenBot only re-probes the provider afterwards. */
  | { kind: "external" }
  /** The host opens an interactive terminal and refreshes the account when it closes. */
  | { kind: "terminal"; timeoutMs: number }
  /**
   * OpenBot starts the ACP server and calls `authenticate` with this method, which opens a browser
   * from the server. Only the sign-in process calls it: in a status probe it would open a browser.
   */
  | {
      kind: "acp-authenticate";
      methodId: string;
      argv: readonly string[];
      env?: Readonly<Record<string, string>>;
      timeoutMs: number;
    };

/**
 * A sign-in the user finishes on another device, for a host with no browser the user can see.
 * `codex-device` is the Codex app-server device code. `cli` spawns the provider's CLI and reads its
 * link: `device` prints a code the user confirms, `paste` waits for the code the provider's page
 * shows, which the user copies back, and `link` is a page that signs the CLI in by itself.
 */
type ProviderCodeSignIn =
  | { kind: "codex-device" }
  | { kind: "cli"; flow: "device" | "paste" | "link"; command: ProviderCliCommand };

/**
 * Google's registry starts the Linux build with an empty `--uid=`, and the other builds with no
 * argument. OpenBot starts it the same way.
 */
const ANTIGRAVITY_ARGV: readonly string[] = process.platform === "linux" ? ["--uid="] : [];

const CLINE_ARGV: readonly string[] = ["--acp"];

/**
 * By default, the Cline CLI runs its sessions in a hub process that it detaches and that other Cline
 * processes share. That process would outlive OpenBot and would escape a Workspace only sandbox, so
 * every Cline process runs its sessions in itself. The managed CLI must not replace itself.
 */
const CLINE_ENV: Readonly<Record<string, string>> = {
  CLINE_SESSION_BACKEND_MODE: "local",
  CLINE_NO_AUTO_UPDATE: "1",
};

/**
 * The sandbox lets a Cline process write in its data folder, not create `~/.cline` itself. A CLI
 * that only `CLINE_API_KEY` signs in has not made that folder yet, so OpenBot makes it.
 */
function confineClineTarget(target: SpawnTarget, confinement: ProcessConfinement): SpawnTarget {
  const state = clineStatePaths();
  for (const folder of state.writable) mkdirSync(folder, { recursive: true, mode: 0o700 });
  return confineSpawnTarget(target, confinement, state);
}

/**
 * What a client needs from the app at spawn, beyond its own CLI: the stored secrets, and the user's
 * own endpoints.
 *
 * Required rather than optional on purpose: a driver that needs a stored key has no other way to
 * reach one, and a call site that forgets the endpoints builds a client whose user simply sees their
 * models missing. `apiKey` is synchronous because the store is loaded eagerly at startup, and
 * `customProviders` is a getter, because both are read inside a spawn.
 */
export interface ProviderClientContext {
  apiKey(provider: AgentProviderId): string | null;
  /** Durable provider-history ports, selected by the external provider id. */
  readonly history?: (provider: AgentProviderId) => AcpHistoryPersistence | undefined;
  readonly customProviders: CustomProviderSource;
  /**
   * The MCP servers the user enabled, read at spawn like the endpoints above. Each client resolves
   * and converts them itself, because the three providers take three different shapes.
   */
  readonly mcpServers: McpServerSource;
  /**
   * What a provider could not be given, reported once per spawn. Optional, so the test call sites
   * and `NO_PROVIDER_CREDENTIALS` stay valid: a driver with no reporter drops silently, exactly as
   * every driver did before.
   */
  readonly reportMcpDrops?: McpDropReporter;
  /**
   * What OpenBot downloaded for the MCP servers, read at spawn like everything else here. Optional
   * for the same reason as `reportMcpDrops`: a driver without one sees the machine as it is.
   */
  readonly mcpToolRuntimes?: McpToolRuntimeSource;
  /**
   * The bearer token for an http server this machine has signed in to, read at spawn. Optional for
   * the same reason again: a driver without one hands over only the headers the user wrote.
   */
  readonly mcpAuthorization?: McpAuthorizationSource;
  /**
   * The sign-ins this machine holds for http MCP servers. Read by `AgentService` and by nothing
   * else: a driver is given `mcpAuthorization` above, which is the one token it can spend. This is
   * the whole authority - it signs in, refreshes and forgets - so it travels no further.
   */
  readonly mcpOAuth?: McpOAuthAuthority;
  /**
   * Whether this model may still be used. A removed endpoint stays in the running process, with the
   * credentials it started with, until that process restarts, and the restart waits for the work in
   * flight. Read at the last moment before a prompt leaves, because everything above it awaits.
   */
  servesModel?(modelId: string): boolean;
  /**
   * A folder OpenBot owns for files it gives a provider process, outside every root an agent can
   * write. Optional for the same reason as `reportMcpDrops`.
   */
  readonly providerStateDirectory?: string;
  /**
   * Variables an agent's tools run with, beyond the user's own environment: today the paths that
   * point `gh` and `git` at the built-in GitHub connection. Paths only, never a secret, because a
   * provider process can outlive the token. Read at each spawn; empty while nothing is connected.
   */
  readonly agentEnvironment?: (inherited?: NodeJS.ProcessEnv) => Readonly<Record<string, string>>;
  /**
   * The saved custom agents with their environment values, read when an agent's process starts.
   * Only the `acp` driver reads it. Optional for the same reason as `reportMcpDrops`: without it no
   * custom agent is saved.
   */
  readonly customAgents?: CustomAgentSource;
}

/** Nothing stored and no endpoint, for tests and for call sites that predate the credential store. */
export const NO_PROVIDER_CREDENTIALS: ProviderClientContext = {
  apiKey: () => null,
  customProviders: () => [],
  mcpServers: () => [],
};

/**
 * What a provider *does*. What it is called, how it is described and where its sign-in help points
 * live in the provider registry in `@openbot/contracts/agent-providers`; a driver holds only the
 * behaviour, so a new provider is one registry row plus one driver.
 */
export interface BuiltInProviderDriver {
  id: AgentProviderId;
  signIn: ProviderSignIn;
  /** Absent for a provider that has no sign-in on another device. */
  codeSignIn?: ProviderCodeSignIn;
  resolveCli(options?: {
    bundledExecutable?: string | null;
  }): Effect.Effect<AgentCliInfo, ProviderClientOperationError>;
  createClient(
    cli: AgentCliInfo,
    requestTimeoutMs: number,
    context: ProviderClientContext,
    confinement?: ProcessConfinement,
  ): AgentClient;
  /**
   * The client that writes an agent profile, when the provider needs a different one. Profile
   * generation asks the model one question and must not let it act, so a provider that can be
   * started without tools starts that way here. Without this hook the normal client is used.
   */
  createProfileClient?(cli: AgentCliInfo, requestTimeoutMs: number, context: ProviderClientContext): AgentClient;
  authState(account: AccountReadResult["account"]): AgentAuthState;
  validateAccount(account: NonNullable<AccountReadResult["account"]>): void;
}

export const BUILT_IN_PROVIDER_DRIVERS: readonly BuiltInProviderDriver[] = [
  {
    id: "pi",
    signIn: { kind: "terminal", timeoutMs: CLI_LOGIN_TIMEOUT_MS },
    resolveCli: resolvePiCli,
    createClient: (cli, timeout, context, confinement) =>
      new PiAgentClient(cli, {
        requestTimeoutMs: timeout,
        ...(confinement
          ? {
              confine: (target) => {
                const paths = piStatePaths();
                for (const path of paths.writable) mkdirSync(path, { recursive: true, mode: 0o700 });
                return confineSpawnTarget(target, confinement, paths);
              },
            }
          : {}),
        extraEnv: () => ({ ...context.agentEnvironment?.() }),
        providerStateDirectory: context.providerStateDirectory,
        mcpServers: context.mcpServers,
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpAuthorization: context.mcpAuthorization,
        history: context.history?.("pi"),
      }),
    createProfileClient: (cli, timeout, context) =>
      new PiAgentClient(cli, {
        requestTimeoutMs: timeout,
        profileGeneration: true,
        providerStateDirectory: context.providerStateDirectory,
      }),
    authState: (account) => ({ kind: "pi", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "muse",
    signIn: {
      kind: "cli-command",
      command: { argv: ["login"], env: () => ({ MUSE_NO_AUTO_UPDATE: "1" }), timeoutMs: CLI_LOGIN_TIMEOUT_MS },
    },
    resolveCli: resolveMuseCli,
    createClient: (cli, timeout, context, confinement) =>
      new MuseAgentClient(cli, {
        requestTimeoutMs: timeout,
        apiKey: () => context.apiKey("muse"),
        extraEnv: () => ({ ...context.agentEnvironment?.() }),
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
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpAuthorization: context.mcpAuthorization,
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
    resolveCli: resolveCodexCli,
    createClient: (cli, requestTimeoutMs) => new CodexAppServerClient(cli.executable, requestTimeoutMs),
    authState: (account) => ({ kind: "chatgpt", email: account?.email ?? null }),
    validateAccount: (account) => {
      if (account.type !== "chatgpt") {
        throw new Error(sourceText("error.provider.codexLoginRequired"));
      }
    },
  },
  {
    id: "claude",
    signIn: {
      kind: "cli-command",
      command: {
        argv: ["auth", "login", "--claudeai"],
        env: (cli): Record<string, string> => (cli.source === "managed" ? { DISABLE_AUTOUPDATER: "1" } : {}),
        timeoutMs: CLI_LOGIN_TIMEOUT_MS,
      },
    },
    // With no browser the CLI prints the link and a "Paste code here" prompt, on a terminal only.
    codeSignIn: {
      kind: "cli",
      flow: "paste",
      command: {
        argv: ["auth", "login", "--claudeai"],
        env: (cli): Record<string, string> => (cli.source === "managed" ? { DISABLE_AUTOUPDATER: "1" } : {}),
        timeoutMs: CLI_LOGIN_TIMEOUT_MS,
      },
    },
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
        context.mcpAuthorization,
        context.providerStateDirectory,
        context.agentEnvironment,
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
    codeSignIn: {
      kind: "cli",
      flow: "device",
      command: {
        argv: ["--no-auto-update", "login", "--device-auth"],
        env: () => ({ GROK_OAUTH2_REFERRER: "openbot" }),
        timeoutMs: CLI_LOGIN_TIMEOUT_MS,
      },
    },
    resolveCli: resolveGrokCli,
    createClient: (cli, requestTimeoutMs, context, confinement) =>
      new GrokAgentClient(
        cli,
        requestTimeoutMs,
        false,
        context.mcpServers,
        context.reportMcpDrops,
        context.mcpToolRuntimes,
        context.mcpAuthorization,
        confinement,
        context.agentEnvironment,
        context.history?.("grok"),
      ),
    createProfileClient: (cli, requestTimeoutMs) => new GrokAgentClient(cli, requestTimeoutMs, true),
    authState: (account) => ({ kind: "grok", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "opencode",
    // `opencode auth login` is an interactive terminal UI and cannot be spawned headless, so the
    // optional OpenCode Go key is pasted into OpenBot instead. Nothing is required to sign in:
    // with no credential at all the CLI still lists the free models and answers a turn.
    signIn: { kind: "external" },
    resolveCli: resolveOpencodeCli,
    // Both clients read the key and the custom providers at spawn, and the profile client merges the
    // endpoints *into* the deny-all layer rather than beside it: the two share one environment
    // variable, so the layer would be lost if a custom provider config replaced it.
    createClient: (cli, timeout, context, confinement) =>
      new AcpAgentClient(cli, timeout, {
        provider: "opencode",
        argv: ["acp"],
        env: {},
        ...(confinement ? { confine: (target) => confineSpawnTarget(target, confinement, openCodeStatePaths()) } : {}),
        extraEnv: () => ({
          ...context.agentEnvironment?.(),
          ...opencodeEnv(cli, context),
          ...openCodeConfigEnv({}, context.customProviders),
          ...(confinement ? OPENCODE_CONFINED_ENV : {}),
        }),
        signInMessage: openCodeSignInMessage(context.customProviders().length),
        servesModel: context.servesModel,
        mcpServers: context.mcpServers,
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpAuthorization: context.mcpAuthorization,
        readRateLimits: () =>
          readOpenCodeGoUsage(context.apiKey("opencode")).pipe(
            Effect.mapError((failure) => providerFailure(failure.cause)),
          ),
        history: context.history?.("opencode"),
      }),
    createProfileClient: (cli, timeout, context) =>
      new AcpAgentClient(cli, timeout, {
        provider: "opencode",
        argv: ["acp"],
        profileGeneration: true,
        env: {},
        extraEnv: () => ({
          ...opencodeEnv(cli, context),
          ...openCodeConfigEnv(OPENCODE_PROFILE_CONFIG, context.customProviders),
        }),
        signInMessage: openCodeSignInMessage(context.customProviders().length),
        servesModel: context.servesModel,
      }),
    authState: (account) => ({ kind: "opencode", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "antigravity",
    // `oauth-personal` is the Google account sign-in that a Google AI Pro or Ultra plan uses.
    signIn: {
      kind: "acp-authenticate",
      methodId: "oauth-personal",
      argv: ANTIGRAVITY_ARGV,
      timeoutMs: CLI_LOGIN_TIMEOUT_MS,
    },
    resolveCli: resolveAntigravityCli,
    createClient: (cli, timeout, context, confinement) =>
      new AcpAgentClient(cli, timeout, {
        provider: "antigravity",
        argv: ANTIGRAVITY_ARGV,
        env: {},
        ...(confinement
          ? { confine: (target) => confineSpawnTarget(target, confinement, antigravityStatePaths()) }
          : {}),
        extraEnv: () => ({ ...context.agentEnvironment?.() }),
        signInMessage: sourceText("error.provider.antigravitySignIn"),
        servesModel: context.servesModel,
        mcpServers: context.mcpServers,
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpAuthorization: context.mcpAuthorization,
        history: context.history?.("antigravity"),
      }),
    // A profile-generation client asks one question and must not act: no MCP servers, and every
    // permission request is cancelled.
    createProfileClient: (cli, timeout, context) =>
      new AcpAgentClient(cli, timeout, {
        provider: "antigravity",
        argv: ANTIGRAVITY_ARGV,
        profileGeneration: true,
        env: {},
        signInMessage: sourceText("error.provider.antigravitySignIn"),
        servesModel: context.servesModel,
      }),
    authState: (account) => ({ kind: "antigravity", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "cursor",
    // `cursor_login` opens the Cursor sign-in page from the server. `CURSOR_API_KEY` in the user's
    // environment signs the CLI in without it.
    signIn: { kind: "acp-authenticate", methodId: "cursor_login", argv: ["acp"], timeoutMs: CLI_LOGIN_TIMEOUT_MS },
    // With `NO_OPEN_BROWSER`, `login` prints the sign-in link and waits until the page signs it in.
    // The ACP `cursor_login` method gives up instead when it cannot open a browser.
    codeSignIn: {
      kind: "cli",
      flow: "link",
      command: { argv: ["login"], env: () => ({ NO_OPEN_BROWSER: "1" }), timeoutMs: CLI_LOGIN_TIMEOUT_MS },
    },
    resolveCli: resolveCursorCli,
    createClient: (cli, timeout, context, confinement) =>
      new AcpAgentClient(cli, timeout, {
        provider: "cursor",
        argv: ["acp"],
        env: {},
        ...(confinement ? { confine: (target) => confineSpawnTarget(target, confinement, cursorStatePaths()) } : {}),
        extraEnv: () => ({ ...context.agentEnvironment?.(), ...(confinement ? cursorConfinedEnv() : {}) }),
        signInMessage: sourceText("error.provider.cursorSignIn"),
        servesModel: context.servesModel,
        mcpServers: context.mcpServers,
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpAuthorization: context.mcpAuthorization,
        history: context.history?.("cursor"),
      }),
    createProfileClient: (cli, timeout, context) =>
      new AcpAgentClient(cli, timeout, {
        provider: "cursor",
        argv: ["acp"],
        profileGeneration: true,
        env: {},
        signInMessage: sourceText("error.provider.cursorSignIn"),
        servesModel: context.servesModel,
      }),
    authState: (account) => ({ kind: "cursor", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "cline",
    // The `cline` method opens the Cline sign-in page. `CLINE_API_KEY` in the user's environment
    // signs the CLI in without it.
    signIn: {
      kind: "acp-authenticate",
      methodId: "cline",
      argv: CLINE_ARGV,
      env: CLINE_ENV,
      timeoutMs: CLI_LOGIN_TIMEOUT_MS,
    },
    // `auth -p cline` prints a device code and its page, and waits until the user confirms it.
    codeSignIn: {
      kind: "cli",
      flow: "device",
      command: { argv: ["auth", "-p", "cline"], env: () => ({ ...CLINE_ENV }), timeoutMs: CLI_LOGIN_TIMEOUT_MS },
    },
    resolveCli: resolveClineCli,
    createClient: (cli, timeout, context, confinement) =>
      new AcpAgentClient(cli, timeout, {
        provider: "cline",
        argv: CLINE_ARGV,
        env: { ...CLINE_ENV },
        ...(confinement ? { confine: (target) => confineClineTarget(target, confinement) } : {}),
        extraEnv: () => ({ ...context.agentEnvironment?.() }),
        signInMessage: sourceText("error.provider.clineSignIn"),
        servesModel: context.servesModel,
        mcpServers: context.mcpServers,
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpAuthorization: context.mcpAuthorization,
        history: context.history?.("cline"),
      }),
    createProfileClient: (cli, timeout, context) =>
      new AcpAgentClient(cli, timeout, {
        provider: "cline",
        argv: CLINE_ARGV,
        profileGeneration: true,
        env: { ...CLINE_ENV },
        signInMessage: sourceText("error.provider.clineSignIn"),
        servesModel: context.servesModel,
      }),
    authState: (account) => ({ kind: "cline", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "acp",
    // Each custom agent signs in its own way, in its own CLI. OpenBot only checks it again.
    signIn: { kind: "external" },
    resolveCli: () => Effect.succeed(CUSTOM_AGENTS_CLI),
    createClient: (_cli, timeout, context, confinement) =>
      new CustomAcpAgentsClient(
        () => savedCustomAgents(context),
        (config, executable, folder, history) =>
          customAgentChild(config, executable, folder, timeout, context, confinement, false, history),
        undefined,
        context.history?.("acp"),
      ),
    createProfileClient: (_cli, timeout, context) =>
      new CustomAcpAgentsClient(
        () => savedCustomAgents(context),
        (config, executable, folder, history) =>
          customAgentChild(config, executable, folder, timeout, context, undefined, true, history),
        undefined,
        context.history?.("acp"),
      ),
    authState: () => ({ kind: "acp", email: null }),
    validateAccount: () => undefined,
  },
] as const;

/**
 * The ACP process of one custom agent. It is given the MCP servers and the confinement as a built-in
 * ACP provider is, and a model check of its own: a model of this agent is served while the agent is
 * saved. `CustomEndpoints.serves` is not used, because it knows only the custom endpoints.
 *
 * A process for a working folder lists its models in that folder: an agent that serves one folder
 * for each process refuses any other. Only the process that lists the catalogue (`folder` null)
 * uses the empty discovery folder.
 */
function customAgentChild(
  config: CustomAgentConfig,
  executable: string,
  folder: string | null,
  timeout: number,
  context: ProviderClientContext,
  confinement: ProcessConfinement | undefined,
  profileGeneration: boolean,
  history?: AcpHistoryPersistence,
): AgentClient {
  const env = Object.fromEntries(config.env.map((entry) => [entry.name, entry.value]));
  const values = config.env.map((entry) => entry.value);
  return new AcpAgentClient({ executable, version: "", source: "system" }, timeout, {
    provider: "acp",
    label: config.name,
    allowNoModels: true,
    discoveryCwd: () => folder ?? customAgentDiscoveryFolder(config.id),
    redactValues: () => values,
    argv: config.args,
    env,
    ...(profileGeneration ? { profileGeneration: true } : {}),
    // The router owns durable reads so it can map routed IDs. The child only appends completed
    // turns; its fallback read then talks to the provider when the stored import is incomplete.
    history: profileGeneration ? undefined : history,
    ...(confinement ? { confine: (target) => confineSpawnTarget(target, confinement, customAgentStatePaths()) } : {}),
    signInMessage: sourceText("error.provider.customAgentSignIn"),
    servesModel: () => savedCustomAgents(context).some((saved) => saved.id === config.id),
    ...(profileGeneration
      ? {}
      : {
          // A variable the user saved on this agent wins over the GitHub connection's. The
          // `GIT_CONFIG_*` entries count on from the user's own, so they always apply.
          extraEnv: () =>
            Object.fromEntries(
              Object.entries(context.agentEnvironment?.({ ...process.env, ...env }) ?? {}).filter(
                ([name]) => name.startsWith("GIT_CONFIG_") || !(name in env),
              ),
            ),
          mcpServers: context.mcpServers,
          reportMcpDrops: context.reportMcpDrops,
          mcpToolRuntimes: context.mcpToolRuntimes,
          mcpAuthorization: context.mcpAuthorization,
        }),
  });
}

export function savedCustomAgents(context: ProviderClientContext): readonly CustomAgentConfig[] {
  return context.customAgents?.() ?? [];
}

let customAgentDiscoveryRoot: string | undefined;

/**
 * An empty folder for the session that lists an agent's models, apart from every workspace. The
 * root is new for each run and private (`mkdtemp`): a fixed path in a shared temp folder could be made
 * first by another user, with an agent config file in it that the agent would then load.
 */
function customAgentDiscoveryFolder(agentId: string): string {
  customAgentDiscoveryRoot ??= mkdtempSync(join(tmpdir(), "openbot-custom-agents-"));
  const folder = join(customAgentDiscoveryRoot, agentId);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  return folder;
}

/** What the runtime shows for the provider `acp`: there is no one CLI, only the saved agents. */
const CUSTOM_AGENTS_CLI: AgentCliInfo = { executable: "", version: "", source: "system" };

const PROVIDER_DRIVERS = new Map(BUILT_IN_PROVIDER_DRIVERS.map((driver) => [driver.id, driver]));

export function requireProviderDriver(provider: AgentProviderId): BuiltInProviderDriver {
  const driver = PROVIDER_DRIVERS.get(provider);
  if (!driver) throw new Error(`Unknown agent provider: ${provider}`);
  return driver;
}
