import type { AgentAuthState, AgentProviderId } from "@openbot/contracts/ipc";
import type { AgentClient } from "./agent-client";
import { CodexAppServerClient } from "./app-server-client";
import { ClaudeAgentClient } from "./claude-client";
import { type AgentCliInfo, resolveClaudeCli, resolveCodexCli, resolveGrokCli } from "./cli";
import { GrokAgentClient } from "./grok-client";
import type { AccountReadResult } from "./protocol";

/**
 * Signing in by running the provider's own CLI and waiting for the process to exit. Codex
 * has no entry here: it signs in over the app-server protocol against a URL the user opens
 * in a browser, and shares no step with spawning a command.
 */
export interface CliLoginCommand {
  readonly argv: readonly string[];
  readonly env: (cli: AgentCliInfo) => Record<string, string>;
  readonly timeoutMs: number;
}

const CLI_LOGIN_TIMEOUT_MS = 10 * 60_000;

export interface BuiltInProviderDriver {
  id: AgentProviderId;
  label: string;
  signInMessage: string;
  cliLogin?: CliLoginCommand;
  resolveCli(options?: { bundledExecutable?: string | null }): Promise<AgentCliInfo>;
  createClient(cli: AgentCliInfo, requestTimeoutMs: number): AgentClient;
  authState(account: AccountReadResult["account"]): AgentAuthState;
  validateAccount(account: NonNullable<AccountReadResult["account"]>): void;
}

export const BUILT_IN_PROVIDER_DRIVERS: readonly BuiltInProviderDriver[] = [
  {
    id: "codex",
    label: "Codex",
    signInMessage: "Run `codex login` to use Codex.",
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
    label: "Claude",
    signInMessage: "Connect Claude to continue.",
    cliLogin: {
      argv: ["auth", "login", "--claudeai"],
      env: (cli): Record<string, string> => (cli.source === "managed" ? { DISABLE_AUTOUPDATER: "1" } : {}),
      timeoutMs: CLI_LOGIN_TIMEOUT_MS,
    },
    resolveCli: resolveClaudeCli,
    createClient: (cli, requestTimeoutMs) => new ClaudeAgentClient(cli, undefined, undefined, requestTimeoutMs),
    authState: (account) => ({ kind: "claude", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "grok",
    label: "Grok",
    signInMessage: "Run `grok login` or set XAI_API_KEY to use Grok.",
    cliLogin: {
      argv: ["--no-auto-update", "login"],
      env: () => ({ GROK_OAUTH2_REFERRER: "openbot" }),
      timeoutMs: CLI_LOGIN_TIMEOUT_MS,
    },
    resolveCli: resolveGrokCli,
    createClient: (cli, requestTimeoutMs) => new GrokAgentClient(cli, requestTimeoutMs),
    authState: (account) => ({ kind: "grok", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
] as const;

export const PROVIDER_DRIVERS = new Map(BUILT_IN_PROVIDER_DRIVERS.map((driver) => [driver.id, driver]));

export function requireProviderDriver(provider: AgentProviderId): BuiltInProviderDriver {
  const driver = PROVIDER_DRIVERS.get(provider);
  if (!driver) throw new Error(`Unknown agent provider: ${provider}`);
  return driver;
}
