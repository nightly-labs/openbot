import type { AgentProviderId } from "./agent-providers";
import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

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

export const PROVIDER_ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const COMMON_RESERVED = ["PATH", "HOME", "NODE_OPTIONS", "OPENBOT_AGENT_PROCESS"] as const;
export const PROVIDER_ENVIRONMENT_RESERVED_NAMES: Readonly<Record<ProviderEnvironmentProvider, readonly string[]>> = {
  claude: [...COMMON_RESERVED, "CLAUDE_CONFIG_DIR"],
  codex: [...COMMON_RESERVED, "CODEX_HOME"],
  antigravity: [...COMMON_RESERVED, "GEMINI_HOME", "WSL_DISTRO_NAME"],
};

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

export interface ProviderEnvironmentVariableInput {
  name: string;
  value: string | null;
  sensitive: boolean;
}

export interface ProviderEnvironmentUpdate {
  provider: ProviderEnvironmentProvider;
  variables: ProviderEnvironmentVariableInput[];
}

export type ProviderEnvironmentProblem = "name" | "reserved" | "duplicate";

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
