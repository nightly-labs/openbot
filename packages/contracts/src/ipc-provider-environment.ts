/**
 * The environment variables of a provider on a server (`provider-environment-v1`), as the desktop main
 * process, the preload, the browser client and the mobile app read them. Each process of the provider
 * starts with them: API keys, base URLs and other settings of its CLI. A proxy such as CLIProxyAPI is
 * one use: Claude reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`, and the Antigravity CLI of the
 * Gemini provider reads `AGY_LLM_GATEWAY_URL` and `AGY_LLM_GATEWAY_API_KEY`. Codex does not read a base
 * URL from its environment, so the host turns `OPENAI_BASE_URL` on the Codex page into a model provider
 * of Codex that sends the requests there, with `OPENAI_API_KEY` as its key.
 *
 * A sensitive value goes from a client to the host only. No read returns it: `stored` tells that the
 * host has one.
 */

import type { AgentProviderId } from "./agent-providers";
import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

/** The providers whose processes take the variables. */
export const PROVIDER_ENVIRONMENT_PROVIDERS = [
  "claude",
  "codex",
  "antigravity",
] as const satisfies readonly AgentProviderId[];
export type ProviderEnvironmentProvider = (typeof PROVIDER_ENVIRONMENT_PROVIDERS)[number];

export function isProviderEnvironmentProvider(value: unknown): value is ProviderEnvironmentProvider {
  return isOneOf(PROVIDER_ENVIRONMENT_PROVIDERS, value);
}

export const PROVIDER_ENVIRONMENT_LIMITS = { variables: 32, name: 128, value: 8_192 } as const;

/** A POSIX variable name: letters, digits and `_`, and no digit first. */
export const PROVIDER_ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The names that OpenBot sets for each process of the provider: the home folder of an account, the
 * marker that finds leftover processes, and the CPU limit of a server. A variable cannot replace them.
 */
const COMMON_RESERVED = ["PATH", "HOME", "NODE_OPTIONS", "OPENBOT_AGENT_PROCESS"] as const;
export const PROVIDER_ENVIRONMENT_RESERVED_NAMES: Readonly<Record<ProviderEnvironmentProvider, readonly string[]>> = {
  claude: [...COMMON_RESERVED, "CLAUDE_CONFIG_DIR"],
  codex: [...COMMON_RESERVED, "CODEX_HOME"],
  antigravity: [...COMMON_RESERVED, "GEMINI_HOME", "WSL_DISTRO_NAME"],
};

/** One variable as a read gives it. A sensitive one has an empty `value`; `stored` tells the host has one. */
export interface ProviderEnvironmentVariable {
  name: string;
  value: string;
  sensitive: boolean;
  stored: boolean;
}

export interface ProviderEnvironment {
  provider: ProviderEnvironmentProvider;
  variables: ProviderEnvironmentVariable[];
}

/** One variable of a change. `value: null` keeps the value that the host has for this sensitive name. */
export interface ProviderEnvironmentVariableInput {
  name: string;
  value: string | null;
  sensitive: boolean;
}

/** The whole list of a provider: a saved name that is not in it is removed. */
export interface ProviderEnvironmentUpdate {
  provider: ProviderEnvironmentProvider;
  variables: ProviderEnvironmentVariableInput[];
}

export type ProviderEnvironmentProblem = "name" | "reserved" | "duplicate";

/** What is wrong with the name of a variable in `names`, the trimmed names of the whole list, or null. */
export function providerEnvironmentProblem(
  provider: ProviderEnvironmentProvider,
  name: string,
  names: readonly string[],
): ProviderEnvironmentProblem | null {
  const trimmed = name.trim();
  if (!PROVIDER_ENVIRONMENT_NAME_PATTERN.test(trimmed) || trimmed.length > PROVIDER_ENVIRONMENT_LIMITS.name)
    return "name";
  if (PROVIDER_ENVIRONMENT_RESERVED_NAMES[provider].includes(trimmed)) return "reserved";
  if (names.filter((other) => other === trimmed).length > 1) return "duplicate";
  return null;
}

function isVariable(value: unknown): value is ProviderEnvironmentVariable {
  return (
    isDynamicRecord(value) &&
    isString(value.name) &&
    isString(value.value) &&
    typeof value.sensitive === "boolean" &&
    typeof value.stored === "boolean"
  );
}

export function decodeProviderEnvironment(value: unknown): ProviderEnvironment {
  if (
    !isDynamicRecord(value) ||
    !isProviderEnvironmentProvider(value.provider) ||
    !Array.isArray(value.variables) ||
    value.variables.length > PROVIDER_ENVIRONMENT_LIMITS.variables
  )
    throw new Error("Invalid provider environment.");
  const variables: ProviderEnvironmentVariable[] = [];
  for (const variable of value.variables) {
    if (!isVariable(variable)) throw new Error("Invalid provider environment.");
    variables.push({
      name: variable.name,
      value: variable.value,
      sensitive: variable.sensitive,
      stored: variable.stored,
    });
  }
  return { provider: value.provider, variables };
}
