import type { AgentAuthState, AgentProviderId } from "@openbot/contracts/ipc";
import { AcpAgentClient } from "./acp-client";
import type { AgentClient } from "./agent-client";
import { CodexAppServerClient } from "./app-server-client";
import { ClaudeAgentClient } from "./claude-client";
import { type AgentCliInfo, resolveClaudeCli, resolveCodexCli, resolveGrokCli, resolveOpencodeCli } from "./cli";
import { GrokAgentClient } from "./grok-client";
import type { AccountReadResult } from "./protocol";

/** One command OpenBot runs against a provider's own CLI, waiting for the process to exit. */
export interface ProviderCliCommand {
  readonly argv: readonly string[];
  readonly env: (cli: AgentCliInfo) => Record<string, string>;
  readonly timeoutMs: number;
}

const CLI_LOGIN_TIMEOUT_MS = 10 * 60_000;
const OPENCODE_SIGN_IN_MESSAGE = "OpenCode listed no model. Add an OpenCode Zen key to continue.";

/**
 * The environment one OpenCode process gets, read at spawn time.
 *
 * `OPENCODE_API_KEY` is the whole of the optional account: with it the CLI lists the paid Zen
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
export type ProviderSignIn =
  /** The provider's own protocol hands back a URL for OpenBot to open. */
  | { kind: "browser" }
  /** OpenBot spawns the provider's CLI and waits for the process to exit. */
  | { kind: "cli-command"; command: ProviderCliCommand }
  /** The user signs in with the CLI themselves; OpenBot only re-probes the provider afterwards. */
  | { kind: "external" };

/**
 * The secrets a driver may hand to the CLI it spawns.
 *
 * Required rather than optional on purpose: a driver that needs a stored key has no other way to
 * reach one, and making the parameter optional would let a call site quietly build a client that
 * can never see the user's key. `apiKey` is synchronous because the store is loaded eagerly at
 * startup, which is what lets it be read inside a spawn.
 */
export interface ProviderClientContext {
  apiKey(provider: AgentProviderId): string | null;
}

/** Nothing stored, for tests and for call sites that predate the credential store. */
export const NO_PROVIDER_CREDENTIALS: ProviderClientContext = { apiKey: () => null };

/**
 * What a provider *does*. What it is called, how it is described and where its sign-in help points
 * live in the provider registry in `@openbot/contracts/agent-providers`; a driver holds only the
 * behaviour, so a new provider is one registry row plus one driver.
 */
export interface BuiltInProviderDriver {
  id: AgentProviderId;
  signIn: ProviderSignIn;
  resolveCli(options?: { bundledExecutable?: string | null }): Promise<AgentCliInfo>;
  createClient(cli: AgentCliInfo, requestTimeoutMs: number, credentials: ProviderClientContext): AgentClient;
  /**
   * The client that writes an agent profile, when the provider needs a different one. Profile
   * generation asks the model one question and must not let it act, so a provider that can be
   * started without tools starts that way here. Without this hook the normal client is used.
   */
  createProfileClient?(cli: AgentCliInfo, requestTimeoutMs: number, credentials: ProviderClientContext): AgentClient;
  authState(account: AccountReadResult["account"]): AgentAuthState;
  validateAccount(account: NonNullable<AccountReadResult["account"]>): void;
}

export const BUILT_IN_PROVIDER_DRIVERS: readonly BuiltInProviderDriver[] = [
  {
    id: "codex",
    signIn: { kind: "browser" },
    resolveCli: resolveCodexCli,
    createClient: (cli, requestTimeoutMs) => new CodexAppServerClient(cli.executable, requestTimeoutMs),
    authState: (account) => ({ kind: "chatgpt", email: account?.email ?? null }),
    validateAccount: (account) => {
      if (account.type !== "chatgpt") {
        throw new Error("Codex requires a ChatGPT subscription login. Run `codex login`.");
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
    resolveCli: resolveClaudeCli,
    createClient: (cli, requestTimeoutMs) => new ClaudeAgentClient(cli, undefined, undefined, requestTimeoutMs),
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
    resolveCli: resolveGrokCli,
    createClient: (cli, requestTimeoutMs) => new GrokAgentClient(cli, requestTimeoutMs),
    createProfileClient: (cli, requestTimeoutMs) => new GrokAgentClient(cli, requestTimeoutMs, true),
    authState: (account) => ({ kind: "grok", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "opencode",
    // `opencode auth login` is an interactive terminal UI and cannot be spawned headless, so the
    // optional OpenCode Zen key is pasted into OpenBot instead. Nothing is required to sign in:
    // with no credential at all the CLI still lists the free models and answers a turn.
    signIn: { kind: "external" },
    resolveCli: resolveOpencodeCli,
    createClient: (cli, timeout, credentials) =>
      new AcpAgentClient(cli, timeout, {
        provider: "opencode",
        argv: ["acp"],
        env: {},
        extraEnv: () => opencodeEnv(cli, credentials),
        signInMessage: OPENCODE_SIGN_IN_MESSAGE,
      }),
    createProfileClient: (cli, timeout, credentials) =>
      new AcpAgentClient(cli, timeout, {
        provider: "opencode",
        argv: ["acp"],
        profileGeneration: true,
        env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: { "*": "deny" } }) },
        extraEnv: () => opencodeEnv(cli, credentials),
        signInMessage: OPENCODE_SIGN_IN_MESSAGE,
      }),
    authState: (account) => ({ kind: "opencode", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
] as const;

export const PROVIDER_DRIVERS = new Map(BUILT_IN_PROVIDER_DRIVERS.map((driver) => [driver.id, driver]));

export function requireProviderDriver(provider: AgentProviderId): BuiltInProviderDriver {
  const driver = PROVIDER_DRIVERS.get(provider);
  if (!driver) throw new Error(`Unknown agent provider: ${provider}`);
  return driver;
}
